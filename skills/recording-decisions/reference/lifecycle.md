# Lifecycle

```
proposed ──(ratify, naming a human)──► accepted ──► superseded
    └──(ratify: rejected, naming a human)──► rejected
```

A proposal is a draft: amend it freely; code must not depend on it, and its PR merges only once
it is accepted (CI blocks a shared-home or ride-along proposal, not a local one in its own PR).
Accepting locks the record for good; rejected and superseded records are locked too, and terminal.
There is no `deprecated`: a decision that no longer applies is superseded by a short record that
says what is true now.
A locked record changes only by the five edits the knowledge-updater lists (a Status line, the
supersede link, an observation, a format or link repair, a schema backfill); anything else is a
new record that replaces it.

**Legacy** records predate this format (no `reversibility`, or no frontmatter at all). One
conversion may rewrite a legacy record into the template; it keeps the record's status moving only
forward and keeps the deciders it records. A legacy `deprecated` record (frontmatter or prose)
only warns; it converts only to `superseded`, with an accepted successor. Until converted, a legacy record with a locked status
(in frontmatter or prose) takes only the five edits. Details are in `/lore:migrate`.
