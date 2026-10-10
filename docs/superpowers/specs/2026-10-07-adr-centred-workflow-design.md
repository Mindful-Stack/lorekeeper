# ADR-centred workflow — design

**Date:** 2026-10-07
**Status:** approved design, ready for implementation plans (three, see *Delivery*)
**Touches:** `commands/adr.md`, `skills/lore-adr`, `skills/recording-decisions`, `agents/architect`,
`agents/knowledge-updater`, `skills/brainstorming`, `skills/writing-plans`, `skills/review`,
`commands/doctor.md`, `scripts/` (new validator), `references/adr-template.md`, `README.md`

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
root, `/lore:adr` asks which repo (the only "where" question, and only in that case). A single
repo's name, and so its id prefix, is the last path segment of its `origin` URL (minus `.git`),
else the main worktree's directory name, else the git root's: a linked worktree's directory name
never becomes an id prefix, so ids match what CI infers.

**Other teams' shared KBs** (`shared_knowledge_bases`): their `adrs/` are read as binding context,
ids `<kb-dir>/ADR-NNNN`, never edited (unchanged rule). `kb/` always means the team KB, so
another KB's own `kb/` ids and references read as `<kb-dir>/`.

### Configuration

`household.json` gains an optional `adr` block:

```json
"adr": { "localDir": "docs/adr", "sharedDir": "adrs" }
```

plus a per-repo `repos[].adrDir` override. `.lorekeeper/config.json` accepts the same keys for
single-repo setups. Who approves a record is not configured: the PR names it and the team's
review handles it. Every key is optional, so the manifest schema version does not
change. `.lorekeeper/config.json` nests the same keys under `adr`.

## Identity and numbering

- Files stay `NNNN-<problem-slug>.md`; the slug names the problem, never the answer.
- Ids are qualified by home: `<repo>/ADR-NNNN` for local records (`<repo>` = the manifest name,
  or the git-root directory name in a single repo), `kb/ADR-NNNN` for team-KB records. Titles keep
  bare `ADR-NNNN`; listings across homes show a Home column.
- Numbers are per home, monotonically increasing, never reused. The validator fails a PR whose
  number already exists on the base branch; the unmerged PR renumbers (filename, `id`, inbound
  links). A merged number never changes.
- Records do not move between homes. A record in the wrong home stays where it is, or is
  superseded by a record in the right home.

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
| Who decides | the PR names who should approve (the decider; the area's owners via the team's normal review); no mechanical check | the PR names who should approve (the decider); no mechanical check |
| PR venue | its own ADR-only PR, merged as `accepted` before implementation PRs | may ride in the implementation PR |
| Validator extras (not for `rejected` records) | ≥1 invalidation trigger, ≥2 considered options, `scope` non-empty | — |

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

- **proposed** — draft. Amend freely. Code must not depend on it. A new shared-home proposal
  exists only on PR branches, never on the KB's default branch (the KB holds settled knowledge
  only); a proposal already on the default branch from before this rule is a grandfathered
  legacy proposal (see *The validator*), not a violation.
- **accepted** — a named human ratified it. Agents never set `accepted` on their own initiative:
  the only path is `/lore:adr accept` with the decider named by the user, which refuses an
  agent-only identity. Acceptance **locks** the record (see *Amend or supersede*).
- **rejected** — kept, merged, and retrievable, so agents do not re-propose dead options. Locked.
- **superseded / deprecated** — locked.

## Amend or supersede

A **proposed** record is a draft: any part of it may change, as often as needed, until it is
accepted or rejected.

Once a record is **accepted**, it is locked, and stays locked whatever its later status
(`superseded`, `deprecated`). A locked record is evidence of what was decided and what was known
at the time, so its body is never rewritten. Exactly five kinds of edit are allowed, each one
checkable by the validator without judging meaning:

