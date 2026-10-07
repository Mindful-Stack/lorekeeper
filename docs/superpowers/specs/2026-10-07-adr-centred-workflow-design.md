# ADR-centred workflow — design

**Date:** 2026-10-07
**Status:** approved design, ready for implementation plans (three, see *Delivery*)
**Touches:** `commands/adr.md`, `skills/lore-adr`, `skills/recording-decisions`, `agents/architect`,
`agents/knowledge-updater`, `skills/brainstorming`, `skills/writing-plans`, `skills/review`,
`commands/doctor.md`, `scripts/` (new validator), `scripts/manifest-schema.json`,
`scripts/migrate-manifest.js`, `README.md`

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
  design reserves `implements:` on a record and leaves the format to a separate design.
- **Wrapping an ADR CLI.** `adr-tools` is unmaintained, depends on bash/sed/awk, and its
  supersede edits silently break on frontmatter. Structure is enforced by a validator instead.
- **RFC tooling.** RFCs are exploratory documents kept wherever a team collaborates. A record
  cites its RFC; Lorekeeper never reads one.
- **The gardener** (scheduled link suggestions, fact checks, stale-proposal reports). Deferred to a
  follow-up design once the record format has settled in use.

## Document roles

| Document | Home | Authority |
|---|---|---|
| RFC (optional) | Team's collaboration tool | Exploration. Outcome of non-code decisions. One RFC yields 0..N records. |
| ADR | Local or shared ADR home (below) | **Binding once accepted.** Must stand alone without its RFC. |
| Change spec | Committed with its PR under `docs/agent/specs/archive/YYYY-MM-DD-<topic>.md` | History only. Not loaded by default; never cited as authority. |
| Plan | Never committed (`docs/agent/plans/`, gitignored by the skill's setup advice) | Execution scaffolding. |
| Standard / learning | Knowledge base | Reversible conventions. A record's standing rule may be mirrored here as one line. |

Brainstorming writes the working spec to `docs/agent/specs/` as today; when the implementing PR is
opened, the spec moves to `docs/agent/specs/archive/` in that PR.

Test for "record or not": **will code depend on it, and does changing it later cost more than a
day?** Code-independent decisions (tools, vendors without integration, process) stay in the RFC.
Reversible conventions go to a standard. Everything else gets a record.

## Where records live

Two homes:

- **Local home** — `docs/adr/` inside the repo whose code the record governs.
- **Shared home** — `adrs/` inside the **team** knowledge base (`<team-knowledge-path>/adrs/`).

The record's `blast_radius` decides the home; the user is never asked "where":

| `blast_radius` | Home |
|---|---|
| `local`, `service` | local home of the governed repo |
| `cross-service`, `customer` | shared home |

Household-wide decisions use `cross-service`.

Rationale (recorded because it was contested): cross-service records are always high tier
(below), so they already get their own PR before implementation; moving them to the KB costs no
PR atomicity the tier rule had not already spent. CI review workflows that mount the KB then see
exactly the records that can bind a diff: the repo's own local records plus every shared one. A
per-repo-only layout leaves a contract decided in repo A invisible to reviews in repo B and lets
the two halves of one contract be ratified twice. A KB-only layout forces every low-tier local
record into a second PR in another repo.

### Resolving the homes

Commands and agents resolve homes in this order:

1. **Household** (a `household.json` found by the hook's walk-up): local homes are
   `<household-root>/<repos[].name>/<repos[].adrDir or adr.localDir>` for every repo present on
   disk; absent siblings are skipped and named in the report. The shared home is
   `<team-knowledge-path>/<adr.sharedDir>`.
2. **Single repo** (config tiers 1, 2 or 4, no manifest): one local home at
   `<git-root>/<adr.localDir from .lorekeeper/config.json, default docs/adr>`; the shared home is
   `<team-knowledge-path>/adrs` when a KB resolves, else none.
3. **Coinciding homes**: if both resolve to the same directory (KB folder inside the same repo, or
   no KB), there is one home. Ids use the local prefix, and the validator skips the home check.

**Governed repo** for a new local record: the git root of the CWD; when the CWD is the household
root, `/lore:adr` asks which repo (the only "where" question, and only in that case).

**Other teams' shared KBs** (`shared_knowledge_bases`): their `adrs/` are read as binding context,
ids `<kb-dir>/ADR-NNNN`, never edited (unchanged rule). `kb/` always means the team KB.

### Configuration

`household.json` gains an optional `adr` block:

```json
"adr": { "localDir": "docs/adr", "sharedDir": "adrs", "decisionOwners": [], "deciders": [] }
```

plus a per-repo `repos[].adrDir` override. `.lorekeeper/config.json` accepts the same keys for
single-repo setups. `decisionOwners` and `deciders` are people or code-host team handles; an empty
list disables the matching check. `scripts/manifest-schema.json` and `migrate-manifest.js` learn
the block; every key is optional, so no schema-version bump.

## Identity and numbering

- Files stay `NNNN-<problem-slug>.md`; the slug names the problem, never the answer.
- Ids are qualified by home: `<repo>/ADR-NNNN` for local records (`<repo>` = the manifest name,
  or the git-root directory name in a single repo), `kb/ADR-NNNN` for team-KB records. Titles keep
  bare `ADR-NNNN`; listings across homes show a Home column.
- Numbers are per home, monotonically increasing, never reused. The validator fails a PR whose
  number already exists on the base branch; the unmerged PR renumbers (filename, `id`, inbound
  links). A merged number never changes.
- A record moved between homes gets a new id in its new home, keeps its old id in `aliases:`, and
  leaves a stub file at the old path (frontmatter `status` unchanged, `moved_to: <new id>`, body one
  line).

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
scope: ["billing-api:src/Billing/**", "metering-worker:src/**"]
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

## See also
- Related records by qualified id, and the RFC.
```

New compared with today: `id`, `decided_by` (renamed from `deciders`, which is still read), the
three classification fields, `scope`, the typed relations, **numbered rules** (`kb/ADR-0007.R2` is
citable in reviews), **Facts relied on**, and **Later observations**.

**`scope` syntax.** In a local record, globs are relative to its repo root (`src/Billing/**`). In a
shared record, each glob is prefixed with the repo name and a colon (`billing-api:src/**`). A local
record may not use the prefixed form.

**Links.** Frontmatter relations are the machine source of truth and use qualified ids. In *See
also*, references within the same home stay `[[adrs/NNNN-…]]` wikilinks in the KB (as today, so
`/lore:doctor` and the KB's validation keep working) and become plain relative links in a local
home (they render on code hosts). Cross-home references are the qualified id as text, never a
path.

## Classification and review route

Every record carries `reversibility`, `blast_radius`, `sensitivity`. The drafting agent proposes
them; the human reviewer confirms, and a wrong classification is itself a review finding.

**High tier** = `one-way`, or `cross-service`/`customer`, or any `sensitivity` tag.

| | High tier | Otherwise |
|---|---|---|
| Who decides | `decided_by` ∩ `decisionOwners` ≠ ∅ | `decided_by` ∩ `deciders` ≠ ∅ (owners informed) |
| PR venue | its own ADR-only PR, merged as `accepted` before implementation PRs | may ride in the implementation PR |
| Validator extras | ≥1 invalidation trigger, ≥2 considered options, `scope` non-empty | — |

**Ride-along ratification.** A low-tier record in an implementation PR is drafted `proposed`.
Before merge, once the decider has approved the PR, the author runs `/lore:adr accept NNNN` naming
that approver; the record merges as `accepted` in the same PR. The validator enforces the
ordering: a PR that changes files matching a record's `scope` and adds that record must carry it
as `accepted` by the time checks pass on the final commit.

## Lifecycle

```
proposed ──(/lore:adr accept, naming a human)──► accepted ──► superseded | deprecated
    └────────────────────────────────────────► rejected
```

- **proposed** — draft. Amend freely. Code must not depend on it. Shared-home proposals exist
  only on PR branches, never on the KB's default branch (the KB holds settled knowledge only).
- **accepted** — a named human ratified it. Agents never set `accepted` on their own initiative:
  the only path is `/lore:adr accept` with the decider named by the user, which refuses an
  agent-only identity. Acceptance locks the record: the only permitted edits are an appended
  Status line, `superseded_by`, an appended Later-observations entry, and typo or link repair.
  Anything else is a new superseding record.
- **rejected** — kept, merged, and retrievable, so agents do not re-propose dead options.
- **superseded / deprecated** — locked.

**Supersession within one home** flips the predecessor in the same PR that accepts the successor,
so there is never a moment when neither binds.

**Supersession or moves across homes** (local ⇄ shared) cannot be one PR. They run as a two-PR
stack ordered by the `stack` skill: (1) the successor merges as accepted in its home, its Status
line naming the follow-up; (2) the predecessor is flipped to `superseded` (or replaced by its
stub, for a move) in the other home. Between the two merges both records are accepted; the
architect treats the newer one as binding and reports the pair.

**Observations** answer four things: when and where (date, PR or ticket), which statement
(quoted, or a `F#` fact id), what is true now and its source, and what it means (no trigger fired
and the decision holds, or trigger X fired and a superseding record follows). A wrong observation
is corrected by a newer one, never edited.

**Agent-drafted records** must not reference chat logs or sessions, must not attribute authorship
to an AI, and must leave `decided_by` for the human to name.

## Anchoring work to records

1. **Brainstorming** ends by listing the decisions the design makes. Hard-to-reverse ones become
   proposed records (via `recording-decisions`) before the spec is finalised. If any is high tier,
   the skill's terminal state is "ADR PR opened; resume with writing-plans once it is accepted"
   instead of invoking writing-plans directly.
2. **Writing-plans** dispatches the architect in `bind` mode and opens every plan with a
   *Governing decisions* header: each binding record's id and its rules quoted verbatim. A plan may
   not schedule implementation that depends on a proposed high-tier record.
3. **Plan-compliance review** and per-task review judge against the governing rules, not only the
   spec.
4. **PR descriptions** carry a *Decisions* section: the records the change follows, any record it
   adds, or "No new decisions".

## Enforcement in review

`/lore:review` and CI review (any workflow that mounts the KB and runs the review prompt) run:

1. **Candidate selection (deterministic):** `node scripts/adr-lint.js select --repo <name>
   --diff <patch>` prints the records whose `scope` matches the diff's paths, plus records cited in
   the PR's Decisions section, from the repo's local home and the team KB's shared home. `--repo`
   comes from a CI input, or from matching `git remote get-url origin` against the manifest. The
   review skill names this step explicitly.
2. **Judgment:** the architect (`check` mode) reads the candidates and reports, citing rule ids and
   line ranges. New severity mapping in `/lore:review`:
   - **contradiction** with an accepted record — **Critical** (blocking);
   - **uncovered hard-to-reverse choice** no record covers — **Critical** until the PR adds a record
     or carries an exemption;
   - **fired invalidation trigger** — **Critical**; goes back to the record's deciders;
   - **stale fact** (a `Facts relied on` entry the diff shows to be false) — **Minor**; the
     reviewer drafts the observation.
3. **Escape hatch:** `ADR-Exempt: <reason>` in the PR description, or as a commit trailer when
   reviewing local changes with no PR, downgrades the blocking findings to Important and is echoed
   into the review summary so exemptions stay visible.

The check is blocking from the start. Its prompt is expected to need tuning; false positives are
collected from exemptions and fed back.

## The validator

`scripts/adr-lint.js` (Node, no dependencies, cross-platform), with subcommands `check` and
`select`. Run by the skill after every write, available as a pre-commit hook, and in CI.

`check [--home local|shared] [--repo <name>] [--base <ref>] [--strict] <dir>`. The home is inferred
from the path when it ends in a configured `sharedDir` under a KB, else given; CI passes it because
the manifest is not checked out there. `--base` needs the base ref fetched (CI: `fetch-depth: 0`
or an explicit fetch). Checks:

- frontmatter schema: required keys, enum values, inline values only;
- id matches home and filename; number unique against `--base`;
- home matches `blast_radius` (skipped for coinciding homes); `scope` syntax matches the home;
- high-tier extras; `accepted` requires non-empty `decided_by`; owner/decider membership when
  configured;
- relations resolve and are symmetric within the home; references to another home are warnings
  when that home is not on disk, errors when it is; no supersession cycles;
- **locked-record diff rule:** given `--base`, an accepted/superseded/deprecated record may only
  differ by the permitted edits;
- no shared-home record with `status: proposed` on the default branch;
- ride-along rule (above), given `--base` and the PR's changed files.

Without `--strict`, missing classification fields and `decided_by` on records accepted under the
old rule are warnings. Exit non-zero with one line per violation (`path: rule: message`). Tests in
`scripts/__tests__/adr-lint.test.js`.

## Command and agent changes

**`/lore:adr`** (`commands/adr.md`, `skills/lore-adr`)
- Resolves homes as above; `new` derives the home from the interview's `blast_radius` answer.
- Interview adds classification, `scope`, and facts relied on; the tier sets the PR shape.
- `accept NNNN` requires the user to name the decider(s), refuses an agent-only identity, writes
  `decided_by` and the ratification Status line, and checks the owner/decider rule.
- New modes: `observe NNNN`, `lint` (runs the validator), `index` (renders the catalogue across all
  homes on demand; never committed), `move NNNN` (cross-home move as a two-PR stack).
- `discover` unchanged in shape; retrospective records arrive `proposed` and go through `accept`.

**`knowledge-updater` agent**
- ADR schema: `id`, `decided_by` (reads `deciders`), the new fields, the *Facts relied on* and
  *Later observations* sections.
- Locked-record rule gains appended observations and typo/link repair.
- Local-home records are written in the code repo, not the KB: a high-tier record gets its own
  branch off the repo's default branch (never the user's working branch); a low-tier ride-along is
  staged on the current branch when the user says so.

**`architect` agent**
- Catalogue load greps every resolved local home, the team KB and shared KBs.
- `bind` and `check` take the `select` output first, then synonym expansion.
- `check` returns the four finding classes with severities; reports `rejected` and `superseded`
  records in the area as "already ruled out" and in-flight cross-home pairs.

**`review`, `recording-decisions`, `brainstorming`, `writing-plans`, `doctor`** — the hooks above;
`doctor` learns local homes and the qualified-id references.

## Migration from the current format

- Existing `<kb>/adrs/` records stay valid; `deciders` is read as `decided_by`; missing fields warn
  until `--strict`.
- `accept` semantics change from "first dependent code" to "human ratification". Records accepted
  under the old rule stay accepted.
- `/lore:migrate` gains an optional step that adds `id` and empty classification keys to existing
  records.
- Release as a **major** version: `accept` semantics and the required `id` change behaviour for
  existing users.

## Delivery

Three implementation plans, in order:

- **A. Record format, homes and validator** — template, configuration and resolution, `adr-lint`
  `check` and `select`, tests, manifest schema, migrate step.
- **B. Writing records** — `/lore:adr` modes, `knowledge-updater`, `architect` catalogue and
  `select` integration, `doctor`.
- **C. Workflow enforcement** — `review` severity mapping and escape hatch, `recording-decisions`,
  `brainstorming` terminal state, `writing-plans` header, plan-compliance review.

## Testing

- `adr-lint` unit tests: one fixture per rule, valid and invalid, including coinciding homes,
  cross-home warnings, and the ride-along rule.
- Babashka scenarios: `/lore:adr` new (local vs shared home by blast radius), `accept` refusing
  without a named decider, `observe` on an accepted record, `check` reporting Critical on a
  contradiction and on an uncovered choice, `ADR-Exempt` downgrade. The fixture workspace gains a
  second repo with a `docs/adr/` home.

## Open items for later designs

- Behaviour specs: format, home, editing flow for non-technical owners, `implements:` checks.
- Gardener: scheduled link suggestions, fact checks against *Facts relied on*, stale proposals.
