---
name: refining-epic
description: Use when the user names a Reeve epic to refine (a key such as GRA-20), asks to break an epic into stories or write its stories and acceptance criteria, or asks to place or triage untriaged stories — and the Reeve planner CLI is installed.
---

# Refining an epic

Epic-level discovery in the Reeve planner, its required decisions, stories that one person or one
agent session can finish (kb/ADR-0002 R1) with acceptance criteria, and a home for every untriaged
story. Everything goes into the planner through the `reeve` CLI. This skill writes no spec and no
plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument; a brief or a criterion is one single-quoted argument as the reference's Arguments
section says.

## The rule

1. **Show, confirm, then write.** Show each write before running it. An answer the user already
   gave in the request counts as the confirmation for that write; do not ask it again.
2. **One question at a time**, skipping every question the request already answers.
3. **Branch on the exit status** as the reference says. A failed read in step 1 stops the run:
   every later step depends on it. An error about sign-in or authorization on any call stops the
   run: say it and tell the user to run `reeve auth login`. Any other refused or failed write
   skips that one item (that story, placement, decision or comment): show the reasons or the
   message, go on with the next item, and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record, a story's home and the discovery
   mark come from the user, never from you; you propose.
5. **Build on what is there.** The planner may already hold a brief, decisions and stories for
   this epic. Reuse them; create only what the user's answers add. Whether an existing item covers
   what the user asked for is your judgment in the conversation, shown to the user, never a rule
   applied to titles.
6. **Readiness is the planner's.** Report what `story ls` returns after the last write, in the
   reference's words; never judge readiness yourself (kb/ADR-0003 R1).

## Steps

0. **Announce and detect.** First say: "I'm using the refining-epic skill: everything goes into
   the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
   **No epic named** (for example "triage the untriaged stories"): run
   `reeve story ls --untriaged --json`, show the stories, say that this skill works on one epic,
   ask which epic to refine (or which epic a story should go to), and stop until the user
   answers. When nobody can answer (a non-interactive session), say that an epic key is required
   and stop. Never pick an epic yourself.
1. **Read.** `reeve epic show <EPIC> --json` (keep `value.brief`, `value.version` and
   `value.initiative`), then `reeve initiative show <INITIATIVE> --json` for that initiative,
   `reeve decision ls --on <EPIC> --json`, `reeve story ls --epic <EPIC> --json`,
   `reeve story ls --untriaged --json`, `reeve epic ls --json` and `reeve initiative ls --json`.
   If any of them does not exit 0, stop the run: for `not_found` say "The planner has no epic
   <EPIC>." (or the item it names); for an error about sign-in or authorization say it and tell
   the user to run `reeve auth login`; otherwise show the code and message. In parallel, dispatch
   the **knowledge-reader** with the epic's title and "Prioritise domain context and architecture
   patterns.", and the **architect** in `survey` mode on the repositories the brief or the user
   names.
2. **Discovery conversation.** One question at a time: what done looks like, the boundaries, what
   is unknown.
3. **Research.** For each open question from step 2 that research can answer, look it up: web
   search or documentation when the session has them, otherwise the knowledge base and the code.
   Say what you looked up and what it answered in one line, `Researched: <topics and findings>`,
   or `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   and show what changes. Then `reeve epic edit <EPIC> --brief <md> --version <version> --json`;
   keep the new `value.version`.
5. **Required decisions.** Show the decisions step 1 found; those with `record: null` stay open
   and go into the report. Only for a consequential choice the user names that blocks work and
   has no decision yet: ask who decides and by when, show and run
   `reeve decision require --on <EPIC> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
   then invoke **recording-decisions** to draft its record ("draft only; do not apply; it answers
   required decision #<id>"). Apply it only when the user says so (recording-decisions applies it
   with `Required decision: #<id>`); otherwise run
   `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   When the user says there are no new required decisions, create none.
6. **Stories.** Propose stories, each finishable by one person or one agent session, each with
   2–6 acceptance criteria written as observable outcomes, leaving out what an existing story
   from step 1 already covers (say which key). Show them, then for each new one
   `reeve story create --epic <EPIC> --title <title> --kind story --criterion <text> --criterion <text> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
   one `--criterion` per criterion.
7. **Placement tree.** For each story from `story ls --untriaged`, classify it, propose its home
   with the branch that led there, and on confirmation write it (`<v>` is the story's `version`
   from the listing; covering epics and initiatives come from `epic ls` and `initiative ls`):
   - **Broken behaviour** → a bug under the epic that covers the broken feature:
     `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --kind bug --json`
     (no covering epic: `--kind bug` alone).
   - **Internal work** (an upgrade, a refactor, tooling; nothing a user sees) → a chore:
     `reeve story edit <KEY> --version <v> --kind chore --json` (add `--epic` when one covers it).
   - **Product change**, the first that applies, with no `--kind` (it stays a story). An epic
     covers a story when the story changes the feature that epic delivers, even if its brief does
     not name the change yet.
     1. an epic covers it (this one, or one from `epic ls`):
        `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --json`;
     2. else an initiative covers it, but none of its epics does: a new epic under it,
        `reeve epic create --initiative <COVERING-INITIATIVE> --title <title> --brief <md> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
        then `reeve story edit <KEY> --version <v> --epic <new epic> --json`;
     3. else a new initiative in the last horizon bucket before "Won't do":
        `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
        an epic under it as in 2, then the `story edit`. The CLI does not list the buckets: ask for
        them (offering the horizons seen in `initiative ls`), or take them from the request.
   - **Won't do**, or the user says "leave it untriaged": write nothing for it.
   `--kind` on `story edit` comes with Reeve plan C (Task 5); a planner without it answers a
   usage error (exit 1). Then run the same edit again without `--kind` (the story keeps its kind
   and still gets its home), and say so in the report.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve epic discovery <EPIC> --complete --version <latest version> --json`.
9. **Re-read.** After the last write (the discovery mark, or the last placement when there is
   none), run `reeve story ls --epic <EPIC> --json`, `reeve decision ls --on <EPIC> --json` and
   `reeve story ls --untriaged --json`. Completing discovery and placing stories change the
   readiness reasons, so these are the last reads of the run and the only ones the report quotes.
10. **Report.** Start with the plain lines `Using the refining-epic skill.`, `Run id: <run_id>`
   and the `Researched:` line, all unformatted (no bold, so they can be searched for; a
   non-interactive session shows only this report, not the announcement). Then:
   - every key written and every existing key reused, and every item skipped with its reason;
   - each placement on one line: the story's key, its title and its branch, named `bug`,
     `chore`, `this epic`, `another epic <KEY>`, `new epic under <INITIATIVE>`,
     `new initiative`, `won't do` or `left untriaged`;
   - the open required decisions from the re-read, worded by the reference;
   - each story of the epic from the re-read on one line: its key, its title, and "ready" or
     "blocked:" followed by every one of the planner's reasons, worded by the reference's table.
     Write each story's reasons out in full on its own line, even when stories share them; never
     abbreviate them as "the shared reasons" or "as above".
   End with the next step: "pick a ready story and brainstorm it".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments, stories, epics and
initiatives: every create takes the next number, and a retry of the same create reuses its number.
