---
name: planning-initiative
description: Use when the user asks to plan an initiative in the Reeve planner, naming Reeve or an initiative key such as GRA-12 ("plan initiative GRA-12", "discovery for GRA-12 in Reeve"). Not for planning that names neither.
---

# Planning an initiative

Discovery for one initiative in the Reeve planner: its brief, the decisions already taken turned
into records, the required decisions with their deciders and drafted records, and its epics. Everything goes into the planner through the `reeve`
CLI. This skill writes no spec and no plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument.

## The rule

1. **Show, confirm, then write**, as the reference's *Confirmation* says. The request confirms
   only the content it supplies (titles, deciders, due dates, answers). What you composed — the
   rewritten brief, an epic's brief you wrote — needs its own yes, or, in a session that cannot
   ask, a request that names that write ("write the brief from these answers").
2. **One question at a time**, skipping every question the request already answers. In a session
   that cannot ask, a question the request does not answer stops the run with
   `Stopped: missing <what>.` on its own line: nothing after it is written, and the report (step
   10) follows.
3. **Branch on the envelope** as the reference says (`outcome` first, then the exit status). A
   failed read in step 1 stops the run: every later step depends on it. An `unauthenticated` or
   `forbidden` error on any call stops the run: say it and tell the user to run
   `reeve auth login`. Any other refused or failed write skips that one item (that decision,
   comment or epic): show the reasons or the message, go on with the next item, and list what was
   skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record and the discovery mark come from
   the user, never from you.
5. **Build on what is there.** The planner may already hold a brief, decisions and epics for this
   initiative (an earlier run, a teammate). Reuse them; create only what the user's answers add.
   Whether an existing item covers what the user asked for is your judgment in the conversation,
   shown to the user, never a rule applied to titles.

## Steps

0. **Announce and detect.** First say: "Using the planning-initiative skill: everything goes into
   the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
1. **Read.** `reeve initiative show <KEY> --json` (keep `value.brief`, `value.owner`,
   `value.target_month` and `value.version`),
   `reeve decision ls --on <KEY> --json` and `reeve epic ls --initiative <KEY> --json`. If any of
   them does not answer `ok`, stop the run: for `not_found` say "The planner has no initiative
   <KEY>."; for `unauthenticated` or `forbidden` say it and tell the user to run `reeve auth login`;
   otherwise show the code and message. In parallel, dispatch the **knowledge-reader** with the
   initiative's title and "Prioritise domain context and architecture patterns.", and the
   **architect** in `survey` mode on the repositories the brief or the user names.
2. **Discovery conversation**, following `<plugin-root>/skills/planning-initiative/reference/brief-template.md`:
   the outcome, who it is for, what is known (and what of it is a decision already taken), what is
   open. When the initiative has no owner or no
   target month, ask for each one that is missing: who owns it (an email) and which month it
   targets (`YYYY-MM`). They come from the user (rule 4); an initiative may stay without either
   when the user says so. In a session that cannot ask, take them from the request, or leave them
   unset and say so in the report (not a stop).
3. **Research.** For each open question from step 2 that research can answer (a library's limits,
   a vendor's API, how others solve the same problem), look it up: web search or documentation
   when the session has them, otherwise the knowledge base and the code. Say what you looked up
   and what it answered in one line, `Researched: <topics and findings>`, or
   `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   lay it out by the template, and show what changes. Write it only on a yes for this brief (rule
   1): `reeve initiative edit <KEY> [--brief <md>] [--owner <email>] [--target-month <YYYY-MM>] --version <version> --json`,
   with `--owner` and `--target-month` only for a value step 2 gave (the user's answer is its
   confirmation), and the Markdown quoted as the reference's Arguments section says (single
   quotes, real newlines, setext headings); keep the new `value.version`. An owner or target month
   with no brief change is the same command without `--brief`.
5. **What already exists.** Show the decisions and epics step 1 found, each decision worded by the
   reference (open or closed, as its *Wording the planner's answers* section defines them) and, for each decision and
   epic the user's answers call for, whether an existing one already covers it (say which key or
   id). Steps 6 and 7 create only the ones that are not covered. A re-run on an initiative that
   already has them creates nothing unless the user asks for something new.
6. **Decisions.** Triage by `<plugin-root>/references/decision-triage.md` (read it now): the
   open questions from step 2, the Known knowns that are choices rather than facts, and every
   finding of the architect's survey from step 1 (it finds the decisions already taken without a
   record; use its output here). Show each candidate with its source and proposed outcome (a kind
   of record by the household's ADR process, a required decision, closing an open required
   decision with a reason, or leaving it) before anything is written, then carry out the outcomes
   the user confirms as that reference says; each recorded decision gets its line under *Decisions*
   in the brief (fold it into the step 4 brief, or edit the brief once more with the new
   `version`). The rest of this step is the required-decision outcome.

   For each open question that is a consequential choice blocking work
   (not a clarification) and has no decision yet: ask who decides and by when (the due date is
   optional: with none given, leave `--due` out), show and run
   `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
   and keep `value.id`. Then, for each decision, one at a time:
   1. Ask once: "Draft the record now, or leave it for <decider>? (they can run `/lore:adr` later
      and link it to #<id>)". Draft at once when the request states the answer or asks for a
      draft. In a session that cannot ask, draft only when the request says so; otherwise leave
      it, and the report says "left for <decider>: run `/lore:adr` and link it to #<id>".
   2. Drafting: invoke **recording-decisions** to draft and show its record: "draft only; do not
      apply; it answers required decision #<id>". Note the record's id-to-be.
   3. Ask whether to apply the record now, or take the answer the request gave. Applying needs an
      interactive session: in one that cannot ask, the report says "not applied: applying needs an
      interactive session".
   4. Yes: have recording-decisions apply it with `Required decision: #<id>`, this run's `bin`
      and `run_id`, the key prefix `planning-initiative:<KEY>` and the next `<n>`; its record
      step 6 links the applied record in the planner.
   5. No: run `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
      so the decision's thread in the planner carries the pointer. Never link or apply a record
      the user did not say to apply.
7. **Epics.** Propose 2–5 epics, each a deliverable slice with a one-paragraph brief, leaving out
   those step 5 found covered; show them, and write the ones confirmed as rule 1 says (epics and
   briefs the request names are confirmed by it); for each
   `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`.
   Each epic gets its own `<n>`.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve initiative discovery <KEY> --complete --version <latest version> --json`.
   No answer in a session that cannot ask leaves discovery open (not a stop: nothing is written).
9. **Re-read.** After the last write, run `reeve decision ls --on <KEY> --json` and
   `reeve epic ls --initiative <KEY> --json` again. The report states what these return, not what
   you remember writing. If a re-read fails, say so and list the writes with their own responses,
   marked unverified.
10. **Report.** Open with the step 0 sentence, then the plain lines `Run id: <run_id>` and the
   `Researched:` line, all unformatted (no bold, so they can be searched for; a non-interactive
   session shows only this report, not the announcement). Then every key written and every
   existing key reused, and every proposal left unwritten; the initiative's owner and target month
   (or "no owner", "no target month"); each required decision from the re-read
   with its decider, due date and state worded by the reference ("no record", "proposed, PR open",
   "closed: …"), plus the comment pointer when the record is only drafted; each triaged candidate
   from step 6 with its outcome and record, or "proposed, not written"; each epic from the
   re-read. End with the next step: "refine an epic with refining-epic".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments and epics (and the
creates recording-decisions runs for this skill): every
create takes the next number, and a retry of the same create reuses its number.
