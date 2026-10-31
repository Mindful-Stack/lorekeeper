# The Reeve planner CLI — what skills may call

Skills copy commands from this file, never from memory. Every flag below exists in the
`reeve-planner` CLI: `scripts/__tests__/reeve-reference.test.js` parses every command here with the
real binary when `REEVE_REAL_BIN` is set, and fails when that binary's `--help` lists a flag this
file does not mention for a command it documents.

## Detection and the binary

Run `node <plugin-root>/scripts/reeve-detect.js` once per skill invocation. It prints
`{"present", "signed_in", "url", "email", "bin", "run_id", "reason"}` and always exits 0. Use the
planner only when `present` and `signed_in` are both true; otherwise behave exactly as without it.

The binary is `${REEVE_BIN:-reeve}`, the one the detector checked; the detector prints it as `bin`.
Write that value as the command's first word (it is `reeve` unless `REEVE_BIN` is set), never the
`${…}` expression: permission rules such as `Bash(reeve *)` match the literal word. Below, `reeve`
stands for it.

## Arguments

Put `--json` on every command, as the last argument (the real CLI takes it anywhere; these
examples end with it). The CLI's other global flag, `--ascii`, only changes text output (each key's
level glyph, such as `◆` for an initiative, becomes `[I]`), so the skills never pass it.

**Markdown goes through a file.** A brief or a story description is Markdown: write it to a file
and pass the file, `--brief-file <brief file>` or `--description-file <description file>`, in
place of `--brief` or `--description`. The CLI sends the file's contents unchanged, with no shell
quoting in between, so headings (`## Vision`), apostrophes, backticks and a line starting with `-`
are all safe. Write the file with the Write tool, never with a heredoc or `echo` in the Bash
command (a heredoc carrying Markdown meets the permission check below), at an absolute path in a
temporary directory: the session's scratchpad directory when it has one, else `/tmp`, named for
the run and the item (`/tmp/reeve-<run_id>/GRA-12-brief.md`). `-` in place of the path reads
standard input, for a script that pipes the text in.

```
reeve epic create --initiative GRA-12 --title 'Matching queue' --brief-file /tmp/reeve-0a1b2c3d/matching-queue-brief.md --idempotency-key planning-initiative:GRA-12:0a1b2c3d:1 --json
```

**Other values are one line, inline.** A title, a criterion, a comment body or a reason is one
single-quoted argument on one line, `'\''` for an apostrophe, with no backticks and no `$(`. No
value starts with `-` (the real CLI reads it as a flag; only `comment add --body` accepts one):
open a title or criterion with a word, not a bullet. `--brief <md>` and `--description <text>`
inline (*Other flags*) are for one line of plain text under these same rules; anything longer goes
through the file.

Claude Code's permission check cannot inspect ANSI-C quoting (`$'…'`) and refuses a quoted
newline followed by `#`, indented or not; either one turns an allowed `Bash(reeve *)` call into a
permission prompt, and into a refusal when nobody can answer it (`claude --print`, CI). That is why
a multi-line value never goes inline.

## Envelope and exit status

Branch on the envelope on stdout, `outcome` first; the exit status alone does not tell a refusal
from a sign-in error.

| Envelope | Exit | Do |
|---|---|---|
| `{"outcome":"ok","value":…}` | 0 | proceed; read the field named below |
| `{"outcome":"refused","reasons":[…]}` | 2 | show the reasons (worded as below) and stop that step |
| `{"outcome":"error","code":"unauthenticated"` or `"forbidden"`, …`}` | 2 | stop the run: say the message and tell the user to run `reeve auth login` |
| `{"outcome":"error","code":"…","message":"…"}`, any other code | 1 | show code and message and stop that step |

