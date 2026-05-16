# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Lorekeeper is a **Claude Code plugin** distributed via the Witan marketplace (`Mindful-Stack/witan`). It exposes the `/lore:*` slash commands, plus a SessionStart hook, several agents, and a set of skills that wire Claude into a separate "shared knowledge base" repo. The plugin itself is almost entirely markdown — commands, skills, and agents are markdown files that Claude reads as instructions. The only executable code is `hooks/load-standards-reminder.sh` and `scripts/init-detect.js`.

The knowledge base that the plugin reads is **not in this repo**. It lives at a separate path resolved at session start.

## Commands

### Plugin tests (Babashka)

Plugin-level scenario tests live in `test/` and exercise actual `claude --print` invocations:

```bash
bb test/run-tests.clj                          # run all scenarios
bb test/run-tests.clj --filter "command-help"  # filter by name substring
bb test/run-tests.clj --verbose                # show full output on failures
```

The test runner expects to find the lorekeeper checkout and a knowledge-base checkout as siblings under a shared workspace root (it derives `workspace-root` from `lorekeeper/test/../..`). Tests pass plugin context implicitly because they run from that workspace root.

### Init-script tests (Node)

```bash
node --test scripts/__tests__/*.test.js
```

These cover `scripts/init-detect.js` — CWD-state classification for `/lore:init` dispatch (8 test cases).

### Debug mode for the SessionStart hook

Touch `.knowledge-debug` in the knowledge-repo root (or in this plugin root), or set `KNOWLEDGE_DEBUG=1`. The hook then injects extra `[KNOWLEDGE:DEBUG]` instructions in its systemMessage so the model prints what fired and which skill/agent it dispatched. Debug output relies on Claude following instructions, so it's reliable interactively but not in automated tests.

## Architecture

### Path resolution (the load-bearing detail)

`hooks/load-standards-reminder.sh` runs on `SessionStart` and resolves the knowledge-base path in this priority order:

1. `.lorekeeper/config.json` in CWD — `{ "knowledgeBasePath": "..." }`, relative paths resolve against CWD
2. `KNOWLEDGE_BASE_PATH` env var
3. Sibling-dir fallback — `./docs/shared-knowledge`, `./shared-knowledge`, or `./knowledge` (must contain either a `knowledge/` subdir or `knowledge.config.json`)

It then:
- Verifies the path exists and has a `knowledge/` subdirectory
- Checks git age in the knowledge repo and warns if older than `KNOWLEDGE_MAX_AGE_DAYS` (default 7)
- Emits a JSON `systemMessage` containing the resolved path **plus** the "Skill Router" — a block telling the model which skill to use for which kind of task

Commands and agents do not call this script directly. Instead, every command/agent markdown file says: *look for "Knowledge path:" in the session context and use that as `<knowledge-path>`*. The model substitutes the value at runtime. This is the only mechanism by which commands learn where the knowledge base is.

If you change the hook's output format, every `<knowledge-path>` consumer (every file under `commands/`, `agents/`, and `skills/`) is potentially affected.

### Zero-runtime principle

Other than the SessionStart hook and the init script, the plugin contains **no scripts**. Listing knowledge is `Read` of `_index.json`. Searching is `Grep`. Loading is `Read`. If you find yourself wanting to add a Node script to support a command, first check whether the command can do the same thing with Claude's native tools.

### Layer priority for knowledge

Whenever multiple knowledge sources address the same topic, the agreed priority (encoded in `agents/knowledge-reader/AGENT.md`, `agents/knowledge-question-answerer/AGENT.md`, and `skills/review/SKILL.md`) is:

1. Repo-specific `docs/standards/` (highest)
2. Verified learnings (`learnings/` with `confidence: verified`)
3. Domain
4. Framework
5. Language
6. General (lowest)

Hypothesis-confidence learnings never override; they're supplementary.

### Skill router vs. user-installed superpowers

The SessionStart hook's systemMessage names skills like `pattern-identifier`, `brainstorming`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `executing-plans`, `writing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `knowledge-update`, and `review`. The first two (`pattern-identifier`, `knowledge-update`) and `review` are this plugin's own; the rest are bundled copies of the **superpowers** workflow skills under `skills/`. They have separate identities from the user-level superpowers skills with the same names — treat them as the plugin's own copies and edit them here. (If the user-level superpowers skills evolve, those changes are not automatically reflected here.)

### Slash-command namespace

The plugin's full name is `lorekeeper` but slash commands use the short `/lore:` prefix (e.g. `/lore:prime`, `/lore:review`). When wiring new commands, file names under `commands/` are short (`prime.md`, `review.md`) — the `/lore:` prefix comes from the plugin manifest, not the filenames.

## Things to avoid

- Don't add team-specific content (no Ramudden URLs, no MyApp.* namespaces outside generic placeholders). This is a deliberate fork-with-fresh-history of an internal plugin, kept generic for public distribution. Use generic placeholders (`payments`, `inventory`, `user-management`).
- Don't hard-code domain lists or repo lists into commands. `/lore:prime` discovers domains from `_index.json`; `/lore:onboard` requires `repos_catalog` in the knowledge base's `knowledge.config.json`.
- Don't add Node scripts to commands unless there's no native-tools alternative — see "Zero-runtime principle".
- `docs/agent/`, `docs/plans/`, `docs/specs/` are gitignored — local-only artefacts. Don't reference them from committed files.
