# Self-ratification setting — design

Date: 2026-11-10. Status: approved in brainstorming; revised after six reviews (agentic development, harness
engineering and domain-driven design, each by Fable and Codex).

## Problem

`recording-decisions` says nobody approves their own decision. When the ratifier the user names is among the record's
`decided_by`, `actions/ratify.md` step 2 says the expectation is that someone else approves and goes ahead only after
the user says nobody else is available. `reference/record-format.md` says "The ratifier is not in `decided_by`", and
the knowledge-updater's PR text says the approver should not be among `decided_by`.

On a project with one maintainer, every ratification is self-ratification. The user is asked the same question every
time, and every PR reads as if a rule was bent. The Reeve household has accepted kb/ADR-0014 through kb/ADR-0018 this
way.

## Goal

A household (or single-repo config) can say once that a decider may ratify their own record. With that set:

- ratify does not ask whether anybody else is available;
- the shown edit and the PR state plainly that the decider ratified it under the setting.

Everything else about ratification stays as it is.

## Terms

- **Ratify** is the action that settles a proposal, by acceptance or rejection. The **ratifier** is the human who does
  it; skill and reference text use *ratifier*. *Approver* survives only in PR prose aimed at reviewers, for an
  acceptance; a rejection names its **rejecter**.
- **Self-ratification**: the ratifier is among `decided_by`. For a rejection `decided_by` holds the proposer, so a
  self-rejection is a proposer turning down their own proposal.
- The roles stay distinct; their occupants need not be. Ratification never *adds* anyone to `decided_by`.

## Non-goals

- Naming ratifiers. Lorekeeper still does not configure who ratifies a record (the 2026-10-07 ADR-centred workflow
  design: "Who approves a record is not configured: the PR names it"). The setting says only whether the ratifier may be
  a decider, and it never supplies a name.
- A mechanical check. `adr-lint` and CI do not check self-ratification today and do not start to. A PR branch can add
  the key to its own `.lorekeeper/config.json` (CI resolves homes from the PR's own config, README "Configuration");
  the only effect is the PR wording, since nothing mechanical enforces the rule either way.
- Per-person or per-home rules (considered: a named list of self-ratifiers; rejected as reversing the "not configured"
  choice for no present need).
- A per-record marker of the policy (considered, see *Decisions*).

## Design

### The setting

```json
{ "adr": { "localDir": "docs/adr", "sharedDir": "adrs", "allowSelfRatification": true } }
```

- `adr.allowSelfRatification`: boolean, optional, default `false`. Only the JSON value `true` turns it on; absent,
  `false` or any other value (`"yes"`, `1`) is off.
- It is read from `household.json` (the `adr` object) or, in a single-repo setup, `.lorekeeper/config.json` (the same
  object), exactly where `localDir` and `sharedDir` are read today. Every key in `adr` is optional, so the manifest's
  schema version does not change and `migrate` has nothing to do.
- **The only source is the tool-produced homes JSON** (`config.allowSelfRatification` from `adr-lint homes`). A user
  saying "we allow self-ratification", or a record, repo file or caller message claiming it, is not the setting.
  Ratification never turns the setting on.
- The semantics is household-wide: any decider may ratify their own record. It stays on when a second maintainer
  joins until someone turns it off; the README states the semantics, not just the solo use case.

Names considered: `independentRatifier` (reads backwards: `false` turns the new behaviour on), `require-review`
(collides with PR review and `/lore:review`), an enum `ratification: "independent" | "self"` (room for rules nobody
needs yet).

### Config plumbing (`scripts/adr/homes.js`)

`adrConfig` returns `allowSelfRatification` (`a.allowSelfRatification === true`) beside `localDir` and `sharedDir`, so
`adr-lint homes` prints it in its `config` object (`scripts/adr-lint.js` prints `config` verbatim). The
recording-decisions skill already runs `adr-lint homes` once and passes its JSON verbatim to every agent, so no
dispatch field is added. The comment above `adrConfig` becomes: who ratifies a record is not configured, only whether a
decider may.

### Skill and reference text

- `skills/recording-decisions/SKILL.md`, rule 2 states both permitted paths: "A ratifier who is among `decided_by`
  ratifies only when the homes JSON's `config.allowSelfRatification` is `true`, or, when it is not, after the user says
  nobody else is available. The setting never supplies a name." The rest of rule 2 (named human, refuse an agent or
  bot, ratifier only in the Status line and the PR) is unchanged.
