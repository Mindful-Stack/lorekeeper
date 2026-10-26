# link

Link a record to a required decision in the Reeve planner, so the planner checks the record
instead of reporting "no record". Read `<plugin-root>/references/reeve-cli.md` first. This writes
nothing into the record or any repository (kb/ADR-0004 R3): it stores one reference in the planner.

1. **Detect.** Run `node <plugin-root>/scripts/reeve-detect.js` (record step 6 has already run it:
   reuse its output). Keep `bin` and `run_id`. Unless it prints `"present":true` and
   `"signed_in":true`, say "The Reeve planner is not available in this session: <reason>; nothing
   was linked." and stop.
2. **Inputs.** Take each from the request or the caller (record step 6); ask, one at a time, only
   for what is missing. In a session that cannot ask (rule 3), a missing input stops the action
   with the line "Nothing was linked: missing <the inputs>." verbatim, on its own line; never
   guess the planner's repository name, and never leave out `--pr` to fill a gap. The inputs:
   - the decision id, an integer ("decision 7", "#7"). The link needs no decision title; to name
     the decision, take its title from the request or the caller, else ask (no `reeve` command
     reads a decision by its id alone; `decision ls --on <KEY>` does when the item is known);
   - the record's qualified id, repository and repository-relative path. From record step 6 these
     come with the call (built from the draft and the homes JSON) and need no index lookup: the
     updater's worktree is gone by then and the user's checkout does not contain the record. For a record that
     already exists in a checkout (the standalone `link` action), take its file from
     `node <plugin-root>/scripts/adr-lint.js index --json` (`records[].id` → `records[].file`);
     an id the index lacks: say so and stop, unless the user gave the repository and path (and the
     PR, or said there is none yet) explicitly, which are then used as given;
   - the household directory: the current directory unless the user names another;
   - the repository name as configured in the planner: no `reeve` command lists the planner's
     repositories, so ask, offering the `household.json` repository whose directory holds the
     file;
   - the record's path inside that repository: the file's path relative to `<household>/<repo>`,
     or to the household itself when its directory name is the repository name; never absolute,
     never relative to the household when the repository is a directory of it;
   - the PR proposing the record: the url in the request or the report is used as given.
     Otherwise first settle whether the record is merged: when the file is on the default branch
     (the homes JSON's `defaultBranch` / `sharedDefaultBranch`;
     `git -C <repository directory> cat-file -e origin/<default branch>:<path>`), it has no PR and
     `--pr` is left out. Else, knowing the record's branch, run
     `gh pr view <branch> --json url --jq .url` in the repository directory when `gh` is
     available (never without the branch: that returns the checked-out branch's PR); else ask. A
     record that only rides along on a branch, staged or committed but with no PR yet, is neither
     merged nor proposed: do not link it, go to step 5.
3. **Show and run.** The request (or the apply the user confirmed) naming the record and the
   decision is the confirmation, also in a session that cannot ask (rule 3: a link is not a
   record write):
   `reeve decision link <id> --record <qualified id> --repo <repo> --path <path> --pr <url> --household <household> --json`
4. **Report** the answer with the reference's *decision link* table: give the table's sentence
   for the result verbatim, on its own line, read from `value.check.kind` (never from your own
   reading of the record). Exit 0 has one row per `check.kind` (`proposed_pr_open`, `accepted`,
   `not_accepted`, `not_found`; `not_found` carries its remedy, check the repository name and
   path). Exit 1 with an `ok` envelope is "Linked; the check could not run here: <stderr line>;
   it runs on the next scheduled check." (the link succeeded: do not call it a failure and do
   not run it again). Exit 2 or an `error` envelope shows the reasons or the message and says
   nothing was linked. A `not_accepted` check whose status the planner could not read (for
   example "unparsable front matter") is reported as the planner states it, with the record's
   path; fixing the record is a separate change, never a blind retry of the link. End with
   `Run id: <run_id>` on its own line, unformatted.
5. **Ride-along, no PR yet.** Never link (without `--pr` the planner would take the record as
   merged). Leave the pointer on the decision instead, then tell the user that same sentence:
   `reeve comment add --decision <id> --body 'Record <qualified id> at <repo>:<path> rides along on branch <branch>; link it with /lore:adr link <qualified id> to decision <id> once the implementing PR is open' --idempotency-key <skill>:<id>:<run_id>:<n> --json`
   (the key's skill and run id from the calling skill, else `recording-decisions` and the
   detector's `run_id`; `<n>` counts this run's creates from 1), and print `Run id: <run_id>`.
   The link is made later by this action, once the PR exists (`--pr` from the request, else
   `gh pr view <branch>`).
