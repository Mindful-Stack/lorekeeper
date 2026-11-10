# Self-ratification for solo households — design

Date: 2026-11-10. Status: approved in brainstorming.

## Problem

`recording-decisions` says nobody approves their own decision. When the ratifier the user names is among the record's
`decided_by`, `actions/ratify.md` step 2 says the expectation is that someone else approves and goes ahead only after
the user says nobody else is available. The knowledge-updater's PR text then says the approver should not be among
`decided_by`.

On a project with one maintainer, every ratification is self-ratification. The user is asked the same question every
time, and every PR reads as if a rule was bent. The Reeve household has accepted kb/ADR-0014 through kb/ADR-0018 this
way.

## Goal

A household (or single-repo config) can say once that a decider may ratify their own record. With that set:

- ratify does not ask whether anybody else is available;
- the PR states plainly that the decider accepted it under the setting.

Everything else about ratification stays as it is.

## Non-goals

- Naming approvers. Lorekeeper still does not configure who approves a record (the 2026-10-07 ADR-centred workflow
  design: "Who approves a record is not configured: the PR names it"). The setting says only whether the approver may
  be a decider.
- A mechanical check. `adr-lint` and CI do not check self-ratification today and do not start to.
- Per-person or per-home rules (considered: a named list of self-ratifiers; rejected as reversing the "not configured"
  choice for no present need).

## Design

### The setting

```json
{ "adr": { "localDir": "docs/adr", "sharedDir": "adrs", "allowSelfRatification": true } }
```

- `adr.allowSelfRatification`: boolean, optional, default `false`. Absent or `false` is today's behaviour.
- It is read from `household.json` (the `adr` object) or, in a single-repo setup, `.lorekeeper/config.json` (the same
  object), exactly where `localDir` and `sharedDir` are read today. Any value other than `true` counts as `false`.
- Every key in `adr` is optional, so the manifest's schema version does not change and `migrate` has nothing to do.

Names considered: `independentRatifier` (reads backwards: `false` turns the new behaviour on), `require-review`
(collides with PR review and `/lore:review`), an enum `ratification: "independent" | "self"` (room for rules nobody
needs yet).

### Config plumbing (`scripts/adr/homes.js`)

`adrConfig` returns `allowSelfRatification` beside `localDir` and `sharedDir`, so `adr-lint homes` prints it in its
`config` object. The recording-decisions skill already runs `adr-lint homes` once and passes its JSON verbatim to every
agent, so the ratify action and the knowledge-updater see the setting with no new plumbing. The comment above
`adrConfig` becomes: who approves a record is not configured, only whether a decider may.

### Skill text

- `skills/recording-decisions/SKILL.md`, rule 2: "Nobody approves their own decision" gains "unless the homes JSON's
  `config.allowSelfRatification` is true". The rest of rule 2 is unchanged.
- `skills/recording-decisions/actions/ratify.md`, step 2: when the ratifier is among `decided_by`:
  - setting off: unchanged (say the expectation, go ahead only if the user says nobody else is available);
  - setting on: do not ask; go ahead, and tell the knowledge-updater the record is self-ratified under
    `adr.allowSelfRatification`.
  The same applies to a rejection.
- `agents/knowledge-updater/AGENT.md`, the PR text: with the setting on and the approver among `decided_by`, the PR
  says "Accepted by its decider, <name>; this household allows self-ratification (`adr.allowSelfRatification`)" (for
  a rejection, "Rejected by its decider, …") instead of "the approver should not be among `decided_by`". For a
  proposal it names the decider as the expected approver. With the setting off the text is unchanged.
- `README.md`: the configuration section documents the key; the quick start's "Nobody approves their own decision"
  sentence gets a pointer to it for solo projects.

### Unchanged

- A named human is always required; an agent or bot is always refused (rule 2's list).
- The ratifier goes in the last Status line (`Accepted YYYY-MM-DD by <name>.`) and the PR, never in `decided_by`.
- The record format, `adr-lint` checks and verdicts, CI, `migrate`.
- The Codex `lore-adr` skill: it carries no ratification rule of its own.

## Testing

- `scripts/__tests__/adr-homes.test.js`: the setting is `false` when absent, `true` when set in `household.json`,
  `true` when set in `.lorekeeper/config.json`, and `false` for a non-boolean value such as `"yes"`.
- `scripts/__tests__/adr-lint-cli.test.js`: the `adr-lint homes` assertion on the whole `config` object includes
  `allowSelfRatification: false`.
- `test/scenarios.edn`:
  - without the setting, "Alex Doe decided kb/ADR-0002 and Alex Doe approved it" says someone else is expected to
    approve, or asks whether anybody else is available, and does not write the Accepted line yet;
  - with the setting (a fixture variant whose manifest sets it), the same prompt writes
    `Accepted <date> by Alex Doe` without asking and names the setting;
  - the existing scenarios (accept without a name, refuse an agent, ratify from plain words) still pass.

## Release

Lorekeeper 3.9.0 (a new optional setting): the versions in `package.json`, `.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json`. Then the Witan listing names 3.9.0, and a small Reeve PR adds
`"allowSelfRatification": true` to the `adr` object in Reeve's `household.json`.

## Decisions

No new decisions. The setting is an optional, reversible configuration key (removing it costs well under a day), so
it is plain design, not a record. Lorekeeper has no ADR home of its own, so no recorded decision binds this work; the
2026-10-07 ADR-centred workflow design's "who approves is not configured" is kept (see Non-goals).
