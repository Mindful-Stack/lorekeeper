# `/lore:cultivate <domain>` — design

**Status:** Design (2026-05-17)
**Scope:** Lorekeeper plugin — new slash command for iterating on a single bounded-context domain node.
**Affects:** `commands/`, `scripts/`, witan-household template's `lore/_tools/` (via the existing `cli.js`).

## Context

Lorekeeper's current `/lore:*` surface (post-unification) is good at *answering* questions about the KB (`/lore:prime`, `/lore:explore`, `/lore:review`) and at *capturing* individual updates (`/lore:learn`, `/lore:update`). It's not good at *cultivating* the KB — closing the loop between what's in the code and what's documented, finding gaps in DDD-shaped nodes, surfacing drift between the model in code and the model on disk.

For projects just starting their DDD journey — like Grantigo, whose `portal/` + `file-extractor/` repos describe a grant-matching domain that has zero formalised lore — this gap matters most. A command that bootstraps a bounded-context node from a codebase scan + an interview, then keeps it honest over time via gap detection and drift detection, would compress the time-to-useful-KB from weeks (manual writing) to one session.

`/lore:cultivate <domain>` is that command. Out-of-scope-for-this-spec but planned next: whole-KB cultivation and per-category cultivation for languages / frameworks / learnings (see "Future expansion").

## Summary

A single slash command, `/lore:cultivate <domain>`, that smart-dispatches by the current state of `lore/knowledge/domain/<domain>.md`:

- **Bootstrap** (no doc exists) — codebase scan for entity / language candidates; interview seeded with those candidates; draft a complete DDD-shaped node; dispatch to `knowledge-updater` to PR it.
- **Refine** (doc exists, missing canonical DDD sections) — identify gaps; codebase scan for terms-not-in-doc; per-suggestion `AskUserQuestion` apply; batch approved → one PR.
- **Audit** (doc exists, all canonical sections present) — drift detection (code-side terms/entities not in doc, recent file activity in domain code areas, broken wikilinks); same interactive-apply loop.

The codebase scan in all three modes iterates `manifest.repos` excluding the workspace entry and the `knowledge_base` entry — so for Grantigo it walks `portal/` and `file-extractor/`, not the meta-repo root or `lore/`.

Mode detection runs as a small JS helper (`lore/_tools/cli.js cultivate-detect <name>`) that emits `{ mode, context }` JSON. The slash command's markdown reads that, dispatches per mode, drives the interactive flow, batches approved suggestions, and hands them off to the existing `knowledge-updater` agent (extended to accept a batch of changes in one PR).

## Architecture

```
User: /lore:cultivate grant-matching
                      │
                      ▼
        commands/cultivate.md
                      │
                      ├─ Bash: node lore/_tools/cli.js cultivate-detect grant-matching
                      │       → { mode: "bootstrap"|"refine"|"audit", context: {...} }
                      │
                      ├─ Per-mode dispatch:
                      │     bootstrap → Glob/Grep on manifest repos for candidates;
                      │                  AskUserQuestion interview seeded with candidates;
                      │                  draft full domain node;
                      │                  dispatch knowledge-updater (single create PR)
                      │     refine    → Read existing doc; scan code for drift;
                      │                  list section gaps + suggestions;
                      │                  AskUserQuestion [Apply]/[Skip]/[Show context] per suggestion;
                      │                  batch approved → knowledge-updater (one PR for the session)
                      │     audit     → Read existing doc + scan code for drift signals;
                      │                  same interactive-apply loop as refine
                      │
                      └─ Report: print summary of what landed in the PR
```

### Boundaries

- **`scripts/cultivate-detect.js`** OR **new subcommand in `lore/_tools/cli.js`** — TBD where it lives (see Open items). Pure mode classification, no codebase scan. ~50 lines + tests.
- **`commands/cultivate.md`** — orchestration markdown. Reads detect output; drives interactive flow; dispatches knowledge-updater. No new logic in JS.
- **Codebase scan** — Claude uses native `Glob`/`Grep`/`Read`; no new tool. Scoped to `manifest.repos` minus workspace minus knowledge_base.
- **Suggestion application** — existing `knowledge-updater` agent (PR-flow). Extended to accept a `changes: [...]` batch param so one `/lore:cultivate` session ships one PR.

