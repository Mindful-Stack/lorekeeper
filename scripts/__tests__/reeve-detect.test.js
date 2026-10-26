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
