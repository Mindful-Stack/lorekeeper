---
name: refining-epic
description: Use when the user asks to refine an epic in the Reeve planner or to place its untriaged stories, naming Reeve or an epic key such as GRA-20 ("refine epic GRA-20", "break GRA-20 into stories", "triage the untriaged stories in Reeve"). Not for breaking work down when the request names neither.
---

# Refining an epic

Epic-level discovery in the Reeve planner, the decisions already taken turned into records, its
required decisions, stories that one person or one
agent session can finish (kb/ADR-0002 R1) with acceptance criteria, and a home for every untriaged
story. Everything goes into the planner through the `reeve` CLI. This skill writes no spec and no
plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument; a brief goes through a file (`--brief-file`), and a title or a criterion is one
single-quoted argument on one line, as the reference's Arguments section says.

## The rule

1. **Show, confirm, then write**, as the reference's *Confirmation* says. The request confirms
   only the content it supplies (titles, criteria, deciders, due dates, a home the user named).
   What you composed — the rewritten brief, a home you chose, a new epic or initiative with its
   title, brief and horizon — needs its own yes, or, in a session that cannot ask, a request that
   names that write ("place the untriaged stories", "create the new epic for GRA-43").
2. **One question at a time**, skipping every question the request already answers. In a session
   that cannot ask, a question the request does not answer stops the run with
   `Stopped: missing <what>.` on its own line: nothing after it is written, and the report (step
   10) follows.
3. **Branch on the envelope** as the reference says (`outcome` first, then the exit status). A
   failed read in step 1 stops the run: every later step depends on it. An `unauthenticated` or
   `forbidden` error on any call stops the run: say it and tell the user to run
   `reeve auth login`. Any other refused or failed write skips that one item (that story,
   placement, decision or comment): show the reasons or the message, go on with the next item,
   and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record, a story's home, a story's owner
   and the discovery mark come from the user, never from you; you propose.
5. **Build on what is there.** The planner may already hold a brief, decisions and stories for
   this epic. Reuse them; create only what the user's answers add. Whether an existing item covers
   what the user asked for is your judgment in the conversation, shown to the user, never a rule
   applied to titles.
6. **Readiness is the planner's.** Report what `story ls` returns after the last write, in the
   reference's words; never judge readiness yourself (kb/ADR-0003 R1).

## Steps