Exceptions: `code: conflict` (the `--version` is stale) — re-read the item, fold what changed into
your text (a teammate's edit is kept, never overwritten), show it, and retry once with the new
`version`. `code: rate_limited` (the planner answered HTTP 429; the envelope carries
`retry_after_secs` when the server sent a Retry-After, and text output says to retry after N
seconds) — wait that many seconds (a few seconds when none is given), then run the SAME command
again, with the SAME `--idempotency-key` for a create: a create retried with its key answers the
same item, never a duplicate (an `apply` retried with the same plan file and `id` likewise). Retry at most twice; then show the code and message and stop that
step. `decision link` — see its section. A usage error (an unknown flag, a value starting with
`-`) prints the CLI's usage text on stderr and no envelope (stdout is empty), exit 1: fix the
command, never retry it as it was.

## Confirmation

Show each write (the command and the text it carries) before running it.

- **Content the request supplies** (titles, criteria, a decider, a due date, a home the user
  named, an answer): the request is the confirmation for that write; do not ask again.
- **Content you composed** (a rewritten brief, a new epic or initiative with its title, brief and
  horizon, a home you chose for a story): show it and write it only on a confirmation for that
  write. A blanket "I confirm every write" does not cover it. In a session that cannot ask, write
  it only when the request names that write ("write the brief from these answers", "place the
  untriaged stories", "create the new epic for GRA-43"); otherwise leave it as a proposal and list
  it in the report.
- **A question nobody can answer.** In a session that cannot ask, a question the request does not
  answer stops the run with the line `Stopped: missing <what>.`, on its own line; nothing after it
  is written. Never fill the gap yourself (a decider, a due date, a repository name).

## Idempotency keys

Every create passes `--idempotency-key <skill>:<KEY>:<run-id>:<n>`: the skill's name, the key of
the item the run works on (an item key, or a decision id for a run that works on one decision),
the detector's `run_id`, and the ordinal of this create in the run (1, 2, …, across every create
of the run). A skill called by another (recording-decisions from a planning skill) uses the
caller's skill name, `<KEY>`, `run_id` and next `<n>`. A retry within the run reuses its key; a new
run never reuses an old one, so only reading first keeps it from duplicating an earlier run's
items; never derive a key from a title. A plan's `id` (*Plans*) is built the same way and takes the next `<n>`. Print the run id in the report.

## Commands

| Command | Read |
|---|---|
| `reeve initiative show <KEY> --json` | `value.brief`, `.horizon`, `.owner` (null = none), `.target_month` (a month such as 2027-03, null = none), `.external_ref` (null = none), `.discovery_complete` (null = not complete), `.version` |
| `reeve initiative ls --json` | `value[]`: `key`, `title`, `horizon` |
| `reeve search <text> --json` | `value[]`: `key`, `item` (initiative, epic or story), `kind` (null = not a story), `title`, `matched[]` (which of title, brief, description and external_ref contain the text); newest first, at most 50, empty when nothing matches |
| `reeve initiative create --title <title> --horizon <bucket> --brief-file <brief file> [--owner <email>] [--target-month <YYYY-MM>] --idempotency-key <key> --json` | `value.key`, `value.version`; a bucket the planner does not have is a `validation` error |
| `reeve initiative edit <KEY> [--brief-file <brief file>] [--owner <email>] [--target-month <YYYY-MM>] --version <n> --json` | `value.version` |
| `reeve initiative discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve epic show <KEY> --json` | `value.brief`, `.initiative`, `.discovery_complete`, `.version` |
| `reeve epic ls [--initiative <KEY>] --json` | `value[]`: `key`, `title`, `initiative` |
| `reeve epic create --initiative <KEY> --title <title> --brief-file <brief file> --idempotency-key <key> --json` | `value.key`, `value.version` |
| `reeve epic edit <KEY> --brief-file <brief file> --version <n> --json` | `value.version` |
| `reeve epic discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve initiative findings <KEY> --json` / `reeve epic findings <KEY> --json` | `value[]`, `.finding`; empty when there are none (see *Findings*) |
| `reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json` | `value[]`: `{story, readiness: {ready, reasons[]}}`; `story.key`, `.title`, `.kind`, `.version`. Untriaged: kind `story` with no epic (a bug or chore without one is not listed) |
| `reeve story create --epic <KEY> --title <title> --kind story\|bug\|chore --criterion <text> [--criterion <text> …] [--owner <email>] --idempotency-key <key> --json` | `value.key`; an owner who is not an allowed user is a `validation` error |
| `reeve story edit <KEY> --version <n> [--epic <KEY>] [--kind story\|bug\|chore] [--owner <email>] --json` | `value.version`; an owner who is not an allowed user is a `validation` error |
| `reeve apply <plan file> --json` | `value.items[]`: `name`, `item`, `key`, `created`; `value.decisions[]`: `name`, `id`, `created`; `value.blocks[]`: `story`, `blocked_by`, `created` (see *Plans*) |
| `reeve story context <KEY> --json` | `value`: `{story, epic, initiative, required_decisions[], blockers[], comments[], readiness}` |
| `reeve decision ls --on <KEY> --json` | `value[]`: `id`, `on`, `on_type` (initiative, epic or story: the level of the item it is on), `title`, `decider`, `due`, `record` (null = no record), `pr_url`, `check.kind`, `closed` (null, or `{at, by, reason}`); closed decisions are listed too |
| `reeve decision show <id> --json` | `value`: one decision, the same fields |
| `reeve decision ls --initiative <KEY> --json` | `value[]`: `id`, `on`, `on_type`, `title`, `decider`, `record` (null = no record), `check.kind`, `closed` (null = not closed); every decision on the initiative, on its epics and on their stories, closed ones too |
| `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key <key> --json` | `value.id` |
| `reeve decision link <id> --record <qualified id> --repo <repo> --path <path in repo> --pr <url> --household <dir> --json` | `value.check.kind` |
| `reeve decision close <id> --reason <text> --json` | `value.closed.reason`, `value.closed.at`, `value.closed.by` |
| `reeve comment add --item <KEY> --body <text> --idempotency-key <key> --json` (or `--decision <id>`) | `value[]`, the thread |
| `reeve comment ls --item <KEY> --json` (or `--decision <id>`) | `value[]`: `id`, `author`, `body`, `at`; oldest first, empty when there are none |

An initiative's owner is an email and its target month is `YYYY-MM` (`2027-03`); pass either on
create or edit only with a value the user gave (rule *The user decides* in each skill), and leave a
flag out to keep what is there. A story's owner is likewise an email the user gave, and must be an
allowed user of the planner: any other is a `validation` error (show it; never retry with another
address). Pass `--owner` only when the user names who owns the story; `--no-owner` clears it, only
when the user asks.

**Search before creating** an initiative or an epic: `reeve search <text> --json` with the words
its title would use (several words are searched as one phrase, case-insensitive) finds initiatives,
epics and stories whose title, brief or description, or external reference contains them. A hit
that covers what you were about to create is reused (say which key); show the hits you judged
not to cover it. Run one or two searches, never one per word.

`--item` names an initiative, an epic or a story by its key (a key says what it is); a decision,
being numbered rather than keyed, takes `--decision <id>`. `--story <KEY>` is an older alias of
`--item <KEY>`: write `--item`.

No command lists the planner's configured repositories or horizon buckets (they are in
`GET /api/v1/config`, which the CLI does not expose): ask for them, or take them from the request.

