# link

Link a record to a required decision in the Reeve planner, so the planner checks the record
instead of reporting "no record". Read `<plugin-root>/references/reeve-cli.md` first. This writes
nothing into the record or any repository (kb/ADR-0004 R3): it stores one reference in the planner.

1. **Detect.** Run `node <plugin-root>/scripts/reeve-detect.js` (record step 6 has already run it,
   or the calling skill passed its `bin` and `run_id`: reuse them). Keep `bin` and `run_id`.
   Unless it prints `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this session: <reason>; nothing
   was linked." and stop.
2. **Inputs.** Take each from the request or the caller (record step 6); ask, one at a time, only
   for what is missing. In a session that cannot ask (rule 3), a missing input stops the action
   with the line "Nothing was linked: missing <the inputs>." verbatim, on its own line; never
   guess the planner's repository name or the household, and never leave out `--pr` to fill a gap. The inputs:
   - the decision id, an integer ("decision 7", "#7"). Read it first with
     `reeve decision show <id> --json` and take the decision's title from `value.title`. A
     `not_found` answer stops with "There is no decision #<id> in the planner; nothing was
     linked."; a decision whose `closed` is set stops with "Decision #<id> is closed:
     <closed.reason>; nothing was linked." (a closed decision gates nothing, kb/ADR-0003 R3);
   - the record's qualified id, repository and repository-relative path. From record step 6 these
     come with the call (built from the draft and the homes JSON) and need no index lookup: the
     updater's worktree is gone by then and the user's checkout does not contain the record. For a record that
     already exists in a checkout (the standalone `link` action), take its file from
     `node <plugin-root>/scripts/adr-lint.js index --json` (`records[].id` → `records[].file`);
     an id the index lacks: say so and stop, unless the user gave the repository and path (and the
     PR, or said there is none yet) explicitly, which are then used as given. The planner's
     `--record` is the `id` in that file's front matter, read from the file: for an additional
     shared knowledge base the index lists a catalogue alias (`platform-kb/ADR-0001` for a file
     whose `id` is `kb/ADR-0001`), which only finds the file and is never sent as `--record`;
   - the record's checkout: the directory of the repository that holds the record, from the
     selected home in the homes JSON (`node <plugin-root>/scripts/adr-lint.js homes`): for the
     shared home (`kb/…`), `sharedRepoRoot`, else `sharedRoot` (the knowledge base's checkout);
     for a local home (`<repo>/…`), that `localHomes[]` entry's `repoRoot`, else `<root>/<repo>`
     in a household (`mode` `household`) or `root` in a single repository. Never the current
     directory, and never `root` for the shared home: a repository configured with
     `knowledgeBasePath: ../lore` has `root` `/work/api` but its records in `/work/lore`. The
     checkout may be a linked worktree (`/work/worktrees/api-feature`): it locates the file and
     never names the repository;
   - the repository name as configured in the planner: the one the user names, else the
     configured name, never the checkout's directory name when a configured name exists (a linked
     worktree `/work/worktrees/api-feature` of repository `api` is still `api`): for a local home,
     that `localHomes[]` entry's `repo`; for the shared home in a household, the household
     manifest's `knowledge_base` (`lore`; the last segment of `sharedRoot`); for the shared home
     inside the repository (`sharedRepoRoot` is `localHomes[0]`'s `repoRoot`, a knowledge base at
     `/work/api/docs/lore`), that entry's `repo` (`api`, not `lore`). With no configured name (a
     single repository's knowledge base in a checkout of its own), ask for it; in a session that
     cannot ask, stop with "Stopped: missing repository." on its own line;
   - the household directory: the one the user names, else `root` in a household (`mode`
     `household`), else (a single repository) the checkout's parent directory when the checkout is
     `<parent>/<repo>` for the configured name (`/work` for `/work/api`): the planner reads the
     record at `<household>/<repo>/<path>`, a path built from the configured name, never from a
     worktree's directory. Otherwise (a linked worktree, a missing home, or a record file outside
     the checkout), ask for the household; in a session that cannot ask, stop with
     "Stopped: missing household." on its own line;
   - the record's path inside that repository: the file's path relative to the checkout (the same
     in a linked worktree and in `<household>/<repo>`); never absolute, never relative to the
     household;
   - the PR proposing the record: the url in the request or the report is used as given.
     Otherwise first settle whether the record is merged: when the file is on the default branch
     (the homes JSON's `defaultBranch` / `sharedDefaultBranch`;
     `git -C <checkout> cat-file -e origin/<default branch>:<path>`), it has no PR and
     `--pr` is left out. Else, knowing the record's branch, run
     `gh pr view <branch> --json url --jq .url` in the checkout when `gh` is
     available (never without the branch: that returns the checked-out branch's PR); else ask. A
     record that only rides along on a branch, staged or committed but with no PR yet, is neither
     merged nor proposed: do not link it, go to step 5.
3. **Show and run.** The request (or the apply the user confirmed) naming the record and the
   decision is the confirmation, also in a session that cannot ask (rule 3: a link is not a
   record write):
   `reeve decision link <id> --record <front-matter id> --repo <repo> --path <path> --pr <url> --household <household> --json`
4. **Report** the answer with the reference's *decision link* table: give the table's sentence
   for the result verbatim, on its own line, read from `value.check.kind` (never from your own
   reading of the record). Exit 0 has one row per `check.kind` (`proposed_pr_open`, `accepted`,
   `not_accepted`, `not_found`; `not_found` carries its remedy, check the repository name and
   path). Exit 1 with an `ok` envelope is "Linked; the check could not run here: <stderr line>;
   it runs on the next scheduled check." (the link succeeded: do not call it a failure and do
   not run it again). A `refused` envelope, or an `error` other than `internal`, shows the reasons
   or the message and says nothing was linked (`unauthenticated` or `forbidden`: also tell the
   user to run `reeve auth login`). An `internal` error may come after the link was stored: run
   `reeve decision show <id> --json` first, and when its `record` names this record, report it as
   linked with the check not run here; otherwise nothing was linked. A `not_accepted` check whose
   status the planner could not read (for example "unparsable front matter") is reported as the
   planner states it, with the record's path; fixing the record is a separate change, never a blind retry of the link. End with
   `Run id: <run_id>` on its own line, unformatted.
5. **Ride-along, no PR yet.** Never link (without `--pr` the planner would take the record as
   merged). Leave the pointer on the decision instead, then tell the user that same sentence:
   `reeve comment add --decision <id> --body 'Record <qualified id> at <repo>:<path> rides along on branch <branch>; link it with /lore:adr link <qualified id> to decision <id> once the implementing PR is open' --idempotency-key <prefix>:<run_id>:<n> --json`
   (`<prefix>`, `<run_id>` and the next `<n>` as the calling skill passed them, else
   `recording-decisions:<id>`, the detector's `run_id` and 1; the reference's *Idempotency
   keys*), and print `Run id: <run_id>`.
   The link is made later by this action, once the PR exists (`--pr` from the request, else
   `gh pr view <branch>`).
