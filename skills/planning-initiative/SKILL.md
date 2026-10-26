---
name: planning-initiative
description: Use when the user names a Reeve initiative to plan (a key such as GRA-12) or asks for initiative discovery — "plan this initiative", "discovery for …", "what do we need to decide before we build …" — and the Reeve planner CLI is installed.
---

# Planning an initiative

Discovery for one initiative in the Reeve planner: its brief, the required decisions with their
deciders and drafted records, and its epics. Everything goes into the planner through the `reeve`
CLI. This skill writes no spec and no plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument.

## The rule

1. **Show, confirm, then write.** Show each write before running it. An answer the user already
   gave in the request counts as the confirmation for that write; do not ask it again.
2. **One question at a time**, skipping every question the request already answers.
3. **Branch on the exit status** as the reference says. A failed read in step 1 stops the run:
   every later step depends on it. An error about sign-in or authorization on any call stops the
   run: say it and tell the user to run `reeve auth login`. Any other refused or failed write
   skips that one item (that decision, comment or epic): show the reasons or the message, go on
   with the next item, and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record and the discovery mark come from
   the user, never from you.
5. **Build on what is there.** The planner may already hold a brief, decisions and epics for this
   initiative (an earlier run, a teammate). Reuse them; create only what the user's answers add.
   Whether an existing item covers what the user asked for is your judgment in the conversation,
   shown to the user, never a rule applied to titles.

## Steps

0. **Announce and detect.** First say: "I'm using the planning-initiative skill: everything goes
   into the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
1. **Read.** `reeve initiative show <KEY> --json` (keep `value.brief` and `value.version`),
   `reeve decision ls --on <KEY> --json` and `reeve epic ls --initiative <KEY> --json`. If any of
   them does not exit 0, stop the run: for `not_found` say "The planner has no initiative <KEY>.";
   for an error about sign-in or authorization say it and tell the user to run `reeve auth login`;
   otherwise show the code and message. In parallel, dispatch the **knowledge-reader** with the
   initiative's title and "Prioritise domain context and architecture patterns.", and the
   **architect** in `survey` mode on the repositories the brief or the user names.
2. **Discovery conversation**, following `<plugin-root>/skills/planning-initiative/reference/brief-template.md`:
   the outcome, who it is for, what is known, what is open.
3. **Research.** For each open question from step 2 that research can answer (a library's limits,
   a vendor's API, how others solve the same problem), look it up: web search or documentation
   when the session has them, otherwise the knowledge base and the code. Say what you looked up
   and what it answered in one line, `Researched: <topics and findings>`, or
   `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   lay it out by the template, and show what changes. Then
   `reeve initiative edit <KEY> --brief <md> --version <version> --json`, the Markdown quoted as the
   reference's Arguments section says (single quotes, real newlines, setext headings); keep the new
   `value.version`.
5. **What already exists.** Show the decisions and epics step 1 found and, for each decision and
   epic the user's answers call for, whether an existing one already covers it (say which key or
   id). Steps 6 and 7 create only the ones that are not covered. A re-run on an initiative that
   already has them creates nothing unless the user asks for something new.
6. **Required decisions.** For each open question that is a consequential choice blocking work
   (not a clarification) and has no decision yet: ask who decides and by when, show and run
   `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
   and keep `value.id`. Then, for each decision, one at a time:
   1. Invoke **recording-decisions** to draft and show its record: "draft only; do not apply;
      it answers required decision #<id>". Note the record's id-to-be.
   2. Ask whether to apply the record now, or take the answer the request gave.
   3. Yes: have recording-decisions apply it with `Required decision: #<id>`; its record step 6
      links the applied record in the planner.
   4. No: run `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
      so the decision's thread in the planner carries the pointer. Never link or apply a record
      the user did not say to apply.
7. **Epics.** Propose 2–5 epics, each a deliverable slice with a one-paragraph brief, leaving out
   those step 5 found covered; show them, then for each new one
   `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`.
   Each epic gets its own `<n>`.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve initiative discovery <KEY> --complete --version <latest version> --json`.
9. **Re-read.** After the last write, run `reeve decision ls --on <KEY> --json` and
   `reeve epic ls --initiative <KEY> --json` again. The report states what these return, not what
   you remember writing.
10. **Report.** Start with the plain lines `Using the planning-initiative skill.`,
   `Run id: <run_id>` and the `Researched:` line, all unformatted (no bold, so they can be searched
   for; a non-interactive session shows only this report, not the announcement). Then every key written and every existing
   key reused; each required decision from the re-read with its decider, due date and state worded
   by the reference ("no record", "proposed, PR open", …), plus the comment pointer when the record
   is only drafted; each epic from the re-read. End with the next step: "refine an epic with
   refining-epic".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments and epics: every
create takes the next number, and a retry of the same create reuses its number.
