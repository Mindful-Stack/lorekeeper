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
3. **Branch on the exit status** as the reference says; on a refusal or an error, stop that step
   and say so.
4. **The user decides.** Deciders, due dates, applying a record and the discovery mark come from
   the user, never from you.

## Steps

0. **Detect.** Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints `"present":true`
   and `"signed_in":true`, say "The Reeve planner is not available in this session: <reason>."
   and stop; this skill has no fallback. Keep `bin` and `run_id`.
1. **Read.** `reeve initiative show <KEY> --json` (keep `value.version`) and
   `reeve decision ls --on <KEY> --json`. In parallel, dispatch the **architect** in `survey` mode
   on the repositories the initiative touches and the **knowledge-reader** with the initiative's
   title and "Prioritise domain context and architecture patterns."
2. **Research.** For each open question that research can answer (a library's limits, a vendor's
   API, how others solve the same problem), look it up: web search or documentation when the
   session has them, otherwise the knowledge base and the code. Say what you looked up and what
   it answered in one line, `Researched: <topics and findings>`, or
   `Researched: nothing — no open question is answerable by research`.
3. **Discovery conversation**, following `<plugin-root>/skills/planning-initiative/reference/brief-template.md`:
   the outcome, who it is for, what is known, what is open.
4. **Brief.** Compose the Markdown from the template, show it, then
   `reeve initiative edit <KEY> --brief <md> --version <version> --json`, the Markdown quoted as the
   reference's Arguments section says (single quotes, real newlines, setext headings); keep the new
   `value.version`.
5. **Required decisions.** For each open question that is a consequential choice blocking work
   (not a clarification): ask who decides and by when, show and run
   `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
   and keep `value.id`. Then, for each decision, one at a time:
   1. Invoke **recording-decisions** to draft and show its record: "draft only; do not apply;
      it answers required decision #<id>". Note the record's id-to-be.
   2. Ask whether to apply the record now, or take the answer the request gave.
   3. Yes: have recording-decisions apply it with `Required decision: #<id>`; its record step 6
      links the applied record in the planner.
   4. No: run `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
      so the decision's thread in the planner carries the pointer.
6. **Epics.** Propose 2–5 epics, each a deliverable slice with a one-paragraph brief; show them,
   then for each `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`.
7. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve initiative discovery <KEY> --complete --version <latest version> --json`.
8. **Report.** Start with the plain line `Run id: <run_id>` and the `Researched:` line, both
   unformatted (no bold, so they can be searched for); every key written; each required
   decision with its decider, due date and state (record applied and the link's answer, or
   drafted with the comment pointer); the next step: "refine an epic with refining-epic".

`<n>` counts every create of this run from 1: decisions, comments and epics together.