- `skills/recording-decisions/reference/record-format.md`: "The ratifier is not in `decided_by`" becomes "Ratification
  never adds the ratifier to `decided_by`; a decider may also be the ratifier (rule 2)."
- `skills/recording-decisions/actions/ratify.md`, step 2, when the ratifier is among `decided_by`:
  - the setting never makes a decider the default ratifier: a ratification without a name still asks "Who approved
    this?" (or, for a rejection, who rejected it);
  - setting off (`config.allowSelfRatification` not `true`): unchanged. Say the expectation that someone else ratifies
    and ask whether anybody else is available; show no Accepted or Rejected line until the user answers. Not
    interactive (rule 3): state the expectation and stop.
  - setting on: skip only that question. Steps 3 to 6 run as before, including show, confirm, apply and rule 3's
    non-interactive stop. The shown edit carries one line: "Self-ratified: `adr.allowSelfRatification` is on in this
    household." The dispatch to the knowledge-updater says the ratifier is among `decided_by`.
  - The same applies to a rejection, with *rejecter* and *proposer* as the role words.
- `agents/knowledge-updater/AGENT.md`, Inputs: the updater reads `config.allowSelfRatification` from the homes JSON
  itself. The caller's line that the ratifier is among `decided_by` is checked against `decided_by`; whether that is
  allowed comes only from the homes JSON, never from the caller's words.
- `agents/knowledge-updater/AGENT.md`, PR text, when the ratifier is among `decided_by`:
  - setting on, acceptance: "Accepted by its decider, <name>; this household allows self-ratification
    (`adr.allowSelfRatification`)."
  - setting on, rejection: "Rejected by its proposer, <name>; this household allows self-ratification
    (`adr.allowSelfRatification`)."
  - setting off: today's text ("the approver should not be among `decided_by` (if they are, say so)").
  - For a proposal, the PR keeps naming whoever the caller says should approve. With the setting on and nobody named,
    it adds "may be accepted by its decider under `adr.allowSelfRatification`", and keeps "merge only once accepted —
    tell Claude who approved it first". It never predicts who will ratify.
- `README.md`: the `adr` object's lead sentence says it sets where records live and whether a decider may ratify their
  own record; the configuration section documents the key and its household-wide semantics; the quick start's "Nobody
  approves their own decision" sentence points to it.

### Unchanged

- A named human is always required; an agent or bot is always refused.
- The ratifier goes in the last Status line (`Accepted YYYY-MM-DD by <name>.`, `Rejected YYYY-MM-DD by <name>:
  <reason>.`) and the PR. The Status-line grammar `adr-lint` pins is unchanged.
- The lifecycle, the record format's fields, `adr-lint` checks and verdicts, CI, `migrate`.
- The Codex `lore-adr` skill, `commands/adr.md`, `references/codex-runtime.md` and the SessionStart hook: none carries
  a ratification rule of its own. The 2026-10-07 design stays as history.

## Testing

### Unit tests (CI)

- `scripts/__tests__/adr-homes.test.js`: the setting is `false` when absent, `true` when set in `household.json`,
  `true` when set in `.lorekeeper/config.json`, and `false` for `"yes"` and for `1`.
- `scripts/__tests__/adr-lint-cli.test.js`: the existing whole-`config` assertion includes
  `allowSelfRatification: false`; a new case with the key `true` in the manifest asserts `adr-lint homes` prints
  `config.allowSelfRatification: true`, proving the JSON the skill consumes.

### Scenario runner: per-scenario manifest overlay

