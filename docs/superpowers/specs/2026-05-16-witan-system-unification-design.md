# Witan System Unification

**Status:** Design (2026-05-16)
**Affects:** `Mindful-Stack/lorekeeper`, `Mindful-Stack/witan-household`, indirectly the in-flight `Daniel-Thyselius/reeve` M3.5 implementation.

## Context

The witan system spans three Mindful-Stack repos with overlapping responsibilities:

- **`witan`** — Claude Code plugin marketplace (no code; plugin metadata).
- **`lorekeeper`** — the plugin itself: SessionStart hook, slash commands (`/lore:*`), agents, skills.
- **`witan-household`** — GitHub template for the workspace shape (manifest + devcontainer + inline lore + CLAUDE.md).

After M3.5 lands the workspace-as-meta-repo pattern in Reeve, several rough edges remain across the system:

1. Lorekeeper ships **two** scaffolding paths — the bundled `templates/knowledge-base/` (standalone KB repo, scaffolded by `/lore:init`) and the external `witan-household` template (full workspace). They overlap; drift is guaranteed.
2. The witan-household template ships `lore/` content but no tooling — every team rewrites the same `jq | xargs git clone` bootstrap.
3. Lorekeeper installation inside Reeve cards is documented as opt-in in the devcontainer.json starter, even though almost every Reeve user wants it.
4. There is no single canonical "adopt witan in my existing project" command. Retrofit users are left to manual instructions.
5. The manifest filename `repos.json` is a misnomer — the file describes the whole workspace, not just its repos.
6. The split between an inline KB and a separate KB sibling is a real choice users have to make, but no tooling supports the transition.

This spec unifies the system around a single canonical adoption path with `/lore:init` as the entry point, consolidates scaffolding on the witan-household template, and applies a cluster of quality-of-life improvements.

## Summary

Post-unification, the user-visible surface is:

- **One template repo** (`Mindful-Stack/witan-household`), tool-agnostic enough to use with or without Reeve, ship-ready out of the box with inline lore + bootstrap tooling + Lorekeeper installed in the container by default.
- **One scaffolding command** (`/lore:init`) that detects the user's CWD state and dispatches to the right setup: greenfield, single-repo retrofit, post-template finalization, or poly-repo retrofit.
- **One manifest filename** (`household.json`) that names what the file actually describes.
- **One promotion path** (`make split-lore`) when an inline KB outgrows the meta-repo and needs to become a sibling repo with its own history.
- **One diagnostic command** (`/lore:doctor`) for KB and workspace hygiene.

Lorekeeper's bundled `templates/knowledge-base/` directory is removed; the canonical Lorekeeper setup is "use witan-household, optionally split the lore later."

## Architecture

### Manifest rename: `repos.json` → `household.json`

The file at the workspace meta-repo root that declares `workspace`, `knowledge_base`, and `repos[]` is renamed.