0. **Announce and detect.** First say: "Using the refining-epic skill: everything goes into the
   Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
   **No epic named.** A request to triage the whole untriaged queue ("triage the untriaged
   stories in Reeve") follows *Whole-queue triage* below instead of steps 1 to 10. Any other
   request that names no epic ("refine an epic in Reeve") asks which epic to refine and stops
   until the user answers; in a session that cannot ask, end with `Stopped: missing the epic key.`
1. **Read.** `reeve epic show <EPIC> --json` (keep `value.brief`, `value.version` and
   `value.initiative`), `reeve epic findings <EPIC> --json`, then
   `reeve initiative show <INITIATIVE> --json` only when `value.initiative` is not null (a standalone epic has no initiative: skip that read and go on
   with the epic's own context), `reeve decision ls --on <EPIC> --json`,
   `reeve story ls --epic <EPIC> --json`, `reeve story ls --untriaged --json`,
   `reeve epic ls --json` and `reeve initiative ls --json`. Quote the findings to the user in the
   reference's *Findings* words (or "Findings: none"); they are advisory, so a failed findings read
   is said and the run goes on. Read the epic's comments too, `reeve comment ls --item <EPIC> --json`:
   the discussion is context for step 2, and a failed comment read is likewise said and the run
   goes on. If any other read does not answer `ok`, stop the run: for
   `not_found` say "The planner has no epic <EPIC>." (or the item it names); for `unauthenticated` or `forbidden` say it and tell the user to run `reeve auth login`;
   otherwise show the code and message. In parallel, dispatch the **knowledge-reader** with the
   epic's title and "Prioritise domain context and architecture patterns.", and the **architect**
   in `survey` mode on the repositories the brief or the user names.
2. **Discovery conversation.** One question at a time: what done looks like, the boundaries, what
   is unknown.
3. **Research.** For each open question from step 2 that research can answer, look it up: web
   search or documentation when the session has them, otherwise the knowledge base and the code.
   Say what you looked up and what it answered in one line, `Researched: <topics and findings>`,
   or `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   and show what changes; decisions already taken go under a *Decisions* heading, one line each
   naming its record, as `<plugin-root>/skills/planning-initiative/reference/brief-template.md`
   lays it out. Write it only on a yes for this brief (rule 1):
   write the Markdown to a file with the Write tool, then
   `reeve epic edit <EPIC> --brief-file <brief file> --version <version> --json`; keep the new `value.version`.
5. **Decisions.** Show the decisions step 1 found, worded by the reference; the open
   ones (as its *Wording the planner's answers* section defines them; a closed decision never is)
   go into the report. Then triage by `<plugin-root>/references/decision-triage.md` (read it
   now), as planning-initiative's step 6 does: the open questions from step 2, the epic's known
   facts that are choices rather than facts, each choice behind a `brief_cites_without_decision`
   finding from step 1, and every finding of the architect's survey from step 1. Show each candidate with its source and proposed outcome (a kind of record by the
   household's ADR process, a required decision, closing an open required decision as
   decided or withdrawn, or leaving it) before anything is written, and carry out the outcomes the user
   confirms as that reference says; each recorded decision gets its line under *Decisions* in the
   epic's brief (fold it into the step 4 brief, or edit the brief once more with the new
   `version`). For each open question that is a consequential choice blocking work (not a
   clarification) and has no decision yet, propose a required decision, as planning-initiative
   does: ask who decides and by when (the due date is optional: with none given, leave
   `--due` out), show and run
   `reeve decision require --on <EPIC> --title <title> --decider <email> --reversibility one-way|two-way [--due YYYY-MM-DD] --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`. Pass
   the reversibility classified first, as `<plugin-root>/references/decision-triage.md` says:
   `--reversibility one-way` when undoing the choice costs more than a day or breaks something
   others depend on, whatever kind of choice it is (a one-way choice is always an ADR), `two-way`
   otherwise; show which with the command. Pass `--due` only with a date the conversation gave (rule 4); without one the
   CLI's stderr line `no decide-by date; the queue will flag it` is expected: never pick a date to
   silence it.
   Then ask once: "Draft the record now, or leave it for <decider>?"; draft at once when the
   request states the answer or asks for a draft, and in a session that cannot ask only when the
   request says so (otherwise the report says "left for <decider>: run `/lore:adr` and link it to
   #<id>"). To draft, invoke **recording-decisions** ("draft only; do not apply; it answers
   required decision #<id>"). Apply it only when the user says so, in a session that can ask
   (recording-decisions applies it with `Required decision: #<id>`, this run's `bin` and `run_id`,
   the key prefix `refining-epic:<EPIC>` and the next `<n>`); otherwise run
   `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   When the user says there are no new required decisions, create none; a decision the user
   says is not needed is never required.
6. **Stories.** Propose stories, each finishable by one person or one agent session, each with
   2–6 acceptance criteria written as observable outcomes, leaving out what an existing story
   from step 1 already covers (say which key). Show them; the ones confirmed as rule 1 says
   (stories and criteria the request names are confirmed by it) are written in step 7's last
   bullet, together with the new epics and initiatives the placement tree confirms. Each is a
   plan story `{"name": "<name>", "title": "<title>", "kind": "story", "epic": "<EPIC>", "criteria": ["<text>", …]}`
   (a longer description goes in `description`, Markdown as written). When the user names who
   owns a story, set it once the story exists (a plan carries no owner):
   `reeve story edit <KEY> --version 1 --owner <email> --json` for a story the plan just created
   (an owner who is not an allowed user is a `validation` error: show it and leave the story
   unowned); otherwise leave the story unowned.
7. **Placement tree.** For each item from `story ls --untriaged` (any kind with no epic that is
   not done), first look for a duplicate: `reeve story similar '<its title>' --json` (the title must
   be 8 to 200 characters; shorter, skip this) lists open stories and recently done ones with a like
   title, the item itself among them: never count its own key as a hit. A hit that is done (any resolution) is never a duplicate:
   name it in the item's reason (`like GRA-48, done (dropped)`). An open hit that is the same work is
   a duplicate: propose "Won't do" for the item and name the key it duplicates (`<DUP>`). Then classify it, propose its home
   with the branch that led there, and write it on a confirmation as rule 1 says ("place the
   untriaged stories" names the `story edit`s; `<v>` is the story's `version` from the listing;
   covering epics and initiatives come from `epic ls` and `initiative ls`):
   - **Broken behaviour** → a bug under the epic that covers the broken feature:
     `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --kind bug --json`.
     No covering epic: the area's standing epic from `epic ls` (the one for ongoing upkeep of that
     area). It is the epic in that area's initiative whose title says it collects ongoing upkeep (for
     example "Maintenance" or "Upkeep"); if none is obvious, ask the user which epic it is rather than
     guess. Only when the user confirms the area has no standing epic, propose a new one as in *Product change* 2 or 3. A bug under no epic is never an end
     state: it stays untriaged and not ready.
   - **Internal work** (an upgrade, a refactor, tooling; nothing a user sees) → a chore, under the
     epic that covers it or else the area's standing epic as above:
     `reeve story edit <KEY> --version <v> --epic <EPIC> --kind chore --json`.
   - **Product change**, the first that applies, with no `--kind` (it stays a story). An epic
     covers a story when the story changes the feature that epic delivers, even if its brief does
     not name the change yet.
     1. an epic covers it (this one, or one from `epic ls`):
        `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --json`;
     2. else an initiative covers it, but none of its epics does: a new epic under it, a plan epic
        `{"name": "<name>", "title": "<title>", "initiative": "<COVERING-INITIATIVE>", "brief": "<md>"}`,
        then, once the plan is applied, `reeve story edit <KEY> --version <v> --epic <new epic> --json`;
     3. else a new initiative, proposed in the last horizon bucket before "Won't do": a plan
        initiative `{"name": "<name>", "title": "<title>", "horizon": "<bucket>", "brief": "<md>"}`
        (with `"owner"` and `"target_month"` only when given), a plan epic under it as in 2 (its
        `initiative` is the initiative's name), then the `story edit`. The CLI does not list the
        buckets: ask for them (offering the horizons seen in `initiative ls`), or take them from
        the request. Ask who owns the new initiative (an email) and which month it targets
        (`YYYY-MM`), or take them from the request; pass only the ones given (never guess an
        owner), and name the missing ones in the report.

     Before proposing a new epic or initiative (2 or 3), search for it
     (`reeve search <text> --json`, as the reference's *Search before creating* says): a hit that
     covers the story is its home by 1 or 2 instead; say which key.
     For 2 and 3, show the proposed title, brief (and horizon) and create them only on a
     confirmation for that story; in a session that cannot ask, only when the request names that
     create. Otherwise create nothing for it and leave it untriaged with the proposal:
     `reeve comment add --item <KEY> --body 'Proposed home: <the new epic or initiative, its title and where it goes>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   - **Won't do** (including a duplicate): close it as dropped, on a confirmation as rule 1 says.
     A duplicate first gets the comment the web triage page writes,
     `reeve comment add --item <KEY> --body 'Duplicate of <DUP>.' --idempotency-key triage-dup:<KEY>:<DUP> --json`;
     then `reeve story mv <KEY> done --version <v> --resolution dropped --json` (a failed comment
     stops that item's move; a move that fails after the comment is reported as "commented, not
     dropped"). If the user says "leave it
     untriaged", write nothing for it.
   - **Write.** Everything step 6 and this step confirmed for creating goes into ONE plan, as the
     reference's *Plans* section says: write it as JSON to a file with the Write tool, its `id`
     `refining-epic:<EPIC>:<run_id>:<n>`, and run `reeve apply <plan file> --json` once. Then run
     the placements' `story edit`s, a new home's key read from `value.items[]` by its name. When
     the run creates exactly one item (one story, no new home), its single create does instead:
     `reeve story create --epic <EPIC> --title <title> --kind story --criterion <text> --criterion <text> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
     one `--criterion` per criterion (`--owner <email>` before `--idempotency-key` when the user
     named one). A refused plan writes nothing: show every problem the `validation` message
     lists and apply again only as the reference says; a placement whose new home the plan did
     not create is left untriaged and reported as skipped.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve epic discovery <EPIC> --complete --version <latest version> --json`.
   No answer in a session that cannot ask leaves discovery open (not a stop: nothing is written).
9. **Re-read.** After the last write (the discovery mark, or the last placement when there is
   none), run `reeve story ls --epic <EPIC> --json`, `reeve decision ls --on <EPIC> --json` and
   `reeve story ls --untriaged --json`. Completing discovery and placing stories change the
   readiness reasons, so these are the last reads of the run and the only ones the report quotes.
   If a re-read fails, say so and list the writes with their own responses, marked unverified.
10. **Report.** Open with the step 0 sentence, then the plain lines `Run id: <run_id>` and the
   `Researched:` line, all unformatted (no bold, so they can be searched for; a non-interactive
   session shows only this report, not the announcement). Then:
   - every key written and every existing key reused, and every item skipped with its reason;
   - each placement on one line: the story's key, its title and its branch, named `bug`,
     `chore`, `this epic`, `another epic <KEY>`, `new epic under <INITIATIVE>`,
     `new initiative`, `won't do` or `left untriaged` (with the proposed home, when there is one);
   - the findings step 1 quoted;
   - each triaged candidate from step 5 with its outcome and record, or "proposed, not written";
   - the open required decisions from the re-read, worded by the reference;
   - each story of the epic from the re-read on one line: its key, its title, and "ready" or
     "blocked:" followed by every one of the planner's reasons, worded by the reference's table.
     Write each story's reasons out in full on its own line, even when stories share them; never
     abbreviate them as "the shared reasons" or "as above".
   End with the next step: "pick a ready story and brainstorm it".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments, the plan and any
single create: every create (and the plan, as one) takes the next number, and a retry of the same
create or plan reuses its number.

## Whole-queue triage

For a request to triage the whole untriaged queue. It replaces steps 1 to 10. Rules 3 and 4 hold;
this section replaces rules 1, 2, 5 and 6.

T0. **Asking.** The table (T3) and the criteria questions (T4) are the only confirmations, and
    they are the showing: the commands are not shown again. In a session that cannot ask
    (`claude --print`, CI), do T1 to T3 without asking and end with the step 0 sentence, the plain
    line `Run id: <run_id>`, the table and
    `Nothing was written: whole-queue triage needs a session that can ask.` No request licenses a
    write here.
T1. **Read.** `reeve story ls --untriaged --json`: keep each `story.version`, `.delivery`, `.owner`
    and `.criteria`. Then `reeve epic ls --json` and `reeve initiative ls --json`. A failed read
    stops the run, as step 1 says. An empty queue: say `The untriaged queue is empty.` and stop.
    More than 25 items: take the 25 with the lowest key numbers and say how many remain; the rest
    are outside this pass (no row, and never canonical in T2).
T2. **Propose** one row per item:
    - **Duplicate.** `reeve story similar '<its title>' --json`, as step 7 says (a failed call is
      said and the item goes on without the check). A hit other than the item itself that is the
      same work and not done is a twin; a done hit never is (name it in the row's reason, as step 7
      says). Of each group, the canonical item `<DUP>` is the open twin outside the queue (the
      lowest key number when there are several), else the lowest key number among the group's
      items in this pass; every other item of the pass in todo is `won't do: duplicate of <DUP>`.
      So no item duplicates itself and no two items duplicate each other. A twin that is not in
      todo is never dropped: its row is `left untriaged: <its delivery state>, duplicate of <DUP>`.
    - **Home.** Otherwise classify it by step 7's *Broken behaviour*, *Internal work* or
      *Product change* 1 only (none of step 7's commands, questions or comments apply here): the
      row is the epic, its title, the kind and why. Anything else (a new epic or initiative, no
      obvious standing epic, an item you would not do) is `left untriaged: <reason>`. No epic or
      initiative is created in this pass.
T3. **Confirmation 1: the table.** One table, a row per item: key, title (for an item not in todo,
    add `<delivery>, owned by <owner or nobody>`) and its row from T2. Ask once, with two options,
    `Write all rows as shown` and `Write nothing`; the user may instead strike rows or change a
    row's epic or kind. An answer that changes rows confirms every row left standing, the changed ones as changed
    and a struck one not at all: show
    the changed rows and go on without asking again (ask only about a change that names no
    existing epic or kind). `Write nothing` goes to the report.
T4. **Confirmation 2: criteria.** For each confirmed placement whose item has no criteria, draft 2
    to 6 and ask one yes/no question for that row, the criteria in the question, with the
    multiple-choice question tool where the session has one (up to 4 rows' questions in one
    call). A no places the row without them; criteria the user types instead are that row's
    criteria, confirmed as typed.
    Existing criteria are never changed in this pass.
T5. **Write** each confirmed row with the `version` T1 read:
    - a placement: `reeve story edit <KEY> --version <v> --epic <EPIC> --kind <kind> [--criterion <text> …] --json`,
      the row's kind (`story`, `bug` or `chore`), with one `--criterion` per criterion of a yes in T4;
    - a duplicate: step 7's two *Won't do* commands (the comment, then the move), with no further
      question.

    A `conflict` is never retried: re-read the item (`reeve story show <KEY> --json`) and say
    what changed. Any other failure is rule 3's.
T6. **Report.** After the last write, re-read `reeve story ls --untriaged --json`. Open with the
    step 0 sentence and the plain line `Run id: <run_id>`, then a line per item: placed (epic,
    kind, criteria written or not), dropped (duplicate of), or left untriaged with why (the home
    it needs, its delivery state, struck, a failed write, a conflict and what changed, commented
    but not dropped). Then the queue from the re-read, and the next step: `triage the untriaged
    queue again` when a row failed or conflicted or items remain beyond the 25, otherwise `refine an
    epic`.
