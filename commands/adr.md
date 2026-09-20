---
description: Record, list, accept, supersede, or discover architecture decision records (ADRs) in the team knowledge base. Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, data model) or to recover decisions already baked into the code.
---

# ADR Command

Architecture decision records are first-class knowledge: one hard-to-reverse decision per record,
numbered, reviewed through a PR like every other node, and immutable once code depends on them.
This command is the plugin's equivalent of `adr-tools` (`adr new`, `adr list`, `adr new -s`), plus
a `discover` mode that recovers the decisions a codebase has already made implicitly. Retrieval
and scanning are delegated to the **architect** agent; this command owns everything that needs the
user in the loop: triage, interview, drafting, and the PR.

## Usage

```
/lore:adr <title or one-line description>     # new record (interview → draft → PR)
/lore:adr                                     # list all records
/lore:adr list [status]                       # list, optionally filtered (proposed|accepted|…)
/lore:adr accept NNNN                         # flip a proposed record to accepted
/lore:adr supersede NNNN <title>              # new record that replaces NNNN
/lore:adr discover                            # find implicit decisions in the codebase, draft records
```

## Examples

```
/lore:adr Use PostgreSQL as the primary datastore
/lore:adr How do we authenticate the browser against the API?
/lore:adr list accepted
/lore:adr accept 0004
/lore:adr supersede 0002 Move session state from cookies to bearer tokens
/lore:adr discover
```

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers (read sources, priority order
lowest -> highest) and a `Team knowledge path:` marker (the team's writable KB).

- **Read contexts** (listing, numbering, checking for duplicates): iterate over all
  `Knowledge path:` markers.
- **Write contexts** (new records, status changes): always the `Team knowledge path:`. Decisions
  are team-owned, so this command creates and modifies records only there. A record that lives in
  a shared KB belongs to another team: cite it as binding context, but never edit it and never
  copy it into the team KB. If the user asks to accept or supersede one, say where it lives and
  stop.

If no `Knowledge path:` marker is present, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

If `<team-knowledge-path>/adrs/` does not exist, create it as part of the first record's PR.

## The record format

Every record lives at `<knowledge-path>/adrs/NNNN-<topic-slug>.md` and has exactly this shape.
The sections follow Nygard's original *Context / Decision / Consequences* (what `adr-tools`
generates), with a short *Considered options* list and an *Assumptions and invalidation triggers*
section so the record says when it should be revisited.

```markdown
---
title: "ADR-NNNN: <short title — may state the decision>"
description: "<the decision in one declarative sentence, with its strongest because>"
tags: [adr, <topic>, <topic>]
status: proposed
date: YYYY-MM-DD
deciders: [<names or roles>]
confidence: high
---

# ADR-NNNN: <short title>

## Status

Proposed YYYY-MM-DD.

## Context

<Value-neutral facts: the forces, constraints, and requirements in play. Written so that a
proponent of the losing option would agree with every sentence. No selling here.>

## Considered options

- **<Option A>** — one honest advantage.
- **<Option B>** — one honest advantage.
- **<Option C>** — one honest advantage.

## Decision

<One declarative, falsifiable sentence in active voice with a named actor and its strongest
"because" — a reviewer must be able to point at code and say "this violates the ADR". Then the
rules the decision implies, in the record itself, never only in code comments.>

## Consequences

- <Each line is a complete claim with a reason, never a bare adjective.>
- <Include real negatives. If you cannot name a downside, the record is not done.>

## Assumptions and invalidation triggers

- *Assumes <X>.* Trigger: <the concrete event that forces a revisit> ⇒ <supersede | amend>.

## See also

- [[adrs/NNNN-…]] / [[domain/…]] — related records and the context that drove this.
```

**Frontmatter rules**

- `title` is `"ADR-NNNN: …"`. `description` is the decision in one sentence (≤300 chars); it is
  what `list`, `/lore:explore`, and search show, so it carries the whole decision.
