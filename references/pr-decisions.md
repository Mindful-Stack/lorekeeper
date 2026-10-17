# The PR *Decisions* section

Every PR description carries a `## Decisions` section. Reviews select records from it, and
reviewers read it first.

```markdown
## Decisions
- Follows: kb/ADR-0003, api/ADR-0002
- Adds: api/ADR-0005 (proposed; ratify before merge)
- Accepts: api/ADR-0004
- Rules: added app/org.R12; changed app/org.R7; removed none
```

Write each line that applies; omit the others. A change that follows no record and adds none
says exactly:

```markdown
## Decisions
No new decisions.
```

Use qualified ids (`<repo>/ADR-NNNN`, `kb/ADR-NNNN`). Cited ids are selected for review even
when their scope does not match the diff. *Accepts* is a ratification — a previously proposed
record this PR moves to accepted, with no new text; *Adds* is a new record. *Rules* lists
behaviour-doc rule edits, when the project keeps behaviour docs.

When the ADR check blocks: conform, or replace the record (`/lore:adr replace …`). For an
uncovered choice: low tier, add the record and have it accepted in this PR before merge; high
tier, open its own ADR PR and wait until it is accepted. To merge anyway, a member of the
repository's bypass group overrides the required check.
