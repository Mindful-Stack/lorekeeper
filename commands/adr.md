---
description: Record, ratify, observe, replace, retire, list, or discover architecture decision records (ADRs) — or say which ones bind a change. Takes plain words ("Alex approved kb/ADR-0004", "what applies to src/Billing?"). Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, data model) or to recover decisions already baked into the code.
---

# ADR Command

Architecture decision records are first-class knowledge: one hard-to-reverse decision per record,
numbered per home, reviewed through a PR, binding once a named human accepts it, and locked from
then on. This command owns everything that needs the user in the loop. Retrieval and scanning go
to the **architect** agent, writing and the git flow to the **knowledge-updater** agent, and every
mechanical rule to `scripts/adr-lint.js`.

## Usage

The argument is the request, in plain words. There are no subcommands to learn.

```
/lore:adr Use PostgreSQL as the primary datastore
/lore:adr Alex Doe approved kb/ADR-0004
/lore:adr billing-api/ADR-0002: invoices now exceed the 10k/day in F2
/lore:adr Replace 0002: move session state from cookies to bearer tokens
/lore:adr What decisions apply to src/Billing in billing-api?
/lore:adr list
/lore:adr find the decisions the code already made
```

A record is named by its qualified id (`kb/ADR-0004`, `billing-api/ADR-0002`) or a bare number. A
bare number resolves in the governed repo's local home first, then the shared home; if both have
it, ask which. Other teams' shared KBs are read-only: if a record lives in one, say where and stop.

## Understand the request

Pick one action from what the user says. If two fit, ask one question.

| The user says | Action |
|---|---|
| a decision, a choice, a title ("Use X for Y", "we decided …") | **record** |
| who approved or turned down a proposal ("accept 0004 by Alex", "Sam rejected kb/ADR-0003") | **ratify** |
| a fact a record relies on changed ("F2 no longer holds", "invoices now …") | **note a change** |
| a record is replaced, or they changed their mind about it ("supersede 0002 with …") | **replace** |
| a record no longer applies and nothing replaces it ("deprecate 0005, by Sam") | **retire** |
| which decisions apply to a change, a path, or a topic | **what binds** |
| nothing, or `list`, optionally a status | **list** |
| find the decisions the code already made | **discover** |

## Homes

