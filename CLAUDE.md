# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Lorekeeper is a **Claude Code plugin** distributed via the Witan marketplace (`Mindful-Stack/witan`). It exposes the `/lore:*` slash commands, plus a SessionStart hook, several agents, and a set of skills that wire Claude into a separate "shared knowledge base" repo. The plugin itself is almost entirely markdown — commands, skills, and agents are markdown files that Claude reads as instructions. The only executable code is `hooks/load-standards-reminder.sh` and the scripts under `scripts/` (`init-detect.js`, `cultivate-detect.js`, and `migrate-manifest.js`).

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

Touch `.knowledge-debug` in the knowledge-repo root (or in this plugin root), or set `KNOWLEDGE_DEBUG=1`. The hook then injects extra `[KNOWLEDGE:DEBUG]` instructions into its model-facing `additionalContext` so the model prints what fired and which skill/agent it dispatched. Debug output relies on Claude following instructions, so it's reliable interactively but not in automated tests.

## Architecture

### Path resolution (the load-bearing detail)

`hooks/load-standards-reminder.sh` runs on `SessionStart` and resolves the knowledge base(s) in this priority order:

1. `.lorekeeper/config.json` in CWD — `{ "knowledgeBasePath": "..." }`, relative paths resolve against CWD (single KB)
2. `KNOWLEDGE_BASE_PATH` env var (single KB)
3. `household.json` walk-up — walk up from CWD (bounded to 6 levels) looking for a witan-household manifest. Reads `shared_knowledge_bases` (optional array of dir names, priority order lowest -> highest) plus `knowledge_base` (the team/write KB, default `lore`); each name resolves as `<household-root>/<name>` and must contain a `knowledge/` subdir. This is the only multi-KB tier.
4. Sibling-dir fallback — `./lore`, `./docs/lore`, `./docs/shared-knowledge`, `./shared-knowledge`, or `./knowledge` (must contain either a `knowledge/` subdir or `knowledge.config.json`)

Tiers 1 and 2 are explicit configuration: when set but broken, the hook surfaces the error instead of falling through.

It then:
- Checks git age in each knowledge repo and flags any older than `KNOWLEDGE_MAX_AGE_DAYS` (default 7)
- Nags about KBs listed in `household.json` that have no `knowledge/` directory
- Emits a single JSON object using **both** SessionStart output channels:
  - `hookSpecificOutput.additionalContext` (**model-visible, hidden from the user**) — one `Knowledge path:` line per KB (priority order, lowest first), the `Team knowledge path:` write-target line, the "Skill Router", and any model-facing instruction (e.g. the stale-KB update offer). This is the channel the model actually reads the markers from.
  - `systemMessage` (**user-visible, hidden from the model**) — a one-line human summary, the compact list of stale KBs, the missing-KB nag, and setup guidance when nothing resolves. No markers here; the user never needs to read paths.

The two channels are not interchangeable: `systemMessage` is shown to the user but withheld from Claude, while `additionalContext` is injected into Claude's context but not shown to the user. Put anything the *model* must read (markers, router, instructions) in `additionalContext`; put anything the *user* should see (warnings, summaries) in `systemMessage`. The output JSON is assembled by hand, so every interpolated path/name is passed through `json_escape` first — a stray quote or backslash in a path would otherwise produce invalid JSON and silently break the whole message.

Convention everywhere: **the last `Knowledge path:` line is the write target**, and the hook also emits the explicit `Team knowledge path:` marker for it. Multi-KB override semantics are whole-file replacement (a higher-priority KB's file fully replaces a lower-priority one at the same relative path — never section-level merging). Don't break either — skills/commands depend on them.

Commands and agents do not call this script directly. Instead, every command/agent markdown file says: *look for "Knowledge path:" markers in the session context and use them as `<knowledge-path>`*. The model substitutes the values at runtime. This is the only mechanism by which commands learn where the knowledge base is.

If you change the hook's output format, every `<knowledge-path>` consumer (every file under `commands/`, `agents/`, and `skills/`) is potentially affected.

### Zero-runtime principle

Other than the SessionStart hook and the init script, the plugin contains **no scripts**. Listing knowledge is `Glob` of a category directory. Searching is `Grep` — over frontmatter (`^(title|description|tags):`) to find nodes *about* a topic, over the body to find nodes that mention it. Loading is `Read`. If you find yourself wanting to add a Node script to support a command, first check whether the command can do the same thing with Claude's native tools.

There is deliberately **no build step and no generated catalogue**. Frontmatter is the catalogue: it is already line-anchored, already required on every node, and cannot fall out of date with the files it describes.

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

The plugin's `name` (in `.claude-plugin/plugin.json`) is `lore`, so slash commands are `/lore:` (e.g. `/lore:prime`, `/lore:review`). In Claude Code the command namespace is **always** the plugin `name` — there is no separate prefix field — so the `/lore:` prefix comes from `name`, not from the `commands/` filenames (which are short: `prime.md`, `review.md`). The **Lorekeeper** name/brand lives on in the GitHub repo (`Mindful-Stack/lorekeeper`) and the marketplace description; only the invocation handle (`lore@witan`, `/lore:`) is short.

## Version bumps are mandatory

Any PR that changes plugin contents — hooks, skills, agents, commands, scripts, manifests, even docs that ship inside the plugin — **must** bump the plugin's `version` field. The Claude Code updater compares manifest versions, not git SHAs: if the version doesn't move, `/plugin update lore@witan` short-circuits and every cached install keeps running the old code indefinitely.

Follow [semantic versioning](https://semver.org/):

- **PATCH** (`1.0.X`) — bug fixes, hook tweaks, doc-only changes inside the plugin, internal refactors. Anything backwards-compatible that users don't need to know about.
- **MINOR** (`1.X.0`) — new commands, new skills, new agents, additive options. Backwards-compatible new functionality.
- **MAJOR** (`X.0.0`) — breaking changes: renamed/removed commands, changed config or manifest schema, anything users will need to adjust for.

The version field appears in three manifests — keep them in sync, in the same PR as the change:

- `.claude-plugin/plugin.json` → `version`
- `package.json` → `version`
- `Mindful-Stack/witan` marketplace listing → the lorekeeper entry's `version` *(lives in the witan repo — this is the one the updater actually compares against, so a bump here needs a companion PR there)*

Don't defer the bump to a "release PR" later — by the time later comes, multiple changes are unreleased and cached installs are increasingly drifted. Bump in the same PR as the change, every time.

## Things to avoid

- Don't add team-specific content (no internal company URLs or names, no MyApp.* namespaces outside generic placeholders). This is a deliberate fork-with-fresh-history of an internal plugin, kept generic for public distribution. Use generic placeholders (`payments`, `inventory`, `user-management`).
- Don't hard-code domain lists or repo lists into commands. `/lore:prime` discovers domains by globbing `knowledge/domain/**/*.md`; `/lore:onboard` reads repos from `household.json`'s `repos` array (or legacy `repos_catalog` in the knowledge base's `knowledge.config.json`).
- Don't add Node scripts to commands unless there's no native-tools alternative — see "Zero-runtime principle".
- `docs/agent/`, `docs/plans/`, `docs/specs/` are gitignored — local-only artefacts. Don't reference them from committed files.
