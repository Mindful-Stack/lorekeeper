# amend

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` and
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md` first.

1. **Find the proposal** as for **ratify**
   (`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/ratify.md`, step 1: working tree, open PR
   branch, or `origin/<default>`). It must be `proposed`; a locked record takes **note a change** or **replace** instead.
2. **Edit** what the user asked and nothing else. Keep `status: proposed` and `decided_by` as it
   is unless the user changes who takes the decision, and re-run the record self-check (step 5 of
   `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/record.md`) on the sections you touched. A new
   `blast_radius` that moves the record to the other home makes it a new record there instead.
3. **Show, confirm, apply.** The updater places it like a ratification: on the user's branch if
   the record is there, else on its PR branch, else in its own PR.