## Other flags

The commands above are what the skills run. The real CLI takes these flags too; use one only when
the user asks for what it does, with the command written as shown.

| Command | What it does |
|---|---|
| `reeve initiative edit <KEY> --version <n> [--title <title>] [--horizon <bucket>] --json` | renames the initiative or moves it to another horizon bucket (a bucket the planner does not have is a `validation` error) |
| `reeve initiative discovery <KEY> --reopen --version <n> --json` / `reeve epic discovery <KEY> --reopen --version <n> --json` | reopens discovery that was marked complete |
| `reeve epic edit <KEY> --version <n> [--title <title>] [--initiative <KEY>] --json` | renames the epic or moves it to another initiative; `--no-initiative` in place of `--initiative` detaches it (a standalone epic) |
| `reeve story ls [--owner <email>] [--delivery <delivery>] [--label <label>] [--ready] [--mine] --json` | filters the list: owner, delivery state (`todo`, `in-progress`, `in-review`, `testing`, `done`), label, `--ready` (ready stories still in todo), `--mine` (owned by the signed-in user) |
| `reeve story create --epic <KEY> --title <title> --kind story --description-file <description file> --label <label> --criterion <text> --idempotency-key <key> --json` | a story with a longer description (Markdown, through a file as *Arguments* says) and labels (`--label` repeats, one per label) |
| `reeve story edit <KEY> --version <n> [--title <title>] [--criterion <text> …] [--rank <n>] --json` | renames the story, replaces ALL its criteria (one `--criterion` each; a criterion unchanged at the same position keeps its done flag) or sets its rank; `--no-epic` in place of `--epic` detaches it (it becomes untriaged) |
| `reeve story edit <KEY> --version <n> [--description-file <description file>] [--add-label <label> …] [--remove-label <label> …] --json` | replaces the whole description (through a file), or adds and removes labels (each repeats; a label the story already has is kept once) |
| `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key <key> --json` / `reeve initiative edit <KEY> --brief <md> --version <n> --json` / `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key <key> --json` / `reeve epic edit <KEY> --brief <md> --version <n> --json` | a one-line brief inline, in place of `--brief-file` (one line, single-quoted, as *Arguments* says) |
| `reeve story create --epic <KEY> --title <title> --kind story --description <text> --idempotency-key <key> --json` / `reeve story edit <KEY> --version <n> --description <text> --json` | a one-line description inline, in place of `--description-file` |
| `reeve story edit <KEY> --version <n> --no-owner --json` | clears the story's owner (`--no-owner` in place of `--owner`) |
| `reeve decision ls --mine --json` | the decisions the signed-in user is the decider of |

