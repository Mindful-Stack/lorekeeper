// scripts/__tests__/reeve-reference.test.js — node --test
// Every `reeve … --json` command the reference and the skills write, with its placeholders filled,
// must parse: against the fake always, and against the real CLI when REEVE_REAL_BIN names a
// reeve-planner binary (with an empty config it answers a JSON `internal` "no server url" envelope
// when clap accepted the command, and nothing on stdout when clap refused it). With REEVE_REAL_BIN
// set it also checks the other direction: every flag the real CLI's `--help` lists for a command the
// reference documents is mentioned by the reference. Run it against a build with:
//   REEVE_REAL_BIN=/path/to/reeve node --test scripts/__tests__/reeve-reference.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { commandWords } = require('./helpers/reeve-smoke');

const root = path.join(__dirname, '..', '..');
const SOURCES = ['references/reeve-cli.md', 'skills/planning-initiative/SKILL.md', 'skills/refining-epic/SKILL.md',
  'skills/brainstorming/SKILL.md', 'skills/recording-decisions/actions/link.md', 'skills/recording-decisions/actions/record.md',
  'references/decision-triage.md'];
const FAKE = path.join(root, 'test', 'fixtures', 'reeve-bin', 'reeve');
const PLACEHOLDERS = {
  KEY: 'GRA-12', EPIC: 'GRA-20', INITIATIVE: 'GRA-12', 'COVERING-EPIC': 'GRA-20', 'COVERING-INITIATIVE': 'GRA-12',
  'new epic': 'GRA-20', id: '7', 'id-to-be': 'kb/ADR-0002', n: '1', v: '1', version: '1', 'latest version': '1',
  run_id: '0a1b2c3d', key: 'planning-initiative:GRA-12:0a1b2c3d:1', prefix: 'recording-decisions:7', title: 'Title',
  md: 'Brief', text: 'Criterion', email: 'dan@example.com', 'YYYY-MM': '2027-03', ref: 'PIB-30', delivery: 'todo', label: 'migrated', bucket: 'Later', 'qualified id': 'kb/ADR-0002', 'front-matter id': 'kb/ADR-0002',
  repo: 'lore', 'path in repo': 'knowledge/adrs/0002-x.md', path: 'knowledge/adrs/0002-x.md', url: 'https://github.com/example/w/pull/9',
  household: '.', dir: '.', branch: 'feat/x',
  'brief file': path.join(root, 'test', 'fixtures', 'reeve-bin', 'brief.md'), 'description file': path.join(root, 'test', 'fixtures', 'reeve-bin', 'brief.md'), 'the new epic or initiative, its title and where it goes': 'new epic under GRA-13',
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

// The reverse direction. A command the reference documents is `reeve <group> <verb>` from any of its
// `reeve … --json` spans; the reference mentions a flag for it when the flag appears in one of those
// spans or on the same line as one (a table row's Read cell, an "(or `--story <KEY>`)" note).
// HELP_ONLY lists flags the reference leaves out on purpose: --help, and the global --json and --ascii
// (text output only), which every subcommand's --help lists.
const HELP_ONLY = new Set(['--help', '--json', '--ascii']);
const flagsIn = (text) => text.match(/--[a-z][a-z0-9-]*/g) || [];
function referenceMentions() {
  const file = 'references/reeve-cli.md';
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const mentions = new Map();
  const add = (words, flags) => { if (!mentions.has(words)) mentions.set(words, new Set()); for (const x of flags) mentions.get(words).add(x); };
  const wordsOf = (cmd) => commandWords(cmd.replace(/^reeve\s+/, ''));
  for (const { cmd } of all.filter((c) => c.file === file)) add(wordsOf(cmd), flagsIn(cmd));
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(/`(reeve [^`]*?--json)`/g)) add(wordsOf(m[1]), flagsIn(line));
  }
  return mentions;
}
// The long flags `reeve <words> --help` lists under Options.
function helpFlags(bin, words) {
  const r = run(bin, [...words.split(' '), '--help']);
  assert.equal(r.status, 0, `reeve ${words} --help failed: ${r.stderr.trim()}`);
  return [...r.stdout.matchAll(/^\s+(?:-[A-Za-z], )?(--[a-z][a-z0-9-]*)/gm)].map((m) => m[1]);
}
test('the reference mentions every flag the real CLI lists for the commands it documents (REEVE_REAL_BIN)', { skip: !process.env.REEVE_REAL_BIN && 'REEVE_REAL_BIN is not set' }, () => {
  const bin = process.env.REEVE_REAL_BIN;
  const mentions = referenceMentions();
  assert.ok(mentions.size >= 15, `found ${mentions.size} documented commands`);
  const missing = [];
  for (const [words, mentioned] of mentions) {
    for (const flag of helpFlags(bin, words)) if (!HELP_ONLY.has(flag) && !mentioned.has(flag)) missing.push(`reeve ${words} ${flag}`);
  }
  assert.deepEqual(missing, [], 'flags the real CLI takes that references/reeve-cli.md does not mention (document them, or add them to HELP_ONLY with a reason)');
});
