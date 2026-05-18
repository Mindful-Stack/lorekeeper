---
name: cultivate-discovery
description: EXPLORE / DISCOVER bounded contexts when none has been named. Surveys a witan-household's codebase for candidate domains AND audits existing domain nodes for gaps/drift. Use when the user invokes /lore:cultivate with no argument, asks "what domains does this project have?", "help me find bounded contexts", "where should I start with DDD?", or similar exploratory questions about the project's domain landscape. ONCE a specific domain is named, hand off to the cultivate skill instead.
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
- `{ mode: "survey", context: {...} }` — proceed. The `context` has: `workspace_root`, `kb_root`, `code_repos`, `existing_domains` (array of `{ name, file_path, missing_sections }`), `kb_warnings` (array of strings — surfaced when `knowledge/` or `knowledge/domain/` doesn't exist), `read_errors` (array of `{ file_path, message }` — unreadable `.md` files in the domain dir).

If `kb_warnings` is non-empty, print each warning inline before continuing (the survey still runs; warnings just inform the user that the existing-domain audit was partial or skipped). Do the same for `read_errors`: surface them as `Skipped <file>: <message>` lines so the user knows the audit isn't complete, then continue.

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

Print the survey as inline markdown. Every actionable row is numbered with its slug visible so users can pick by slug in Step 6:

```
## New candidate domains (N found)

1. **<slug-a>** — <evidence>; rationale: <one sentence>.
2. **<slug-b>** — ...
...

## Existing domains with findings (M total)

3. **<slug-c>** — missing sections: <list or "none">; drift signals: <list or "none">.
4. **<slug-d>** — ...
...

## Healthy domains (K total)

<comma-separated names of existing domains with no findings, or skip section if K = 0 or list is overwhelming>
```

Numbering is continuous across the two sections (new candidates first, then existing-with-findings). Cap displayed actionable rows at 10 combined; if more were detected mention the cap inline.

If both N and M are zero, print:

> Your KB looks healthy; nothing to surface today.

And exit (do not run Step 6 or 7).

### Step 6: Prioritize via free-text pick + AskUserQuestion confirmation

Prompt the user with plain text (NOT via AskUserQuestion, because the candidate list can exceed AskUserQuestion's 4-option cap):

> "Pick up to 3 items to act on now. Reply with slugs (or row numbers) comma-separated — e.g. `grant-matching, file-extraction` or `1, 3`. Type `none` to skip everything. Each pick chains into a full per-domain cultivate flow with its own PR."

Wait for the user's free-text reply. Then:

1. **Parse** the reply: split on comma, trim whitespace. Each token is either a slug string or a row number (1-indexed against the Step 5 ordering). Map numbers back to slugs.
2. **`none` short-circuit**: if any token is `none` (case-insensitive) anywhere in the reply, print `Survey complete; nothing actioned.` and exit zero. Do not process the other tokens.
3. **Validate** each remaining token:
   - **Slug tokens**: lowercase both sides before comparing (so `Grant-Matching`, `grant-matching`, and `GRANT-MATCHING` all match the same row). Drop tokens that don't match any actionable row; report each as `ignored: <token> — not in the survey`.
   - **Numeric tokens**: if the number is outside `1..N` (where N is the number of actionable rows rendered in Step 5), report as `ignored: <n> — out of range (1-<N>)`. Otherwise map to the corresponding slug.
4. **De-duplicate** (case-insensitive) and **clip to the first 3** valid entries (in user-given order). If the user named more than 3 valid items, mention the clip: `clipping to first 3: <a>, <b>, <c>`.
5. **Empty result** (user replied with only invalid tokens, or with whitespace only): print `Survey complete; nothing actioned.` and exit zero.

Then run **one** AskUserQuestion to confirm the picks (≤3 picks → ≤4 options total, fits the schema):

> "Cultivating: `<a>`, `<b>`, `<c>` in that order. Proceed?"

Options:
- `[Proceed]` → continue to Step 7.
- `[Pick different items]` → re-prompt from the top of Step 6 (free-text again).
- `[Cancel]` → print `Survey complete; nothing actioned.` and exit zero.

### Step 7: Chain into cultivate skill (sequential, with inter-pick pause)

For each confirmed pick, in the order the user listed them:

1. Use the Skill tool: `skill: cultivate`, `args: <picked slug>`. The cultivate skill will run its full per-domain flow (bootstrap / refine / audit per its own detect-script dispatch) and return a PR URL or a cancellation/failure message.
2. Record the result (`{ name, status: "pr-opened" | "cancelled" | "failed", detail: <url or message> }`).
3. **If more picks remain after this one**, run AskUserQuestion to give the user an off-ramp between picks:

   > "Finished `<slug>` (<status>: <url-or-reason>). Next up: `<next-slug>`. Continue?"

   Options:
   - `[Continue to next pick]` → proceed with the next slug.
   - `[Pause — finish later]` → stop chaining; jump to Step 8 with whatever's been completed so far. Mention in the final summary that the remaining picks were deferred so the user can re-run discovery later.

4. If a chained run failed, still ask the continue/pause question — don't abort the whole session unilaterally. Let the user decide.

### Step 8: Final summary

Print a recap:

```
Discovery session complete.
Surveyed: N candidates, M existing-domain findings, K healthy domains.
Actioned: <count> of <total picks>.
PRs opened:
  - <name>: <url>
Other outcomes:
  - <name>: cancelled / failed — <reason>
Deferred (paused at user request — re-run /lore:cultivate to resume):
  - <name>
  - <name>
```

Omit any section that has no entries.

## Error semantics

- **Not in a witan-household** → bail with the detect-script error; suggest `/lore:doctor`.
- **`knowledge/` or `knowledge/domain/` directory missing** → surfaced via `kb_warnings`; print each warning inline, then continue with the codebase scan (existing-domain audit produces no findings, but new-candidate discovery still runs).
- **One existing-node file has malformed frontmatter** → already filtered out by `--survey`'s tag check; nothing to handle here.
- **One existing-node file is unreadable** (permissions, etc.) → surfaced via `read_errors`; print `Skipped <file>: <message>` inline, continue with the other files.
- **Zero candidates AND zero existing-node findings** → friendly "your KB looks healthy" message; exit.
- **Codebase scan yields no parseable source** in any repo → flag in the report ("no candidates surfaced from code; you may need to declare domains manually") and continue with the audit-only survey.
- **A chained cultivate skill invocation fails** → record in final summary; continue (or pause if the user chooses) on the inter-pick AskUserQuestion.

## Notes

- Discovery never modifies files directly. All writes happen via the chained cultivate skill's own knowledge-updater dispatch.
- One discovery session can open up to 3 PRs (one per chained per-domain run).
- The 3-pick cap is intentional. Users wanting to act on more items re-run discovery after the first batch lands.
- The slash command `/lore:cultivate` (no arg) is the canonical entry point, but Claude can also auto-invoke this skill when the user asks "what domains does this project have?" or similar exploratory questions in a witan-household.