- `tags` always includes `adr`. Prefer tags already in use in the KB.
- `status` is one of `proposed | accepted | rejected | deprecated | superseded`.
- `deciders` is an inline list. `confidence` is `high | medium | low`; low confidence on an
  accepted record marks it for planned revisiting, not embarrassment.
- Optional: `supersedes: NNNN` on the new record, `superseded_by: NNNN` on the old one.
- Every value sits inline on its own line. Block scalars (`>` / `|`) and block lists are invisible
  to retrieval and fail the KB's `make validate`.

**Naming**

- `NNNN` is four digits, zero-padded, monotonically increasing, never reused. Find the next number
  by globbing `<knowledge-path>/adrs/[0-9][0-9][0-9][0-9]-*.md` across all knowledge paths and
  adding one to the highest; the first record is `0001`. Ignore `_`-prefixed files.
- The slug names the **problem or topic**, never the chosen answer (`0005-session-storage.md`,
  not `0005-session-storage-in-redis.md`), so the filename stays honest if the decision is later
  superseded. The title and H1 may state the decision.

**Writing rules**

- Target 300–900 words; hard ceiling about 1,500. Past that it is a design doc wearing an ADR
  costume: split the decision or link the design from *See also*.
- One decision per record. "Store X in database Y" is usually three decisions (storage
  technology, data model, isolation model) that break at different times; decompose.
- Two or three genuinely viable alternatives, each with one honest advantage. No strawmen.
- Register: a conversation with a future developer. Plain sentences, active voice, one idea per
  sentence. "For now" and "we should consider" are not decisions.

**Lifecycle**

```
proposed → accepted → deprecated | superseded by NNNN
    └────→ rejected
```

- **proposed** — a draft in its cooling period. Amend freely; nothing is built on it yet.
- **accepted** — the first code depends on it. That dependency is what flips the status, and it
  **locks** the record. From then on the only permitted edits are an appended `## Status` line
  (on its own, or with a transition to `accepted`, `superseded`, or `deprecated`), `superseded_by`,
  and repairs to a broken `[[wikilink]]`. A locked record never returns to `proposed`, and
  `superseded` and `deprecated` records stay locked. To change the decision, write a new record
  that supersedes it.
- **rejected** — considered and declined; kept for the audit trail.
- **deprecated** — no longer applies and nothing replaces it.
- **superseded** — replaced by a later record; both link to each other. The flip happens when
  the replacement is *accepted*, never when it is proposed: until then the old record stays
  `accepted` and binding, with a Status line noting the pending replacement.

There is no index file to maintain. Frontmatter is the catalogue: `list` renders it on demand.

## Implementation

Parse the argument. `list`, `accept`, `supersede`, and `discover` are keywords; anything else
(or nothing) is the `new` / `list` split below.

### No arguments, or `list [status]` -> List

One Grep call per knowledge path:

```
Grep  pattern: ^(title|description|status|date):
      path: <knowledge-path>/adrs   glob: [0-9]*.md   output_mode: content   -n: true
```

Group the four lines per file, sort by number, optionally filter on `status`, and render:

```
## Architecture decision records (N)

| ADR | Title | Decision | Status | Date |
|-----|-------|----------|--------|------|
| 0001 | Primary datastore | All transactional data lives in PostgreSQL because… | accepted | 2026-05-16 |
```

If `adrs/` is empty or missing, say so and point at `/lore:adr <title>` and `/lore:adr discover`.
End with: `Use /lore:prime adrs/NNNN-… to load a record into context.`

### `<title>` -> New record

1. **Triage first.** Not every decision deserves a record. Ask yourself, and say which tier it is:
   - **Tier 1 — record it**: expensive to reverse (changing your mind later costs more than a
     day), crosses service or module boundaries, or keeps getting re-debated.
   - **Tier 2 — one line**: sets a local convention, reversible with moderate effort. Offer to add
     a single line to the owning record's consequences, a standard in `general/`, or a learning
     instead. Promote to a full record only if it gets re-litigated.
   - **Tier 3 — no record** beyond the plan, the PR description, and the code.
   If the decision is Tier 2 or 3, say so, offer the lighter option, and stop unless the user
   insists.
