# Reeve planning skills for Lorekeeper — implementation plan (Reeve milestone one, plan D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `reeve` CLI on the path reports itself as the planner and the user is signed in, Lorekeeper gains two planning skills (`planning-initiative`, `refining-epic`), brainstorming reads the story's context bundle first, and recording-decisions links a drafted record to its required decision; absent the planner, every skill behaves exactly as today.

**Architecture:** Markdown skills only (this plugin's convention), plus one small Node script `scripts/reeve-detect.js` that answers "is the planner present and am I signed in" deterministically (`reeve --version` must print `reeve-planner …`; `reeve auth status --json` must be `ok`), called by every skill that touches the planner so detection is one tested piece of code (no hook calls it). Every `reeve` call uses `--json`, branches on the exit status (0 ok, 2 refused, 1 failure) and passes `--idempotency-key` on creates. Skills never write a spec; they write into the planner (briefs, required decisions, epics, stories with criteria) and link records.

**Tech Stack:** Claude Code plugin markdown (`skills/*/SKILL.md`, `actions/`, `reference/`), Node 22 scripts with `node --test`, Babashka scenario tests (`bb test/run-tests.clj`, extended in Task 1 with per-scenario environments and fake-log assertions) with a fake `reeve` (a Node script) under `test/fixtures/reeve-bin/`.

## Governing decisions

The accepted records live in the Reeve planner's knowledge base (`~/Source/reeve/lore/knowledge/adrs/`, prefix `kb`); this repository has no ADR home, and `adr-lint select` cannot run across repositories, so the records were read directly (2026-10-26). Rules quoted verbatim. No invalidation trigger fires.

- **kb/ADR-0005 — Lorekeeper optionally drives Reeve through the reeve CLI when it is present; Reeve never depends on Lorekeeper** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0005.R1 — "Skills MUST detect the planner by `reeve --version` reporting `reeve-planner` and by a successful login; absent either, every skill MUST behave as before; no manifest change MAY be required."
  - kb/ADR-0005.R2 — "The runner's CLI MUST be renamed so it never answers to `reeve`."
  - kb/ADR-0005.R3 — "Every `reeve` command used by a skill MUST support `--json` and MUST exit with a distinct status for success, refusal and failure; create commands MUST accept a caller-supplied idempotency key and MUST NOT deduplicate on titles."
  - kb/ADR-0005.R4 — "Initiative and epic planning MUST be separate skills that produce no spec; the brainstorming skill's hard gate and checklist MUST NOT be weakened; recording-decisions MUST link a drafted record to its required decision when the planner is present."
  - kb/ADR-0005.R5 — "Reeve MUST NOT require Lorekeeper for any planning function; an MCP server, if ever added, MUST wrap the same commands."
- **kb/ADR-0004 — Decision records stay in git; the planner tracks required decisions …** (accepted 2026-10-26)
  - kb/ADR-0004.R3 — "Setting or changing a reference MUST reset the check result and trigger an immediate check of that required decision; no item keys MAY be written into records."
  - kb/ADR-0004.R5 — "Broad product reasoning MUST live in the initiative brief; a hard-to-reverse non-architectural choice MUST be a decision record, and Lorekeeper's record triage MUST draft process, tooling and product records rather than decline them; no separate RFC artifact MAY be introduced."
- **kb/ADR-0002 — Work is initiative, epic and story …** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0002.R1 — "A story MUST be sized so that one person or one agent session can finish it; it MAY link to any number of pull requests; the planner MUST NOT introduce a fourth hierarchy level."
  - kb/ADR-0002.R6 — "The vocabulary initiative, epic, story and decision MUST be used across API, database, CLI and UI."
- **kb/ADR-0003 — Readiness is computed …** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0003.R1 — "The planner MUST NOT persist a readiness value; every readiness answer MUST be derived from current facts and MUST include the failing reasons; no named maturity level other than ready MAY be exposed on stories."

How the rules shape this plan: detection is exactly R1's two checks and nothing else (no manifest key, no env var requirement); every command in a skill carries `--json`, branches on exit 0/2/1 and passes `--idempotency-key` (R3; the CLI already does this per plan A); the two new skills write to the planner and never produce a spec (R4); the brainstorming hard gate and checklist keep every existing step — the changes are a new first step that reads context when the planner is present plus guarded additions to steps 1, 5, 6 and 9 that only apply when it is (R4); recording-decisions links at the apply step, when the record's path and id are final, with `reeve decision link` (R4, kb/ADR-0004 R3), and its triage drafts process/tooling/product records instead of sending them to an RFC or meeting notes (kb/ADR-0004 R5); readiness is only ever read from the planner, never inferred or stored by a skill (kb/ADR-0003 R1).

Design choices this plan makes (reversible):

- **One detector script.** `node <plugin-root>/scripts/reeve-detect.js` prints one JSON line `{ "present": bool, "signed_in": bool, "url": string|null, "email": string|null, "bin": string, "run_id": string, "reason": string }` and exits 0 always. It runs `${REEVE_BIN:-reeve} --version` (the first line must match `^reeve-planner(\s|$)`) and, only when that passes, `${REEVE_BIN:-reeve} auth status --json` (must exit 0 with `{"outcome":"ok",…}`), each with a 10 s timeout. `bin` is the command word it used (`reeve` unless `REEVE_BIN` is set); `run_id` is 8 random hex characters minted once per call, which the calling skill uses in its idempotency keys. Skills call it once and branch on `present && signed_in`.
- **Skills call the binary the detector checked.** Every skill invokes `${REEVE_BIN:-reeve}` exactly like the detector, written out as the detector's `bin` value (literally `reeve` in every normal session), never as the `${…}` expression: permission rules such as `Bash(reeve *)` match the literal first word.
- **Required decisions carry the Lorekeeper id-to-be.** When brainstorming or a planning skill drafts a record for a required decision, the decision's title is the record's title and the link is made at apply time, when the file path exists on a branch with a PR: `reeve decision link <id> --record <kb/ADR-NNNN> --repo <name> --path <path> --pr <url> --household <dir> --json`. A draft that is not applied in the session leaves a pointer: planning skills add a comment on the required decision, brainstorming stores `Required decision: #<id>` beside the draft in the spec. Before link, the planner shows the decision as "no record" (`record: null`); after link, "proposed, PR open"; after acceptance and the next check, satisfied. Nothing is written into records (kb/ADR-0004 R3).
- **Placement lives in refining-epic.** Untriaged stories (`reeve story ls --untriaged --json`) get the spec's placement tree during epic refinement; no separate triage skill.
- **Codex twins are thin pointers.** `lore-planning-initiative` and `lore-refining-epic` are three-line SKILL.md files like `skills/lore-adr/SKILL.md`: load `../../references/codex-runtime.md`, then follow the canonical skill. No procedure is duplicated.
- **Triage is unconditional.** kb/ADR-0004 R5 is an accepted Lorekeeper rule that does not depend on the planner, so record.md's step 3 drafts process, tooling and product records whether or not `reeve` is present. Two more record.md lines are unguarded and behave the same without the planner: step 5 stops after the draft when the caller says "draft only; do not apply" (brainstorming already passes that phrase), and step 3 titles a record after the required decision it answers (only reachable when a required decision exists). kb/ADR-0005 R1's "every skill MUST behave as before" covers planner-dependent behaviour (detection, reading the planner, writing to it, linking), and every such addition is guarded by the detector.

## File structure

- Create: `scripts/reeve-detect.js`, `scripts/__tests__/reeve-detect.test.js`, `scripts/__tests__/reeve-fake.test.js`
- Create: `test/fixtures/reeve-bin/reeve` (the fake planner CLI, a Node script, mode 755)
- Create: `references/reeve-cli.md` (the command contract every skill quotes: binary, commands, flags, exit statuses, idempotency keys, JSON shapes, how to word answers)
- Create: `skills/planning-initiative/SKILL.md`, `skills/planning-initiative/reference/brief-template.md`, `skills/refining-epic/SKILL.md`
- Create: `skills/lore-planning-initiative/SKILL.md`, `skills/lore-refining-epic/SKILL.md`
- Create: `skills/recording-decisions/actions/link.md`
- Modify: `test/run-tests.clj` (per-scenario environment, `:requires`/`--with`, `:allowed-tools`, `:log-expects`/`:log-rejects`), `test/README.md`, `test/scenarios.edn`
- Modify: `skills/brainstorming/SKILL.md` (step 0, additions to steps 1, 5, 6, 9 and one graph node), `skills/writing-plans/SKILL.md` (the low-tier ride-along bullet carries `Required decision: #<id>`)
- Modify: `skills/recording-decisions/SKILL.md` (description, rule 3, action table row, action list, "Where a change lands"), `skills/recording-decisions/actions/record.md` (step 3 triage, step 6 link)
- Create: `scripts/__tests__/reeve-reference.test.js` (every `reeve` command of the reference and the skills parses in the fake, and in the real CLI when `REEVE_REAL_BIN` is set; branch fix round)
- Modify: `hooks/load-standards-reminder.sh` (two router rows, only when `reeve --version` reports `reeve-planner`), `scripts/__tests__/load-standards-hook.test.js`, `README.md` (skills table, "Reeve planner" paragraph with the allow rules), `commands/help.md`, `commands/adr.md`, `skills/lore-adr/SKILL.md`, `CLAUDE.md` (zero-runtime exception for the detector), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (version 3.3.0: origin/main took 3.2.0)
- Companion: `Mindful-Stack/witan` `.claude-plugin/marketplace.json` (the `lore` entry's `version` → 3.3.0), a separate PR

## Task order

1 runner + detector + fake + CLI reference → 2 planning-initiative → 3 refining-epic → 4 brainstorming step 0 → 5 recording-decisions triage + link → 6 router, README, Codex twins, CLAUDE.md, version, full runs.

---

## Global constraints (copy into every implementer brief)

- No skill writes a spec or a plan on the planner's behalf; planning skills write to the planner through `reeve` and print what they wrote.
- Every `reeve` call in a skill is copied from `references/reeve-cli.md`: `--json` as the last argument; branch on the envelope, `outcome` first: `ok` (exit 0) → proceed, `refused` (exit 2) → show the reasons and stop that step, `error` with `unauthenticated` or `forbidden` (also exit 2) → stop the run and say `reeve auth login`, any other `error` (exit 1) → show it and stop that step. Two exceptions, both in the reference: `code: conflict` (a stale `--version`) re-reads, folds the change in and retries once; `decision link` exiting 1 with an `ok` envelope means "linked, check not run here". A usage error has no envelope.
- Creates (`initiative create`, `epic create`, `story create`, `decision require`, `comment add`) pass `--idempotency-key <skill>:<KEY>:<run-id>:<n>`: the skill name, the item the run works on, the detector's `run_id` (minted once per skill invocation and printed in the report), and the ordinal of this create in the run, from 1. A retry within the run reuses its key; a new run never reuses an old key; keys never derive from titles (kb/ADR-0005 R3).
- The request confirms only content it supplies (titles, criteria, deciders, due dates, a named home); composed content (a rewritten brief, a new epic or initiative, a chosen home) needs its own yes, or, headless, a request that names that write. Headless, an unanswered question stops the run with `Stopped: missing <what>.` (the reference's *Confirmation*). Scenario prompts give every answer and say "Do not ask questions; the answers are given.", or withhold one on purpose.
- Absent the planner (detector says `present: false` or `signed_in: false`), every planner-dependent step is skipped and the skill behaves exactly as on `origin/main`; the unconditional changes are record.md's triage, with its two behaviour-neutral companions (see Design choices), and brainstorming's announce line. The router's two planner rows appear only when `reeve --version` reports `reeve-planner`, and the two skills' descriptions trigger only on requests that name Reeve or an item key.
- Paths inside skills are written as `<plugin-root>/…`, absolute in every Bash command.
- Vocabulary: initiative, epic, story, decision; "discovery complete"; "ready" / "blocked" with the planner's reasons, worded by the reference's table and never computed by a skill (kb/ADR-0003 R1).
- Tests: Node tests for the detector and the fake; a Babashka scenario per behaviour, each stating the defect it distinguishes; for each new or changed skill, the mutation check from docs/writing-skills-guide.md (empty the skill's body below the frontmatter, the scenario must fail, restore).
- Commits: `feat(skills): …`, `test: …`, `docs: …`; a body naming the plan task; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Runner, detector, fake planner and the CLI reference

**Files:**
- Modify: `test/run-tests.clj`, `test/README.md`, `test/scenarios.edn` (scenario `reeve-runner-selftest`)
- Create: `scripts/reeve-detect.js`, `scripts/__tests__/reeve-detect.test.js`, `test/fixtures/reeve-bin/reeve`, `scripts/__tests__/reeve-fake.test.js`, `references/reeve-cli.md`

- [ ] **Step 1: Failing detector tests**

```js
// scripts/__tests__/reeve-detect.test.js — node --test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const script = path.join(__dirname, '..', 'reeve-detect.js');
const OK = '{"outcome":"ok","value":{"url":"http://127.0.0.1:7474","token_from_env":false,"email":"dan@example.com","role":"member","token_kind":"interactive"}}';
// What the real CLI prints, with exit 1, when no server is configured (verified against reeve-planner 0.1.0).
const SIGNED_OUT = '{"code":"internal","message":"no server url: set REEVE_URL or run `reeve auth set-token --url ... --token ...`","outcome":"error"}';

// An executable `reeve` that logs its argv to <dir>/log and answers --version and auth.
function fake(versionLine, authBody, authExit = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-detect-'));
  const bin = path.join(dir, 'reeve');
  const log = path.join(dir, 'log');
  fs.writeFileSync(bin, [
    '#!/bin/sh',
    `echo "$*" >> '${log}'`,
    'case "$1" in',
    `  --version) ${versionLine};;`,
    `  auth) echo '${authBody}'; exit ${authExit};;`,
    '  *) exit 1;;',
    'esac',
    '',
  ].join('\n'));
  fs.chmodSync(bin, 0o755);
  return { bin, log };
}
function detect(bin, env = {}) {
  return JSON.parse(execFileSync('node', [script], { encoding: 'utf8', env: { ...process.env, REEVE_BIN: bin, ...env } }));
}
const logged = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');

test('the planner, signed in', () => {
  for (const version of ['reeve-planner 0.1.0', 'reeve-planner 0.1.0-fake']) {
    const { bin } = fake(`echo '${version}'`, OK);
    const { run_id, ...out } = detect(bin);
    assert.deepEqual(out, { present: true, signed_in: true, url: 'http://127.0.0.1:7474', email: 'dan@example.com', bin, reason: '' });
    assert.match(run_id, /^[0-9a-f]{8}$/);
  }
});

test('anything else answering to reeve is not the planner, and its auth is never run', () => {
  for (const version of ['reeve 0.9.0', 'reeve-runner 0.9.0', 'reeve-plannerx 1.0']) {
    const { bin, log } = fake(`echo '${version}'`, OK);
    const out = detect(bin);
    assert.equal(out.present, false, version);
    assert.equal(out.signed_in, false, version);
    assert.match(out.reason, /reeve-planner/, version);
    assert.match(logged(log), /^--version$/m, `${version}: the fake was run`);
    assert.doesNotMatch(logged(log), /^auth/m, version);
  }
});

test('the planner, signed out (exit 1 with an error envelope)', () => {
  const { bin } = fake("echo 'reeve-planner 0.1.0'", SIGNED_OUT, 1);
  const out = detect(bin);
  assert.equal(out.present, true);
  assert.equal(out.signed_in, false);
  assert.equal(out.email, null);
  assert.match(out.reason, /^signed out: no server url/);
});

test('signed out is read from the envelope, not the exit code', () => {
  // exit 0 with an error envelope: still signed out
  const { bin } = fake("echo 'reeve-planner 0.1.0'", '{"outcome":"error","code":"unauthenticated","message":"token rejected"}', 0);
  const out = detect(bin);
  assert.equal(out.present, true);
  assert.equal(out.signed_in, false);
  assert.match(out.reason, /^signed out: token rejected/);
});

test('a missing binary is absent, and the detector still exits 0', () => {
  const out = detect(path.join(os.tmpdir(), 'no-such-dir-reeve', 'reeve')); // execFileSync would throw on a non-zero exit
  assert.equal(out.present, false);
  assert.match(out.reason, /not found/);
});

test('a hanging binary times out instead of hanging the session', () => {
  const { bin } = fake('sleep 5', OK);
  const started = Date.now();
  const out = detect(bin, { REEVE_DETECT_TIMEOUT_MS: '500' });
  assert.ok(Date.now() - started < 4000, 'returned at the timeout, not when the child finished');
  assert.equal(out.present, false);
  assert.match(out.reason, /timed out/);
});

test('a child that ignores SIGTERM is still killed at the timeout', () => {
  const { bin } = fake("trap '' TERM; sleep 6", OK);
  const started = Date.now();
  const out = detect(bin, { REEVE_DETECT_TIMEOUT_MS: '500' });
  assert.ok(Date.now() - started < 4000, 'returned at the timeout');
  assert.equal(out.present, false);
  assert.match(out.reason, /timed out/);
});
```

What these distinguish: test 1 a detector that rejects a pre-release suffix or reports the wrong binary; test 2 a looser rule (`startsWith('reeve')`, `/^reeve-\w+/`, `includes('reeve-planner')`) that accepts the runner renamed by kb/ADR-0005 R2 or a lookalike, and a detector that runs an unknown binary's `auth status`; test 3 one that trusts stdout without the exit status, or reports signed-in from `--version` alone; test 4 one that throws or exits non-zero when `reeve` is absent; test 5 a signed-out check keyed on the exit code alone; test 6 one without a timeout; test 7 one whose timeout a child ignoring SIGTERM defeats (`killSignal: 'SIGKILL'`).

- [ ] **Step 2: Run them, see them fail**

Run: `node --test scripts/__tests__/reeve-detect.test.js`
Expected: 7 failing tests (`Cannot find module` / non-JSON output: the script does not exist yet).

- [ ] **Step 3: The detector**

```js
#!/usr/bin/env node
// scripts/reeve-detect.js — is the Reeve planner present and is the user signed in? (kb/ADR-0005 R1)
// Prints one JSON line and always exits 0. REEVE_BIN overrides the binary (tests);
// REEVE_DETECT_TIMEOUT_MS overrides the 10 s timeout per call (tests).
'use strict';
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const bin = process.env.REEVE_BIN || 'reeve';
const timeout = Number(process.env.REEVE_DETECT_TIMEOUT_MS) || 10_000;
const result = { present: false, signed_in: false, url: null, email: null, bin, run_id: crypto.randomBytes(4).toString('hex'), reason: '' };

function finish(reason) {
  result.reason = reason;
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}
function run(args) {
  try {
    return { status: 0, out: execFileSync(bin, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    if (e.code === 'ENOENT') finish(`${bin} not found`);
    if (e.code === 'ETIMEDOUT') finish(`${bin} ${args.join(' ')} timed out`);
    return { status: typeof e.status === 'number' ? e.status : 1, out: String(e.stdout || '') };
  }
}

const version = run(['--version']);
const first = version.out.split('\n')[0].trim();
if (version.status !== 0 || !/^reeve-planner(\s|$)/.test(first)) finish(`${bin} --version printed "${first}", not reeve-planner`);
result.present = true;

const auth = run(['auth', 'status', '--json']);
let envelope = null;
try { envelope = JSON.parse(auth.out); } catch { envelope = null; }
if (!envelope || typeof envelope !== 'object') finish(`${bin} auth status printed no JSON envelope`);
if (auth.status !== 0 || envelope.outcome !== 'ok') finish(`signed out: ${envelope.message || envelope.code || 'auth status failed'}`);
result.signed_in = true;
result.url = envelope.value?.url ?? null;
result.email = envelope.value?.email ?? null;
finish('');
```

Run: `node --test scripts/__tests__/reeve-detect.test.js` — Expected: 7 passing.

- [ ] **Step 4: The fake planner**

`test/fixtures/reeve-bin/reeve` (`chmod 755`; git keeps the mode):

```js
#!/usr/bin/env node
// A fake Reeve planner CLI for the scenario tests (test/README.md). Every valid call except
// `--version` (the SessionStart hook probes it too) is appended to $REEVE_FAKE_LOG as one line (argv
// joined by spaces, newlines flattened). What the real CLI's parser rejects (an unknown command or
// flag, a value starting with `-` except `comment add --body`) is a usage error: text on stderr, no
// stdout, exit 1. Answers use the planner's wire shapes (StoryContextDto, RequiredDecisionDto,
// CheckResult, Reason in the Reeve repository's crates/reeve-server/tests/snapshots/openapi.json).
// REEVE_FAKE_LINK_CHECK=unreadable makes `decision link` behave like a link whose immediate check
// could not run. REEVE_FAKE_REFUSE=<text> makes every command whose name contains <text> (e.g.
// `story create`) answer with a `refused` envelope and exit 2. REEVE_FAKE_SIGNIN=expired makes every
// call but `auth status` answer an `unauthenticated` error, exit 2. Creates replay by
// --idempotency-key from the state file $REEVE_FAKE_LOG.state; creates, edits and decision links
// persist there, so later shows, lists and readiness see them like the real planner.
'use strict';
const fs = require('node:fs');

const argv = process.argv.slice(2);
const log = process.env.REEVE_FAKE_LOG;
// Logged only once the call passed validation, so a malformed call never satisfies a log expectation.
const logCall = () => { if (log) fs.appendFileSync(log, argv.join(' ').replace(/[\r\n\u2028\u2029\u0085]+/g, ' ') + '\n'); };

// Per-run state next to the log: { next, creates: { <idempotency key>: <response value> },
// items: { <KEY>: <the item as last written> }, decisions: { <id>: <the decision as last linked> } }. Updates
// run under an exclusive lock file, so parallel calls neither share an id nor lose a replay entry.
function withState(fn) {
  if (!log) return fn({ next: 100, creates: {} }); // no log, no run: nothing to replay
  const file = `${log}.state`;
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST' || tries > 2000) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    let state;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { state = { next: 100, creates: {} }; }
    const result = fn(state);
    fs.writeFileSync(file, JSON.stringify(state));
    return result;
  } finally { fs.unlinkSync(lock); }
}
const KEY_SHAPE = /^[a-z][a-z0-9-]*:(?:[A-Z][A-Z0-9]*-[0-9]+|[0-9]+):[0-9a-f]{8}:[0-9]+$/; // <skill>:<KEY>:<run-id>:<n>; KEY an item key or a decision id

const emit = (envelope, code) => { process.stdout.write(JSON.stringify(envelope) + '\n'); process.exit(code); };
const ok = (value) => emit({ outcome: 'ok', value }, 0);
const error = (code, message) => emit({ outcome: 'error', code, message }, code === 'unauthenticated' || code === 'forbidden' ? 2 : 1);
// What clap rejects: no envelope, the usage text on stderr, exit 1.
const usage = (message) => { process.stderr.write(`error: ${message}\n\nFor more information, try '--help'.\n`); process.exit(1); };

if (argv[0] === '--version') { process.stdout.write('reeve-planner 0.1.0-fake\n'); process.exit(0); }
if (!argv.includes('--json')) error('validation', 'the fake planner answers --json calls only');
const words = argv.filter((a) => a !== '--json');

const DISCOVERY = { pos: 1, val: ['version'], bool: ['complete', 'reopen'], req: ['version'] };
const SPEC = {
  'auth status': { pos: 0 },
  'story context': { pos: 1 },
  'story ls': { pos: 0, val: ['epic'], bool: ['untriaged'] },
  'story create': { pos: 0, val: ['idempotency-key', 'title', 'kind', 'epic', 'description'], rep: ['criterion', 'label'], req: ['idempotency-key', 'title'] },
  'story mv': { pos: 2, val: ['version', 'resolution', 'override'] },
  'story edit': { pos: 1, val: ['version', 'title', 'epic', 'kind', 'rank'], bool: ['no-epic'], rep: ['criterion'], req: ['version'] },
  'initiative show': { pos: 1 },
  'initiative ls': { pos: 0 },
  'initiative create': { pos: 0, val: ['idempotency-key', 'title', 'horizon', 'brief', 'target-month', 'owner'], req: ['idempotency-key', 'title', 'horizon'] },
  'initiative edit': { pos: 1, val: ['version', 'title', 'brief', 'horizon', 'target-month', 'owner'], req: ['version'] },
  'initiative discovery': DISCOVERY,
  'epic show': { pos: 1 },
  'epic ls': { pos: 0, val: ['initiative'] },
  'epic create': { pos: 0, val: ['idempotency-key', 'title', 'initiative', 'brief'], req: ['idempotency-key', 'title'] },
  'epic edit': { pos: 1, val: ['version', 'title', 'brief', 'initiative'], bool: ['no-initiative'], req: ['version'] },
  'epic discovery': DISCOVERY,
  'decision ls': { pos: 0, val: ['on'], bool: ['mine'] },
  'decision show': { pos: 1 },
  'decision require': { pos: 0, val: ['idempotency-key', 'on', 'title', 'decider', 'due'], req: ['idempotency-key', 'on', 'title', 'decider'] },
  'decision link': { pos: 1, val: ['record', 'repo', 'path', 'pr', 'household'], req: ['record', 'repo', 'path'] },
  'comment add': { pos: 0, val: ['idempotency-key', 'story', 'decision', 'body'], req: ['idempotency-key', 'body'] },
};
const cmd = words.slice(0, 2).join(' ');
const spec = SPEC[cmd] || usage(`unrecognized subcommand: reeve ${cmd}`);
const pos = [];
const f = {};
for (let i = 2; i < words.length; i++) {
  const w = words[i];
  if (!w.startsWith('--')) { pos.push(w); continue; }
  const name = w.slice(2);
  if ((spec.bool || []).includes(name)) f[name] = true;
  else if ((spec.val || []).includes(name) || (spec.rep || []).includes(name)) {
    if (i + 1 >= words.length) usage(`a value is required for '--${name}'`);
    const v = words[++i];
    if (v.length > 1 && v.startsWith('-') && !(cmd === 'comment add' && name === 'body')) usage(`unexpected argument '${v.split(/\s/)[0]} ' found`);
    if ((spec.rep || []).includes(name)) (f[name] ||= []).push(v); else f[name] = v;
  } else usage(`unexpected argument '--${name}' found`);
}
if (pos.length !== spec.pos) usage(`reeve ${cmd} takes ${spec.pos} positional argument(s), got ${pos.length}`);
for (const r of spec.req || []) if (!(r in f)) usage(`the following required arguments were not provided: --${r}`);
if (spec === DISCOVERY && !f.complete && !f.reopen) usage('pass --complete or --reopen');
if (f.kind && !['story', 'bug', 'chore'].includes(f.kind)) usage(`invalid value '${f.kind}' for '--kind'`);
if (f.version && !/^\d+$/.test(f.version)) usage(`invalid value '${f.version}' for '--version'`);
if (f.due && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) usage(`invalid value '${f.due}' for '--due'`);
if (cmd === 'comment add' && !f.story === !f.decision) usage('pass exactly one of --story and --decision');
if (f['idempotency-key'] !== undefined && !KEY_SHAPE.test(f['idempotency-key'])) error('validation', `--idempotency-key must look like <skill>:<KEY>:<run-id>:<n>, got ${f['idempotency-key']}`);

const NOW = '2026-10-20T09:00:00Z';
const initiative = (key, title, o = {}) => ({ key, title, brief: '', horizon: 'Later', owner: null, target_month: null, discovery_complete: null, external_ref: null, progress: null, version: 1, ...o });
const epic = (key, title, o = {}) => ({ key, title, brief: '', initiative: null, discovery_complete: null, external_ref: null, version: 1, ...o });
const story = (key, title, o = {}) => ({ key, title, kind: 'story', epic: null, description: '', criteria: [], labels: [], rank: 0, blocked_by: [], delivery: 'todo', resolution: null, owner: null, external_ref: null, prs: [], version: 1, ...o });
const initiatives = {
  'GRA-12': initiative('GRA-12', 'Faster mentor matching', { brief: 'Mentees wait too long for a mentor.', horizon: 'Next', owner: 'dan@example.com', version: 3 }),
  'GRA-13': initiative('GRA-13', 'Mentor onboarding', { brief: 'New mentors get started without help.', horizon: 'Now', owner: 'sam@example.com' }),
};
const epics = {
  'GRA-20': epic('GRA-20', 'Matching queue', { brief: 'Match mentors through a queue.', initiative: 'GRA-12', version: 2 }),
  'GRA-21': epic('GRA-21', 'Mentor profiles', { brief: 'Mentors describe their skills and availability.', initiative: 'GRA-13' }),
  'GRA-22': epic('GRA-22', 'Session feedback', { brief: 'Mentees rate each mentoring session after it ends.' }), // standalone: no initiative
};
const decision7 = { id: 7, on: 'GRA-20', title: 'Queue or cron', decider: 'dan@example.com', due: null, record: null, pr_url: null, check: { kind: 'unchecked' }, checked_at: null, closed: null, created_at: NOW, version: 1 };
// Closed without a record: listed by `decision ls`, never open, never a readiness reason (kb/ADR-0003 R3).
const decision8 = { ...decision7, id: 8, title: 'Match by postcode', closed: { at: NOW, by: 'dan@example.com', reason: 'matching no longer uses the postcode' }, version: 2 };
const HORIZONS = ['Now', 'Next', 'Later', "Won't do"];
const stories = {
  'GRA-31': story('GRA-31', 'Retry failed matches', { epic: 'GRA-20', criteria: [{ text: 'A failed match is retried up to three times', done: false }, { text: 'The third failure is reported to the coordinator', done: false }] }),
  'GRA-32': story('GRA-32', 'Show match history', { epic: 'GRA-20' }),
  'GRA-40': story('GRA-40', 'Matching crashes when a mentor has no timezone'),
  'GRA-41': story('GRA-41', 'Upgrade the queue client library'),
  'GRA-42': story('GRA-42', 'Drop a match request the mentee withdrew from the queue'),
  'GRA-43': story('GRA-43', 'Welcome email with an onboarding checklist for new mentors'),
  'GRA-44': story('GRA-44', 'Invoice employers for programme fees'),
  'GRA-45': story('GRA-45', 'Coordinators match a mentee by hand in one click'),
  'GRA-46': story('GRA-46', 'Fax match summaries to coordinators'),
  'GRA-47': story('GRA-47', 'Translate the mentee app into Spanish'),
};
// The run's state, read once: items created or edited in this run, by key (a show or a list sees
// the last write), and the creates by idempotency key.
const state = withState((st) => st);
const itemsOf = () => state.items || {};
const find = (table, key) => itemsOf()[key] || table[key] || error('not_found', `no item ${key}`);
const bump = (item) => (Number(f.version) === item.version ? { ...item, version: item.version + 1 } : error('conflict', `${item.key} is at version ${item.version}, not ${f.version}`));
const [p0] = pos;
// Items created in this run, by kind, in creation order (lists show them like the real planner).
const createdDecisions = () => Object.values(state.creates).filter((v) => !Array.isArray(v) && 'decider' in v);
const kindOf = (v) => ('criteria' in v ? 'story' : 'horizon' in v ? 'initiative' : 'epic');
const all = (table, kind) => Object.values({ ...table, ...Object.fromEntries(Object.entries(itemsOf()).filter(([, v]) => kindOf(v) === kind)) });
const save = (item) => withState((state) => { (state.items ||= {})[item.key] = item; return item; });
// A create answers with the item built for a fresh id; the same key again replays the first answer.
const mint = (build) => withState((state) => {
  const key = f['idempotency-key'];
  if (!(key in state.creates)) {
    state.creates[key] = build(state.next++);
    if (state.creates[key].key) (state.items ||= {})[state.creates[key].key] = state.creates[key];
  }
  return state.creates[key];
});
// A decision as last linked in this run, else as seeded or created.
const allDecisions = () => [decision7, decision8, ...createdDecisions()].map((d) => (state.decisions || {})[d.id] || d);
// Readiness derived like the planner does (domain/readiness.rs), in its order: untriaged; the epic's
// discovery and open decisions, then the initiative's; the story's own decisions; no criteria.
const readinessOf = (s) => {
  const reasons = [];
  // Each open decision's reason from its check, as decision_reason does; an accepted record gates nothing.
  const REASON = { proposed_pr_open: 'decision_proposed_pr_open', not_found: 'decision_record_not_found', not_accepted: 'decision_not_accepted' };
  const reasonOf = (d) => (d.check.kind === 'unchecked' ? (d.record ? 'decision_unchecked' : 'decision_no_record') : REASON[d.check.kind]);
  const open = (key) => allDecisions().filter((d) => d.on === key && !d.closed && d.check.kind !== 'accepted').map((d) => ({ reason: reasonOf(d), decision_id: d.id, title: d.title, ...(d.check.kind === 'not_accepted' ? { status: d.check.status, superseded_by: d.check.superseded_by ?? null } : {}) }));
  if (s.kind === 'story' && !s.epic) reasons.push({ reason: 'untriaged' });
  const e = s.epic && (itemsOf()[s.epic] || epics[s.epic]);
  const i = e && e.initiative && (itemsOf()[e.initiative] || initiatives[e.initiative]);
  for (const a of [e, i].filter(Boolean)) {
    if (!a.discovery_complete) reasons.push({ reason: 'ancestor_discovery_incomplete', item: a.key });
    reasons.push(...open(a.key));
  }
  reasons.push(...open(s.key));
  if (!s.criteria.length) reasons.push({ reason: 'no_criteria' });
  return { ready: !reasons.length, reasons };
};

// A write that names an epic or initiative nobody created is not_found, and not logged: a guessed
// key never satisfies a log expectation.
if (['story create', 'story edit', 'epic create', 'epic edit'].includes(cmd)) {
  for (const [flag, table] of [['epic', epics], ['initiative', initiatives]]) if (f[flag] !== undefined && !itemsOf()[f[flag]] && !table[f[flag]]) error('not_found', `no ${flag} ${f[flag]}`);
}
logCall(); // valid: the call reached the planner (a refusal below is the planner's answer)
if (process.env.REEVE_FAKE_SIGNIN === 'expired' && cmd !== 'auth status') error('unauthenticated', 'the session has expired; run `reeve auth login`');
if (process.env.REEVE_FAKE_REFUSE && cmd.includes(process.env.REEVE_FAKE_REFUSE)) emit({ outcome: 'refused', reasons: [{ reason: 'no_criteria' }] }, 2);
if (cmd === 'initiative create' && !HORIZONS.includes(f.horizon)) error('validation', `horizon ${f.horizon} is not one of the configured buckets`);

({
  'auth status': () => ok({ url: 'http://127.0.0.1:7474', token_from_env: false, email: 'dan@example.com', role: 'member', token_kind: 'interactive' }),
  'story context': () => {
    const s = itemsOf()[p0] || stories[p0] || error('not_found', `no story ${p0}`);
    const e = s.epic ? itemsOf()[s.epic] || epics[s.epic] : null;
    ok({ story: s, epic: e, initiative: e && e.initiative ? initiatives[e.initiative] : null, required_decisions: s.epic === 'GRA-20' ? allDecisions().filter((d) => d.id === 7) : [], blockers: [], comments: [{ id: 1, author: 'sam@example.com', body: 'Coordinators want to see every retry.', at: NOW, on_story: s.key, on_decision: null, external_ref: null }], readiness: readinessOf(s) });
  },
  'story ls': () => ok(all(stories, 'story').filter((s) => (f.untriaged ? s.kind === 'story' && !s.epic : !f.epic || s.epic === f.epic)).map((s) => ({ story: s, readiness: readinessOf(s) }))),
  'story create': () => ok(mint((id) => story(`GRA-${id}`, f.title, { kind: f.kind || 'story', epic: f.epic || null, criteria: (f.criterion || []).map((text) => ({ text, done: false })) }))),
  'story mv': () => { const s = find(stories, p0); ok(save({ ...(f.version ? bump(s) : { ...s, version: s.version + 1 }), delivery: pos[1] })); }, // exists so a delivery change is logged; no skill may call it
  'story edit': () => { const s = find(stories, p0); ok(save({ ...bump(s), title: f.title ?? s.title, kind: f.kind ?? s.kind, epic: f['no-epic'] ? null : f.epic ?? s.epic })); },
  'initiative show': () => ok(find(initiatives, p0)),
  'initiative ls': () => ok(all(initiatives, 'initiative')),
  'initiative create': () => ok(mint((id) => initiative(`GRA-${id}`, f.title, { brief: f.brief || '', horizon: f.horizon, owner: f.owner || null }))),
  'initiative edit': () => { const i = find(initiatives, p0); ok(save({ ...bump(i), brief: f.brief ?? i.brief, title: f.title ?? i.title, horizon: f.horizon ?? i.horizon })); },
  'initiative discovery': () => ok(save({ ...bump(find(initiatives, p0)), discovery_complete: f.complete ? { at: NOW, by: 'dan@example.com' } : null })),
  'epic show': () => ok(find(epics, p0)),
  'epic ls': () => ok(all(epics, 'epic').filter((e) => !f.initiative || e.initiative === f.initiative)),
  'epic create': () => ok(mint((id) => epic(`GRA-${id}`, f.title, { brief: f.brief || '', initiative: f.initiative || null }))),
  'epic edit': () => { const e = find(epics, p0); ok(save({ ...bump(e), brief: f.brief ?? e.brief, title: f.title ?? e.title })); },
  'epic discovery': () => ok(save({ ...bump(find(epics, p0)), discovery_complete: f.complete ? { at: NOW, by: 'dan@example.com' } : null })),
  'decision ls': () => ok(allDecisions().filter((d) => !f.on || d.on === f.on)),
  'decision show': () => ok(allDecisions().find((d) => String(d.id) === p0) || error('not_found', `no decision ${p0}`)),
  'decision require': () => ok(mint((id) => ({ ...decision7, id, on: f.on, title: f.title, decider: f.decider, due: f.due || null }))),
  'decision link': () => {
    if (!/^\d+$/.test(p0)) error('validation', 'the decision id must be an integer');
    const d = allDecisions().find((x) => String(x.id) === p0) || error('not_found', `no decision ${p0}`);
    const linked = { ...d, record: { repo: f.repo, path: f.path, record_id: f.record }, pr_url: f.pr || null, version: d.version + 1 };
    // The link is stored even when its immediate check cannot run; the check stays unchecked.
    const unreadable = process.env.REEVE_FAKE_LINK_CHECK === 'unreadable';
    const value = unreadable ? { ...linked, check: { kind: 'unchecked' }, checked_at: null } : { ...linked, check: { kind: f.pr ? 'proposed_pr_open' : 'not_found' }, checked_at: NOW };
    withState((st) => { (st.decisions ||= {})[d.id] = value; });
    if (unreadable) {
      process.stderr.write(`decision ${p0}: cannot read ${f.path}: ${f.household || '.'}/${f.repo} is not a git checkout\n`);
      emit({ outcome: 'ok', value }, 1);
    }
    ok(value);
  },
  'comment add': () => {
    ok(mint((id) => [{ id, author: 'dan@example.com', body: f.body, at: NOW, on_story: f.story || null, on_decision: f.decision ? Number(f.decision) : null, external_ref: null }]));
  },
})[cmd]();
```

The fake's own tests (`scripts/__tests__/reeve-fake.test.js`), so a scenario failure is never a fake bug:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const KEY = 'planning-initiative:GRA-12:0a1b2c3d:1'; // <skill>:<KEY>:<run-id>:<n>
const fake = path.join(__dirname, '..', '..', 'test', 'fixtures', 'reeve-bin', 'reeve');
function run(args, env = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log, ...env } });
  return { status: r.status, envelope: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout, stderr: r.stderr, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

test('every call is one log line, newlines flattened', () => {
  const r = run(['epic', 'create', '--initiative', 'GRA-12', '--title', 'A', '--brief', 'one\ntwo', '--idempotency-key', KEY, '--json']);
  assert.equal(r.status, 0);
  assert.equal(r.log, `epic create --initiative GRA-12 --title A --brief one two --idempotency-key ${KEY} --json\n`);
});
test('--version names the fake planner and is not logged (the SessionStart hook probes it too)', () => {
  const r = run(['--version']);
  assert.equal(r.stdout, 'reeve-planner 0.1.0-fake\n');
  assert.equal(r.log, '');
});
test('a flag the real CLI lacks is a usage error: no envelope, text on stderr, exit 1', () => {
  const r = run(['epic', 'edit', 'GRA-20', '--brief-file', 'brief.md', '--version', '2', '--json']);
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.match(r.stderr, /unexpected argument '--brief-file'/);
});
test('a value starting with - is a usage error, except comment add --body', () => {
  for (const args of [
    ['epic', 'create', '--title', 'A', '--brief', '- a bullet', '--idempotency-key', KEY, '--json'],
    ['story', 'create', '--title', '-x', '--idempotency-key', KEY, '--json'],
    ['story', 'create', '--title', 'A', '--criterion', '- done', '--idempotency-key', KEY, '--json'],
  ]) {
    const r = run(args);
    assert.deepEqual([r.status, r.stdout, r.log], [1, '', ''], args.join(' '));
  }
  assert.equal(run(['comment', 'add', '--story', 'GRA-31', '--body', '- a bullet', '--idempotency-key', KEY, '--json']).status, 0);
});
test('a call without --json is refused; --json may stand anywhere (the real global flag)', () => {
  assert.equal(run(['epic', 'show', 'GRA-20']).status, 1);
  const r = run(['story', 'ls', '--json', '--epic', 'GRA-20']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.envelope.value.map((x) => x.story.key), ['GRA-31', 'GRA-32']);
});
test('an idempotency key must be <skill>:<KEY>:<run-id>:<n>', () => {
  for (const bad of ['k', 'epic-title', 'refining-epic:GRA-20:1234:1', 'Refining:GRA-20:0a1b2c3d:1', 'refining-epic:gra-20:0a1b2c3d:1', 'refining-epic:GRA-20:0a1b2c3d:', 'refining-epic:GRA-20:0a1b2c3d:1:2']) {
    const r = run(['epic', 'create', '--title', 'A', '--idempotency-key', bad, '--json']);
    assert.deepEqual([r.status, r.envelope.code], [1, 'validation'], bad);
  }
  assert.equal(run(['epic', 'create', '--title', 'A', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:12', '--json']).status, 0);
  assert.equal(run(['comment', 'add', '--decision', '7', '--body', 'B', '--idempotency-key', 'recording-decisions:7:0a1b2c3d:1', '--json']).status, 0);
});
test('a create replays by key; a new key mints a new item', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const create = (key, title) => JSON.parse(spawnSync(fake, ['story', 'create', '--title', title, '--idempotency-key', key, '--json'], { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout).value;
  const first = create('refining-epic:GRA-20:0a1b2c3d:1', 'One');
  assert.deepEqual(create('refining-epic:GRA-20:0a1b2c3d:1', 'One again'), first);
  const second = create('refining-epic:GRA-20:0a1b2c3d:2', 'Two');
  assert.notEqual(second.key, first.key);
  assert.equal(second.title, 'Two');
  assert.equal(JSON.parse(fs.readFileSync(`${log}.state`, 'utf8')).next, 102);
});
test('REEVE_FAKE_REFUSE makes the matching command answer refused, exit 2', () => {
  const create = ['story', 'create', '--title', 'T', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:1', '--json'];
  const r = run(create, { REEVE_FAKE_REFUSE: 'story create' });
  assert.equal(r.status, 2);
  assert.deepEqual(r.envelope, { outcome: 'refused', reasons: [{ reason: 'no_criteria' }] });
  assert.equal(run(create).status, 0); // unset: no refusal
  assert.equal(run(['story', 'ls', '--json'], { REEVE_FAKE_REFUSE: 'story create' }).status, 0); // other commands unaffected
});
test('the story context carries a required decision with no record', () => {
  const { value } = run(['story', 'context', 'GRA-31', '--json']).envelope;
  assert.equal(value.required_decisions[0].record, null);
  assert.equal(value.required_decisions[0].check.kind, 'unchecked');
  assert.ok(value.readiness.reasons.some((x) => x.reason === 'decision_no_record' && x.decision_id === 7));
});
test('a stale version is a conflict', () => {
  const r = run(['initiative', 'edit', 'GRA-12', '--brief', 'b', '--version', '1', '--json']);
  assert.deepEqual([r.status, r.envelope.code], [1, 'conflict']);
});
test('a link whose check cannot run exits 1 with the decision in an ok envelope', () => {
  const r = run(['decision', 'link', '7', '--record', 'kb/ADR-0002', '--repo', 'lore', '--path', 'knowledge/adrs/0002-inventory-reservation.md', '--pr', 'https://github.com/example/test-workspace/pull/9', '--json'], { REEVE_FAKE_LINK_CHECK: 'unreadable' });
  assert.equal(r.status, 1);
  assert.equal(r.envelope.outcome, 'ok');
  assert.equal(r.envelope.value.record.record_id, 'kb/ADR-0002');
  assert.match(r.stderr, /^decision 7: /);
});
test('a call that fails validation is not logged; a valid call the planner refuses is', () => {
  assert.equal(run(['epic', 'edit', 'GRA-20', '--brief-file', 'b.md', '--version', '2', '--json']).log, '');
  assert.equal(run(['epic', 'create', '--title', 'A', '--idempotency-key', 'epic-title', '--json']).log, '');
  const refused = run(['story', 'create', '--title', 'T', '--idempotency-key', KEY, '--json'], { REEVE_FAKE_REFUSE: 'story create' });
  assert.equal(refused.status, 2);
  assert.equal(refused.log, `story create --title T --idempotency-key ${KEY} --json\n`);
});
test('decision ls and epic ls show what this run created', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-12', '--json']).value, []);
  const d = call(['decision', 'require', '--on', 'GRA-12', '--title', 'Queue or cron', '--decider', 'dan@example.com', '--idempotency-key', KEY, '--json']).value;
  call(['comment', 'add', '--decision', String(d.id), '--body', 'x', '--idempotency-key', 'planning-initiative:GRA-12:0a1b2c3d:2', '--json']);
  const e = call(['epic', 'create', '--initiative', 'GRA-12', '--title', 'Match reminders', '--idempotency-key', 'planning-initiative:GRA-12:0a1b2c3d:3', '--json']).value;
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-12', '--json']).value.map((x) => [x.id, x.record]), [[d.id, null]]);
  assert.deepEqual(call(['epic', 'ls', '--initiative', 'GRA-12', '--json']).value.map((x) => x.key), ['GRA-20', e.key]);
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-20', '--json']).value.map((x) => [x.id, x.closed === null]), [[7, true], [8, false]]);
  assert.equal(call(['epic', 'show', 'GRA-22', '--json']).value.initiative, null); // a standalone epic
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-22', '--json']).value, []);
});
test('creates and edits persist: story ls, show and the readiness reasons see them', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  const s = call(['story', 'create', '--epic', 'GRA-20', '--title', 'Enqueue', '--kind', 'story', '--criterion', 'on the queue', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:1', '--json']).value;
  assert.equal(call(['story', 'edit', 'GRA-42', '--epic', 'GRA-20', '--version', '1', '--json']).value.version, 2);
  assert.equal(call(['story', 'edit', 'GRA-42', '--epic', 'GRA-20', '--version', '1', '--json']).code, 'conflict');
  const listed = call(['story', 'ls', '--epic', 'GRA-20', '--json']).value;
  assert.deepEqual(listed.map((x) => x.story.key), ['GRA-31', 'GRA-32', 'GRA-42', s.key]);
  assert.deepEqual(listed[2].readiness.reasons.map((r) => r.reason), ['ancestor_discovery_incomplete', 'decision_no_record', 'ancestor_discovery_incomplete', 'no_criteria']);
  assert.deepEqual(listed[3].readiness.reasons.map((r) => r.reason), ['ancestor_discovery_incomplete', 'decision_no_record', 'ancestor_discovery_incomplete']);
  assert.ok(!call(['story', 'ls', '--untriaged', '--json']).value.some((x) => x.story.key === 'GRA-42'));
  assert.equal(call(['epic', 'edit', 'GRA-20', '--brief', 'b', '--version', '2', '--json']).value.version, 3);
  assert.equal(call(['epic', 'show', 'GRA-20', '--json']).value.brief, 'b');
  assert.ok(call(['epic', 'discovery', 'GRA-20', '--complete', '--version', '3', '--json']).value.discovery_complete);
  const i = call(['initiative', 'create', '--title', 'Billing', '--horizon', 'Later', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:2', '--json']).value;
  assert.ok(call(['initiative', 'ls', '--json']).value.some((x) => x.key === i.key));
});
test('a write naming an epic or initiative nobody created is not_found and not logged', () => {
  const r = run(['story', 'edit', 'GRA-43', '--version', '1', '--epic', 'GRA-199', '--json']);
  assert.deepEqual([r.status, r.envelope.code, r.log], [1, 'not_found', '']);
  const e = run(['epic', 'create', '--initiative', 'GRA-150', '--title', 'A', '--idempotency-key', KEY, '--json']);
  assert.deepEqual([e.status, e.envelope.code, e.log], [1, 'not_found', '']);
  assert.equal(run(['epic', 'show', 'GRA-150', '--json']).envelope.code, 'not_found');
});
test('readiness is derived for every story in the planner\'s order; story mv exists so a delivery change is logged', () => {
  const listed = run(['story', 'ls', '--epic', 'GRA-20', '--json']).envelope.value;
  // the epic's discovery and open decisions (closed #8 never counts), the initiative's discovery, no criteria
  assert.deepEqual(listed.map((x) => x.readiness.reasons.map((r) => r.item || r.decision_id || r.reason)), [
    ['GRA-20', 7, 'GRA-12'],
    ['GRA-20', 7, 'GRA-12', 'no_criteria'],
  ]);
  const mv = run(['story', 'mv', 'GRA-31', 'in-progress', '--json']);
  assert.deepEqual([mv.status, mv.envelope.value.delivery, mv.log], [0, 'in-progress', 'story mv GRA-31 in-progress --json\n']);
});
test('story ls --untriaged lists stories of kind story with no epic, as the real planner does', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  assert.ok(call(['story', 'ls', '--untriaged', '--json']).value.some((x) => x.story.key === 'GRA-41'));
  call(['story', 'edit', 'GRA-41', '--version', '1', '--kind', 'chore', '--json']);
  assert.ok(!call(['story', 'ls', '--untriaged', '--json']).value.some((x) => x.story.key === 'GRA-41'));
});
test('decision show reads one decision; a closed one carries its reason', () => {
  assert.equal(run(['decision', 'show', '7', '--json']).envelope.value.title, 'Queue or cron');
  const closed = run(['decision', 'show', '8', '--json']).envelope.value;
  assert.deepEqual([closed.title, closed.record, typeof closed.closed.reason], ['Match by postcode', null, 'string']);
  assert.deepEqual([run(['decision', 'show', '99', '--json']).envelope.code], ['not_found']);
  assert.ok(!run(['story', 'context', 'GRA-31', '--json']).envelope.value.required_decisions.some((d) => d.id === 8));
});
test('REEVE_FAKE_SIGNIN=expired: every call but auth status answers unauthenticated, exit 2', () => {
  const env = { REEVE_FAKE_SIGNIN: 'expired' };
  const r = run(['epic', 'show', 'GRA-20', '--json'], env);
  assert.deepEqual([r.status, r.envelope.outcome, r.envelope.code], [2, 'error', 'unauthenticated']);
  assert.equal(run(['auth', 'status', '--json'], env).status, 0);
});
test('a horizon the planner does not have is a validation error', () => {
  const r = run(['initiative', 'create', '--title', 'Billing', '--horizon', 'Someday', '--idempotency-key', KEY, '--json']);
  assert.deepEqual([r.status, r.envelope.code], [1, 'validation']);
  assert.equal(run(['initiative', 'create', '--title', 'Billing', '--horizon', "Won't do", '--idempotency-key', KEY, '--json']).status, 0);
});
test('decision link persists: show, ls --on, story context and readiness see the link, also when the check could not run', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args, env = {}) => {
    const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log, ...env } });
    return { status: r.status, ...JSON.parse(r.stdout) };
  };
  const link = ['decision', 'link', '7', '--record', 'kb/ADR-0002', '--repo', 'lore', '--path', 'knowledge/adrs/0002-x.md', '--household', '/work', '--json'];
  const linked = call([...link, '--pr', 'https://github.com/example/lore/pull/9']);
  assert.deepEqual([linked.status, linked.value.check.kind, linked.value.version], [0, 'proposed_pr_open', 2]);
  const shown = call(['decision', 'show', '7', '--json']).value;
  assert.deepEqual([shown.record, shown.pr_url, shown.check.kind], [{ repo: 'lore', path: 'knowledge/adrs/0002-x.md', record_id: 'kb/ADR-0002' }, 'https://github.com/example/lore/pull/9', 'proposed_pr_open']);
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-20', '--json']).value.map((d) => [d.id, d.record && d.record.record_id]), [[7, 'kb/ADR-0002'], [8, null]]);
  const ctx = call(['story', 'context', 'GRA-31', '--json']).value;
  assert.equal(ctx.required_decisions[0].check.kind, 'proposed_pr_open');
  assert.deepEqual(ctx.readiness.reasons.map((r) => r.reason), ['ancestor_discovery_incomplete', 'decision_proposed_pr_open', 'ancestor_discovery_incomplete']);
  // A link whose immediate check cannot run is stored too (exit 1, ok envelope), unchecked with a record.
  const unread = call([...link, '--pr', 'https://github.com/example/lore/pull/10'], { REEVE_FAKE_LINK_CHECK: 'unreadable' });
  assert.deepEqual([unread.status, unread.outcome, unread.value.check.kind, unread.value.version], [1, 'ok', 'unchecked', 3]);
  const after = call(['decision', 'show', '7', '--json']).value;
  assert.deepEqual([after.pr_url, after.check.kind], ['https://github.com/example/lore/pull/10', 'unchecked']);
  assert.ok(call(['story', 'ls', '--epic', 'GRA-20', '--json']).value[0].readiness.reasons.some((r) => r.reason === 'decision_unchecked' && r.decision_id === 7));
  // A merged record (no --pr) the planner cannot find; an unknown decision is not_found.
  assert.equal(call(link).value.check.kind, 'not_found');
  assert.equal(call(['decision', 'show', '7', '--json']).value.pr_url, null);
  assert.equal(call(['decision', 'link', '99', '--record', 'kb/ADR-0002', '--repo', 'lore', '--path', 'p.md', '--json']).code, 'not_found');
});
```

What these distinguish: a fake that shares or drops log lines, that accepts `--brief-file` (the flag the first draft invented), that answers calls without `--json` (or insists it be last), that accepts a create key that is not `<skill>:<KEY>:<run-id>:<n>` or mints a second item for a replayed key, that cannot refuse (exit 2, `REEVE_FAKE_REFUSE`), that invents a `no_record` check kind, that cannot reproduce the conflict and the half-successful link, that forgets a create or an edit on the next show or list (a re-read after the last write would then contradict the writes), that accepts a write naming an epic or initiative nobody created (a guessed key would satisfy a log line), or that has no `story mv` to log a delivery change.

Run: `chmod 755 test/fixtures/reeve-bin/reeve && node --test scripts/__tests__/reeve-fake.test.js` — Expected: 15 passing.

- [ ] **Step 5: The runner**

`test/run-tests.clj` gains four scenario keys and one option; everything else is unchanged.

| Key | Meaning |
|---|---|
| `:requires ["reeve-fake"]` | Runs only when the runner is invoked with `--with reeve-fake`; otherwise printed as `[SKIP]` and not counted. Such a scenario gets `<checkout>/test/fixtures/reeve-bin` first on `PATH` and a fresh empty `REEVE_FAKE_LOG` file for each run (also each `--runs` repeat). |
| `:env {"NAME" "value"}` | Merged last into the child's environment (the link scenario sets `REEVE_FAKE_LINK_CHECK`). |
| `:allowed-tools [...]` | Added to the base allow-list; reeve scenarios add `"Bash(reeve *)"` (`Bash(node *)` is already in the base list). |
| `:log-expects [...]` / `:log-rejects [...]` | Regexes matched, multiline (`(?m)` prepended), against the fake log after the run; failures print as `log: <regex>`. Positive evidence that a command was executed, which a transcript match cannot give. |

Every scenario, fake or not, runs with a fresh empty `REEVE_CONFIG_DIR` and without `REEVE_URL`, `REEVE_TOKEN` and `REEVE_BIN`, so a real `reeve` on the PATH can never reach a server.

Add after `plugin-root`:

```clojure
;; Every scenario runs with an empty REEVE_CONFIG_DIR and without REEVE_URL, REEVE_TOKEN and
;; REEVE_BIN, so a real `reeve` on the PATH can never reach a server. A scenario that requires
;; "reeve-fake" also gets the fake planner first on the PATH and a fresh REEVE_FAKE_LOG, so no two
;; scenarios, repeats or mutation runs share a log. The scenario's own :env is merged last.
(defn scenario-env [{:keys [requires env]}]
  (let [config-dir (str (fs/create-temp-dir {:prefix "reeve-config-"}))
        fake? (some #{"reeve-fake"} requires)
        log (when fake? (str (fs/create-temp-file {:prefix "reeve-fake-" :suffix ".log"})))
        base (-> (into {} (System/getenv))
                 (dissoc "REEVE_URL" "REEVE_TOKEN" "REEVE_BIN")
                 (assoc "REEVE_CONFIG_DIR" config-dir))]
    {:env (merge (cond-> base
                   fake? (assoc "PATH" (str (plugin-root) "/test/fixtures/reeve-bin"
                                            java.io.File/pathSeparator (System/getenv "PATH"))
                                "REEVE_FAKE_LOG" log))
                 env)
     :log log
     :config-dir config-dir}))

(defn log-matches [patterns text]
  (filter #(re-find (re-pattern (str "(?m)" %)) text) patterns))
```

Replace `run-test`:

```clojure
(defn run-test [{:keys [name prompt workdir expects rejects log-expects log-rejects] :as scenario}
                {:keys [workspace-root plugin-dir]}]
  (let [{:keys [env log config-dir]} (scenario-env scenario)]
    (try
      (let [_ (println (colorize :yellow "  Running:") prompt "(context:" workdir ")")
            tools (distinct (concat allowed-tools (:allowed-tools scenario)))
            ;; empty stdin: claude --print otherwise waits 3 s and warns on stderr, after the transcript
            {:keys [out err]} (apply shell {:dir workspace-root :out :string :err :string
                                            :in "" :continue true :env env}
                                     (concat ["claude" "--print" "--permission-mode" "default"
                                              "--allowedTools"] tools
                                             ["--disallowedTools"] disallowed-tools
                                             (when plugin-dir ["--plugin-dir" plugin-dir])
                                             ["--" prompt]))
            output (str out err)
            log-text (if log (slurp log) "")
            missing (concat (filter #(not (re-find (re-pattern %) output)) expects)
                            (map #(str "log: " %)
                                 (remove (set (log-matches log-expects log-text)) log-expects)))
            present (concat (filter #(re-find (re-pattern %) output) (or rejects []))
                            (map #(str "log: " %) (log-matches log-rejects log-text)))]
        {:name name
         :passed (and (empty? missing) (empty? present))
         :missing missing
         :present present
         :output (cond-> output log (str "\n--- reeve fake log ---\n" log-text))})
      (finally
        (fs/delete-tree config-dir)
        (when log (fs/delete-if-exists log) (fs/delete-if-exists (str log ".state")))))))
```

In `-main`, replace the `scenarios` binding and print the skipped ones before running:

```clojure
        with (set (some-> (:with opts) str (str/split #",")))
        runnable? (fn [s] (every? with (:requires s)))
        selected (cond->> (load-scenarios)
                   filter-name (filter #(str/includes? (:name %) filter-name)))
        scenarios (filter runnable? selected)
        skipped (remove runnable? selected)
```

```clojure
                     (doseq [s skipped]
                       (println (colorize :yellow "[SKIP]") (:name s)
                                (str "(requires " (str/join ", " (:requires s))
                                     "; run with --with " (str/join "," (:requires s)) ")")))
```

and the results line becomes `(println (str "\nResults: " passed "/" total " passed" (when (seq skipped) (str ", " (count skipped) " skipped"))))`.

- [ ] **Step 6: Runner self-test scenario**

Append to `test/scenarios.edn`:

```clojure
 {:name "reeve-runner-selftest"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Run `reeve auth status --json` and report the email it printed. Do not ask questions; the answers are given."
  :workdir "."
  :expects ["dan@example\\.com"]
  :log-expects ["^auth status --json$"]}
```

What it distinguishes: the fake not first on the Bash tool's PATH (a shell rc re-prepending `~/.local/bin`, where the real planner, with an empty config, answers `no server url` instead of the fake's `dan@example.com`, and the log stays empty), `Bash(reeve *)` not reaching the child, and a log that is not wired through. (Branch fix round: the selftest ran `reeve --version` until the fake stopped logging `--version`, which the SessionStart hook now also runs.)

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-runner-selftest` — Expected: `[PASS] reeve-runner-selftest`. Then `bb test/run-tests.clj --filter reeve-runner-selftest` — Expected: `[SKIP] reeve-runner-selftest (requires reeve-fake; run with --with reeve-fake)`, `Results: 0/0 passed, 1 skipped`. If the first run fails with `no server url` in the output, the PATH prefix does not reach the Bash tool: stop and report; no reeve scenario is meaningful until it does.

- [ ] **Step 7: test/README.md**

Add a section "Scenarios against the Reeve planner" with the key table from Step 5, the environment pin (every scenario: empty `REEVE_CONFIG_DIR`, no `REEVE_URL`/`REEVE_TOKEN`/`REEVE_BIN`; fake scenarios: the fake first on `PATH`, a fresh `REEVE_FAKE_LOG` per run), the log format (one line per call that passed the fake's validation, argv joined by spaces, newlines flattened; a malformed call is not logged, a valid call the planner refuses is), what the fake answers (the item keys in Step 4: initiatives GRA-12/GRA-13, epics GRA-20/GRA-21 and the standalone GRA-22 (`initiative: null`; codex fix round), decision 7 "Queue or cron" with no record and decision 8 "Match by postcode" closed without one, stories GRA-31/GRA-32 in GRA-20, untriaged GRA-40…GRA-47 (kind `story` with no epic, as the real planner lists them); created items get `GRA-100`, `GRA-101`, … from the state file `$REEVE_FAKE_LOG.state`; creates need `--idempotency-key <skill>:<KEY>:<run-id>:<n>` and replay by key; creates, edits and decision links persist for the run, so every show and list sees them, and readiness is derived for every story in the planner's order, the epic's initiative included; `initiative create` checks the horizon bucket; what the real CLI's parser rejects is a usage error with no envelope; `--version` is not logged, since the SessionStart hook runs it too; a write naming an epic or initiative that does not exist is `not_found` and not logged; `story mv` exists only so a delivery change is logged), `REEVE_FAKE_REFUSE`, `REEVE_FAKE_SIGNIN=expired`, `REEVE_FAKE_LINK_CHECK=unreadable`, and the two commands:

```bash
bb test/run-tests.clj --with reeve-fake --filter reeve-   # the planner scenarios
bb test/run-tests.clj                                     # everything else; reeve-fake scenarios print [SKIP]
```

- [ ] **Step 8: The CLI reference**

`references/reeve-cli.md`, verified against `crates/reeve/src/commands/*.rs` in ~/Source/reeve (2026-10-26):

````markdown
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
````

- [ ] **Step 9: The reference conformance test** (added in the branch fix round)

`scripts/__tests__/reeve-reference.test.js`:

```js
// scripts/__tests__/reeve-reference.test.js — node --test
// Every `reeve … --json` command the reference and the skills write, with its placeholders filled,
// must parse: against the fake always, and against the real CLI when REEVE_REAL_BIN names a
// reeve-planner binary (with an empty config it answers a JSON `internal` "no server url" envelope
// when clap accepted the command, and nothing on stdout when clap refused it).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.join(__dirname, '..', '..');
const SOURCES = ['references/reeve-cli.md', 'skills/planning-initiative/SKILL.md', 'skills/refining-epic/SKILL.md',
  'skills/brainstorming/SKILL.md', 'skills/recording-decisions/actions/link.md', 'skills/recording-decisions/actions/record.md'];
const FAKE = path.join(root, 'test', 'fixtures', 'reeve-bin', 'reeve');
const PLACEHOLDERS = {
  KEY: 'GRA-12', EPIC: 'GRA-20', INITIATIVE: 'GRA-12', 'COVERING-EPIC': 'GRA-20', 'COVERING-INITIATIVE': 'GRA-12',
  'new epic': 'GRA-20', id: '7', 'id-to-be': 'kb/ADR-0002', n: '1', v: '1', version: '1', 'latest version': '1',
  run_id: '0a1b2c3d', key: 'planning-initiative:GRA-12:0a1b2c3d:1', prefix: 'recording-decisions:7', title: 'Title',
  md: 'Brief', text: 'Criterion', email: 'dan@example.com', bucket: 'Later', 'qualified id': 'kb/ADR-0002',
  repo: 'lore', 'path in repo': 'knowledge/adrs/0002-x.md', path: 'knowledge/adrs/0002-x.md', url: 'https://github.com/example/w/pull/9',
  household: '.', dir: '.', branch: 'feat/x', 'the new epic or initiative, its title and where it goes': 'new epic under GRA-13',
};

// `reeve … --json` spans: inline code, and fenced blocks that start with `reeve `.
function commands() {
  const out = [];
  for (const file of SOURCES) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of text.matchAll(/^```\n(reeve [\s\S]*?--json)\n```$/gm)) out.push({ file, cmd: m[1] });
    for (const m of text.replace(/^```[\s\S]*?^```$/gm, '').matchAll(/`(reeve [^`]*?--json)`/g)) out.push({ file, cmd: m[1] });
  }
  return out;
}
// Fill one span into argv: optional groups kept, `a\|b` alternatives take the first, `…` dropped,
// placeholders filled, then split like a shell (single quotes only, as the reference allows).
function argvOf(cmd) {
  let s = cmd.replace(/\\\|/g, '|').replace(/\s*…/g, '').replace(/\[([^\]]*)\]/g, '$1')
    .replace(/(\w+)(?:\|\w+)+/g, '$1').replace(/YYYY-MM-DD/g, '2026-11-15');
  s = s.replace(/<([^<>]+)>/g, (_, name) => {
    assert.ok(name in PLACEHOLDERS, `no value for placeholder <${name}> in: ${cmd}`);
    return PLACEHOLDERS[name];
  });
  const argv = [];
  for (const m of s.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)) argv.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]);
  assert.equal(argv.shift(), 'reeve');
  return argv;
}
function run(bin, argv, env) {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-ref-'));
  const base = { ...process.env, REEVE_CONFIG_DIR: config, REEVE_FAKE_LOG: path.join(config, 'log'), ...env };
  for (const k of ['REEVE_URL', 'REEVE_TOKEN']) delete base[k];
  return spawnSync(bin, argv, { encoding: 'utf8', env: base, timeout: 10_000 });
}
function envelopeOf(r) {
  try { const e = JSON.parse(r.stdout); return e && typeof e.outcome === 'string' ? e : null; } catch { return null; }
}

const all = commands();
test('the reference and the skills write reeve commands', () => {
  assert.ok(all.length >= 25, `found ${all.length}`);
  assert.ok(all.some(({ cmd }) => cmd.startsWith('reeve decision show ')));
});
test('every command parses in the fake planner', () => {
  for (const { file, cmd } of all) {
    const r = run(FAKE, argvOf(cmd));
    assert.ok(envelopeOf(r), `${file}: the fake refused \`${cmd}\`: ${r.stderr.trim()}`);
  }
});
test('every command parses in the real reeve CLI (REEVE_REAL_BIN)', { skip: !process.env.REEVE_REAL_BIN && 'REEVE_REAL_BIN is not set' }, () => {
  const bin = process.env.REEVE_REAL_BIN;
  assert.match(spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout, /^reeve-planner\b/);
  for (const { file, cmd } of all) {
    const r = run(bin, argvOf(cmd));
    assert.ok(envelopeOf(r), `${file}: the real CLI refused \`${cmd}\`: ${r.stderr.trim().split('\n')[0]}`);
  }
});
```

Run: `node --test scripts/__tests__/reeve-reference.test.js` — Expected: 2 pass, 1 skipped. Then build the real CLI (`cargo build -p reeve` in ~/Source/reeve) and run `REEVE_REAL_BIN=~/Source/reeve/target/debug/reeve node --test scripts/__tests__/reeve-reference.test.js` — Expected: 3 pass (branch fix round, `feat/m1-import`: 3/3 over 61 commands). Mutation check: a `--brief-file` flag or a `-`-leading value written into the reference fails it, naming the command.

- [ ] **Step 10: Run and commit**

Run: `node --test scripts/__tests__/*.test.js` — Expected: all pass, including the 7 detector, 20 fake and 3 reference tests (counts as of the branch fix round; Task 1 shipped 5 and 9).

```bash
git add scripts/reeve-detect.js scripts/__tests__/reeve-detect.test.js scripts/__tests__/reeve-fake.test.js scripts/__tests__/reeve-reference.test.js references/reeve-cli.md test/fixtures/reeve-bin/reeve test/run-tests.clj test/README.md test/scenarios.edn
git commit -m "feat(skills): reeve planner detector, cli reference, fake planner and scenario runner support" -m "Task 1 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `planning-initiative`

**Files:**
- Create: `skills/planning-initiative/SKILL.md`, `skills/planning-initiative/reference/brief-template.md`
- Test: `test/scenarios.edn` (scenario `reeve-planning-initiative`)

- [ ] **Step 1: The scenario**

```clojure
 {:name "reeve-planning-initiative"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Plan initiative GRA-12 in Reeve. Do not ask questions; the answers are given. Vision: every mentee has a mentor within one working day. It is for programme coordinators and mentees. Known: coordinators match by hand once a week today. Write the brief from these answers. Open question: whether matching runs from a queue or on a cron schedule; it is a consequential choice that blocks the work, decided by dan@example.com, due 2026-11-15. Draft its record but do not apply it now. Epics: 'Matching queue' (brief: match mentors through a queue), 'Match notifications' (brief: tell mentor and mentee when a match is made) and 'Match reminders' (brief: remind a mentor who has not answered a match within a day). I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the planning-initiative skill" "(?i)researched:" "(?i)run id:? *`?[0-9a-f]{8}" "dan@example\\.com"
            "(?i)no record" "GRA-20" "GRA-1\\d\\d"]
  :rejects ["docs/agent/specs"]
  :log-expects ["^auth status --json$"
                "^initiative show GRA-12 --json$"
                "^decision ls --on GRA-12 --json$"
                "^epic ls --initiative GRA-12 --json$"
                "^initiative edit GRA-12 (?=.*--brief )(?=.*--version 3\\b).*--json$"
                "^decision require (?=.*--on GRA-12\\b)(?=.*--decider dan@example\\.com\\b)(?=.*--due 2026-11-15\\b)(?=.*--idempotency-key planning-initiative:GRA-12:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^comment add (?=.*--decision 1\\d\\d\\b)(?=.*/lore:adr link )(?=.*--idempotency-key planning-initiative:GRA-12:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^epic create (?=.*--initiative GRA-12\\b)(?=.*--title Match notifications )(?=.*--brief )(?=.*--idempotency-key planning-initiative:GRA-12:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^epic create (?=.*--initiative GRA-12\\b)(?=.*--title Match reminders )(?=.*--brief )(?=.*--idempotency-key planning-initiative:GRA-12:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^epic create [^\\n]*--idempotency-key (\\S+) [^\\n]*\\n(?s:.*)^epic create [^\\n]*--idempotency-key (?!\\1 )\\S+ "
                "(?s)planning-initiative:GRA-12:([0-9a-f]{8}):1\\b.*planning-initiative:GRA-12:\\1:2\\b"
                "(?s)^epic create .*^decision ls --on GRA-12 --json$(?!.*^(?:initiative edit|decision require|comment add|epic create) )"
                "(?s)^epic create .*^epic ls --initiative GRA-12 --json$(?!.*^(?:initiative edit|decision require|comment add|epic create) )"]
  :log-rejects ["--brief-file" "^epic edit " "^initiative discovery " "^decision link " "^epic create .*--title Matching queue "]}
```

What each expectation distinguishes: `initiative edit … --version 3` a brief write with a guessed version or a nonexistent flag (`--brief-file` is also rejected outright); `decision require` with decider, due and a run-scoped key a decision created without its decider or with a title-derived key; `comment add --decision 1NN … /lore:adr link` a drafted record left with no route to its link (the id must be the one the fake returned, so an invented id fails); `decision link` rejected, a record applied or linked although the user said not to; `epic ls --initiative GRA-12` read and `epic create … Matching queue` rejected, a skill that ignores the fixture's existing GRA-20 and duplicates it on every run (`GRA-20` expected in the report); the two `epic create` lines with `--brief` and a key a create-then-edit pair (`^epic edit` is rejected) or a missing epic; the distinct-key line (the first epic's key captured whole, the second's must differ) two epics sharing one key, which the planner replays as one; the back-referenced key pair two creates of one run that do not share the run id or do not count up; the two re-reads after the last write (no create or edit follows them) and `no record` a report worded from the skill's memory instead of the planner's state; `GRA-1\d\d` a report naming no created item; `initiative discovery` rejected, a skill that marks discovery on the user's behalf; `Researched:` a skipped research step; `using the planning-initiative skill` a reply produced without the skill; `docs/agent/specs` rejected, a skill that writes a spec. The fake logs a call only after it passed validation, so a malformed call cannot satisfy a log line.

- [ ] **Step 2: Run it, see it fail**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-planning-initiative`
Expected: `[FAIL]` with `using the planning-initiative skill`, `researched:` and the `log:` lines among the missing (no skill exists yet).

- [ ] **Step 3: The skill**

`skills/planning-initiative/SKILL.md`:

````markdown
---
name: planning-initiative
description: Use when the user asks to plan an initiative in the Reeve planner, naming Reeve or an initiative key such as GRA-12 ("plan initiative GRA-12", "discovery for GRA-12 in Reeve"). Not for planning that names neither.
---

# Planning an initiative

Discovery for one initiative in the Reeve planner: its brief, the required decisions with their
deciders and drafted records, and its epics. Everything goes into the planner through the `reeve`
CLI. This skill writes no spec and no plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument.

## The rule

1. **Show, confirm, then write**, as the reference's *Confirmation* says. The request confirms
   only the content it supplies (titles, deciders, due dates, answers). What you composed — the
   rewritten brief, an epic's brief you wrote — needs its own yes, or, in a session that cannot
   ask, a request that names that write ("write the brief from these answers").
2. **One question at a time**, skipping every question the request already answers. In a session
   that cannot ask, a question the request does not answer stops the run with
   `Stopped: missing <what>.` on its own line: nothing after it is written, and the report (step
   10) follows.
3. **Branch on the envelope** as the reference says (`outcome` first, then the exit status). A
   failed read in step 1 stops the run: every later step depends on it. An `unauthenticated` or
   `forbidden` error on any call stops the run: say it and tell the user to run
   `reeve auth login`. Any other refused or failed write skips that one item (that decision,
   comment or epic): show the reasons or the message, go on with the next item, and list what was
   skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record and the discovery mark come from
   the user, never from you.
5. **Build on what is there.** The planner may already hold a brief, decisions and epics for this
   initiative (an earlier run, a teammate). Reuse them; create only what the user's answers add.
   Whether an existing item covers what the user asked for is your judgment in the conversation,
   shown to the user, never a rule applied to titles.

## Steps

0. **Announce and detect.** First say: "Using the planning-initiative skill: everything goes into
   the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
1. **Read.** `reeve initiative show <KEY> --json` (keep `value.brief` and `value.version`),
   `reeve decision ls --on <KEY> --json` and `reeve epic ls --initiative <KEY> --json`. If any of
   them does not answer `ok`, stop the run: for `not_found` say "The planner has no initiative
   <KEY>."; for `unauthenticated` or `forbidden` say it and tell the user to run `reeve auth login`;
   otherwise show the code and message. In parallel, dispatch the **knowledge-reader** with the
   initiative's title and "Prioritise domain context and architecture patterns.", and the
   **architect** in `survey` mode on the repositories the brief or the user names.
2. **Discovery conversation**, following `<plugin-root>/skills/planning-initiative/reference/brief-template.md`:
   the outcome, who it is for, what is known, what is open.
3. **Research.** For each open question from step 2 that research can answer (a library's limits,
   a vendor's API, how others solve the same problem), look it up: web search or documentation
   when the session has them, otherwise the knowledge base and the code. Say what you looked up
   and what it answered in one line, `Researched: <topics and findings>`, or
   `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   lay it out by the template, and show what changes. Write it only on a yes for this brief (rule
   1): `reeve initiative edit <KEY> --brief <md> --version <version> --json`, the Markdown quoted as
   the reference's Arguments section says (single quotes, real newlines, setext headings); keep the
   new `value.version`.
5. **What already exists.** Show the decisions and epics step 1 found, each decision worded by the
   reference (open or closed, as its *Wording the planner's answers* section defines them) and, for each decision and
   epic the user's answers call for, whether an existing one already covers it (say which key or
   id). Steps 6 and 7 create only the ones that are not covered. A re-run on an initiative that
   already has them creates nothing unless the user asks for something new.
6. **Required decisions.** For each open question that is a consequential choice blocking work
   (not a clarification) and has no decision yet: ask who decides and by when (the due date is
   optional: with none given, leave `--due` out), show and run
   `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
   and keep `value.id`. Then, for each decision, one at a time:
   1. Ask once: "Draft the record now, or leave it for <decider>? (they can run `/lore:adr` later
      and link it to #<id>)". Draft at once when the request states the answer or asks for a
      draft. In a session that cannot ask, draft only when the request says so; otherwise leave
      it, and the report says "left for <decider>: run `/lore:adr` and link it to #<id>".
   2. Drafting: invoke **recording-decisions** to draft and show its record: "draft only; do not
      apply; it answers required decision #<id>". Note the record's id-to-be.
   3. Ask whether to apply the record now, or take the answer the request gave. Applying needs an
      interactive session: in one that cannot ask, the report says "not applied: applying needs an
      interactive session".
   4. Yes: have recording-decisions apply it with `Required decision: #<id>`, this run's `bin`
      and `run_id`, the key prefix `planning-initiative:<KEY>` and the next `<n>`; its record
      step 6 links the applied record in the planner.
   5. No: run `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
      so the decision's thread in the planner carries the pointer. Never link or apply a record
      the user did not say to apply.
7. **Epics.** Propose 2–5 epics, each a deliverable slice with a one-paragraph brief, leaving out
   those step 5 found covered; show them, and write the ones confirmed as rule 1 says (epics and
   briefs the request names are confirmed by it); for each
   `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`.
   Each epic gets its own `<n>`.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve initiative discovery <KEY> --complete --version <latest version> --json`.
   No answer in a session that cannot ask leaves discovery open (not a stop: nothing is written).
9. **Re-read.** After the last write, run `reeve decision ls --on <KEY> --json` and
   `reeve epic ls --initiative <KEY> --json` again. The report states what these return, not what
   you remember writing. If a re-read fails, say so and list the writes with their own responses,
   marked unverified.
10. **Report.** Open with the step 0 sentence, then the plain lines `Run id: <run_id>` and the
   `Researched:` line, all unformatted (no bold, so they can be searched for; a non-interactive
   session shows only this report, not the announcement). Then every key written and every
   existing key reused, and every proposal left unwritten; each required decision from the re-read
   with its decider, due date and state worded by the reference ("no record", "proposed, PR open",
   "closed: …"), plus the comment pointer when the record is only drafted; each epic from the
   re-read. End with the next step: "refine an epic with refining-epic".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments and epics: every
create takes the next number, and a retry of the same create reuses its number.
````

`skills/planning-initiative/reference/brief-template.md`:

````markdown
# Initiative brief

The headings are the team's convention, not planner fields: the planner stores the brief as one
Markdown text. Headings are written in setext form (the title underlined with `---`), never with
a leading `#`, so the brief passes as one quoted argument (`<plugin-root>/references/reeve-cli.md`,
Arguments).

Vision
------
What changes, and for whom, when this is done. Two or three sentences.

Capabilities
------------
What people will be able to do, one bullet each.

Known knowns
------------
What the team already knows: facts, constraints, earlier attempts, each with where it can be checked.

Open questions
--------------
What is still open. A consequential choice that blocks work becomes a required decision (step 6);
a clarification stays here.
````

- [ ] **Step 4: Run it, see it pass**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-planning-initiative` — Expected: `[PASS]`.

- [ ] **Step 5: Mutation check**

Empty the body of `skills/planning-initiative/SKILL.md` below the frontmatter and run Step 4's command. Expected: `[FAIL]` with `using the planning-initiative skill`, `researched:`, the `comment add` line and the post-write re-reads among the missing (a model without the skill may still write the brief and the epics, so those lines are not the margin). Restore with `git checkout -- skills/planning-initiative/SKILL.md` (or re-save the Step 3 text if not yet committed).

- [ ] **Step 6: Commit**

```bash
git add skills/planning-initiative test/scenarios.edn
git commit -m "feat(skills): planning-initiative drives discovery, briefs, required decisions and epics in reeve" -m "Task 2 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `refining-epic`

**Files:**
- Create: `skills/refining-epic/SKILL.md`
- Test: `test/scenarios.edn` (scenario `reeve-refining-epic`)

- [ ] **Step 1: The scenario**

```clojure
 {:name "reeve-refining-epic"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Refine epic GRA-20 in Reeve. Do not ask questions; the answers are given. Done looks like: every match request is processed from the queue within an hour. Boundary: no change to mentor profiles. Update the epic's brief with these answers. No new required decisions. Stories: 'Enqueue match requests' with criteria 'a new request is on the queue within a minute' and 'a repeated request is enqueued once'; 'Process the match queue' with criteria 'each queued request gets a match or a reason within an hour' and 'requests are processed oldest first'; 'Alert on a stuck queue' with criteria 'an alert fires when the oldest request is over two hours old' and 'the alert names the stuck request'. Place every untriaged story with the placement tree, except GRA-46, which we won't do; you may create the new epics and the new initiative the tree proposes for GRA-43, GRA-44 and GRA-45; the horizon buckets are Now, Next, Later, Won't do. I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the refining-epic skill" "(?i)researched:" "(?i)run id:? *`?[0-9a-f]{8}"
            "#7\\W+Queue or cron" "discovery not complete on GRA-20"
            "GRA-42\\b(?:(?!GRA-(?!20\\b)\\d)[\\s\\S]){0,400}discovery not complete on GRA-20"
            "(?i)GRA-40[^\\n]{0,200}\\bbug\\b" "(?i)GRA-41[^\\n]{0,200}\\bchore\\b" "(?i)GRA-42[^\\n]{0,200}this epic"
            "(?i)GRA-43[^\\n]{0,200}new epic under GRA-13" "(?i)GRA-45[^\\n]{0,200}new epic under GRA-12"
            "(?i)GRA-44[^\\n]{0,200}new initiative" "(?i)GRA-46[^\\n]{0,200}won.?t do"
            "(?i)GRA-47[^\\n]{0,200}left untriaged"]
  :rejects ["docs/agent/specs" "(?i)#8\\W+Match by postcode\\W+\\(?no record"]
  :log-expects ["^auth status --json$"
                "^epic show GRA-20 --json$"
                "^initiative show GRA-12 --json$"
                "^decision ls --on GRA-20 --json$"
                "^story ls --untriaged --json$"
                "^epic edit GRA-20 (?=.*--brief )(?=.*--version 2\\b).*--json$"
                "^story create (?=.*--epic GRA-20\\b)(?=.*--title Enqueue match requests )(?=.*--criterion .*--criterion )(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^story create (?=.*--epic GRA-20\\b)(?=.*--title Process the match queue )(?=.*--criterion .*--criterion )(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^story create (?=.*--epic GRA-20\\b)(?=.*--title Alert on a stuck queue )(?=.*--criterion .*--criterion )(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^story create [^\\n]*--idempotency-key (\\S+) [^\\n]*\\n(?s:.*)^story create [^\\n]*--idempotency-key (?!\\1 )(\\S+) [^\\n]*\\n(?s:.*)^story create [^\\n]*--idempotency-key (?!\\1 |\\2 )\\S+ "
                "(?s)refining-epic:GRA-20:([0-9a-f]{8}):1\\b.*refining-epic:GRA-20:\\1:2\\b"
                "^story edit GRA-40 (?=.*--kind bug\\b)(?=.*--epic GRA-20\\b)(?=.*--version 1\\b).*--json$"
                "^story edit GRA-41 (?=.*--kind chore\\b).*--json$"
                "^story edit GRA-42 (?=.*--epic GRA-20\\b).*--json$"
                "^epic create (?=.*--initiative GRA-13\\b)(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^story edit GRA-43 (?=.*--epic GRA-1\\d\\d\\b).*--json$"
                "^epic create (?=.*--initiative GRA-12\\b)(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^story edit GRA-45 (?=.*--epic GRA-1\\d\\d\\b).*--json$"
                "^initiative create (?=.*--horizon Later\\b)(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "^epic create (?=.*--initiative GRA-1\\d\\d\\b).*--json$"
                "^story edit GRA-44 (?=.*--epic GRA-1\\d\\d\\b).*--json$"
                "^comment add (?=.*--story GRA-47\\b)(?=.*Proposed home)(?=.*--idempotency-key refining-epic:GRA-20:[0-9a-f]{8}:\\d+\\b).*--json$"
                "(?s)^story create .*^story ls --epic GRA-20 --json$(?!.*^(?:epic edit|story create|story edit|epic create|initiative create|epic discovery|decision require|comment add) )"
                "(?s)^story edit .*^decision ls --on GRA-20 --json$(?!.*^(?:epic edit|story create|story edit|epic create|initiative create|epic discovery|decision require|comment add) )"]
  :log-rejects ["--brief-file" "^story edit GRA-42 .*--kind" "^story edit GRA-45 .*--epic GRA-20\\b" "^story (?:edit|mv) GRA-46 "
                "^story (?:edit|mv) GRA-47 " "(?s)^initiative create .*^initiative create "
                "^story mv " "^epic discovery " "^decision require " "^decision link "
                "^story create .*--title (?:Retry failed matches|Show match history) "
                "(?s)^(\\w+ create)\\b[^\\n]*--idempotency-key (\\S+) .*^(?!\\1\\b)\\w+ create\\b[^\\n]*--idempotency-key \\2 "]}
```

What each expectation distinguishes: the three `story create` lines a story without criteria, outside the epic or with a title-derived key; the three-way distinct-key line two stories sharing a key (the planner would replay the first and lose the second); the `:1 … :2` back-reference a counter that does not start at 1 or a run id that changes mid-run, and the log-reject on one key used by two different `… create` commands a per-kind counter (stories `:1–3`, epics `:1–2`: the epic create would replay the story); the seven placements one branch of the placement tree each — GRA-40 (broken behaviour → bug under the covering epic), GRA-41 (internal work → chore), GRA-42 (a queue story GRA-20 covers; a `--kind` on it is rejected), GRA-43 (covered by initiative GRA-13 but none of its epics → new epic there), GRA-45 (covered by GRA-12, the refined epic's own initiative, but not by the queue epic → new epic under GRA-12, and `--epic GRA-20` on it rejected: the counter-example to "covers"), GRA-44 (covered by nothing → new initiative in `Later`, the last bucket before "Won't do", plus an epic under it) and GRA-46 (won't do: any `story edit` or `story mv` on it rejected); a skill that only offers "this epic or leave it" fails five of them, and since the fake refuses (unlogged) a write naming an epic nobody created, a guessed `--epic GRA-1xx` satisfies nothing; the transcript lines naming each placement's branch a report that lists writes without the tree; the `story ls --epic` and `decision ls --on` reads pinned after the last write a report quoting a listing that later writes made stale; the transcript's "#7 … Queue or cron", "discovery not complete on GRA-20" and GRA-42 followed by that reason (GRA-42 gets it only after its move) a readiness summary invented, copied from the skill or the reference, or read before the placements, rather than quoted from the planner's answer after the last write; the announce line and `^--version$` a skill that skips step 0; `epic edit … --version 2` a guessed version; `decision require`, `decision link`, `epic discovery` and `story mv` rejected, a skill that creates decisions, links records, marks discovery or moves delivery the user did not ask for; a `story create` for the fixture's GRA-31/GRA-32 rejected, a skill that recreates existing stories. The `--brief-file` reject cannot fire (the fake does not log an invalid call); it documents the flag the first draft invented.

A standalone epic (codex fix round): the fake's `GRA-22` has `initiative: null`, which the planner allows. Appended after `reeve-refining-epic`:

```clojure
 {:name "reeve-refining-epic-standalone"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Refine epic GRA-22 in Reeve. Do not ask questions; the answers are given. Done looks like: a mentee rates a session within a day of it ending. Boundary: no change to mentor profiles. Update the epic's brief with these answers. No new required decisions. Stories: 'Rate a session' with criteria 'a mentee can rate a finished session from one to five' and 'a mentee rates a session at most once'. Leave the untriaged stories untriaged. I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the refining-epic skill" "(?i)run id:? *`?[0-9a-f]{8}" "GRA-1\\d\\d"]
  :rejects ["(?im)^\\W*Stopped" "(?i)planner has no (?:epic|initiative)"]
  :log-expects ["^epic show GRA-22 --json$"
                "^decision ls --on GRA-22 --json$"
                "^epic edit GRA-22 (?=.*--brief )(?=.*--version 1\\b).*--json$"
                "^story create (?=.*--epic GRA-22\\b)(?=.*--title Rate a session )(?=.*--criterion .*--criterion )(?=.*--idempotency-key refining-epic:GRA-22:[0-9a-f]{8}:\\d+\\b).*--json$"
                "(?s)^story create .*^story ls --epic GRA-22 --json$"]
  :log-rejects ["^initiative show " "^story edit " "^epic discovery " "^decision require " "^epic create " "^initiative create "]}
```

It distinguishes a skill that reads the initiative unconditionally (`initiative show` is rejected; the failed read would stop the run before the brief, so `epic edit` and `story create` would be missing and the transcript would say "Stopped" or "The planner has no initiative") from one that reads it only when `value.initiative` is set and goes on with the epic's own context.

- [ ] **Step 2: Run it, see it fail**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-refining-epic` — Expected: `[FAIL]`. Without the skill a model that finds `references/reeve-cli.md` gets most of the way; the run that built this task missed the announce line and the placement of the original GRA-42 ("Mentees can pause matching for a month"), which it put in a new initiative. The fixture now titles GRA-42 as a plain queue story and adds GRA-45 as the counter-example, so the skill's one-sentence definition of "covers" is tested both ways.

- [ ] **Step 3: The skill**

`skills/refining-epic/SKILL.md`:

````markdown
---
name: refining-epic
description: Use when the user asks to refine an epic in the Reeve planner or to place its untriaged stories, naming Reeve or an epic key such as GRA-20 ("refine epic GRA-20", "break GRA-20 into stories", "triage the untriaged stories in Reeve"). Not for breaking work down when the request names neither.
---

# Refining an epic

Epic-level discovery in the Reeve planner, its required decisions, stories that one person or one
agent session can finish (kb/ADR-0002 R1) with acceptance criteria, and a home for every untriaged
story. Everything goes into the planner through the `reeve` CLI. This skill writes no spec and no
plan (kb/ADR-0005 R4).

The plugin root is `${CLAUDE_PLUGIN_ROOT}`; below it is `<plugin-root>`, written out as an absolute
path in every Bash command. Read `<plugin-root>/references/reeve-cli.md` before the first `reeve`
call: commands, flags, exit statuses, idempotency keys and wording come from there. Invoke
`${REEVE_BIN:-reeve}` as that reference says: the detector's `bin` as the first word. Every
command below is copied from the reference, flags in the order shown and `--json` the last
argument; a brief or a criterion is one single-quoted argument as the reference's Arguments
section says.

## The rule

1. **Show, confirm, then write**, as the reference's *Confirmation* says. The request confirms
   only the content it supplies (titles, criteria, deciders, due dates, a home the user named).
   What you composed — the rewritten brief, a home you chose, a new epic or initiative with its
   title, brief and horizon — needs its own yes, or, in a session that cannot ask, a request that
   names that write ("place the untriaged stories", "create the new epic for GRA-43").
2. **One question at a time**, skipping every question the request already answers. In a session
   that cannot ask, a question the request does not answer stops the run with
   `Stopped: missing <what>.` on its own line: nothing after it is written, and the report (step
   10) follows.
3. **Branch on the envelope** as the reference says (`outcome` first, then the exit status). A
   failed read in step 1 stops the run: every later step depends on it. An `unauthenticated` or
   `forbidden` error on any call stops the run: say it and tell the user to run
   `reeve auth login`. Any other refused or failed write skips that one item (that story,
   placement, decision or comment): show the reasons or the message, go on with the next item,
   and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record, a story's home and the discovery
   mark come from the user, never from you; you propose.
5. **Build on what is there.** The planner may already hold a brief, decisions and stories for
   this epic. Reuse them; create only what the user's answers add. Whether an existing item covers
   what the user asked for is your judgment in the conversation, shown to the user, never a rule
   applied to titles.
6. **Readiness is the planner's.** Report what `story ls` returns after the last write, in the
   reference's words; never judge readiness yourself (kb/ADR-0003 R1).

## Steps

0. **Announce and detect.** First say: "Using the refining-epic skill: everything goes into the
   Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
   **No epic named** (for example "triage the untriaged stories"): run
   `reeve story ls --untriaged --json`, show the stories, say that this skill works on one epic,
   ask which epic to refine (or which epic a story should go to), and stop until the user
   answers. In a session that cannot ask, end with `Stopped: missing the epic key.` Never pick an
   epic yourself.
1. **Read.** `reeve epic show <EPIC> --json` (keep `value.brief`, `value.version` and
   `value.initiative`), then `reeve initiative show <INITIATIVE> --json` only when
   `value.initiative` is not null (a standalone epic has no initiative: skip that read and go on
   with the epic's own context), `reeve decision ls --on <EPIC> --json`,
   `reeve story ls --epic <EPIC> --json`, `reeve story ls --untriaged --json`,
   `reeve epic ls --json` and `reeve initiative ls --json`. If any of them does not answer `ok`,
   stop the run: for `not_found` say "The planner has no epic <EPIC>." (or the item it names);
   for `unauthenticated` or `forbidden` say it and tell the user to run `reeve auth login`;
   otherwise show the code and message. In parallel, dispatch the **knowledge-reader** with the
   epic's title and "Prioritise domain context and architecture patterns.", and the **architect**
   in `survey` mode on the repositories the brief or the user names.
2. **Discovery conversation.** One question at a time: what done looks like, the boundaries, what
   is unknown.
3. **Research.** For each open question from step 2 that research can answer, look it up: web
   search or documentation when the session has them, otherwise the knowledge base and the code.
   Say what you looked up and what it answered in one line, `Researched: <topics and findings>`,
   or `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   and show what changes. Write it only on a yes for this brief (rule 1):
   `reeve epic edit <EPIC> --brief <md> --version <version> --json`; keep the new `value.version`.
5. **Required decisions.** Show the decisions step 1 found, worded by the reference; the open
   ones (as its *Wording the planner's answers* section defines them; a closed decision never is)
   go into the report. Only for a consequential choice the user names that blocks work and has no
   decision yet: ask who decides and by when (the due date is optional: with none given, leave
   `--due` out), show and run
   `reeve decision require --on <EPIC> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   Then ask once: "Draft the record now, or leave it for <decider>?"; draft at once when the
   request states the answer or asks for a draft, and in a session that cannot ask only when the
   request says so (otherwise the report says "left for <decider>: run `/lore:adr` and link it to
   #<id>"). To draft, invoke **recording-decisions** ("draft only; do not apply; it answers
   required decision #<id>"). Apply it only when the user says so, in a session that can ask
   (recording-decisions applies it with `Required decision: #<id>`, this run's `bin` and `run_id`,
   the key prefix `refining-epic:<EPIC>` and the next `<n>`); otherwise run
   `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   When the user says there are no new required decisions, create none.
6. **Stories.** Propose stories, each finishable by one person or one agent session, each with
   2–6 acceptance criteria written as observable outcomes, leaving out what an existing story
   from step 1 already covers (say which key). Show them, and write the ones confirmed as rule 1
   says (stories and criteria the request names are confirmed by it); for each
   `reeve story create --epic <EPIC> --title <title> --kind story --criterion <text> --criterion <text> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
   one `--criterion` per criterion.
7. **Placement tree.** For each story from `story ls --untriaged`, classify it, propose its home
   with the branch that led there, and write it on a confirmation as rule 1 says ("place the
   untriaged stories" names the `story edit`s; `<v>` is the story's `version` from the listing;
   covering epics and initiatives come from `epic ls` and `initiative ls`):
   - **Broken behaviour** → a bug under the epic that covers the broken feature:
     `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --kind bug --json`
     (no covering epic: `--kind bug` alone).
   - **Internal work** (an upgrade, a refactor, tooling; nothing a user sees) → a chore:
     `reeve story edit <KEY> --version <v> --kind chore --json` (add `--epic` when one covers it).
   - **Product change**, the first that applies, with no `--kind` (it stays a story). An epic
     covers a story when the story changes the feature that epic delivers, even if its brief does
     not name the change yet.
     1. an epic covers it (this one, or one from `epic ls`):
        `reeve story edit <KEY> --version <v> --epic <COVERING-EPIC> --json`;
     2. else an initiative covers it, but none of its epics does: a new epic under it,
        `reeve epic create --initiative <COVERING-INITIATIVE> --title <title> --brief <md> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
        then `reeve story edit <KEY> --version <v> --epic <new epic> --json`;
     3. else a new initiative, proposed in the last horizon bucket before "Won't do":
        `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
        an epic under it as in 2, then the `story edit`. The CLI does not list the buckets: ask for
        them (offering the horizons seen in `initiative ls`), or take them from the request.

     For 2 and 3, show the proposed title, brief (and horizon) and create them only on a
     confirmation for that story; in a session that cannot ask, only when the request names that
     create. Otherwise create nothing for it and leave it untriaged with the proposal:
     `reeve comment add --story <KEY> --body 'Proposed home: <the new epic or initiative, its title and where it goes>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   - **Won't do**, or the user says "leave it untriaged": write nothing for it.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve epic discovery <EPIC> --complete --version <latest version> --json`.
   No answer in a session that cannot ask leaves discovery open (not a stop: nothing is written).
9. **Re-read.** After the last write (the discovery mark, or the last placement when there is
   none), run `reeve story ls --epic <EPIC> --json`, `reeve decision ls --on <EPIC> --json` and
   `reeve story ls --untriaged --json`. Completing discovery and placing stories change the
   readiness reasons, so these are the last reads of the run and the only ones the report quotes.
   If a re-read fails, say so and list the writes with their own responses, marked unverified.
10. **Report.** Open with the step 0 sentence, then the plain lines `Run id: <run_id>` and the
   `Researched:` line, all unformatted (no bold, so they can be searched for; a non-interactive
   session shows only this report, not the announcement). Then:
   - every key written and every existing key reused, and every item skipped with its reason;
   - each placement on one line: the story's key, its title and its branch, named `bug`,
     `chore`, `this epic`, `another epic <KEY>`, `new epic under <INITIATIVE>`,
     `new initiative`, `won't do` or `left untriaged` (with the proposed home, when there is one);
   - the open required decisions from the re-read, worded by the reference;
   - each story of the epic from the re-read on one line: its key, its title, and "ready" or
     "blocked:" followed by every one of the planner's reasons, worded by the reference's table.
     Write each story's reasons out in full on its own line, even when stories share them; never
     abbreviate them as "the shared reasons" or "as above".
   End with the next step: "pick a ready story and brainstorm it".

`<n>` is one counter for the whole run, from 1, shared by decisions, comments, stories, epics and
initiatives: every create takes the next number, and a retry of the same create reuses its number.
````

- [ ] **Step 4: Run it, see it pass**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-refining-epic` — Expected: `[PASS]`.

- [ ] **Step 5: Mutation check**

Empty the body of `skills/refining-epic/SKILL.md` below the frontmatter, run Step 4's command. Expected: `[FAIL]`, with every `story create`, the placement lines, the re-reads after the last write and the quoted readiness reasons among the missing. Restore.

- [ ] **Step 6: Commit**

```bash
git add skills/refining-epic test/scenarios.edn test/fixtures/reeve-bin/reeve scripts/__tests__/reeve-fake.test.js
git commit -m "feat(skills): refining-epic writes stories with criteria and places untriaged work in reeve" -m "Task 3 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: brainstorming reads the story context first

**Files:**
- Modify: `skills/brainstorming/SKILL.md`, `skills/writing-plans/SKILL.md`
- Modify: `test/run-tests.clj` (empty stdin, Task 1's `run-test`)
- Test: `test/scenarios.edn` (scenarios `reeve-brainstorming-without-planner`, `reeve-brainstorming-no-story-key`, `reeve-brainstorming-story-context`, `reeve-brainstorming-story-key-without-planner`; the last is appended at the end of the file)

- [ ] **Step 1: The baseline, before the planner edits**

`origin/main` has no brainstorming scenario, so the planner-absent baseline is added first; it passes once the announce line (the first edit of Step 3) is in, and fails on the skill with its body emptied. It deliberately carries no `:requires`: it runs in the plain suite and in the `--filter reeve-` run alike, always without the fake (with the runner's empty `REEVE_CONFIG_DIR`, a real `reeve` on the PATH is signed out).

```clojure
 {:name "reeve-brainstorming-without-planner"
  :prompt "/lore:brainstorming add a retry policy for failed payment webhooks"
  :workdir "."
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "\\?" "(?i)payment"]
  :rejects ["(?i)reeve|planner|story context" "docs/agent/specs/"]}
```

What it distinguishes: a step 0 that leaks into sessions with no story (planner talk in the transcript), and a broken hard gate (a spec path before any clarifying question). The announce sentence is the line the skill itself prints at its start (added in Step 3); it is absent from the unmodified skill, so a generic reply with no skill behind it cannot satisfy this scenario.

Order of work for this step: add the announce line to `skills/brainstorming/SKILL.md` first (Step 3's first edit, nothing else yet), run: `bb test/run-tests.clj --filter reeve-brainstorming-without-planner` — Expected: `[PASS]`. Then the mutation check, written down here because it is what makes the scenario worth keeping: empty the body of `skills/brainstorming/SKILL.md` below the frontmatter, run the same command — Expected: `[FAIL]` (the announce sentence missing); restore.

- [ ] **Step 2: The planner scenarios**

```clojure
 {:name "reeve-brainstorming-no-story-key"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:brainstorming add a retry policy for failed payment webhooks, signed with SHA-256"
  :workdir "."
  :expects ["\\?"]
  :rejects ["(?i)reeve|story context"]
  :log-rejects ["."]}

 {:name "reeve-brainstorming-story-context"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:brainstorming add a retry policy for story GRA-31. The answers are given: retries cover failed matches only, at most three attempts. Stop after presenting the project context, including the open required decisions, and your first clarifying question."
  :workdir "."
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "(?s)\\A[^?]*Queue or cron.*\\?" "(?i)open required decision #7\\W+Queue or cron\\W+\\(no record\\)"]
  :rejects ["docs/agent/specs/"]
  :log-expects ["^auth status --json$" "^story context GRA-31 --json$"]}

 {:name "reeve-brainstorming-story-key-without-planner"
  :prompt "/lore:brainstorming add a retry policy for story GRA-31"
  :workdir "."
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "\\?"]
  :rejects ["(?i)reeve|planner|story context|not available|signed out" "docs/agent/specs/"]}
```

What they distinguish: `story-context` also fixes the order, with the decision's title (the fixture's "Queue or cron") in the transcript before the first question mark and a question after it; the announce sentence is required in all of them but `no-story-key`, so an empty skill body fails each of those (branch fix round: `no-story-key` no longer asserts it, m9; its claim is the empty log, and the one run in three that omitted the sentence was not a defect of that claim). `no-story-key` (the log must stay empty; the prompt carries `SHA-256`, a `<PREFIX>-<n>` token that is not a story) a planner read that runs on every brainstorming session or on any key-shaped token; `story-context` a skill that does not read the bundle (log), reads it but does not list the open decision in the skill's own line ("open required decision #7 — Queue or cron (no record)"), or misreads `check.kind: unchecked` as satisfied instead of deriving "no record" from `record: null`; `story-key-without-planner` (no `:requires`, so no fake and no planner) a planner read that, with the planner absent, talks about it ("not available", "signed out") instead of skipping silently. `story-key-without-planner` is appended at the end of `test/scenarios.edn`.

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-brainstorming` — Expected: `no-story-key`, `without-planner` and `story-key-without-planner` pass, `story-context` fails (`log: ^story context GRA-31 --json$` missing).

- [ ] **Step 3: The edit**

In `skills/brainstorming/SKILL.md`, first add these lines at the very start of the body, under the title, before *Checklist* (and before the HARD-GATE block), exactly:

```markdown
Announce at the start: "Using the brainstorming skill: no code until the design is approved."
The message that ends your first turn opens with the same sentence, since a non-interactive
session shows only that message.
```

`claude --print` shows only the final message, so the announce alone never reaches the transcript (the baseline failed with it alone). No layout rule follows it: the message's shape stays as on `origin/main` (kb/ADR-0005 R1). The runner feeds `claude` an empty stdin (`:in ""` in Task 1's `run-test`): otherwise, with a non-terminal stdin, `claude` waits 3 s and appends "Warning: no stdin data received in 3s" to stderr, after the transcript. Run Step 1's mutation check now, then continue. Then insert, directly above `## Checklist`, a section that is not a checklist item (so no session without a story gets a task for it):

```markdown
## Planner Context

When the request presents a story key as the story it is for ("story GRA-31", "for GRA-31",
"GRA-31: …", or a key that opens the request), read the planner before the checklist. Never for
any other `<PREFIX>-<n>` token, such as UTF-8, SHA-256 or ISO-8601; with no story key, create no
task for this and say nothing about it. Run `node <plugin-root>/scripts/reeve-detect.js`
(`<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}`, written out as an absolute path). Unless it prints
`"present":true` and `"signed_in":true`, this section ends here and leaves no trace: your reply
never mentions the planner, the detector, a sign-in or a story lookup (not even that the story
could not be loaded), and reads exactly as it would if the planner did not exist. Otherwise
read `<plugin-root>/references/reeve-cli.md` and run `reeve story context <KEY> --json` (the
detector's `bin` as the first word). If it does not answer `ok`, say so in one line (the planner
has no story <KEY>, and an epic or initiative key is not a story; for an `unauthenticated` or
`forbidden` error, run `reeve auth login`) and go on with checklist item 1 without planner
context. On `ok`, the story's title, description and criteria, the initiative and epic briefs,
the required decisions, the blockers and the comments are project context for item 1.
```

Append to item 1 (after "…rather than quietly violate it."):

```markdown
   With a planner bundle (*Planner Context*), list each open required decision among the binding
   decisions as "open required decision #<id> — <title> (<status>)". Open is as the CLI
   reference's *Wording the planner's answers* defines it (not closed, not accepted); word the
   status as that section says. The design either waits for it or decides it now; then step 5
   drafts its record.
```

Open is defined as in refining-epic (`record: null`), widened to any status other than accepted, worded by the reference's table.

Append to item 5:

```markdown
   For a record that answers an open required decision, tell recording-decisions which one
   ("it answers required decision #<id>").
```

Append to item 6:

```markdown
   Under each proposed record that answers a required decision, add a line
   `Required decision: #<id>` outside the fenced record text (no item key is ever written into a
   record, kb/ADR-0004 R3), so whoever applies it later links it.
```

Append to item 9:

```markdown
   When applying a stored draft, pass its `Required decision: #<id>` line to recording-decisions;
   its record step 6 links the applied record in the planner.
```

In the *Process Flow* graph, add the node `"Read planner context (story named, planner present)" [shape=box];` first and the edge `"Read planner context (story named, planner present)" -> "Explore project context";`.

Every other line of the skill is unchanged apart from the announce lines: the HARD-GATE, the anti-pattern section, items 2–4, 7–8, *The Process*, *After the Design* and *Key Principles* (kb/ADR-0005 R4).

In `skills/writing-plans/SKILL.md`, the low-tier bullet "**Low tier** drafts alone become the ride-along apply task: copy each one into the plan," becomes "**Low tier** drafts alone become the ride-along apply task: copy each one into the plan, with its `Required decision: #<id>` line when the spec has one,". Without it, a low-tier draft that answers a required decision loses its id between the spec and the apply. In the same bullet, the scheduled apply task "applies it via the **recording-decisions** skill as a ride-along" becomes "applies it via the **recording-decisions** skill (passing its `Required decision: #<id>` line, when it has one) as a ride-along", so the executor, who never reads brainstorming item 9, hands the id on.

- [ ] **Step 4: Run, see all four pass**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-brainstorming` — Expected: 4 `[PASS]`. Then without `--with` (`without-planner` and `story-key-without-planner` run, the other two are skipped): 2 `[PASS]`.

- [ ] **Step 5: Mutation check**

Delete the *Planner Context* section and the item-1 addition, run Step 4's command. Expected: `reeve-brainstorming-story-context` fails (the open-decision line missing) and `reeve-brainstorming-story-key-without-planner` fails (the planner is talked about); the other two still pass. Restore. Delete only the item-1 addition and run `story-context`: it fails on the open-decision line. Restore. Then empty the whole body below the frontmatter, run Step 4's command. Expected: all four fail (no announce sentence). Restore.

- [ ] **Step 6: Commit**

```bash
git add skills/brainstorming skills/writing-plans test/scenarios.edn test/run-tests.clj
git commit -m "feat(skills): brainstorming reads the reeve story context when a story is named and the planner is present" -m "Task 4 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md. The hard gate and every existing step are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: recording-decisions triages process records and links records to required decisions

**Files:**
- Create: `skills/recording-decisions/actions/link.md`
- Modify: `skills/recording-decisions/SKILL.md`, `skills/recording-decisions/actions/record.md`, `test/fixtures/reeve-bin/reeve` and `scripts/__tests__/reeve-fake.test.js` (an idempotency key's `<KEY>` may be a decision id; mirrored in Task 1)
- Test: `test/scenarios.edn` (new `command-adr-triages-process-decision`, `reeve-adr-link-proposed`, `reeve-adr-link-check-unreadable`, `reeve-adr-link-ride-along`, `reeve-adr-link-headless-missing-input`; the existing `command-adr-new-triages-and-interviews` gains a reject)

- [ ] **Step 1: The scenarios**

The triage scenario is planner-independent (the triage change is unconditional, kb/ADR-0004 R5), so it is a plain `command-adr-…` scenario without `:requires`:

```clojure
 {:name "command-adr-triages-process-decision"
  :prompt "/lore:adr We decided to hold retrospectives every two weeks instead of every week. Interview answers: decided by Dan Doe; it affects only the backend repo, where the process doc is backend:docs/process/retrospectives.md; easy to undo (two-way); no security, privacy, billing, legal or contract sensitivity; the alternative was weekly retrospectives, dropped because they took time from delivery; it keeps being re-debated and I want a record. Do not ask me questions. Stop after presenting the draft: do not write files, branch, or open a PR."
  :workdir "."
  :expects ["backend/ADR-0002" "(?i)low[- ]tier" "docs/process/retrospectives\\.md"]
  :rejects ["(?i)meeting notes|in an RFC" "Accepted \\d{4}-\\d{2}-\\d{2} by"]}
```

What it distinguishes: the old step 3, which sends "a decision with no code behind it (a tool, a process)" to "an RFC or meeting notes", from the new one, which drafts it as a low-tier record whose `scope` names the document it governs.

In the existing `command-adr-new-triages-and-interviews`, add `"(?i)meeting notes|in an RFC"` to `:rejects` (an architectural decision must never be sent there either; `rfc:` in the drafted front matter does not match).

```clojure
 {:name "reeve-adr-link-proposed"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:adr link kb/ADR-0002 to decision 7 in Reeve. Do not ask questions; the answers are given: the planner calls this repository lore, and the PR proposing the record is https://github.com/example/test-workspace/pull/9."
  :workdir "."
  :expects ["proposed, PR open"]
  :rejects ["(?i)could not run"]
  :log-expects ["^decision show 7 --json$"
                "^decision link 7 (?=.*--record kb/ADR-0002\\b)(?=.*--repo lore\\b)(?=.*--path knowledge/adrs/0002-inventory-reservation\\.md\\b)(?=.*--pr https://github\\.com/example/test-workspace/pull/9\\b)(?=.*--household /\\S)(?!.*--household (?:\\.|\\S*/(?:lore|backend)\\b)).*--json$"]}

 {:name "reeve-adr-link-check-unreadable"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :env {"REEVE_FAKE_LINK_CHECK" "unreadable"}
  :prompt "/lore:adr link kb/ADR-0002 to decision 7 in Reeve. Do not ask questions; the answers are given: the planner calls this repository lore, the PR proposing the record is https://github.com/example/test-workspace/pull/9, and the household is the current directory."
  :workdir "."
  :expects ["(?i)linked; the check could not run here" "(?i)next scheduled check"]
  :rejects ["(?i)nothing was linked|link failed"]
  :log-expects ["^decision link 7 (?=.*--record kb/ADR-0002\\b)(?=.*--repo lore\\b).*--json$"]}
```

The record is the fixture's existing `lore/knowledge/adrs/0002-inventory-reservation.md` (`id: kb/ADR-0002`): the inline knowledge base `lore` is a directory of the household, so the path inside the repository is `knowledge/adrs/0002-inventory-reservation.md`. No fixture file is added (a new `kb/ADR-0003` would change the next number other scenarios expect). No git, gh or apply is needed.

```clojure
 {:name "reeve-adr-link-ride-along"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:adr link backend/ADR-0002 to decision 7 in Reeve. Do not ask questions; the answers are given: the record rides along on branch feat/retry in the backend repository, staged and not committed, at docs/adr/0002-payment-webhook-retries.md; there is no PR yet; the planner calls this repository backend; the household is the current directory."
  :workdir "."
  :expects ["(?i)rides along on branch feat/retry" "/lore:adr link backend/ADR-0002 to decision 7" "once the implementing PR is open"]
  :rejects ["(?i)linked:"]
  :log-expects ["^comment add (?=.*--decision 7\\b)(?=.*rides along on branch feat/retry)(?=.*/lore:adr link backend/ADR-0002 to decision 7\\b)(?=.*--idempotency-key \\S+:7:[0-9a-f]{8}:\\d+\\b).*--json$"]
  :log-rejects ["^decision link "]}
```

It starts after the apply: a scenario runs under `claude --print`, where rule 3 forbids the record write itself (the model refuses it, and the fixture's `backend` is not a git checkout), so the user names the staged record and asks for the link. What it distinguishes: a ride-along record that is linked straight away without `--pr` (which the planner would take as merged), from one that leaves the planner pointer and tells the user the sentence; the log has the comment, keyed by the decision id, and no `decision link`. Record step 6's ride-along bullet hands off to the same link.md step 5, so both paths share one pointer.

```clojure
 {:name "reeve-adr-link-headless-missing-input"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:adr link kb/ADR-0002 to decision 7 in Reeve. Do not ask questions; nobody can answer them in this session."
  :workdir "."
  :expects ["(?i)nothing was linked: missing" "(?i)\\bPR\\b|pull request"]
  :rejects ["(?m)^\\W*Linked[:;]"]
  :log-rejects ["^decision link "]}
```

What it distinguishes: a link run where nobody can answer that guesses the planner's repository name or leaves out `--pr` (telling the planner the record is merged), from one that names the missing inputs and says nothing was linked; the log has no `decision link`. The household and the repository name come from the shared home's checkout (`<workspace>/lore`), so the input still missing is the PR (`gh` is denied in the runner).

What they distinguish: `link-proposed` a link that needs an apply first (impossible here), a wrong path (absolute, or relative to the household instead of the repository), a missing `--pr`, and an answer not read from `check.kind`; `link-check-unreadable` a skill that applies "exit 1 → failure" to a link that in fact succeeded.

- [ ] **Step 2: Run them, see them fail**

Run: `bb test/run-tests.clj --filter command-adr-triages` — Expected: `[FAIL]`, "meeting notes" or "RFC" present (old step 3). Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-adr-link` — Expected: `-check-unreadable` `[FAIL]` (no link action, so the answer is paraphrased) and the ride-along scenario `[FAIL]` (no planner pointer comment). `-proposed` may pass before link.md exists: the model can assemble the call from `references/reeve-cli.md` alone; the mutation check (Step 6) is what proves link.md carries it.

- [ ] **Step 3: `actions/link.md`**

````markdown
# link

Link a record to a required decision in the Reeve planner, so the planner checks the record
instead of reporting "no record". Read `<plugin-root>/references/reeve-cli.md` first. This writes
nothing into the record or any repository (kb/ADR-0004 R3): it stores one reference in the planner.

1. **Detect.** Run `node <plugin-root>/scripts/reeve-detect.js` (record step 6 has already run it,
   or the calling skill passed its `bin` and `run_id`: reuse them). Keep `bin` and `run_id`.
   Unless it prints `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this session: <reason>; nothing
   was linked." and stop.
2. **Inputs.** Take each from the request or the caller (record step 6); ask, one at a time, only
   for what is missing. In a session that cannot ask (rule 3), a missing input stops the action
   with the line "Nothing was linked: missing <the inputs>." verbatim, on its own line; never
   guess the planner's repository name or the household, and never leave out `--pr` to fill a gap. The inputs:
   - the decision id, an integer ("decision 7", "#7"). Read it first with
     `reeve decision show <id> --json` and take the decision's title from `value.title`. A
     `not_found` answer stops with "There is no decision #<id> in the planner; nothing was
     linked."; a decision whose `closed` is set stops with "Decision #<id> is closed:
     <closed.reason>; nothing was linked." (a closed decision gates nothing, kb/ADR-0003 R3);
   - the record's qualified id, repository and repository-relative path. From record step 6 these
     come with the call (built from the draft and the homes JSON) and need no index lookup: the
     updater's worktree is gone by then and the user's checkout does not contain the record. For a record that
     already exists in a checkout (the standalone `link` action), take its file from
     `node <plugin-root>/scripts/adr-lint.js index --json` (`records[].id` → `records[].file`);
     an id the index lacks: say so and stop, unless the user gave the repository and path (and the
     PR, or said there is none yet) explicitly, which are then used as given;
   - the record's checkout: the directory of the repository that holds the record, from the
     selected home in the homes JSON (`node <plugin-root>/scripts/adr-lint.js homes`): for the
     shared home (`kb/…`), `sharedRepoRoot`, else `sharedRoot` (the knowledge base's checkout);
     for a local home (`<repo>/…`), that `localHomes[]` entry's `repoRoot`, else `<root>/<repo>`
     in a household (`mode` `household`) or `root` in a single repository. Never the current
     directory, and never `root` for the shared home: a repository configured with
     `knowledgeBasePath: ../lore` has `root` `/work/api` but its records in `/work/lore`;
   - the household directory: the one the user names, else the checkout's parent directory
     (`/work` for `/work/lore`). When neither the request nor the homes JSON gives the checkout
     (the home is missing, or the record's file is outside it), ask for the household; in a
     session that cannot ask, stop with "Stopped: missing household." on its own line;
   - the repository name as configured in the planner: the one the user names, else the
     checkout's directory name (`lore` for `/work/lore`): the planner reads the record at
     `<household>/<repo>/<path>`, so a name other than the directory's is given, never guessed;
   - the record's path inside that repository: the file's path relative to the checkout
     (`<household>/<repo>`); never absolute, never relative to the household;
   - the PR proposing the record: the url in the request or the report is used as given.
     Otherwise first settle whether the record is merged: when the file is on the default branch
     (the homes JSON's `defaultBranch` / `sharedDefaultBranch`;
     `git -C <checkout> cat-file -e origin/<default branch>:<path>`), it has no PR and
     `--pr` is left out. Else, knowing the record's branch, run
     `gh pr view <branch> --json url --jq .url` in the checkout when `gh` is
     available (never without the branch: that returns the checked-out branch's PR); else ask. A
     record that only rides along on a branch, staged or committed but with no PR yet, is neither
     merged nor proposed: do not link it, go to step 5.
3. **Show and run.** The request (or the apply the user confirmed) naming the record and the
   decision is the confirmation, also in a session that cannot ask (rule 3: a link is not a
   record write):
   `reeve decision link <id> --record <qualified id> --repo <repo> --path <path> --pr <url> --household <household> --json`
4. **Report** the answer with the reference's *decision link* table: give the table's sentence
   for the result verbatim, on its own line, read from `value.check.kind` (never from your own
   reading of the record). Exit 0 has one row per `check.kind` (`proposed_pr_open`, `accepted`,
   `not_accepted`, `not_found`; `not_found` carries its remedy, check the repository name and
   path). Exit 1 with an `ok` envelope is "Linked; the check could not run here: <stderr line>;
   it runs on the next scheduled check." (the link succeeded: do not call it a failure and do
   not run it again). A `refused` envelope, or an `error` other than `internal`, shows the reasons
   or the message and says nothing was linked (`unauthenticated` or `forbidden`: also tell the
   user to run `reeve auth login`). An `internal` error may come after the link was stored: run
   `reeve decision show <id> --json` first, and when its `record` names this record, report it as
   linked with the check not run here; otherwise nothing was linked. A `not_accepted` check whose
   status the planner could not read (for example "unparsable front matter") is reported as the
   planner states it, with the record's path; fixing the record is a separate change, never a blind retry of the link. End with
   `Run id: <run_id>` on its own line, unformatted.
5. **Ride-along, no PR yet.** Never link (without `--pr` the planner would take the record as
   merged). Leave the pointer on the decision instead, then tell the user that same sentence:
   `reeve comment add --decision <id> --body 'Record <qualified id> at <repo>:<path> rides along on branch <branch>; link it with /lore:adr link <qualified id> to decision <id> once the implementing PR is open' --idempotency-key <prefix>:<run_id>:<n> --json`
   (`<prefix>`, `<run_id>` and the next `<n>` as the calling skill passed them, else
   `recording-decisions:<id>`, the detector's `run_id` and 1; the reference's *Idempotency
   keys*), and print `Run id: <run_id>`.
   The link is made later by this action, once the PR exists (`--pr` from the request, else
   `gh pr view <branch>`).
````

- [ ] **Step 4: `SKILL.md` and `actions/record.md`**

`skills/recording-decisions/SKILL.md`:
- Description: append before "Not for PR approvals…": `when a record should be linked to a required decision in the Reeve planner;`.
- Rule 3, append: `A planner link (actions/link.md) is not a record write: the request naming the record, the decision and the PR confirms it.`
- *Understand the request*: add the example `/lore:adr link kb/ADR-0007 to decision 7` and the table row `| link an applied record to a required decision in the planner ("link kb/ADR-0007 to decision 7") | **link** |`.
- The action list in "Read `<plugin-root>/skills/recording-decisions/actions/<action>.md` (…)" gains `link`.
- *Where a change lands*, append: `When the Reeve planner is present and the record answers a required decision, the record action links it after apply (actions/link.md); a link never changes the record.`

`skills/recording-decisions/actions/record.md`:
- Step 3, replace "a decision with no code behind it (a tool, a process) belongs in an RFC or meeting notes." with: "A decision with no code behind it (a tool, a process, a product choice) is a record like any other when it is hard to reverse or the user wants one: same format, its `scope` names the documents or repositories it governs; never send it to an RFC or meeting notes (kb/ADR-0004 R5). A decision that answers a required decision in the planner is always drafted as a record, titled after that decision (from the caller's context, or `reeve decision show <id> --json` when the planner is present), worded as a decision rather than a question." This change is unconditional (Design choices).
- Step 5, append: "When the caller said \"draft only; do not apply\", stop here: return the draft and its id-to-be; the caller keeps the `Required decision: #<id>` pointer (never written into the record, kb/ADR-0004 R3)." (the phrase brainstorming, planning-initiative and refining-epic pass).
- Step 6, append (as shipped):

```markdown
   Then, only when a decision id is known — the user named one, the spec entry the draft came
   from carries `Required decision: #<id>` (outside the record text), or a planning skill passed
   one — act on the knowledge-updater's report, never on the current checkout's index (the
   updater's own-pr worktree is removed before it returns, so the record is not in the index).
   Reuse the calling skill's `bin`, `run_id`, key prefix and next `<n>` when it passed them;
   otherwise run `node <plugin-root>/scripts/reeve-detect.js` once and keep `bin` and `run_id`;
   unless it prints `"present":true` and `"signed_in":true`, skip the rest of this step. The
   inputs:
   - the qualified id and the file name: the ones the draft was numbered and saved with;
   - the repository-relative path, from the homes JSON the updater was given, never from the
     report's file list (its paths may point into the removed worktree): `<relDir>/<file name>`
     of the local home (`sharedRelDir` for the shared home); when that is `null` (not a git
     checkout), the home's directory relative to its repository directory, then the file name;
   - the repository offered for the planner's name (asked as link.md says): the local home's
     `repo`, or for the shared home the directory name of `sharedRoot`;
   - the PR url and the branch: from the report.

   Where the report says the change landed:
   - *opened PR <url>*, *committed to PR <url>*: follow `actions/link.md` with those inputs. A
     link that is refused or cannot check never undoes the apply.
   - *staged on your branch `<branch>`, not committed* (a ride-along; there may be no upstream
     and no PR yet): do not link; follow `actions/link.md` step 5, which leaves the planner
     pointer and tells the user the sentence.
```

- [ ] **Step 5: Run them, see them pass**

Run: `bb test/run-tests.clj --filter command-adr` — Expected: every `command-adr-…` scenario passes, including the new triage one. Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-adr-link` — Expected: 4 `[PASS]`, each 3/3 with `--runs 3`.

- [ ] **Step 6: Mutation checks**

Empty `actions/link.md` (title only): `reeve-adr-link-proposed`, `-check-unreadable` and `-ride-along` all fail. Restore the old step 3 sentence: `command-adr-triages-process-decision` fails. Restore both.

- [ ] **Step 7: Commit**

```bash
git add skills/recording-decisions test/scenarios.edn test/fixtures/reeve-bin/reeve scripts/__tests__/reeve-fake.test.js
git commit -m "feat(skills): recording-decisions drafts process records and links records to reeve required decisions" -m "Task 5 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Router, README, Codex twins, CLAUDE.md, version, full runs

**Files:**
- Create: `skills/lore-planning-initiative/SKILL.md`, `skills/lore-refining-epic/SKILL.md`
- Modify: `hooks/load-standards-reminder.sh`, `README.md`, `CLAUDE.md`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`

- [ ] **Step 1: Codex twins** (thin pointers, like `skills/lore-adr/SKILL.md`)

````markdown
---
name: lore-planning-initiative
description: Use when the user asks to plan an initiative in the Reeve planner, naming Reeve or an initiative key such as GRA-12. Not for planning that names neither.
---

# Lore planning initiative

Read `../../references/codex-runtime.md`, resolve the knowledge paths, then follow
`../../skills/planning-initiative/SKILL.md`. The user's words are the request.
````

````markdown
---
name: lore-refining-epic
description: Use when the user asks to refine an epic in the Reeve planner or to place its untriaged stories, naming Reeve or an epic key such as GRA-20. Not for breaking work down when the request names neither.
---

# Lore refining epic

Read `../../references/codex-runtime.md`, resolve the knowledge paths, then follow
`../../skills/refining-epic/SKILL.md`. The user's words are the request.
````

- [ ] **Step 2: Router rows**

In `hooks/load-standards-reminder.sh`, split `SKILL_ROUTER` after the `CREATIVE WORK` entry (`-> Use the brainstorming skill (design before code, always)`) into `SKILL_ROUTER_HEAD` and `SKILL_ROUTER_TAIL` (the two single-quoted halves of the old string), and put the two planner rows between them only when a `reeve-planner` CLI answers (branch fix round, I7: unconditional rows routed "break this down" in planner-less sessions to a skill that dead-ends):

```bash
# The two Reeve planner rows only when a reeve-planner CLI answers within 2 s (kb/ADR-0005 R1:
# a session without the planner routes exactly as before). One exec, silent on any failure;
# `-k 1` kills one that ignores TERM, so the probe never holds the hook past 3 s. Without GNU
# `timeout` (stock macOS) the probe is skipped and the rows are not emitted: nothing else bounds
# a child that keeps stdout open, and an unbounded probe could run the hook past its deadline.
REEVE_ROUTER_ROWS=''
reeve_version() {
    local bin="${REEVE_BIN:-reeve}"
    command -v "$bin" >/dev/null 2>&1 || return 0
    command -v timeout >/dev/null 2>&1 || return 0
    timeout -k 1 2 "$bin" --version </dev/null 2>/dev/null
}
case "$(reeve_version | head -n 1)" in
    'reeve-planner' | 'reeve-planner '*) REEVE_ROUTER_ROWS='\n\n- PLANNING AN INITIATIVE in the Reeve planner, when the request names Reeve or an initiative key (\"plan initiative GRA-12\", discovery for it)\n  -> Use the planning-initiative skill\n\n- REFINING AN EPIC in the Reeve planner, when the request names Reeve or an epic key (stories with acceptance criteria for GRA-20, placing untriaged stories)\n  -> Use the refining-epic skill' ;;
esac
SKILL_ROUTER="${SKILL_ROUTER_HEAD}${REEVE_ROUTER_ROWS}${SKILL_ROUTER_TAIL}"
```

Run: `node --test scripts/__tests__/load-standards-hook.test.js` — Expected: pass (the hook still emits valid JSON; the two `reeve router rows` tests: present with the fake as `REEVE_BIN`, absent with a missing binary, a `reeve-runner` lookalike and one that hangs past 2 s; codex fix round, a third: a probe that ignores TERM is killed by `timeout -k 1`, so the hook returns within ~3 s and still emits the knowledge paths).

- [ ] **Step 3: README and CLAUDE.md**

`README.md`, *Skills (Auto-Invoked)* table, after the `recording-decisions` row:

```markdown
| `planning-initiative` | Planning a Reeve initiative, named by Reeve or its key: discovery, brief, required decisions, epics (only with the Reeve planner) |
| `refining-epic` | Refining a Reeve epic, named by Reeve or its key: stories with acceptance criteria, placing untriaged stories (only with the Reeve planner) |
```

and after the table (as of the branch fix round, I5: the allow rules):

````markdown
**Reeve planner.** Optional. When a `reeve` CLI on the path reports `reeve-planner` and you are signed in (`reeve auth login`), the two skills above write into the planner, brainstorming reads a named story's context first, and `/lore:adr link` links a record to a required decision. Without it every skill behaves as before, and the session's skill router does not list the two planner skills.

The skills run `node <plugin-root>/scripts/reeve-detect.js` and the `reeve` CLI through Bash, so without allow rules every call asks for permission (20 to 25 prompts in one epic refinement), and a non-interactive run (`claude -p`, CI) is refused outright. Add to `.claude/settings.json` (`<plugin-root>` is the absolute path the plugin is installed at):

```json
{ "permissions": { "allow": [
  "Bash(node <plugin-root>/scripts/reeve-detect.js)",
  "Bash(reeve *)"
] } }
```

`Bash(reeve *)` also allows commands no skill runs (`reeve story mv`, `reeve decision close`, `reeve import --apply`, `reeve auth set-token`). To allow only what the skills call, list `Bash(reeve initiative *)`, `Bash(reeve epic *)`, `Bash(reeve story ls *)`, `Bash(reeve story create *)`, `Bash(reeve story edit *)`, `Bash(reeve story context *)`, `Bash(reeve decision ls *)`, `Bash(reeve decision show *)`, `Bash(reeve decision require *)`, `Bash(reeve decision link *)` and `Bash(reeve comment add *)` instead.
````

`commands/help.md`, *Available Skills*, after the `recording-decisions` row: `| \`planning-initiative\` | Planning a Reeve initiative named by Reeve or its key (only with the Reeve planner CLI) |` and `| \`refining-epic\` | Refining a Reeve epic or placing its untriaged stories, named by Reeve or its key (only with the Reeve planner CLI) |`. The `/lore:adr` description (`commands/adr.md`, `skills/lore-adr/SKILL.md`) gains "link".

`CLAUDE.md`, *Zero-runtime principle*, after the `adr-lint.js` paragraph: "The second exception is `scripts/reeve-detect.js`: every skill that touches the Reeve planner must agree on whether it is present and signed in (kb/ADR-0005 R1: `reeve --version` reports `reeve-planner`, `reeve auth status --json` is ok), with a timeout so a hanging binary never hangs a session — one tested script instead of the same two checks written into five skills. It reads nothing from a knowledge base and writes nothing." In the overview paragraph (line 7), the script list gains `reeve-detect.js`. In *Skill router vs. user-installed superpowers*, the list of the plugin's own skills gains "the two Reeve planner skills `planning-initiative` and `refining-epic` (active only when the planner CLI is present)" (added during Task 6: the list would otherwise be stale).

- [ ] **Step 4: Version 3.3.0**

Set `"version": "3.3.0"` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json` (minor: new skills, CLAUDE.md *Version bumps are mandatory*). Task 6 set 3.2.0, which [lorekeeper#35](https://github.com/Mindful-Stack/lorekeeper/pull/35) took on origin/main first; the branch fix round merged origin/main and moved to 3.3.0 (if lorekeeper#33's 3.2.1 lands first, 3.3.0 still wins).

- [ ] **Step 5: Full runs**

```bash
node --test scripts/__tests__/*.test.js
bb test/run-tests.clj --with reeve-fake --filter reeve-
bb test/run-tests.clj
```

Expected: every Node test passes; the second command runs the eleven `reeve-…` scenarios (the nine that require `reeve-fake`: `reeve-runner-selftest`, `reeve-planning-initiative`, `reeve-refining-epic`, `reeve-brainstorming-no-story-key`, `reeve-brainstorming-story-context`, the four `reeve-adr-link-…`; plus the two planner-absent ones, `reeve-brainstorming-without-planner` and `reeve-brainstorming-story-key-without-planner`) and all pass; the third prints `[SKIP]` for the nine that require `reeve-fake` and passes the other twenty-nine, including `reeve-brainstorming-without-planner`, `command-adr-triages-process-decision` and the updated `command-adr-new-triages-and-interviews`. (Counts corrected in Task 6: the Task 4 and Task 5 fix rounds added `reeve-brainstorming-no-story-key`, `reeve-brainstorming-story-key-without-planner` and `reeve-adr-link-headless-missing-input`, and the filter also matches the two planner-absent scenarios.) Use `--runs 3 --min 2` on a scenario that fails once to see whether it is flaky before changing a skill.

Task 6 run (2026-10-26): `reeve-brainstorming-story-key-without-planner` failed in 3 of 5 runs (both full runs, and 1 of 3 repeats): the reply said "The planner isn't signed in" / "I couldn't load story GRA-31 from the planner". Task 4's "skip the rest without mentioning the planner" was too weak against a detector line that carries a `reason`; *Planner Context* now says the section "ends here and leaves no trace: your reply never mentions the planner, the detector, a sign-in or a story lookup (not even that the story could not be loaded), and reads exactly as it would if the planner did not exist" (mirrored into Task 4 Step 3). The assertion is unchanged. After the fix, `--with reeve-fake --filter reeve-brainstorming --runs 3`: `without-planner` 3/3, `story-key-without-planner` 3/3, `story-context` 3/3, `no-story-key` 2/3 (one run omitted the announce sentence; it passed in both earlier runs, so it is noted as a flake and left alone).

Branch fix round run (2026-10-26, at bf2a65a, the `chore(release): 3.3.0` head; the docs-only plan mirror and the
scenario-reject fix follow it). The filter now matches fifteen `reeve-…` scenarios (twelve need `reeve-fake`, plus the
three planner-absent ones, `reeve-brainstorming-without-planner`, `reeve-brainstorming-story-key-without-planner` and
`reeve-break-down-without-planner`). The default suite runs thirty and skips the twelve. Results:
`node --test scripts/__tests__/*.test.js` 348 pass, 1 skipped (the real-CLI conformance test, which passes 3/3 with
`REEVE_REAL_BIN` set); `--with reeve-fake --filter reeve-` 14/15; the default suite 29/30, 12 skipped. The one failure
in both was `reeve-break-down-without-planner`: no dead-end, but the reply closed by offering to place the stories in
Reeve, which its first `(?i)reeve|planner` reject caught. That reject was narrowed (see *Branch fix round*), and the
scenario then passed 3/3. `reeve-brainstorming-no-story-key --runs 5`: 5/5.

- [ ] **Step 6: Commit, PR and the marketplace companion**

```bash
git add skills hooks README.md CLAUDE.md .claude-plugin .codex-plugin package.json
git commit -m "feat(skills): reeve planning skills in the router, readme and codex twins (3.2.0)" -m "Task 6 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Open the PR. Then, as CLAUDE.md's *Version bumps are mandatory* requires, open the companion PR in `Mindful-Stack/witan` that sets the `lore` entry's `version` in `.claude-plugin/marketplace.json` to `3.3.0`, and link each PR from the other; the marketplace PR merges after this one. (Task 6 was executed without pushing or opening either PR; both are left to the person merging the branch.)

---

## Branch fix round (2026-10-26)

The whole-branch review (one Critical, eight Important, fourteen Minor) and the Fable skills review were applied on
top of a merge of origin/main. Every shipped file block above is the file as it stands after this round; this section
records what changed and why, and the scenarios it added.

- **C1, release.** origin/main shipped 3.2.0 ([lorekeeper#35](https://github.com/Mindful-Stack/lorekeeper/pull/35),
  the ADR gate and `.github/workflows/test.yml`, which runs `node --test scripts/__tests__/*.test.js` on Node 22 and 24,
  so the detector, fake, reference and hook tests run in CI). The branch merges it and releases **3.3.0**; the witan
  companion sets `lore` to 3.3.0.
- **I1.** The reference branches on the envelope, `outcome` first: exit 2 is `refused` or an `unauthenticated` /
  `forbidden` error (which stops the run with `reeve auth login`). Both planning skills, brainstorming and link.md say
  "branch on the envelope".
- **I2.** `decision ls` lists `on` and `closed`; "open" is defined once in *Wording the planner's answers* (not
  closed, not accepted) and brainstorming, planning-initiative and refining-epic point at it.
- **I3.** Headless, a question the request does not answer stops the run with `Stopped: missing <what>.`; nothing
  after it is written (rule 2 of both planning skills, and the reference's *Confirmation*).
- **I4 (+ Fable 6).** The request confirms only the content it supplies; a composed brief, a new epic or initiative
  and a chosen home need their own yes, or, headless, a request that names the write. Placement branches 7.2 and 7.3
  create only on a confirmation for that story, else leave it untriaged with a `Proposed home: …` comment.
- **I5.** The README names the allow rules (`Bash(node <plugin-root>/scripts/reeve-detect.js)`, `Bash(reeve *)` or the
  narrow per-subcommand list) and says headless runs are refused without them.
- **I6.** `scripts/__tests__/reeve-reference.test.js` (Task 1 Step 9). The fake now matches the real planner where it
  was cheap: untriaged is kind `story` with no epic; readiness in the planner's order with the initiative; a closed
  decision 8; `decision show`; usage errors without an envelope, including a `-`-leading value (except
  `comment add --body`); `REEVE_FAKE_SIGNIN=expired` (exit 2); horizon validation. `--version` is no longer logged,
  since the SessionStart hook runs it; detection shows in the log as `auth status --json`.
- **I7.** The router's planner rows appear only when `reeve --version` reports `reeve-planner` within 2 s (Task 6
  Step 2); both descriptions (and the Codex twins) trigger only on requests that name Reeve or an item key. The
  unconditional changes are record.md's triage and brainstorming's announce line.
- **I8.** `reeve decision show <id>` is in the reference and the fake; link.md reads the title and `closed` from it
  and stops on a closed decision; record.md step 3 takes the title from it.
- **Fable 5.** planning-initiative (and refining-epic step 5) asks once per decision "Draft the record now, or leave
  it for <decider>?"; it drafts at once when the request states the answer or asks for a draft, and headless only
  when the request says so.
- **Minors applied:** m1 (no `--kind` plan-C notes or retry), m2 (usage error has no envelope), m3, m4, m5 (fold a
  teammate's edit in on a conflict), m6 (nested keys reuse the caller's prefix, run id and counter), m7 (headless
  apply reported as not applied), m9 (`no-story-key` drops the announce expectation), m10 (`/lore:help` rows, `link`
  in the `/lore:adr` description), m11 (one announce sentence per skill, also the report's first line), m12, m13
  (an `internal` link error checks `decision show` first), Fable R5 (superseded wording), R6 (horizon is validated),
  R7 (other reasons verbatim), M2 (a failed re-read is reported, writes marked unverified), the no-backticks rule.
  **Left:** m8 (a refusal scenario), Fable M4 (moving the shared rules into one reference), M5 (`--description` on
  stories), M6 (detector wording for an unreachable server), and the named layout overfits (the GRA-42 window, the
  `?` anchor, the "covers" sentence).

Scenario changes: the planning-initiative prompt adds "Write the brief from these answers."; the refining-epic
prompt adds "Update the epic's brief with these answers." and "you may create the new epics and the new initiative
the tree proposes for GRA-43, GRA-44 and GRA-45", and the fixture's GRA-47 "Translate the mentee app into Spanish"
(a product change nothing covers, its create not named) must be reported `left untriaged` with a `Proposed home`
comment and no `story edit`; a second `initiative create` and any "#8 … no record" are rejected. `step 0` evidence
in the log is `auth status --json`. New scenarios, appended to `test/scenarios.edn`:

```clojure
 {:name "reeve-adr-link-closed-decision"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:adr link kb/ADR-0002 to decision 8 in Reeve. Do not ask questions; the answers are given: the planner calls this repository lore, the PR proposing the record is https://github.com/example/test-workspace/pull/9, and the household is the current directory."
  :workdir "."
  :expects ["(?i)decision #8 is closed" "(?i)nothing was linked"]
  :rejects ["(?m)^\\W*Linked[:;]"]
  :log-expects ["^decision show 8 --json$"]
  :log-rejects ["^decision link "]}

 {:name "reeve-planning-initiative-headless-missing-decider"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Plan initiative GRA-12 in Reeve. Do not ask questions; nobody can answer them in this session. Vision: every mentee has a mentor within one working day. It is for programme coordinators and mentees. Known: coordinators match by hand once a week today. Write the brief from these answers. Open question: whether matching runs from a queue or on a cron schedule; it is a consequential choice that blocks the work, due 2026-11-15. Epics: 'Match notifications' (brief: tell mentor and mentee when a match is made). I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the planning-initiative skill" "(?im)^\\W*Stopped: missing[^\\n]*(?:decid|decision[- ]maker)"]
  :log-expects ["^auth status --json$" "^initiative show GRA-12 --json$"]
  :log-rejects ["^decision require " "^epic create " "^comment add "]}

 {:name "reeve-refining-epic-headless-missing-decider"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "Refine epic GRA-20 in Reeve. Do not ask questions; nobody can answer them in this session. Done looks like: every match request is processed from the queue within an hour. Boundary: no change to mentor profiles. Update the epic's brief with these answers. New required decision: whether a failed match request is retried from the queue or dropped; it is a consequential choice that blocks the work, due 2026-11-15. Stories: 'Enqueue match requests' with criteria 'a new request is on the queue within a minute' and 'a repeated request is enqueued once'. Leave the untriaged stories untriaged. I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the refining-epic skill" "(?im)^\\W*Stopped: missing[^\\n]*(?:decid|decision[- ]maker)"]
  :log-expects ["^auth status --json$" "^epic show GRA-20 --json$"]
  :log-rejects ["^decision require " "^story create " "^story edit " "^epic create " "^initiative create "]}

 {:name "reeve-break-down-without-planner"
  :env {"REEVE_BIN" "/nonexistent/reeve"}
  :prompt "Break this feature down into stories: mentors can pause matching for a month."
  :workdir "."
  :expects ["(?i)paus"]
  :rejects ["(?i)not available|reeve-detect|planning-initiative|refining-epic|stopped: missing|epic key is required"]}
```

What they distinguish: `adr-link-closed-decision` a link to a decision a person closed (kb/ADR-0003 R3) or one made
without reading it; the two `headless-missing-decider` runs a skill that fills a decider in (the initiative's owner
is `dan@example.com`, the tempting guess) or writes past the unanswered question (`decision require`, and the creates
that come after it, rejected); `break-down-without-planner` (no `:requires`, `REEVE_BIN` pointing nowhere, so the
router has no planner rows) a planner-less "break this down" routed to a planning skill that dead-ends (the planning skills' names, the detector, "not available" and the stop lines are rejected). The word "Reeve" is not rejected: in 2 of 5 runs the reply, otherwise a full breakdown with no planner call, closed with an offer such as "if this lives as an epic in Reeve, give me the key" (the skill descriptions are always listed); that is a mention, not a dead-end, and is left to the user as a kb/ADR-0005 R1 judgement.

Run results (2026-10-26). Scenario runs are sequential within a command; the three commands ran in parallel:

| Scenario | Fake-filtered run | Default run | Repeats |
|---|---|---|---|
| reeve-brainstorming-without-planner | PASS | PASS | |
| reeve-brainstorming-no-story-key | PASS | skip | `--runs 5`: 5/5 |
| reeve-brainstorming-story-context | PASS | skip | |
| reeve-runner-selftest | PASS | skip | |
| reeve-planning-initiative | PASS | skip | re-run after the reject fix: PASS |
| reeve-refining-epic | PASS | skip | re-run: PASS |
| reeve-brainstorming-story-key-without-planner | PASS | PASS | |
| reeve-adr-link-proposed | PASS | skip | |
| reeve-adr-link-check-unreadable | PASS | skip | |
| reeve-adr-link-ride-along | PASS | skip | |
| reeve-adr-link-headless-missing-input | PASS | skip | |
| reeve-adr-link-closed-decision | PASS | skip | |
| reeve-planning-initiative-headless-missing-decider | PASS | skip | 0/1, then `--runs 3` 2/3, then 3/3 single runs: 6/8 overall. Each failure was the `Stopped: missing … decider` line only; the log-rejects held every time |
| reeve-refining-epic-headless-missing-decider | PASS | skip | re-run: PASS |
| reeve-break-down-without-planner | FAIL (offer mentioning Reeve) | FAIL (same) | narrowed rejects `--runs 3`: 3/3; the original rejects `--runs 3`: 3/3 (the mention is intermittent, 2 of 5) |
| the 27 default scenarios outside `reeve-` | | 27 PASS | |

Task 4's mutation check (empty brainstorming's body, the brainstorming scenarios must fail) was not re-run after
938ac02 or in this round.

## Environment assumptions pinned

- **Scenario environment**: the runner builds the child's environment explicitly (Task 1 Step 5): every scenario has a fresh empty `REEVE_CONFIG_DIR` and no `REEVE_URL`, `REEVE_TOKEN` or `REEVE_BIN`, so a real `reeve` (this machine has one in `~/.local/bin`, reporting `reeve-planner 0.1.0`) can never reach a server and reports signed out. Fake scenarios put `test/fixtures/reeve-bin` before everything else on `PATH`, including `~/.local/bin`. Whether that prefix survives into the Bash tool's shell (a `~/.bashrc` that re-prepends `~/.local/bin` would defeat it) is checked by `reeve-runner-selftest` before any other reeve scenario counts.
- **Permissions**: `--permission-mode default` with `Bash(reeve *)` added per scenario; skills write the literal command word `reeve`, so the rule matches, and pass Markdown as one single-quoted argument with real newlines and setext headings (no line whose first non-blank character is `#`, no value starting with `-` except `comment add --body`): Claude Code's permission check refuses ANSI-C quoting (`$'…'`) and a quoted newline followed by `#`, which would turn an allowed call into a refused prompt under `claude --print`.
- **Non-interactive runs**: `claude --print` is one turn, so every reeve scenario prompt gives every answer; recording-decisions drafts stay draft-only; the only executed writes go to the fake.
- **The real CLI's flags** were read from `crates/reeve/src/commands/*.rs` in ~/Source/reeve on 2026-10-26; `story edit --kind` and `decision show <id>` exist on `feat/m1-import`. The wire shapes come from `crates/reeve-server/tests/snapshots/openapi.json`. `scripts/__tests__/reeve-reference.test.js` with `REEVE_REAL_BIN` set is the check that the reference still parses.
- **Detection timeout**: `execFileSync` with `timeout` kills the child with SIGTERM and returns at the timeout (verified with a `sleep` child holding stdout); the detector reports `present: false`.
- **Without `bb`** (Babashka) no scenario runs; the Node tests still do.

## Self-review notes

- Spec coverage ("Lorekeeper integration"): detection → Task 1; the two planning skills with architect survey, research, brief, required decisions with a decider and a drafted record each, epics, stories with criteria → Tasks 2–3; the placement tree against `story ls --untriaged` → Task 3 step 6; `story context` as the bundle → Task 4; recording-decisions' link and triage change → Task 5. Not in this plan: an MCP server (kb/ADR-0005 R5 permits one later).
- Spec drift: the spec links "when it drafts a record"; this plan links at apply, when the path and the PR exist, and leaves a pointer (a planner comment, or `Required decision: #<id>` in the spec) for drafts not applied in the session. The spec's Lorekeeper section should say the same.
- Spec-conflict: the spec calls the untriaged placement "the triage skill"; this plan places it inside refining-epic (kb/ADR-0005 R4 names only two planning skills).
- Would-it-fail: every write a scenario expects is asserted in the fake's log, which only an executed command produces, with a fresh log per run; transcript expectations are fixture-specific ("Queue or cron", "no acceptance criteria", "decision: no record", "proposed, PR open"); each new skill has a mutation check; the detector tests include the renamed runner, a lookalike, the real signed-out shape, a missing binary and a hang; the fake has its own tests.
- Governing decisions: no task weakens the brainstorming gate or its checklist; no skill produces a spec; every command carries `--json` and every create a run-scoped idempotency key; no manifest change; triage is unconditional because kb/ADR-0004 R5 does not depend on the planner, and every planner-dependent step is guarded by the detector (kb/ADR-0005 R1).
