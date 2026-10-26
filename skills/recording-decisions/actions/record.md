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
   is enough). A decision with no code behind it (a tool, a process, a product choice) is a record
   like any other when it is hard to reverse or the user wants one: same format, its `scope` names
   the documents or repositories it governs; never send it to an RFC or meeting notes
   (kb/ADR-0004 R5). A decision that answers a required decision in the planner is always drafted
   as a record, titled after that decision (from the caller's context, or
   `reeve decision show <id> --json` when the planner is present), worded as a decision rather
   than a question. Anything else: **record it**, its tier from the format.
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

   When the caller said "draft only; do not apply", stop here: return the draft and its
   id-to-be; the caller keeps the `Required decision: #<id>` pointer (never written into the
   record, kb/ADR-0004 R3).

6. **Apply** (several records in one home go as one batch), then confirm with the next step:
   "merge it only once accepted — tell me who approved it". If the decision implies a standing
   rule, offer that line for a standard or `CLAUDE.md` too.

   Then, only when a decision id is known — the user named one, the spec entry the draft came
   from carries `Required decision: #<id>` (outside the record text), or a planning skill passed
   one — act on the knowledge-updater's report, never on the current checkout's index (the
   updater's own-pr worktree is removed before it returns, so the record is not in the index).
   Reuse the calling skill's `bin`, `run_id`, key prefix and next `<n>` when it passed them;
   otherwise run `node <plugin-root>/scripts/reeve-detect.js` once and keep `bin` and `run_id`;
   unless it prints `"present":true` and `"signed_in":true`, skip the rest of this step. The
   inputs:
   - the qualified id and the file name: the ones the draft was numbered and saved with (the
     qualified id is the draft's front-matter `id`);
   - the repository-relative path, from the homes JSON the updater was given, never from the
     report's file list (its paths may point into the removed worktree): `<relDir>/<file name>`
     of the local home (`sharedRelDir` for the shared home); when that is `null` (not a git
     checkout), the home's directory relative to its repository directory, then the file name;
   - the planner's repository name as link.md step 2 derives it: the configured name, never the
     checkout's directory name, nor a linked worktree's: a local home's `repo`; for the
     shared home the household manifest's `knowledge_base`, or `localHomes[0]`'s `repo` when the
     knowledge base sits inside that repository (`api` for `/work/api/docs/lore`, never `lore`);
     with no configured name, asked as link.md says;
   - the PR url and the branch: from the report.

   Where the report says the change landed:
   - *opened PR <url>*, *committed to PR <url>*: follow `actions/link.md` with those inputs. A
     link that is refused or cannot check never undoes the apply.
   - *staged on your branch `<branch>`, not committed* (a ride-along; there may be no upstream
     and no PR yet): do not link; follow `actions/link.md` step 5, which leaves the planner
     pointer and tells the user the sentence.

| Rationalisation | Reality |
|-----------------|---------|
| "I'll write the ADR after it works" | Then it records a fait accompli, not a decision. Draft it now as proposed. |
| "This is obvious, nobody would choose otherwise" | Obvious decisions are re-litigated most. Name the alternative and the reason. |
| "It's in the design doc" | Design docs are point-in-time; the record is the durable, replaceable artefact. |
| "I'll accept it so we can start" | Only a named human accepts. Ask who approved it. |