2. **Load context.** Dispatch two agents in parallel (both Task calls in one message): the
   **architect** agent in `bind` mode with the topic (returns the accepted records that already
   constrain it, any trigger this decision fires, and duplicates or supersede candidates) and the
   **knowledge-reader** agent with the hint "Prioritise domain context and architecture
   patterns." If the architect reports a record that already covers the decision, stop and offer
   `accept`, `supersede`, or nothing. Grep the codebase for the thing being decided so the Context
   section rests on facts, not memory.
3. **Interview, one question at a time.** Before drafting, ask the scoping questions that apply:
   who accesses this and at what boundaries; isolation and access-control requirements;
   read/write patterns and scale; retention and lifecycle; what adjacent planned work touches it;
   which alternatives were genuinely on the table and why they lost. Prefer multiple choice.
   Stop asking as soon as you can write every section honestly.
4. **Decompose bundles.** If the answers reveal more than one decision, say so, and record them
   as separate numbered records in one PR (one interview, N files).
5. **Draft** the record in the format above. Status is `proposed` unless the user says code
   already depends on it, in which case use `accepted` and write the Status line as
   "Accepted (retrospective) YYYY-MM-DD; the decision predates this record. First dependent code:
   `<path>`."
6. **Self-check** before showing it, and fix inline:
   - Is the Decision one falsifiable sentence a reviewer could hold code against?
   - Would a proponent of the losing option accept every sentence in Context?
   - Are there two or three real alternatives, each with an honest advantage?
   - Is at least one consequence a genuine negative?
   - Is there at least one named invalidation trigger?
   - Is every frontmatter value inline, and is `description` the decision itself?
   - Word count within 300–900?
7. **Present** the complete file to the developer with its proposed path:

   > **Proposed ADR**
   >
   > **File:** `<team-knowledge-path>/adrs/NNNN-<slug>.md`
   >
   > ```markdown
   > [complete file contents]
   > ```
   >
   > Does this look right? I can adjust any section, the tier, or the status before opening a PR.

8. **Apply** (if confirmed). Dispatch the **knowledge-updater** agent with:
   - **Type:** `adr`
   - **Content:** the approved file
   - **Action:** `create`
   - **File path:** `adrs/NNNN-<slug>.md`

   For several records from one interview, use the agent's batch shape so they land in one PR.
9. **Confirm** with the PR URL: `ADR-NNNN drafted (proposed) and PR created: {pr-url}`. If the
   decision implies a standing rule ("always X", "never Y"), offer to add that one line to the
   relevant standard or the repo's `CLAUDE.md` in the same PR: the ADR holds the reasoning, the
   standard holds the rule.

### `accept NNNN` -> Flip to accepted

1. Read the record. If its status is not `proposed`, stop and say what it is.
2. Ask what code now depends on it (a PR number or path). That dependency is the reason for the
   flip, and it goes in the log.
3. Change `status: proposed` to `status: accepted` and append to `## Status`:
   `Accepted YYYY-MM-DD. First dependent code: <PR or path>.` Nothing else changes.
4. **If the record carries `supersedes: NNNN`**, retire the predecessor in the same change:
   `status: superseded`, `superseded_by: MMMM`, and a Status line
   `Superseded YYYY-MM-DD by [[adrs/MMMM-…]].` Its body stays untouched. The two edits are one
   atomic transition: there is never a moment when neither record is binding.
5. Present the diff(s), then dispatch **knowledge-updater** with Type `adr`, Action `update`, and
   the file path — or, when a predecessor is retired too, the **batch shape** (two `update`
   entries) with `pr_title` `docs: accept ADR-MMMM, supersede ADR-NNNN - <title>`. Confirm with
   the PR URL.

### `supersede NNNN <title>` -> Replace a record

Superseding is two transitions, not one. This flow only *proposes* the replacement; NNNN stays
`accepted` and binding until `accept MMMM` retires it (see the accept flow, step 4). Otherwise
there would be a window where the old record is already superseded and the new one is still
proposed, and nothing constrains the code.

