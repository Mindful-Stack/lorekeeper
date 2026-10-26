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
- **Triage is unconditional.** kb/ADR-0004 R5 is an accepted Lorekeeper rule that does not depend on the planner, so record.md's step 3 drafts process, tooling and product records whether or not `reeve` is present. kb/ADR-0005 R1's "every skill MUST behave as before" covers planner-dependent behaviour (detection, reading the planner, writing to it, linking), and every such addition is guarded by the detector.

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
- Modify: `hooks/load-standards-reminder.sh` (two router rows), `README.md` (skills table, "Reeve planner" paragraph), `CLAUDE.md` (zero-runtime exception for the detector), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (version 3.2.0)
- Companion: `Mindful-Stack/witan` `.claude-plugin/marketplace.json` (the `lore` entry's `version` → 3.2.0), a separate PR

## Task order

1 runner + detector + fake + CLI reference → 2 planning-initiative → 3 refining-epic → 4 brainstorming step 0 → 5 recording-decisions triage + link → 6 router, README, Codex twins, CLAUDE.md, version, full runs.

---

## Global constraints (copy into every implementer brief)

- No skill writes a spec or a plan on the planner's behalf; planning skills write to the planner through `reeve` and print what they wrote.
- Every `reeve` call in a skill is copied from `references/reeve-cli.md`: `--json` as the last argument; exit 0 → proceed, 2 → show the refusal reasons and stop that step, 1 → show the error and stop that step. Two exceptions, both in the reference: `code: conflict` (a stale `--version`) re-reads, shows what changed and retries once; `decision link` exiting 1 with an `ok` envelope means "linked, check not run here".
- Creates (`initiative create`, `epic create`, `story create`, `decision require`, `comment add`) pass `--idempotency-key <skill>:<KEY>:<run-id>:<n>`: the skill name, the item the run works on, the detector's `run_id` (minted once per skill invocation and printed in the report), and the ordinal of this create in the run, from 1. A retry within the run reuses its key; a new run never reuses an old key; keys never derive from titles (kb/ADR-0005 R3).
- An answer the user already gave in the request counts as the confirmation for that write; skills do not ask it again. Scenario prompts give every answer and say "Do not ask questions; the answers are given."
- Absent the planner (detector says `present: false` or `signed_in: false`), every planner-dependent step is skipped and the skill behaves exactly as on `origin/main`; the only unconditional change is record.md's triage (see Design choices).
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
// A fake Reeve planner CLI for the scenario tests (test/README.md). Every call is appended to
// $REEVE_FAKE_LOG as one line (argv joined by spaces, newlines flattened). Flags the real CLI
// lacks are usage errors (exit 1). Answers use the planner's wire shapes (StoryContextDto,
// RequiredDecisionDto, CheckResult, Reason in the Reeve repository's
// crates/reeve-server/tests/snapshots/openapi.json). REEVE_FAKE_LINK_CHECK=unreadable makes
// `decision link` behave like a link whose immediate check could not run. REEVE_FAKE_REFUSE=<text>
// makes every command whose name contains <text> (e.g. `story create`) answer with a `refused`
// envelope and exit 2. Creates replay by --idempotency-key from the state file $REEVE_FAKE_LOG.state;
// creates and edits persist there, so later shows and lists see them like the real planner.
'use strict';
const fs = require('node:fs');

const argv = process.argv.slice(2);
const log = process.env.REEVE_FAKE_LOG;
// Logged only once the call passed validation, so a malformed call never satisfies a log expectation.
const logCall = () => { if (log) fs.appendFileSync(log, argv.join(' ').replace(/[\r\n\u2028\u2029\u0085]+/g, ' ') + '\n'); };

// Per-run state next to the log: { next, creates: { <idempotency key>: <response value> },
// items: { <KEY>: <the item as last written> } }. Updates
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
const KEY_SHAPE = /^[a-z][a-z0-9-]*:[A-Z][A-Z0-9]*-[0-9]+:[0-9a-f]{8}:[0-9]+$/; // <skill>:<KEY>:<run-id>:<n>

const emit = (envelope, code) => { process.stdout.write(JSON.stringify(envelope) + '\n'); process.exit(code); };
const ok = (value) => emit({ outcome: 'ok', value }, 0);
const error = (code, message) => emit({ outcome: 'error', code, message }, 1);

if (argv[0] === '--version') { logCall(); process.stdout.write('reeve-planner 0.1.0-fake\n'); process.exit(0); }
if (!argv.includes('--json')) error('validation', 'the fake planner answers --json calls only');
const words = argv.filter((a) => a !== '--json');

const DISCOVERY = { pos: 1, val: ['version'], bool: ['complete', 'reopen'], req: ['version'] };
const SPEC = {
  'auth status': { pos: 0 },
  'story context': { pos: 1 },
  'story ls': { pos: 0, val: ['epic'], bool: ['untriaged'] },
  'story create': { pos: 0, val: ['idempotency-key', 'title', 'kind', 'epic', 'description'], rep: ['criterion', 'label'], req: ['idempotency-key', 'title'] },
  'story mv': { pos: 2, val: ['version', 'resolution', 'override'] },
  'story edit': { pos: 1, val: ['version', 'title', 'epic', 'kind', 'rank'], bool: ['no-epic'], rep: ['criterion'], req: ['version'] }, // --kind: Reeve plan C Task 5
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
  'decision require': { pos: 0, val: ['idempotency-key', 'on', 'title', 'decider', 'due'], req: ['idempotency-key', 'on', 'title', 'decider'] },
  'decision link': { pos: 1, val: ['record', 'repo', 'path', 'pr', 'household'], req: ['record', 'repo', 'path'] },
  'comment add': { pos: 0, val: ['idempotency-key', 'story', 'decision', 'body'], req: ['idempotency-key', 'body'] },
};
const cmd = words.slice(0, 2).join(' ');
const spec = SPEC[cmd] || error('validation', `unknown command: reeve ${cmd}`);
const pos = [];
const f = {};
for (let i = 2; i < words.length; i++) {
  const w = words[i];
  if (!w.startsWith('--')) { pos.push(w); continue; }
  const name = w.slice(2);
  if ((spec.bool || []).includes(name)) f[name] = true;
  else if ((spec.val || []).includes(name) || (spec.rep || []).includes(name)) {
    if (i + 1 >= words.length) error('validation', `--${name} needs a value`);
    const v = words[++i];
    if ((spec.rep || []).includes(name)) (f[name] ||= []).push(v); else f[name] = v;
  } else error('validation', `unknown flag --${name} for reeve ${cmd}`);
}
if (pos.length !== spec.pos) error('validation', `reeve ${cmd} takes ${spec.pos} positional argument(s), got ${pos.length}`);
for (const r of spec.req || []) if (!(r in f)) error('validation', `reeve ${cmd} needs --${r}`);
if (spec === DISCOVERY && !f.complete && !f.reopen) error('validation', 'pass --complete or --reopen');
if (f.kind && !['story', 'bug', 'chore'].includes(f.kind)) error('validation', `--kind must be story, bug or chore`);
if (f.version && !/^\d+$/.test(f.version)) error('validation', '--version must be an integer');
if (f['idempotency-key'] !== undefined && !KEY_SHAPE.test(f['idempotency-key'])) error('validation', `--idempotency-key must look like <skill>:<KEY>:<run-id>:<n>, got ${f['idempotency-key']}`);
if (f.due && !/^\d{4}-\d{2}-\d{2}$/.test(f.due)) error('validation', '--due must be YYYY-MM-DD');

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
};
const decision7 = { id: 7, on: 'GRA-20', title: 'Queue or cron', decider: 'dan@example.com', due: null, record: null, pr_url: null, check: { kind: 'unchecked' }, checked_at: null, closed: null, created_at: NOW, version: 1 };
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
// Readiness derived like the planner does, for every story.
const readinessOf = (s) => {
  const reasons = [];
  if (!s.epic) reasons.push({ reason: 'untriaged' });
  if (!s.criteria.length) reasons.push({ reason: 'no_criteria' });
  const e = s.epic && (itemsOf()[s.epic] || epics[s.epic]);
  if (e && !e.discovery_complete) reasons.push({ reason: 'ancestor_discovery_incomplete', item: e.key });
  if (e) for (const d of [decision7, ...createdDecisions()]) if (d.on === e.key && !d.record) reasons.push({ reason: 'decision_no_record', decision_id: d.id, title: d.title });
  return { ready: !reasons.length, reasons };
};

