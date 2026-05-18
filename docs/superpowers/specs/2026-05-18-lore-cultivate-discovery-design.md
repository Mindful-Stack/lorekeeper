# `/lore:cultivate` (no-arg) — domain discovery + cultivate skill refactor

**Status:** Design (2026-05-18)
**Scope:** Lorekeeper plugin — extend `/lore:cultivate` with a no-arg form that discovers candidate bounded contexts and audits existing domain nodes. Refactors the per-domain cultivate logic from a slash-command body into a skill so the discovery flow can chain it.
**Branch:** rides on `feat/lore-cultivate` (PR #3, not yet merged). Per-domain cultivate from that PR becomes a skill in this spec's work.
**Related:** `docs/superpowers/specs/2026-05-17-lore-cultivate-design.md` (the per-domain cultivate spec this builds on).

## Context

The per-domain `/lore:cultivate <domain>` shipped in PR #3 assumes the user knows which bounded context they want to work on. For projects starting their DDD journey — like Grantigo, whose `portal/` + `file-extractor/` repos have zero documented contexts — there's no name to pass. The user needs *discovery* first: scan the codebase, surface candidate bounded contexts, decide which to formalize.

The per-domain cultivate spec's "Future expansion" section reserved the no-arg form for whole-KB cultivation. This spec realizes that slot, with a sharper definition: not just KB-hygiene (audit existing nodes), but also discovery (find candidate contexts the KB doesn't yet have). Both concerns live under one no-arg form, distinguished in the rendered survey.

Skills (vs slash commands) enable clean chaining: the discovery flow can invoke the per-domain cultivate skill for each prioritized item via the Skill tool. Slash commands can't do this. Lorekeeper already uses the slash-command-as-thin-wrapper-over-skill pattern for `/lore:review`. This spec applies the same pattern to `/lore:cultivate`, then adds the discovery skill on top.

## Summary

Three artefacts touch the existing `feat/lore-cultivate` branch:

- **`commands/cultivate.md`** — refactored from "the cultivate orchestration markdown" into a thin 10-line wrapper. With a domain argument → invokes the `cultivate` skill. Without → invokes the `cultivate-discovery` skill.
- **`skills/cultivate/SKILL.md`** (new file) — receives the current body of `commands/cultivate.md` verbatim. Zero functional change to per-domain cultivate behavior; only relocation.
- **`skills/cultivate-discovery/SKILL.md`** (new file) — net-new functionality. Surveys the household, renders a sectioned report of new candidate domains + existing-domain findings, lets the user prioritize up to 3 items, then chains the `cultivate` skill once per picked item via the Skill tool.

The detect script `scripts/cultivate-detect.js` gains a `--survey` mode that emits a household-wide snapshot instead of per-domain classification.

When the user invokes bare `/lore:cultivate` in a witan-household:

1. The slash command wrapper sees no arg, invokes the discovery skill.
2. Discovery skill calls `cultivate-detect.js --survey` to get the workspace context (code repos, kb root, existing domain files + their gap state).
3. Discovery skill runs a codebase scan via Claude's native tools (Glob/Grep across `code_repos`); aggregates entity/identifier candidates.
4. Discovery skill walks `existing_domains` to surface gaps/drift (reuses the per-file logic the cultivate skill's audit mode uses).
5. Claude inspects all the gathered signal and proposes candidate bounded contexts (clustering by directory + naming + import topology — Claude's pattern-recognition, no algorithmic clustering).
6. Sectioned survey rendered: `## New candidate domains` and `## Existing domains with findings`.
7. User picks 0-3 items via free-text reply (comma-separated slugs or row numbers from the survey), then confirms via a single AskUserQuestion (Proceed / Pick different / Cancel).
8. For each picked item (sequentially), discovery skill invokes the `cultivate` skill via the Skill tool with that domain name. Each chained run produces its own PR. Between picks, an AskUserQuestion offers an off-ramp (continue / pause for later) so the user can stop mid-batch without losing the completed work.
9. Final summary lists PRs opened, plus any picks the user deferred via the off-ramp.

A discovery session ending with 3 picks produces up to 3 PRs (one per cultivated domain). Each PR is reviewable independently; a bad suggestion in one doesn't contaminate the others.

## Architecture

```
User: /lore:cultivate                  /lore:cultivate <domain>
              │                                    │
              ▼                                    ▼
       commands/cultivate.md (thin wrapper, smart-dispatches on arg presence)
              │                                    │
   no arg:    │                       with arg:    │
   invoke discovery skill              invoke cultivate skill
              ▼                                    │
   skills/cultivate-discovery/SKILL.md             │
              │                                    │
              ├─ cultivate-detect.js --survey
              ├─ Codebase scan (Glob/Grep across code_repos)
              ├─ Existing-node audit (walk domain/*.md, classify gaps)
              ├─ Claude proposes candidate contexts
              ├─ Render sectioned survey (numbered, max 10 actionable rows)
              ├─ Free-text pick (0-3 slugs/numbers) + AskUserQuestion confirmation
              └─ For each picked item (with inter-pick continue/pause AskUserQuestion):
                      │
                      ▼
            skills/cultivate/SKILL.md ◄────────────┘
              │
              ├─ cultivate-detect.js <name>
              ├─ Per-mode dispatch (bootstrap/refine/audit)
              ├─ Per-suggestion interactive apply
              └─ knowledge-updater → single PR per chained run
```

### Boundaries

- **`commands/cultivate.md`** — thin wrapper (~10 lines). With arg → invoke `cultivate` skill via Skill tool. Without → invoke `cultivate-discovery` skill via Skill tool. Mirrors `commands/review.md`'s pattern.
- **`skills/cultivate/SKILL.md`** — per-domain bootstrap/refine/audit. Extracted verbatim from the current PR #3 body of `commands/cultivate.md` (no functional change; only relocation). Skill description (the frontmatter `description:`) includes trigger criteria so Claude can also auto-invoke it from natural-language requests.
- **`skills/cultivate-discovery/SKILL.md`** — new. Survey + prioritize + chain. Self-contained; trigger criteria in its frontmatter `description:` mentions "domain discovery," "find bounded contexts," "what domains does this project have."

### Skill-tool chaining contract

The discovery skill invokes the cultivate skill via the Skill tool, once per prioritized item, in sequence. Each cultivate invocation runs its full per-domain flow including its own `knowledge-updater` dispatch (the batch input shape from PR #3's T2). So one discovery session ending with 3 picks = 3 PRs (one per domain). The user sees three end-of-session summaries and three PR URLs.

If the user picks 0 items, discovery exits without invoking anything.

## Per-skill content

### `skills/cultivate/SKILL.md` (extracted from current `commands/cultivate.md`; one functional change)

Frontmatter:

```yaml
---
name: cultivate
description: Cultivate a single bounded-context domain node — bootstrap a new one from a codebase scan, refine an existing one with missing canonical DDD sections, or audit a mature one for drift. Use when the user invokes /lore:cultivate <domain> or asks to flesh out a specific bounded context.
---
```

Body: every line of the current PR #3 version of `commands/cultivate.md` from "Cultivate (bootstrap / refine / audit) a single bounded-context domain node..." through the Notes section — **except** the original Step 1 (no-arg-validation refusal). The slash wrapper now owns arg-presence dispatch, so the cultivate skill is always invoked with a domain name and the refusal branch is unreachable. Step numbering after extraction: original Step 2 becomes new Step 1 (Detect state); original Step 2b becomes new Step 2 (Warning context); original Step 3 stays as Step 3 (Dispatch). All other content unchanged.

### `commands/cultivate.md` (refactored to thin wrapper)

```markdown
---
description: Cultivate a bounded-context domain. With a name argument, work on that specific domain. Without an argument, discover candidate bounded contexts in the codebase and audit existing ones.
---

# Cultivate Command

If the user provided a domain name argument, invoke the `cultivate` skill and follow it exactly as presented, passing the domain name through.

If no argument was provided, invoke the `cultivate-discovery` skill and follow it exactly as presented.
```

Mirrors `commands/review.md`'s shape and is similarly brief.

### `skills/cultivate-discovery/SKILL.md` (new)

Frontmatter:

```yaml
---
name: cultivate-discovery
description: Discover candidate bounded contexts in a witan-household's codebase and audit existing domain nodes. Use when the user invokes /lore:cultivate with no argument, or when they ask "what domains does this project have?" or "help me find bounded contexts" or similar exploratory DDD questions in a witan-household with code repos.
---
```

Body flow:

1. **Pre-flight**. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/cultivate-detect.js --survey`. Parse JSON. Two shapes:
   - `{ error, message }` → bail with the message, suggest `/lore:doctor`.
   - `{ mode: "survey", context: {...} }` → proceed.

2. **Codebase scan**. For each repo in `context.code_repos`:
   - Use Glob to find source files: `**/*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` (cap at first 500 per repo).
   - Use Grep for class/struct/type/interface declarations (same patterns as `skills/cultivate/SKILL.md`'s bootstrap-mode scan).
   - Sample directory structure (top-2 levels of `src/` or equivalent).
   - Read each match's context (5-10 lines) to extract identifiers.

3. **Existing-node audit**. For each entry in `context.existing_domains`:
   - `missing_sections` is already computed by the detect script.
   - Additional checks (Claude does these): drift signals (terms in code that aren't in the doc; recent file activity in domain code areas not reflected in the KB; dead wikilinks).

4. **Claude judgment**. With all gathered signal, propose:
   - **Candidate bounded contexts** the codebase suggests but the KB doesn't have. Cluster by directory + naming patterns + import topology. Reason about each candidate in one sentence.
   - **Existing domains with findings** from step 3.

5. **Render sectioned survey** as inline markdown:

   ```
   ## New candidate domains (N found)
   - **<name>** — `<repo>/<dir>` (X entities); files: <comma-separated identifiers>; rationale: <one-sentence rationale>.
   - ...

   ## Existing domains with findings (M total)
   - **<name>** — missing sections: <list>; drift signals: <list>.
   - ...

   ## Healthy domains (K total — for completeness, optional if list is long)
   - <comma-separated names>.
   ```

   If both N and M are zero: print "Your KB looks healthy; nothing to surface today." and exit.

6. **Prioritize via free-text pick + confirmation**. The candidate list can exceed AskUserQuestion's 4-option cap, so the survey rendered in step 5 numbers each actionable row, and discovery prompts in plain text:
   > "Pick up to 3 items to act on now. Reply with slugs (or row numbers) comma-separated — e.g. `grant-matching, file-extraction` or `1, 3`. Type `none` to skip everything."
   Parse the reply: split on commas, map row numbers to slugs, drop unknown tokens (report them), de-dup, clip to first 3. Then run **one** AskUserQuestion to confirm with options `[Proceed]` / `[Pick different items]` / `[Cancel]` — fits within the 4-option limit regardless of how many picks the user named.

7. **Chain with inter-pick off-ramp**. For each confirmed pick (sequentially):
   - Use the Skill tool with `skill: cultivate`, `args: <picked slug>`.
   - Wait for return (PR URL on success, cancellation/failure message otherwise).
   - If more picks remain, run AskUserQuestion: `[Continue to next pick]` / `[Pause — finish later]`. Pause routes to the final summary with the remaining picks marked deferred; continue advances to the next pick. The off-ramp fires even after a failed chain so the user — not the skill — decides whether to abort the batch.

8. **Final summary**. Recap (omit any empty section):
   ```
   Discovery session complete.
   Surveyed: N candidates, M existing-domain findings.
   Actioned: K of <total picks>.
   PRs opened:
     - <name>: <PR URL>
   Other outcomes:
     - <name>: cancelled / failed — <reason>
   Deferred (paused at user request — re-run /lore:cultivate to resume):
     - <name>
   ```

## Data flow

### `cultivate-detect.js` extension: `--survey` mode

When invoked with `--survey` (or `__survey__` sentinel if `--` flag handling is awkward in the existing script), the detect script emits:

```json
{
  "mode": "survey",
  "context": {
    "workspace_root": "/path/to/workspace",
    "kb_root": "lore/knowledge",
    "code_repos": ["portal", "file-extractor"],
    "existing_domains": [
      { "name": "grants", "file_path": "lore/knowledge/domain/grants.md", "missing_sections": ["Key Workflows"] },
      { "name": "users",  "file_path": "lore/knowledge/domain/users.md",  "missing_sections": [] }
    ]
  }
}
```

`existing_domains`:
- Lists every `*.md` under `<kb_root>/domain/` that has `tags: [domain, ...]` in its frontmatter.
- Files lacking the `domain` tag are excluded (same heuristic as per-domain detect's `bootstrap-with-warning` path).
- `missing_sections` per file uses the existing `CANONICAL_SECTIONS` regex check.

Error shape unchanged: `{ error: "not-in-witan-household", message: "..." }`.

### Skill-tool invocation payload

When discovery chains cultivate, the invocation passes the picked domain name. The cultivate skill receives it in the same shape as if the slash command had been called with the name as an argument. Both skill invocation paths (slash-command-with-arg and chain-from-discovery) converge on the same per-domain flow.

### Survey rendering

Inline markdown, Claude-generated from the aggregated scan + audit data. No structured serialization between Claude's judgment step and the rendered output — the survey IS the output. The user reads it, then answers the AskUserQuestion that follows.

## Error semantics

- **Not in a witan-household** → discovery skill bails with the `cultivate-detect --survey`'s error message, suggests `/lore:doctor`.
- **Zero candidates AND zero existing-node findings** → friendly "your KB looks healthy" message; exit without prompting.
- **Existing-node file has malformed frontmatter** → discovery skill logs a warning ("skipped `<file>` — frontmatter parse error"), continues with the rest. Doesn't abort the session.
- **User picks 0 items** → "survey complete; nothing actioned." Exit zero.
- **A chained `cultivate` skill invocation fails** (knowledge-updater errors, user cancels mid-interview, etc.) → reported in the final summary as `<name>: cancelled` or `<name>: failed — <reason>`. Continue with the next picked item; don't abort the whole session.
- **`cultivate-detect --survey` itself fails** (manifest unreadable etc.) → propagate the underlying error from the detect script, suggest `/lore:doctor`.

## Testing

### Unit (`scripts/__tests__/cultivate-detect.test.js`)

Extend with 3 new tests for `--survey` mode (existing 6 per-domain tests stay):

- `survey mode with no domain files → empty existing_domains, populated code_repos`.
- `survey mode with mixed domain files → lists each with its missing_sections per the per-domain logic`.
- `survey mode skips files lacking domain tag in frontmatter`.

### Babashka scenario (`test/scenarios.edn`)

Replace the `cultivate-no-arg-refuses` scenario (which tested the old refusal path) with:

- `cultivate-no-arg-runs-discovery` — invoke `/lore:cultivate` (no arg). Expected output mentions one of: `candidate|survey|discover|household.json|domain`. Tolerant of the not-in-witan-household path since the scenario harness runs against the plugin repo (which isn't a household).

The existing `cultivate-bootstrap-prompts-for-purpose` scenario stays untouched (still tests per-domain bootstrap via the cultivate skill, which the slash wrapper now routes to).

### Out of scope for tests

- E2E chain testing across discovery → cultivate → knowledge-updater. The cultivate skill has its own per-domain coverage; the discovery skill's chain mechanic is a Claude-runtime feature (Skill tool dispatch), not something we can unit-test from our side.

## Out of scope (do not implement here)

- **Algorithmic clustering helper** — the design explicitly leaves clustering to Claude's judgment for v1. A future iteration may add a `scripts/codebase-scan.js` helper with directory/name-prefix clustering if Claude's judgment proves inconsistent.
- **Auto-chain without picking** — discovery always requires the user to opt in to each acted-on item. No "act on everything" shortcut.
- **More than 3 picks per session** — cap at 3 to prevent multi-PR avalanches. Users wanting more re-run discovery.
- **Per-category cultivation** (languages/frameworks/learnings) — still deferred per the per-domain cultivate spec's roadmap.
- **Converting other `/lore:*` slash commands to skills** — only cultivate gets the refactor in this spec. Init, doctor, explore, prime, learn, onboard, help, update, review, onboard, learn remain on their existing shapes (review/update already have skills; the rest are slash-only and stay slash-only).

## Open items deferred to writing-plans

- ~~**Detect script `--survey` invocation shape**~~ — **Resolved.** Picked `--survey` as a flag in `argv[2]`; `main()` dispatches `--survey` to `survey()` and any other value to `detect(<domain>)`. No separate script needed.
- ~~**Cap on candidate list size**~~ — **Resolved.** Cap displayed actionable rows at 10 (new candidates + existing-with-findings combined). Numbered in render, picked via free-text reply, then confirmed via a single 3-option AskUserQuestion — sidesteps the 4-option-per-question schema cap entirely.
- **Per-skill discoverability through `/lore:help`** — currently `/lore:help`'s commands table lists slash commands. Skills aren't listed because they're invokable via natural language too. Decide whether to add a "Skills" section to `/lore:help` or leave skills implicit.

## Verification

A merged discovery feature must:

1. `node --test scripts/__tests__/*.test.js` passes (the 6 existing + 3 new survey-mode tests).
2. `bb test/run-tests.clj` passes (with the scenarios.edn update).
3. Manual smoke against Grantigo:
   1. Set up a witan-household for Grantigo via `/lore:init` (separate setup step; not part of this feature).
   2. Run `/lore:cultivate` (no arg) from the household root.
   3. Survey output sectioned correctly: `## New candidate domains` lists candidates derived from `portal/` + `file-extractor/`; `## Existing domains with findings` is empty since Grantigo's KB starts fresh.
   4. Pick 1-3 candidates; the chained cultivate invocations open one PR each.
   5. Run `/lore:cultivate <name>` (with arg) afterward → still works exactly as before (no functional change to per-domain cultivate).
4. `commands/cultivate.md`'s body shrinks to ~10 lines (the thin wrapper); the per-domain logic moves verbatim to `skills/cultivate/SKILL.md`.
5. `skills/cultivate-discovery/SKILL.md` exists with the body specified above; auto-invokable via natural-language requests matching its trigger description.