1. Read record NNNN. If it is `proposed`, ask whether the user would rather amend it (a proposed
   record is still a draft); only continue if they want a new record.
2. Draft the replacement with the **drafting steps of the New record flow only — steps 1 to 7**.
   Do not run its steps 8 and 9; publishing happens once, in step 4 below. Two adjustments:
   - In step 2 the architect will report NNNN as already covering the decision. That is the
     expected duplicate — do not stop on it. Stop only if it names a *different* accepted record
     covering the same decision.
   - The draft's status is `proposed`, its frontmatter carries `supersedes: NNNN`, its Context
     opens with one sentence on what changed since NNNN, and its *See also* links
     `[[adrs/NNNN-…]]`.
3. Prepare the edit to the old record: **only** a Status line
   `Supersession proposed YYYY-MM-DD by [[adrs/MMMM-…]]; this record remains binding until
   ADR-MMMM is accepted.` Its `status` and body stay untouched: appending to the Status log is a
   permitted edit on a locked record (rule 3).
4. Present both files, then dispatch **knowledge-updater** once with the **batch shape** (one
   `create`, one `update`) so both land in one PR titled
   `docs: propose ADR-MMMM superseding ADR-NNNN - <title>`. Confirm with the PR URL and say
   that `accept MMMM` will retire NNNN.

### `discover` -> Decision archaeology

Recover the architecturally significant decisions a codebase has already made without writing
them down. The scanning happens in the **architect** agent so the evidence never lands in this
conversation; only the pick loop and the drafting do.

1. **Dispatch the architect agent** in `survey` mode, passing any scope the user gave (a repo or
   area) or "the whole household". It returns the grouped candidate list (at most fifteen, each
   with the requirement, the choice, evidence paths, and whether an alternative was weighed), the
   records that already exist, and the scan scope.
2. **Render its report verbatim**, then ask in plain text (not `AskUserQuestion`, the list can
   exceed four options): "Which should I record now? Reply with numbers or topics,
   comma-separated, or `none`. I will take the first three." Parse, validate, de-duplicate, clip
   to three, then confirm the picks with one `AskUserQuestion`.
3. **Record each pick** with the **New record** flow in retrospective form: status `accepted`,
   the retrospective Status line, Context reconstructed from the evidence the agent cited, and the
   interview shortened to confirming the reasons with the user. Where the alternatives were not
   visibly weighed at the time, say exactly that in *Considered options* rather than inventing a
   debate. In step 2 of the New flow, still dispatch the architect in `bind` mode for this
   candidate: the survey listed choices nobody recorded, it never checked them against the
   accepted records. The knowledge-reader dispatch can be skipped, since the survey already cited
   the evidence. Pause between picks with an `AskUserQuestion` offering continue / stop.
4. **Summarise**: records opened (with PR URLs), candidates left unrecorded, and a reminder that
   `/lore:adr discover` can be run again for the rest.

## Important Rules

1. **Always get developer approval** before writing any file, and **always create a branch and
   PR** — never commit directly to main.
2. **Record before building.** A decision that is about to be implemented gets a `proposed`
   record first; it flips to `accepted` when the code lands. Do not write records after the fact
   for new work and call them proposed.
3. **Accepted records are locked.** Acceptance is recorded in the `## Status` log and locks the
   record for good, whatever its status later becomes. The only permitted edits are an appended
   Status line (alone, or with a transition to `accepted`, `superseded`, or `deprecated`),
   `superseded_by`, and repairs to a broken `[[wikilink]]`. Never edit anything else; supersede
   instead.
4. **Give every record `title`, `description`, and `tags`** — retrieval greps those, so a record
   missing any of them is invisible to search. The `description` must be the decision itself.
5. **Numbers are never reused**, not even for rejected records. If two open PRs claim the same
   number, the one still unmerged renumbers its draft: filename, `title`, and inbound wikilinks.
   A number already merged is never changed.
6. **Never hard-code a category or repo list** — discover records by globbing `adrs/`, and repos
   from `household.json`.
