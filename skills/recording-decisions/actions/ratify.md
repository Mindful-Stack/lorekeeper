# ratify

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` and
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md` first.

1. **Find the record** (in the working tree, on the open PR branch that carries it, or on
   `origin/<default>`). To read a record that is only on a PR branch,
   `git -C <repo> fetch origin <branch>` and
   `git -C <repo> show origin/<branch>:<relDir>/<file>`; never switch branches. Accept needs
   `status: proposed`, or a legacy record (accepting a legacy accepted record converts it).
   Reject needs `status: proposed` (legacy proposals included); an accepted record is never
   rejected.
2. **Name the ratifier**, the human who approves or turns down the record. Use the name the user
   gave; otherwise ask "Who approved this?" Never infer a name from git config, the session or
   the PR author. Refuse an agent or bot (Claude, Codex, Copilot, an AI or assistant, anything
   ending in `[bot]`): an agent never ratifies. The ratifier is not `decided_by`: `decided_by`
   names who took the decision. If it is still empty, ask "Who took this decision?" (for a
   rejection, who proposed it) and fill it in the same change. Nobody approves their own
   decision: if the ratifier is among `decided_by`, say the expectation is that someone else
   approves, and go ahead only if the user says nobody else is available.
3. **Make it complete first.** A proposal is still a draft, so before the edit: classify it if it
   has no `reversibility` (with `id` and `scope`), add the high-tier extras if it lacks them (not
   needed for a rejection), and convert a legacy record into the template from its old text,
   keeping its meaning, its Status lines and its recorded deciders (`decided_by` is added only
   when none are recorded). Show any such change with the edit.
4. **Edit.** Accept: `status: accepted` and append `Accepted YYYY-MM-DD by <ratifier>.` to
   `## Status` (re-ratifying a legacy record that is already accepted:
   `Ratified YYYY-MM-DD by <ratifier>.`). Reject: `status: rejected` and
   `Rejected YYYY-MM-DD by <ratifier>: <one-line reason>.` (a rejected record merges and stays, so
   the reason is worth a sentence; it never touches a predecessor). The ratifier goes only in the
   Status line and the PR body, never into `decided_by`.
5. **Predecessors** (accept only, for each id in `supersedes`): in the same home, flip it in the
   same change — `status: superseded`, `superseded_by: <this id>`, and one Status line
   `Superseded YYYY-MM-DD by <this id>.` In another home, see **replace**
   (`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/replace.md`).
6. **Show, confirm, apply,** passing the ratifier and `decided_by` to the updater, and say the PR
   can merge once checks pass.