**Affected files:**
- `Mindful-Stack/witan-household/repos.json` → `household.json` (rename in template; bump README, scripts).
- `Mindful-Stack/lorekeeper/hooks/load-standards-reminder.sh` — no change (the hook doesn't read the manifest directly; only the plugin's commands and Reeve's daemon do).
- `Mindful-Stack/lorekeeper/commands/*.md` — none directly reference the filename (they say "the manifest" or rely on the SessionStart resolved path); audit and update any literal references.
- **Reeve M3.5 spec + plan + in-flight implementation** — all references to `repos.json` switch to `household.json`. Coordination with the M3.5-implementing agent is required (see Coordination section).

**Compatibility:** no fallback. The transition is a single hard rename across all three repos plus the in-flight implementation. The system is young enough that a hard cutover costs less than a dual-read loader.

### `witan-household` template overhaul

#### Default-on Lorekeeper install in `devcontainer.json`

Current starter ships `postCreateCommand` with the marketplace + plugin install commented out. New starter has them uncommented and split into separate commands (fail-fast):

```jsonc
{
  "name": "witan-household",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {}
  },
  "postCreateCommand": [
    "curl -fsSL https://claude.ai/install.sh | bash",
    // To use a different marketplace, replace 'Mindful-Stack/witan' below.
    "claude plugin marketplace add Mindful-Stack/witan",
    "claude plugin install lorekeeper@witan"
  ],
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

Three separate commands; any failing aborts container creation with a clear error. Users who don't want Lorekeeper remove the last two entries.

#### Bootstrap tooling — `Makefile` + `scripts/`

Faithful port of the gp-workspace bootstrap with ramudden-specifics stripped. Shipped files:

- `Makefile` — targets for setup, pull, status, split-lore, rename, build-index, validate, doctor (some delegate to lore tooling).
- `scripts/setup.sh` — Node-based manifest parser (no jq dep). Flags: `--repos=name1,name2`, `--tag=foo`. Default: clone every entry with a `url`, excluding the workspace entry. Drops the ramudden `--core` flag (no `core` tag convention) and drops the env-var-writing step (witan-household uses sibling-fallback, not env vars).
- `scripts/pull-all.sh` — `git fetch --prune` everywhere, ff-pull each sibling that's on a clean main.
- `scripts/status-all.sh` — one-line `git status` summary per sibling.

The `Makefile` exposes these as discoverable targets:

```makefile
help:    ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup:   ## Clone every sibling declared in household.json
	@./scripts/setup.sh

pull:    ## Fetch all siblings; ff-pull if on clean main
	@./scripts/pull-all.sh

status:  ## One-line git status per sibling
	@./scripts/status-all.sh

split-lore: ## Promote the inline `lore/` to its own sibling repo (interactive; pass REMOTE=<url> to skip prompt)
	@./scripts/split-lore.sh "$(REMOTE)"

build-index: ## Rebuild lore/_index.json
	@node lore/_tools/cli.js build-index

validate: ## Run KB validators (frontmatter, links, orphans)
	@node lore/_tools/cli.js validate

doctor:  ## Run /lore:doctor checks via CLI (without Claude Code)
	@node lore/_tools/cli.js doctor
```

#### Bootstrap manifest parsing without jq

`scripts/setup.sh` uses Node to parse `household.json` rather than depending on `jq`:

```bash
parse_manifest() {
    node -e "
        const m = require('$MANIFEST');
        const tag = '$1';
        const repos = '$2'.split(',').filter(Boolean);
        let result = m.repos.filter(r => r.name !== m.workspace && r.url);
        if (tag)         result = result.filter(r => (r.tags || []).includes(tag));
        if (repos.length) result = result.filter(r => repos.includes(r.name));
        result.forEach(r => console.log(r.name + ' ' + r.url));
    "
}
```

Node is already a dependency for `lore/_tools/`; no new install requirement.

#### `make split-lore` — flexible destination

The `split-lore` target prompts interactively if `REMOTE=` is not provided:

```
$ make split-lore
Inline `lore/` is currently tracked in this workspace's git history.
Where should the extracted lore repo's `origin` point?

  [1] local-only (no remote; you'll set one up later)
  [2] create a new GitHub repo via `gh repo create` (requires gh CLI)
  [3] paste a remote URL I already have
  [q] cancel

Choice:
```

For option `[2]`, prompts for visibility (public/private) and target org. For option `[3]`, prompts for the URL. Either way, the actual mechanics:

1. **Preserve lore content out-of-band:** `cp -r lore lore.split-backup` (or `mv lore lore.split-backup` if the script is willing to be slightly slower on re-copy; copy is safer if step 2 fails).
2. **Remove from workspace history:** `rm -rf lore && git add -A && git commit -m "split: remove inline lore"`.
3. **Restore content as a fresh sibling repo:** `mv lore.split-backup lore && cd lore && git init -b main && git add -A && git commit -m "initial lore"`.
4. **Optional remote:** if a remote URL was chosen (option 2 or 3), `git remote add origin <url> && git push -u origin main`.
5. **Update parent `.gitignore`:** remove the `!/lore/` allowlist line so the now-sibling `lore/` directory is gitignored from the workspace (the catch-all `/*` rule handles it).
6. **Update parent `household.json`:** if a remote was added, set `"url": "<url>"` on the lore entry.
7. **Commit parent changes:** `git add .gitignore household.json && git commit -m "split: lore is now a sibling repo"`.

The script preserves the lore's working content; only its git history changes (becomes a fresh `git init` rather than rolling out of the parent's history). For users who need git-history extraction across the split, the spec defers to a documented `git filter-repo` manual procedure — not worth scripting for an edge case.

#### Bundled KB tooling under `lore/_tools/`

The standalone `lorekeeper/templates/knowledge-base/src/` tooling (build-index.js, validate-frontmatter.js, validate-links.js, check-orphans.js, cli.js) moves into the witan-household template at `lore/_tools/`. Self-contained: when the user splits the lore into its own repo, the tooling travels with it.

The CLI entrypoint becomes `node lore/_tools/cli.js <subcommand>`. Subcommands: `build-index`, `validate`, `check-orphans`, `doctor` (new — see `/lore:doctor` below).

A `lore/_tools/package.json` declares zero runtime dependencies and a single dev dependency for tests (`node:test`). No `node_modules` shipped; Node's stdlib is sufficient.

When the lore splits via `make split-lore`, the `_tools/` dir moves with it. The split lore repo gets its own `Makefile` with `build-index`, `validate`, `doctor` targets (a smaller version of the workspace Makefile).

#### Starter content — one worked example per `_starter.md`

Each `lore/knowledge/{general,domain,frameworks,languages,learnings}/_starter.md` ships as a concrete realistic example:

- `general/_starter.md` — a pr-guidelines node: frontmatter with `title`, `description`, `tags: ["general", "code-review"]`; body covers commit-message format, PR title length, "what to include in PR description." Realistic for any project; demonstrates frontmatter shape.
- `domain/_starter.md` — a placeholder bounded-context node demonstrating the DDD shape: Purpose, Key Entities, Ubiquitous Language, Integration Points, Key Workflows. Generic name like "user-management" so users replace the body, not the structure.
- `frameworks/_starter.md` — a worked example like "react/component-conventions" demonstrating a wikilink (`[[general/pr-guidelines]]`) so users see cross-referencing.
- `languages/_starter.md` — a "typescript/code-style" worked example with frontmatter + a short bullet list of conventions.
- `learnings/_starter.md` — a learning with `confidence: verified`, `source: developer-input`, `date:` and a concrete-feeling body (e.g., "library X behaves unexpectedly when ..."). Demonstrates the learning frontmatter shape.

Each file is 30-50 lines: enough to teach by example, generic enough not to need editing for content (only structure).

#### README — adoption scenarios section

The witan-household template's `README.md` gains a dedicated "Adopting witan in an existing project" section after the quickstart, walking through:

- Scenario 1: greenfield — use the GitHub template button or `/lore:init`
- Scenario 2: existing single-repo, no KB — run `/lore:init` from inside the existing project
- Scenario 3: existing single-repo with `docs/` or `knowledge/` — run `/lore:init`; it'll offer to rename or set up an override
- Scenario 4: existing poly-repo at a parent directory — run `/lore:init`; it'll detect sibling git repos and offer to wrap them
- Scenario 5: poly-repo + existing separate KB — same as 4 plus `mv` the KB into the workspace

Each scenario gets ~5 lines + the canonical `/lore:init` invocation.

A second section, "Two-install reality," briefly notes that Lorekeeper is installed in two distinct contexts: once on the host (for direct CC use outside Reeve cards) and once inside each Reeve card via the template's `postCreateCommand`. Same plugin, two install paths, both deliberate.

### Lorekeeper plugin changes

#### `/lore:init` becomes smart

The command detects the CWD state and dispatches. State table:

| CWD state | `/lore:init` action |
|---|---|
| Empty or non-existent | Greenfield scaffold: copy witan-household template content into CWD, run substitution for workspace name, `git init`, initial commit |
| Files but no `.git` | Prompt: "Make this a workspace?" If yes, scaffold workspace files alongside existing files; `git init`; initial commit |
| Git repo, no `household.json`, no `lore/` | Single-repo retrofit: scaffold workspace files in place; preserve existing files; offer to commit |
| Git repo with `docs/` or `knowledge/` dir | Migration: ask "I see existing docs at `<path>`. Rename to `lore/knowledge/`, or set up an override via `KNOWLEDGE_BASE_PATH`?" |
| Multiple sibling `.git` dirs at CWD (parent of git repos) | Poly-repo retrofit: list detected repos; ask "Wrap these N repos in a workspace meta-repo?" If yes, scaffold workspace files at CWD, populate `household.json` with the detected repos as siblings, `git init` the workspace, initial commit |
| Already has `household.json` | "This is already a workspace. Run `/lore:help` for status." |

Implementation lives mostly in `commands/init.md` and a new helper script. The command instructs Claude to:

1. Detect state via `Glob`, `Read`, and `Bash` (for `git status`).
2. Prompt the user (via `AskUserQuestion`) to confirm the detected scenario.
3. Run the corresponding actions via `Bash` (cp, mv, git init/add/commit).
4. Substitute the workspace name (defaulting to the directory basename) into `household.json` and `CLAUDE.md`.
5. Report what was done.

The existing `init-knowledge-base.js` script is removed; its scaffolding role is subsumed by `/lore:init`. The standalone-KB template directory `lorekeeper/templates/knowledge-base/` is deleted entirely.

Scenario-specific details:

- **Greenfield/single-repo retrofit:** Copies template content into the target directory. Source choice (bundled snapshot in the plugin vs live `git clone --depth=1` from the GitHub template, with `.git/` stripped) is deferred to writing-plans — see Open items.
- **Poly-repo retrofit:** Detects siblings via `find . -maxdepth 2 -name .git -type d` (or equivalent), excludes any candidates the user has rejected via `AskUserQuestion`. The detected repo names become `household.json`'s `repos[]` entries; siblings stay in place (no moves). The new workspace `.git/` is initialized at CWD.
- **Safety: refuse poly-repo retrofit in common dump directories.** Running `/lore:init` from `$HOME` or `$HOME/Source` (or other directories that look like generic "drop your projects here" parents) is almost always accidental. Detection: if CWD has more than ~10 git repos at depth 2, prompt extra-carefully ("This directory has N git repos. Wrapping ALL of them in a single workspace is unusual. Continue?"). If CWD is `$HOME` or `$HOME/Source`, refuse outright with a message suggesting the user `mkdir my-workspace && cd my-workspace && /lore:init` instead.
- **Existing docs migration:** If the existing dir is named `docs/`, `knowledge/`, or `wiki/`, offer to rename to `lore/knowledge/` (with auto-creation of `lore/_tools/` etc.). Otherwise, walk the user through setting `KNOWLEDGE_BASE_PATH` or writing `.lorekeeper/config.json`.

#### `/lore:doctor` — new command

A full diagnostic command. Workspace + KB hygiene in one report:

```
$ /lore:doctor

Workspace
  ✓ household.json parses
  ✓ workspace entry exists in repos[]
  ✓ knowledge_base = "lore" matches an entry in repos[]
  ✓ All declared siblings present on host

Lore
  ✗ _index.json is stale (older than 12 files)
    → Run `make build-index` or `node lore/_tools/cli.js build-index`
  ✗ Broken wikilink in `lore/knowledge/domain/payments.md:42`
    → [[user-management]] does not match any node
  ⚠ 2 orphan files (no incoming wikilinks, not prefixed `_`):
    - lore/knowledge/frameworks/react/old-patterns.md
    - lore/knowledge/learnings/2024-01-15-some-learning.md
  ✓ All frontmatter valid (38 nodes checked)

Summary: 1 error, 2 warnings.
```

Implementation: `commands/doctor.md` instructs Claude to invoke `node lore/_tools/cli.js doctor` via `Bash` and render the output. The CLI tool implements the checks; the slash command is a thin wrapper.

The checks:

1. **Workspace validity** — `household.json` parses; `workspace` pointer resolves; `knowledge_base` pointer (if set) resolves; reserved-name validation; declared siblings exist on disk (sibling, inline, or — with a warning — missing).
2. **Index staleness** — `_index.json` exists and is newer than the newest `.md` in `lore/knowledge/`.
3. **Frontmatter validity** — every node has the required fields (`title`, `description`, `tags`); types match (tags is array, etc.).
4. **Broken wikilinks** — every `[[link]]` resolves to a node in `lore/knowledge/`.
5. **Orphans** — files with no incoming wikilinks AND not prefixed with `_` (which are entry points by convention).

User-triggered only. No auto-invocation from SessionStart.

#### Hook: extend sibling-fallback to `./lore` (DONE)

This was done in commit `bc4cf04` already pushed to `Mindful-Stack/lorekeeper`. No further change.

#### Removed: `lorekeeper/scripts/init-knowledge-base.js` and `lorekeeper/templates/knowledge-base/`

The standalone-KB scaffolding is gone. `/lore:init`'s greenfield path uses the witan-household template; `/lore:init`'s retrofit paths handle every other case.

Migration story for users with existing standalone-KB-shaped knowledge bases: their KBs continue to work via sibling-fallback (the legacy directory names `shared-knowledge` and `knowledge` are retained in the fallback list). They just won't get the workspace pattern's bootstrap tooling unless they migrate.

### Reeve coordination

The M3.5 implementation in `Daniel-Thyselius/reeve` is mid-flight when this spec lands. Two concrete couplings:

1. **`repos.json` → `household.json` rename.** Reeve M3.5's `manifest.rs` reads `repos.json`. The rename has to flow into Reeve's code. If the M3.5 agent has already merged with `repos.json` hard-coded, a follow-up PR renames there. If still in-flight, they should land with `household.json` directly.

2. **`reeve household new` uses the template.** The handler clones the witan-household template repo; after this spec's changes, the template's `repos.json` becomes `household.json`. Reeve's template-substitution logic (renaming the workspace entry) must update accordingly.

Both are tracked in the implementation plan's coordination section.

## Testing

### Witan-household template

- `scripts/setup.sh` unit tests (node `--test`): manifest parsing handles the workspace-name exclusion correctly; `--repos=` filter works; `--tag=` filter works; missing `url` entries are skipped.
- `scripts/split-lore.sh` integration test in a tempdir: starting from a workspace with inline lore, run the script with `REMOTE=local-only`, assert the lore is now a separate git repo, parent's `household.json` updated.
- `lore/_tools/cli.js` tests: each subcommand (`build-index`, `validate`, `doctor`) has unit tests for the success and failure cases.

### Lorekeeper plugin

- `/lore:init` test scenarios (manual smoke against tempdir checkpoints):
  - Greenfield: empty tempdir, run /lore:init, assert workspace structure landed.
  - Single-repo retrofit: tempdir with `.git/` + a `src/` dir, run /lore:init, assert workspace files added without disturbing src/.
  - Poly-repo retrofit: tempdir with two child git repos, run /lore:init, assert workspace .git initialized at parent + household.json declares both siblings.
  - Existing docs migration: tempdir with `.git/` + `docs/`, run /lore:init, accept rename, assert docs/ became lore/knowledge/.
  - Already-a-workspace: tempdir with existing household.json, run /lore:init, assert refusal + helpful message.
- `/lore:doctor` smoke: invoke against the witan-household template's starter state, assert exit-zero (no issues); intentionally break a wikilink, re-run, assert the broken-link error is reported.

The existing `test/run-tests.clj` Babashka harness gets new scenarios; `scenarios.edn` grows new entries.

## Open items deferred to writing-plans

- Exact wording of `/lore:init`'s interactive prompts. Prompt copy is its own UX micro-design.
- Whether `make rename NAME=foo` becomes a discoverable target alongside the `/lore:init`-driven flow, given that `/lore:init` already substitutes during scaffolding. Lean: skip (already decided).
- Whether the `lore/_tools/` Makefile is part of the witan-household template or generated by `/lore:init` at scaffold time. Lean: shipped in the template; copied verbatim into split-out lore repos.
- Whether the witan-household template ships its existing `_tools/` from day one or whether we hold the template at its current shape until lorekeeper's PR is ready. Lean: land the template changes first since they're additive; lorekeeper changes follow.
- Test infrastructure for the witan-household template — Node `--test` for the .mjs/.js scripts; what about the shell scripts? Use `bats` or hand-rolled bash assertions? Lean: hand-rolled bash for the shell scripts, Node `--test` for everything else.
- Snapshot vs live-clone for `/lore:init`'s greenfield path (offline-friendliness vs always-fresh).
- Whether `/lore:doctor` should write a machine-readable JSON report (for CI integration) in addition to its human-readable output.

## Out of scope (do not implement here)

- Pruning of namespaced refs in Reeve (`refs/reeve/<id>/*`) — M4 follow-up, separate concern.
- `/lore:doctor` running automatically at SessionStart or before mutations — user-triggered only.
- `REEVE_CARD_ID` detection in the hook — Reeve injects its own card context.
- Bootstrap-tooling alternatives (`just`, `task`, `bin/` scripts) — Make is the default; users override if they want.
- A separate `Mindful-Stack/witan-lore` template for the KB-as-standalone-repo case — handled by `make split-lore` from an inline KB instead.
- Renaming `Mindful-Stack/witan-household` to `lorekeeper-workspace` — keep the current name.
- Long-term merging of Reeve and Lorekeeper — explicitly out of scope.
- Cross-host secret management for households — each user's devcontainer.json handles its own secrets.

## Verification

A merged unification must:

1. Pass all existing Lorekeeper tests (Babashka scenarios + the init-knowledge-base.test.js scenarios that survive the script's removal; most will be deleted).
2. Pass new Lorekeeper tests: /lore:init across all 5 scenarios; /lore:doctor against a healthy and a broken workspace.
3. Pass new witan-household template tests: setup.sh, split-lore.sh, lore/_tools/cli.js subcommands.
4. The witan-household template's `repos.json` is renamed to `household.json` on the `main` branch of `Mindful-Stack/witan-household`.
5. `lorekeeper/templates/knowledge-base/` and `lorekeeper/scripts/init-knowledge-base.js` (and the associated test file) are deleted from `Mindful-Stack/lorekeeper`'s `main` branch.
6. The Reeve M3.5 spec, plan, and implementation reference `household.json`, not `repos.json`.
7. Manual smoke from each of the five adoption scenarios:
   - Greenfield: `mkdir my-ws && cd my-ws && /lore:init` → working workspace.
   - Single-repo retrofit: existing project, `/lore:init` → workspace files added, existing code untouched.
   - Poly-repo retrofit: parent dir of multiple git repos, `/lore:init` → meta-repo wraps them.
   - Existing docs migration: existing project with `docs/`, `/lore:init` → rename path completes.
   - Split-lore: workspace with inline lore, `make split-lore` (each of the three destination modes) → lore becomes a sibling.
8. `/lore:doctor` is callable from inside a workspace; reports green for a freshly-scaffolded workspace; reports the seeded errors when nodes are intentionally broken.
9. Lorekeeper's `README.md` leads with the witan-household pattern; legacy `KNOWLEDGE_BASE_PATH` + `.lorekeeper/config.json` paths are demoted to "if you have a non-standard setup."
