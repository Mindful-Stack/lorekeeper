---
name: recording-decisions
description: Architecture decision records (ADRs) from plain words. Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, hosting, data model); when a named person approved or rejected a proposed decision record; when a fact an accepted record relies on no longer holds; when a decision is replaced, superseded, deprecated or dropped; when asked which decisions bind a change, path or area; or to list or discover ADRs. Not for PR approvals, reversible conventions, or routine implementation choices.
---

# Recording Decisions

An architecture decision record captures one hard-to-reverse decision, the forces behind it, and
the consequences accepted by making it. It is written **before** the code that depends on it,
reviewed through a PR, binding once a named human accepts it, and locked from then on. The user
just says what they decided or what changed; this skill picks the action. Retrieval and scanning
go to the **architect** agent, writing and the git flow to the **knowledge-updater** agent, and
every mechanical rule to `scripts/adr-lint.js`.

The plugin root is `${CLAUDE_PLUGIN_ROOT}`. The action and reference files call it
`<plugin-root>`: write that absolute path out in every Bash command and agent dispatch (the shell
does not expand it).

## The rule

1. **Show the edit, confirm, then write.** Every write goes through the knowledge-updater, on a
   branch or worktree: never on a default branch, never force-pushed. Drafts in the scratchpad
   need no approval.
2. **Only a named human ratifies.** Never infer the ratifier, never accept or reject on your own
   initiative, and refuse an agent or bot (Claude, Codex, Copilot, an AI or assistant, anything
   ending in `[bot]`). `decided_by` names who took the decision; the ratifier goes in the last
   Status line and the PR. Nobody approves their own decision.
3. **Not interactive?** If you cannot ask a question and wait for the answer (`claude -p`,
   `codex exec`, a CI job, a subagent), never write: draft, show what you would write with your
   assumptions stated, then stop. A ratification without a named human stops and says one is
   required. The knowledge-updater is dispatched only after the user confirmed.
4. **Record before building.** Code waits for a high-tier record to be accepted, and a proposal's
   PR merges only once it is accepted.
5. **Locked records change by the five edits only.** Anything else is a replacing record.

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
bare number resolves in the governed repo's local home, else every local home, then the shared
home; if more than one has it, ask which. Other teams' shared KBs are read-only: if a record lives
in one, say where and stop.

Pick one action from what the user says. If two fit, ask one question.

| The user says | Action |
|---|---|
| a decision, a choice, a title ("Use X for Y", "we decided …") | **record** |
| who approved or turned down a proposal ("accept 0004 by Alex", "Sam rejected kb/ADR-0003") | **ratify** |
| an edit to a record that is still proposed ("change 0007's scope …") | **amend** |
| a fact a record relies on changed, "observe" or "note on" ("F2 no longer holds") | **note a change** |
| a record is replaced, or they changed their mind about it ("supersede 0002 with …") | **replace** |
| a record no longer applies and nothing replaces it ("deprecate 0005, by Sam") | **retire** |
| which decisions apply to a change, a path, or a topic | **what binds** |
| nothing, or `list`, optionally a status | **list** |
| find the decisions the code already made | **discover** |

**This file holds no procedure.** Once you know the action, Read
`<plugin-root>/skills/recording-decisions/actions/<action>.md` (`record`, `ratify`, `amend`,
`note-a-change`, `replace`, `retire`, `what-binds`, `list`, `discover`) and follow it. Do not show
or write anything before you have read it. Each action names the reference files it needs.

## Homes

A record lives in exactly one **home**: the **local home** `docs/adr/` (or the configured
`adr.localDir` / `repos[].adrDir`) inside the repo whose code it governs, ids `<repo>/ADR-NNNN`;
or the **shared home** `adrs/` in the team knowledge base, ids `kb/ADR-NNNN`. The record's
`blast_radius` decides the home, so the user is never asked where it goes: `local` and `service`
go local, `cross-service` and `customer` go shared. When the two coincide (one repo, or no KB),
there is one home and ids use the local prefix. Numbers are per home and never reused.

For every action except list, run `node <plugin-root>/scripts/adr-lint.js homes` once and pass its
JSON verbatim to every agent. A `governedRepo` of `null` means ask which repo the record or path
belongs to, and a `null` default branch means ask which branch to base on (never assume `main`).
A repo with `present: false` is not checked out: say so when it matters, never guess its contents.

## Where a change lands

Every write is **show** the exact file or edit with its path, tier and where it will land;
**confirm**; **apply** by dispatching the knowledge-updater with Type `adr`, the action, the
file(s), the Home (`shared` or `local:<repo>`), the homes JSON, the line
`ADR lint: <plugin-root>/scripts/adr-lint.js`, who took the decision (`decided_by`), the ratifier
or the people who should approve, and whether the user wants to ride along on their branch. The
updater decides where the change lands. If it returns findings, show them, fix them with the user,
and apply again. Confirm with what it reports: where the change landed (PR URL or branch), why if
it fell back from what the user asked, and the next step.

For a decision surfacing mid-brainstorm, draft the record and link it from the spec: the spec
describes the design, the record defends the decision.