| # | Allowed edit | What it looks like |
|---|---|---|
| 1 | **Status line** | One line appended to `## Status` per change (and the matching `status:` value), for a transition to `superseded` or `deprecated` (including `deprecated` → `superseded`), or a note such as "Supersession proposed by kb/ADR-0012" (a note sets no frontmatter). The line starts on a new line, never appended to the last sentence. Never a transition back to `proposed`. |
| 2 | **Supersede link** | Setting `superseded_by:`, only in the change that moves `status` to `superseded` (1) or on a record already `superseded` whose link is empty, never changed once set; the successor it names must already be `accepted` (in the same PR within a home, or merged earlier across homes), and a non-empty `superseded_by` means `status: superseded`; a transition to `superseded` sets it. |
| 3 | **Later observation** | A dated entry appended at the end of `## Later observations`, starting on a new line; every top-level line appended is a bullet that starts with its date (indented lines continue the entry above). Earlier entries are never edited; a wrong one is corrected by a newer one. |
| 4 | **Format and link repair** | Formatting only (the section text is identical after normalising whitespace, paired emphasis markers outside code spans, and list bullets), or a link target only: a markdown link's or aliased wikilink's target may change in any section, its text may not; a bare wikilink or autolink, whose target is its text, may change only in *See also*. |
| 5 | **Schema backfill** | Adding a frontmatter key this design introduces (`id`, `reversibility`, `blast_radius`, `sensitivity`, `scope`, `decided_by`) that is absent or empty on the base, allowed only while the base record is unclassified (no `reversibility`): every classification key is filled in one PR, all-or-nothing. `id` must equal the value its home and filename imply. `decided_by` is not added over an existing `deciders` value. A filled value is never changed again. The body is untouched. |

Spelling is not repairable. A typo in a locked record costs nothing; one that changes meaning is a
wrong statement and gets an observation (3).

**Everything else is a new record that supersedes the old one.** That includes changes to
Context, Facts relied on, Considered options, Decision and its rules, Consequences, or
Assumptions and triggers, and any change to a non-empty classification field or `scope`.

How common situations map onto the rule:

| Situation | Action |
|---|---|
| A fact in Context or *Facts relied on* is no longer true, no trigger fired, the decision holds | Observation (3) |
| A fact turns out to have been wrong when the record was written | Observation (3), saying so |
| An invalidation trigger fired | Observation (3) naming the trigger, then a superseding record |
| A rule needs to change, be added or be removed, however small | Superseding record |
| The scope or classification was wrong | Superseding record |
| The decision no longer applies and nothing replaces it | Status line (1): `deprecated` |
| A broken link, a renamed file path in *See also*, mangled formatting | Repair (4) |
| A record accepted before this design lacks `id` or classification | Backfill (5), or convert it by rewriting in place (see *Legacy records*) |
| A new record relates to or depends on an accepted one | Nothing: reverse links are computed (see *The validator*) |

The validator enforces this mechanically: given `--base`, it diffs every locked record section by
section and fails on any change outside the five allowed edits.

**Legacy records** are records whose base copy has no frontmatter, or has frontmatter but no
`reversibility` (unclassified). They predate this design and are not locked: the change that
converts one to the new format may rewrite anything in it, frontmatter and body, once. The
converted record is validated as a full new-format record (description, tags, status, a named
human in `decided_by` when ratified, classification, and the high-tier extras). Once its base copy
is classified, the lock above applies. A legacy record the change leaves unclassified keeps the
grandfathered warnings (see *The validator*). A legacy record whose `blast_radius` belongs in the
other home may be converted where it sits (a warning), and stays there or is superseded by a
record in the right home. A legacy record with a locked status that the change leaves
unclassified takes only the five edits; the change that classifies it may rewrite it, but its
status moves only forward (as in edit 1) and the deciders it already records stay.

**Observations** answer four things: when and where (date, PR or ticket), which statement
(quoted, or a `F#` fact id), what is true now and its source, and what it means (no trigger fired
and the decision holds, or trigger X fired and a superseding record follows).

## Supersession

**Within one home**, the PR that accepts the successor also flips the predecessor, so there is
never a moment when neither binds. A predecessor is never flipped to a successor that is not yet
accepted, in either case.

