# note a change

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/lifecycle.md` first.

1. The record must be locked; a proposal takes **amend** instead.
2. Draft one dated bullet answering when and where (date, PR or ticket), which statement (quoted,
   or its `F#`), what is true now and its source, and what it means. Example:
   `- 2026-11-02 (PR 412): F2 no longer holds — invoices reach 14k/day (source: billing
   dashboard). No trigger fired; the decision holds.`
3. Append it at the end of `## Later observations` (add the section before *See also* if a legacy
   record lacks it). If a trigger fired, say so and offer **replace**.
4. Show, confirm, apply.
