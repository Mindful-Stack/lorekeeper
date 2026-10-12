# record

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` first.

1. **Triage.** Will code depend on it, and does changing it cost more than a day? Say which:
   **record it** (expensive to reverse, crosses a boundary, or keeps being re-debated); **one
   line** (a reversible local convention: offer a line in a standard or a learning); **no record**
   (routine: the PR description is enough). A decision with no code behind it (a tool, a process)
   belongs in an RFC or meeting notes. Stop at a lighter option unless the user insists.
2. **Load context.** In parallel: the **architect** in `bind` mode with the topic, the homes JSON
   and the catalogue (`adr-lint index --json`, saved to the session scratchpad; plus
   `adr-lint select --repo <repo> --paths <a,b>` when the code paths are known, repo-relative),
   and the
   **knowledge-reader** with "Prioritise domain context and architecture patterns." If the
   architect names a record that already covers the decision, stop and offer ratify or amend (a
   proposal), replace (an accepted record), or nothing. Grep the code so Context and the facts rest on evidence.
3. **Interview, one question at a time,** skipping what the user already said: who is taking
   this decision (named humans, never an agent); who uses it and across which boundaries; the
   real alternatives and why they lost; **scope**; **facts** and where each can be checked; and
   the classification as one plain multiple choice — "Is it a local convention, one service, a
   contract between services, or visible to customers? Is it hard to undo? Does it touch
   security, privacy, billing, legal or a contract?" Stop as soon as every section can be written
   honestly.
4. **Draft** each decision (one interview may give several records): home from `blast_radius`,
   number from `adr-lint next` (consecutive within a home), `status: proposed`, `decided_by`
   naming who is taking it (`[]` only while unknown: ratification fills it), Status line
   `Proposed YYYY-MM-DD.` Write drafts to the session scratchpad.
5. **Self-check** and fix inline: one falsifiable Decision; every rule a MUST/MUST NOT; Context a
   losing proponent would accept; every fact sourced; two or three real options; a real negative;
   a trigger; classification matching the evidence; scope non-empty for high tier and in the home's
   syntax; every value inline; no AI authorship.
6. **Show** the file:

   > **Proposed ADR** — `billing-api/ADR-0003` (low tier: two-way, service)
   >
   > **File:** `billing-api/docs/adr/0003-invoice-numbering.md`
   >
   > ```markdown
   > [complete file contents]
   > ```
   >
   > High tier: "It gets its own PR; implementation waits until it is accepted."
   > Low tier, local home: "Ride along on your current branch, or its own PR?"
   >
   > Does this look right? I can adjust any section or the classification first.

7. **Apply** (several records in one home go as one batch), then confirm with the next step:
   "once it is approved, tell me who approved it" (a shared-home record, or one riding along with
   code in its scope, keeps the ADR check red until then). If the decision implies a standing
   rule, offer that line for a standard or `CLAUDE.md` too.
