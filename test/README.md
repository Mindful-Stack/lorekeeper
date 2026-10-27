# Plugin Test Harness

Automated tests for the lorekeeper plugin using Babashka.

## Setup

### Install Babashka

**Windows (scoop):**
```bash
scoop install babashka
```

**Windows (winget):**
```bash
winget install babashka
```

**Mac:**
```bash
brew install borkdude/brew/babashka
```

**Linux:**
```bash
bash < <(curl -s https://raw.githubusercontent.com/babashka/babashka/master/install)
```

### Verify Installation

```bash
bb --version
```

## Running Tests

### Run All Tests

```bash
bb test/run-tests.clj
```

Each scenario runs `claude --print` from a workspace root with `--plugin-dir` pointing at
this checkout, so the tests exercise the code in your working tree, not the installed
plugin. The workspace root defaults to a fresh copy of the bundled fixture in
`test/fixtures/workspace/` (a `household.json` plus a small knowledge base with `payments`,
`inventory`, and `device` domains that the scenarios assert against), made in a temp directory
outside any git repository for each run and deleted afterwards; the runner prints its path as
the workspace root. Override either with `--workspace-root <dir>` (used in place, not copied) or
`--plugin-dir <dir>`.

### Filter by Name

```bash
bb test/run-tests.clj --filter "command-help"
bb test/run-tests.clj --filter "skill"
```

### Verbose Output (show full output on failures)

```bash
bb test/run-tests.clj --verbose
```

## Test Scenarios

Tests are defined in `scenarios.edn` as pure data:

```clojure
{:name "command-help"
 :prompt "/lore:help"
 :workdir "."
 :expects ["Knowledge" "commands"]}
```

- **name**: Test identifier
- **prompt**: What to send to Claude
- **workdir**: Directory to run in (relative to knowledge repo root, usually "."); the runner
  currently always runs from the workspace root, so a scenario that depends on the governed repo
  names it in the prompt
- **expects**: Regex patterns that must appear in output
- **rejects** (optional): Regex patterns that must not appear, for outcomes a lenient `expects`
  could hide (an agent accepted as a decider, a record filed in the wrong home)

Scenarios assert on what a command prints before it writes. The runner pins
`--permission-mode default`, allows only `Read`, `Glob`, `Grep`, `Bash(node *)` and agent and
skill dispatch, and denies `Write`, `Edit`, `git` and `gh`, whatever the user's own permission
settings say. `Bash(node *)` can still write files (`node -e`, `adr-lint backfill`), so the
runner works on the temp copy: anything a scenario writes lands there, never in this checkout.
Because the copy is not a git repository and git is denied, scenarios do not exercise the
git-based steps (placement, `--base` checks). Prompts for commands that would otherwise write
end with an instruction to stop after presenting the draft.

## Scenarios against the Reeve planner

Skills that drive the Reeve planner are tested against a fake `reeve` CLI,
`test/fixtures/reeve-bin/reeve` (a Node script; its own tests are
`scripts/__tests__/reeve-fake.test.js`). Four scenario keys and one runner option support them:

| Key | Meaning |
|---|---|
| `:requires ["reeve-fake"]` | Runs only when the runner is invoked with `--with reeve-fake`; otherwise printed as `[SKIP]` and not counted. Such a scenario gets `<checkout>/test/fixtures/reeve-bin` first on `PATH` and a fresh empty `REEVE_FAKE_LOG` file for each run (also each `--runs` repeat). |
| `:env {"NAME" "value"}` | Merged last into the child's environment (the link scenario sets `REEVE_FAKE_LINK_CHECK`). |
| `:allowed-tools [...]` | Added to the base allow-list; reeve scenarios add `"Bash(reeve *)"` (`Bash(node *)` is already in the base list). |
| `:log-expects [...]` / `:log-rejects [...]` | Regexes matched, multiline (`(?m)` prepended), against the fake log after the run; failures print as `log: <regex>`. Positive evidence that a command was executed, which a transcript match cannot give. |