## Per-mode behaviour

### Mode-detection rule (`cultivate-detect`)

| State of `lore/knowledge/domain/<name>.md` | Mode |
|---|---|
| File doesn't exist | `bootstrap` |
| File exists, missing ≥1 canonical section (Purpose / Key Entities / Ubiquitous Language / Integration Points / Key Workflows) | `refine` |
| File exists, all canonical sections present | `audit` |
| File exists but frontmatter lacks `tags: [domain, ...]` | `bootstrap` with warning context |

Stale-but-complete content = `audit`. Date- or wordcount-based "stale refine" heuristics deferred (YAGNI).

### Bootstrap (no doc exists)

1. Confirm: "No existing doc for `<name>`. I'll scan the codebase for entity + language candidates, then walk you through DDD-shape Q&A. Continue?"
2. **Codebase scan**: `Glob` for `*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` across siblings declared in `manifest.repos` (excluding workspace + knowledge_base entries). `Grep` for class/struct/type/interface declarations. Extract noun candidates from identifier names; frequency-rank.
3. **Interview** via `AskUserQuestion`, seeded with candidates:
   - Purpose of this domain (free text, one sentence)
   - Key Entities (multi-select from top-N frequency-ranked candidates + free-text additions)
   - Ubiquitous Language terms (same shape, seeded from frequent identifiers and comment-extracted nouns)
   - Integration Points (candidates: other domain-tagged nodes in the KB + free-text)
4. **Draft** a full `lore/knowledge/domain/<name>.md` following the `_starter.md` DDD shape (frontmatter + Purpose / Key Entities / Ubiquitous Language / Integration Points / Key Workflows headings).
5. **Show draft**; `AskUserQuestion`: [Looks good] / [Edit specific section] / [Cancel].
6. On approval → dispatch `knowledge-updater` with `type=domain, action=create, content=<draft>`. Single PR.

### Refine (existing doc, missing sections)

