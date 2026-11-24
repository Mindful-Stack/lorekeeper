// scripts/__tests__/reeve-real-server.test.js — node --test
// Keeps the fake `reeve` honest against the real planner. Always run: every row of references/reeve-cli.md's *Commands*
// table has exactly one entry in test/fixtures/reeve-real/commands.json; the seed, entries and refusals (a person's
// commands, which the run's agent token must be refused) run against the fake on both sides; a broken fake is blamed as
// the fake. Live, only when REEVE_SMOKE_SEED is set: the same entries against a
// real planner (REEVE_REAL_BIN, REEVE_URL, REEVE_TOKEN), compared with the fake's answers.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
  assert.ok(s.coverageProblems(rows, f).some((p) => /no run covers the form comment add --decision <id>$/.test(p)));
});
test("the real fixture fails coverage when its reads stop reaching the reference's Read cell", () => {
  const f = clone();
  Object.assign(entryOf(f, '`reeve story context'), { reads: ['value.story'], types: { 'value.story': 'object' }, may_be_empty: [] });
  const dropped = s.coverageProblems(rows, f).filter((p) => /^`reeve story context .*the reference's Read names/.test(p));
  assert.deepEqual(dropped.map((p) => p.match(/names (\S+),/)[1]), ['value.epic', 'value.initiative', 'value.required_decisions[]', 'value.blockers[]', 'value.comments[]', 'value.readiness', 'value.goals[]', 'value.goals[].goal', 'value.goals[].starts_on', 'value.goals[].ends_on', 'value.goals[].via', 'value.attachments[]', 'value.attachments[].id', 'value.attachments[].owner.item', 'value.attachments[].filename',
    'value.story.links[]', 'value.story.links[].type', 'value.story.links[].direction', 'value.story.links[].label', 'value.story.links[].item', 'value.story.links[].item.key', 'value.story.links[].item.level', 'value.story.links[].item.title',
    'value.story.web_links[]', 'value.story.web_links[].id', 'value.story.web_links[].title', 'value.story.web_links[].url']);
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
  assert.deepEqual(s.coverageProblems(grow('`reeve decision ls --on', '`record.kind`'), fixture), [
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
// The files the entries pass by path (--brief-file, apply), written for the run into dir; {{files.<name>}} names each.
// The plan is the run's own (its id carries the run id) and creates a small tree of its own, a decision, a blocker,
// two item links and a web link.
function smokeFiles(dir, { run_id, email }) {
  const brief = path.join(dir, 'brief.md');
  fs.writeFileSync(brief, "## Vision\n\nWritten by the skill smoke's brief file: it isn't quoted.\n\n- a bullet\n");
  const plan = path.join(dir, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({
    id: `skill-smoke:SEED-1:${run_id}:6`,
    initiatives: [{ name: 'smoke-initiative', title: 'Skill smoke plan initiative', horizon: 'Now', brief: '## Vision\n\nApplied by the skill smoke.' }],
    epics: [{ name: 'smoke-epic', title: 'Skill smoke plan epic', initiative: 'smoke-initiative' }],
    stories: [
      { name: 'smoke-first', title: 'Skill smoke plan story', epic: 'smoke-epic', criteria: ['It is planned'] },
      { name: 'smoke-second', title: 'Skill smoke blocked plan story', epic: 'smoke-epic', criteria: ['It waits'] },
    ],
    decisions: [{ name: 'smoke-decision', on: 'smoke-epic', title: 'Skill smoke plan decision', decider: email }],
    blocks: [{ story: 'smoke-second', blocked_by: 'smoke-first' }],
    // informational (kb/ADR-0031): the blocker above is what holds smoke-second back, never the item link
    links: [{ from: 'smoke-second', type: 'follows', to: 'smoke-first' }, { from: 'smoke-epic', type: 'relates_to', to: 'smoke-initiative' }],
    web_links: [{ on: 'smoke-initiative', title: 'Skill smoke plan page', url: 'https://example.com/skill-smoke/plan' }],
  }, null, 2));
  return { brief, plan };
}
function selfScope(dir) {
  const scope = { run_id: crypto.randomBytes(4).toString('hex'), household: dir, email: 'dan@example.com', repo: 'kb', record: { id: 'kb/ADR-0001', path: 'adrs/0001-x.md' }, shot: { story: 'GRA-31' } };
  return { ...scope, files: smokeFiles(dir, scope) };
}

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

test("a person's command the fake lets through is reported as the fake's to fix", (t) => {
  const src = fs.readFileSync(FAKE, 'utf8');
  const from = "'goal confidence', 'story promise', 'epic promise']";
  assert.equal(src.split(from).length, 2, 'the break must hit exactly the interactive_only list');
  const dir = tmp(t);
  const broken = path.join(dir, 'reeve');
  fs.copyFileSync(path.join(path.dirname(FAKE), 'shot.png'), path.join(dir, 'shot.png'));
  fs.writeFileSync(broken, src.replace(from, "'goal confidence', 'epic promise']").replace("  'story ls': () => ok(", "  'story promise': () => ok(story('GRA-1', 'Promised')),\n  'story ls': () => ok("), { mode: 0o755 });
  const results = s.runSmoke({ fixture, real: fakeSide(FAKE, tmp(t)), fake: fakeSide(broken, tmp(t)), scope: selfScope(tmp(t)), expect: false });
  const refusals = results.filter((r) => r.row.startsWith('refusal: reeve story promise '));
  assert.equal(refusals.length, 4);
  for (const r of refusals) assert.deepEqual(r.problems, ['fake: outcome ok (exit 0), expected refused interactive_only; fix test/fixtures/reeve-bin/reeve'], r.row);
  assert.deepEqual(results.filter((r) => !r.row.startsWith('refusal: reeve story promise ')).flatMap((r) => r.problems), [], 'nothing else is blamed');
});
// The content checks (`checks`, `replay`) keep the fake honest where the types alone would pass it.
function brokenFake(t, from, to) {
  const src = fs.readFileSync(FAKE, 'utf8');
  assert.equal(src.split(from).length, 2, `the break must hit exactly one place: ${from}`);
  const dir = tmp(t);
  const broken = path.join(dir, 'reeve');
  fs.copyFileSync(path.join(path.dirname(FAKE), 'shot.png'), path.join(dir, 'shot.png'));
  fs.writeFileSync(broken, src.replace(from, to), { mode: 0o755 });
  return s.runSmoke({ fixture, real: fakeSide(FAKE, tmp(t)), fake: fakeSide(broken, tmp(t)), scope: selfScope(tmp(t)), expect: false });
}
const FIX = 'fix test/fixtures/reeve-bin/reeve';
test('a fake whose link rm removes nothing is reported: the removed item link and web link must be gone', (t) => {
  const kept = brokenFake(t, 'st.links = (st.links || []).filter((l) => !(l.from === from && l.type === type && l.to === to)); return st;', 'return st;');
  const rm = kept.find((r) => r.row.startsWith('`reeve link rm <KEY> follows'));
  assert.equal(rm.problems.length, 1, rm.problems.join('\n'));
  assert.match(rm.problems[0], new RegExp(`^fake: 1 element\\(s\\) of value\\[\\] have \\{type: "relates_to", item\\.key: "GRA-\\d+"\\}, expected none; ${FIX}$`));
  assert.deepEqual(kept.filter((r) => r !== rm).flatMap((r) => r.problems), [], 'nothing else is blamed');
  const web = brokenFake(t, 'webLinksOf(x.key, st).filter((w) => w.url !== url)', 'webLinksOf(x.key, st)');
  assert.deepEqual(web.flatMap((r) => r.problems.map((p) => `${r.row.slice(0, 26)}: ${p}`)), [`\`reeve link rm <KEY> --url: fake: 1 element(s) of value[] have {url: "https://example.com/skill-smoke/extra"}, expected none; ${FIX}`]);
});
test('a fake whose link rm drops a survivor is reported', (t) => {
  const results = brokenFake(t, "st.links = (st.links || []).filter((l) => !(l.from === from && l.type === type && l.to === to)); return st;", "st.links = (st.links || []).filter((l) => l.type !== type); return st;");
  const rm = results.find((r) => r.row.startsWith('`reeve link rm <KEY> follows'));
  assert.equal(rm.problems.length, 2, rm.problems.join('\n'));
  for (const p of rm.problems) assert.match(p, /^fake: no element of value\[\] has \{type: "relates_to", direction: "out", item\.key: "GRA-\d+"\}; fix /);
});
test('a fake that creates a plan again on a second apply is reported: a replay keeps keys, ids and ends, every created false', (t) => {
  // the plan's items are found again, but its item links are answered as new
  const links = brokenFake(t, 'return { from, type, to, created };', 'return { from, type, to, created: true };');
  const apply = links.find((r) => r.row.startsWith('`reeve apply'));
  assert.deepEqual(apply.problems, [`fake: the second run: 0 of 2 element(s) of value.links[] have {created: false}, expected every one of at least one; ${FIX}`]);
  // every apply mints its items anew
  const items = brokenFake(t, 'const k = `plan:${id}:${name}`;', 'const k = `plan:${id}:${name}:${st.next}`;');
  const again = items.find((r) => r.row.startsWith('`reeve apply')).problems;
  assert.ok(again.some((p) => /^fake: the second run's value\.items\[\]\.key is \[.*\], the first run's \[.*\]; fix /.test(p)), again.join('\n'));
  assert.ok(again.some((p) => p.startsWith('fake: the second run: 0 of 4 element(s) of value.items[] have {created: false}')), again.join('\n'));
  // a replay that leaves the lists out passes no `all`
  const dropped = brokenFake(t, 'ok({ items, decisions, blocks, links, web_links: webLinks });', 'ok(items.some((i) => i.created) ? { items, decisions, blocks, links, web_links: webLinks } : { items, decisions, blocks, links: [], web_links: [] });');
  const lost = dropped.find((r) => r.row.startsWith('`reeve apply')).problems;
  assert.ok(lost.some((p) => p.startsWith('fake: the second run: 0 of 0 element(s) of value.links[] have {created: false}')), lost.join('\n'));
  assert.ok(lost.some((p) => p.startsWith("fake: the second run's value.web_links[].id is [], the first run's [")), lost.join('\n'));
});
test('a replay with an element more is reported, though every compared field matches', (t) => {
  // the second apply appends a bare `{ created: false }`: no field of it reaches a `same` path, and `all` holds for it
  const extra = brokenFake(t, 'ok({ items, decisions, blocks, links, web_links: webLinks });', 'ok({ items, decisions, blocks, links: items.some((i) => i.created) ? links : [...links, { created: false }], web_links: webLinks });');
  const apply = extra.find((r) => r.row.startsWith('`reeve apply'));
  for (const field of ['from', 'from_level', 'type', 'to', 'to_level']) assert.ok(apply.problems.includes(`fake: the second run's answer has no value.links[2].${field}; ${FIX}`), apply.problems.join('\n'));
  assert.ok(apply.problems.includes(`fake: the second run's value.links[] has 3 element(s), the first run's 2; ${FIX}`), apply.problems.join('\n'));
  assert.deepEqual(extra.filter((r) => r !== apply).flatMap((r) => r.problems), [], 'nothing else is blamed');
});
test("an apply whose ends are consistently reversed is reported: the ends are tied to the answer's own item names", (t) => {
  // the plan's item links stored the wrong way round, on both applies alike: levels and the replay alone pass it
  const links = brokenFake(t, 'const r = addLink(st, resolve(l.from, null), l.type, resolve(l.to, null));', 'const r = addLink(st, resolve(l.to, null), l.type, resolve(l.from, null));');
  const apply = links.find((r) => r.row.startsWith('`reeve apply'));
  assert.equal(apply.problems.length, 1, apply.problems.join('\n'));
  assert.match(apply.problems[0], new RegExp(`^fake: no element of value\\.links\\[\\] has \\{type: "follows", from: "GRA-\\d+", from_level: "story", to: "GRA-\\d+", to_level: "story"\\}; ${FIX}$`));
  // the blocker the wrong way round: smoke-first blocked by smoke-second
  const blocks = brokenFake(t, "const [sk, bk] = [resolve(b.story, 'story'), resolve(b.blocked_by, 'story')];", "const [bk, sk] = [resolve(b.story, 'story'), resolve(b.blocked_by, 'story')];");
  const blocked = blocks.find((r) => r.row.startsWith('`reeve apply')).problems;
  assert.ok(blocked.some((p) => /^fake: no element of value\.blocks\[\] has \{story: "GRA-\d+", blocked_by: "GRA-\d+"\}; fix /.test(p)), blocked.join('\n'));
  // the web link put on another of the plan's items
  const web = brokenFake(t, 'const on = resolve(w.on, null);\n      const r = addWeb(', "const on = resolve('smoke-epic', null);\n      const r = addWeb(");
  const moved = web.find((r) => r.row.startsWith('`reeve apply')).problems;
  assert.ok(moved.some((p) => /^fake: no element of value\.web_links\[\] has \{on: "GRA-\d+", level: "initiative", /.test(p)), moved.join('\n'));
});
test('every promise command the reference gives a person has a refusal case', () => {
  const text = fs.readFileSync(path.join(root, 'references', 'reeve-cli.md'), 'utf8');
  const forms = [...text.matchAll(/^\| `reeve ((?:story|epic) promise <KEY> (--[a-z]+))[^`]*` \|/gm)].map((m) => [m[1].split(' ')[0], m[2]]);
  assert.equal(forms.length, 6, 'the Promises table lists --on, --to and --clear for story and epic');
  const covered = (item, flag) => fixture.refusals.some((x) => x.argv[0] === item && x.argv[1] === 'promise' && x.argv[3] === flag);
  assert.deepEqual(forms.filter(([item, flag]) => !covered(item, flag)), []);
});

const DETECT = path.join(root, 'scripts', 'reeve-detect.js');
const live = s.liveConfig(process.env);
test('every Commands row against a real planner, the fake answering in the same shape', { skip: live.skip }, async (t) => {
  assert.deepEqual(live.missing, [], 'REEVE_SMOKE_SEED is set, so a live run needs these too');
  const seed = JSON.parse(fs.readFileSync(process.env.REEVE_SMOKE_SEED, 'utf8'));
  const home = tmp(t);
  // An empty CLI config and HOME: only REEVE_URL and REEVE_TOKEN reach the planner (crates/reeve/src/config.rs).
  const realEnv = { ...baseEnv(), REEVE_URL: process.env.REEVE_URL, REEVE_TOKEN: process.env.REEVE_TOKEN, REEVE_CONFIG_DIR: home, HOME: home };
  // The skills' first call (kb/ADR-0005 R1), against the real binary; its run id keys every create of this run.
  const d = spawnSync(process.execPath, [DETECT], { encoding: 'utf8', env: { ...realEnv, REEVE_BIN: process.env.REEVE_REAL_BIN }, timeout: 30_000 });
  assert.ok(d.status === 0 && d.stdout.trim(), `the detector failed (exit ${d.status}${d.error ? `, ${d.error.code}` : ''}): ${d.stderr.trim() || d.stdout.trim() || 'no output'}`);
  const detected = JSON.parse(d.stdout);
  assert.deepEqual([detected.present, detected.signed_in, detected.reason], [true, true, ''], d.stdout);
  const results = s.runSmoke({
    fixture,
    real: { bin: process.env.REEVE_REAL_BIN, env: realEnv },
    fake: fakeSide(FAKE, tmp(t)),
    scope: { ...seed, run_id: detected.run_id, files: smokeFiles(tmp(t), { ...seed, run_id: detected.run_id }) },
    // shot.story is a planner key: the fake reads its own screenshot story instead
    fakeScope: { shot: { story: 'GRA-31' } },
    out: process.env.REEVE_SMOKE_OUT,
  });
  // not vacuous: every entry's runs all reached the real planner and got an envelope back
  for (const e of fixture.entries) {
    const r = results.find((x) => x.row === e.row);
    assert.equal(r && r.ran, s.runsOf(e).length, `${e.row}: runs answered by the real CLI`);
  }
  const refusals = results.filter((x) => x.row.startsWith('refusal: '));
  assert.equal(refusals.length, fixture.refusals.length, 'every refusal case ran');
  for (const r of refusals) assert.equal(r.ran, 1, `${r.row}: answered by the real CLI`);
  for (const r of results) await t.test(r.row, () => assert.deepEqual(r.problems, []));
});