## Plans: reeve apply

`reeve apply <plan file> --json` creates initiatives, epics, stories, required decisions and
blockers in one request. A run that creates two or more items sends them as one plan: the
planner's edge rate-limits more than 5 API POSTs in 10 seconds, so a run of single creates is
answered `rate_limited` part-way. A run that creates exactly one item uses that item's single
create (*Commands*).

Write the plan as JSON to a file with the Write tool, as a brief is (*Arguments*); `-` in place of
the path reads standard input. The CLI also reads YAML; the skills write JSON.

```json
{
  "id": "refining-epic:GRA-20:0a1b2c3d:3",
  "initiatives": [{"name": "billing", "title": "Employer billing", "horizon": "Later", "brief": "## Vision\n\nEmployers pay for the programme.", "owner": "dan@example.com", "target_month": "2027-03"}],
  "epics": [{"name": "invoices", "title": "Invoices", "initiative": "billing", "brief": "Invoice employers monthly."}],
  "stories": [
    {"name": "send-invoice", "title": "Send a monthly invoice", "kind": "story", "epic": "invoices", "criteria": ["An invoice is sent on the first working day", "It lists every session of the month"]},
    {"name": "retry-match", "title": "Retry failed matches", "epic": "GRA-20", "description": "## Why\n\nCoordinators retry by hand today.", "criteria": ["A failed match is retried"], "labels": ["matching"]}
  ],
  "decisions": [{"name": "provider", "on": "invoices", "title": "Which invoicing provider", "decider": "dan@example.com", "due": "2026-11-15"}],
  "blocks": [{"story": "send-invoice", "blocked_by": "GRA-31"}]
}
```