A record lives in exactly one **home**: the **local home** `docs/adr/` (or the configured
`adr.localDir` / `repos[].adrDir`) inside the repo whose code it governs, ids `<repo>/ADR-NNNN`;
or the **shared home** `adrs/` in the team knowledge base, ids `kb/ADR-NNNN`. The record's
`blast_radius` decides the home, so the user is never asked where it goes: `local` and `service`
go local, `cross-service` and `customer` go shared. When the two coincide (one repo, or no KB),
there is one home and ids use the local prefix.

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js homes` once per invocation. Pass its JSON
verbatim to every agent; do not restate it. Two of its values matter here: a `governedRepo` of
`null` means ask which repo a new local record governs, and a `null` default branch means ask
which branch to base on (never assume `main`). A repo with `present: false` is not checked out:
say so when it matters, never guess its contents.

## The record format

The template is `${CLAUDE_PLUGIN_ROOT}/references/adr-template.md`: read it before drafting and
keep its keys and section order. The file is `<home>/NNNN-<problem-slug>.md`.

- `id` is `<prefix>/ADR-NNNN`; `title` is `"ADR-NNNN: …"`; `description` is the decision in one
  sentence with its strongest because (≤300 chars): listings show it, so it carries the decision.
- `tags` includes `adr`; prefer tags already in use (`grep -rh '^tags:'` the home).
- `status: proposed` and `decided_by: []` on every draft. The human who ratifies is named in
  **ratify**, never guessed. `consulted` lists the people asked.
- **Classification**: `reversibility` (`one-way` when undoing costs more than a day or breaks
  consumers, else `two-way`); `blast_radius` (`local` one module, `service` one repo,
  `cross-service` contracts between repos or services, `customer` visible to users);
  `sensitivity` (any of `security`, `privacy`, `billing`, `legal`, `contract`, or `[]`).
- **High tier** = `one-way`, or `cross-service`/`customer`, or any sensitivity. It needs two
  considered options, an invalidation trigger and a non-empty `scope`, and gets its own ADR-only
  PR, accepted before implementation. A low-tier record may ride along in the implementation PR.
- `scope`: globs for the governed code, relative to the repo root in a local record
  (`src/Billing/**`), prefixed with the repo in a shared one (`billing-api:src/Billing/**`).
- Relations hold qualified ids: `supersedes`, `superseded_by` (only when superseded),
  `depends_on`, `related`. Write them only on the record you are drafting; reverse links are
  computed. `implements` stays `[]`.
- Every value inline on its key's line: block scalars and block lists fail the validator.

Body: *Context* (facts a proponent of the losing option would accept); *Facts relied on* (`F1 …
— source: <path, URL or command>`); *Considered options* (two or three, each with one honest
advantage); *Decision* (one falsifiable sentence, named actor, strongest because, then rules `R1`,
`R2` … each a MUST or MUST NOT); *Consequences* (at least one real negative); *Assumptions and
invalidation triggers* (`*Assumes X.* Trigger: <event> ⇒ supersede.`); *Later observations*
(empty on a draft); *See also*. Aim for 300–900 words, one decision per record (decompose "store X
in Y" bundles), plain sentences, and never mention chat sessions or AI authorship.

Numbers are four digits, per home, never reused: `adr-lint next --base origin/<default> <home-dir>`
(drop `--base` when that ref does not exist). The slug names the problem, never the answer.

## Lifecycle

```
proposed ──(ratify, naming a human)──► accepted ──► superseded | deprecated
    └──(ratify: rejected, naming a human)──► rejected
```

A proposal is a draft: amend it freely; code must not depend on it. Accepting locks the record for
good; rejected, superseded and deprecated records are locked too. A locked record changes only by
the five edits the knowledge-updater lists (a Status line, the supersede link, an observation, a
format or link repair, a schema backfill); anything else is a new record that replaces it.

**Legacy** records predate this format (no `reversibility`, or no frontmatter at all). One
conversion may rewrite a legacy record into the template; it keeps the record's status moving only
forward and keeps the deciders it records. Until converted, a legacy record with a locked status
takes only the five edits. Details are in `/lore:migrate`.

## Actions

Every write follows the same three steps: **show** the exact file or edit with its path, tier and
where it will land; **confirm** with the user; **apply** by dispatching the knowledge-updater with
Type `adr`, the file(s), the Home (`shared` or `local:<repo>`), the homes JSON, the line
`ADR lint: ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js` (written out as an absolute path), the
decider or the people the user says should approve, and the user's preference about riding along
on their branch. The updater decides where the change lands. If it returns findings, show them,
fix them with the user, and apply again. Confirm with what it reports: where the change landed
(in words, plus the PR URL or the branch) and the next step.

### record

1. **Triage.** Will code depend on it, and does changing it cost more than a day? Say which:
   **record it** (expensive to reverse, crosses a boundary, or keeps being re-debated); **one
   line** (a reversible local convention: offer a line in a standard or a learning); **no record**
   (routine: the PR description is enough). A decision with no code behind it (a tool, a process)
   belongs in an RFC or meeting notes. Stop at a lighter option unless the user insists.
2. **Load context.** In parallel: the **architect** in `bind` mode with the topic, the homes JSON
   and the catalogue (`adr-lint index --json`, saved to the session scratchpad; plus
   `adr-lint select --repo <repo> --paths <a,b>` when the code paths are known, repo-relative),
   and the
   **knowledge-reader** with "Prioritise domain context and architecture patterns." If the
   architect names a record that already covers the decision, stop and offer ratify, replace, or
   nothing. Grep the code so Context and the facts rest on evidence.
3. **Interview, one question at a time,** skipping what the user already said: who uses it and
   across which boundaries; the real alternatives and why they lost; **scope**; **facts** and where
   each can be checked; and the classification as one plain multiple choice — "Is it a local
   convention, one service, a contract between services, or visible to customers? Is it hard to
   undo? Does it touch security, privacy, billing, legal or a contract?" Stop as soon as every
   section can be written honestly.
4. **Draft** each decision (one interview may give several records): home from `blast_radius`,
   number from `adr-lint next` (consecutive within a home), `status: proposed`, `decided_by: []`,
   Status line `Proposed YYYY-MM-DD.` Write drafts to the session scratchpad.
5. **Self-check** and fix inline: one falsifiable Decision; every rule a MUST/MUST NOT; Context a
   losing proponent would accept; every fact sourced; two or three real options; a real negative;
   a trigger; classification matching the evidence; scope non-empty for high tier and in the home's
   syntax; every value inline; no AI authorship.
6. **Show** the file:

   > **Proposed ADR** — `billing-api/ADR-0003` (low tier: two-way, service)
   >
   > **File:** `billing-api/docs/adr/0003-invoice-numbering.md`
   >
   > ```markdown
   > [complete file contents]
   > ```
   >
   > High tier: "It gets its own PR; implementation waits until it is accepted."
   > Low tier, local home: "Ride along on your current branch, or its own PR?"
   >
   > Does this look right? I can adjust any section or the classification first.

7. **Apply** (several records in one home go as one batch), then confirm with the next step:
   "once it is approved, tell me who approved it" (a shared-home record, or one riding along with
   code in its scope, keeps the ADR check red until then). If the decision implies a standing
   rule, offer that line for a standard or `CLAUDE.md` too.

### ratify

1. **Find the record** (in the working tree, on the open PR branch that carries it, or on
   `origin/<default>`). Accept needs `status: proposed`, or a legacy record (accepting a legacy
   accepted record converts it). Reject needs `status: proposed` (legacy proposals included); an
   accepted record is never rejected.
2. **Name the decider.** Use the names the user gave; otherwise ask "Who approved this?" Never
   infer a name from git config, the session or the PR author. Refuse an agent or bot (Claude,
   Codex, Copilot, an AI or assistant, anything ending in `[bot]`): an agent never ratifies.
3. **Make it complete first.** A proposal is still a draft, so before the edit: classify it if it
   has no `reversibility` (with `id` and `scope`), add the high-tier extras if it lacks them (not
   needed for a rejection), and convert a legacy record into the template from its old text,
   keeping its meaning, its Status lines and its recorded deciders (the named decider must match
   them, or is added only when none are recorded). Show any such change with the edit.
4. **Edit.** Accept: `status: accepted`, `decided_by: [<names>]`, and append
   `Accepted YYYY-MM-DD by <names>.` to `## Status`. Reject: `status: rejected`, `decided_by`, and
   `Rejected YYYY-MM-DD by <names>: <one-line reason>.` (a rejected record merges and stays, so
   the reason is worth a sentence; it never touches a predecessor).
5. **Predecessors** (accept only, for each id in `supersedes`): in the same home, flip it in the
   same change — `status: superseded`, `superseded_by: <this id>`, and one Status line
   `Superseded YYYY-MM-DD by <this id>.` In another home, see **replace**.
6. **Show, confirm, apply,** and say the PR can merge once checks pass.

### note a change

1. The record must be locked; a proposal is amended directly instead.
2. Draft one dated bullet answering when and where (date, PR or ticket), which statement (quoted,
   or its `F#`), what is true now and its source, and what it means. Example:
   `- 2026-11-02 (PR 412): F2 no longer holds — invoices reach 14k/day (source: billing
   dashboard). No trigger fired; the decision holds.`
3. Append it at the end of `## Later observations` (add the section before *See also* if a legacy
   record lacks it). If a trigger fired, say so and offer **replace**.
4. Show, confirm, apply.

### replace

Only an `accepted` or `deprecated` record can be replaced. A `superseded` one points at its
successor: offer to replace that. A `proposed` one is amended instead. A `rejected` option comes
back as a new record with `related: [<id>]` whose Context says why.

1. Run **record** with the new decision: the draft carries `supersedes: [<old id>]`, its Context
   opens with what changed, and it classifies itself (so it may land in another home). The
   architect will name the old record: that is expected.
2. The old record is not touched now: it binds until the successor is accepted. The successor gets
   its own PR, never a ride-along.
3. On **ratify** of the successor: in the same home, the predecessor flips in the same PR. In
   another home, open both PRs at once — the accepted successor in its home and the predecessor's
   flip in its own — and tell the user to merge the successor first (use the `stack` skill to show
   the order). Nothing checks the link across homes mechanically: the reviewers do.

A record in the wrong home is replaced by one in the right home whose Context says "refiled;
decision unchanged", or is left where it is.

### retire

For an `accepted` record that no longer applies, with nothing replacing it (otherwise
**replace**). Ask who decided (a named human, as for ratify). Edit `status: deprecated` and append
`Deprecated YYYY-MM-DD by <name>: <reason>.` Show, confirm, apply in its own PR.

### what binds

Read-only. Resolve the homes; write the catalogue; run `adr-lint select --repo <repo> --paths
<paths>` for the paths named (repo-relative), or use the topic alone; dispatch the **architect**
in `bind` mode with all of it. Render its report: binding records with their rules, triggers the
change fires, proposals and ruled-out records in the area, and gaps.

### list

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js index [--status <status>]
```

Show the table, and the relations when it prints any. If there are no records, say so and suggest
recording one or discovering the ones the code already made. End with: `Use /lore:prime <path> to
load a record into context.` Validating every home is `/lore:doctor`.

### discover

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

## Important Rules

1. **Show the edit, confirm, then write.** Every write goes through the knowledge-updater, on a
   branch or worktree: never on a default branch, never force-pushed. Drafts in the scratchpad
   need no approval.
2. **Only a named human ratifies.** Never infer the decider, never accept or reject on your own
   initiative, and refuse an agent or bot as decider.
3. **Not interactive?** Never write. Draft and show what you would write with your assumptions
   stated, then stop. A ratification without a named human stops and says one is required.
4. **Record before building.** High-tier code waits for its record to be accepted; a low-tier
   record is accepted before its PR merges.
5. **Locked records change by the five edits only.** Anything else is a replacing record.
6. **Numbers are per home and never reused;** homes come from `adr-lint homes`, never a
   hard-coded list.
