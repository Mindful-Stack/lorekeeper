// scripts/__tests__/reeve-real-server.test.js — node --test
// Every row of references/reeve-cli.md's *Commands* table has exactly one entry in test/fixtures/reeve-real/commands.json
// (always checked). Tasks 3 and 4 of the smoke's plan add: the entries against the fake on both sides, a broken fake
// blamed as the fake, and the live run against a real planner.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const s = require('./helpers/reeve-smoke');

const root = path.join(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'reeve-real', 'commands.json'), 'utf8'));

const rows = s.commandRows(fs.readFileSync(path.join(root, 'references', 'reeve-cli.md'), 'utf8'));

test('every Commands row has exactly one smoke entry covering its forms and its Read cell', () => {
  assert.deepEqual(s.coverageProblems(rows, fixture), []);
});

const clone = () => JSON.parse(JSON.stringify(fixture));
const entryOf = (f, start) => f.entries.find((e) => e.row.startsWith(start));
test('the real fixture fails coverage when a form loses its run or is run twice', () => {
  let f = clone();
  delete entryOf(f, '`reeve story ls').alternates;
  assert.ok(s.coverageProblems(rows, f).some((p) => /no run covers the form story ls --untriaged --json$/.test(p)));
  f = clone();
  entryOf(f, '`reeve story ls').alternates = [entryOf(f, '`reeve story ls').argv];
  assert.ok(s.coverageProblems(rows, f).some((p) => /2 runs cover the form story ls --epic <KEY> --json$/.test(p)));
  f = clone();
  delete entryOf(f, '`reeve comment add').alternates;
  assert.ok(s.coverageProblems(rows, f).some((p) => /no run covers the form comment add --story <KEY>$/.test(p)));
});
test("the real fixture fails coverage when its reads stop reaching the reference's Read cell", () => {
  const f = clone();
  Object.assign(entryOf(f, '`reeve story context'), { reads: ['value.story'], types: { 'value.story': 'object' }, may_be_empty: [] });
  const dropped = s.coverageProblems(rows, f).filter((p) => /^`reeve story context .*the reference's Read names/.test(p));
  assert.deepEqual(dropped.map((p) => p.match(/names (\S+),/)[1]), ['value.epic', 'value.initiative', 'value.required_decisions[]', 'value.blockers[]', 'value.comments[]', 'value.readiness']);
  const grow = (start, extra) => rows.map((x) => (x.row.startsWith(start) ? { ...x, read: `${x.read}, ${extra}` } : x));
  assert.deepEqual(s.coverageProblems(grow('`reeve story context', '`value.links[]`'), fixture),
    ["`reeve story context <KEY> --json`: the reference's Read names value.links[], which no read reaches (read it, or list it in unread with a reason)"]);
  // decision show reads "the same fields" as decision ls: deleting one of its reads fails (review round 3); the list's
  // waivers for closed's fields carry over, so the committed show entry needs none of its own
  const shown = clone();
  const show = entryOf(shown, '`reeve decision show');
  show.reads = show.reads.filter((x) => x !== 'value.title');
  delete show.types['value.title'];
  assert.deepEqual(s.coverageProblems(rows, shown),
    ["`reeve decision show <id> --json`: the reference's Read names value.title, which no read reaches (read it, or list it in unread with a reason)"]);
  // both names already appear in the decision ls reads (value[].record, value[].check.kind), but not this path (review round 2)
  // (decision show inherits the list's fields, so it is required there too)
  assert.deepEqual(s.coverageProblems(grow('`reeve decision ls', '`record.kind`'), fixture), [
    "`reeve decision ls --on <KEY> --json`: the reference's Read names value[].record.kind, which no read reaches (read it, or list it in unread with a reason)",
    "`reeve decision show <id> --json`: the reference's Read names value.record.kind, which no read reaches (read it, or list it in unread with a reason)",
  ]);
});

const FAKE = path.join(root, 'test', 'fixtures', 'reeve-bin', 'reeve');
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-smoke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// Nothing of the developer's planner, login or fake modes reaches a child.
function baseEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('REEVE_') || k === 'XDG_CONFIG_HOME') delete env[k];
  return env;
}
const fakeSide = (bin, dir) => ({ bin, env: { ...baseEnv(), REEVE_CONFIG_DIR: dir, REEVE_FAKE_LOG: path.join(dir, 'log') } });
const selfScope = (dir) => ({ run_id: crypto.randomBytes(4).toString('hex'), household: dir, email: 'dan@example.com', repo: 'kb', record: { id: 'kb/ADR-0001', path: 'adrs/0001-x.md' } });

test('the seed and every entry run against the fake on both sides', (t) => {
  const results = s.runSmoke({ fixture, real: fakeSide(FAKE, tmp(t)), fake: fakeSide(FAKE, tmp(t)), scope: selfScope(tmp(t)), expect: false });
  assert.deepEqual(results.filter((r) => r.problems.length), []);
});
test("a field the fake drops is reported as the fake's to fix", (t) => {
  const src = fs.readFileSync(FAKE, 'utf8');
  const from = 'target_month: null, discovery_complete: null,';
  assert.equal(src.split(from).length, 2, 'the break must hit exactly the initiative builder');
  const dir = tmp(t);
  const broken = path.join(dir, 'reeve');
  fs.writeFileSync(broken, src.replace(from, 'target_month: null, discovery_done: null,'), { mode: 0o755 });
  const results = s.runSmoke({ fixture, real: fakeSide(FAKE, tmp(t)), fake: fakeSide(broken, tmp(t)), scope: selfScope(tmp(t)), expect: false });
  const show = results.find((r) => r.row === '`reeve initiative show <KEY> --json`');
  assert.ok(show.problems.some((p) => /^fake: the fake's answer has no value\.discovery_complete \(the planner's has it\); fix test\/fixtures\/reeve-bin\/reeve$/.test(p)), show.problems.join('\n'));
  assert.deepEqual(results.flatMap((r) => r.problems).filter((p) => !p.startsWith('fake: ')), [], 'only the fake is blamed');
});
