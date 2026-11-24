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
    assert.deepEqual(out, { present: true, signed_in: true, url: 'http://127.0.0.1:7474', email: 'dan@example.com', bin, update_offered: false, reason: '' });
    assert.match(run_id, /^[0-9a-f]{8}$/);
  }
});

// kb/ADR-0030 R6: `reeve auth status --json` reports the two builds as cli.current and cli.server.
test('an update is offered only when both builds are known and differ', () => {
  const A = '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432';
  const B = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  const withCli = (cli) => OK.replace('"token_kind":"interactive"}', `"token_kind":"interactive","cli":${JSON.stringify(cli)}}`);
  for (const [cli, offered, why] of [
    [{ current: A, server: B }, true, 'different builds'],
    [{ current: B, server: A }, true, 'an older build offered is still offered (R7)'],
    [{ current: A, server: A }, false, 'equal builds'],
    [{ current: null, server: B }, false, 'an unstamped CLI'],
    [{ current: A, server: null }, false, 'a server that offers none'],
    [{ current: A, server: 'not-a-build' }, false, 'a value that is not a build'],
  ]) {
    const { bin } = fake("echo 'reeve-planner 0.8.0'", withCli(cli));
    const out = detect(bin);
    assert.equal(out.signed_in, true, why);
    assert.equal(out.update_offered, offered, why);
  }
  const { bin } = fake("echo 'reeve-planner 0.8.0'", OK);
  assert.equal(detect(bin).update_offered, false, 'a CLI that reports no cli object');
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
