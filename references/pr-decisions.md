# The PR *Decisions* section and `ADR-Exempt`

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

## `ADR-Exempt`

The ADR review blocks on a contradiction with an accepted record, a fired invalidation trigger,
or a hard-to-reverse choice no record covers. To merge anyway, say why, on its own line in the
PR description:

```text
ADR-Exempt: kb/ADR-0003 — hotfix; the superseding record is in review
ADR-Exempt: api/ADR-0002.R1 — load test only, removed before release
ADR-Exempt: migration spike, reverted next sprint
```

Put these lines after the *Decisions* section, not inside it. Exemptions are never read as
citations either way.

- With an id, it exempts the findings on that record (or only that rule or fact). A finding that
  lists several rules is cleared only when every rule it names is exempted.
- Without one, it exempts every finding in the PR; prefer the id form.
- A reason is required. A line with an id and no reason is ignored (listed as invalid), never
  widened to the whole PR. An exempted finding is still reported, as Important, and every
  exemption is listed in the review summary, so exemptions stay visible and can be tuned.
- Only visible text counts: a line inside an HTML comment or a fenced code block is ignored. Keep
  example `ADR-Exempt` lines in a PR template inside an HTML comment for exactly this reason — the
  template documents the syntax without accidentally exempting anything.
- Reviewing local changes with no PR: put the same line in a commit message as a trailer (last
  paragraph), and review with the base branch known.
