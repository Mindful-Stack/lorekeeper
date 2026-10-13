# record

Read `<plugin-root>/skills/recording-decisions/reference/record-format.md` first.

1. **Load context.** In parallel: the **architect** in `bind` mode with the topic, the homes JSON
   and the catalogue (`adr-lint index --json`, saved to the session scratchpad; plus
   `adr-lint select --repo <repo> --paths <a,b>` when the code paths are known, repo-relative),
   and the **knowledge-reader** with "Prioritise domain context and architecture patterns." If the
   architect names a record that already covers the decision, stop and offer ratify or amend (a
   proposal), replace (an accepted record), or nothing; run from **replace**, the old record is
   the expected hit. Grep the code so Context and the facts rest on evidence.
2. **Interview, one question at a time,** skipping what the user already said: who is taking
   this decision (named humans, never an agent); who uses it and across which boundaries; the
   real alternatives and why they lost; **scope**; **facts** and where each can be checked; and
   the classification as plain choices — "Does it affect only this repo, or is it shared across
   repos or visible to customers?" (`repo` / `shared`), "Is it hard to undo?", and "Does it touch
   security, privacy, billing, legal or a contract?" Stop as soon as every section can be written
   honestly.
3. **Triage from the classification**, never as a second question. `repo`, `two-way` and no
   sensitivity: offer **one line** in a standard or a learning instead, unless it keeps being
   re-debated or the user wants a record. Routine choices need **no record** (the PR description
   is enough); a decision with no code behind it (a tool, a process) belongs in an RFC or meeting
   notes. Anything else: **record it**, its tier from the format.
4. **Draft** each decision (one interview may give several records): home from `blast_radius`,
   number from `adr-lint next` (consecutive within a home), `status: proposed`, `decided_by`
   naming who is taking it (`[]` only while unknown: ratification fills it), Status line
   `Proposed YYYY-MM-DD.` Write drafts to the session scratchpad, then run the format's
   *Self-check* and fix inline.
5. **Show** the file:

   > **Proposed ADR** — `billing-api/ADR-0003` (low tier: two-way, repo)
   >
   > **File:** `billing-api/docs/adr/0003-invoice-numbering.md`
   >
   > ```markdown
   > [complete file contents]
   > ```
   >
   > High tier: "It gets its own PR; implementation waits until it is accepted."
   > Low tier, local home, `governedRepo` set: "Ride along on your current branch, or its own PR?"
   > (otherwise its own PR)
   >
   > Does this look right? I can adjust any section or the classification first.

6. **Apply** (several records in one home go as one batch), then confirm with the next step:
   "merge it only once accepted — tell me who approved it". If the decision implies a standing
   rule, offer that line for a standard or `CLAUDE.md` too.

| Rationalisation | Reality |
|-----------------|---------|
| "I'll write the ADR after it works" | Then it records a fait accompli, not a decision. Draft it now as proposed. |
| "This is obvious, nobody would choose otherwise" | Obvious decisions are re-litigated most. Name the alternative and the reason. |
| "It's in the design doc" | Design docs are point-in-time; the record is the durable, replaceable artefact. |
| "I'll accept it so we can start" | Only a named human accepts. Ask who approved it. |
