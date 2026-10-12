---
name: recording-decisions
description: Architecture decision records (ADRs) from plain words. Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, hosting, data model); when a named person approved or rejected a proposed decision record; when a fact an accepted record relies on no longer holds; when a decision is replaced, superseded, deprecated or dropped; when asked which decisions bind a change, path or area; or to list or discover ADRs. Not for PR approvals, reversible conventions, or routine implementation choices.
---

# Recording Decisions

An architecture decision record captures one hard-to-reverse decision, the forces behind it, and
the consequences accepted by making it. It is written **before** the code that depends on it. The
user just says what they decided or what changed; this skill picks the action.

Architecture decision records are first-class knowledge: one hard-to-reverse decision per record,
numbered per home, reviewed through a PR, binding once a named human accepts it, and locked from
then on. This skill owns everything that needs the user in the loop. Retrieval and scanning go
to the **architect** agent, writing and the git flow to the **knowledge-updater** agent, and every
mechanical rule to `scripts/adr-lint.js`. `/lore:adr <plain words>` is the same thing as an
explicit shortcut.

For example:

- "We'll use PostgreSQL for orders" (or a choice surfacing mid-design) → **record** a proposal.
- "Alex Doe approved kb/ADR-0004" → **ratify** it, naming Alex Doe.
- "billing-api/ADR-0002: invoices now exceed the 10k/day in F2" → **note a change** on the record.
- "What decisions apply to src/Billing?" → **what binds** the change.

## The rule

**Show the edit, confirm, then write. Never ratify on your own: a ratification needs a named
human**, never an agent. Accepted records are locked: what changed goes in an observation or a
replacing record, never an edit of the old body.

1. **Show the edit, confirm, then write.** Every write goes through the knowledge-updater, on a
   branch or worktree: never on a default branch, never force-pushed. Drafts in the scratchpad
   need no approval.
2. **Only a named human ratifies.** Never infer the ratifier, never accept or reject on your own
   initiative, and refuse an agent or bot. `decided_by` names who took the decision; the
   ratifier goes in the Status line and the PR. Nobody approves their own decision.
3. **Not interactive?** If you cannot ask a question and wait for the answer (`claude -p`, a CI
   job, a subagent), treat the session as not interactive: never write; draft, show what you
   would write with your assumptions stated, then stop. A ratification without a named human
   stops and says one is required. This governs authoring, not applying: the knowledge-updater
   is dispatched only after the user confirmed, and it applies that confirmed edit under its
   placement safeguards.
4. **Record before building.** High-tier code waits for its record to be accepted; a low-tier
   record is accepted before its PR merges.
5. **Locked records change by the five edits only.** Anything else is a replacing record.
6. **Numbers are per home and never reused;** homes come from `adr-lint homes`, never a
   hard-coded list.

## Understand the request

The request is in plain words. There are no subcommands to learn. Typed as a command:

```
/lore:adr Use PostgreSQL as the primary datastore
/lore:adr Alex Doe approved kb/ADR-0004
/lore:adr Change 0007's scope to src/Billing/** and src/Invoices/**
/lore:adr billing-api/ADR-0002: invoices now exceed the 10k/day in F2
/lore:adr Replace 0002: move session state from cookies to bearer tokens
/lore:adr What decisions apply to src/Billing in billing-api?
/lore:adr list
/lore:adr find the decisions the code already made
```

A record is named by its qualified id (`kb/ADR-0004`, `billing-api/ADR-0002`) or a bare number. A
bare number resolves in the governed repo's local home first, then the shared home; if both have
it, ask which. Other teams' shared KBs are read-only: if a record lives in one, say where and stop.

Pick one action from what the user says. If two fit, ask one question.

| The user says | Action |
|---|---|
| a decision, a choice, a title ("Use X for Y", "we decided …") | **record** |
| who approved or turned down a proposal ("accept 0004 by Alex", "Sam rejected kb/ADR-0003") | **ratify** |
| an edit to a record that is still proposed ("change 0007's scope …") | **amend** |
| a fact a record relies on changed ("F2 no longer holds", "invoices now …") | **note a change** |
| a record is replaced, or they changed their mind about it ("supersede 0002 with …") | **replace** |
| a record no longer applies and nothing replaces it ("deprecate 0005, by Sam") | **retire** |
| which decisions apply to a change, a path, or a topic | **what binds** |
| nothing, or `list`, optionally a status | **list** |
| find the decisions the code already made | **discover** |

Once you know the action, Read
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/<action>.md` and follow it: `record.md`,
`ratify.md`, `amend.md`, `note-a-change.md`, `replace.md`, `retire.md`, `what-binds.md`,
`list.md`, `discover.md`. The record format is in
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` and the lifecycle
in `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md`; each action says
which it needs.

## Homes

A record lives in exactly one **home**: the **local home** `docs/adr/` (or the configured
`adr.localDir` / `repos[].adrDir`) inside the repo whose code it governs, ids `<repo>/ADR-NNNN`;
or the **shared home** `adrs/` in the team knowledge base, ids `kb/ADR-NNNN`. The record's
`blast_radius` decides the home, so the user is never asked where it goes: `local` and `service`
go local, `cross-service` and `customer` go shared. When the two coincide (one repo, or no KB),
there is one home and ids use the local prefix.

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js homes` once per invocation. Pass its JSON
verbatim to every agent; do not restate it. Two of its values matter here: a `governedRepo` of
`null` means ask which repo a new local record governs, and a `null` default branch means ask
which branch to base on (never assume `main`). A repo with `present: false` is not checked out:
say so when it matters, never guess its contents.

## Where a change lands

Every write follows the same three steps: **show** the exact file or edit with its path, tier and
where it will land; **confirm** with the user; **apply** by dispatching the knowledge-updater with
Type `adr`, the ADR action (the row you picked in *Understand the request*), the file(s), the
Home (`shared` or `local:<repo>`), the homes JSON, the line
`ADR lint: ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js` (written out as an absolute path), who
took the decision (`decided_by`), the ratifier or the people the user says should approve, and
the user's preference about riding along on their branch. The updater decides where the change
lands. If it returns findings, show them, fix them with the user, and apply again. Confirm with
what it reports: where the change landed (in words, plus the PR URL or the branch) and the next
step.

For a decision surfacing mid-brainstorm, draft the record and link it from the spec: the spec
describes the design, the record defends the decision.

**Not for** conventions reversible in an afternoon (a line in a standard or a learning) or routine
implementation choices (the PR description is enough).

## Red flags

| Rationalisation | Reality |
|-----------------|---------|
| "I'll write the ADR after it works" | Then it records a fait accompli, not a decision. Draft it now as proposed. |
| "This is obvious, nobody would choose otherwise" | Obvious decisions are re-litigated most. Name the alternative and the reason. |
| "It's in the design doc" | Design docs are point-in-time; the record is the durable, replaceable artefact. |
| "I'll just fix the accepted record" | Accepted records are locked. Note the change, or replace the record. |
| "I'll accept it so we can start" | Only a named human accepts. Ask who approved it; an agent never does. |