1. **Read** existing `lore/knowledge/domain/<name>.md`.
2. **Identify** missing canonical sections (from `cultivate-detect` output's `missing_sections`).
3. **Codebase scan + KB scan** for:
   - Terms in code not in Ubiquitous Language
   - Entities mentioned in the doc lacking their own defining node
   - Integration points without partner-domain docs
   - Broken wikilinks in the doc
4. **Per suggestion**: `AskUserQuestion` [Apply] / [Skip] / [Show context].
5. **Batch approved** suggestions → `knowledge-updater` with multi-file changes in **one PR per session**.

### Audit (mature doc, drift detection)

Same loop as refine, but the suggestion mix is drift-flavoured:
- Code-side terms / entities not in the doc
- Files in domain code areas with recent activity (last 30 days) but no KB update
- Dead wikilinks

The interactive-apply mechanic is identical. Same PR shape.

## Data flow

### `cultivate-detect` output (stdout JSON)

```json
{
  "mode": "bootstrap" | "refine" | "audit",
  "context": {
    "domain_name": "grant-matching",
    "domain_file_path": "lore/knowledge/domain/grant-matching.md",
    "exists": false,
    "missing_sections": ["Purpose", "Key Entities", "..."],
    "code_repos": ["portal", "file-extractor"],
    "kb_root": "lore/knowledge"
  }
}
```

- `missing_sections` is empty for bootstrap (no file) and audit (all present); populated only for refine.
- `code_repos` excludes the workspace entry and the `knowledge_base` entry — the codebase scan walks these.

### Codebase-scan output (Claude-rendered, not serialised)

A ranked list per category, conversational format:

```
Candidate Entities (class/struct/type declarations, frequency-ranked):
  - Grant (47 mentions in portal/src/grants/*.ts)
  - GrantApplication (38 mentions)
  - User (31 mentions)
  - ExtractedDocument (9 mentions in file-extractor)
  ...

Candidate Ubiquitous-Language Terms (frequent nouns in identifiers + comments):
  - matching score
  - eligibility check
  - deadline window
  ...

Files with recent activity in domain code areas (last 30 days):
  - portal/src/grants/matcher.ts (5 commits)
  - portal/src/grants/eligibility.ts (3 commits)
```

### Suggestion structure (internal)

Each suggestion: `{ kind, target_file, target_position, proposed_text }`.

`kind` ∈ `{ missing-section, add-term, add-entity, link-cross-ref, fix-broken-wikilink, new-defining-node }`.

Walked one at a time via `AskUserQuestion`; approved ones accumulate.

### `knowledge-updater` batch dispatch

Extend the existing agent's input shape to accept:

```json
{
  "changes": [
    { "action": "create" | "update", "file_path": "...", "content": "..." | "patch": "..." },
    ...
  ],
  "pr_title": "cultivate: grant-matching — bootstrap",
  "pr_body": "Applied N suggestions from /lore:cultivate session:\n- ...\n- ..."
}
```

Cleaner than orchestrating multiple single-change dispatches inside one git branch. Single transactional PR with a clear title format: `cultivate: <domain> — <mode>`.

## Error semantics

- **`cultivate-detect` fails** (no witan-household, manifest unreadable) → command prints the underlying error verbatim, suggests `/lore:doctor`. No state changes.
- **Codebase scan returns nothing useful** (sibling repos empty, only markdown, no parseable source) → proceed; flag in the report ("no entity candidates found from code; you'll need to supply Key Entities manually"); continue with interview-only flow.
- **User cancels mid-interview** → no PR opened, no files written. Print "cancelled; nothing changed."
- **`knowledge-updater` PR creation fails** (git push rejected, gh missing, etc.) → propagate the error, preserve the local branch so the user can push manually, print recovery instructions.
- **Domain-name collision** — `cultivate-detect` says `refine` but the file is for a different concern that happens to share the name → mitigated by `cultivate-detect` checking frontmatter has `tags: [domain, ...]`; if not, treat as `bootstrap` with warning.
- **Argument missing** (bare `/lore:cultivate`) → refuse with "domain name required; usage: `/lore:cultivate <domain>`. (Future: whole-KB cultivation pass — see roadmap.)" Reserves the no-arg form for the future whole-KB spec.

## Testing

### Unit (`scripts/__tests__/cultivate-detect.test.js`)

Mirrors the `init-detect.test.js` pattern:
- Empty domain → `bootstrap`
- Domain file exists with all canonical sections → `audit`
- Domain file exists missing one canonical section → `refine`
- Domain file exists but frontmatter lacks `tags: [domain]` → `bootstrap` with warning context
- Manifest unreadable → error exit + diagnostic

### Babashka scenario tests (`test/scenarios.edn`)

Loose-regex tolerant of Claude's non-determinism:

- `cultivate-no-arg-refuses` — `/lore:cultivate` (no domain name) → output matches `domain name required|usage|future`
- `cultivate-bootstrap-prompts-for-purpose` — `/lore:cultivate fresh-domain` against a tempdir household with no existing domain doc → output mentions `Purpose|Key Entities|Ubiquitous Language`

### Not in scope for this command's tests

- E2E PR-flow testing — `knowledge-updater` agent has its own e2e coverage from earlier work; we trust it. `/lore:cultivate` orchestration testing tops out at "Claude renders the report and dispatches."

## Out of scope

- Whole-KB cultivation (no-arg form) — see Future expansion.
- Multi-domain batch (`/lore:cultivate domain1 domain2`) — YAGNI; one domain at a time.
- Auto-application without per-suggestion confirmation — interactive-apply is the contract.
- Section-aware merge for refine mode (preserving hand-edits across sibling sections) — `knowledge-updater` writes whole files; section-surgery is a future improvement.
- Codebase-scan caching — re-scan every invocation; per-domain scope is small enough.

## Future expansion (next-step roadmap)

This spec ships `/lore:cultivate <domain>` for bounded-context nodes. The natural progression after this lands:

### 1. Whole-KB cultivation (`/lore:cultivate` with no arg)

Reuses the same smart-dispatch shape, scaled up:
- Walk every node in `lore/knowledge/`
- Per node: classify (bootstrap not applicable; refine if structure is incomplete; audit if mature)
- Aggregate suggestions across the whole KB
- Cross-cutting checks: stale learnings, orphan files (no incoming wikilinks AND not prefixed `_`), tag-vocabulary consolidation (single-use tags, near-duplicates), `_index.json` staleness
- Same per-suggestion interactive-apply, same batch-PR pattern (likely multiple PRs for a whole-KB pass — one per affected category)

### 2. Per-category cultivation

The cultivation pattern generalises to other node categories:
- `/lore:cultivate language/<name>` — language-conventions nodes (e.g. `language/typescript`)
- `/lore:cultivate framework/<name>` — framework-pattern nodes (e.g. `framework/react`)
- `/lore:cultivate learnings` — special: walk every `learnings/*.md`, prompt to re-verify each, downgrade stale `confidence: verified` learnings whose date is older than threshold to `hypothesis`, propose deletion for ones the codebase no longer reflects

Implementation strategy: factor out per-category cultivation modules under `commands/cultivate/<category>.md` (or a single dispatcher in `commands/cultivate.md` that branches on the path-shape of the argument). The mode-detection helper (`cultivate-detect`) becomes category-aware.

### 3. Plumbing for Reeve integration (from the Reeve parent-design deferred list)

Once `/lore:cultivate <domain>` and the whole-KB form are mature enough for programmatic invocation, Reeve can call them from card-lifecycle hooks:
- On `→ Planning`: `/lore:cultivate <inferred-domain> --read-only` (a future flag) to surface relevant lore to the planning agent without prompting for writes
- On `→ Done`: a Reeve-side step proposes `/lore:learn` candidates based on what the card's commits surfaced, threading through this command's machinery

Tracked in `~/Source/reeve/docs/superpowers/specs/2026-04-29-reeve-design.md` under "Deferred (post-v1)".

## Open items deferred to writing-plans

- **Where the detect helper lives** — `scripts/cultivate-detect.js` (mirrors `scripts/init-detect.js`) OR new subcommand in the witan-household template's `lore/_tools/cli.js`. Lean: `scripts/cultivate-detect.js` because mode-detection is plugin logic, not KB tooling — but worth pinning during writing-plans.
- **`knowledge-updater` batch extension** — exact param shape and back-compat with single-change callers (`/lore:learn`, `/lore:update`). Two options: add a `changes: [...]` field alongside the existing `type/content/action` (back-compat) OR refactor to always-batch (existing callers wrap their single change in a one-element array).
- **Codebase scan depth** — Glob for source files: how recursive, how many file extensions, max-files cap to prevent runaway tokens. Pick reasonable defaults during plan; expose as config later if users hit limits.
- **Frequency-ranking heuristic for candidates** — simple identifier-occurrence count vs something more nuanced (boost identifiers in type declarations, deprioritise in test files). Start simple.
- **Per-suggestion `AskUserQuestion` UX** — exact prompt copy, [Show context] expansion strategy. Detail-level.

## Verification

A merged `/lore:cultivate` must:

1. `scripts/__tests__/cultivate-detect.test.js` passes (5 cases minimum from Testing section).
2. `bb test/run-tests.clj` passes the new scenarios.
3. Manual smoke against the Grantigo case:
   1. Run `/lore:init` from `~/Source/grantigo/` to set up the witan-household (if not already).
   2. Run `/lore:cultivate grant-matching` against the empty KB → bootstrap mode triggers; codebase scan surfaces entity candidates from `portal/`; interview produces a draft node; PR opens.
   3. Merge the PR; re-run `/lore:cultivate grant-matching` → audit mode (or refine if sections incomplete after the bootstrap); drift suggestions sensible.
4. Lorekeeper's `README.md` lists `/lore:cultivate` in the commands table; `commands/help.md` includes it.
