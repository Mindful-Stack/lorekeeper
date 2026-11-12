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

This file describes `reeve-planner` 0.2.0 or later (`reeve --version`). An older CLI answers
`--reversibility`, `--decided`, `--withdrawn` and `--queue` with a usage error: tell the user to
update the CLI, and never fall back to `decision close --reason`, which 0.2.0 no longer has.
Sprints and goals (`reeve sprint`, `reeve goal`, `story ls --goal`, `goals` in story context) need
`reeve-planner` 0.3.0 or later: an older CLI answers them with a usage error (an unrecognized
subcommand or flag), so tell the user to update the CLI and go on without goals.
`story similar` and the any-kind untriaged filter (an item of any kind with no epic) need
`reeve-planner` 0.4.0 or later (kb/ADR-0018): an older CLI answers `story similar`
with a usage error, so tell the user to update the CLI and go on without the duplicate check.
Promises (`story promise`, `epic promise`, `story ls --promised`) need `reeve-planner` 0.5.0 or
later and a planner with kb/ADR-0025: an older CLI answers them with a usage error (tell the user to
update the CLI and go on without promises). A CLI older than 0.5.0 also cannot read a decision queue
that has a promise reason, so `decision ls --queue` fails on it once any story is promised: when a
queue read fails on a CLI older than 0.5.0, tell the user to update the CLI. An older planner
ignores `--promised` and lists unfiltered, and sends no promises, so every row's `story.promise` is
null: a row from `--promised` whose `story.promise` is null means the filter was ignored; say so,
and go on without promises.

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