**Across homes** (local ⇄ shared, or between two repos' local homes), supersession and moves cannot be one PR. They run as a two-PR
stack ordered by the `stack` skill: (1) the successor merges as accepted in its home, its Status
line naming the follow-up; (2) the predecessor is flipped to `superseded` (or replaced by its
stub, for a move) in the other home. Between the two merges both records are accepted; the
architect treats the newer one as binding and reports the pair.

**Only an `accepted` or `deprecated` record can be superseded.** A `superseded` one points at
its successor, which is the record to supersede; a `rejected` one is not revived by supersession
but by a new record that lists it in `related` and says in its Context why the option is back.

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

`scripts/adr-lint.js` (Node, no dependencies, cross-platform), with subcommands `check`,
`select` (from a patch with `--diff`, or from planned paths with `--paths`), `backfill`, and three
read-only helpers the commands use instead of re-deriving the rules in prose: `homes` (the
resolved homes, the governed repo, and per home its `repoRoot` (the git toplevel holding it,
`null` when not checked out), `relDir` (its path inside that repo) and the default branch read
from that repo (`origin/HEAD` when set, else asked of origin with `git ls-remote --symref`, else
`null`: unknown, never guessed from `origin/main` or `origin/master`; an unknown default branch
refuses a ride-along and makes `own-pr` ask which branch to base on), as JSON; a KB folder inside a code repo reports the code repo), `index` (the catalogue across homes with computed
reverse links, as a table or `--json`), and `next` (the next free number in a home, counting the
base tip with `--base`). Run by the skill after every write, available as a pre-commit hook, and
in CI.

`check [--home local|shared] [--repo <name>] [--single-home] [--base <ref>] [--strict] [--ci]
<dir>`. A plain check reports the `proposed-shared` and ride-along findings, which are expected
until the record is accepted, as warnings; `--ci` (the merge gate) makes them errors. CI always
passes `--ci`. The home is inferred from the path for any home the resolution above finds (a
household's homes, or a single repo's local home and its KB); a standalone KB checkout needs
`--home shared`, and CI passes `--home` because the manifest is not checked out there. `--single-home`
marks a repo with no KB (one coinciding home) when `--home` is passed. `--base` needs the
base ref fetched (CI: `fetch-depth: 0` or an explicit fetch). Checks:

- frontmatter schema: required keys, enum values, inline values only;
- id matches home and filename; number unique against `--base`;
- home matches `blast_radius` (skipped for coinciding homes): an error, except on a legacy record
  (judged on its base copy, or on the record itself without a base), where it is a warning; `scope` syntax matches the home;
- high-tier extras; `accepted` requires non-empty `decided_by` (any named human: who should
  approve is named in the PR, not checked against a list);
- relations resolve; references to another home are warnings when that home is not on disk or
  not resolvable without a manifest, errors when it is; no supersession cycles;
- `supersedes` / `superseded_by` are symmetric within the home (edit 2 makes the reverse side
  writable). `related` and `depends_on` are stored only on the record that declares them; their
  reverse links ("related from", "depended on by") are computed on read by `index`, the
  architect's catalogue load and `doctor`, never written into the target, so a new record never
  edits a locked one;
- **locked-record diff rule:** given `--base`, a record locked on the base (accepted or later,
  and classified) may only differ by the five edits in *Amend or supersede*; a legacy record is
  not locked, and its conversion is checked as a new-format record;
- given `--base`, a record locked on the base tip but not at the merge base (accepted on the base
  since this branch forked) must be unchanged from the merge base; any edit to it fails with
  "rebase onto <base>";
- a finding between records (duplicate numbers or ids, supersession asymmetry, cycles) whose
  records are all present on the base and unchanged by this change is a warning, not an error:
  the change did not cause it, and a locked record could not clear it;
- a shared-home record with `status: proposed` is an error when the change adds or edits it; an
  untouched legacy proposal is a warning;
- ride-along rule (above), given `--base` and the PR's changed files.

**Grandfathered records** are records unclassified (no `reversibility`) on the base branch whose
status this change does not move and which it leaves unclassified, including legacy proposals. On them, a missing *or empty*
classification field, `scope` or `decided_by` is a warning, and an error under `--strict`. On
every other record it is an error (subject to the high-tier extras). An unclassified
grandfathered record is treated as high tier wherever tier is read.

A record locked on the base, or a legacy record with a locked status that the change leaves
unclassified, is only held to rules an allowed edit can satisfy; values the change writes are
always checked.

Exit non-zero with one line per violation (`path: rule: message`). Tests in
`scripts/__tests__/adr-*.test.js`.

## Command and agent changes

**`/lore:adr`** (`commands/adr.md`, `skills/lore-adr`)
- Resolves homes as above; `new` derives the home from the interview's `blast_radius` answer.
- Interview adds classification, `scope`, and facts relied on; the tier sets the PR shape.
- `accept NNNN` requires the user to name the decider(s), refuses an agent-only identity, writes
  `decided_by` and the ratification Status line, and names who should approve in the PR's
  **Approval** line.
- New modes: `observe NNNN`, `lint` (runs the validator), `index` (renders the catalogue across all
  homes on demand; never committed), `move NNNN` (cross-home move as a two-PR stack), plus `reject`
  (a named human declines a proposal), `deprecate`, and `retire <ref> by|to <id>` (the second PR
  of a cross-home supersede or move, once the successor has merged).
- `discover` unchanged in shape; retrospective records arrive `proposed` and go through `accept`.
- A bare number resolves in the governed repo's local home first, then the shared home; when both
  have it the command asks.

**`knowledge-updater` agent**
- ADR schema: `id`, `decided_by` (reads `deciders`), the new fields, the *Facts relied on* and
  *Later observations* sections.
- Locked-record rule gains appended observations, format/link repair and schema backfill.
- Local-home records are written in the code repo, not the KB: a high-tier record gets its own
  branch off the repo's default branch (never the user's working branch); a low-tier ride-along is
  staged on the current branch when the user says so.
