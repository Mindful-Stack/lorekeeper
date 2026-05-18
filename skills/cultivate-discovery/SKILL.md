---
name: cultivate-discovery
description: Discover candidate bounded contexts in a witan-household's codebase and audit existing domain nodes. Use when the user invokes /lore:cultivate with no argument, or when they ask "what domains does this project have?" or "help me find bounded contexts" or similar exploratory DDD questions in a witan-household with code repos.
---

# Cultivate — Discovery

Survey a witan-household: discover candidate bounded contexts from the codebase, audit existing domain nodes, let the user prioritize 0-3 items, then chain the `cultivate` skill once per pick.

## Implementation

### Step 1: Pre-flight via `cultivate-detect.js --survey`

Use the Bash tool:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/cultivate-detect.js --survey
```

Parse the JSON output. Two shapes:

- `{ error: "...", message: "..." }` — bail. Print the message; suggest `/lore:doctor` for diagnostics. Do not proceed.
- `{ mode: "survey", context: {...} }` — proceed. The `context` has: `workspace_root`, `kb_root`, `code_repos`, `existing_domains` (array of `{ name, file_path, missing_sections }`).

### Step 2: Codebase scan

For each repo in `context.code_repos`:

- Use Glob to find source files: `**/*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` (cap at the first 500 files per repo to bound token usage).
- Use Grep for class/struct/type/interface declarations. Patterns:
  - TypeScript/JS: `^(export\s+)?(class|interface|type)\s+(\w+)`
  - Rust: `^(pub\s+)?(struct|enum|trait)\s+(\w+)`
  - Python: `^class\s+(\w+)`
  - Go: `^type\s+(\w+)\s+(struct|interface)`
  - C#/Java/Kotlin: `^(public\s+)?(class|interface|record|enum)\s+(\w+)`
- Sample top-2 levels of directory structure to understand the repo's organisation.

Aggregate into a frequency-ranked list of identifiers per repo, grouped by their directory location.

### Step 3: Existing-node audit

For each entry in `context.existing_domains`:

- The detect script already computed `missing_sections`.
- Additionally check (Claude inspects the file content from `<workspace_root>/<file_path>`):
  - **Drift signals**: terms appearing frequently in `context.code_repos` source files but NOT in the doc's `## Ubiquitous Language` section.
  - **Stale activity**: files matching the domain's slug in code paths changed in the last 30 days while the doc itself wasn't touched (compare `git log --since="30 days ago"` on code paths vs the doc's last commit).
  - **Dead wikilinks**: `[[wikilink]]` references in the doc that don't resolve to existing nodes anywhere under `<kb_root>`.

Aggregate findings per existing domain.

### Step 4: Claude judgment — propose candidate contexts

With the scan + audit signals in mind, propose **candidate bounded contexts** that the codebase suggests but the KB doesn't have. Use pattern recognition:

- **Directory clustering**: a single subdirectory housing many related types (e.g. `portal/src/grants/*` with `Grant`, `GrantApplication`, `Eligibility`, ... → candidate "grants" context).
- **Naming clustering**: types sharing a prefix or thematic keyword across files (e.g. all `*Match*` types → candidate "matching" context).
- **Import topology**: clusters of modules that import each other tightly while having few imports across the cluster boundary.

For each candidate, capture:
- A proposed name (kebab-case slug suitable for `domain/<name>.md`).
- The strongest evidence: 1-2 lines (e.g. "12 entity declarations in `portal/src/grants/`").
- A one-sentence rationale.

Cap displayed candidates at 10. If more were detected, mention the cap in the survey output.

### Step 5: Render sectioned survey

Print the survey as inline markdown:

```
## New candidate domains (N found)

- **<slug>** — <evidence>; rationale: <one sentence>.
- ...

## Existing domains with findings (M total)

- **<name>** — missing sections: <list or "none">; drift signals: <list or "none">.
- ...

## Healthy domains (K total)

<comma-separated names of existing domains with no findings, or skip section if K = 0 or list is overwhelming>
```

If both N and M are zero, print:

> Your KB looks healthy; nothing to surface today.

And exit (do not run Step 6 or 7).

### Step 6: Prioritize via AskUserQuestion

Use AskUserQuestion with `multiSelect: true` and a hard cap of 3 selections:

> "Which items do you want to act on now? (Pick 0-3. Each pick chains into a full `/lore:cultivate <name>` flow with its own PR. Re-run discovery after acting on these to see the rest.)"

Options: every new candidate's `<slug>` + every existing-domain-with-findings entry, each presented as `<name> — <one-line summary>`.

If the user picks 0 items: print `Survey complete; nothing actioned.` and exit zero.

### Step 7: Chain into cultivate skill (sequential)

For each picked item, in the order the user listed them:

- Use the Skill tool: `skill: cultivate`, prompt context including the picked domain name.
- Wait for the chained skill to complete. It will run its full per-domain flow (bootstrap for new candidates / refine or audit for existing domains, per its own state detection) and either return a PR URL or a cancellation message.
- Record the result (`{ name, status: "pr-opened" | "cancelled" | "failed", detail: <url or message> }`).
- Continue to the next picked item even if one failed — don't abort the whole session on a single failure.

### Step 8: Final summary

Print a recap:

```
Discovery session complete.
Surveyed: N candidates, M existing-domain findings, K healthy domains.
Actioned: <count> of the picks.
PRs opened:
  - <name>: <url>
  - <name>: <url>
Other outcomes:
  - <name>: cancelled / failed — <reason>
```

## Error semantics

- **Not in a witan-household** → bail with the detect-script error; suggest `/lore:doctor`.
- **Zero candidates AND zero existing-node findings** → friendly "your KB looks healthy" message; exit.
- **One existing-node file has malformed frontmatter** → already filtered out by `--survey`'s tag check; nothing to handle here.
- **Codebase scan yields no parseable source** in any repo → flag in the report ("no candidates surfaced from code; you may need to declare domains manually") and continue with the audit-only survey.
- **A chained cultivate skill invocation fails** → record in final summary; continue with the next pick.

## Notes

- Discovery never modifies files directly. All writes happen via the chained cultivate skill's own knowledge-updater dispatch.
- One discovery session can open up to 3 PRs (one per chained per-domain run).
- The 3-pick cap is intentional. Users wanting to act on more items re-run discovery after the first batch lands.
- The slash command `/lore:cultivate` (no arg) is the canonical entry point, but Claude can also auto-invoke this skill when the user asks "what domains does this project have?" or similar exploratory questions in a witan-household.
