# amend

Read `<plugin-root>/skills/recording-decisions/reference/record-format.md` and
`<plugin-root>/skills/recording-decisions/reference/lifecycle.md` first.

1. **Find the proposal** as `ratify.md` does (working tree, open PR branch, or
   `origin/<default>`). It must be `proposed`; a locked record takes **note a change** or
   **replace** instead. A shared-home proposal already on the default branch (legacy) can only be
   ratified: offer **ratify**, folding the edit into the acceptance.
2. **Edit** what the user asked and nothing else. Keep `status: proposed` and `decided_by` unless
   the user changes who takes the decision, and re-run the format's *Self-check* on the sections
   you touched. A new `blast_radius` that moves the record to the other home makes it a new record
   there; the old proposal's file is deleted in its PR (or its PR closed).
3. **Show, confirm, apply.** The updater places it like a ratification: on the user's branch if
   the record is there, else on its PR branch, else in its own PR.
