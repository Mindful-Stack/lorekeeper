#!/bin/bash
set -euo pipefail

# --- Configuration ---
KNOWLEDGE_MAX_AGE_DAYS="${KNOWLEDGE_MAX_AGE_DAYS:-7}"

# --- Debug mode ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEBUG_MODE="false"
if [ "${KNOWLEDGE_DEBUG:-}" = "1" ]; then
    DEBUG_MODE="true"
elif [ -f ".knowledge-debug" ] || [ -f "$PLUGIN_ROOT/.knowledge-debug" ]; then
    DEBUG_MODE="true"
fi

# --- Helper: escape a value for embedding in the hand-built JSON below ---
# The systemMessage / additionalContext payloads are assembled by hand (no jq/node
# dependency on the output path), so any interpolated value that could contain a
# backslash or double-quote — chiefly filesystem paths on Windows or unusual dir
# names — must be escaped or it produces invalid JSON. Intended `\n` line breaks in
# the message literals are written as the two-character sequence \n and are NOT
# touched by this helper; it only sanitises interpolated values.
json_escape() {
    local s=$1
    s=${s//\\/\\\\}   # backslash -> \\
    s=${s//\"/\\\"}   # double quote -> \"
    printf '%s' "$s"
}

# --- Skill Router (shared between debug and production) ---
SKILL_ROUTER='Lorekeeper Skill Router:\n\nWhen working in projects with a configured knowledge base, use the RIGHT skill for the task:\n\n- QUESTIONS about patterns/conventions/standards (\"How do we handle X?\", \"What'\''s our pattern for Y?\", \"Do we use X?\")\n  -> Use the pattern-identifier skill (docs-first via knowledge-question-answerer agent)\n\n- CREATIVE WORK (features, components, new functionality)\n  -> Use the brainstorming skill (design before code, always)\n\n- MULTI-STEP TASKS with spec/requirements\n  -> Use the writing-plans skill (task breakdown before implementation)\n\n- EXECUTING a written plan\n  -> Use the executing-plans skill (batch execution with checkpoints)\n\n- IMPLEMENTING any feature or bugfix\n  -> Use the test-driven-development skill (RED-GREEN-REFACTOR, default for all work)\n\n- BUG, TEST FAILURE, or UNEXPECTED BEHAVIOR\n  -> Use the systematic-debugging skill (4-phase root cause methodology)\n\n- CLAIMING WORK IS COMPLETE or FIXED\n  -> Use the verification-before-completion skill (evidence before claims, always)\n\n- INDEPENDENT TASKS from a plan\n  -> Use the subagent-driven-development skill (coordinated plan execution)\n\n- MULTIPLE INDEPENDENT PROBLEMS (e.g., unrelated test failures)\n  -> Use the dispatching-parallel-agents skill (ad-hoc parallel work)\n\n- LOADING DOMAIN CONTEXT manually\n  -> Use /lore:prime <domain>\n\n- CODE REVIEW or PR review\n  -> Use the review skill or /lore:review command\n\n- MISSING or OUTDATED documentation noticed\n  -> Use the knowledge-update skill or /lore:update command\n\nIf there is even a small chance a skill applies, invoke it before responding.\nCommon rationalizations for skipping (\"this is simple\", \"let me explore first\",\n\"I already know this\") are not valid reasons to bypass skills.\n\nIf you are about to write or modify code and no workflow skill has been invoked,\ndispatch knowledge-reader with the task context before proceeding.\n\nPriority: User instructions > Plugin skills > Default system prompt.\n\nStandards Loading Order: Knowledge base (general -> language -> framework -> domain)\nTHEN repo-local standards (docs/standards/). Repo-specific standards take precedence\nwhen they conflict.\n\nMulti-KB rule: When multiple `Knowledge path:` markers are present, they are listed\nin priority order (lowest to highest); later entries override earlier ones when the\nsame relative path exists in both (whole-file replacement, never section merging).\nWrites always go to the `Team knowledge path:` marker (the last/highest-priority KB)\nunless the file being edited already lives in another KB.'

# --- Helper: walk up from cwd looking for household.json (witan-household manifest) ---
find_household_walkup() {
    local dir
    dir="$(pwd)"
    local depth=0
    while [ "$dir" != "/" ] && [ "$depth" -lt 6 ]; do
        if [ -f "$dir/household.json" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
        depth=$((depth + 1))
    done
    return 1
}

# --- Resolve knowledge bases ---
# Priority:
#   1. .lorekeeper/config.json:knowledgeBasePath in CWD (explicit, single KB)
#   2. $KNOWLEDGE_BASE_PATH env var (explicit, single KB)
#   3. household.json walk-up — multi-KB aware: shared_knowledge_bases[] (optional,
#      priority order lowest -> highest) + knowledge_base (team/write target, default "lore")
#   4. ./lore, ./docs/lore, ./docs/shared-knowledge, ./shared-knowledge, ./knowledge
#      sibling fallback (single KB)
KNOWLEDGE_MSG=""
RESOLVED_PATH=""
KNOWLEDGE_ROOTS=()
KNOWLEDGE_PATHS=()
MISSING_KBS=()
HOUSEHOLD_ROOT=""
SCHEMA_NAG=""

# 1. Per-project config
if [ -f "$PWD/.lorekeeper/config.json" ]; then
    CONFIG_PATH=$(node -e 'try{const c=require(process.argv[1]);process.stdout.write(c.knowledgeBasePath||"")}catch(e){}' "$PWD/.lorekeeper/config.json" 2>/dev/null || echo "")
    if [ -n "$CONFIG_PATH" ]; then
        # Resolve relative to .lorekeeper/ parent (i.e. CWD)
        case "$CONFIG_PATH" in
            /*|[A-Za-z]:*) RESOLVED_PATH="$CONFIG_PATH" ;;
            *)             RESOLVED_PATH="$PWD/$CONFIG_PATH" ;;
        esac
    fi
fi

# 2. Env var
if [ -z "$RESOLVED_PATH" ] && [ -n "${KNOWLEDGE_BASE_PATH:-}" ]; then
    RESOLVED_PATH="$KNOWLEDGE_BASE_PATH"
fi

if [ -n "$RESOLVED_PATH" ]; then
    # Explicit single-KB configuration — validate it; do NOT fall through on error,
    # a broken explicit config should be surfaced, not silently bypassed.
    KNOWLEDGE_ROOT="${RESOLVED_PATH//\\//}"

    if [ ! -d "$KNOWLEDGE_ROOT" ]; then
        KNOWLEDGE_MSG="Knowledge base path \\\"$(json_escape "$KNOWLEDGE_ROOT")\\\" does not exist.\n\nPlease verify the path and restart Claude Code."
    elif [ ! -d "$KNOWLEDGE_ROOT/knowledge" ]; then
        KNOWLEDGE_MSG="Knowledge base path \\\"$(json_escape "$KNOWLEDGE_ROOT")\\\" has no knowledge/ subdirectory.\n\nExpected: $(json_escape "$KNOWLEDGE_ROOT")/knowledge/"
    else
        KNOWLEDGE_ROOTS+=("$KNOWLEDGE_ROOT")
        KNOWLEDGE_PATHS+=("$KNOWLEDGE_ROOT/knowledge")
    fi
else
    # 3. household.json walk-up (multi-KB)
    if HOUSEHOLD_ROOT=$(find_household_walkup); then
        # KB names resolve as <household-root>/<name>. Output order: shared first
        # (priority order, lowest -> highest), team KB appended last — the message
        # builder below treats the last entry as the team/write target.
        # Node missing or manifest malformed -> fall back to the default "lore" so
        # the hook still emits a useful systemMessage. Household path passed via env
        # var (process.env.HH) instead of interpolated into the JS source — safer
        # for Windows/MSYS paths and any unusual characters.
        if command -v node &>/dev/null; then
            KB_LIST=$(HH="$HOUSEHOLD_ROOT" node -e "
try {
  const m = require(process.env.HH + '/household.json');
  const team = (typeof m.knowledge_base === 'string' && m.knowledge_base.length) ? m.knowledge_base : 'lore';
  const shared = Array.isArray(m.shared_knowledge_bases) ? m.shared_knowledge_bases : [];
  const names = [...shared, team];
  console.log(names.filter(n => typeof n === 'string' && n.length).join('\\n'));
} catch (e) {
  console.log('lore');
}
" 2>/dev/null) || KB_LIST="lore"
        else
            KB_LIST="lore"
        fi

        while IFS= read -r kb_name; do
            [ -z "$kb_name" ] && continue
            kb_root="$HOUSEHOLD_ROOT/$kb_name"
            if [ -d "$kb_root/knowledge" ]; then
                KNOWLEDGE_ROOTS+=("$kb_root")
                KNOWLEDGE_PATHS+=("$kb_root/knowledge")
            else
                MISSING_KBS+=("$kb_name")
            fi
        done <<< "$KB_LIST"

        # --- Schema-version gate (composes with KB nags below; never blocks) ---
        # Read the workspace's declared schema_version (absent -> 1) and the plugin's
        # current schema. On drift, set SCHEMA_NAG; it is appended to SYS_MSG after the
        # message is assembled. Degrade silently (no nag, no crash) if node or the
        # schema file is unavailable — the gate must never break SessionStart.
        if command -v node &>/dev/null && [ -f "$PLUGIN_ROOT/scripts/manifest-schema.json" ]; then
            SCHEMA_CMP=$(HH="$HOUSEHOLD_ROOT" SCHEMA_FILE="$PLUGIN_ROOT/scripts/manifest-schema.json" node -e "
try {
  const m = require(process.env.HH + '/household.json');
  const cur = require(process.env.SCHEMA_FILE).current;
  const ws = Number.isInteger(m.schema_version) ? m.schema_version : 1;
  if (typeof cur !== 'number') process.exit(0);
  if (ws < cur) console.log('behind ' + ws + ' ' + cur);
  else if (ws > cur) console.log('ahead ' + ws + ' ' + cur);
} catch (e) {}
" 2>/dev/null || echo "")
            if [ -n "$SCHEMA_CMP" ]; then
                # shellcheck disable=SC2086
                set -- $SCHEMA_CMP
                SCHEMA_STATUS=$1; SCHEMA_WS=$2; SCHEMA_CUR=$3
                if [ "$SCHEMA_STATUS" = "behind" ]; then
                    SCHEMA_NAG="⚠️  Workspace schema v${SCHEMA_WS} is older than this plugin (v${SCHEMA_CUR}). Run /lore:migrate to update household.json. Some /lore:* commands may misbehave until you do."
                elif [ "$SCHEMA_STATUS" = "ahead" ]; then
                    SCHEMA_NAG="Workspace schema v${SCHEMA_WS} is newer than this plugin (v${SCHEMA_CUR}). Update the plugin: /plugin update lore@witan."
                fi
            fi
        fi

        if [ ${#KNOWLEDGE_PATHS[@]} -eq 0 ]; then
            MISSING_DETAIL=""
            if [ ${#MISSING_KBS[@]} -gt 0 ]; then
                MISSING_DETAIL="\\nMissing: $(json_escape "${MISSING_KBS[*]}")"
            fi
            KNOWLEDGE_MSG="⚠️  witan-household found at $(json_escape "$HOUSEHOLD_ROOT") but no knowledge bases resolved.$MISSING_DETAIL\n\nClone the missing knowledge bases into the household (or fix knowledge_base / shared_knowledge_bases in household.json), then restart Claude Code.\n\nAll /lore:* commands will degrade until this is configured."
        fi
    else
        # 4. Sibling fallback. `lore/` is the canonical name in the witan-household
        # pattern; the others are kept for back-compat with pre-witan-household setups.
        for candidate in "./lore" "./docs/lore" "./docs/shared-knowledge" "./shared-knowledge" "./knowledge"; do
            if [ -d "$candidate" ] && { [ -d "$candidate/knowledge" ] || [ -f "$candidate/knowledge.config.json" ]; }; then
                KB_ROOT="$(cd "$candidate" && pwd)"
                if [ -d "$KB_ROOT/knowledge" ]; then
                    KNOWLEDGE_ROOTS+=("$KB_ROOT")
                    KNOWLEDGE_PATHS+=("$KB_ROOT/knowledge")
                else
                    KNOWLEDGE_MSG="Knowledge base path \\\"$(json_escape "$KB_ROOT")\\\" has no knowledge/ subdirectory.\n\nExpected: $(json_escape "$KB_ROOT")/knowledge/"
                fi
                break
            fi
        done
    fi
fi

# --- Build the two output channels ---
#   systemMessage     -> shown to the USER only (Claude does NOT see it).
#                        Carries the human summary, staleness list, and setup guidance.
#   additionalContext -> injected into the MODEL's context (the user does NOT see it).
#                        Carries the `Knowledge path:` markers, the skill router, and
#                        any model-facing instruction (e.g. the stale-KB update offer).
# This split is the documented SessionStart hook contract; keeping the markers on the
# model-visible channel is what every command/agent depends on.
SYS_MSG=""
MODEL_CTX=""

if [ ${#KNOWLEDGE_PATHS[@]} -gt 0 ]; then
    KB_COUNT=${#KNOWLEDGE_PATHS[@]}
    LAST_IDX=$((KB_COUNT - 1))
    TEAM_KB_PATH="${KNOWLEDGE_PATHS[$LAST_IDX]}"

    # Header (model context): single-KB keeps the old wording for backward compat.
    if [ "$KB_COUNT" -eq 1 ]; then
        HEADER="Knowledge base: $(json_escape "${KNOWLEDGE_ROOTS[0]}")"
    else
        HEADER="Knowledge bases ($KB_COUNT, in priority order lowest -> highest; later overrides earlier):"
        for i in "${!KNOWLEDGE_ROOTS[@]}"; do
            HEADER="$HEADER\\n  $((i+1)). $(json_escape "${KNOWLEDGE_ROOTS[$i]}")"
        done
    fi

    # One `Knowledge path:` line per KB (model context), in priority order (lowest first),
    # followed by the `Team knowledge path:` write-target marker.
    PATH_LINES=""
    for kb_path in "${KNOWLEDGE_PATHS[@]}"; do
        PATH_LINES="${PATH_LINES}Knowledge path: $(json_escape "$kb_path")/\\n"
    done
    PATH_LINES="${PATH_LINES}Team knowledge path: $(json_escape "$TEAM_KB_PATH")/"

    # Staleness: collect stale KB roots. The visible list goes to the user; the
    # actual update *offer* goes to the model via additionalContext.
    STALE_ROOTS=()
    if command -v git &>/dev/null; then
        for kb_root in "${KNOWLEDGE_ROOTS[@]}"; do
            if [ -d "$kb_root/.git" ]; then
                LAST_COMMIT_TS=$(git -C "$kb_root" log -1 --format=%ct 2>/dev/null || echo "")
                if [ -n "$LAST_COMMIT_TS" ]; then
                    NOW_TS=$(date +%s)
                    AGE_DAYS=$(( (NOW_TS - LAST_COMMIT_TS) / 86400 ))
                    if [ "$AGE_DAYS" -ge "$KNOWLEDGE_MAX_AGE_DAYS" ]; then
                        STALE_ROOTS+=("$kb_root")
                    fi
                fi
            fi
        done
    fi

    # User-facing summary line.
    if [ "$KB_COUNT" -eq 1 ]; then
        SYS_MSG="Lorekeeper: knowledge base loaded ($(json_escape "${KNOWLEDGE_ROOTS[0]}"))."
    else
        SYS_MSG="Lorekeeper: $KB_COUNT knowledge bases loaded; team/write KB is $(json_escape "${KNOWLEDGE_ROOTS[$LAST_IDX]}")."
    fi

    # Staleness — two channels:
    #   visible: a compact list + a note that Claude will offer to refresh them.
    #   model:   a one-shot instruction to offer the refresh command, prompt-gated.
    STALE_INSTRUCTION=""
    if [ ${#STALE_ROOTS[@]} -gt 0 ]; then
        STALE_LIST=""
        for r in "${STALE_ROOTS[@]}"; do
            STALE_LIST="${STALE_LIST}\\n  - $(json_escape "$r")"
        done
        SYS_MSG="${SYS_MSG}\\n\\n⚠️  ${#STALE_ROOTS[@]} knowledge base(s) may be stale (no commit in >= ${KNOWLEDGE_MAX_AGE_DAYS} days):${STALE_LIST}\\nClaude will offer to update them."

        if [ -n "$HOUSEHOLD_ROOT" ]; then
            STALE_INSTRUCTION="Stale knowledge base(s) detected: $(json_escape "${STALE_ROOTS[*]}"). At a natural moment (not mid-task), offer ONCE to refresh them by running \\\"make -C $(json_escape "$HOUSEHOLD_ROOT") update-kb\\\". If that make target does not exist, fall back to \\\"git -C <kb-root> pull --ff-only\\\" for each stale KB. Do not run it without the user's go-ahead, and do not raise this again this session."
        else
            STALE_INSTRUCTION="Stale knowledge base(s) detected: $(json_escape "${STALE_ROOTS[*]}"). At a natural moment (not mid-task), offer ONCE to refresh each by running \\\"git -C <kb-root> pull --ff-only\\\". Do not run it without the user's go-ahead, and do not raise this again this session."
        fi
    fi

    # Partial nag (user-facing): KBs listed in household.json without a knowledge/ dir.
    if [ ${#MISSING_KBS[@]} -gt 0 ]; then
        SYS_MSG="${SYS_MSG}\\n\\n⚠️  Some knowledge bases listed in household.json have no knowledge/ directory: $(json_escape "${MISSING_KBS[*]}"). Clone them into $(json_escape "$HOUSEHOLD_ROOT"), or remove them from shared_knowledge_bases."
    fi

    # Assemble the model context: markers + (optional stale offer) + skill router.
    MODEL_CTX="${HEADER}\\n${PATH_LINES}"
    if [ -n "$STALE_INSTRUCTION" ]; then
        MODEL_CTX="${MODEL_CTX}\\n\\n${STALE_INSTRUCTION}"
    fi
    MODEL_CTX="${MODEL_CTX}\\n\\n${SKILL_ROUTER}"
elif [ -n "$KNOWLEDGE_MSG" ]; then
    # A resolution-stage notice was set (broken explicit path, household-found-but-empty,
    # sibling without knowledge/). Show it to the user; also expose it to the model so
    # /lore:* commands can detect the not-configured / degraded state from session context.
    SYS_MSG="$KNOWLEDGE_MSG"
    MODEL_CTX="${KNOWLEDGE_MSG}\\n\\n${SKILL_ROUTER}"
else
    SYS_MSG='No knowledge base configured.\n\nOptions:\n  1. Run /lore:init to scaffold a new knowledge base (witan-household)\n  2. Set KNOWLEDGE_BASE_PATH environment variable\n  3. Add .lorekeeper/config.json with { \"knowledgeBasePath\": \"/path\" } to this project\n\nAll /lore:* commands will show setup instructions until configured.'
    MODEL_CTX="No knowledge base configured.\\n\\n${SKILL_ROUTER}"
fi

# Append the schema-drift nag (if any) to the user-visible message, composing with
# whatever KB summary/nags were already assembled. User-facing only; not a marker.
if [ -n "${SCHEMA_NAG:-}" ]; then
    if [ -n "$SYS_MSG" ]; then
        SYS_MSG="${SYS_MSG}\\n\\n${SCHEMA_NAG}"
    else
        SYS_MSG="$SCHEMA_NAG"
    fi
fi

# --- Output ---
if [ "$DEBUG_MODE" = "true" ]; then
    # Debug instructions are model-facing — prepend them to the model context channel.
    DEBUG_PREFIX="LOREKEEPER DEBUG MODE ENABLED.\\n\\nYou MUST output these debug lines at the START of your response:\\n\\n[KNOWLEDGE:DEBUG] hook_fired=SessionStart\\n[KNOWLEDGE:DEBUG] knowledge_env=\${KNOWLEDGE_BASE_PATH:-<not set>}\\n\\nThen, when executing any /lore:* command, ALSO output:\\n  [KNOWLEDGE:DEBUG] command=<command-name>\\n\\nWhen a workflow skill triggers, ALSO output:\\n  [KNOWLEDGE:DEBUG] skill_triggered=<skill-name>\\n  [KNOWLEDGE:DEBUG] trigger_reason=<brief reason why you triggered>\\n\\nWhen dispatching knowledge-reader, ALSO output:\\n  [KNOWLEDGE:DEBUG] knowledge_reader_dispatched=true\\n  [KNOWLEDGE:DEBUG] hint=<priority hint sent to reader>\\n\\nThese debug lines MUST appear before any other content in your response."
    MODEL_CTX="${DEBUG_PREFIX}\\n\\n${MODEL_CTX}"
fi

if [ -n "$MODEL_CTX" ]; then
    echo "{\"systemMessage\": \"$SYS_MSG\", \"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"$MODEL_CTX\"}}"
else
    echo "{\"systemMessage\": \"$SYS_MSG\"}"
fi