- **Fields.** Every list is optional. An initiative has `name`, `title`, `horizon`, and optionally
  `brief`, `target_month`, `owner`, `external_ref`; an epic `name`, `title`, and optionally
  `initiative`, `brief`, `external_ref`; a story `name`, `title`, `criteria`, and optionally `kind`
  (a story when left out), `epic`, `description`, `labels`, `external_ref`; a decision `name`,
  `on`, `title`, `decider`, and optionally `due` (`YYYY-MM-DD`); a block `story` and `blocked_by`
  (`blocked_by` blocks `story`). Any other field is refused by the CLI before anything is sent (an
  `internal` error naming the field). A story's owner, a comment and an edit of an existing item
  are not in a plan: run them after it.
- **Names.** Each item and decision has a local `name`, unique in the plan: lower-case words with
  hyphens (`send-invoice`), never shaped like a key (`GRA-31` is refused).
- **References.** `initiative`, `epic`, `on`, `story` and `blocked_by` name an item of the plan by
  its name, or else an existing item by its key (`GRA-20`) or external reference. `on` may name an
  initiative, an epic or a story.
- **The id.** `<skill>:<KEY>:<run_id>:<n>`, built like an idempotency key, the plan taking the run's
  next `<n>`. Applying the same id again creates nothing and answers every name with `created`
  false, so a retry (`rate_limited`, a lost answer) sends the same file again. A second plan in a
  run takes a new `<n>`.
- **All or nothing.** The planner validates the whole plan before writing anything and reports
  every problem at once: a `validation` error whose message lists them, separated by `; `. Nothing
  was written. Show every problem; fix what is the plan's own mistake (a name, a reference, a
  field) and apply again under the same id, at most once; content the user gave (a title, a
  horizon, a decider) is the user's to correct, never yours.

Read the answer by name: `value.items[]` gives each item's `key` (`item` is initiative, epic or
story), `value.decisions[]` each decision's `id`, and `value.blocks[]` each blocker edge, each with
`created`. Report each name with its key, and say which already existed (`created` false).

## Findings

`initiative findings` and `epic findings` answer the planner's advisory findings on that item:
computed on every read, never stored, and they never block a move. Each element has a `finding`:

| `finding` | Words | What the skills do |
|---|---|---|
| `empty_brief` | the brief is empty | write the brief (the skill's brief step) |
| `brief_cites_without_decision` (with `cites`, e.g. `["Jira", "decided"]`) | the brief cites <cites> but no required decision is on it | each cited choice is a triage candidate (`<plugin-root>/references/decision-triage.md`): record it and link the line to its record, or require a decision |
| `discovery_complete_with_open_decision` (with `decision_id`, `title`) | discovery is complete but decision #<decision_id> <title> is open | show it; reopening discovery or settling the decision is the user's call |
| `discovery_complete_without_stories` | discovery is complete but there are no stories | show it |

Any other `finding` is shown verbatim. Text-mode `show` lists the findings too.

## Migrated items: --external-ref

An item moved by hand from another tracker records the key it came from (a Jira key such as
`PIB-30`), so a later `reeve import jira` finds that item instead of creating a duplicate.

- On create: `reeve initiative create --title <title> --horizon <bucket> --brief-file <brief file> --external-ref <ref> --idempotency-key <key> --json`,
  `reeve epic create --initiative <KEY> --title <title> --brief-file <brief file> --external-ref <ref> --idempotency-key <key> --json`,
  `reeve story create --epic <KEY> --title <title> --kind story --criterion <text> --external-ref <ref> --idempotency-key <key> --json`.
- Set once on an item that has none: `reeve initiative edit <KEY> --version <v> --external-ref <ref> --json`,
  `reeve epic edit <KEY> --version <v> --external-ref <ref> --json`,
  `reeve story edit <KEY> --version <v> --external-ref <ref> --json`. The same value again is a
  no-op; a different one is refused: the reference cannot be changed once set.
- A reference names at most one item across initiatives, epics and stories, must look like a key
  (`PIB-30`) and must not be in this planner's own key space (a `GRA-` key on a `GRA` planner is
  refused). Show the refusal's reasons; never retry with another value.
