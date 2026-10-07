# ADR-centred workflow — design

**Date:** 2026-10-07
**Status:** approved design, ready for an implementation plan
**Touches:** `commands/adr.md`, `skills/lore-adr`, `skills/recording-decisions`, `agents/architect`,
`skills/brainstorming`, `skills/writing-plans`, `skills/review`, `scripts/` (new validator),
`scripts/manifest-schema.json`, `README.md`

## Goal

Make architecture decision records the main thing humans review, and make every change an agent
writes traceable to a record a human accepted. Specs and plans stay in the workflow, but agents
review them. Humans review the decisions those specs and plans rest on, and agents review code
against the accepted ones.

Three things have to hold for that to work. Retrieval of the relevant records must be automatic,
because a decision log nobody retrieves at coding time becomes a write-only file. Statuses must
be trustworthy, because an agent reading a stale "proposed" record as current reasons from a wrong
picture of the system. And only hard-to-reverse decisions may become records, or the set turns
into noise that costs context and attention.

## Non-goals

- **Behaviour specs** (durable, stakeholder-readable descriptions of what the system does). This
  design reserves the hooks (`implements:` on a record, a review check for changed behaviour) and
  leaves the format to a separate design.
- **Wrapping an ADR CLI.** `adr-tools` is unmaintained, depends on bash/sed/awk, and its
  supersede edits silently break on frontmatter. Structure is enforced by a validator instead.
- **RFC tooling.** RFCs are exploratory documents kept wherever a team collaborates. A record
  cites its RFC; Lorekeeper never reads one.

## Document roles

| Document | Home | Authority |
|---|---|---|
| RFC (optional) | Team's collaboration tool | Exploration. Outcome of non-code decisions. One RFC yields 0..N records. |
| ADR | Local or shared ADR home (below) | **Binding once accepted.** Must stand alone without its RFC. |
| Change spec | Committed with its PR under a dated archive folder | History only. Not loaded by default; never cited as authority. |
| Plan | Never committed (branch or a gitignored agent dir) | Execution scaffolding. |
| Standard / learning | Knowledge base | Reversible conventions. A record's standing rule may be mirrored here as one line. |

Test for "record or not": **will code depend on it, and does changing it later cost more than a
day?** Code-independent decisions (tools, vendors without integration, process) stay in the RFC.
Reversible conventions go to a standard. Everything else gets a record.

## Where records live

Two configurable homes:

- **Local home** — `docs/adr/` inside the repo whose code the record governs.
- **Shared home** — `adrs/` inside the team knowledge base (`<team-knowledge-path>/adrs/`).

The record's `blast_radius` decides the home; the user is never asked "where":

| `blast_radius` | Home |
|---|---|
| `local`, `service` | local home of the governed repo |
| `cross-service`, `customer` | shared home |

In a single-repo project, or when the KB is a folder of the same repo, both homes may resolve to
the same directory and the split disappears. Household-wide decisions use `cross-service`.

Rationale (recorded here because it was contested): cross-service records are always high-tier
(below), so they already get their own PR before implementation; moving them to the KB costs no
PR atomicity the tier rule had not already spent. CI review workflows that mount the KB then see
exactly the records that can bind a diff: the repo's own local records plus every shared one. A
per-repo-only layout leaves a contract decided in repo A invisible to reviews in repo B and lets
the two halves of one contract be ratified twice. A KB-only layout forces every low-tier local
record into a second PR in another repo.

Configuration: `household.json` gains an optional `adr` block,
`{ "localDir": "docs/adr", "sharedDir": "adrs", "decisionOwners": [], "deciders": [] }` (dirs
defaulted; `decisionOwners` and `deciders` are people or code-host team handles used by the
classification route below, and an empty list disables that check), and per-repo override
`repos[].adrDir`. `.lorekeeper/config.json` accepts the same keys for single-repo setups.
`scripts/manifest-schema.json` and `migrate-manifest.js` learn the block; no schema-version bump is
needed because every key is optional.

## Identity and numbering

- Files stay `NNNN-<problem-slug>.md`; the slug names the problem, never the answer.
- IDs are qualified by home: `<repo>/ADR-NNNN` for local records, `kb/ADR-NNNN` for shared ones.
  Bare `ADR-NNNN` is accepted only inside the record's own home.
- Numbers are per home, monotonically increasing, never reused. The validator fails a PR whose
  number already exists on the default branch; the unmerged PR renumbers (filename, `id`, inbound
  links). A merged number never changes.
- A record moved between homes keeps its old ID in `aliases:` and leaves a stub file at the old
  path pointing to the new one.