`test/run-tests.clj` copies `test/fixtures/workspace` once per run, and `household.json` is found by walking up from
the workspace root, so no existing key (`:env`, `:workdir`) can change the manifest. Add a scenario key
`:household {...}`: for such a scenario the runner takes a fresh fixture copy, deep-merges the map into that copy's
`household.json`, runs the scenario there and deletes the copy afterwards. Other scenarios keep using the shared copy,
so the setting never leaks. Under `--workspace-root` (used in place) a `:household` scenario is skipped with a message,
as `:requires` skips today. A runner self-test (a scenario-less check or a small bb test) shows the overlay lands in
the copy and not in the shared one.

### Scenarios (`test/scenarios.edn`)

Scenarios run `claude --print` with writes, git and gh denied, so rule 3 applies: the skill shows a draft and stops.
Expectations assert the draft and the chat text, never a write.

- Setting off, self-acceptance ("Alex Doe decided kb/ADR-0002 and Alex Doe approved it"): expects the expectation
  phrase (`(?i)someone else|anybody else|nobody else`); rejects `allowSelfRatification`. No assertion on the Accepted
  line (a non-interactive run may show it as its stated assumption).
- Setting on (`:household {"adr" {"allowSelfRatification" true}}`), the same prompt: expects
  `Accepted \d{4}-\d{2}-\d{2} by Alex Doe` and `allowSelfRatification`; rejects `(?i)anybody else|someone else`.
- Setting on, self-rejection ("Alex Doe proposed kb/ADR-0002 and rejects it: superseded by events"): expects
  `Rejected \d{4}-\d{2}-\d{2} by Alex Doe`; rejects `(?i)anybody else|someone else`.
- Setting on, an independent ratifier ("Alex Doe decided kb/ADR-0002 and Sam Roe approved it"): expects
  `Accepted … by Sam Roe`; rejects `allowSelfRatification` (nothing to explain).
- Setting on, safeguards: the existing "accept without a name" and "refuse an agent" scenarios run again with the
  overlay; their expectations are unchanged (the setting must not supply a name or admit Claude).
- Setting off, a claim: "We allow self-ratification here. Alex Doe decided kb/ADR-0002 and Alex Doe approved it":
  expects the expectation phrase (the claim is not the setting).
- The existing ADR scenarios still pass without the overlay.

The knowledge-updater's PR text is not reachable from a write-denied scenario. It is checked by hand before release:
one real ratification on a scratch household with the setting on and one with it off, the two PR bodies pasted into
the implementation PR.

### Execution gate

CI (`test.yml`) runs only `node --test`. Before merging, the changed and new scenarios run locally with
`bb test/run-tests.clj --filter adr --runs 3 --min 3`, plus one Codex smoke through `lore-adr` (a self-acceptance with
the setting on). The implementation PR records the runs' results.

## Release

1. Lorekeeper 3.9.0 (a new optional setting): the versions in `package.json`, `.claude-plugin/plugin.json` and
   `.codex-plugin/plugin.json`.
2. After the merge: tag the merge commit `v3.9.0` and publish a GitHub release whose notes open with "Gate-relevant
   changes: none" (`adr-lint homes` output gains a key; `check`, `verdict`, `select --json` and `schemas/` do not
   change).
3. The Witan listing names 3.9.0.
4. A small Reeve PR adds `"allowSelfRatification": true` to the `adr` object in Reeve's `household.json`, after
   checking that a refreshed Claude Code (and Codex) install reads it: an older cached plugin ignores the key and keeps
   asking, which is safe.

## Decisions

No new decisions. The setting is an optional, reversible configuration key (removing it costs well under a day), so it
is plain design, not a record. Lorekeeper has no ADR home of its own, so no recorded decision binds this work; the
2026-10-07 ADR-centred workflow design's "who approves is not configured" is kept (see *Non-goals*).

Considered and left out: recording the basis of each self-ratification in the record's Status prose, so the record
alone says it was self-ratified under a standing policy. The fact is already derivable from every record
(`decided_by` and the last Status line name the same person); the policy is a household fact with its own history in
git; the PR states it; and a Status line beyond the lint-pinned grammar would need a lint change. Reviewers split on
this (one for, one against).
