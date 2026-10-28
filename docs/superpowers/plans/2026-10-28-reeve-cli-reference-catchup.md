# Plan: the Reeve CLI reference catches up with the merged CLI

Spec: `docs/superpowers/specs/2026-10-28-reeve-cli-reference-catchup-design.md`.

1. **Fake first (test-first).** Add tests to `scripts/__tests__/reeve-fake.test.js` for: `decision
   edit` (bump, conflict, closed refused, `--no-due`, an edit that changes nothing keeps the version,
   `--due` with `--no-due` a usage error, no change flag a usage error); `decision close` (closed shape, already closed); `decision check`
   (stored by default; only open decisions with a record are checked: `--only` naming one with no
   record, a closed one or an unknown id is `not_found` exit 1, and an unfiltered run leaves them out; `REEVE_FAKE_CHECK=held` exit 0 and
   with `--strict` exit 1 `internal`, `skipped` exit 0 even with `--strict`, `unreadable` exit 1);
   `decision link` carries `immediate_check` and `REEVE_FAKE_LINK_CHECK=held`; `story block` /
   `story unblock` (persisted `blocked_by`, readiness reason last, `blockers` in context, self-block
   refused, unblock of nothing ok). Then implement them in `test/fixtures/reeve-bin/reeve`.
2. **Helpers.** `scripts/__tests__/helpers/reeve-smoke.js`: `immediate_check` paths are absolute
   (test in `reeve-smoke.test.js`). `scripts/__tests__/reeve-reference.test.js`: `[a \| b]` keeps
   `a`; placeholders `BLOCKER`, `reason`.
3. **Reference.** New rows and sections as the spec says. The *decision link* table also splits
   the exit-1-with-`ok` case: with `refresh_error` the check ran (stored or held) and only the read
   back failed, so it is worded from `immediate_check.outcome` plus "run `decision show`"; without
   it, the check could not run here.
4. **Fixture.** `test/fixtures/reeve-real/commands.json`: bind the required decision; entries for
   `decision check`, `decision edit`, `decision close`, `story block`, `story unblock`; `version`
   read on `decision ls` / `show`; `blockers[]` no longer may be empty.
5. **Skills.** planning-initiative, refining-epic, recording-decisions `link.md` as the spec says.
6. **Docs.** `test/README.md` (the fake's new commands and modes), `CLAUDE.md` if it lists them.
7. **Version.** 3.3.1 → 3.3.2 in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
   `package.json`.
8. **Verify.** `node --test scripts/__tests__/*.test.js`; build the Reeve CLI on `main` and run the
   reference test with `REEVE_REAL_BIN`; Reeve's `mise run skill-smoke` with `LOREKEEPER_DIR` set
   to this worktree (0 failed, 0 skipped; note the test count against `min_tests=28`).