## The record

MADR-based, YAML frontmatter, every value inline (block scalars are invisible to grep retrieval).

```markdown
---
id: kb/ADR-0007
title: "ADR-0007: <short title — may state the decision>"
description: "<the decision in one sentence, with its strongest because>"
tags: [adr, <topic>]
status: proposed            # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
decided_by: []              # named humans; required for accepted
consulted: []
confidence: medium          # high | medium | low
reversibility: one-way      # one-way | two-way
blast_radius: cross-service # local | service | cross-service | customer
sensitivity: []             # any of: security, privacy, billing, legal, contract
scope: ["api/src/Billing/**", "worker/src/metering/**"]
supersedes: []
superseded_by:
depends_on: []
related: []
implements: []              # reserved: behaviour-spec rule ids
rfc:                        # optional URL
aliases: []
---

# ADR-0007: <short title>

## Status
Proposed YYYY-MM-DD.

## Context
<Value-neutral facts a proponent of the losing option would accept.>

## Facts relied on
- F1 <checkable statement> — source: <where an agent can verify it>

## Considered options
- **<A>** — one honest advantage.
- **<B>** — one honest advantage.

## Decision
<One falsifiable sentence, active voice, named actor, strongest because.>

- **R1** <MUST / MUST NOT rule a reviewer can hold code against>
- **R2** …

## Consequences
- <Complete claims with reasons; at least one real negative.>

## Assumptions and invalidation triggers
- *Assumes <X>.* Trigger: <concrete event> ⇒ supersede.

## Later observations
<!-- append-only, accepted records only; newest last -->

## More information
- Related records and the RFC, as plain relative links.
```

New compared with today: `id`, `decided_by` (renamed from `deciders`, still read), the three
classification fields, `scope`, the typed relations, **numbered rules** (`kb/ADR-0007.R2` is
citable in reviews), **Facts relied on** (makes observations and scheduled fact checks point at a
list), and **Later observations**.

Body links are plain relative markdown links (they render on code hosts); frontmatter relations
are the machine source of truth.

## Classification and review route

Every record carries `reversibility`, `blast_radius`, `sensitivity`. The drafting agent proposes
them; the human reviewer confirms, and a wrong classification is itself a review finding.

**High tier** = `one-way`, or `cross-service`/`customer`, or any `sensitivity` tag.

| | High tier | Otherwise |
|---|---|---|
| Who decides | `decided_by` must include a designated decision owner (configurable role, e.g. the CTO) | any member of the configured deciders group; owner informed |
| PR venue | its own ADR-only PR, merged as `accepted` before implementation PRs | may ride in the implementation PR; the decider's approval of that PR ratifies it |
| Validator extras | ≥1 invalidation trigger, ≥2 considered options, `scope` non-empty | — |

## Lifecycle

```
proposed ──(named human ratifies)──► accepted ──► superseded | deprecated
    └──────────────────────────────► rejected
```

- **proposed** — draft. Amend freely. Code must not depend on it. Shared-home proposals exist
  only on PR branches, never on the KB's default branch (the KB holds settled knowledge only).
- **accepted** — a named human ratified it. Agents never set this status. Acceptance locks the
  record: the only permitted edits are an appended Status line, `superseded_by`, an appended
  Later-observations entry, and typo or link repair. Anything else is a new superseding record.
- **rejected** — kept, merged, and retrievable, so agents do not re-propose dead options.
- **superseded / deprecated** — locked. Supersession flips the predecessor in the same PR that
  accepts the successor, so there is never a moment when neither binds.

**Observations** answer four things: when and where (date, PR or ticket), which statement
(quoted, or a `F#` fact id), what is true now and its source, and what it means (no trigger fired
and the decision holds, or trigger X fired and a superseding record follows). A wrong observation
is corrected by a newer one, never edited.

**Agent-drafted records** must not reference chat logs or sessions, must not attribute authorship
to an AI, must not set `accepted`, and must leave `decided_by` for the human to fill or confirm.

## Anchoring work to records

1. **Brainstorming** ends by listing the decisions the design makes. Hard-to-reverse ones become
   proposed records (via `recording-decisions`) before the spec is finalised; high-tier ones pause
   the flow until ratified.
2. **Writing-plans** dispatches the architect in `bind` mode and opens every plan with a
   *Governing decisions* header: each binding record's id and its rules quoted verbatim. Plans may
   not start implementation that depends on a proposed record.
3. **Plan-compliance review** and per-task review judge against the governing rules, not only the
   spec.
