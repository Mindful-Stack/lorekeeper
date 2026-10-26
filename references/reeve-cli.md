# The Reeve planner CLI — what skills may call

Skills copy commands from this file, never from memory. Every flag below exists in the
`reeve-planner` CLI; `story edit --kind` arrives with Reeve plan C (Task 5).

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
argument with real newlines, `'\''` for an apostrophe, and no line starting with `#`: write a
heading in setext form, its title underlined with `---`:

```
reeve epic create --initiative GRA-12 --title 'Matching queue' --brief 'Vision
------
Every mentee …

Capabilities
------------
- …' --idempotency-key planning-initiative:GRA-12:0a1b2c3d:1 --json
```

Claude Code's permission check cannot inspect ANSI-C quoting (`$'…'`) and refuses a quoted
newline followed by `#`; either one turns an allowed `Bash(reeve *)` call into a permission
prompt, and into a refusal when nobody can answer it (`claude --print`, CI).

## Envelope and exit status

| Exit | stdout | Do |
|---|---|---|
| 0 | `{"outcome":"ok","value":…}` | proceed; read the field named below |
| 2 | `{"outcome":"refused","reasons":[…]}` | show the reasons (worded as below) and stop that step |
| 1 | `{"outcome":"error","code":"…","message":"…"}` | show code and message and stop that step |

Exceptions: `code: conflict` (the `--version` is stale) — re-read the item, show what changed, and
retry once with the new `version`. `decision link` — see its section. A usage error (an unknown
flag) also exits 1.

## Confirmation

Show each write (the command and the text it carries) before running it. An answer the user
already gave in the request counts as the confirmation for that write; do not ask again.

## Idempotency keys

Every create passes `--idempotency-key <skill>:<KEY>:<run-id>:<n>`: the skill's name, the key of
the item the run works on, the detector's `run_id`, and the ordinal of this create in the run
(1, 2, …, across every create of the run). A retry within the run reuses its key; a new run
never reuses an old one; never derive a key from a title. Print the run id in the report.

## Commands

| Command | Read |
|---|---|
| `reeve initiative show <KEY> --json` | `value.brief`, `.horizon`, `.owner`, `.discovery_complete` (null = not complete), `.version` |
| `reeve initiative ls --json` | `value[]`: `key`, `title`, `horizon` |
| `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key <key> --json` | `value.key`, `value.version` |
| `reeve initiative edit <KEY> --brief <md> --version <n> --json` | `value.version` |
| `reeve initiative discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve epic show <KEY> --json` | `value.brief`, `.initiative`, `.discovery_complete`, `.version` |
| `reeve epic ls [--initiative <KEY>] --json` | `value[]`: `key`, `title`, `initiative` |
| `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key <key> --json` | `value.key`, `value.version` |
| `reeve epic edit <KEY> --brief <md> --version <n> --json` | `value.version` |
| `reeve epic discovery <KEY> --complete --version <n> --json` | `value.discovery_complete` |
| `reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json` | `value[]`: `{story, readiness: {ready, reasons[]}}`; `story.key`, `.title`, `.kind`, `.version` |
| `reeve story create --epic <KEY> --title <title> --kind story\|bug\|chore --criterion <text> [--criterion <text> …] --idempotency-key <key> --json` | `value.key` |
| `reeve story edit <KEY> --version <n> [--epic <KEY>] [--kind story\|bug\|chore] --json` | `value.version` (`--kind`: Reeve plan C) |
| `reeve story context <KEY> --json` | `value`: `{story, epic, initiative, required_decisions[], blockers[], comments[], readiness}` |
| `reeve decision ls --on <KEY> --json` | `value[]`: `id`, `title`, `decider`, `due`, `record` (null = no record), `pr_url`, `check.kind` |
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
| exit 2, or exit 1 with an `error` envelope | show the reasons or the message; nothing was linked |

## Wording the planner's answers

Readiness is read, never computed (kb/ADR-0003 R1). A required decision with `record: null` is
"no record"; otherwise its `check.kind`: `unchecked` "not checked yet", `proposed_pr_open`
"proposed, PR open", `accepted` "accepted", `not_accepted` "record <status>", `not_found`
"record not found".

| `reason` | Words |
|---|---|
| `untriaged` | untriaged |
| `no_criteria` | no acceptance criteria |
| `ancestor_discovery_incomplete` | discovery not complete on <item> |
| `decision_no_record` | decision: no record — #<decision_id> <title> |
| `decision_unchecked` | decision: not checked yet — #<decision_id> <title> |
| `decision_proposed_pr_open` | decision: proposed, PR open — #<decision_id> <title> |
| `decision_record_not_found` | decision: record not found — #<decision_id> <title> |
| `decision_not_accepted` | decision: record <status> — #<decision_id> <title> |
| `blocked_by` | blocked by <story> |

A story is "ready" when `readiness.ready` is true, else "blocked: " and its reasons in these words.
