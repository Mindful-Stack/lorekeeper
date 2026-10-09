---
description: Record, list, accept, observe, supersede, move, or discover architecture decision records (ADRs) in their homes — the governed repo's docs/adr or the team knowledge base. Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, data model) or to recover decisions already baked into the code.
---

# ADR Command

Architecture decision records are first-class knowledge: one hard-to-reverse decision per record,
numbered per home, reviewed through a PR, binding once a named human accepts it, and locked from
then on. This command owns everything that needs the user in the loop: triage, interview,
drafting, ratification, and the PR. Retrieval and scanning are delegated to the **architect**
agent, writing and the git flow to the **knowledge-updater** agent, and every mechanical rule to
`scripts/adr-lint.js`.

## Usage

```
/lore:adr <title or one-line description>   # new record: triage → interview → draft → PR
/lore:adr                                   # list records across every home
/lore:adr list [status]                     # list, optionally filtered (proposed|accepted|…)
/lore:adr index                             # list plus relations and reverse links
/lore:adr accept <ref> [by <name>, …]       # a named human ratifies a proposed record
/lore:adr reject <ref> [by <name>, …]       # a named human declines a proposed record
/lore:adr observe <ref> <what changed>      # append a dated observation to a locked record
/lore:adr supersede <ref> <title>           # propose a new record that replaces <ref>
/lore:adr deprecate <ref> <reason>          # the decision no longer applies, nothing replaces it
/lore:adr move <ref>                        # move a record to another home (two-PR stack)
/lore:adr retire <ref> by|to <id>           # second PR of a cross-home supersede or move
/lore:adr lint                              # run the validator over every home
/lore:adr discover                          # find implicit decisions in the code, draft records
```

`<ref>` is a qualified id (`kb/ADR-0004`, `billing-api/ADR-0002`) or a bare number. A bare number
resolves in the governed repo's local home first, then the shared home; if both have it, ask
which one. Other teams' shared KBs are read-only: if `<ref>` lives in one, say where it lives and
stop.

## Examples

```
/lore:adr Use PostgreSQL as the primary datastore
/lore:adr accept kb/ADR-0004 by Alex Doe
/lore:adr observe billing-api/ADR-0002 Invoices now exceed the 10k/day assumed in F2
/lore:adr supersede 0002 Move session state from cookies to bearer tokens
/lore:adr move kb/ADR-0006
/lore:adr discover
```

## Homes

A record lives in exactly one **home**:

- **Local home** — `docs/adr/` (or the configured `adr.localDir` / `repos[].adrDir`) inside the
  repo whose code it governs. Ids: `<repo>/ADR-NNNN`.
- **Shared home** — `adrs/` inside the team knowledge base (`<team-knowledge-path>/adrs/`).
  Ids: `kb/ADR-NNNN`.

The record's `blast_radius` decides the home, so the user is never asked where a record goes:
`local` and `service` go to the governed repo's local home, `cross-service` and `customer` go to
the shared home. When the two homes coincide (a single repo whose KB folder is that home, or a
repo with no KB), there is one home and ids use the local prefix.