4. **PR descriptions** carry a *Decisions* section: the records the change follows, any record it
   adds, or "No new decisions".

## Enforcement in review

`/lore:review` and CI review (any workflow that mounts the KB and runs the review prompt) run the
architect in `check` mode with a deterministic pre-filter:

1. **Candidate selection (no model call):** records whose `scope` globs match the diff's paths,
   plus records cited in the PR's Decisions section, from the repo's local home and the shared
   home.
2. **Judgment:** the architect reads the candidates and reports, citing rule ids and line ranges:
   - **contradiction** with an accepted record — blocking;
   - **uncovered hard-to-reverse choice** no record covers — blocking until the PR adds a record
     or carries an exemption;
   - **fired invalidation trigger** — blocking; goes back to the record's deciders;
   - **stale fact** (a `Facts relied on` entry the diff shows to be false) — non-blocking; the
     reviewer drafts the observation.
3. **Escape hatch:** a line `ADR-Exempt: <reason>` in the PR description downgrades blocking
   findings to comments and is echoed into the review summary so exemptions stay visible.

The check is blocking from the start. Its prompt is expected to need tuning; false positives are
collected from exemptions and fed back.

## The validator

`scripts/adr-lint.js` (Node, no dependencies, cross-platform). Run by the skill after every write,
available as a pre-commit hook, and in CI. Checks:

- frontmatter schema: required keys, enum values, inline values only;
- id matches home and filename; number unique against the default branch (`--base <ref>`);
- home matches `blast_radius`; a local record's `scope` may not name another repo's paths;
- high-tier extras (above); `accepted` requires non-empty `decided_by`;
- relations resolve and are symmetric (`supersedes` ⇄ `superseded_by`), no supersession cycles;
- **locked-record diff rule:** given `--base`, an accepted/superseded/deprecated record may only
  differ by the permitted edits;
- no shared-home record with `status: proposed` on the default branch.

Exit non-zero with one line per violation (`path: rule: message`). Tests live in
`scripts/__tests__/adr-lint.test.js`.

## Command and agent changes

**`/lore:adr`** (`commands/adr.md`, `skills/lore-adr`)
- Resolves both homes; `new` derives the home from the interview's `blast_radius` answer.
- Interview adds classification, `scope`, and facts relied on; the tier sets the PR shape (ADR-only
  PR for high tier; otherwise offers to stage the record in the current branch).
- `accept NNNN` requires the user to name the decider(s) and refuses to proceed for an agent-only
  identity; records `decided_by` and the ratification line.
- New modes: `observe NNNN` (draft an observation), `lint` (run the validator), `index` (render the
  catalogue on demand across all homes; never committed), `move NNNN` (relocate between homes with
  alias and stub).
- `discover` unchanged in shape; retrospective records arrive `proposed` and go through ratification.

**`architect` agent**
- Catalogue load greps every local home listed in the manifest plus the shared home.
- `bind` and `check` use the `scope` pre-filter first, then synonym expansion.
- `check` returns the four finding classes with blocking flags.
- Reports `rejected` and `superseded` records in the area as "already ruled out".

**`recording-decisions`, `brainstorming`, `writing-plans`, `review`** — the hooks in *Anchoring*
and *Enforcement* above.

**Gardener** (new skill `adr-gardener`, intended for a scheduled run)
- after a record merges: suggest missing `related`/`depends_on` links against the corpus;
- weekly: proposed records older than N days, accepted records whose `scope` matches no files,
  `Facts relied on` that no longer hold (drafts observations), exemption counts.
- Output: one PR of suggested link/observation edits, or an issue; never ratifies anything.

## Migration from the current format

- Existing `<kb>/adrs/` records stay valid. `deciders` is read as `decided_by`; missing
  classification fields produce validator warnings (not errors) until a `--strict` flag is set.
- `accept` semantics change from "first dependent code" to "human ratification". Records accepted
  under the old rule stay accepted; their Status line already names the dependent code.
- `/lore:migrate` gains an optional step that adds empty classification keys to existing records.

## Testing

- `adr-lint` unit tests: one fixture per rule, valid and invalid.
- Babashka scenarios: `/lore:adr` new (local vs shared home by blast radius), `accept` refusing
  without a named decider, `observe` on an accepted record, `check` blocking on a contradiction and
  on an uncovered choice, `ADR-Exempt` downgrade. Fixture workspace gains a second repo with a
  `docs/adr/` home.

## Open items for later designs

- Behaviour specs: format, home, editing flow for non-technical owners, `implements:` checks.
- Whether the gardener's fact checks can run commands named in `Facts relied on` sources.
