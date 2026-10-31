# Behaviour docs — design

**Date:** 2026-10-09, amended 2026-10-13 to fit what shipped in 3.0.0 (#28) and the pilot doc,
and 2026-10-30 with what Plan D settled (3.5.0) and the PR review's fail-closed decisions
**Status:** approved design; Plan D is implemented in 3.5.0, Plan E (the skill) remains
**Builds on:** `2026-10-07-adr-centred-workflow-design.md` (homes, `select`, the review check)
**Touches:** `scripts/adr-lint.js` + `scripts/adr/` (`homes`, `check`, `select`, `index`),
`agents/architect`, `agents/knowledge-updater`, `skills/reviewing-changes`, `skills/brainstorming`,
`skills/cultivating-domains`, new `skills/documenting-behaviour` + `commands/behaviour.md` +
`skills/lore-behaviour`, `README.md`

## Goal

Give reviewers and agents the one thing code cannot express: what must stay true, and why it
matters. ADRs already record why a hard-to-reverse choice was made. This design adds the
living counterpart: **behaviour docs**, which state the rules the system must keep, organised by
capability, kept current alongside the change that alters the behaviour, and read by the same
review step that checks ADRs.

## The model: two durable documents

| | ADR | Behaviour doc |
|---|---|---|
| Answers | **Why** we chose this | **What must be true now** |
| Changes | Locked once accepted; superseded to change | Edited with the change that alters the behaviour |
| Human review | The record itself | The rule diff, listed in the PR |
| Example | "Grants are scoped to an org or a project, because…" | "org.R7: a person may only grant roles strictly below their own" |

They connect as **ADR → rule → code**. A rule that follows from a decision names it in a
`Source:` line and need not restate it. The ADR's reserved `implements:` field stays empty: the
reverse direction (which rules implement a record) is computed on read from `Source:` lines, like
`relatedFrom`.

A developer asks two questions: *is this a decision?* → an ADR; *must this stay true?* → a rule.

**Domain nodes in the knowledge base hold concepts and ownership** (terms, what owns what, which
ADRs apply) and link to their capability's behaviour docs; the doc does not link back. The
rule-shaped text domain nodes carry today (mostly *Key Workflows*) moves into behaviour docs over
time; `cultivate` refine may propose the move.

## Non-goals

- **Grading rules as "invariant" vs "behaviour".** A pilot (30 rules for one capability, marked
  by hand) found the marker's grade differed from the drafter's on 10 of 26 kept rules, in both
  directions, and the invariant share was 58%. The line is not stable enough to split documents
  or tooling on. Every rule is simply a rule.
- **Documenting everything.** Docs are created capability by capability when work touches a
  capability. The review check applies only where a doc's scope matches the diff.
- **Narrating the code.** A rule states an observable guarantee and an example; it never explains
  how the implementation works.
- **Gating who approves.** No owner, approval mode or CODEOWNERS check: the PR names who should
  approve a rule change, as for ADRs. A repo may add CODEOWNERS itself, one line per doc or
  folder, and GitHub enforces it; Lorekeeper never reads or checks it.

## Where behaviour docs live

The same two homes as ADRs, resolved the same way (see the ADR design's *Resolving the homes*):

| The capability… | Home |
|---|---|
| is implemented in one repo | `docs/behaviour/<capability>.md` in that repo |
| spans repos, or is a contract between repos | `behaviour/<capability>.md` in the team knowledge base |

Configuration extends the `adr` block's siblings: `household.json` gains an optional
`"behaviour": { "localDir": "docs/behaviour", "sharedDir": "behaviour" }` and a per-repo
`repos[].behaviourDir`. `.lorekeeper/config.json` accepts the same keys. No manifest schema
change; a household whose own manifest tests restrict the `adr` keys must allow these too.

## The document

```markdown
---
title: "Organizations, roles and invitations"
description: "Who can create, join, administer and leave an organization and its projects."
tags: [behaviour, organizations]
prefix: org
scope: ["src/server/Endpoints/Orgs/**", "src/server/Endpoints/Invites/**", "src/client/src/lib/authz/**"]
related: [app/ADR-0008, app/ADR-0009]
---

# Organizations, roles and invitations

## Purpose
Two or three plain sentences a non-engineer understands.

## Rules

**Creating an organization**

### org.R1 Creator becomes Owner
Whoever creates an organization SHALL become its Owner in the same step.
- Example: WHEN a signed-in user creates "Acme" THEN they are Acme's Owner.

### org.R7 Strictly-below grant authority
…
- Source: app/ADR-0009            (a record, or one of its rules: kb/ADR-0001.R2)

## Known deviations
- org.R2: organizations cannot be deleted at all yet (DEV-426).

## Not yet decided
- One line per open question, with the evidence that raised it.
```

- **Frontmatter.** `title`, `description` and `tags` make a KB-home doc a KB node that
  `/lore:doctor` and the knowledge-reader see (local docs carry them too). Values are inline. The
  filename and title name the capability; there is no `capability:` key. `prefix` matches
  `^[a-z][a-z0-9-]*$`, is unique per home, and may not be `adr`. `related` holds qualified ADR
  ids, resolved like an ADR's `related`, and is optional. There is no `domain` key: the domain
  node links to the doc, not the other way round.
- **Ids.** A rule is `<prefix>.R<n>`, qualified by home outside it (`app/org.R7`,
  `kb/contract.R3`); the doc itself is `<home>/<prefix>` (`app/org`). Numbers only grow, by
  convention: the skill picks one above the highest number the doc has ever had (its git history
  answers what a removed id said). When two PRs claim the same id, the later-merging one
  renumbers, as with ADR numbers.
- **Groups.** Rules are always `###` headings. A group is a bold label line between them, never a
  heading. Checked against the pilot doc: its 32 rule headings stand as
  they are; its six `### <group>` headings become bold labels.
- **Rule shape (guidance, not a gate).** A rule is one observable guarantee in SHALL/MUST
  sentences plus an example. Split a rule whose SHALLs name different actors or different
  outcomes; several SHALLs about one guarantee are fine (20 of the pilot's 32 rules have two or
  three). A doc that passes about three screens of rules is split by sub-capability; the new doc
  gets its own prefix, and moved rules get new ids there.
- **`Source:`** is optional; absent means the rule was not decided by a record. It names a record
  (`app/ADR-0009`) or a rule (`kb/ADR-0001.R2`); a rule id is checked only when the record has
  numbered rules, so legacy records are cited whole. A rule may restate its source in its own
  words, but the ADR wins: where they differ, the rule is what gets fixed.
- **The doc is where product behaviour is decided.** A rule without a `Source:` is decided by the
  doc itself: the PR that adds or changes it is the decision, its approval is the record, and git
  shows who and when. Product policies (who sees what, who may do what, consent, billing access)
  belong here, not in ADRs, unless they are hard-to-reverse architecture. A repo that wants a
  named group to approve changes to a sensitive doc adds a CODEOWNERS line for it.
- **Known deviations** (optional): `- <rule id>[, <rule id>…]: <what the code does instead>
  (<ticket>)`, for intended rules the code does not meet yet. It is how a derived doc records a
  bug without dropping the rule it breaks. An entry as it stands on the base branch exempts
  code, new or existing, that shows exactly the behaviour it describes, not a wider break. An
  entry the diff adds or edits exempts nothing new in that diff, and the PR lists an added one
  on its `- Rules:` line (`deviation added app/org.R7`).
- **Not yet decided** is required (it may say "none"). It tells agents where not to invent an
  answer.
- **Scope** is doc-level only; split a doc rather than narrowing per rule. Globs follow the home's
  syntax (prefixed `repo:glob` in the shared home). Prefer directory globs to file names.
- **Evidence** (file and line, test names) is kept out of the doc: it rots and duplicates the code.
  The derivation draft is required for a derived doc and is kept in the PR that introduced it (as
  a comment, or under the archived-spec path). That PR states, per rule, whether it was marked
  intended, bug or undecided, and by which named person. Agents derive; only people mark.
- **Rule-tagged tests** (optional): a test name or trait carrying the rule id (`org.R18`) is a
  strong signal for the review. Not required, not validated.

## Lifecycle

Behaviour docs are living. **In a local home**, a rule changes in the PR that changes the
behaviour. The PR body lists the rule edits (added, changed, removed ids) next to its ADR
*Decisions* and names who should approve them, so the human reviewer reviews the rule diff, not
only the code. Nothing checks that list against the doc diff mechanically.

**In the shared home**, the doc changes in its own KB PR, and the KB PR merges first; until it
does, a code PR that breaks the rule on the KB's default branch is blocked (the admin bypass is
the only override). Nothing in the PR description switches a finding off. The code PR lists its
rule edits on the `- Rules:` line of its *Decisions* (`references/pr-decisions.md`). The KB's CI
validates the doc; a code repo's CI sees only the KB's default branch.

When an ADR a rule cites is superseded, the rule is not edited automatically: the
validator warns on the `Source:`, and the superseding PR (or a follow-up) updates the rule.

**Brainstorming** runs `select --paths` over the planned paths and, only when a doc is selected,
asks whether the change adds, changes or removes any of its rules. The answer becomes part of the
design and, in the implementing PR, the doc edit and its PR-body list. No spec section is
required and nothing is copied into the plan.

## Enforcement in review

The ADR review step gains behaviour docs. The architect's catalogue greps behaviour homes too;
every rule in a doc on the default branch binds, a rule a code PR edits in a local doc binds as
edited, a shared doc on an unmerged KB PR branch does not bind yet, and `bind` returns matching
rules beside binding ADRs.

1. **Candidate selection (deterministic):** `adr-lint.js select` returns behaviour docs whose
   `scope` matches the diff, and every doc whose own file the diff touches (reason `touched`),
   from both homes, next to the ADRs. It adds every record a selected doc's rules name in
   `Source:` (the record, reason `source`), which the reviewer attests like any selected
   record; one its available home lacks is `missing` and becomes a dangling finding, and one
   whose home is not on disk is not selected. Selection fails closed (exit 2, naming the path)
   when it cannot tell what a doc binds: the patch deletes a doc or moves it to a path that is
   not a doc in the same home (read from the patch, not the working tree; a rename within the
   home, recognised only from git's rename markers, keeps the doc; a copy is not a move), a doc
   starting with `---` whose frontmatter is unclosed or has an error on `scope`, `prefix` or an
   unparseable line, a touched doc with no frontmatter, a selected doc with no `## Rules`
   section as parsed, or an unreadable entry. A file with no frontmatter is a note, not a doc,
   unless the diff touches it without showing it was a note before. Retiring a doc therefore
   needs the admin bypass.
2. **Judgment:** the architect's `check` mode reports one more finding class, `behaviour-rule`:
   **the diff breaks rule `<id>` as the diff leaves it** (a rule the PR edits is judged in its
   edited form; a rule it removes no longer binds; editing one rule never exempts the others),
   which `adr-lint verdict` marks **critical**, the same as contradicting an accepted ADR. It is
   added to the findings schema v1's `class` enum (additive; see `references/adr-findings.md`).
   A broken rule is always a `behaviour-rule` and a contradicted record always a
   `contradiction`: when a rule's `Source:` record is contradicted by the same change, both are
   reported. Every selected doc is attested in `coverage.checked` (doc ids, not rule ids)
   whether or not it is reported. `verdict` qualifies a doc-local rule id (`device.R2`) when
   exactly one selected doc has that prefix, and exits 2 otherwise.
   For each selected doc, `check` reads each changed file at head and the patch's removed lines,
   not only the hunks, so it can tell a rule the diff broke from one that was already broken; no
   separate base read and no tooling. Known deviations and already-broken code
   exempt the specific break they describe, not the rule: a *Known deviations* entry as it
   stands on the base branch exempts code, new or existing, that shows exactly the behaviour it
   describes (a wider break is a finding), and an entry the diff adds or edits exempts nothing
   new in that diff. A break the base
   code already had (visible in the removed lines or in code the diff does not change) is not a
   finding, even when the diff moves or reformats it; a new or wider break is, and without
   evidence in the patch the break is new. Rule-tagged tests the diff edits or
   deletes are a strong signal.
3. **Override:** every Critical finding blocks, as for ADRs: conform, edit the rule (in the same
   PR for a local doc; in a KB PR that merges first for a shared one), or merge through the
   repository's admin bypass of the required check, used by the team's bypass group. For a rule
   with a `Source:`, the record wins: conform, or replace the record; editing the rule alone is
   not a fix. Nothing in the PR description switches a finding off.

### Until the review check ships

*Superseded by 3.5.0, which ships the review check; kept as the history of the interim process.*

Nothing reads behaviour docs at review time before plan D's review step lands. Until then the
household runs it as process: a PR that changes a documented behaviour lists the rule edits in its
*Decisions* section (a PR-template line), the reviewer reads the doc for the touched scope, and a
repo may add a CODEOWNERS line for docs it wants an owner to approve.

## The skill

**Front door: the `documenting-behaviour` skill**, in the recording-decisions layout: `SKILL.md`
holds the request table, the homes step and the dispatch; `actions/<action>.md` one file per
action; the format lives in `references/behaviour-docs.md` (Plan D), and the skill links to it.
`/lore:behaviour <plain words>`
(`commands/behaviour.md`, Codex `skills/lore-behaviour`) is an alias that reads the skill; there
is no subcommand grammar. Actions:

- **derive** — an agent reads the code, tests and related ADRs and writes a scratchpad draft:
  rules with an example and evidence each, a proposed `scope` (directory globs from the evidence
  files), deviation candidates, *Not yet decided*, and *Discrepancies* (code vs ADRs vs docs vs
  UI). Draft only. The person edits it into the doc by hand: a bug keeps its intended rule plus a
  deviation with a ticket; an undecided rule moves to *Not yet decided*.
- **edit** (add, change or remove a rule: show, confirm, write) and **list** (docs and rule
  counts per home).

**Writes go through the knowledge-updater** with a new Type `behaviour` (Home, homes JSON and lint
path required, as for `adr`). Branches: `behaviour/<repo>-<prefix>-<action>-<YYYYMMDD>` in a
local home, `knowledge/behaviour-<prefix>-<action>-<YYYYMMDD>` in the shared home, `-2`, … when
taken. Ride-along on the user's implementing branch is the default placement for a rule edit in a
local home; a new doc, and any shared-home edit, is `own-pr`.

## The validator and CLI

`adr-lint` grows rather than forks:

- **`homes`** JSON gains `behaviourDir` per local home and `sharedBehaviourHome` /
  `sharedBehaviourRelDir` (the repo root and default branch are the existing shared-home fields). The architect greps their frontmatter.
- **`check <dir>`** recognises a behaviour dir through the same `--home/--repo/--single-home/
  --base/--ci` flags, so pre-commit and CI add one line per home kind. Errors: missing
  `title`/`description`/`tags`/`prefix`/`scope`, non-inline values, a bad or duplicate `prefix`,
  a `###` under *Rules* that is not `<prefix>.R<n> <name>`, a duplicate id, an unresolvable
  `Source:` or `related` (through the ADR resolver; a home not on disk is only warned about, and
  in a household an unknown home prefix is an error), `scope` syntax wrong for the home (the ADR `SHARED_SCOPE`/`PREFIXED` rules), no *Not yet
  decided*. Warnings: a rule without SHALL/MUST or an example, a superseded source,
  a glob matching no file in a checked-out repo, a *Known deviations* id not in the doc.
  `## Rules` is required, and `scope` non-empty. A dir is a behaviour home when it is a resolved
  one, or, with `--home`, when its path ends in that kind's configured behaviour dir. `--base`,
  `--ci` and `--strict` change nothing for it. A dir checked as an ADR home that holds no
  records but a `.md` with a `prefix:` key exits 2: it looks like a behaviour home `check` does
  not recognise. `check` also warns on a rule heading inside fenced code under *Rules* and on a
  `####` heading there, and names a section heading that differs only in case.
- **`select`**: `select --json`'s `kind` is `adr` or `behaviour`; a behaviour doc's status is `-`
  and its id is `<home>/<prefix>`. The tab-separated output is unchanged. A behaviour rule id
  under the PR's `## Decisions` cites its doc. `select` and `verdict` exit 2 when a selected
  behaviour doc shares its id with another doc, when a doc in the diff's scope or touched by it
  has no usable prefix, and in the fail-closed cases under *Enforcement in review* (so a
  malformed doc fails closed even where CI does not run `check` on behaviour dirs).
- **`index`** lists, per record, the rules that cite it in `Source:` ("implemented by").

## Delivery

Two implementation plans:

- **D. Format, homes and review**: document format, configuration, `homes`/`check`/`select`/
  `index`, the architect's catalogue and finding, the review mapping, the `cultivate` domain
  template's *Behaviour docs* link list, tests. It lands after ADR Plan C, which left two hooks:
  `select --json`'s `kind` field, so consumers tell the kinds apart by `select --json`'s `kind`
  (the tab-separated output is unchanged); and
  the `SEVERITY` table in `scripts/adr/verdict.js`, keyed by finding class, so this finding is
  one row. `check` reads each changed file at head and the patch's removed lines, with no
  separate base read. Delivered in 3.5.0.
- **E. The skill**: `documenting-behaviour` with `derive` (draft only), `edit` and `list`, the
  aliases, the knowledge-updater Type and the brainstorming question.

## Testing

- Validator fixtures per rule, including the pilot's shapes: bold-label groups, multi-SHALL
  rules, a whole-record `Source:` on a legacy ADR; plus a non-rule `###`, prefix `adr`, a dead
  scope glob, a superseded source, a KB-home doc without `tags`.
- Babashka scenarios: `select` by scope with `kind`; the review blocking on a broken rule
  (critical), an ADR-sourced rule broken together with its record (both findings), a known
  deviation not reported, a shared rule broken by a code PR blocks.

## Open items

- **`mark` and `finish`** (interactive marking, a findings report, writing the doc from a marked
  draft) are deferred. The pilot took about 70 minutes to mark 30 rules and 6 questions; build
  them only if hand-editing derived drafts proves too slow.
- **Cross-checking the PR's rule-edit list against the doc diff** (`check --pr-body`) is
  deferred; add it if the two drift in practice.
- **Renumbering and moving** rules (splits, local→shared moves) is done by hand for now.
- **Choices made where the review left it open, simplest first:** groups as bold labels (not
  `####` rules); `title`/`description`/`tags` required in both homes; no `--base`-dependent rules;
  a split gives moved rules new ids rather than aliases; a thin `edit` action so rule edits
  reach the knowledge-updater through the skill.
- A readable rendering for non-technical readers, if markdown on the code host is a barrier.
- Whether `derive` proposes `scope` globs reliably, or the person sets them by hand.
