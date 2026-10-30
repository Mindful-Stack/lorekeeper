# Initiative brief

The headings are the team's convention, not planner fields: the planner stores the brief as one
Markdown text. Headings are written in setext form (the title underlined with `---`), never with
a leading `#`, so the brief passes as one quoted argument (`<plugin-root>/references/reeve-cli.md`,
Arguments).

Vision
------
What changes, and for whom, when this is done. Two or three sentences.

Capabilities
------------
What people will be able to do, one bullet each.

Known knowns
------------
What the team already knows: facts, constraints, earlier attempts, each with where it can be
checked. A known known that rests on a decision links the Decided line behind it ("see Decided:
kb/ADR-0012") instead of a document or tracker page.

Decided
-------
Decisions already taken, one line each, each naming its record: an ADR id (`kb/ADR-0012`), a
behaviour doc rule (`<doc> R3`), a standard node, an RFC outcome where the household keeps RFCs,
a closed required decision (`#14, closed: <reason>`), or, for a small choice, the line itself,
dated and with who took it (`2026-10-30: <choice> (<who>)`). A wiki page, a tracker key or a
spec is not a record: once it is archived nobody can check it, so a decision that rests only on
one is recorded first (the planning skill's decision triage).

Open questions
--------------
What is still open. A consequential choice that blocks work becomes a required decision (step 6);
a clarification stays here.
