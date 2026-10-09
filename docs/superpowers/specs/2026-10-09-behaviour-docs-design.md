# Behaviour docs — design

**Date:** 2026-10-09
**Status:** approved design, ready for implementation plans (three, see *Delivery*)
**Builds on:** `2026-10-07-adr-centred-workflow-design.md` (homes, `select`, the review check)
**Touches:** `scripts/adr-lint.js` (new `behaviour` checks, `select` extended), `agents/architect`,
`skills/review`, `skills/brainstorming`, `skills/writing-plans`, `agents/plan-compliance-reviewer`,
new `commands/behaviour.md` + `skills/lore-behaviour`, `scripts/manifest-schema.json`, `README.md`

## Goal

Give reviewers and agents the one thing code cannot express: what must stay true, and why it
matters. ADRs already record why a hard-to-reverse choice was made. This design adds the
living counterpart: **behaviour docs**, which state the rules the system must keep, organised by
capability, kept current in the same PR that changes the behaviour, and checked by the same
review step that checks ADRs.

## The model: two durable documents and one spec section

| | ADR | Behaviour doc | Spec |
|---|---|---|---|
| Answers | **Why** we chose this | **What must be true now** | What this one change does |
| Changes | Locked once accepted; superseded to change | Edited in the PR that changes the behaviour | Archived after merge |
| Human review | The record itself | The rule diff, surfaced in the PR | Skim |
| Example | "Grants are scoped to an org or a project, because…" | "org.R7: a person may only grant roles strictly below their own" | "Add invite batching" |

They connect as **ADR → rule → code**. A rule that follows from a decision cites it
(`source: kb/ADR-0009.R2`) instead of restating it; a rule nobody decided explicitly has
`source: none`. A spec's required **Behaviour** section lists the rules the change relies on and
the rules it adds, changes or removes; the implementing PR applies those edits. That is the only
way rules are promoted from a change into a document.

A developer asks two questions: *is this a decision?* → an ADR; *must this stay true?* → a rule.

**Domain nodes in the knowledge base hold concepts and ownership only** (terms, what owns what,
which ADRs and behaviour docs apply). They link to behaviour docs and never carry rules.

## Non-goals

- **Grading rules as "invariant" vs "behaviour".** A pilot (30 rules for one capability, marked
  by the decision owner) found the decider's grade differed from the drafter's on 10 of 26 kept
  rules, in both directions, and the invariant share was 58%. The line is not stable enough to
  split documents or tooling on. Every rule is simply a rule.
- **Documenting everything.** Docs are created capability by capability when work touches a
  capability. The review check applies only where a doc's scope matches the diff.
- **Narrating the code.** A rule states an observable guarantee and an example; it never explains
  how the implementation works.

## Where behaviour docs live