// A write that names an epic or initiative nobody created is not_found, and not logged: a guessed
// key never satisfies a log expectation.
if (['story create', 'story edit', 'epic create', 'epic edit'].includes(cmd)) {
  for (const [flag, table] of [['epic', epics], ['initiative', initiatives]]) if (f[flag] !== undefined && !itemsOf()[f[flag]] && !table[f[flag]]) error('not_found', `no ${flag} ${f[flag]}`);
}
logCall(); // valid: the call reached the planner (a refusal below is the planner's answer)
if (process.env.REEVE_FAKE_REFUSE && cmd.includes(process.env.REEVE_FAKE_REFUSE)) emit({ outcome: 'refused', reasons: [{ reason: 'no_criteria' }] }, 2);

({
  'auth status': () => ok({ url: 'http://127.0.0.1:7474', token_from_env: false, email: 'dan@example.com', role: 'member', token_kind: 'interactive' }),
  'story context': () => {
    const s = itemsOf()[p0] || stories[p0] || error('not_found', `no story ${p0}`);
    const e = s.epic ? itemsOf()[s.epic] || epics[s.epic] : null;
    ok({ story: s, epic: e, initiative: e && e.initiative ? initiatives[e.initiative] : null, required_decisions: s.epic === 'GRA-20' ? [decision7] : [], blockers: [], comments: [{ id: 1, author: 'sam@example.com', body: 'Coordinators want to see every retry.', at: NOW, on_story: s.key, on_decision: null, external_ref: null }], readiness: readinessOf(s) });
  },
  'story ls': () => ok(all(stories, 'story').filter((s) => (f.untriaged ? !s.epic : !f.epic || s.epic === f.epic)).map((s) => ({ story: s, readiness: readinessOf(s) }))),
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
  'decision ls': () => ok([decision7, ...createdDecisions()].filter((d) => !f.on || d.on === f.on)),
  'decision require': () => ok(mint((id) => ({ ...decision7, id, on: f.on, title: f.title, decider: f.decider, due: f.due || null }))),
  'decision link': () => {
    if (!/^\d+$/.test(p0)) error('validation', 'the decision id must be an integer');
    const linked = { ...decision7, id: Number(p0), record: { repo: f.repo, path: f.path, record_id: f.record }, pr_url: f.pr || null, version: 2 };
    if (process.env.REEVE_FAKE_LINK_CHECK === 'unreadable') {
      process.stderr.write(`decision ${p0}: cannot read ${f.path}: ${f.household || '.'}/${f.repo} is not a git checkout\n`);
      emit({ outcome: 'ok', value: { ...linked, check: { kind: 'unchecked' } } }, 1);
    }
    ok({ ...linked, check: { kind: f.pr ? 'proposed_pr_open' : 'not_found' }, checked_at: NOW });
  },
  'comment add': () => {
    if (!f.story === !f.decision) error('validation', 'pass exactly one of --story and --decision');
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
test('--version names the fake planner', () => {
  const r = run(['--version']);
  assert.equal(r.stdout, 'reeve-planner 0.1.0-fake\n');
  assert.equal(r.log, '--version\n');
});
test('a flag the real CLI lacks is a usage error', () => {
  const r = run(['epic', 'edit', 'GRA-20', '--brief-file', 'brief.md', '--version', '2', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual([r.envelope.outcome, r.envelope.code], ['error', 'validation']);
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
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-20', '--json']).value.map((x) => x.id), [7]);
});
test('creates and edits persist: story ls, show and the readiness reasons see them', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  const s = call(['story', 'create', '--epic', 'GRA-20', '--title', 'Enqueue', '--kind', 'story', '--criterion', 'on the queue', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:1', '--json']).value;
  assert.equal(call(['story', 'edit', 'GRA-42', '--epic', 'GRA-20', '--version', '1', '--json']).value.version, 2);
  assert.equal(call(['story', 'edit', 'GRA-42', '--epic', 'GRA-20', '--version', '1', '--json']).code, 'conflict');
  const listed = call(['story', 'ls', '--epic', 'GRA-20', '--json']).value;
  assert.deepEqual(listed.map((x) => x.story.key), ['GRA-31', 'GRA-32', 'GRA-42', s.key]);
  assert.deepEqual(listed[2].readiness.reasons.map((r) => r.reason), ['no_criteria', 'ancestor_discovery_incomplete', 'decision_no_record']);
  assert.deepEqual(listed[3].readiness.reasons.map((r) => r.reason), ['ancestor_discovery_incomplete', 'decision_no_record']);
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
test('readiness is derived for every story; story mv exists so a delivery change is logged', () => {
  const listed = run(['story', 'ls', '--epic', 'GRA-20', '--json']).envelope.value;
  assert.deepEqual(listed.map((x) => x.readiness.reasons.map((r) => r.reason)), [
    ['ancestor_discovery_incomplete', 'decision_no_record'],
    ['no_criteria', 'ancestor_discovery_incomplete', 'decision_no_record'],
  ]);
  const mv = run(['story', 'mv', 'GRA-31', 'in-progress', '--json']);
  assert.deepEqual([mv.status, mv.envelope.value.delivery, mv.log], [0, 'in-progress', 'story mv GRA-31 in-progress --json\n']);
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
;; scenarios or repeats share a log. The scenario's own :env is merged last.
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
  :prompt "Run `reeve --version` and report what it printed. Do not ask questions; the answers are given."
  :workdir "."
  :expects ["0\\.1\\.0-fake"]
  :log-expects ["^--version$"]}
```

What it distinguishes: the fake not first on the Bash tool's PATH (a shell rc re-prepending `~/.local/bin`, where the real planner prints `reeve-planner 0.1.0` without `-fake`, and the log stays empty), `Bash(reeve *)` not reaching the child, and a log that is not wired through.

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-runner-selftest` — Expected: `[PASS] reeve-runner-selftest`. Then `bb test/run-tests.clj --filter reeve-runner-selftest` — Expected: `[SKIP] reeve-runner-selftest (requires reeve-fake; run with --with reeve-fake)`, `Results: 0/0 passed, 1 skipped`. If the first run fails with `0.1.0` in the output, the PATH prefix does not reach the Bash tool: stop and report; no reeve scenario is meaningful until it does.

- [ ] **Step 7: test/README.md**

Add a section "Scenarios against the Reeve planner" with the key table from Step 5, the environment pin (every scenario: empty `REEVE_CONFIG_DIR`, no `REEVE_URL`/`REEVE_TOKEN`/`REEVE_BIN`; fake scenarios: the fake first on `PATH`, a fresh `REEVE_FAKE_LOG` per run), the log format (one line per call that passed the fake's validation, argv joined by spaces, newlines flattened; a malformed call is not logged, a valid call the planner refuses is), what the fake answers (the item keys in Step 4: initiatives GRA-12/GRA-13, epics GRA-20/GRA-21, decision 7 "Queue or cron" with no record, stories GRA-31/GRA-32 in GRA-20, untriaged GRA-40…GRA-46; created items get `GRA-100`, `GRA-101`, … from the state file `$REEVE_FAKE_LOG.state`; creates need `--idempotency-key <skill>:<KEY>:<run-id>:<n>` and replay by key; creates and edits persist for the run, so every show and list sees them, and readiness is derived for every story; a write naming an epic or initiative that does not exist is `not_found` and not logged; `story mv` exists only so a delivery change is logged), `REEVE_FAKE_REFUSE`,, `REEVE_FAKE_LINK_CHECK=unreadable`, and the two commands:

```bash
bb test/run-tests.clj --with reeve-fake --filter reeve-   # the planner scenarios
bb test/run-tests.clj                                     # everything else; reeve-fake scenarios print [SKIP]
```

- [ ] **Step 8: The CLI reference**

`references/reeve-cli.md`, verified against `crates/reeve/src/commands/*.rs` in ~/Source/reeve (2026-10-26):

````markdown
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
argument with real newlines, `'\''` for an apostrophe, and no line whose first non-blank
character is `#` (an indented `#` is refused too): write a heading in setext form, its title
underlined with `---`. A brief never starts with `-` (the real CLI would read it as a flag): open
with a sentence or a heading, not a bullet.

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
````

- [ ] **Step 9: Run and commit**

Run: `node --test scripts/__tests__/*.test.js` — Expected: all pass, including the 5 detector and 9 fake tests.

```bash
git add scripts/reeve-detect.js scripts/__tests__/reeve-detect.test.js scripts/__tests__/reeve-fake.test.js references/reeve-cli.md test/fixtures/reeve-bin/reeve test/run-tests.clj test/README.md test/scenarios.edn
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
  :prompt "Plan initiative GRA-12 in Reeve. Do not ask questions; the answers are given. Vision: every mentee has a mentor within one working day. It is for programme coordinators and mentees. Known: coordinators match by hand once a week today. Open question: whether matching runs from a queue or on a cron schedule; it is a consequential choice that blocks the work, decided by dan@example.com, due 2026-11-15. Draft its record but do not apply it now. Epics: 'Matching queue' (brief: match mentors through a queue), 'Match notifications' (brief: tell mentor and mentee when a match is made) and 'Match reminders' (brief: remind a mentor who has not answered a match within a day). I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the planning-initiative skill" "(?i)researched:" "(?i)run id:? *`?[0-9a-f]{8}" "dan@example\\.com"
            "(?i)no record" "GRA-20" "GRA-1\\d\\d"]
  :rejects ["docs/agent/specs"]
  :log-expects ["^--version$"
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
description: Use when the user names a Reeve initiative to plan (a key such as GRA-12) or asks for initiative discovery — "plan this initiative", "discovery for …", "what do we need to decide before we build …" — and the Reeve planner CLI is installed.
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

1. **Show, confirm, then write.** Show each write before running it. An answer the user already
   gave in the request counts as the confirmation for that write; do not ask it again.
2. **One question at a time**, skipping every question the request already answers.
3. **Branch on the exit status** as the reference says. A failed read in step 1 stops the run:
   every later step depends on it. An error about sign-in or authorization on any call stops the
   run: say it and tell the user to run `reeve auth login`. Any other refused or failed write
   skips that one item (that decision, comment or epic): show the reasons or the message, go on
   with the next item, and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record and the discovery mark come from
   the user, never from you.
5. **Build on what is there.** The planner may already hold a brief, decisions and epics for this
   initiative (an earlier run, a teammate). Reuse them; create only what the user's answers add.
   Whether an existing item covers what the user asked for is your judgment in the conversation,
   shown to the user, never a rule applied to titles.

## Steps

0. **Announce and detect.** First say: "I'm using the planning-initiative skill: everything goes
   into the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
1. **Read.** `reeve initiative show <KEY> --json` (keep `value.brief` and `value.version`),
   `reeve decision ls --on <KEY> --json` and `reeve epic ls --initiative <KEY> --json`. If any of
   them does not exit 0, stop the run: for `not_found` say "The planner has no initiative <KEY>.";
   for an error about sign-in or authorization say it and tell the user to run `reeve auth login`;
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
   lay it out by the template, and show what changes. Then
   `reeve initiative edit <KEY> --brief <md> --version <version> --json`, the Markdown quoted as the
   reference's Arguments section says (single quotes, real newlines, setext headings); keep the new
   `value.version`.
5. **What already exists.** Show the decisions and epics step 1 found and, for each decision and
   epic the user's answers call for, whether an existing one already covers it (say which key or
   id). Steps 6 and 7 create only the ones that are not covered. A re-run on an initiative that
   already has them creates nothing unless the user asks for something new.
6. **Required decisions.** For each open question that is a consequential choice blocking work
   (not a clarification) and has no decision yet: ask who decides and by when, show and run
   `reeve decision require --on <KEY> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
   and keep `value.id`. Then, for each decision, one at a time:
   1. Invoke **recording-decisions** to draft and show its record: "draft only; do not apply;
      it answers required decision #<id>". Note the record's id-to-be.
   2. Ask whether to apply the record now, or take the answer the request gave.
   3. Yes: have recording-decisions apply it with `Required decision: #<id>`; its record step 6
      links the applied record in the planner.
   4. No: run `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`,
      so the decision's thread in the planner carries the pointer. Never link or apply a record
      the user did not say to apply.
7. **Epics.** Propose 2–5 epics, each a deliverable slice with a one-paragraph brief, leaving out
   those step 5 found covered; show them, then for each new one
   `reeve epic create --initiative <KEY> --title <title> --brief <md> --idempotency-key planning-initiative:<KEY>:<run_id>:<n> --json`.
   Each epic gets its own `<n>`.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve initiative discovery <KEY> --complete --version <latest version> --json`.
9. **Re-read.** After the last write, run `reeve decision ls --on <KEY> --json` and
   `reeve epic ls --initiative <KEY> --json` again. The report states what these return, not what
   you remember writing.
10. **Report.** Start with the plain lines `Using the planning-initiative skill.`,
   `Run id: <run_id>` and the `Researched:` line, all unformatted (no bold, so they can be searched
   for; a non-interactive session shows only this report, not the announcement). Then every key written and every existing
   key reused; each required decision from the re-read with its decider, due date and state worded
   by the reference ("no record", "proposed, PR open", …), plus the comment pointer when the record
   is only drafted; each epic from the re-read. End with the next step: "refine an epic with
   refining-epic".

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
What is still open. A consequential choice that blocks work becomes a required decision (step 5);
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
  :prompt "Refine epic GRA-20 in Reeve. Do not ask questions; the answers are given. Done looks like: every match request is processed from the queue within an hour. Boundary: no change to mentor profiles. No new required decisions. Stories: 'Enqueue match requests' with criteria 'a new request is on the queue within a minute' and 'a repeated request is enqueued once'; 'Process the match queue' with criteria 'each queued request gets a match or a reason within an hour' and 'requests are processed oldest first'; 'Alert on a stuck queue' with criteria 'an alert fires when the oldest request is over two hours old' and 'the alert names the stuck request'. Place every untriaged story with the placement tree, except GRA-46, which we won't do; the horizon buckets are Now, Next, Later, Won't do. I confirm every write to the planner. Discovery is not complete yet."
  :workdir "."
  :expects ["(?i)using the refining-epic skill" "(?i)researched:" "(?i)run id:? *`?[0-9a-f]{8}"
            "#7\\W+Queue or cron" "discovery not complete on GRA-20"
            "GRA-42\\b(?:(?!GRA-(?!20\\b)\\d)[\\s\\S]){0,400}discovery not complete on GRA-20"
            "(?i)GRA-40[^\\n]{0,200}\\bbug\\b" "(?i)GRA-41[^\\n]{0,200}\\bchore\\b" "(?i)GRA-42[^\\n]{0,200}this epic"
            "(?i)GRA-43[^\\n]{0,200}new epic under GRA-13" "(?i)GRA-45[^\\n]{0,200}new epic under GRA-12"
            "(?i)GRA-44[^\\n]{0,200}new initiative" "(?i)GRA-46[^\\n]{0,200}won.?t do"]
  :rejects ["docs/agent/specs"]
  :log-expects ["^--version$"
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
                "(?s)^story create .*^story ls --epic GRA-20 --json$(?!.*^(?:epic edit|story create|story edit|epic create|initiative create|epic discovery|decision require|comment add) )"
                "(?s)^story edit .*^decision ls --on GRA-20 --json$(?!.*^(?:epic edit|story create|story edit|epic create|initiative create|epic discovery|decision require|comment add) )"]
  :log-rejects ["--brief-file" "^story edit GRA-42 .*--kind" "^story edit GRA-45 .*--epic GRA-20\\b" "^story (?:edit|mv) GRA-46 "
                "^story mv " "^epic discovery " "^decision require " "^decision link "
                "^story create .*--title (?:Retry failed matches|Show match history) "
                "(?s)^(\\w+ create)\\b[^\\n]*--idempotency-key (\\S+) .*^(?!\\1\\b)\\w+ create\\b[^\\n]*--idempotency-key \\2 "]}
```

What each expectation distinguishes: the three `story create` lines a story without criteria, outside the epic or with a title-derived key; the three-way distinct-key line two stories sharing a key (the planner would replay the first and lose the second); the `:1 … :2` back-reference a counter that does not start at 1 or a run id that changes mid-run, and the log-reject on one key used by two different `… create` commands a per-kind counter (stories `:1–3`, epics `:1–2`: the epic create would replay the story); the seven placements one branch of the placement tree each — GRA-40 (broken behaviour → bug under the covering epic), GRA-41 (internal work → chore), GRA-42 (a queue story GRA-20 covers; a `--kind` on it is rejected), GRA-43 (covered by initiative GRA-13 but none of its epics → new epic there), GRA-45 (covered by GRA-12, the refined epic's own initiative, but not by the queue epic → new epic under GRA-12, and `--epic GRA-20` on it rejected: the counter-example to "covers"), GRA-44 (covered by nothing → new initiative in `Later`, the last bucket before "Won't do", plus an epic under it) and GRA-46 (won't do: any `story edit` or `story mv` on it rejected); a skill that only offers "this epic or leave it" fails five of them, and since the fake refuses (unlogged) a write naming an epic nobody created, a guessed `--epic GRA-1xx` satisfies nothing; the transcript lines naming each placement's branch a report that lists writes without the tree; the `story ls --epic` and `decision ls --on` reads pinned after the last write a report quoting a listing that later writes made stale; the transcript's "#7 … Queue or cron", "discovery not complete on GRA-20" and GRA-42 followed by that reason (GRA-42 gets it only after its move) a readiness summary invented, copied from the skill or the reference, or read before the placements, rather than quoted from the planner's answer after the last write; the announce line and `^--version$` a skill that skips step 0; `epic edit … --version 2` a guessed version; `decision require`, `decision link`, `epic discovery` and `story mv` rejected, a skill that creates decisions, links records, marks discovery or moves delivery the user did not ask for; a `story create` for the fixture's GRA-31/GRA-32 rejected, a skill that recreates existing stories. The `--brief-file` reject cannot fire (the fake does not log an invalid call); it documents the flag the first draft invented.

- [ ] **Step 2: Run it, see it fail**

Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-refining-epic` — Expected: `[FAIL]`. Without the skill a model that finds `references/reeve-cli.md` gets most of the way; the run that built this task missed the announce line and the placement of the original GRA-42 ("Mentees can pause matching for a month"), which it put in a new initiative. The fixture now titles GRA-42 as a plain queue story and adds GRA-45 as the counter-example, so the skill's one-sentence definition of "covers" is tested both ways.

- [ ] **Step 3: The skill**

`skills/refining-epic/SKILL.md`:

````markdown
---
name: refining-epic
description: Use when the user names a Reeve epic to refine (a key such as GRA-20), asks to break an epic into stories or write its stories and acceptance criteria, or asks to place or triage untriaged stories — and the Reeve planner CLI is installed.
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

1. **Show, confirm, then write.** Show each write before running it. An answer the user already
   gave in the request counts as the confirmation for that write; do not ask it again.
2. **One question at a time**, skipping every question the request already answers.
3. **Branch on the exit status** as the reference says. A failed read in step 1 stops the run:
   every later step depends on it. An error about sign-in or authorization on any call stops the
   run: say it and tell the user to run `reeve auth login`. Any other refused or failed write
   skips that one item (that story, placement, decision or comment): show the reasons or the
   message, go on with the next item, and list what was skipped in the report.
4. **The user decides.** Deciders, due dates, applying a record, a story's home and the discovery
   mark come from the user, never from you; you propose.
5. **Build on what is there.** The planner may already hold a brief, decisions and stories for
   this epic. Reuse them; create only what the user's answers add. Whether an existing item covers
   what the user asked for is your judgment in the conversation, shown to the user, never a rule
   applied to titles.
6. **Readiness is the planner's.** Report what `story ls` returns after the last write, in the
   reference's words; never judge readiness yourself (kb/ADR-0003 R1).

## Steps

0. **Announce and detect.** First say: "I'm using the refining-epic skill: everything goes into
   the Reeve planner." Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>." and stop; this skill has no fallback. Keep `bin` and `run_id`.
   **No epic named** (for example "triage the untriaged stories"): run
   `reeve story ls --untriaged --json`, show the stories, say that this skill works on one epic,
   ask which epic to refine (or which epic a story should go to), and stop until the user
   answers. When nobody can answer (a non-interactive session), say that an epic key is required
   and stop. Never pick an epic yourself.
1. **Read.** `reeve epic show <EPIC> --json` (keep `value.brief`, `value.version` and
   `value.initiative`), then `reeve initiative show <INITIATIVE> --json` for that initiative,
   `reeve decision ls --on <EPIC> --json`, `reeve story ls --epic <EPIC> --json`,
   `reeve story ls --untriaged --json`, `reeve epic ls --json` and `reeve initiative ls --json`.
   If any of them does not exit 0, stop the run: for `not_found` say "The planner has no epic
   <EPIC>." (or the item it names); for an error about sign-in or authorization say it and tell
   the user to run `reeve auth login`; otherwise show the code and message. In parallel, dispatch
   the **knowledge-reader** with the epic's title and "Prioritise domain context and architecture
   patterns.", and the **architect** in `survey` mode on the repositories the brief or the user
   names.
2. **Discovery conversation.** One question at a time: what done looks like, the boundaries, what
   is unknown.
3. **Research.** For each open question from step 2 that research can answer, look it up: web
   search or documentation when the session has them, otherwise the knowledge base and the code.
   Say what you looked up and what it answered in one line, `Researched: <topics and findings>`,
   or `Researched: nothing — no open question is answerable by research`.
4. **Brief.** Start from the existing `value.brief`: keep what still holds, fold in the answers,
   and show what changes. Then `reeve epic edit <EPIC> --brief <md> --version <version> --json`;
   keep the new `value.version`.
5. **Required decisions.** Show the decisions step 1 found; those with `record: null` stay open
   and go into the report. Only for a consequential choice the user names that blocks work and
   has no decision yet: ask who decides and by when, show and run
   `reeve decision require --on <EPIC> --title <title> --decider <email> [--due YYYY-MM-DD] --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
   then invoke **recording-decisions** to draft its record ("draft only; do not apply; it answers
   required decision #<id>"). Apply it only when the user says so (recording-decisions applies it
   with `Required decision: #<id>`); otherwise run
   `reeve comment add --decision <id> --body 'Draft <id-to-be>: <title> — apply and link with /lore:adr link <id-to-be> to decision <id>' --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`.
   When the user says there are no new required decisions, create none.
6. **Stories.** Propose stories, each finishable by one person or one agent session, each with
   2–6 acceptance criteria written as observable outcomes, leaving out what an existing story
   from step 1 already covers (say which key). Show them, then for each new one
   `reeve story create --epic <EPIC> --title <title> --kind story --criterion <text> --criterion <text> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
   one `--criterion` per criterion.
7. **Placement tree.** For each story from `story ls --untriaged`, classify it, propose its home
   with the branch that led there, and on confirmation write it (`<v>` is the story's `version`
   from the listing; covering epics and initiatives come from `epic ls` and `initiative ls`):
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
     3. else a new initiative in the last horizon bucket before "Won't do":
        `reeve initiative create --title <title> --horizon <bucket> --brief <md> --idempotency-key refining-epic:<EPIC>:<run_id>:<n> --json`,
        an epic under it as in 2, then the `story edit`. The CLI does not list the buckets: ask for
        them (offering the horizons seen in `initiative ls`), or take them from the request.
   - **Won't do**, or the user says "leave it untriaged": write nothing for it.
   `--kind` on `story edit` comes with Reeve plan C (Task 5); a planner without it answers a
   usage error (exit 1). Then run the same edit again without `--kind` (the story keeps its kind
   and still gets its home), and say so in the report.
8. **Discovery mark.** Ask whether discovery is complete, or take the answer the request gave;
   only on yes run `reeve epic discovery <EPIC> --complete --version <latest version> --json`.
9. **Re-read.** After the last write (the discovery mark, or the last placement when there is
   none), run `reeve story ls --epic <EPIC> --json`, `reeve decision ls --on <EPIC> --json` and
   `reeve story ls --untriaged --json`. Completing discovery and placing stories change the
   readiness reasons, so these are the last reads of the run and the only ones the report quotes.
10. **Report.** Start with the plain lines `Using the refining-epic skill.`, `Run id: <run_id>`
   and the `Researched:` line, all unformatted (no bold, so they can be searched for; a
   non-interactive session shows only this report, not the announcement). Then:
   - every key written and every existing key reused, and every item skipped with its reason;
   - each placement on one line: the story's key, its title and its branch, named `bug`,
     `chore`, `this epic`, `another epic <KEY>`, `new epic under <INITIATIVE>`,
     `new initiative`, `won't do` or `left untriaged`;
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
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "\\?"]
  :rejects ["(?i)reeve|story context"]
  :log-rejects ["."]}

 {:name "reeve-brainstorming-story-context"
  :requires ["reeve-fake"]
  :allowed-tools ["Bash(reeve *)"]
  :prompt "/lore:brainstorming add a retry policy for story GRA-31. The answers are given: retries cover failed matches only, at most three attempts. Stop after presenting the project context, including the open required decisions, and your first clarifying question."
  :workdir "."
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "(?s)\\A[^?]*Queue or cron.*\\?" "(?i)open required decision #7\\W+Queue or cron\\W+\\(no record\\)"]
  :rejects ["docs/agent/specs/"]
  :log-expects ["^--version$" "^auth status --json$" "^story context GRA-31 --json$"]}

 {:name "reeve-brainstorming-story-key-without-planner"
  :prompt "/lore:brainstorming add a retry policy for story GRA-31"
  :workdir "."
  :expects ["Using the brainstorming skill: no code until the design is approved\\." "\\?"]
  :rejects ["(?i)reeve|planner|story context|not available|signed out" "docs/agent/specs/"]}
```

What they distinguish: `story-context` also fixes the order, with the decision's title (the fixture's "Queue or cron") in the transcript before the first question mark and a question after it; the announce sentence is required in all four, so an empty skill body fails each of them. `no-story-key` (the log must stay empty; the prompt carries `SHA-256`, a `<PREFIX>-<n>` token that is not a story) a planner read that runs on every brainstorming session or on any key-shaped token; `story-context` a skill that does not read the bundle (log), reads it but does not list the open decision in the skill's own line ("open required decision #7 — Queue or cron (no record)"), or misreads `check.kind: unchecked` as satisfied instead of deriving "no record" from `record: null`; `story-key-without-planner` (no `:requires`, so no fake and no planner) a planner read that, with the planner absent, talks about it ("not available", "signed out") instead of skipping silently. `story-key-without-planner` is appended at the end of `test/scenarios.edn`.

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
`"present":true` and `"signed_in":true`, skip the rest without mentioning the planner. Otherwise
read `<plugin-root>/references/reeve-cli.md` and run `reeve story context <KEY> --json` (the
detector's `bin` as the first word). If it does not exit 0, say so in one line (the planner has no
story <KEY>, and an epic or initiative key is not a story; for a sign-in error, run
`reeve auth login`) and go on with checklist item 1 without planner context. On exit 0, the
story's title, description and criteria, the initiative and epic briefs, the required decisions,
the blockers and the comments are project context for item 1.
```

Append to item 1 (after "…rather than quietly violate it."):

```markdown
   With a planner bundle (*Planner Context*), list each open required decision among the binding
   decisions as "open required decision #<id> — <title> (<status>)". Open means `record: null`
   (status "no record") or a `check.kind` other than `accepted`; word the status as the CLI
   reference says. The design either waits for it or decides it now; then step 5 drafts its record.
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
- Modify: `skills/recording-decisions/SKILL.md`, `skills/recording-decisions/actions/record.md`
- Test: `test/scenarios.edn` (new `command-adr-triages-process-decision`, `reeve-adr-link-proposed`, `reeve-adr-link-check-unreadable`, `reeve-adr-link-ride-along`; the existing `command-adr-new-triages-and-interviews` gains a reject)

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
  :prompt "/lore:adr link kb/ADR-0002 to decision 7 in Reeve. Do not ask questions; the answers are given: the planner calls this repository lore, the PR proposing the record is https://github.com/example/test-workspace/pull/9, and the household is the current directory."
  :workdir "."
  :expects ["proposed, PR open"]
  :rejects ["(?i)could not run"]
  :log-expects ["^decision link 7 (?=.*--record kb/ADR-0002\\b)(?=.*--repo lore\\b)(?=.*--path knowledge/adrs/0002-inventory-reservation\\.md\\b)(?=.*--pr https://github\\.com/example/test-workspace/pull/9\\b).*--json$"]}

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
  :allowed-tools ["Bash(reeve *)" "Bash(git *)" "Bash(node *)"]
  :prompt "/lore:adr record: backend retries failed payment webhooks at most three times, because the queue cannot absorb more. It answers required decision 7 in Reeve. Do not ask questions; the answers are given: decided by Dan Doe; low tier, local home backend; apply it as a ride-along on the current branch (first create and switch to a branch feat/retry); the planner calls this repository backend."
  :workdir "backend"
  :expects ["(?i)rides along on branch feat/retry" "/lore:adr link backend/ADR-\\d{4} to decision 7"]
  :rejects ["(?i)linked:"]
  :log-expects ["^comment add (?=.*--decision 7\\b)(?=.*rides along on branch feat/retry)(?=.*--idempotency-key \\S+:7:[0-9a-f]{8}:\\d+\\b).*--json$"]
  :log-rejects ["^decision link "]}
```

It runs in the `backend` fixture, the same repository `command-adr-triages-process-decision` names. What it distinguishes: a ride-along apply that links straight away with the updater's (absent) PR url, from one that leaves the planner pointer and tells the user the sentence; the log has the comment and no `decision link`.

What they distinguish: `link-proposed` a link that needs an apply first (impossible here), a wrong path (absolute, or relative to the household instead of the repository), a missing `--pr`, and an answer not read from `check.kind`; `link-check-unreadable` a skill that applies "exit 1 → failure" to a link that in fact succeeded.

- [ ] **Step 2: Run them, see them fail**

Run: `bb test/run-tests.clj --filter command-adr-triages` — Expected: `[FAIL]`, "meeting notes" or "RFC" present (old step 3). Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-adr-link` — Expected: 2 `[FAIL]` (no link action; the log has no `decision link`) and the ride-along scenario `[FAIL]` (no planner pointer comment).

- [ ] **Step 3: `actions/link.md`**

````markdown
# link

Link a record to a required decision in the Reeve planner, so the planner checks the record
instead of reporting "no record". Read `<plugin-root>/references/reeve-cli.md` first. This writes
nothing into the record or any repository (kb/ADR-0004 R3): it stores one reference in the planner.

1. **Detect.** Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints
   `"present":true` and `"signed_in":true`, say "The Reeve planner is not available in this
   session: <reason>; nothing was linked." and stop.
2. **Inputs.** Take each from the request or the caller (record step 6); ask, one at a time, only
   for what is missing:
   - the decision id, an integer ("decision 7", "#7");
   - the record's qualified id, repository and repository-relative path. From record step 6 these
     are the knowledge-updater's report (below) and need no index lookup: the updater's worktree
     is gone by then and the user's checkout does not contain the record. For a record that
     already exists in a checkout (the standalone `link` action), take its file from
     `node <plugin-root>/scripts/adr-lint.js index --json` (`records[].id` → `records[].file`);
     an id the index lacks: say so and stop, unless the user gave the repository, `--path` and PR
     explicitly, which are then used as given;
   - the household directory: the current directory unless the user names another;
   - the repository name as configured in the planner: no `reeve` command lists the planner's
     repositories, so ask, offering the `household.json` repository whose directory holds the
     file;
   - the record's path inside that repository: the file's path relative to `<household>/<repo>`,
     or to the household itself when its directory name is the repository name;
   - the PR proposing the record: the url in the request or the report, else `gh pr view --json url --jq .url`
     run in the repository on the record's branch when `gh` is available, else ask; a record
     already merged to the default branch has none (omit `--pr`).
3. **Show and run.** The request (or the apply the user confirmed) naming the record and the
   decision is the confirmation:
   `reeve decision link <id> --record <qualified id> --repo <repo> --path <path> --pr <url> --household <household> --json`
4. **Report** the answer with the reference's *decision link* table, word for word: exit 0 is
   "Linked: <record> answers decision #<id> — <check>"; exit 1 with an `ok` envelope is "Linked;
   the check could not run here: <stderr line>; it runs on the next scheduled check."; exit 2 or
   an `error` envelope shows the reasons or the message and says nothing was linked.
````

- [ ] **Step 4: `SKILL.md` and `actions/record.md`**

`skills/recording-decisions/SKILL.md`:
- Description: append before "Not for PR approvals…": `when a record should be linked to a required decision in the Reeve planner;`.
- Rule 3, append: `A planner link (actions/link.md) is not a record write: the request naming the record, the decision and the PR confirms it.`
- *Understand the request*: add the example `/lore:adr link kb/ADR-0007 to decision 7` and the table row `| link an applied record to a required decision in the planner ("link kb/ADR-0007 to decision 7") | **link** |`.
- The action list in "Read `<plugin-root>/skills/recording-decisions/actions/<action>.md` (…)" gains `link`.
- *Where a change lands*, append: `When the Reeve planner is present and the record answers a required decision, the record action links it after apply (actions/link.md); a link never changes the record.`

`skills/recording-decisions/actions/record.md`:
- Step 3, replace "a decision with no code behind it (a tool, a process) belongs in an RFC or meeting notes." with: "A decision with no code behind it (a tool, a process, a product choice) is a record like any other when it is hard to reverse or the user wants one: same format, its `scope` names the documents or repositories it governs; never send it to an RFC or meeting notes (kb/ADR-0004 R5)." This change is unconditional (Design choices).
- Step 6, append: "Then, only when a decision id is known — the user named one, the spec entry the draft came from carries `Required decision: #<id>` (outside the record text), or a planning skill passed one — act on the knowledge-updater's report, never on the current checkout's index (the updater's own-pr worktree is removed before it returns, so the record is not in the index). The report supplies: the record's qualified id (the id the draft was numbered with), the repository (the home's `repo` from the homes JSON the updater was given; the planner's name for it is asked as link.md says), the repository-relative path (the report's *Files changed* entry for that record), the PR url and the branch. Where the report says the change landed:
  - *opened PR <url>*, *committed to PR <url>*: follow `actions/link.md` with those inputs; its step 1 skips it when the planner is absent. A link that is refused or cannot check never undoes the apply.
  - *staged on your branch `<branch>`, not committed* (a ride-along; there may be no upstream and no PR yet): do not link. When the planner is present (link.md step 1), run `reeve comment add --decision <id> --body 'Record <qualified id> at <repo>:<path> rides along on branch <branch>; link it with /lore:adr link <qualified id> to decision <id> once the implementing PR is open' --idempotency-key <skill>:<id>:<run_id>:<n> --json` (the key's skill and run id from the calling skill, else `recording-decisions` and the detector's `run_id`), and tell the user that same sentence. The link is made later by the standalone `link` action, once the PR exists (`--pr` from the request, else `gh pr view`)."

- [ ] **Step 5: Run them, see them pass**

Run: `bb test/run-tests.clj --filter command-adr` — Expected: every `command-adr-…` scenario passes, including the new triage one. Run: `bb test/run-tests.clj --with reeve-fake --filter reeve-adr-link` — Expected: 3 `[PASS]`.

- [ ] **Step 6: Mutation checks**

Empty `actions/link.md`: both `reeve-adr-link-proposed` and `-check-unreadable` fail. Remove the ride-along bullet from record step 6: `reeve-adr-link-ride-along` fails. Restore the old step 3 sentence: `command-adr-triages-process-decision` fails. Restore both.

- [ ] **Step 7: Commit**

```bash
git add skills/recording-decisions test/scenarios.edn
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
description: Use when the user names a Reeve initiative to plan or asks for initiative discovery, and the Reeve planner CLI is installed.
---

# Lore planning initiative

Read `../../references/codex-runtime.md`, resolve the knowledge paths, then follow
`../../skills/planning-initiative/SKILL.md`. The user's words are the request.
````

````markdown
---
name: lore-refining-epic
description: Use when the user names a Reeve epic to refine, asks to break an epic into stories with acceptance criteria, or asks to place untriaged stories, and the Reeve planner CLI is installed.
---

# Lore refining epic

Read `../../references/codex-runtime.md`, resolve the knowledge paths, then follow
`../../skills/refining-epic/SKILL.md`. The user's words are the request.
````

- [ ] **Step 2: Router rows**

In `hooks/load-standards-reminder.sh`, inside `SKILL_ROUTER`, after the `CREATIVE WORK` entry (`-> Use the brainstorming skill (design before code, always)`), insert:

```
\n\n- PLANNING AN INITIATIVE in the Reeve planner (an initiative key, \"plan this initiative\", discovery, what must be decided first)\n  -> Use the planning-initiative skill (only when the reeve CLI is installed)\n\n- REFINING AN EPIC in the Reeve planner (stories with acceptance criteria, \"break this down\", placing untriaged stories)\n  -> Use the refining-epic skill (only when the reeve CLI is installed)
```

Run: `node --test scripts/__tests__/load-standards-hook.test.js` — Expected: pass (the hook still emits valid JSON).

- [ ] **Step 3: README and CLAUDE.md**

`README.md`, *Skills (Auto-Invoked)* table, after the `recording-decisions` row:

```markdown
| `planning-initiative` | Planning a Reeve initiative: discovery, brief, required decisions, epics (only with the Reeve planner) |
| `refining-epic` | Refining a Reeve epic: stories with acceptance criteria, placing untriaged stories (only with the Reeve planner) |
```

and after the table a paragraph: "**Reeve planner.** Optional. When a `reeve` CLI on the path reports `reeve-planner` and you are signed in (`reeve auth login`), the two skills above write into the planner, brainstorming reads a named story's context first, and `/lore:adr link` links a record to a required decision. Nothing to configure; without it every skill behaves as before."

`CLAUDE.md`, *Zero-runtime principle*, after the `adr-lint.js` paragraph: "The second exception is `scripts/reeve-detect.js`: every skill that touches the Reeve planner must agree on whether it is present and signed in (kb/ADR-0005 R1: `reeve --version` reports `reeve-planner`, `reeve auth status --json` is ok), with a timeout so a hanging binary never hangs a session — one tested script instead of the same two checks written into five skills. It reads nothing from a knowledge base and writes nothing." In the overview paragraph (line 7), the script list gains `reeve-detect.js`.

- [ ] **Step 4: Version 3.2.0**

Set `"version": "3.2.0"` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json` (minor: new skills, CLAUDE.md *Version bumps are mandatory*).

- [ ] **Step 5: Full runs**

```bash
node --test scripts/__tests__/*.test.js
bb test/run-tests.clj --with reeve-fake --filter reeve-
bb test/run-tests.clj
```

Expected: every Node test passes; the second command runs the nine `reeve-…` scenarios (`reeve-runner-selftest`, `reeve-planning-initiative`, `reeve-refining-epic`, the three `reeve-brainstorming-…`, the three `reeve-adr-link-…`) and all pass; the third prints `[SKIP]` for the eight that require `reeve-fake` and passes every other scenario, including `reeve-brainstorming-without-planner`, `command-adr-triages-process-decision` and the updated `command-adr-new-triages-and-interviews`. Use `--runs 3 --min 2` on a scenario that fails once to see whether it is flaky before changing a skill.

- [ ] **Step 6: Commit, PR and the marketplace companion**

```bash
git add skills hooks README.md CLAUDE.md .claude-plugin .codex-plugin package.json
git commit -m "feat(skills): reeve planning skills in the router, readme and codex twins (3.2.0)" -m "Task 6 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Open the PR. Then, as CLAUDE.md's *Version bumps are mandatory* requires, open the companion PR in `Mindful-Stack/witan` that sets the `lore` entry's `version` in `.claude-plugin/marketplace.json` to `3.2.0`, and link each PR from the other; the marketplace PR merges after this one.

---

## Environment assumptions pinned

- **Scenario environment**: the runner builds the child's environment explicitly (Task 1 Step 5): every scenario has a fresh empty `REEVE_CONFIG_DIR` and no `REEVE_URL`, `REEVE_TOKEN` or `REEVE_BIN`, so a real `reeve` (this machine has one in `~/.local/bin`, reporting `reeve-planner 0.1.0`) can never reach a server and reports signed out. Fake scenarios put `test/fixtures/reeve-bin` before everything else on `PATH`, including `~/.local/bin`. Whether that prefix survives into the Bash tool's shell (a `~/.bashrc` that re-prepends `~/.local/bin` would defeat it) is checked by `reeve-runner-selftest` before any other reeve scenario counts.
- **Permissions**: `--permission-mode default` with `Bash(reeve *)` added per scenario; skills write the literal command word `reeve`, so the rule matches, and pass Markdown as one single-quoted argument with real newlines and setext headings (no line whose first non-blank character is `#`, no brief starting with `-`): Claude Code's permission check refuses ANSI-C quoting (`$'…'`) and a quoted newline followed by `#`, which would turn an allowed call into a refused prompt under `claude --print`.
- **Non-interactive runs**: `claude --print` is one turn, so every reeve scenario prompt gives every answer; recording-decisions drafts stay draft-only; the only executed writes go to the fake.
- **The real CLI's flags** were read from `crates/reeve/src/commands/*.rs` in ~/Source/reeve on 2026-10-26; `story edit --kind` comes with Reeve plan C (Task 5). The wire shapes come from `crates/reeve-server/tests/snapshots/openapi.json`.
- **Detection timeout**: `execFileSync` with `timeout` kills the child with SIGTERM and returns at the timeout (verified with a `sleep` child holding stdout); the detector reports `present: false`.
- **Without `bb`** (Babashka) no scenario runs; the Node tests still do.

## Self-review notes

- Spec coverage ("Lorekeeper integration"): detection → Task 1; the two planning skills with architect survey, research, brief, required decisions with a decider and a drafted record each, epics, stories with criteria → Tasks 2–3; the placement tree against `story ls --untriaged` → Task 3 step 6; `story context` as the bundle → Task 4; recording-decisions' link and triage change → Task 5. Not in this plan: an MCP server (kb/ADR-0005 R5 permits one later).
- Spec drift: the spec links "when it drafts a record"; this plan links at apply, when the path and the PR exist, and leaves a pointer (a planner comment, or `Required decision: #<id>` in the spec) for drafts not applied in the session. The spec's Lorekeeper section should say the same.
- Spec-conflict: the spec calls the untriaged placement "the triage skill"; this plan places it inside refining-epic (kb/ADR-0005 R4 names only two planning skills).
- Would-it-fail: every write a scenario expects is asserted in the fake's log, which only an executed command produces, with a fresh log per run; transcript expectations are fixture-specific ("Queue or cron", "no acceptance criteria", "decision: no record", "proposed, PR open"); each new skill has a mutation check; the detector tests include the renamed runner, a lookalike, the real signed-out shape, a missing binary and a hang; the fake has its own tests.
- Governing decisions: no task weakens the brainstorming gate or its checklist; no skill produces a spec; every command carries `--json` and every create a run-scoped idempotency key; no manifest change; triage is unconditional because kb/ADR-0004 R5 does not depend on the planner, and every planner-dependent step is guarded by the detector (kb/ADR-0005 R1).
