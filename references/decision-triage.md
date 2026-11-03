# Decision triage — turning what was decided into records

The planning skills (planning-initiative step 6, refining-epic step 5) use this to sort the
decisions a discovery turns up. A decision already taken is recorded, not only listed: a choice
that lives in Known knowns, a wiki page or a tracker ticket is lost once those are archived.

## Candidates

Collect them from three places, and name the source of each:

- **Open questions** from the discovery conversation;
- **Known knowns** that are choices rather than facts ("images are pulled by digest", "the edge
  terminates TLS"), above all a choice whose only source is a wiki page, a tracker key or a spec;
- **The architect's `survey`** dispatched in step 1: every hard-to-reverse decision it found
  that has no record. Use its output; never drop it because the user did not mention it.

A plain fact (a limit, a date, an earlier attempt) is not a candidate: it stays in Known knowns
with where it can be checked.

## The kind of record

The kind follows **the household's ADR process**. Before proposing kinds, look in the knowledge
base for it (the knowledge-reader from step 1, or a Grep of `knowledge/general/` for an ADR
process or "RFC or ADR" node); where it says otherwise, it wins.

Classify **reversibility first**, by the CLI reference's definition (*Reversibility*): a choice is
one-way when undoing it costs more than a day or breaks something others depend on, whatever
kind of choice it is. A one-way choice is always an **ADR**, a product policy too (data ownership,
a consent model, a pricing promise); a behaviour doc rule may follow from it and cite it with
`Source:` (ADR, then rule, then code). A two-way choice takes its kind from this table:

| The choice | Kind of record |
|---|---|
| Hard-to-reverse architecture that code depends on (code will depend on it, and changing it later costs more than a day) | an **ADR**, drafted by recording-decisions |
| Product policy (who may do or see what, consent, invitations, billing access) that is not hard to reverse | a rule in the capability's **behaviour doc** |
| A reversible convention | a **standard node** in the knowledge base |
| A choice no code depends on (a tool, a vendor with no integration, a process) | the **RFC outcome**, where the household keeps RFCs; a household without them records it as recording-decisions' triage says |
| A small choice inside one epic or initiative | a **dated line** under *Decisions* in that item's brief (`2026-10-30: <choice> (<who>)`) |

Specs are not decision records. A spec lists the decisions it makes and is kept as dated history;
a hard-to-reverse decision in a spec becomes a proposed ADR first. The same holds for a wiki page,
a tracker ticket or a chat thread: none of them is a record.

## Show, then write

Show every candidate before anything is written, one line each:

```
<candidate> — source: <open question | known known | survey> — outcome: <kind, or one below> — where: <home, doc or item>
```

Then, per candidate, the outcome the user picks (each write is content you composed, so it needs
its own yes as the CLI reference's *Confirmation* says; in a session that cannot ask, only what
the request names is written and the rest is listed as proposals in the report):

- **Record it**, by its kind: an ADR through **recording-decisions** (draft, show, apply only on
  yes, as the skill's required-decision steps say); a behaviour doc rule, a standard node or an
  RFC outcome through **knowledge-update** (a reviewed PR to that doc or node, or the outcome
  linked where the household keeps RFCs); a dated line in the brief edit of the same run. Then
  add its line under *Decisions* in the brief, naming the record, and point the known known at it.
- **Require a decision** (still open, consequential, blocking work): the skill's
  `reeve decision require` step, with a decider from the user and the reversibility classified
  first (above): `one-way` when undoing the choice costs more than a day or breaks something
  others depend on, whatever its kind; `two-way` otherwise.
- **Close a required decision**: when an open required decision in the planner no longer waits on
  a record the planner can link, offer one of two closes (the CLI reference's *Closing a
  decision*):
  - **decided**, two-way only: `reeve decision close <id> --decided <text> --json`. Settled in
    the conversation (a dated line, a standard node), the text says what was decided ("flat fee:
    dated line on GRA-20's brief"); no other citation is needed. Settled by a behaviour doc rule,
    close only once the rule is merged on the default branch, and name the path, the rule id and
    the PR: `--decided "docs/behaviour/orgs.md org.R7 (app#123)"`. Never for a one-way decision:
    only its accepted ADR settles it, so propose the record and link it; the planner refuses
    `--decided` (a `validation` error).
  - **withdrawn**, when it is no longer needed: `reeve decision close <id> --withdrawn <text> --json`,
    the text saying why ("the epic was dropped").

  A closed decision gates nothing; an ADR that answers a decision is linked instead
  (recording-decisions **link**).
- **Leave it** in Known knowns (a fact after all) or drop it, saying so.

The report lists each candidate with its outcome and record, or "proposed, not written".
