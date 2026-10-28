# The Reeve CLI reference catches up with the merged CLI

## Problem

`references/reeve-cli.md` is the only place the planning skills take `reeve` commands from. The
merged Reeve CLI (Mindful-Stack/reeve `main`, `crates/reeve/src/commands/`) has grown past it:

- `decision link` now has a `held` outcome: a non-admin's immediate check that found the record
  accepted is not stored (only an admin stores the satisfying result, kb/ADR-0003 R3); it is held
  for the scheduled check, exit 0, `check.kind` stays `unchecked`, and the answer carries
  `immediate_check` (`{id, outcome, check?, error?}`) beside `value`.
- `decision check [--household <dir>] [--only <id>] [--strict]` reports `stored`, `held`,
  `skipped`, `unreadable` or `failed` per decision. `skipped` is a post refused because the
  decision moved on during the run (a 409 when it is closed or at another version, a 400
  `validation` only when it is closed): never a failure. `held` is a failure only under
  `--strict` (the scheduled admin run).
- `decision edit <id> --version <n> [--title] [--decider] [--due D | --no-due]` edits an open
  decision's planner-side fields; a stale version is `conflict`, a closed decision `validation`;
  the record reference is changed only with `link`.
- `decision close <id> --reason <text>` closes a decision without a record (`validation` when the
  reason is blank or it is already closed).
- `story block <key> --by <blocker>` and `story unblock <key> --by <blocker>` record and remove a
  block (answer `{}`); unblocking a block that does not exist succeeds and changes nothing.
  `story block` was missing from the reference too; the pair is added together.

The fake `reeve` (`test/fixtures/reeve-bin/reeve`) rejects all of these as usage errors, so a
skill that used them could not be tested.

## Design

1. **Reference.** New *Commands* rows for `decision edit`, `decision close`, `decision check`,
   `story block` and `story unblock`; `decision ls` gains `version` in its Read (an edit needs it).
   The *decision link* table gains the `held` row (read from `immediate_check.outcome`). A new
   *decision check* section says what each outcome means and how to word it, and that skills
   never pass `--strict`.
2. **Skills.**
   - planning-initiative step 5 and refining-epic step 5: a new decider, due date or title the
     user gives for an existing open decision is a `decision edit`; a decision the user says is no
     longer needed is a `decision close` with the user's reason (never one the skill invents; in a
     session that cannot ask, only when the request names the close and its reason).
   - refining-epic step 6: an order between stories the user names is a `story block`; a block the
     user says no longer holds is a `story unblock`.
   - recording-decisions `link`: the `held` row, and `decision check --only` to re-run a check that
     could not run here once the checkout is fixed.
   - brainstorming only reads `story context`: unchanged.
3. **Fake.** Supports the five commands with the planner's rules and answers: `decision edit`
   (version check, closed refused, unchanged edit keeps the version), `decision close`, `decision
   check` (open decisions with a record, `--only` not found, outcomes and exit status as the CLI
   computes them, `REEVE_FAKE_CHECK=held|skipped|unreadable` to produce the others), `story block`
   and `story unblock` (persisted: `blocked_by`, a `blocked_by` readiness reason for a blocker not
   done, after every other reason, and `story context` `blockers`). `decision link` answers with
   `immediate_check`, and `REEVE_FAKE_LINK_CHECK=held` behaves like a member's link of an accepted
   record.
4. **Smoke fixture.** One entry per new row, in an order that leaves something to read: the
   required decision is bound, edited (`--no-due`) and closed; the seeded decision is checked with
   `--only`; the seeded story is blocked by the placed one before `story context` (so `blockers[]`
   is read non-empty and is no longer waived as empty) and unblocked after it.
5. **Smoke helpers.** The Read cell parser accepts `immediate_check…` as a top-level envelope path
   like `value…`; the reference test fills an optional `[a | b]` group with its first alternative.

## Decisions

- Follows: kb/ADR-0003 (only an admin stores the satisfying check; closed decisions gate nothing),
  kb/ADR-0004 (the planner checks records by path; edit never touches the reference),
  kb/ADR-0005 (skills drive the planner only through the CLI) — the planner's records in
  Mindful-Stack/reeve.
- No new decisions. Adding `story block` beside `story unblock` is a scope call recorded in the PR.
