# discover

Read `${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/reference/record-format.md` and
`${CLAUDE_PLUGIN_ROOT}/skills/recording-decisions/actions/record.md` first: its triage, draft and self-check
steps apply to every pick.

Recover the decisions a codebase made without writing them down. Every pick arrives as a proposal
that a named human then ratifies.

1. Dispatch the **architect** in `survey` mode with any scope the user gave, the homes JSON and
   the catalogue. It returns up to fifteen candidates with evidence, a proposed classification and
   the governed repo.
2. Render its report and ask: "Which should I record? Numbers or topics, `all`, or `none`."
3. Triage the picks once (drop lighter ones, split bundles), give each its home, number each home
   consecutively, and run one `bind` check for the batch: drop any pick an accepted record
   already covers.
4. Draft every record with Context from the evidence. Where alternatives were not visibly weighed,
   say so rather than inventing a debate. Fan out to subagents for more than three. Self-check.
5. Ask every open question together, then show the batch as one table (id, home, decision, tier)
   with a link to each draft, and get one approval.
6. Apply once per home as a batch, `pr_title` `docs: propose <first id> to <last id> (discover)`.
   Summarise the PRs, the dropped picks, and that each record now needs a named human's approval.
