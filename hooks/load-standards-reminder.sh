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
SKILL_ROUTER='Lorekeeper Skill Router:\n\nWhen working in projects with a configured knowledge base, use the RIGHT skill for the task:\n\n- QUESTIONS about patterns/conventions/standards (\"How do we handle X?\", \"What'\''s our pattern for Y?\", \"Do we use X?\")\n  -> Use the pattern-identifier skill (docs-first via knowledge-question-answerer agent)\n\n- CREATIVE WORK (features, components, new functionality)\n  -> Use the brainstorming skill (design before code, always)\n\n- MULTI-STEP TASKS with spec/requirements\n  -> Use the writing-plans skill (task breakdown before implementation)\n\n- EXECUTING a written plan\n  -> Use the executing-plans skill (batch execution with checkpoints)\n\n- IMPLEMENTING any feature or bugfix\n  -> Use the test-driven-development skill (RED-GREEN-REFACTOR, default for all work)\n\n- BUG, TEST FAILURE, or UNEXPECTED BEHAVIOR\n  -> Use the systematic-debugging skill (4-phase root cause methodology)\n\n- CLAIMING WORK IS COMPLETE or FIXED\n  -> Use the verification-before-completion skill (evidence before claims, always)\n\n- INDEPENDENT TASKS from a plan\n  -> Use the subagent-driven-development skill (coordinated plan execution)\n\n- MULTIPLE INDEPENDENT PROBLEMS (e.g., unrelated test failures)\n  -> Use the dispatching-parallel-agents skill (ad-hoc parallel work)\n\n- LOADING DOMAIN CONTEXT manually\n  -> Use /lore:prime <domain>\n\n- CODE REVIEW or PR review\n  -> Use the review skill or /lore:review command\n\n- MISSING or OUTDATED documentation noticed\n  -> Use the knowledge-update skill or /lore:update command\n\nIf there is even a small chance a skill applies, invoke it before responding.\nCommon rationalizations for skipping (\"this is simple\", \"let me explore first\",\n\"I already know this\") are not valid reasons to bypass skills.\n\nIf you are about to write or modify code and no workflow skill has been invoked,\ndispatch knowledge-reader with the task context before proceeding.\n\nPriority: User instructions > Plugin skills > Default system prompt.\n\nStandards Loading Order: Knowledge base (general -> language -> framework -> domain)\nTHEN repo-local standards (docs/standards/). Repo-specific standards take precedence\nwhen they conflict.'

# --- Resolve knowledge path ---
KNOWLEDGE_MSG=""

if [ -z "${KNOWLEDGE_BASE_PATH:-}" ]; then
    KNOWLEDGE_MSG='KNOWLEDGE_BASE_PATH is NOT set.\n\nTo use the lorekeeper plugin, set the KNOWLEDGE_BASE_PATH environment variable to the absolute path of your knowledge base repo clone, then restart Claude Code.\n\nExample:\n  export KNOWLEDGE_BASE_PATH=\"/path/to/your/knowledge-base\"\n\nAll /lore:* commands will show setup instructions until this is configured.'
else
    # Normalize path: convert backslashes to forward slashes
    KNOWLEDGE_ROOT="${KNOWLEDGE_BASE_PATH//\\//}"

    # Validate path exists
    if [ ! -d "$KNOWLEDGE_ROOT" ]; then
        KNOWLEDGE_MSG="KNOWLEDGE_BASE_PATH is set to \"$KNOWLEDGE_ROOT\" but the directory does not exist.\n\nPlease verify the path and restart Claude Code."
    elif [ ! -d "$KNOWLEDGE_ROOT/knowledge" ]; then
        KNOWLEDGE_MSG="KNOWLEDGE_BASE_PATH is set to \"$KNOWLEDGE_ROOT\" but no knowledge/ subdirectory was found.\n\nExpected: $KNOWLEDGE_ROOT/knowledge/\n\nPlease verify this is the knowledge base repo root."
    else
        KNOWLEDGE_PATH="$KNOWLEDGE_ROOT/knowledge"

        # Check staleness via git
        STALENESS_WARNING=""
        if command -v git &>/dev/null && [ -d "$KNOWLEDGE_ROOT/.git" ]; then
            LAST_COMMIT_TS=$(git -C "$KNOWLEDGE_ROOT" log -1 --format=%ct 2>/dev/null || echo "")
            if [ -n "$LAST_COMMIT_TS" ]; then
                NOW_TS=$(date +%s)
                AGE_DAYS=$(( (NOW_TS - LAST_COMMIT_TS) / 86400 ))
                if [ "$AGE_DAYS" -ge "$KNOWLEDGE_MAX_AGE_DAYS" ]; then
                    STALENESS_WARNING="\\n\\nWARNING: Knowledge base may be stale (last updated $AGE_DAYS days ago). Consider pulling latest: cd $KNOWLEDGE_ROOT && git pull"
                fi
            fi
        fi

        KNOWLEDGE_MSG="Knowledge base: $KNOWLEDGE_ROOT\\nKnowledge path: $KNOWLEDGE_PATH/$STALENESS_WARNING"
    fi
fi

# --- Output ---
if [ "$DEBUG_MODE" = "true" ]; then
    # Build debug prefix
    DEBUG_PREFIX="LOREKEEPER DEBUG MODE ENABLED.\\n\\nYou MUST output these debug lines at the START of your response:\\n\\n[KNOWLEDGE:DEBUG] hook_fired=SessionStart\\n[KNOWLEDGE:DEBUG] knowledge_env=\${KNOWLEDGE_BASE_PATH:-<not set>}\\n\\nThen, when executing any /lore:* command, ALSO output:\\n  [KNOWLEDGE:DEBUG] command=<command-name>\\n\\nWhen a workflow skill triggers, ALSO output:\\n  [KNOWLEDGE:DEBUG] skill_triggered=<skill-name>\\n  [KNOWLEDGE:DEBUG] trigger_reason=<brief reason why you triggered>\\n\\nWhen dispatching knowledge-reader, ALSO output:\\n  [KNOWLEDGE:DEBUG] knowledge_reader_dispatched=true\\n  [KNOWLEDGE:DEBUG] hint=<priority hint sent to reader>\\n\\nThese debug lines MUST appear before any other content in your response."

    echo "{\"systemMessage\": \"$DEBUG_PREFIX\\n\\n$KNOWLEDGE_MSG\\n\\n$SKILL_ROUTER\"}"
else
    echo "{\"systemMessage\": \"$KNOWLEDGE_MSG\\n\\n$SKILL_ROUTER\"}"
fi