Resolve the homes once per invocation and reuse the answer:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js homes
```

It prints JSON: `mode` (`household` or `single`), `root`, `governedRepo` (the repo whose checkout
contains the CWD, or `null` at the household root), `config` (`localDir`, `sharedDir`,
`decisionOwners`, `deciders`), `localHomes` (`repo`, `dir`, `present`, `exists`, `coinciding`,
`defaultBranch`), `sharedHome`, `sharedHomeExists` and `sharedDefaultBranch`, and `otherKbs`.
Wherever this file says `<default-branch>`, use the home's `defaultBranch` (or
`sharedDefaultBranch`), and `main` when it is `null`. A repo with `present: false` is not checked
out: say so when it matters, never guess its contents. The **governed repo** for a new local
record is `governedRepo`; when it is `null`, ask which repo the record governs (the only "where"
question, and only then).

If no `Knowledge path:` marker is present and `homes` reports no shared home, the local home is the
only home; that is a valid setup, not an error.

## The record format

The canonical template is `${CLAUDE_PLUGIN_ROOT}/references/adr-template.md`. Read it before
drafting and keep its frontmatter keys and section order exactly. The file lives at
`<home>/NNNN-<problem-slug>.md`.

**Frontmatter**

- `id` is `<prefix>/ADR-NNNN` for the home and number. `title` is `"ADR-NNNN: …"` (bare number) and
  may state the decision. `description` is the decision in one sentence with its strongest
  because (≤300 chars): listings and search show it, so it carries the whole decision.
- `tags` always includes `adr`; prefer tags already in use (`grep -rh '^tags:'` the home).
- `status` is `proposed` on every draft. Agents never write `accepted` except in the `accept`
  flow below, with the human the user named.
- `decided_by` stays `[]` on a draft: the human who ratifies is named at `accept`, never guessed.
  `consulted` lists the people asked.
- **Classification** — the drafting agent proposes, the human confirms:
  - `reversibility`: `one-way` when undoing it costs more than a day or breaks consumers,
    otherwise `two-way`;
  - `blast_radius`: `local` (one module), `service` (one repo or deployable), `cross-service`
    (contracts between repos or services; household-wide decisions too), `customer` (visible to
    users or customers);
  - `sensitivity`: any of `security`, `privacy`, `billing`, `legal`, `contract`; `[]` for none.
- **High tier** = `one-way`, or `cross-service`/`customer`, or any sensitivity tag. A high-tier
  record needs at least two considered options, at least one invalidation trigger, and a
  non-empty `scope`; it is decided by someone in `config.decisionOwners` (when configured) and
  gets its own ADR-only PR, merged as accepted before any implementation PR. A low-tier record is
  decided by someone in `config.deciders` (when configured) and may ride along in the
  implementation PR.
- `scope`: globs for the code the decision governs. In a local record they are relative to the
  repo root (`src/Billing/**`); in a shared record each is prefixed with the repo name
  (`billing-api:src/Billing/**`). Reviews select records by scope, so a record with no scope is
  only found by search.
- Relations hold qualified ids: `supersedes` (list), `superseded_by` (one id, set only when the
  record is superseded), `depends_on`, `related`. Write a relation only on the record you are
  drafting; reverse links are computed on read (`index`), never written into the target.
- `implements` is reserved for behaviour-spec rule ids; leave it `[]`. `rfc` is an optional URL.
  `aliases` holds former ids after a move.
- Every value sits inline on its key's line. Block scalars (`>` / `|`) and block lists are
  invisible to retrieval and fail the validator.

**Body**

- *Context*: value-neutral facts a proponent of the losing option would accept.
- *Facts relied on*: numbered `F1 … — source: <path, URL or command>`, each checkable by an
  agent later. These are what observations and reviews hold up against the code.
- *Considered options*: two or three viable alternatives, each with one honest advantage.
- *Decision*: one falsifiable sentence, active voice, named actor, strongest because; then
  numbered rules `R1`, `R2`, … each a MUST or MUST NOT a reviewer can hold code against
  (`kb/ADR-0007.R2` is how reviews cite them).
- *Consequences*: complete claims with reasons, at least one real negative.
- *Assumptions and invalidation triggers*: `*Assumes X.* Trigger: <concrete event> ⇒ supersede.`
- *Later observations*: empty on a draft; appended to after acceptance (`observe`).
- *See also*: same-home links as `[[adrs/NNNN-…]]` in the KB or plain relative links in a local
  home; cross-home references as the qualified id in text, never a path.

**Writing rules**

- Target 300–900 words; past about 1,500 it is a design doc: split the decision or link the design.
- One decision per record. "Store X in database Y" is usually three decisions (technology, data
  model, isolation) that break at different times; decompose.
- A conversation with a future developer: plain sentences, one idea each. "For now" and "we
  should consider" are not decisions.
- Never mention chat sessions or conversations, never attribute authorship to an AI.

**Naming and numbering**

- `NNNN` is four digits, per home, never reused. Get the next one with
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js next [--base origin/<default-branch>] <home-dir>`
  (with `--base` when the home's repo has that ref, so numbers already merged upstream count;
  `<default-branch>` comes from `homes`).
- The slug names the problem, never the answer (`0005-session-storage.md`), so it stays honest
  after a supersede.

## Lifecycle and the locked-record rule

```
proposed ──(accept, naming a human)──► accepted ──► superseded | deprecated
    └──(reject, naming a human)──────► rejected
```

- **proposed** — a draft. Amend freely. Code must not depend on it. A proposal in the shared home
  lives only on its PR branch: the KB's default branch holds settled records.
- **accepted** — a named human ratified it. This **locks** the record for good, whatever its later
  status. **rejected**, **superseded** and **deprecated** records are locked too; rejected records
  are merged and kept so nobody re-proposes a dead option.

A locked record changes only by these five edits; everything else is a new record that supersedes
it. The validator checks each one mechanically against the base branch.

| # | Edit | Mode |
|---|---|---|
| 1 | One new line appended to `## Status`, with a transition to `superseded`/`deprecated` or a note | `deprecate`, `accept` (predecessor flip), `retire` |
| 2 | Setting `superseded_by` with the flip to `superseded` (successor already accepted); a move stub | `accept`, `retire` |
| 3 | A dated bullet appended to `## Later observations` | `observe` |
| 4 | Formatting or a link target (bare wikilinks only in *See also*) | by hand, via `/lore:update` |
| 5 | Backfilling `id` and empty classification keys on a record from before this format | `/lore:migrate` |

Spelling fixes are not repairs. A wrong fact is an observation; a wrong rule, scope or
classification is a superseding record.

## Where a change lands

Every write goes through the **knowledge-updater** agent with Type `adr`, the record's **Home**
(`shared`, or `local:<repo>`), a **Placement**, and two inputs it cannot work out reliably on its
own: `ADR lint: ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js` written out as an absolute path, and the
`homes` JSON. The placements:

- `own-pr` — a new branch off the home repo's default branch and a PR. The agent works in a
  temporary git worktree, so the user's checkout and branch are never touched. High-tier records
  always use this.
- `pr-branch <branch>` — commit onto the open PR branch that already carries the record and push.
  `accept` and `reject` of a proposal under review use this. When that branch is the one checked
  out in the user's repo, it behaves as `ride-along` instead.
- `ride-along` — write into the user's working tree on their current branch and stage it, without
  committing. Only for a low-tier record in a local home, and only when the user chooses it.

The agent runs `adr-lint check` on the result before it commits; a failing check stops the write.
A proposal under review is expected to fail CI's check until it is accepted (a shared-home
proposal never merges as proposed, and a ride-along must be accepted before its PR merges), so the
agent validates a change that proposes a record with `--draft`, which reports those two findings
as warnings.

## Implementation

Parse the argument. The first word selects the mode when it is one of `list`, `index`, `accept`,
`reject`, `observe`, `supersede`, `deprecate`, `move`, `retire`, `lint`, `discover`; no argument
lists; anything else is a new record.

### `list [status]` and `index`

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js index [--status <status>]
```

Show the table it prints (for `index`, also the relations and reverse links). If it lists no
records, say so and point at `/lore:adr <title>` and `/lore:adr discover`. End with:
`Use /lore:prime <path> to load a record into context.`

### `<title>` → New record

1. **Triage.** Will code depend on it, and does changing it later cost more than a day? Say
   which tier it is:
   - **record it** — expensive to reverse, crosses a module or service boundary, or keeps being
     re-debated;
   - **one line** — a reversible local convention: offer a line in a standard or a learning;
   - **no record** — routine implementation: the PR description is enough.
   A code-independent decision (a tool, a vendor with no integration, a process) belongs in the
   team's RFC or meeting notes, not here. Stop at a lighter option unless the user insists.
2. **Load context.** Resolve the homes. Write the catalogue to a scratch file with
   `adr-lint index --json > <scratch>/adr-index.json`. Dispatch two agents in parallel: the
   **architect** in `bind` mode with the topic, the homes JSON, and the catalogue path (plus
   `adr-lint select --repo <repo> --paths <paths>` output when the code paths are known), and the
   **knowledge-reader** with "Prioritise domain context and architecture patterns." If the
   architect names a record that already covers the decision, stop and offer `accept`,
   `supersede`, or nothing. Grep the code for the thing being decided so Context and *Facts
   relied on* rest on evidence.
3. **Interview, one question at a time,** skipping anything the user's message already answers:
   who uses it and across which boundaries; isolation and access control; read/write patterns
   and scale; retention; adjacent planned work; the real alternatives and why they lost;
   **classification** (how costly to undo, how far the effect reaches, any sensitivity); **scope**
   (which paths will depend on it); **facts** the decision rests on and where each can be
   checked. Prefer multiple choice. Stop as soon as every section can be written honestly; when
   running non-interactively, draft with the assumptions stated in the summary instead of asking.
4. **Decompose bundles** into separate records, one interview, N files.
5. **Home and number.** Derive the home from `blast_radius` (above). Get the number with
   `adr-lint next` for that home. Records from one interview that land in the same home take
   consecutive numbers.
6. **Draft** from the template: `status: proposed`, `decided_by: []`, Status line
   `Proposed YYYY-MM-DD.` Write the draft to the session scratchpad first.
7. **Self-check**, and fix inline:
   - Is the Decision one falsifiable sentence, and is every rule a MUST/MUST NOT a reviewer can
     hold code against?
   - Would a proponent of the losing option accept every sentence in Context?
   - Is every fact checkable, with a source?
   - Two or three real alternatives, each with an honest advantage? At least one genuine
     negative consequence? At least one invalidation trigger?
   - Does the classification match the evidence, and the home match `blast_radius`?
   - Is `scope` non-empty for a high-tier record, and in the home's syntax?
   - Every frontmatter value inline, `description` the decision itself, `decided_by` empty, no
     mention of sessions or AI authorship?
   Then lint it without touching the user's checkout: copy the home directory and the draft into
   a scratch directory and run `adr-lint check --draft --home <shared|local> [--repo <repo>]
   <scratch-home>`. Fix every error before presenting.
8. **Present** the file with its path, tier and PR shape:

   > **Proposed ADR** — `billing-api/ADR-0003` (low tier: two-way, service)
   >
   > **File:** `billing-api/docs/adr/0003-invoice-numbering.md`
   >
   > ```markdown
   > [complete file contents]
   > ```
   >
   > High tier: "It gets its own ADR-only PR; implementation waits until it is accepted."
   > Low tier, local home: "Ride along in your current branch (accepted before merge by the
   > approver), or its own PR?"
   >
   > Does this look right? I can adjust any section, the classification, or the status first.

9. **Apply** on confirmation: dispatch **knowledge-updater** with Type `adr`, Action `create`,
   the file, Home, Placement (`own-pr` for high tier; the user's choice for low tier), the
   `ADR lint:` path and the homes JSON. For several records from one interview, use the batch
   shape: one batch per home.
10. **Confirm** with the PR URL (or "staged on <branch>") and the next step. High tier: "its PR
    stays red on the ADR check until it is accepted: get it reviewed, then
    `/lore:adr accept <id> by <name>`". Ride-along: "once the approver approves the PR, run
    `/lore:adr accept <id> by <approver>` before merging". If the decision implies a standing
    rule, offer that one line for the relevant standard or the repo's `CLAUDE.md`, in the same PR.

### `accept <ref> [by <name>, …]` → Ratify

1. **Find the record and its placement.** Stop unless its `status` is `proposed`.
   - In the working tree of its home, on the branch the user has checked out: Placement
     `ride-along` (the user commits the edit with their change).
   - In the working tree, on the home repo's default branch (a proposal from before this
     format, still on the default branch): Placement `own-pr`.
   - Not in the working tree: it is on an unmerged branch. Find the PR with `gh pr list` in the
     home's repo (search the filename or `ADR-NNNN`), or ask for the PR number; read the record
     with `git show origin/<branch>:<path>` after a fetch. Placement `pr-branch <branch>`.
2. **Name the decider.** Use the names after `by`; otherwise ask "Who is ratifying this
   decision?" Never infer a name from git config, the session, or the PR author, and never
   proceed without one: in a non-interactive run, stop and say a named human decider is
   required. Refuse any name that identifies an agent or bot (Claude, Codex, Copilot, an AI or
   assistant, anything ending in `[bot]`): an agent cannot ratify.
3. **Check the decider.** The pool is `config.decisionOwners` for a high-tier record and
   `config.deciders` otherwise; when that list is non-empty, at least one named decider must be
   in it (case-insensitive, `@` ignored). If not, say who may decide and stop.
4. **Make it acceptable before asking anyone to decide.** A proposal is still a draft, so fix it
   now, as a draft amendment, rather than after the decider has been named:
   - **Unclassified** (a proposal from before this format, no `reversibility`): accepting it ends
     its grace period, so it needs `id`, the classification and `scope`. Propose them from its
     content and confirm with the user, as in the New record interview.
   - **High tier** (unclassified counts as high tier): it needs at least two considered options,
     at least one invalidation trigger, and a non-empty `scope`. If the body lacks them, amend it.
   - Lint the result as in New record step 7 (`check --draft` in a scratch copy).
5. **Edit:** `status: accepted`, `decided_by: [<names>]`, and append to `## Status`:
   `Accepted YYYY-MM-DD by <names>.` Nothing else changes.
6. **Predecessors.** For each id in `supersedes`:
   - **same home** — flip it in the same change: `status: superseded`, `superseded_by: <this
     id>`, and append `Superseded YYYY-MM-DD by <this id>.` to its Status. Its body stays as is.
     A locked record gains one Status line per PR, so when its last Status line is the
     `Supersession proposed … by <this id>` note and that line is absent from
     `origin/<default-branch>` (this same PR added it), **replace** the note with the
     `Superseded` line instead of appending.
   - **another home** — leave it. Add to this record's Status line: `Supersedes <id> once
     retired there.` After this PR merges, the user runs `/lore:adr retire <id> by <this id>` for
     the second PR (use the `stack` skill to show the order).
7. **Apply** with knowledge-updater, Action `update` (a batch when a predecessor is flipped), with
   the Placement from step 1. Confirm what was committed, or staged, and that the PR can merge once
   checks pass.

### `reject <ref> [by <name>, …]` → Decline a proposal

As `accept` steps 1, 2, 4 (classification only: a rejected record has no tier extras) and 7, but
the edit is `status: rejected`, `decided_by: [<names>]`, and
`Rejected YYYY-MM-DD by <names>: <one-line reason>.` A rejected record merges and stays, so the
reason is worth a sentence. A rejected record never flips a predecessor. If the record supersedes
one in the same home and this PR added the `Supersession proposed … by <this id>` note to that
predecessor (the line is absent from `origin/<default-branch>`), **remove** the note in the same
change, leaving the predecessor as it is on the default branch.

### `observe <ref> <what changed>` → Append an observation

1. Read the record; stop unless it is locked (`accepted`, `superseded`, `deprecated`, or
   `rejected`). A proposed record is amended directly instead.
2. Draft one dated bullet that answers four things: when and where (date, PR or ticket), which
   statement (quoted, or its `F#`), what is true now and its source, and what it means — no
   trigger fired and the decision holds, or trigger X fired and a superseding record follows.
   Example: `- 2026-11-02 (PR 412): F2 no longer holds — invoices reach 14k/day (source: billing
   dashboard). No trigger fired; the decision holds.`
3. Append it at the end of `## Later observations` (add that section before *See also* if a
   legacy record lacks it). Nothing else changes.
4. If the observation says a trigger fired, say so and offer `/lore:adr supersede <ref>`.
5. Present, then apply: Placement `ride-along` when it belongs to the change the user is making
   in that repo and they agree, else `own-pr`.

### `supersede <ref> <title>` → Propose a replacement

Superseding is two transitions: this flow proposes the successor; the predecessor stays accepted
and binding until the successor is accepted (`accept` step 6).

1. Read `<ref>`. If it is `proposed`, offer to amend it instead.
2. Run the **New record** flow steps 1–8 with these adjustments: the architect will report
   `<ref>` as covering the decision — that is expected, stop only for a *different* record;
   the draft carries `supersedes: [<ref>]`, its Context opens with what changed since `<ref>`,
   and its classification may differ (it decides its own home).
3. **Same home:** add one Status line to `<ref>`:
   `Supersession proposed YYYY-MM-DD by <new id>; this record remains binding until it is accepted.`
   and land both files in one PR (batch shape). **Another home:** leave `<ref>` untouched.
4. Apply as for a new record and confirm, noting that `accept <new id>` retires `<ref>` (same
   home) or that `retire` follows the merge (another home).

### `deprecate <ref> <reason>` → Retire with no replacement

Only for an `accepted` record. Ask who decided it no longer applies (a named human, as for
`accept`). Edit `status: deprecated` and append `Deprecated YYYY-MM-DD by <name>: <reason>.`
Apply with Placement `own-pr`. If something replaces the decision, use `supersede` instead.

### `move <ref>` → Move to another home

For a record filed in the wrong home, or whose code moved to another repo. The decision itself
does not change: if the scope or classification changes, that is a `supersede`.

1. Read `<ref>`; it must be `accepted` (a proposal is simply amended and refiled). Work out the
   target home from its `blast_radius` and, for a local home, the governed repo. A coinciding home
   has nowhere to move to: say so and stop.
2. **PR 1, in the target home:** a new record with the next number there, the same body, `id`
   for the new home, `aliases: [<old id>]`, the same `decided_by`, `status: accepted`, `scope`
   rewritten for the new home's syntax, and the Status log copied with one line appended:
   `Moved YYYY-MM-DD from <old id>.` Classify it now if it predates classification. Apply with
   Placement `own-pr`, telling the knowledge-updater it is a move copy of `<old id>` (it writes
   `accepted` without a new decider only for that).
3. Tell the user: after PR 1 merges, run `/lore:adr retire <old id> to <new id>` for PR 2 (the
   `stack` skill orders the pair). Until then both copies are accepted and the newer binds.

### `retire <ref> by|to <id>` → Second PR of a cross-home pair

1. Read `<id>` from its home's default branch. It must be `accepted` there (merged), and for
   `to`, list `<ref>` in `aliases`. If not, say what is missing and stop.
2. **`by <id>` (supersede):** `status: superseded`, `superseded_by: <id>`, Status line
   `Superseded YYYY-MM-DD by <id>.`
   **`to <id>` (move):** replace the file with its stub — the same frontmatter plus
   `moved_to: <id>`, and a one-line body `Moved to <id>.`
3. Apply with Placement `own-pr` in `<ref>`'s home.

### `lint` → Validate every home

For each home with `exists: true`, run

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js check [--base origin/<default-branch>] <home-dir>
```

with `--base` when that repo has the ref (`git -C <repo> rev-parse --verify origin/<branch>`).
Report per home: errors, warnings, and the exit code; group findings by rule. Warnings on records
from before this format (missing `id` or classification) point at `/lore:migrate`. Read-only.

### `discover` → Decision archaeology

Recover the decisions a codebase already made without writing them down. The scanning happens in
the architect so the evidence never lands in this conversation; only the picks, the drafting, and
one review round do. Every pick arrives as a **proposed** record: a human ratifies each one with
`accept`, like any other.

1. Resolve the homes and write the catalogue (as in New record step 2). Dispatch the
   **architect** in `survey` mode with any scope the user gave, the homes JSON and the catalogue
   path. It returns at most fifteen candidates, each with the requirement, the choice, evidence
   paths, whether an alternative was weighed, a proposed classification and the governed repo.
2. Render its report verbatim, then ask in plain text: "Which should I record? Reply with numbers
   or topics, comma-separated, `all`, or `none`." Echo the resolved picks in one line; on `none`,
   skip to step 8.
3. **Triage and split** the picks once: drop lighter ones (say which and offer the lighter
   option), split bundles, and give each record its home from its classification. Number each
   home's records consecutively from `adr-lint next`, in candidate order, and list the plan
   (id, slug, one-line decision).
4. **One bind check** for the batch: the architect in `bind` mode with every planned topic. Drop
   or redirect to `supersede` any pick an accepted record already covers.
5. **Draft every record** in the scratchpad, `status: proposed`, Context reconstructed from the
   evidence. Where alternatives were not visibly weighed, say exactly that in *Considered
   options* rather than inventing a debate; a record that cannot honestly name two options and a
   trigger stays low tier or goes back to the user. For more than three records, fan the
   drafting out to parallel subagents, each returning the questions the evidence cannot answer.
   Self-check every draft (New record step 7).
6. **Ask once:** collect every open question and ask them together, in as few `AskUserQuestion`
   calls as the four-question limit allows.
7. **Review once:** a table of the batch (id, home, title, decision, tier) with a link to each
   draft file; ask for approval or amendments in one reply. Then dispatch **knowledge-updater**
   once per home with the batch shape, Placement `own-pr`, and `pr_title`
   `docs: propose <first id> to <last id> (discover)`.
8. **Summarise:** the PR URLs, the records each opens, the picks dropped at triage or bind, the
   candidates left unpicked, and that each record now needs `/lore:adr accept <id> by <name>`.

## Important Rules

1. **Developer approval before every write**, and every write through knowledge-updater on a
   branch: never commit to a default branch. Drafts in the session scratchpad need no approval.
2. **Record before building.** A decision about to be implemented gets a proposed record first.
   High-tier code waits until its record is accepted; a low-tier record is accepted before its
   PR merges.
3. **Only a named human accepts or rejects.** Never infer the decider and never accept on the
   agent's own initiative.
4. **Locked records change by the five edits only.** Anything else is a superseding record.
5. **Numbers are per home and never reused.** If two open PRs claim one number, the unmerged one
   renumbers: filename, `id`, `title` and inbound links. A merged number never changes.
6. **Never hard-code a repo or home list.** Homes come from `adr-lint homes`.
