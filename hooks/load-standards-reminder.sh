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
        KNOWLEDGE_MSG="Knowledge base path \\\"$KNOWLEDGE_ROOT\\\" does not exist.\n\nPlease verify the path and restart Claude Code."
    elif [ ! -d "$KNOWLEDGE_ROOT/knowledge" ]; then
        KNOWLEDGE_MSG="Knowledge base path \\\"$KNOWLEDGE_ROOT\\\" has no knowledge/ subdirectory.\n\nExpected: $KNOWLEDGE_ROOT/knowledge/"
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

        if [ ${#KNOWLEDGE_PATHS[@]} -eq 0 ]; then
            MISSING_DETAIL=""
            if [ ${#MISSING_KBS[@]} -gt 0 ]; then
                MISSING_DETAIL="\\nMissing: ${MISSING_KBS[*]}"
            fi
            KNOWLEDGE_MSG="⚠️  witan-household found at $HOUSEHOLD_ROOT but no knowledge bases resolved.$MISSING_DETAIL\n\nClone the missing knowledge bases into the household (or fix knowledge_base / shared_knowledge_bases in household.json), then restart Claude Code.\n\nAll /lore:* commands will degrade until this is configured."
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
                    KNOWLEDGE_MSG="Knowledge base path \\\"$KB_ROOT\\\" has no knowledge/ subdirectory.\n\nExpected: $KB_ROOT/knowledge/"
                fi
                break
            fi
        done
    fi
fi

# --- Build the systemMessage ---
if [ ${#KNOWLEDGE_PATHS[@]} -gt 0 ]; then
    KB_COUNT=${#KNOWLEDGE_PATHS[@]}
    LAST_IDX=$((KB_COUNT - 1))
    TEAM_KB_PATH="${KNOWLEDGE_PATHS[$LAST_IDX]}"

    # Header: single-KB keeps the old wording for backward compat; multi-KB gets a summary.
    if [ "$KB_COUNT" -eq 1 ]; then
        HEADER="Knowledge base: ${KNOWLEDGE_ROOTS[0]}"
    else
        HEADER="Knowledge bases ($KB_COUNT, in priority order lowest -> highest; later overrides earlier):"
        for i in "${!KNOWLEDGE_ROOTS[@]}"; do
            HEADER="$HEADER\\n  $((i+1)). ${KNOWLEDGE_ROOTS[$i]}"
        done
    fi

    # One `Knowledge path:` line per KB, in priority order (lowest first).
    PATH_LINES=""
    for kb_path in "${KNOWLEDGE_PATHS[@]}"; do
        PATH_LINES="${PATH_LINES}Knowledge path: $kb_path/\\n"
    done
    PATH_LINES="${PATH_LINES}Team knowledge path: $TEAM_KB_PATH/"

    # Staleness check per KB
    STALENESS_WARNING=""
    if command -v git &>/dev/null; then
        for kb_root in "${KNOWLEDGE_ROOTS[@]}"; do
            if [ -d "$kb_root/.git" ]; then
                LAST_COMMIT_TS=$(git -C "$kb_root" log -1 --format=%ct 2>/dev/null || echo "")
                if [ -n "$LAST_COMMIT_TS" ]; then
                    NOW_TS=$(date +%s)
                    AGE_DAYS=$(( (NOW_TS - LAST_COMMIT_TS) / 86400 ))
                    if [ "$AGE_DAYS" -ge "$KNOWLEDGE_MAX_AGE_DAYS" ]; then
                        STALENESS_WARNING="${STALENESS_WARNING}\\nWARNING: $kb_root may be stale (last updated $AGE_DAYS days ago). Pull latest: cd $kb_root && git pull"
                    fi
                fi
            fi
        done
    fi

    # Partial nag: some KBs were listed in household.json but don't have /knowledge/.
    PARTIAL_NAG=""
    if [ ${#MISSING_KBS[@]} -gt 0 ]; then
        PARTIAL_NAG="\\n\\n⚠️  Some knowledge bases listed in household.json have no /knowledge/ directory: ${MISSING_KBS[*]}. Clone them into $HOUSEHOLD_ROOT, or remove them from shared_knowledge_bases."
    fi

    KNOWLEDGE_MSG="${HEADER}\\n${PATH_LINES}${STALENESS_WARNING}${PARTIAL_NAG}"
elif [ -z "$KNOWLEDGE_MSG" ]; then
    KNOWLEDGE_MSG='No knowledge base configured.\n\nOptions:\n  1. Run /lore:init to scaffold a new knowledge base (witan-household)\n  2. Set KNOWLEDGE_BASE_PATH environment variable\n  3. Add .lorekeeper/config.json with { \"knowledgeBasePath\": \"/path\" } to this project\n\nAll /lore:* commands will show setup instructions until configured.'
fi

# --- Output ---
if [ "$DEBUG_MODE" = "true" ]; then
    # Build debug prefix
    DEBUG_PREFIX="LOREKEEPER DEBUG MODE ENABLED.\\n\\nYou MUST output these debug lines at the START of your response:\\n\\n[KNOWLEDGE:DEBUG] hook_fired=SessionStart\\n[KNOWLEDGE:DEBUG] knowledge_env=\${KNOWLEDGE_BASE_PATH:-<not set>}\\n\\nThen, when executing any /lore:* command, ALSO output:\\n  [KNOWLEDGE:DEBUG] command=<command-name>\\n\\nWhen a workflow skill triggers, ALSO output:\\n  [KNOWLEDGE:DEBUG] skill_triggered=<skill-name>\\n  [KNOWLEDGE:DEBUG] trigger_reason=<brief reason why you triggered>\\n\\nWhen dispatching knowledge-reader, ALSO output:\\n  [KNOWLEDGE:DEBUG] knowledge_reader_dispatched=true\\n  [KNOWLEDGE:DEBUG] hint=<priority hint sent to reader>\\n\\nThese debug lines MUST appear before any other content in your response."

    echo "{\"systemMessage\": \"$DEBUG_PREFIX\\n\\n$KNOWLEDGE_MSG\\n\\n$SKILL_ROUTER\"}"
else
    echo "{\"systemMessage\": \"$KNOWLEDGE_MSG\\n\\n$SKILL_ROUTER\"}"
fi