Exceptions: `code: conflict` (the `--version` is stale; the envelope carries `current`, the item's
version to re-read from, so read it instead of parsing the message; `-1` means the planner gave up on
a concurrent update, so re-read the item for its version) — re-read the item, fold what changed into
your text (a teammate's edit is kept, never overwritten), show it, and retry once with the new
`version`. Exit status stays 1. `code: rate_limited` (the planner answered HTTP 429; the envelope carries
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
| `reeve epic show <KEY> --json` | `value.brief`, `.initiative`, `.discovery_complete`, `.promise` (null = none): `{fact, due, past}` (see *Promises*), `.version` |
| `reeve epic ls [--initiative <KEY>] --json` | `value[]`: `key`, `title`, `initiative` |
| `reeve epic create --initiative <KEY> --title <title> --brief-file <brief file> --idempotency-key <key> --json` | `value.key`, `value.version` |
| `reeve epic edit <KEY> --brief-file <brief file> --version <n> --json` | `value.version` |
| `reeve epic discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve initiative findings <KEY> --json` / `reeve epic findings <KEY> --json` | `value[]`, `.finding`; empty when there are none (see *Findings*) |
| `reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json` | `value[]`: `{story, readiness: {ready, reasons[]}}`; `story.key`, `.title`, `.kind`, `.version`. Untriaged: an item of any kind with no epic that is not done (kb/ADR-0018); it is not ready until placed or closed |
| `reeve story similar <text> [--limit <n>] --json` | `value[]`: `{key, kind, title, epic, delivery, resolution}`, open stories and recently done ones with a like title (the text is 8 to 200 characters, the limit 1 to 10 with default 5; otherwise a validation error, exit 1); run it before filing or placing an item, to catch a duplicate |
| `reeve story mv <KEY> <delivery> [--version <n>] [--resolution completed\|dropped] --json` | `value.delivery`, `.resolution`; moving to done needs a resolution; --override is a person's (interactive tokens only), never passed by a skill. Skills use it only to close an item as dropped (a won't-do or duplicate); delivery is otherwise the person's or a pull request's |
| `reeve story create --epic <KEY> --title <title> --kind story\|bug\|chore --criterion <text> [--criterion <text> …] [--owner <email>] --idempotency-key <key> --json` | `value.key`; an owner who is not an allowed user is a `validation` error |
| `reeve story edit <KEY> --version <n> [--epic <KEY>] [--kind story\|bug\|chore] [--owner <email>] --json` | `value.version`; an owner who is not an allowed user is a `validation` error |
| `reeve apply <plan file> --json` | `value.items[]`: `name`, `item`, `key`, `created`; `value.decisions[]`: `name`, `id`, `created`; `value.blocks[]`: `story`, `blocked_by`, `created` (see *Plans*) |
| `reeve story context <KEY> --json` | `value`: `{story, epic, initiative, required_decisions[], blockers[], comments[], readiness}`; `value.goals[]`: `{goal, starts_on, ends_on, via}`, the active sprint's goals the story serves (empty when none; see *Sprints and goals*) |
| `reeve decision ls --on <KEY> --json` | `value[]`: `id`, `on`, `on_type` (initiative, epic or story: the level of the item it is on), `title`, `decider`, `due`, `reversibility` (one_way or two_way; null = unclassified, treated as two-way), `record` (null = no record), `pr_url`, `check.kind`, `closed` (null, or `{at, by, reason, kind, via}`); closed decisions are listed too |
| `reeve decision show <id> --json` | `value`: one decision, the same fields |
| `reeve decision ls --initiative <KEY> --json` | `value[]`: `id`, `on`, `on_type`, `title`, `decider`, `reversibility`, `record` (null = no record), `check.kind`, `closed` (null = not closed); every decision on the initiative, on its epics and on their stories, closed ones too |
| `reeve decision ls --queue [--on <KEY>] --json` | `value.entries[]`: `decision` (one decision, the fields of decision show), `group` (blocking, open, satisfied or closed), `blocks[]` `{key, title}`; `value.summary`: `open`, `blocking`, `blocked_stories`, `overdue` (see *The decision queue*) |
| `reeve decision require --on <KEY> --title <title> --decider <email> --reversibility one-way\|two-way [--due YYYY-MM-DD] --idempotency-key <key> --json` | `value.id` |
| `reeve decision link <id> --record <qualified id> --repo <repo> --path <path in repo> --pr <url> --household <dir> --json` | `value.check.kind` |
| `reeve decision close <id> --decided <text> --json` / `reeve decision close <id> --withdrawn <text> --json` | `value.closed.reason`, `.kind` (decided or withdrawn), `.via` (interactive or automation: the token that closed it), `.at`, `.by`; see *Closing a decision* |
| `reeve comment add --item <KEY> --body <text> --idempotency-key <key> --json` (or `--decision <id>`) | `value[]`, the thread |
| `reeve comment ls --item <KEY> --json` (or `--decision <id>`) | `value[]`: `id`, `author`, `body`, `at`; oldest first, empty when there are none |
| `reeve sprint show --json` | `value.sprint`: `{id, state, starts_on, ends_on, goals[]: {id, outcome, check, owner, notes, confidence, suggested_confidence, version, links[]}}`; `value.counts`: `{goals[]: {goal_id, completed, in_flight, in_review, todo, blocked_decisions}, completed, upkeep_completed}`; `value.promises[]`: `{key, title, on, to, holder, epic_key, state, done_on, days}`, the stories promised by a date in the sprint's range, and `value.promises_after` (the range starts the day after it; null = every date up to the sprint's end) (see *Promises*); the active sprint, else the draft (see *Sprints and goals*) |
| `reeve sprint ls --json` | `value.active` (null = no active sprint; else the active sprint as sprint show answers it, but with no promises listed: read those from sprint show), `value.draft` (null = none), `value.closed[]`: `id`, `starts_on`, `ends_on`, `goals[].verdict`; closed sprints newest first |
| `reeve sprint show <id> --json` | `value.sprint`, `value.counts`, `value.promises[]` and `value.promises_after` as above, and for a closed sprint `value.sprint.goals[].verdict` (met, partly_met or missed), `.verdict_note`, `value.at_close` (`{goals[], completed, upkeep_completed}`, its counts when it closed) and `value.changed_since_close` (true when a number now differs from at close) |
| `reeve story ls --goal <id\|any\|none> --json` | `value[]`: `{story, readiness}`, as for the other story lists; `story.goals[]` `{id, outcome, via}` (via story, epic or initiative) |
| `reeve story ls --promised this-sprint\|next-sprint\|overdue\|any --json` | `value[]`: `{story, readiness}`, as for the other story lists; `story.promise` (null = no promise): `{own, epic, on, holder, state, due, days}` (see *Promises*) |
| `reeve goal link <id> <KEY> [<KEY> …] --json` | `value.links[]` (every key linked to the goal), `value.version` |
| `reeve goal unlink <id> <KEY> [<KEY> …] --json` | `value.links[]` |
| `reeve goal suggest <id> on_track\|at_risk\|off_track [<note>] --json` | `value.suggested_confidence`, `.suggested_note`, `.suggested_at`, `.suggested_by` |

