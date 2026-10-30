# The PR *Decisions* section

Every PR description carries a `## Decisions` section. Reviews select records from it, and
reviewers read it first.

```markdown
## Decisions
- Follows: kb/ADR-0003, api/ADR-0002
- Adds: api/ADR-0005 (proposed; ratify before merge)
- Accepts: api/ADR-0004
- Rules: added app/org.R12; changed app/org.R7; removed none; deviation added app/org.R2
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
behaviour-doc rule edits, when the project keeps behaviour docs, each as the doc id plus `.R<n>`
(`app/org.R7`, never `org.R7`), so the line also cites the doc for review. A *Known deviations*
entry the PR adds goes on the line too (`deviation added app/org.R2`): the human reviewer
approves it like a rule edit, and it does not exempt a break the same PR introduces. A rule in a
shared-home doc changes in its own KB PR, which merges first: until it does, the code PR is judged
against the rule on the KB's default branch, and a cited doc not there yet is a dangling
citation. The `stack` skill (`skills/stack/SKILL.md`) shows the order of the two PRs. An id
inside an HTML comment
(`<!-- ... -->`) is not a citation, so a template can show real-looking example ids there without
every PR appearing to cite them.

When the ADR check blocks: conform, or replace the record (`/lore:adr replace …`), or, for a
broken behaviour rule, edit the rule (in this PR, or in a KB PR that merges first). For a rule
with a `Source:`, the record wins: conform, or replace the record; editing the rule alone is
not a fix. For an
uncovered choice: low tier, add the record and have it accepted in this PR before merge; high
tier, open its own ADR PR and wait until it is accepted. To merge anyway, a member of the
repository's bypass group overrides the required check.
