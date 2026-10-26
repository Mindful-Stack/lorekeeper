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
  return { status: r.status, envelope: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout, stderr: r.stderr, log: fs.readFileSync(log, 'utf8') };
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