`decision require` without `--due` writes `no decide-by date; the queue will flag it` to stderr,
also with `--json`; the envelope is `ok` and the exit status 0. It is a reminder, not an error: pass
`--due` only with a date the user gave, never one you chose to silence it.

An initiative's owner is an email and its target month is `YYYY-MM` (`2027-03`); pass either on
create or edit only with a value the user gave (rule *The user decides* in each skill), and leave a
flag out to keep what is there. On an initiative edit `--no-owner` and `--no-target-month` clear them
(each in place of its setter, never with it), only when the user asks. A story's owner is likewise an email the user gave, and must be an
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
| `reeve story ls [--owner <email>] [--delivery <delivery>] [--label <label>] [--ready] [--mine] [--text <text>] [--kind story\|bug\|chore] [--initiative <KEY>] [--urgent] [--open] [--sort rank\|relevance] --json` | filters the list (every flag given must hold): owner, delivery state (`todo`, `in-progress`, `in-review`, `testing`, `done`), label, `--ready` (ready stories still in todo), `--mine` (owned by the signed-in user; a refused token answers the `unauthenticated` or `forbidden` envelope, exit 2, as any call does), `--text` (title, description or external reference contains the text, any case, 1 to 200 characters; a key-shaped text such as `12`, `#12` or `GRA-12` also finds that key), `--kind`, `--initiative` (stories in that initiative's epics, by key or external reference; one that names nothing lists nothing), `--urgent` (only stories shown urgent), `--open` (no done stories), `--sort relevance` (needs `--text`, else a `validation` error, exit 1: the story whose key or external reference equals the text first, then title matches, then the rest; `rank`, the default, is the backlog order). A planner server without kb/ADR-0021 ignores the last six and lists unfiltered |
| `reeve story create --epic <KEY> --title <title> --kind story --description-file <description file> --label <label> --criterion <text> --idempotency-key <key> --json` | a story with a longer description (Markdown, through a file as *Arguments* says) and labels (`--label` repeats, one per label) |
| `reeve story edit <KEY> --version <n> [--title <title>] [--criterion <text> …] [--rank <n>] --json` | renames the story, replaces ALL its criteria (one `--criterion` each; a criterion unchanged at the same position keeps its done flag) or sets its rank; `--no-epic` in place of `--epic` detaches it (it becomes untriaged) |
| `reeve story edit <KEY> --version <n> [--description-file <description file>] [--add-label <label> …] [--remove-label <label> …] --json` | replaces the whole description (through a file), or adds and removes labels (each repeats; a label the story already has is kept once) |
| `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key <key> --json` / `reeve initiative edit <KEY> --brief <md> --version <n> --json` / `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key <key> --json` / `reeve epic edit <KEY> --brief <md> --version <n> --json` | a one-line brief inline, in place of `--brief-file` (one line, single-quoted, as *Arguments* says) |
| `reeve story create --epic <KEY> --title <title> --kind story --description <text> --idempotency-key <key> --json` / `reeve story edit <KEY> --version <n> --description <text> --json` | a one-line description inline, in place of `--description-file` |
| `reeve story edit <KEY> --version <n> --no-owner --json` | clears the story's owner (`--no-owner` in place of `--owner`) |
| `reeve initiative edit <KEY> --version <n> --no-owner --no-target-month --json` | clears the initiative's owner and target month (each in place of its setter; either alone is allowed) |
| `reeve decision ls --mine --json` | the decisions the signed-in user is the decider of (a refused token answers as for `story ls --mine`; not with `--queue`, a usage error) |
| `reeve decision edit <id> --version <n> [--title <title>] [--decider <email>] [--due YYYY-MM-DD] [--reversibility one-way\|two-way] --json` | changes an open decision's title, decider, due date or reversibility (at least one of them; `--no-due` and `--no-reversibility` clear, each in place of its setter); a closed decision is a `validation` error, a stale `--version` a `conflict`. The record is changed with `decision link`, never here |

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
  "decisions": [{"name": "provider", "on": "invoices", "title": "Which invoicing provider", "decider": "dan@example.com", "reversibility": "one_way", "due": "2026-11-15"}],
  "blocks": [{"story": "send-invoice", "blocked_by": "GRA-31"}]
}
```

- **Fields.** Every list is optional. An initiative has `name`, `title`, `horizon`, and optionally
  `brief`, `target_month`, `owner`, `external_ref`; an epic `name`, `title`, and optionally
  `initiative`, `brief`, `external_ref`; a story `name`, `title`, `criteria`, and optionally `kind`
  (a story when left out), `epic`, `description`, `labels`, `external_ref`; a decision `name`,
  `on`, `title`, `decider`, and optionally `reversibility` (`one_way` or `two_way`, with an underscore
  as on the wire, where the CLI flag says `one-way`) and `due` (`YYYY-MM-DD`); a block `story` and `blocked_by`
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

## Reversibility

A required decision is `one-way` (hard to undo: undoing it costs more than a day or breaks
something others depend on) or `two-way`; a decision with none (null) is unclassified and treated
as two-way. The spellings differ by place: the CLI flag and a record's front matter say `one-way` /
`two-way`, the JSON answers and a plan say `one_way` / `two_way`, and text output prints
`one-way`. Pass `--reversibility` on every `decision require` the skills run (each skill says which
value); change it later only when the user asks (`decision edit`).

A one-way decision is decided only by its accepted record: link the record (*decision link*); it
cannot be closed as decided.

## Closing a decision

`decision close` takes exactly one of `--decided <text>` (what was decided, and where it is written
down) and `--withdrawn <text>` (why the decision is no longer needed); neither or both is a usage
error (exit 1, nothing sent). `--decided` on a one-way decision is a `validation` error, exit 1,
with the message "a one-way decision is decided by its accepted record; withdraw it if it is no
longer needed": show it and link the record instead, or withdraw the decision when the user says
it is no longer needed. Closing a closed decision is a `validation` error too ("already closed").

The `--decided` text says what was decided and where. Settled in the conversation (two-way), the
text alone will do. Settled by a behaviour doc rule, close only once the rule is merged on the
default branch, and name the path, the rule id and the PR:
`--decided "docs/behaviour/orgs.md org.R7 (app#123)"`. A one-way decision is settled only by its
accepted ADR, linked. A behaviour doc rule is closed as decided, never linked with `decision link`:
the planner reads a linked behaviour doc as "not accepted: unparsable front matter" on every check,
so a decision linked to one is never settled.

`value.closed.kind` is `decided` or `withdrawn` and `value.closed.via` is `interactive` or
`automation` (the kind of token that closed it); both are null on a decision closed before 0.2.0.

## The decision queue

`reeve decision ls --queue --json` answers the planner's queue: `value.entries[]`, each
`{decision, group, blocks[]}`, and `value.summary`. Read them in the order given, never re-sort:

- **`group`**: `blocking` (open, and the readiness of at least one todo story names it), `open`
  (open, blocks nothing), `satisfied` (open, its record accepted), `closed`, in that order; blocking
  and open decisions most urgent first (overdue first, then the ones blocking most stories).
- **`blocks[]`**: the todo stories it holds back, each `{key, title}`; empty outside `blocking`.
- **`summary`**: `{open, blocking, blocked_stories, overdue}`, counted over the blocking and open
  decisions only: `open` is both groups together, `blocked_stories` counts each story once, and
  `overdue` counts those whose `due` is before the planner's date (UTC).

Unscoped, the queue leaves closed decisions out; with `--on <KEY>` or `--initiative <KEY>` (not both) it
includes them, as `decision ls` does. A key that names nothing answers an empty queue, not
`not_found`. `--queue` with `--mine` is a usage error.

## decision link

`--repo` is the repository name as configured in the planner; the record must be readable at
`<household>/<repo>/<path>`, or at `<household>/<path>` when the household directory's own name is
`<repo>`. `--pr` is omitted only for a record already merged to the default branch. A repository
the planner does not check yet is accepted too: the link is stored and no check runs until the
repository is configured in the planner.

The `ok` envelope carries `immediate_check` beside `value`: its `outcome` is `stored` (the check
ran; read `value.check.kind`), `held`, `unreadable`, `failed`, or `repo_not_configured`. Read
`immediate_check.outcome` first for `repo_not_configured`, then `value.check.kind`.

An `accepted` or `not_accepted` check carries `check.reversibility` (`one_way` or `two_way`) when
the record's front matter sets `reversibility`; it is absent otherwise (never null), on every other
`check.kind`, and when the record's id does not match `--record`. When both it and the
decision's `reversibility` are set and they differ, say so (an unclassified decision, null, has
nothing to disagree with) ("the record says one-way, the decision two-way"); changing
either is the user's call.

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

## Sprints and goals

A sprint is a time box holding the team's goals (kb/ADR-0014 in the Reeve repository): at most one
sprint is active, one is the draft the next goals go into, and the rest are closed. A goal has an
outcome, a check ("we'll know when …"), an owner, notes, a confidence a person records, and links
to the work that serves it. A story serves a goal through a link to itself, its epic or its epic's
initiative (`via`: story, epic or initiative; the nearest link wins). Sprints and goals have
numeric ids, like decisions; items keep their keys.

**What a skill may do.** Agents read goals and link work; people set goals and judge them.

- **Read** the goals a story serves in `reeve story context <KEY> --json` (`value.goals[]`: the goal
  with its outcome, check, owner, notes and confidence, the sprint's dates, and `via`), and every
  story's in `story.goals[]` of the story lists. A goal's `notes` say why it matters and where its
  boundaries are: keep the work inside them.
- **Progress** comes from `reeve sprint show --json`: `value.counts.goals[]`, one per goal, matched
  to `value.sprint.goals[]` by `goal_id`. `completed` counts stories completed in the sprint,
  `in_flight` those started and not completed (`in_review`, in review or testing, is part of it),
  `todo` those not started, and `blocked_decisions` the open decisions holding back its unfinished
  stories. A goal's work is `completed + in_flight + todo` stories; say "3 of 7 completed, 2 in
  review", never a percentage. `value.counts.upkeep_completed` counts completed stories that serve
  no goal (upkeep).
- **Link** with `reeve goal link <id> <KEY> [<KEY> …] --json` when the user names the goal a story,
  epic or initiative serves, or confirms one you proposed (*Confirmation*); a link on an epic or an
  initiative covers its stories. `goal unlink` takes the link back off; unlinking an item that is
  not linked succeeds and changes nothing, and it sends one request per key, stopping at the first
  failure (the answer is that failure). A key that names no item is `not_found`.
- **Suggest** a confidence with `reeve goal suggest <id> on_track|at_risk|off_track '<note>' --json`
  while the sprint is active, the note saying what it rests on ("3 of 7 completed, 2 in review").
  It is a draft: it fills `suggested_confidence`, never `confidence`, and a person records it,
  changes it or leaves it. The latest suggestion wins; recording a confidence clears it.
- **Filter** stories with `reeve story ls --goal <id> --json` (the stories serving that goal of the
  active sprint), `--goal any` (serving some goal) or `--goal none` (upkeep: serving none).

A **closed sprint** is read with `reeve sprint show <id> --json`, the id from `sprint ls`. Its
numbers are recomputed now, so its answer also carries `value.at_close`, the counts at its close,
and `value.changed_since_close`. Report a closed sprint from `at_close`, and say "changed since
close" when `changed_since_close` is true. `blocked_decisions` is live for the active sprint; for a
closed one only `at_close`'s value means anything.

Without an id, `sprint show` answers the active sprint, else the draft; with no sprint at all it is
a `not_found` error (exit 1): say there is no sprint yet. The draft has no window: its counts are
zero.

**A person's commands.** These exist in the CLI, and a skill never runs them, whatever token it
holds: with an automation token the planner refuses every one `interactive_only` (exit 2), and with
a person's token it would act for them. When the user asks for one, show the command for them to
run, without `--json` (a person reads the CLI's text answer).

| Command | What it does |
|---|---|
| `reeve goal add --outcome <text> --check <text> [--owner <email>] [--notes <text>] [--active] --idempotency-key <key> --json` | adds a goal to the draft (the first goal creates the first draft), or to the active sprint with `--active`; `value`: `{goal, warnings[]}` (`no_goals`, `more_than_three_goals`: advice, never a refusal) |
| `reeve goal edit <id> --version <n> [--outcome <text>] [--check <text>] [--owner <email>] [--notes <text>] --json` | edits a goal; a stale `--version` is a `conflict` |
| `reeve goal rm <id> --version <n> --json` | removes a draft's goal and its links |
| `reeve goal confidence <id> on_track\|at_risk\|off_track [<note>] --json` | records the confidence (active sprint only) and clears any suggestion |
| `reeve sprint open [--ends YYYY-MM-DD] --json` | opens the draft (the end defaults to one sprint length after today) and creates the next draft |
| `reeve sprint close --verdict <goal id>=met\|partly_met\|missed[:<note>] --json` | closes the active sprint, one `--verdict` per goal (repeated); a malformed `--verdict` is a usage error (exit 1, nothing sent) |

**Refusals** (exit 2), worded as:

| `reason` | Words |
|---|---|
| `interactive_only` | only a person can do this (open or close a sprint, write a goal, record a confidence, or set, change or clear a promise: see *Promises*) |
| `sprint_closed` | the sprint is closed: its goals, links and confidence are read-only |
| `sprint_not_active` | the sprint is not active (a confidence, recorded or suggested, needs the active sprint) |
| `sprint_not_draft` | only a draft's goal can be removed |
| `sprint_active` | a sprint is already active; close it first |
| `verdict_missing` (with `goals`) | closing needs a verdict for goals <goals> |

## Promises

A promise is a date a person committed a story or an epic to, often to someone outside the team
(kb/ADR-0025 in the Reeve repository). It is shown, never enforced: no move, readiness, rank or
progress depends on it. An epic's promise applies to each of its stories that was not done when the
epic was promised; a story's date is then the earlier of its own and its epic's, and both stay
visible. Promise state is derived by the planner on every read, never stored.

**What a skill may do.** Agents read promises; people make them.

- **Read** a story's promise in `story.promise` of any story answer (`story ls`, `story context`),
  null when it has none. `on` is the date that counts and `holder` whose it is (`own` or `epic`);
  `own` is the story's own promise `{on, by, at, to}` and `epic` the epic's it inherits
  `{key, fact: {on, by, at, to}}`, each null when absent; `to` is the recipient (null = none).
  `state` is `open`, `overdue`, `kept` (done on or before the date), `late` (done after it) or
  `dropped`, null for a done story without a completion time; `due` (only while open) is
  `this_sprint` (by the active sprint's planned end), `next_sprint` (by the draft's) or `later`;
  `days` counts the days overdue or late. An epic's own promise is `value.promise` of
  `reeve epic show <KEY> --json`: `{fact, due, past}`, with no state of its own. Read these
  values; never compute a state, a period or a day count yourself.
- **Filter** with `reeve story ls --promised this-sprint|next-sprint|overdue|any --json`: `this-sprint` lists overdue promises
  and open ones due this sprint, `next-sprint` open ones due next sprint, `overdue` only overdue
  ones, `any` every open or overdue one. Kept, late and dropped promises never match. It combines
  with the other `story ls` flags (every flag given must hold).
- **Suggest** a date, never set one, and only a date the user, a brief or a ticket states; never
  estimate one. When such a date comes up (a brief names a deadline, a ticket says the customer's
  pilot starts on a day), say it in a comment on the item for a person to promise:
  `reeve comment add --item <KEY> --body 'Suggested promise: by 2026-12-04, to Acme (their pilot starts then).' --idempotency-key <key> --json`.
  The comment is a write: show it and write it under *Confirmation*. When nobody has stated a date
  (the user asks when something will be ready), ask the person for one; never pick a date to fill
  the gap.

**A person's commands.** These exist in the CLI, and a skill never runs them, whatever token it
holds: with an automation token the planner refuses every one `interactive_only` (exit 2), and with
a person's token it would promise for them. When the user asks for one, show the command for them to
run, without `--json` (a person reads the CLI's text answer). None takes a `--version`: a promise
does not change the item's version.

| Command | What it does |
|---|---|
| `reeve story promise <KEY> --on this-sprint\|next-sprint\|YYYY-MM-DD [--to <text>] --json` | promises the story by the date: `this-sprint` and `next-sprint` take that sprint's planned end as it is when saved (a later change to the sprint does not move it); `--to` names who it is promised to, and left out keeps the current recipient; `value.promise` as above |
| `reeve story promise <KEY> --to <text> --json` | changes only the recipient of the story's own promise (`--to ''` clears it); without a promise it is a `validation` error |
| `reeve story promise <KEY> --clear --json` | removes the story's own promise (clearing none changes nothing); `value.cleared` says whether it removed one (false when the story had none of its own) and `value.story` is the story after it, its epic's promise still applying as `value.story.promise` shows; `--clear` takes no other flag (a usage error) |
| `reeve epic promise <KEY> --on this-sprint\|next-sprint\|YYYY-MM-DD [--to <text>] --json` | promises the epic by the date, as for a story; each of its stories not done now gets the date too; `value.promise`: `{fact, due, past}` |
| `reeve epic promise <KEY> --to <text> --json` | changes only the recipient of the epic's promise (`--to ''` clears it) |
| `reeve epic promise <KEY> --clear --json` | removes the epic's promise from the epic and its stories; `value.cleared` says whether it removed one and `value.epic` is the epic after it |

One of `--on`, `--to` and `--clear` is required, and an `--on` that is neither a shortcut nor a
calendar date is a usage error (exit 1, nothing sent).

**Refusals and errors.** `interactive_only` (exit 2): only a person can promise (set, change or
clear a promise). These are `validation` errors (exit 1), each with the planner's message to show:
a done story (`<KEY> is done: a done story cannot be promised`), a date before today (`the date
<date> is past: promise today or later`; keeping an overdue promise's own date while changing its
recipient is allowed), a shortcut with no such sprint (`there is no active sprint: give a date`,
`there is no next sprint yet: give a date`) or whose planned end is past, and a recipient over 200
characters.

## Wording the planner's answers

Readiness is read, never computed (kb/ADR-0003 R1). A required decision with `closed` set is
"closed: decided: <closed.reason>" or "closed: withdrawn: <closed.reason>" by `closed.kind`
("closed: <closed.reason>" when it is null). An open one, with `record: null`, is "no record"; else its
`check.kind`: `unchecked` "not checked yet" (with a record in a repository the planner does not
check yet, readiness says "record in an unchecked repository"), `proposed_pr_open` "proposed, PR open", `accepted`
"accepted", `not_accepted` "record <check.status>" (with `check.superseded_by`: "record
superseded by <id>, re-point"), `not_found` "record not found".

A decision's `reversibility` reads "one-way", "two-way" or, when null, "unclassified".

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

A story's promise, from `story.promise` (dates as "20 Nov"): `open` reads "promised by 20 Nov", with
"· this sprint" or "· next sprint" by `due`; a `state` of null (a done story without a completion
time) reads "promised by 20 Nov"; `overdue` "overdue <days> d · 20 Nov"; `kept` "kept ·
20 Nov"; `late` "done <days> d late · 20 Nov"; `dropped` "dropped · 20 Nov". With `holder` `epic`,
add "· via <epic.key>". Add "to <to>" when the recipient matters to the answer. In a sentence about a
promise, give the year ("ABC-12 is promised by 20 Nov 2026 to Acme"): the date stays on a done
story long after the day. An epic's promise reads "promised by 20 Nov", with the period by `due`,
or "past 20 Nov" when `past`.

A sprint's promises, from `sprint show`'s `promises[]`, go under "Promises due <range>": the day
after `promises_after` to the sprint's `ends_on` ("Promises due 11–24 Nov"; "Promises due up to
24 Nov" when `promises_after` is null). Each row is the key and title, "to <to>" when there is a
recipient, then the words above for its `state` (no period on a sprint row) and "· via <epic_key>"
when `holder` is `epic`. Say once under the list: a promise is to a date, so work done after it
counts as late, even inside the sprint.