The same two homes as ADRs, resolved the same way (see the ADR design's *Resolving the homes*):

| The capability… | Home |
|---|---|
| is implemented in one repo | `docs/behaviour/<capability>.md` in that repo |
| spans repos, or is a contract between repos | `behaviour/<capability>.md` in the team knowledge base |

Configuration extends the `adr` block's siblings: `household.json` gains an optional
`"behaviour": { "localDir": "docs/behaviour", "sharedDir": "behaviour" }` and a per-repo
`repos[].behaviourDir`. `.lorekeeper/config.json` accepts the same keys.

## The document

```markdown
---
capability: organizations-roles-invitations
prefix: org
owner: <person or code-host handle>
approval: reviewer            # reviewer | owner
scope: ["src/server/Endpoints/Orgs/**", "src/server/Endpoints/Invites/**", "src/client/src/lib/authz/**"]
related_adrs: [app/ADR-0008, app/ADR-0009]
domain: "[[domain/tenancy-and-membership]]"
retired: []                   # rule ids removed from this doc; never reused
---

# Organizations, roles and invitations

## Purpose
Two or three plain sentences a non-engineer understands.

## Rules

### org.R1 Creator becomes Owner
Whoever creates an organization SHALL become its Owner in the same step.
- Example: WHEN a signed-in user creates "Acme" THEN they are Acme's Owner.
- Source: none
- Scope: (optional; narrows the doc scope for this rule)

### org.R7 Strictly-below grant authority
…
- Source: app/ADR-0009.R2

## Not yet decided
- One line per open question, with the evidence that raised it.
```

- **Ids.** `<prefix>.R<n>`, qualified by home outside it (`app/org.R7`, `kb/contract.R3`).
  Numbers only grow. A removed rule's id goes into `retired:` and is never reused.
- **Size.** A rule is one SHALL sentence plus at most two examples. A doc that passes about three
  screens of rules is split by sub-capability.
- **Not yet decided** is required (it may say "none"). It tells agents where not to invent an
  answer.
- **Evidence** (file and line, test names) is kept out of the final doc: it rots and duplicates
  the code. It lives in the derivation draft and in the PR that introduced the rule.

## Lifecycle and approval

Behaviour docs are living. A rule changes in the PR that changes the behaviour, and that PR's
*Decisions* section lists the rule edits (added, changed, removed ids), so the human reviewer
reviews the rule diff, not only the code.

- `approval: reviewer` (default): the PR's normal approval covers the rule edits; the `owner` is
  informed.
- `approval: owner`: the owner must approve rule edits. The validator requires a CODEOWNERS entry
  for the doc's path naming the owner, so the code host enforces it. Intended for capabilities
  where a wrong rule costs money or exposure (billing, security, privacy).

When an ADR a rule cites is superseded, the rule is not edited automatically: the validator warns
on any `Source:` that points at a superseded or deprecated record, and the superseding PR updates
the rule.

## The spec's Behaviour section

Brainstorming adds a required section to every spec:

```markdown
## Behaviour
Relies on: app/org.R5, app/org.R7
Adds: org.R31 <one SHALL sentence>
Changes: org.R17 <new sentence> (was: <old sentence>)
Removes: org.R12 (<why>)
No documented capability affected: <say so explicitly when true>
```

Writing-plans copies the section into the plan's *Governing decisions and rules* header together
with the binding ADR rules. The plan-compliance reviewer checks that the implementing PR applied
every Adds/Changes/Removes line to the doc.

## Enforcement in review

The ADR review step gains behaviour docs:

1. **Candidate selection (deterministic):** `adr-lint.js select` returns behaviour docs whose
   `scope` (document or rule level) matches the diff, from the local and shared homes, next to the
   ADRs.
2. **Judgment:** the architect's `check` mode reports two more finding classes, both
   **Critical**:
   - **rule contradicted**: the diff breaks a rule in a selected doc and the PR does not change
     that rule;
   - **behaviour changed, doc not updated**: the diff changes observable behaviour a selected doc
     describes, and the doc is not edited in the PR.
   A diff touching a documented capability whose PR carries no *Behaviour*/rule edits is not a
   finding by itself; only an actual change of behaviour is.
3. **Escape hatch:** the existing `ADR-Exempt: <reason>` line covers behaviour findings too. One
   line, one log.

## Creating a doc: derive and mark

`/lore:behaviour` (new command and skill):

- **`derive <capability>`**: an agent reads the code, tests and related ADRs and writes a draft:
  rules with an example and evidence each, *Not yet decided* and *Discrepancies* (code vs ADRs vs
  docs vs UI). Draft only; nothing committed.
- **`mark <draft>`**: walks the decision owner through the draft with multiple-choice questions
  (up to four per round): intended / bug / undecided per rule, a follow-up asking which part is
  wrong for every bug, then each open question. It records the answers in the draft and reports
  the time taken.
- **`finish <draft>`**: writes the doc in its home without evidence or marking fields; bugs and
  decisions-that-become-work are listed as a findings report for the team's tracker (filing is a
  separate, confirmed step); discrepancies with ADRs become proposed observations. Opens the PR.

The pilot measured about 70 minutes to mark 30 rules and 6 questions interactively. The derive
step should aim for shorter rules (one sentence plus one example) to bring that down.

## The validator

`adr-lint.js` gains a `behaviour` check, run by the skill, pre-commit and CI:

- frontmatter: required keys, `approval` enum, inline values, `prefix` unique per home;
- rule headings match `### <prefix>.R<n> <name>`; ids unique; no id in both the doc and `retired`;
  given `--base`, a removed id must appear in `retired` and no retired id may reappear;
- each rule has exactly one SHALL/MUST sentence and at least one example;
- `Source:` is `none` or a resolvable ADR rule id; superseded/deprecated targets warn;
- `scope` syntax matches the home (prefixed `repo:glob` in the shared home);
- `approval: owner` requires a CODEOWNERS entry for the doc naming the owner;
- `Not yet decided` section present.

## Command and agent changes

- **`architect`**: `bind` returns matching behaviour rules beside binding ADRs; `check` gains the
  two finding classes.
- **`review`**: severity mapping and the shared escape hatch.
- **`brainstorming`**: the required *Behaviour* section.
- **`writing-plans`**: *Governing decisions and rules* header.
- **`plan-compliance-reviewer`**: checks the Behaviour section was applied.
- **`/lore:behaviour`**: `derive`, `mark`, `finish`, plus `list` (docs and rule counts per home).

## Delivery

Three implementation plans, in order:

- **D. Format, homes and validator**: document format, configuration, `adr-lint` behaviour check,
  `select` extended, tests.
- **E. Derive, mark, finish**: the `/lore:behaviour` command and skill.
- **F. Workflow enforcement**: architect finding classes, review mapping, brainstorming Behaviour
  section, writing-plans header, plan-compliance check.

## Testing

- Validator fixtures per rule, including retired-id reuse across `--base`, owner approval without
  CODEOWNERS, and a source pointing at a superseded ADR.
- Babashka scenarios: `select` returning a behaviour doc by scope; `check` reporting *rule
  contradicted* and *behaviour changed, doc not updated*; a PR that updates the rule passes;
  `ADR-Exempt` downgrades both.

## Open items

- A readable rendering for non-technical owners if reading markdown on the code host proves a
  barrier.
- Whether `derive` can propose `scope` globs reliably, or the human sets them at `finish`.