- Every ADR change names a placement: `own-pr` (a new branch off the default branch, worked in a
  temporary git worktree so the user's checkout is untouched), `pr-branch <branch>` (commit onto
  the open PR that carries the record — `accept` and `reject` of a proposal under review), or
  `ride-along` (stage on the user's current branch, never commit). It runs `adr-lint check --base`
  before committing and stops on any nonzero exit. Its check is a plain one (without
  `--ci`), since a PR may still carry proposals; CI passes `--ci` and stays the merge gate.
- A ride-along needs the user in the record's home repo on a non-default branch; otherwise the
  change goes `own-pr`. `pr-branch` refuses a PR from a fork (`isCrossRepository`): its author
  applies the edit.
- A proposal's branch is named after the record (`knowledge/adr-NNNN-<slug>`,
  `adr/<repo>-NNNN-<slug>`); every later edit adds its mode and date
  (`knowledge/adr-0002-observe-20261011`), checked free on the remote first, and nothing is ever
  force-pushed.

**`architect` agent**
- Catalogue load greps every resolved local home, the team KB and shared KBs.
- `bind` and `check` take the `select` output first, then synonym expansion.
- `check` returns the four finding classes (contradiction, fired trigger, stale fact, uncovered
  choice); the review that dispatches it assigns their severities (Plan C). It reports `rejected`
  and `superseded` records in the area as "already ruled out" and in-flight cross-home pairs.
- With no tools beyond Glob, Grep and Read, the architect takes the catalogue (`adr-lint index
  --json`) and `select` output from its caller, and falls back to resolving the homes itself.

**`review`, `recording-decisions`, `brainstorming`, `writing-plans`, `doctor`** — the hooks above;
`doctor` learns local homes and the qualified-id references.

## Migration from the current format

- Existing `<kb>/adrs/` records stay valid; `deciders` is read as `decided_by`; missing fields warn
  until `--strict`.
- `accept` semantics change from "first dependent code" to "human ratification". Records accepted
  under the old rule stay accepted.
- `/lore:migrate` gains an optional step that adds `id` and empty classification keys to existing
  records. Every change it makes is a schema backfill (edit 5), so the migration PR passes the
  locked-record diff rule. It never renames `deciders` to `decided_by` (a rename would change an
  existing value); the old key stays and is read.
- Legacy records (no frontmatter, or unclassified) are converted by rewriting them in place into
  the template (see *Legacy records* under *Amend or supersede*); the backfill only adds keys and
  skips a record with no frontmatter.
- Plan A (this validator, the template, and the optional migrate step) only adds, so it ships as
  a **minor** version. Release as a **major** version once Plan B lands and `accept` semantics
  change: the required `id` and the new `accept` rule change behaviour for existing users.

## Delivery

Three implementation plans, in order:

- **A. Record format, homes and validator** — template, configuration and resolution, `adr-lint`
  `check` and `select`, tests, migrate step (no manifest schema change; see *Configuration*).
- **B. Writing records** — `/lore:adr` modes, `knowledge-updater`, `architect` catalogue and
  `select` integration, `doctor`, and the `adr-lint` helpers they call (`homes`, `index`, `next`,
  `select --paths`).
- **C. Workflow enforcement** — `review` severity mapping (for the architect's four classes) and
  escape hatch, `recording-decisions`, `brainstorming` terminal state, `writing-plans` header,
  plan-compliance review.

## Testing

- `adr-lint` unit tests: one fixture per rule, valid and invalid, including coinciding homes,
  cross-home warnings, the ride-along rule, each of the five locked-record edits (and a
  spelling change rejected), a migration backfill passing against `--base`, and a `related` link
  to an accepted record passing without a reverse edit.
- Babashka scenarios: `/lore:adr` new (local vs shared home by blast radius), `accept` refusing
  without a named decider, `observe` on an accepted record, `check` reporting Critical on a
  contradiction and on an uncovered choice, `ADR-Exempt` downgrade. The fixture workspace gains a
  second repo with a `docs/adr/` home.

## Open items for later designs

- Behaviour specs: format, home, editing flow for non-technical owners, `implements:` checks.
- Gardener: scheduled link suggestions, fact checks against *Facts relied on*, stale proposals.
