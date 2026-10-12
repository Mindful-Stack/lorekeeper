# ratify

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` and
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md` first.

1. **Find the record** (in the working tree, on the open PR branch that carries it, or on
   `origin/<default>`). To read a record that is only on a PR branch,
   `git -C <repo> fetch origin <branch>` and
   `git -C <repo> show origin/<branch>:<relDir>/<file>`; never switch branches. Accept needs `status: proposed`, or a legacy record (accepting a legacy
   accepted record converts it). Reject needs `status: proposed` (legacy proposals included); an
   accepted record is never rejected.
2. **Name the decider.** Use the names the user gave; otherwise ask "Who approved this?" Never
   infer a name from git config, the session or the PR author. Refuse an agent or bot (Claude,
   Codex, Copilot, an AI or assistant, anything ending in `[bot]`): an agent never ratifies.
3. **Make it complete first.** A proposal is still a draft, so before the edit: classify it if it
   has no `reversibility` (with `id` and `scope`), add the high-tier extras if it lacks them (not
   needed for a rejection), and convert a legacy record into the template from its old text,
   keeping its meaning, its Status lines and its recorded deciders (the named decider must match
   them, or is added only when none are recorded). Show any such change with the edit.
4. **Edit.** Accept: `status: accepted`, `decided_by: [<names>]`, and append
   `Accepted YYYY-MM-DD by <names>.` to `## Status`. Reject: `status: rejected`, `decided_by`, and
   `Rejected YYYY-MM-DD by <names>: <one-line reason>.` (a rejected record merges and stays, so
   the reason is worth a sentence; it never touches a predecessor).
5. **Predecessors** (accept only, for each id in `supersedes`): in the same home, flip it in the
   same change — `status: superseded`, `superseded_by: <this id>`, and one Status line
   `Superseded YYYY-MM-DD by <this id>.` In another home, see **replace**
   (`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/replace.md`).
6. **Show, confirm, apply,** and say the PR can merge once checks pass.
