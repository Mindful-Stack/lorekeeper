# The PR *Decisions* section

Every PR description carries a `## Decisions` section. Reviews select records from it, and
reviewers read it first.

```markdown
## Decisions
- Follows: kb/ADR-0003, api/ADR-0002
- Adds: api/ADR-0005 (proposed; ratify before merge)
- Rules: added app/org.R12; changed app/org.R7; removed none
```

Write each line that applies; omit the others. A change that follows no record and adds none
says exactly:

```markdown
## Decisions
No new decisions.
```

Use qualified ids (`<repo>/ADR-NNNN`, `kb/ADR-NNNN`). Cited ids are selected for review even
when their scope does not match the diff. *Rules* lists behaviour-doc rule edits, when the
project keeps behaviour docs.

When the ADR check blocks: conform, replace the record (`/lore:adr replace …`), or record the
uncovered choice in this PR. To merge anyway, a member of the repository's bypass group overrides
the required check.
