# ratify

Read `<plugin-root>/skills/recording-decisions/reference/record-format.md` and
`<plugin-root>/skills/recording-decisions/reference/lifecycle.md` first.

1. **Find the record** in the working tree, on the open PR branch that carries it, or on
   `origin/<default>`. For a PR branch you do not know, `gh pr list --repo <owner/name> --search
   <filename or ADR-NNNN>` (or `git -C <repo> ls-remote --heads origin`) names it; then
   `git -C <repo> fetch origin <branch>` and `git -C <repo> show origin/<branch>:<relDir>/<file>`.
   Never switch branches. Accept needs `status: proposed`, or a legacy record (accepting a legacy
   accepted record converts it). Reject needs `status: proposed` (legacy proposals included); an
   accepted record is never rejected.
2. **Name the ratifier**, the human who approves or turns down the record. Use the name the user
   gave; otherwise ask "Who approved this?" Never infer a name from git config, the session or
   the PR author; refuse an agent (rule 2). The ratifier is not `decided_by`, which names who took
   the decision. If `decided_by` is empty, ask "Who took this decision?" (for a rejection, who
   proposed it) and fill it in the same change. If the ratifier is among `decided_by`, say the
   expectation is that someone else approves, and go ahead only if the user says nobody else is
   available.
3. **Make it complete first.** Classify it if it has no `reversibility` (with `id` and `scope`),
   and add the high-tier extras if it lacks them (not needed for a rejection). Convert a legacy
   record into the template from its old text, keeping its meaning, its Status lines and its
   recorded deciders verbatim (`deciders` may carry over as `decided_by` with the same names;
   `decided_by` is added only when none are recorded); a status its prose already states only
   moves forward (prose "Superseded by <an approach>" may become `deprecated`). Show any such change with the edit.
4. **Edit.** The Status line naming the ratifier is the last line of `## Status`. Accept:
   `status: accepted` and `Accepted YYYY-MM-DD by <ratifier>.` (re-ratifying a legacy record
   already accepted: `Ratified YYYY-MM-DD by <ratifier>.`). Reject: `status: rejected` and
   `Rejected YYYY-MM-DD by <ratifier>: <one-line reason>.` (a rejected record merges and stays; it
   never touches a predecessor). The ratifier never goes into `decided_by`.
5. **Predecessors** (accept only, for each id in `supersedes`): in the same home, flip it in the
   same change — `status: superseded`, `superseded_by: <this id>`, and one Status line
   `Superseded YYYY-MM-DD by <this id>.` In another home, see `replace.md`.
6. **Show, confirm, apply,** passing the ratifier and `decided_by` to the updater. Then: the PR
   can merge once checks pass; for a ride-along, commit the staged acceptance with the code and
   push first.
