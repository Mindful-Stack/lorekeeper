# The Reeve planner CLI — what skills may call

Skills copy commands from this file, never from memory. Every flag below exists in the
`reeve-planner` CLI (`scripts/__tests__/reeve-reference.test.js` parses every command here with the
real binary when `REEVE_REAL_BIN` is set).

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
examples end with it). Pass Markdown (a brief) or any text with spaces as one single-quoted
argument with real newlines, `'\''` for an apostrophe, and no line whose first non-blank
character is `#` (an indented `#` is refused too): write a heading in setext form, its title
underlined with `---`. No value starts with `-` (the real CLI reads it as a flag; only
`comment add --body` accepts one): open a brief, title or criterion with a word, not a bullet. No
backticks and no `$(` in a value.

```
reeve epic create --initiative GRA-12 --title 'Matching queue' --brief 'Vision
------
Every mentee …

Capabilities
------------
- …' --idempotency-key planning-initiative:GRA-12:0a1b2c3d:1 --json
```

Claude Code's permission check cannot inspect ANSI-C quoting (`$'…'`) and refuses a quoted
newline followed by `#`, indented or not; either one turns an allowed `Bash(reeve *)` call into a permission
prompt, and into a refusal when nobody can answer it (`claude --print`, CI).

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
`version`. `decision link` — see its section. A usage error (an unknown flag, a value starting with
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
items; never derive a key from a title. Print the run id in the report.

## Commands

| Command | Read |
|---|---|
| `reeve initiative show <KEY> --json` | `value.brief`, `.horizon`, `.owner`, `.discovery_complete` (null = not complete), `.version` |
| `reeve initiative ls --json` | `value[]`: `key`, `title`, `horizon` |
| `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key <key> --json` | `value.key`, `value.version`; a bucket the planner does not have is a `validation` error |
| `reeve initiative edit <KEY> --brief <md> --version <n> --json` | `value.version` |
| `reeve initiative discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve epic show <KEY> --json` | `value.brief`, `.initiative`, `.discovery_complete`, `.version` |
| `reeve epic ls [--initiative <KEY>] --json` | `value[]`: `key`, `title`, `initiative` |
| `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key <key> --json` | `value.key`, `value.version` |
| `reeve epic edit <KEY> --brief <md> --version <n> --json` | `value.version` |
| `reeve epic discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json` | `value[]`: `{story, readiness: {ready, reasons[]}}`; `story.key`, `.title`, `.kind`, `.version`. Untriaged: kind `story` with no epic (a bug or chore without one is not listed) |
| `reeve story create --epic <KEY> --title <title> --kind story\|bug\|chore --criterion <text> [--criterion <text> …] --idempotency-key <key> --json` | `value.key` |
| `reeve story edit <KEY> --version <n> [--epic <KEY>] [--kind story\|bug\|chore] --json` | `value.version` |
| `reeve story context <KEY> --json` | `value`: `{story, epic, initiative, required_decisions[], blockers[], comments[], readiness}` |
| `reeve decision ls --on <KEY> --json` | `value[]`: `id`, `on`, `title`, `decider`, `due`, `record` (null = no record), `pr_url`, `check.kind`, `closed` (null, or `{at, by, reason}`); closed decisions are listed too |
| `reeve decision show <id> --json` | `value`: one decision, the same fields |
| `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key <key> --json` | `value.id` |
| `reeve decision link <id> --record <qualified id> --repo <repo> --path <path in repo> --pr <url> --household <dir> --json` | `value.check.kind` |
| `reeve comment add --decision <id> --body <text> --idempotency-key <key> --json` (or `--story <KEY>`) | `value[]`, the thread |

No command lists the planner's configured repositories or horizon buckets (they are in
`GET /api/v1/config`, which the CLI does not expose): ask for them, or take them from the request.

## decision link

`--repo` is the repository name as configured in the planner; the record must be readable at
`<household>/<repo>/<path>`, or at `<household>/<path>` when the household directory's own name is
`<repo>`. `--pr` is omitted only for a record already merged to the default branch.

| Result | Say |
|---|---|
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
`check.kind`: `unchecked` "not checked yet", `proposed_pr_open` "proposed, PR open", `accepted`
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
| `decision_not_accepted` | decision: record <status> — #<decision_id> <title>; with `superseded_by`: decision: record superseded by <superseded_by>, re-point — #<decision_id> <title> |
| `blocked_by` | blocked by <story> |

Any other `reason` is a delivery rule; show it verbatim. A story is "ready" when `readiness.ready`
is true, else "blocked: " and its reasons in these words.