**Environment.** Every scenario, fake or not, runs with a fresh empty `REEVE_CONFIG_DIR` and
without `REEVE_URL`, `REEVE_TOKEN` and `REEVE_BIN`, so a real `reeve` on the `PATH` can never
reach a server. A fake scenario also gets the fake first on `PATH` and a fresh `REEVE_FAKE_LOG`
per run; the log is appended to the output shown by `--verbose` and deleted afterwards.

**The log.** One line per call that passed the fake's validation (a malformed call is not logged, so it never satisfies a log expectation; a valid call the planner refuses is), except `--version`, which the SessionStart hook also runs to decide whether to list the planner skills in its router (a skill's detection shows as `auth status --json`): the argv joined by spaces, newlines inside an argument
flattened to spaces, e.g. `epic create --initiative GRA-12 --title A --brief one two --idempotency-key planning-initiative:GRA-12:0a1b2c3d:1 --json`.

**What the fake answers.** `--version` prints `reeve-planner 0.1.0-fake`; every other call must
include `--json` (anywhere, as the real CLI's global flag) and uses only flags the real CLI has.
What the real CLI's parser rejects (an unknown command or flag, a missing value, a value starting
with `-` except `comment add --body`) is a usage error as there: the text on stderr, nothing on
stdout, exit 1. `scripts/__tests__/reeve-reference.test.js` runs every `reeve … --json` command of
the reference and the skills through the fake, and through the real CLI when `REEVE_REAL_BIN` is
set. Answers use the planner's wire shapes:

- initiatives `GRA-12` "Faster mentor matching" (version 3) and `GRA-13` "Mentor onboarding";
- epics `GRA-20` "Matching queue" (in GRA-12, version 2), `GRA-21` "Mentor profiles" (in GRA-13)
  and `GRA-22` "Session feedback", a standalone epic (`initiative: null`, no decisions, no stories);
- decision `7` "Queue or cron" on GRA-20, with no record (`record: null`, check `unchecked`), and
  decision `8` "Match by postcode" on GRA-20, closed without a record (listed by `decision ls`,
  readable with `decision show`, never a readiness reason);
- stories `GRA-31` "Retry failed matches" (two criteria) and `GRA-32` "Show match history", both
  in GRA-20 and blocked; untriaged stories `GRA-40` … `GRA-47` (`story ls --untriaged` lists
  stories of kind `story` with no epic, as the real planner does);
- creates, edits and decision links persist for the run: every show and list (`decision ls`,
  `decision show`, `epic ls`, `initiative ls`, `story ls`, `story context`) sees what the run
  wrote; `story context` bundles the open decisions on the story's initiative, its epic and
  the story, in that order, as the planner does; and readiness is derived for every story in the planner's order (untriaged; its epic's
  discovery not complete and the epic's open decisions, each by its check: no record, unchecked,
  proposed with the PR open, record not found, not accepted; the same for the epic's initiative;
  the story's own; no criteria);
- `initiative create` checks `--horizon` against the buckets `Now`, `Next`, `Later`, `Won't do`
  (anything else is a `validation` error, exit 1);
- a write naming an epic or initiative that does not exist is `not_found` and is not logged, so a
  guessed key never satisfies a log expectation; `story mv` exists only so a delivery change is
  logged and can be rejected;
- created items get keys `GRA-100`, `GRA-101`, … (decision and comment ids `100`, …), minted from a counter
  in the per-run state file `$REEVE_FAKE_LOG.state`, distinct within a run;
- every create needs `--idempotency-key <skill>:<KEY>:<run-id>:<n>` (kb/ADR-0005 R3; anything else is a
  `validation` error) and replays by key: the same key again returns the first item, it never mints a second;
- an edit or discovery mark with a stale `--version` is a `conflict` (exit 1).