- `show` prints it (`value.external_ref`; text output `from: <ref>`), and an item can be read by it:
  `reeve initiative show <ref> --json` answers the item migrated from `<ref>`.

Before creating an item for something migrated, read by the reference first: an `ok` answer is
the item, already there.

## decision link

`--repo` is the repository name as configured in the planner; the record must be readable at
`<household>/<repo>/<path>`, or at `<household>/<path>` when the household directory's own name is
`<repo>`. `--pr` is omitted only for a record already merged to the default branch. A repository
the planner does not check yet is accepted too: the link is stored and no check runs until the
repository is configured in the planner.

The `ok` envelope carries `immediate_check` beside `value`: its `outcome` is `stored` (the check
ran; read `value.check.kind`), `held`, `unreadable`, `failed`, or `repo_not_configured`. Read
`immediate_check.outcome` first for `repo_not_configured`, then `value.check.kind`.

| Result | Say |
|---|---|
| exit 0, `immediate_check.outcome` `repo_not_configured` (`check.kind` stays `unchecked`) | "Linked: <record> answers decision #<id> — record in an unchecked repository: the planner checks it once <repo> is configured." |
| exit 0, `check.kind` `proposed_pr_open` | "Linked: <record> answers decision #<id> — proposed, PR open." |
| exit 0, `accepted` | "Linked: … — accepted." |
| exit 0, `not_accepted` | "Linked: … — the record is <check.status>." |
| exit 0, `not_found` | "Linked, but the planner found no record at <repo>/<path>: check the repository name and path." |
| exit 1 with an `ok` envelope (`value` present) | "Linked; the check could not run here: <the stderr line>; it runs on the next scheduled check." |
| `refused`, or an `error` envelope other than `internal` | show the reasons or the message; nothing was linked |
| an `internal` error (the server may have stored the link before the CLI failed) | run `reeve decision show <id> --json`: a `record` naming this record means "Linked; …" as above, else nothing was linked |

## Wording the planner's answers

Readiness is read, never computed (kb/ADR-0003 R1). A required decision with `closed` set is
"closed: <closed.reason>". Otherwise, with `record: null` it is "no record"; else its
`check.kind`: `unchecked` "not checked yet" (with a record in a repository the planner does not
check yet, readiness says "record in an unchecked repository"), `proposed_pr_open` "proposed, PR open", `accepted`
"accepted", `not_accepted` "record <check.status>" (with `check.superseded_by`: "record
superseded by <id>, re-point"), `not_found` "record not found".

**Open** required decision: `closed` is null and `check.kind` is not `accepted`. A closed decision
is never open, whatever its record; skills that list open decisions use this definition.

| `reason` | Words |
|---|---|
| `untriaged` | untriaged |
| `no_criteria` | no acceptance criteria |
| `ancestor_discovery_incomplete` | discovery not complete on <item> |
| `decision_no_record` | decision: no record — #<decision_id> <title> |
| `decision_unchecked` | decision: not checked yet — #<decision_id> <title> |
| `decision_proposed_pr_open` | decision: proposed, PR open — #<decision_id> <title> |
| `decision_record_not_found` | decision: record not found — #<decision_id> <title> |
| `decision_repo_not_configured` | decision: record in an unchecked repository — #<decision_id> <title> (the record is in a repository the planner does not check yet; it is checked once that repository is configured) |
| `decision_not_accepted` | decision: record <status> — #<decision_id> <title>; with `superseded_by`: decision: record superseded by <superseded_by>, re-point — #<decision_id> <title> |
| `blocked_by` | blocked by <story> |

Any other `reason` is a delivery rule; show it verbatim. A story is "ready" when `readiness.ready`
is true, else "blocked: " and its reasons in these words.
