'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const fake = path.join(__dirname, '..', '..', 'test', 'fixtures', 'reeve-bin', 'reeve');
function run(args, env = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log, ...env } });
  return { status: r.status, envelope: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout, stderr: r.stderr, log: fs.readFileSync(log, 'utf8') };
}

test('every call is one log line, newlines flattened', () => {
  const r = run(['epic', 'create', '--initiative', 'GRA-12', '--title', 'A', '--brief', 'one\ntwo', '--idempotency-key', 'k', '--json']);
  assert.equal(r.status, 0);
  assert.equal(r.log, 'epic create --initiative GRA-12 --title A --brief one two --idempotency-key k --json\n');
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
test('a call without --json is refused', () => {
  assert.equal(run(['epic', 'show', 'GRA-20']).status, 1);
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
