#!/usr/bin/env node
// scripts/reeve-detect.js — is the Reeve planner present and is the user signed in? (kb/ADR-0005 R1)
// Prints one JSON line and always exits 0. REEVE_BIN overrides the binary (tests);
// REEVE_DETECT_TIMEOUT_MS overrides the 10 s timeout per call (tests).
// update_offered: the server offers a CLI build other than this one (kb/ADR-0030 R6, R8), read from
// `cli.current` and `cli.server` in `reeve auth status --json`; false whenever either is missing.
'use strict';
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const bin = process.env.REEVE_BIN || 'reeve';
const timeout = Number(process.env.REEVE_DETECT_TIMEOUT_MS) || 10_000;
const result = { present: false, signed_in: false, url: null, email: null, bin, run_id: crypto.randomBytes(4).toString('hex'), update_offered: false, reason: '' };

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
// A build is a 40-character hex CLI version; null means an unstamped CLI, or a server that offers none.
const isBuild = (b) => typeof b === 'string' && /^[0-9a-f]{40}$/.test(b);
const cli = envelope.value?.cli;
result.update_offered = isBuild(cli?.current) && isBuild(cli?.server) && cli.current !== cli.server;
finish('');