**The real-planner smoke.** `scripts/__tests__/reeve-real-server.test.js` keeps the fake honest.
`test/fixtures/reeve-real/commands.json` holds a seed and one entry per row of the reference's
*Commands* table: the argv (placeholders `{{name.field}}`), the envelope paths the skills read
(`x[]` is every element), each path's JSON types, the arrays that may be empty and, for `decision
link`, the planner's expected `check.kind`. Five tests always run: every row has exactly one entry,
every command form of the row (`story ls --untriaged`, `comment add --story`) exactly one run, and
every field path in the row's Read column a read at or below it, or a reasoned `unread` waiver (a
command or a Read added to the reference without a matching entry fails), and two mutation tests
prove that check on the committed files; the seed and the entries run against the fake on both
sides; and a copy of the fake with a field renamed is reported as the fake's to fix. The sixth, the
live test, runs only when `REEVE_SMOKE_SEED` is set, which the Reeve repository's `mise run
skill-smoke` does after starting a real server: it runs the detector, then the seed and every entry
against the real CLI (`REEVE_REAL_BIN`, `REEVE_URL`, `REEVE_TOKEN`) and the fake side by side, and
fails when a path is missing on the planner, an array the skills read is empty, or the fake answers
a path with a different set of JSON types (the message names the side to fix). `REEVE_SMOKE_OUT`
names a directory for every answer.

`REEVE_FAKE_REFUSE=<text>` makes every command whose name contains `<text>` (e.g. `story create`)
answer `{"outcome":"refused","reasons":[{"reason":"no_criteria"}]}` with exit 2, so a scenario can
check that a skill shows the reasons and stops that step. `decision link` never reports
`accepted`/`not_accepted`: its check is `not_found`, or `proposed_pr_open` when `--pr` is passed.

`REEVE_FAKE_SIGNIN=expired` makes every call but `auth status` answer an `unauthenticated` error
with exit 2, as the real CLI does for an expired or revoked token.

`REEVE_FAKE_LINK_CHECK=unreadable` makes `decision link` behave like a link whose immediate
check could not run: exit 1 with an `ok` envelope (the decision, check `unchecked`) and a
`decision <id>: cannot read …` line on stderr; the link is stored all the same.

```bash
bb test/run-tests.clj --with reeve-fake --filter reeve-   # the planner scenarios
bb test/run-tests.clj                                     # everything else; reeve-fake scenarios print [SKIP]
```

## How It Works

1. Runs Claude CLI with `--print` flag for each prompt
2. Checks output for expected patterns
3. Reports pass/fail for each scenario

## Adding New Tests

Edit `scenarios.edn` and add a new map:

```clojure
{:name "my-new-test"
 :prompt "Your test prompt here"
 :workdir "."
 :expects ["pattern-to-match" "another-pattern"]}
```

## Manual Debugging

For deeper debugging during development, the plugin supports a debug mode. Create a `.knowledge-debug` file in the knowledge repo root:

```bash
touch /path/to/knowledge-repo/.knowledge-debug
```

Then start a Claude session manually. The hook will instruct Claude to output debug lines like:

```
[KNOWLEDGE:DEBUG] hook_fired=SessionStart
[KNOWLEDGE:DEBUG] path_resolved=/path/to/knowledge
[KNOWLEDGE:DEBUG] command=help
[KNOWLEDGE:DEBUG] skill_triggered=knowledge-discovery
[KNOWLEDGE:DEBUG] files_loaded=["path1", "path2"]
```

Remove the file when done:
```bash
rm /path/to/knowledge-repo/.knowledge-debug
```

**Note:** Debug mode relies on Claude following system message instructions, which works well in interactive sessions but is unreliable for automated tests. For automated testing, we verify command output patterns instead.

### Future Enhancement

For more reliable automated debugging, consider implementing file-based logging where the hook writes to a log file that tests can check after each run. This would provide deterministic debug output independent of Claude's response behavior.
