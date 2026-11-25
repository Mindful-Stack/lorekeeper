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
  assert.equal(r.stdout, 'reeve-planner 0.9.0-fake\n');
  assert.equal(r.log, '');
});
test('a flag the real CLI lacks is a usage error: no envelope, text on stderr, exit 1', () => {
  const r = run(['epic', 'edit', 'GRA-20', '--brief-url', 'https://example.com/brief', '--version', '2', '--json']);
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.match(r.stderr, /unexpected argument '--brief-url'/);
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
  // a global flag taken once: a second --json is clap's usage error, nothing sent
  const twice = run(['link', 'ls', 'GRA-31', '--json', '--json']);
  assert.deepEqual([twice.status, twice.stdout, twice.log], [1, '', '']);
  assert.match(twice.stderr, /the argument '--json' cannot be used multiple times/);
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
  assert.equal(r.envelope.current, 3); // the version to re-read from
});
test('an initiative owner and target month are cleared by --no-owner and --no-target-month', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
  const value = (args) => JSON.parse(call(args).stdout).value;
  assert.equal(value(['initiative', 'edit', 'GRA-12', '--no-owner', '--version', '3', '--json']).owner, null);
  assert.equal(value(['initiative', 'edit', 'GRA-12', '--target-month', '2027-03', '--version', '4', '--json']).target_month, '2027-03');
  assert.equal(value(['initiative', 'edit', 'GRA-12', '--no-target-month', '--version', '5', '--json']).target_month, null);
  assert.equal(call(['initiative', 'edit', 'GRA-12', '--owner', 'dan@example.com', '--no-owner', '--version', '6', '--json']).status, 1); // clap: they conflict
  assert.equal(call(['initiative', 'edit', 'GRA-12', '--target-month', '2027-03', '--no-target-month', '--version', '6', '--json']).status, 1);
});
test('--mine under REEVE_FAKE_SIGNIN=expired answers unauthenticated, exit 2', () => {
  for (const argv of [['story', 'ls', '--mine', '--json'], ['decision', 'ls', '--mine', '--json']]) {
    const r = run(argv, { REEVE_FAKE_SIGNIN: 'expired' });
    assert.deepEqual([r.status, r.envelope.code], [2, 'unauthenticated']);
  }
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
  assert.deepEqual([mv.status, mv.envelope.value.delivery, mv.log], [0, 'in_progress', 'story mv GRA-31 in-progress --json\n']);
});
test('story ls --untriaged lists any item with no epic that is not done, as the real planner does', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  const keys = () => call(['story', 'ls', '--untriaged', '--json']).value.map((x) => x.story.key);
  call(['story', 'edit', 'GRA-41', '--version', '1', '--kind', 'chore', '--json']);
  assert.ok(keys().includes('GRA-41'), 'a chore with no epic is untriaged');
  assert.ok(call(['story', 'context', 'GRA-41', '--json']).value.readiness.reasons.some((r) => r.reason === 'untriaged'));
  call(['story', 'edit', 'GRA-41', '--version', '2', '--epic', 'GRA-20', '--json']);
  assert.ok(!keys().includes('GRA-41'));
  assert.equal(call(['story', 'mv', 'GRA-46', 'done', '--resolution', 'dropped', '--json']).value.resolution, 'dropped');
  assert.ok(!keys().includes('GRA-46'), 'a done item is not untriaged');
  assert.equal(call(['story', 'mv', 'GRA-47', 'done', '--json']).code, 'validation');
});
test('story ls filters by text, kind, initiative, urgency and openness, and sorts by relevance, as the planner does (kb/ADR-0021)', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => {
    const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
    return { status: r.status, stderr: r.stderr, ...(r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : {}) };
  };
  const keys = (...flags) => call(['story', 'ls', ...flags, '--json']).value.map((x) => x.story.key);
  // text: title, description or external reference, any case; a key-shaped text also names that key
  assert.deepEqual(keys('--text', 'MATCH'), ['GRA-31', 'GRA-32', 'GRA-40', 'GRA-42', 'GRA-45', 'GRA-46']);
  assert.deepEqual(keys('--text', '  queue '), ['GRA-41', 'GRA-42'], 'the text is trimmed');
  assert.deepEqual(keys('--text', '44'), ['GRA-44']);
  assert.deepEqual(keys('--text', '#44'), ['GRA-44']);
  assert.deepEqual(keys('--text', 'gra-44'), ['GRA-44']);
  call(['story', 'edit', 'GRA-47', '--version', '1', '--external-ref', 'PIB-9', '--description', 'Mentees asked for it in the match survey', '--json']);
  assert.ok(keys('--text', 'pib-9').includes('GRA-47'));
  assert.ok(keys('--text', 'survey').includes('GRA-47'), 'the description matches too');
  // relevance: the named key, then the equal external reference, then title matches, then the rest
  call(['story', 'edit', 'GRA-41', '--version', '1', '--external-ref', 'match', '--json']);
  assert.deepEqual(keys('--text', 'match', '--sort', 'relevance'), ['GRA-41', 'GRA-31', 'GRA-32', 'GRA-40', 'GRA-42', 'GRA-45', 'GRA-46', 'GRA-47']);
  assert.deepEqual(keys('--text', 'match', '--sort', 'rank'), ['GRA-31', 'GRA-32', 'GRA-40', 'GRA-41', 'GRA-42', 'GRA-45', 'GRA-46', 'GRA-47']);
  assert.equal(call(['story', 'ls', '--sort', 'relevance', '--json']).code, 'validation');
  assert.equal(call(['story', 'ls', '--text', ' ', '--json']).code, 'validation');
  assert.equal(call(['story', 'ls', '--text', 'x'.repeat(201), '--json']).code, 'validation');
  assert.equal(call(['story', 'ls', '--sort', 'newest', '--json']).status, 1, 'an unknown sort is a usage error');
  // kind, initiative (through its epics; a ref naming nothing lists nothing), urgent, open
  call(['story', 'edit', 'GRA-32', '--version', '1', '--kind', 'bug', '--json']);
  assert.deepEqual(keys('--kind', 'bug'), ['GRA-32']);
  assert.deepEqual(keys('--initiative', 'GRA-12'), ['GRA-31', 'GRA-32']);
  assert.deepEqual(keys('--initiative', 'GRA-13'), []);
  assert.deepEqual(keys('--initiative', 'GRA-999'), []);
  assert.deepEqual(keys('--urgent'), ['GRA-40']);
  call(['story', 'mv', 'GRA-46', 'done', '--resolution', 'dropped', '--json']);
  assert.ok(keys().includes('GRA-46'));
  assert.ok(!keys('--open').includes('GRA-46'), '--open leaves done stories out');
  assert.deepEqual(keys('--open', '--text', 'match', '--kind', 'bug', '--initiative', 'GRA-12'), ['GRA-32'], 'the filters combine');
});
test('story ls --limit and --offset answer one page of the list, as GET /stories does (GRA-667)', () => {
  const ls = (...flags) => run(['story', 'ls', ...flags, '--json']);
  const keys = (...flags) => { const r = ls(...flags); assert.equal(r.status, 0, r.stderr); return r.envelope.value.map((x) => x.story.key); };
  const all = keys();
  assert.ok(all.length >= 5, `the fake seeds ${all.length} stories`);
  // pages of 2 are the list, every story once and in order; a page that starts at or past the end is empty
  const pages = [];
  for (let offset = 0; offset < all.length + 2; offset += 2) pages.push(keys('--limit', '2', '--offset', String(offset)));
  assert.deepEqual(pages.flat(), all);
  assert.deepEqual(pages.at(-1), []);
  assert.deepEqual(keys('--limit', '3'), all.slice(0, 3), '--offset defaults to 0');
  assert.deepEqual(keys('--limit', '100'), all);
  // the page is cut after the filters
  const matching = keys('--text', 'match');
  assert.ok(matching.length >= 3 && matching.length < all.length, `the text filter keeps ${matching.length} of ${all.length}`);
  // (offset 2: the unfiltered list's third and fourth stories are GRA-40 and GRA-41, and GRA-41 does not match, so a
  // slice cut before the filter would answer one story, not the two the filtered list has there)
  assert.notDeepEqual(all.slice(2, 4).filter((k) => matching.includes(k)), matching.slice(2, 4), 'the seed tells the two orders apart');
  assert.deepEqual(keys('--text', 'match', '--limit', '2', '--offset', '2'), matching.slice(2, 4));
  // the envelope is the same
  assert.deepEqual(Object.keys(ls('--limit', '2').envelope), ['outcome', 'value']);
  // the planner's refusals: validation errors, exit 1
  for (const [flags, message] of [[['--offset', '2'], 'offset needs limit'], [['--offset', '0'], 'offset needs limit'], [['--limit', '0'], 'limit must be 1..=100'], [['--limit', '101'], 'limit must be 1..=100']]) {
    const r = ls(...flags);
    assert.deepEqual([r.status, r.envelope && r.envelope.code, r.envelope && r.envelope.message], [1, 'validation', message], flags.join(' '));
  }
  // what the real CLI's parser refuses (a whole number that fits 32 unsigned bits): a usage error, nothing logged
  for (const flag of ['--limit', '--offset']) for (const v of ['x', '1.5', '4294967296']) {
    const r = ls(...(flag === '--offset' ? ['--limit', '2'] : []), flag, v);
    assert.deepEqual([r.status, r.envelope, r.log], [1, null, ''], `${flag} ${v}`);
    assert.match(r.stderr, new RegExp(`invalid value '${v}' for '${flag} <${flag.slice(2).toUpperCase()}>'`), `${flag} ${v}`);
  }
  assert.deepEqual(keys('--limit', '+1'), all.slice(0, 1), 'a leading + parses, as in the real CLI');
  assert.deepEqual(keys('--limit', '2', '--offset', '+1'), all.slice(1, 3));
});
test('story similar lists stories with a like title and checks its arguments', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  const hit = call(['story', 'similar', 'Upgrade', 'the', 'queue', 'client', '--json']).value;
  assert.deepEqual(Object.keys(hit[0]), ['key', 'kind', 'title', 'epic', 'delivery', 'resolution']);
  assert.ok(hit.some((x) => x.key === 'GRA-41'));
  assert.equal(call(['story', 'similar', 'Upgrade', '--json']).code, 'validation');
  assert.equal(call(['story', 'similar', 'Upgrade the queue', '--limit', '11', '--json']).code, 'validation');
  assert.ok(call(['story', 'similar', 'Upgrade the queue', '--limit', '1', '--json']).value.length <= 1);
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
test('story context of a created story bundles its created initiative and the open decisions on the initiative, the epic and the story, in that order', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  const i = call(['initiative', 'create', '--title', 'Billing', '--horizon', 'Later', '--idempotency-key', 'planning-initiative:GRA-12:0a1b2c3d:1', '--json']).value;
  const e = call(['epic', 'create', '--initiative', i.key, '--title', 'Invoices', '--idempotency-key', 'planning-initiative:GRA-12:0a1b2c3d:2', '--json']).value;
  const st = call(['story', 'create', '--epic', e.key, '--title', 'Send invoices', '--criterion', 'sent', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:1', '--json']).value;
  const requireOn = (on, n) => call(['decision', 'require', '--on', on, '--title', `On ${on}`, '--decider', 'dan@example.com', '--idempotency-key', `refining-epic:GRA-20:0a1b2c3d:${n}`, '--json']).value.id;
  const onStory = requireOn(st.key, 2);
  const onEpic = requireOn(e.key, 3);
  const onInitiative = requireOn(i.key, 4);
  const { value } = call(['story', 'context', st.key, '--json']);
  assert.equal(value.initiative?.key, i.key);
  assert.deepEqual(value.required_decisions.map((d) => d.id), [onInitiative, onEpic, onStory]);
});
test('story context leaves a closed decision out of the bundle', () => {
  const { value } = run(['story', 'context', 'GRA-31', '--json']).envelope;
  assert.deepEqual(value.required_decisions.map((d) => d.id), [7]); // #8 on GRA-20 is closed
});
test('search finds items by title, brief, description or external reference, newest first; several words are one phrase', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  call(['epic', 'create', '--initiative', 'GRA-12', '--title', 'Queue alerts', '--brief', 'Alert on a stuck MATCHING queue.', '--idempotency-key', KEY, '--json']);
  const hits = call(['search', 'matching', 'queue', '--json']).value;
  assert.deepEqual(hits.map((h) => [h.key, h.item, h.kind, h.matched]), [['GRA-100', 'epic', null, ['brief']], ['GRA-20', 'epic', null, ['title']]]);
  assert.deepEqual(call(['search', 'match', '--json']).value.map((h) => h.key).slice(0, 2), ['GRA-100', 'GRA-46']);
  assert.equal(call(['search', 'Retry failed', '--json']).value[0].kind, 'story');
  assert.deepEqual(call(['search', 'nothing like this', '--json']).value, []);
  assert.equal(run(['search', '--json']).status, 1); // the text is required
});
test('a story owner is set on create and edit, cleared by --no-owner, and must be an allowed user', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
  const made = JSON.parse(call(['story', 'create', '--epic', 'GRA-20', '--title', 'Owned', '--owner', 'sam@example.com', '--idempotency-key', KEY, '--json']).stdout).value;
  assert.equal(made.owner, 'sam@example.com');
  const edited = JSON.parse(call(['story', 'edit', made.key, '--version', '1', '--owner', 'dan@example.com', '--json']).stdout).value;
  assert.equal(edited.owner, 'dan@example.com');
  assert.equal(JSON.parse(call(['story', 'edit', made.key, '--version', '2', '--no-owner', '--json']).stdout).value.owner, null);
  const refused = call(['story', 'edit', 'GRA-31', '--version', '1', '--owner', 'nobody@example.com', '--json']);
  assert.deepEqual([refused.status, JSON.parse(refused.stdout).code], [1, 'validation']);
  assert.equal(call(['story', 'edit', 'GRA-31', '--version', '1', '--owner', 'dan@example.com', '--no-owner', '--json']).status, 1); // clap: they conflict
});
test('comment add --item comments on an initiative, an epic or a story (--story is its alias); comment ls lists the thread', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
  const add = (flag, on, n) => JSON.parse(call(['comment', 'add', flag, on, '--body', `on ${on}`, '--idempotency-key', `refining-epic:GRA-20:0a1b2c3d:${n}`, '--json']).stdout).value;
  assert.deepEqual(add('--item', 'GRA-12', 1).map((c) => [c.on_initiative, c.on_epic, c.on_story, c.on_decision]), [['GRA-12', null, null, null]]);
  assert.equal(add('--item', 'GRA-20', 2)[0].on_epic, 'GRA-20');
  assert.equal(add('--story', 'GRA-31', 3)[0].on_story, 'GRA-31');
  assert.equal(add('--decision', '7', 4)[0].on_decision, 7);
  assert.equal(add('--item', 'GRA-20', 5).length, 2, 'the answer is the whole thread');
  const ls = (flag, on) => JSON.parse(call(['comment', 'ls', flag, on, '--json']).stdout).value.map((c) => c.body);
  assert.deepEqual(ls('--item', 'GRA-20'), ['on GRA-20', 'on GRA-20']);
  assert.deepEqual(ls('--item', 'GRA-13'), []);
  assert.deepEqual(ls('--decision', '7'), ['on 7']);
  assert.ok(JSON.parse(call(['story', 'context', 'GRA-31', '--json']).stdout).value.comments.some((c) => c.body === 'on GRA-31'));
  assert.equal(JSON.parse(call(['comment', 'ls', '--item', 'GRA-999', '--json']).stdout).code, 'not_found');
  assert.equal(call(['comment', 'ls', '--item', 'GRA-20', '--decision', '7', '--json']).status, 1);
  assert.equal(call(['comment', 'ls', '--json']).status, 1);
});
test('decision ls --initiative lists every decision on the initiative, its epics and their stories, each with on_type', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
  const require = (on, n) => call(['decision', 'require', '--on', on, '--title', `on ${on}`, '--decider', 'dan@example.com', '--idempotency-key', `planning-initiative:GRA-12:0a1b2c3d:${n}`, '--json']);
  require('GRA-12', 1);
  require('GRA-31', 2);
  require('GRA-13', 3); // another initiative
  const listed = JSON.parse(call(['decision', 'ls', '--initiative', 'GRA-12', '--json']).stdout).value;
  assert.deepEqual(listed.map((d) => [d.on, d.on_type]), [['GRA-20', 'epic'], ['GRA-20', 'epic'], ['GRA-12', 'initiative'], ['GRA-31', 'story']]);
  assert.deepEqual(JSON.parse(call(['decision', 'ls', '--initiative', 'GRA-999', '--json']).stdout).value, []); // as the planner: an unknown key lists nothing
  assert.equal(call(['decision', 'ls', '--on', 'GRA-20', '--initiative', 'GRA-12', '--json']).status, 1);
});
test('a link to a repository the planner does not check yet is stored, exits 0, and gates readiness as decision_repo_not_configured', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args, env = {}) => {
    const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log, ...env } });
    return { status: r.status, stderr: r.stderr, ...JSON.parse(r.stdout) };
  };
  const link = ['decision', 'link', '7', '--record', 'web/ADR-0001', '--repo', 'web', '--path', 'docs/adr/0001-x.md', '--pr', 'https://github.com/example/web/pull/3', '--json'];
  const r = call(link, { REEVE_FAKE_LINK_CHECK: 'repo_not_configured' });
  assert.deepEqual([r.status, r.outcome, r.value.check.kind, r.immediate_check.outcome], [0, 'ok', 'unchecked', 'repo_not_configured']);
  assert.match(r.stderr, /^decision 7: linked; its repository is not configured/);
  assert.equal(call(['decision', 'show', '7', '--json']).value.record.repo, 'web');
  assert.ok(call(['story', 'ls', '--epic', 'GRA-20', '--json']).value[0].readiness.reasons.some((x) => x.reason === 'decision_repo_not_configured' && x.decision_id === 7));
  // A link whose check ran says so beside the decision.
  assert.deepEqual(call(link).immediate_check, { id: 7, outcome: 'stored', check: { kind: 'proposed_pr_open' } });
  assert.ok(!call(['story', 'ls', '--epic', 'GRA-20', '--json']).value[0].readiness.reasons.some((x) => x.reason === 'decision_repo_not_configured'));
});
test('--brief-file and --description-file send the file unchanged; - reads stdin; an unreadable file reaches nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-'));
  const log = path.join(dir, 'log');
  const md = "## Vision\n\n- Mentees aren't left waiting: `match` within a day.\n--- not a flag\n";
  fs.writeFileSync(path.join(dir, 'brief.md'), md);
  const call = (args, input) => spawnSync(fake, args, { encoding: 'utf8', input, env: { ...process.env, REEVE_FAKE_LOG: log } });
  const epic = JSON.parse(call(['epic', 'create', '--initiative', 'GRA-12', '--title', 'A', '--brief-file', path.join(dir, 'brief.md'), '--idempotency-key', KEY, '--json']).stdout).value;
  assert.equal(epic.brief, md);
  assert.equal(JSON.parse(call(['epic', 'edit', epic.key, '--brief-file', '-', '--version', '1', '--json'], md.toUpperCase()).stdout).value.brief, md.toUpperCase());
  const story = JSON.parse(call(['story', 'create', '--title', 'S', '--description-file', '-', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:2', '--json'], md).stdout).value;
  assert.equal(story.description, md);
  const before = fs.readFileSync(log, 'utf8');
  const missing = call(['initiative', 'edit', 'GRA-12', '--brief-file', path.join(dir, 'nope.md'), '--version', '3', '--json']);
  assert.deepEqual([missing.status, JSON.parse(missing.stdout).code], [1, 'internal']);
  assert.equal(fs.readFileSync(log, 'utf8'), before, 'not logged');
  assert.equal(call(['epic', 'edit', 'GRA-20', '--brief', 'x', '--brief-file', '-', '--version', '2', '--json'], 'y').status, 1); // they conflict
});
test('apply creates a plan in one call: names resolve in the plan, else to existing keys; the same plan again creates nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-'));
  const log = path.join(dir, 'log');
  const call = (args, input) => { const r = spawnSync(fake, args, { encoding: 'utf8', input, env: { ...process.env, REEVE_FAKE_LOG: log } }); return { status: r.status, stderr: r.stderr, ...(r.stdout ? JSON.parse(r.stdout) : {}) }; };
  const plan = {
    id: 'refining-epic:GRA-20:0a1b2c3d:1',
    initiatives: [{ name: 'billing', title: 'Employer billing', horizon: 'Later', brief: '## Vision\n\nEmployers pay.' }],
    epics: [{ name: 'invoices', title: 'Invoices', initiative: 'billing', brief: 'Invoice employers.' }],
    stories: [
      { name: 'enqueue', title: 'Enqueue match requests', epic: 'GRA-20', criteria: ['a new request is queued', 'a repeat is queued once'] },
      { name: 'process', title: 'Process the match queue', epic: 'GRA-20', criteria: ['oldest first'] },
      { name: 'invoice', title: 'Send an invoice', epic: 'invoices', criteria: ['an invoice is sent'] },
    ],
    decisions: [{ name: 'retry', on: 'enqueue', title: 'Retry or drop', decider: 'dan@example.com', due: '2026-11-15' }],
    blocks: [{ story: 'process', blocked_by: 'enqueue' }],
  };
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  const first = call(['apply', path.join(dir, 'plan.json'), '--json']);
  assert.equal(first.status, 0);
  assert.deepEqual(first.value.items.map((i) => [i.name, i.item, i.created]), [['billing', 'initiative', true], ['invoices', 'epic', true], ['enqueue', 'story', true], ['process', 'story', true], ['invoice', 'story', true]]);
  const key = Object.fromEntries(first.value.items.map((i) => [i.name, i.key]));
  assert.deepEqual(first.value.decisions.map((d) => [d.name, d.created]), [['retry', true]]);
  assert.deepEqual(first.value.blocks, [{ story: key.process, blocked_by: key.enqueue, created: true }]);
  assert.match(fs.readFileSync(log, 'utf8'), /^apply \S+plan\.json --json \{"id":"refining-epic:GRA-20:0a1b2c3d:1",.*"title":"Enqueue match requests"/m);
  // The plan's items are there for later reads.
  assert.equal(call(['epic', 'show', key.invoices, '--json']).value.initiative, key.billing);
  const listed = call(['story', 'ls', '--epic', 'GRA-20', '--json']).value.find((x) => x.story.key === key.process);
  assert.ok(listed.readiness.reasons.some((r) => r.reason === 'blocked_by' && r.story === key.enqueue));
  assert.deepEqual(call(['decision', 'ls', '--on', key.enqueue, '--json']).value.map((d) => [d.title, d.on_type, d.due]), [['Retry or drop', 'story', '2026-11-15']]);
  // The same plan again, from stdin: the same keys, nothing created.
  const again = call(['apply', '-', '--json'], JSON.stringify(plan));
  assert.deepEqual(again.value.items.map((i) => [i.key, i.created]), first.value.items.map((i) => [i.key, false]));
  assert.deepEqual([again.value.decisions[0].created, again.value.blocks[0].created], [false, false]);
});
test('apply validates the whole plan first and reports every problem at once; an unknown field never reaches the planner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-'));
  const log = path.join(dir, 'log');
  const apply = (plan) => { const r = spawnSync(fake, ['apply', '-', '--json'], { encoding: 'utf8', input: JSON.stringify(plan), env: { ...process.env, REEVE_FAKE_LOG: log } }); return { status: r.status, ...JSON.parse(r.stdout) }; };
  const bad = apply({
    id: 'p',
    epics: [{ name: 'GRA-77', title: 'Key-shaped' }, { name: 'dup', title: 'One' }, { name: 'dup', title: 'Two', initiative: 'GRA-20' }],
    stories: [{ name: 's', title: 'S', epic: 'nowhere' }],
    blocks: [{ story: 's', blocked_by: 's' }],
  });
  assert.deepEqual([bad.status, bad.code], [1, 'validation']);
  for (const want of ['"GRA-77" looks like a key', '"dup" is used twice', 'initiative "GRA-20" is neither a name in the plan nor an existing initiative', 'epic "nowhere" is neither', 'a story cannot block itself']) assert.ok(bad.message.includes(want), `${want} in ${bad.message}`);
  assert.equal(apply({ id: 'p', initiatives: [{ name: 'x', title: 'X', horizon: 'Someday' }] }).code, 'validation');
  const before = fs.readFileSync(log, 'utf8');
  const typo = apply({ id: 'p', stories: [{ name: 's', title: 'S', colour: 'red' }] });
  assert.deepEqual([typo.status, typo.code], [1, 'internal']);
  assert.match(typo.message, /stories\[0\]: unknown field `colour`/);
  assert.equal(fs.readFileSync(log, 'utf8'), before, 'not logged');
  const r = spawnSync(fake, ['apply', '-', '--json'], { encoding: 'utf8', input: 'id: p\n', env: { ...process.env, REEVE_FAKE_LOG: log } });
  assert.match(JSON.parse(r.stdout).message, /JSON plans only/);
});

// Decisions first-class (Reeve CLI 0.2.0, kb/ADR-0013): reversibility, close kinds, the queue.
const session = (log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log')) => {
  return (args) => {
    const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout, ...(r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : {}) };
  };
};
const requireArgs = (n, ...extra) => ['decision', 'require', '--on', 'GRA-20', '--title', `Decision ${n}`, '--decider', 'dan@example.com', ...extra, '--idempotency-key', `refining-epic:GRA-20:0a1b2c3d:${n}`, '--json'];
test('decision require takes --reversibility one-way|two-way (one_way on the wire); every row carries reversibility', () => {
  const call = session();
  assert.equal(call(requireArgs(1, '--reversibility', 'one-way', '--due', '2026-12-01')).value.reversibility, 'one_way');
  assert.equal(call(requireArgs(2, '--reversibility', 'two-way', '--due', '2026-12-01')).value.reversibility, 'two_way');
  assert.equal(call(requireArgs(3, '--due', '2026-12-01')).value.reversibility, null);
  const bad = call(requireArgs(4, '--reversibility', 'one_way'));
  assert.deepEqual([bad.status, bad.stdout], [1, '']); // clap: the CLI spells it one-way
  assert.deepEqual(call(['decision', 'ls', '--on', 'GRA-20', '--json']).value.map((d) => d.reversibility), [null, null, 'one_way', 'two_way', null]);
  assert.equal(call(['decision', 'show', '7', '--json']).value.reversibility, null);
  assert.ok(call(['decision', 'ls', '--initiative', 'GRA-12', '--json']).value.every((d) => 'reversibility' in d));
});
test('decision require without --due warns on stderr, also with --json; with --due it does not', () => {
  const call = session();
  const r = call(requireArgs(1));
  assert.equal(r.outcome, 'ok');
  assert.match(r.stderr, /^no decide-by date; the queue will flag it$/m);
  assert.equal(call(requireArgs(2, '--due', '2026-12-01')).stderr, '');
});
test('decision close takes exactly one of --decided and --withdrawn; --reason is gone', () => {
  const call = session();
  for (const args of [['decision', 'close', '7', '--json'], ['decision', 'close', '7', '--decided', 'a', '--withdrawn', 'b', '--json'], ['decision', 'close', '7', '--reason', 'a', '--json']]) {
    const r = call(args);
    assert.deepEqual([r.status, r.stdout], [1, ''], args.join(' '));
  }
  const decided = call(['decision', 'close', '7', '--decided', 'a queue', '--json']).value;
  assert.deepEqual([decided.closed.reason, decided.closed.kind, decided.closed.via, decided.closed.by], ['a queue', 'decided', 'interactive', 'dan@example.com']);
  const id = call(requireArgs(1, '--due', '2026-12-01')).value.id;
  assert.equal(call(['decision', 'close', String(id), '--withdrawn', 'no longer needed', '--json']).value.closed.kind, 'withdrawn');
  const again = call(['decision', 'close', String(id), '--withdrawn', 'twice', '--json']);
  assert.deepEqual([again.status, again.code, again.message], [1, 'validation', 'already closed']);
});
test('decision close checks the flags by presence: an empty value still counts, and a blank reason is the planner\'s validation', () => {
  const call = session();
  for (const args of [['decision', 'close', '7', '--decided', 'x', '--withdrawn', '', '--json'], ['decision', 'close', '7', '--decided', '', '--withdrawn', 'x', '--json']]) {
    const r = call(args);
    assert.deepEqual([r.status, r.stdout], [1, ''], args.join(' ')); // clap: they conflict, nothing sent
    assert.match(r.stderr, /cannot be used with/);
  }
  for (const flag of ['--decided', '--withdrawn']) for (const blank of ['', '   ']) {
    const r = call(['decision', 'close', '7', flag, blank, '--json']);
    assert.deepEqual([r.status, r.code, r.message], [1, 'validation', 'closing needs a reason'], `${flag} '${blank}'`);
  }
  assert.equal(call(['decision', 'show', '7', '--json']).value.closed, null);
});
test('--decided on a one-way decision is a validation error, exit 1; withdrawing it is allowed', () => {
  const call = session();
  const id = String(call(requireArgs(1, '--reversibility', 'one-way', '--due', '2026-12-01')).value.id);
  const r = call(['decision', 'close', id, '--decided', 'Postgres', '--json']);
  assert.deepEqual([r.status, r.code, r.message], [1, 'validation', 'a one-way decision is decided by its accepted record; withdraw it if it is no longer needed']);
  assert.equal(call(['decision', 'show', id, '--json']).value.closed, null);
  assert.equal(call(['decision', 'close', id, '--withdrawn', 'dropped', '--json']).value.closed.kind, 'withdrawn');
});
test('decision edit changes title, decider, due and reversibility of an open decision; --no-due and --no-reversibility clear', () => {
  const call = session();
  const edited = call(['decision', 'edit', '7', '--version', '1', '--reversibility', 'one-way', '--due', '2026-12-01', '--title', 'Queue, cron or both', '--json']).value;
  assert.deepEqual([edited.reversibility, edited.due, edited.title, edited.version], ['one_way', '2026-12-01', 'Queue, cron or both', 2]);
  const cleared = call(['decision', 'edit', '7', '--version', '2', '--no-reversibility', '--no-due', '--json']).value;
  assert.deepEqual([cleared.reversibility, cleared.due], [null, null]);
  assert.equal(call(['decision', 'show', '7', '--json']).value.version, 3);
  const stale = call(['decision', 'edit', '7', '--version', '1', '--title', 'x', '--json']);
  assert.deepEqual([stale.status, stale.code, stale.current], [1, 'conflict', 3]);
  for (const args of [['decision', 'edit', '7', '--version', '3', '--json'], ['decision', 'edit', '7', '--version', '3', '--reversibility', 'one-way', '--no-reversibility', '--json'], ['decision', 'edit', '7', '--version', '3', '--due', '2026-12-01', '--no-due', '--json']]) {
    assert.deepEqual([call(args).status, call(args).stdout], [1, ''], args.join(' '));
  }
  const closed = call(['decision', 'edit', '8', '--version', '2', '--title', 'x', '--json']);
  assert.deepEqual([closed.status, closed.code, closed.message], [1, 'validation', 'decision is closed']);
});
test('decision edit trims title and decider, refuses a blank one before the version check, and a trimmed-unchanged edit is a no-op', () => {
  const call = session();
  for (const args of [['--title', '  '], ['--decider', ''], ['--title', 'ok', '--decider', ' ']]) {
    const r = call(['decision', 'edit', '7', '--version', '99', ...args, '--json']); // a stale version too: blank is checked first
    assert.deepEqual([r.status, r.code, r.message], [1, 'validation', 'title and decider must not be blank'], args.join(' '));
  }
  const d = call(['decision', 'show', '7', '--json']).value;
  const same = call(['decision', 'edit', '7', '--version', '1', '--title', `  ${d.title}  `, '--decider', ` ${d.decider} `, '--json']).value;
  assert.deepEqual([same.title, same.decider, same.version], [d.title, d.decider, 1]);
  const trimmed = call(['decision', 'edit', '7', '--version', '1', '--title', '  Queue or cron  ', '--decider', ' ana@example.com ', '--json']).value;
  assert.deepEqual([trimmed.title, trimmed.decider, trimmed.version], ['Queue or cron', 'ana@example.com', 2]);
});
test('a closed decision carries kind and via (the seeded #8 was withdrawn)', () => {
  const closed = run(['decision', 'show', '8', '--json']).envelope.value.closed;
  assert.deepEqual(Object.keys(closed).sort(), ['at', 'by', 'kind', 'reason', 'via']);
  assert.deepEqual([closed.kind, closed.via], ['withdrawn', 'interactive']);
});
test('decision ls --queue: entries grouped blocking, open, satisfied, closed, each with its blocks; the summary counts the live ones', () => {
  const call = session();
  // #7 on GRA-20 blocks the todo stories GRA-31 and GRA-32; a decision on GRA-22 (no stories) is open.
  const open = call(['decision', 'require', '--on', 'GRA-22', '--title', 'Stars or thumbs', '--decider', 'dan@example.com', '--due', '2020-01-01', '--idempotency-key', 'refining-epic:GRA-22:0a1b2c3d:1', '--json']).value.id;
  const q = call(['decision', 'ls', '--queue', '--json']);
  assert.equal(q.status, 0);
  assert.deepEqual(Object.keys(q.value).sort(), ['entries', 'summary']);
  assert.deepEqual(q.value.entries.map((e) => [e.decision.id, e.group, e.blocks]), [
    [7, 'blocking', [{ key: 'GRA-31', title: 'Retry failed matches' }, { key: 'GRA-32', title: 'Show match history' }]],
    [open, 'open', []],
  ]); // unscoped: closed #8 is left out
  assert.deepEqual(q.value.summary, { open: 2, blocking: 1, blocked_stories: 2, overdue: 1 });
  // Scoped by --on or --initiative, closed decisions are included, last.
  assert.deepEqual(call(['decision', 'ls', '--queue', '--on', 'GRA-20', '--json']).value.entries.map((e) => [e.decision.id, e.group]), [[7, 'blocking'], [8, 'closed']]);
  assert.deepEqual(call(['decision', 'ls', '--queue', '--initiative', 'GRA-12', '--json']).value.entries.map((e) => e.group), ['blocking', 'closed']);
  assert.deepEqual(call(['decision', 'ls', '--queue', '--on', 'GRA-999', '--json']).value, { entries: [], summary: { open: 0, blocking: 0, blocked_stories: 0, overdue: 0 } });
  const mine = call(['decision', 'ls', '--queue', '--mine', '--json']);
  assert.deepEqual([mine.status, mine.stdout], [1, '']); // clap: --queue conflicts with --mine
});
test('the queue: overdue first by due date, a blocked story counted once', () => {
  const call = session();
  const a = call(['decision', 'require', '--on', 'GRA-31', '--title', 'Retry count', '--decider', 'dan@example.com', '--due', '2020-02-01', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:1', '--json']).value.id;
  const b = call(['decision', 'require', '--on', 'GRA-31', '--title', 'Retry delay', '--decider', 'dan@example.com', '--due', '2020-01-01', '--idempotency-key', 'refining-epic:GRA-20:0a1b2c3d:2', '--json']).value.id;
  const q = call(['decision', 'ls', '--queue', '--on', 'GRA-31', '--json']).value;
  assert.deepEqual(q.entries.map((e) => e.decision.id), [b, a]); // both overdue: the earlier due date first
  const all = call(['decision', 'ls', '--queue', '--json']).value;
  assert.deepEqual(all.entries.map((e) => e.decision.id), [b, a, 7]); // overdue before not overdue
  assert.deepEqual(all.summary, { open: 3, blocking: 3, blocked_stories: 2, overdue: 2 }); // GRA-31 once
});
test('a plan decision takes reversibility one_way|two_way, stored as given', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (input) => { const r = spawnSync(fake, ['apply', '-', '--json'], { encoding: 'utf8', input: JSON.stringify(input), env: { ...process.env, REEVE_FAKE_LOG: log } }); return { status: r.status, ...JSON.parse(r.stdout) }; };
  const other = session(log);
  const ok = call({ id: 'refining-epic:GRA-20:0a1b2c3d:1', decisions: [
    { name: 'store', on: 'GRA-20', title: 'Which store', decider: 'dan@example.com', reversibility: 'one_way' },
    { name: 'colour', on: 'GRA-20', title: 'Which colour', decider: 'dan@example.com', reversibility: 'two_way' },
  ] });
  assert.deepEqual([ok.status, ok.value.decisions.map((d) => d.created)], [0, [true, true]]);
  const [oneWay, twoWay] = ok.value.decisions.map((d) => String(d.id));
  assert.equal(other(['decision', 'show', oneWay, '--json']).value.reversibility, 'one_way');
  assert.equal(other(['decision', 'show', twoWay, '--json']).value.reversibility, 'two_way');
  const refused = other(['decision', 'close', oneWay, '--decided', 'Postgres', '--json']);
  assert.deepEqual([refused.status, refused.code], [1, 'validation']);
  assert.equal(other(['decision', 'close', twoWay, '--decided', 'blue', '--json']).value.closed.kind, 'decided');
  const bad = call({ id: 'refining-epic:GRA-20:0a1b2c3d:1', decisions: [{ name: 'store', on: 'GRA-20', title: 'Which store', decider: 'dan@example.com', reversibility: 'one-way' }] });
  assert.deepEqual([bad.status, bad.code], [1, 'internal']);
  assert.match(bad.message, /unknown variant `one-way`/);
});

// Sprints and goals (Reeve CLI 0.3.0, kb/ADR-0014): the fake stands for an agent's token.
test('sprint show answers the active sprint with per-goal counts; a closed one adds at_close and changed_since_close', () => {
  const active = run(['sprint', 'show', '--json']).envelope.value;
  assert.equal(active.sprint.state, 'active');
  assert.deepEqual(active.sprint.goals.map((g) => g.id), [2, 3]);
  assert.deepEqual(active.counts.goals.map((g) => g.goal_id), [2, 3]);
  assert.ok(!('at_close' in active));
  assert.equal(active.counts.goals[0].todo, 2); // GRA-31 and GRA-32 serve goal 2 through epic GRA-20
  const closed = run(['sprint', 'show', '1', '--json']).envelope.value;
  assert.deepEqual([closed.sprint.state, closed.sprint.goals[0].verdict, closed.changed_since_close], ['closed', 'met', false]);
  assert.deepEqual(closed.at_close, closed.counts);
  assert.deepEqual([run(['sprint', 'show', '9', '--json']).envelope.code, run(['sprint', 'show', 'x', '--json']).status], ['not_found', 1]);
  const ls = run(['sprint', 'ls', '--json']).envelope.value;
  assert.deepEqual([ls.active.sprint.id, ls.draft.id, ls.closed.map((x) => x.id)], [2, 3, [1]]);
});
test("sprint show lists the promises in the sprint's range after promises_after; sprint ls leaves the active sprint's out", () => {
  const active = run(['sprint', 'show', '--json']).envelope.value;
  assert.equal(active.promises_after, '2026-10-20'); // the closed sprint's planned end
  assert.deepEqual(active.promises, [{ key: 'GRA-41', title: 'Upgrade the queue client library', on: '2026-11-03', to: 'the mentoring board', holder: 'own', epic_key: null, state: 'open', done_on: null, days: null }]);
  const closed = run(['sprint', 'show', '1', '--json']).envelope.value;
  assert.deepEqual([closed.promises, closed.promises_after], [[], null]); // the first sprint: every date up to its end
  const draft = run(['sprint', 'show', '3', '--json']).envelope.value;
  assert.deepEqual([draft.promises, draft.promises_after], [[], null]);
  const ls = run(['sprint', 'ls', '--json']).envelope.value;
  assert.deepEqual([ls.active.promises, ls.active.promises_after], [[], null]);
});
test("a person's sprint and goal commands are refused interactive_only, exit 2; a malformed verdict or confidence is a usage error", () => {
  for (const args of [['sprint', 'open', '--ends', '2026-11-20'], ['sprint', 'close', '--verdict', '2=met', '--verdict', '3=partly_met:the checklist: half done'],
    ['goal', 'add', '--outcome', 'O', '--check', 'C', '--idempotency-key', KEY], ['goal', 'edit', '2', '--version', '2', '--notes', 'N'],
    ['goal', 'rm', '4', '--version', '1'], ['goal', 'confidence', '2', 'on_track', 'fine']]) {
    const r = run([...args, '--json']);
    assert.deepEqual([r.status, r.envelope.outcome, r.envelope.reasons], [2, 'refused', [{ reason: 'interactive_only' }]], args.join(' '));
  }
  for (const args of [['sprint', 'close', '--verdict', '2=maybe'], ['sprint', 'close', '--verdict', 'x=met'], ['goal', 'suggest', '2', 'fine'], ['goal', 'link', '2'], ['sprint', 'open', '--ends', 'soon']]) {
    const r = run([...args, '--json']);
    assert.deepEqual([r.status, r.envelope, r.log], [1, null, ''], args.join(' '));
  }
});
test("a person's promise commands are refused interactive_only, exit 2, after clap's checks", () => {
  for (const item of [['story', 'GRA-41'], ['epic', 'GRA-20']]) {
    for (const args of [['--on', 'this-sprint'], ['--on', 'next-sprint', '--to', 'Acme'], ['--on', '2027-01-15'], ['--to', 'Acme'], ['--to', ''], ['--clear']]) {
      const r = run([item[0], 'promise', item[1], ...args, '--json']);
      assert.deepEqual([r.status, r.envelope && r.envelope.outcome, r.envelope && r.envelope.reasons], [2, 'refused', [{ reason: 'interactive_only' }]], `${item.join(' ')} ${args.join(' ')}`);
    }
    // clap's: one of --on, --to and --clear; --clear alone; --on a shortcut or a calendar date. Nothing is sent or logged.
    for (const [args, message] of [[[], /required arguments were not provided/], [['--clear', '--on', 'this-sprint'], /'--clear' cannot be used with '--on/],
      [['--clear', '--to', 'Acme'], /'--clear' cannot be used with '--to/], [['--on', 'tomorrow'], /is neither this-sprint, next-sprint nor a date/],
      [['--on', '2026-1-5'], /is neither this-sprint, next-sprint nor a date/], [['--on', '2026-02-30'], /is not a calendar date/], [['--version', '1'], /unexpected argument '--version'/]]) {
      const r = run([item[0], 'promise', item[1], ...args, '--json']);
      assert.deepEqual([r.status, r.envelope, r.log], [1, null, ''], `${item.join(' ')} ${args.join(' ')}`);
      assert.match(r.stderr, message, `${item.join(' ')} ${args.join(' ')}`);
    }
  }
});
test('story ls --promised filters on the promise the planner derived; every story and epic carries a promise, null when none', () => {
  const keys = (which) => { const r = run(['story', 'ls', '--promised', which, '--json']); assert.equal(r.status, 0, r.stderr); return r.envelope.value.map((x) => x.story.key); };
  assert.deepEqual(keys('this-sprint'), ['GRA-41']);
  assert.deepEqual(keys('any'), ['GRA-41']);
  assert.deepEqual(keys('next-sprint'), []);
  assert.deepEqual(keys('overdue'), []);
  const r = run(['story', 'ls', '--promised', 'soon', '--json']);
  assert.deepEqual([r.status, r.envelope], [1, null]);
  assert.match(r.stderr, /possible values: this-sprint, next-sprint, overdue, any/);
  const promised = run(['story', 'ls', '--promised', 'any', '--json']).envelope.value[0].story.promise;
  assert.deepEqual([promised.holder, promised.state, promised.due, promised.own.to, promised.epic], ['own', 'open', 'this_sprint', 'the mentoring board', null]);
  assert.equal(run(['story', 'context', 'GRA-31', '--json']).envelope.value.story.promise, null);
  assert.equal(run(['epic', 'show', 'GRA-20', '--json']).envelope.value.promise, null);
  const epic = run(['epic', 'show', 'PRM-1', '--json']).envelope.value;
  assert.deepEqual([epic.key, epic.promise.due, epic.promise.past, epic.promise.fact.on], ['GRA-22', 'next_sprint', false, '2026-11-17']);
});
test("a story under a promised epic inherits the epic's promise on read; its own earlier date wins", () => {
  const call = session();
  const k = (n) => `refining-epic:GRA-22:0a1b2c3d:${n}`;
  const a = call(['story', 'create', '--epic', 'GRA-22', '--title', 'Rate a session', '--criterion', 'A rating is saved', '--idempotency-key', k(1), '--json']).value.key;
  const b = call(['story', 'create', '--epic', 'GRA-22', '--title', 'Remind to rate', '--criterion', 'A reminder is sent', '--idempotency-key', k(2), '--json']).value.key;
  const promiseOf = (key, ...flags) => (call(['story', 'ls', ...flags, '--json']).value.find((x) => x.story.key === key) || {}).story?.promise;
  const inherited = { own: null, epic: { key: 'GRA-22', fact: { on: '2026-11-17', by: 'dan@example.com', at: '2026-10-20T09:00:00Z', to: 'the mentoring board' } }, on: '2026-11-17', holder: 'epic', state: 'open', due: 'next_sprint', days: null };
  assert.deepEqual(promiseOf(a, '--epic', 'GRA-22'), inherited);
  assert.deepEqual(call(['story', 'context', a, '--json']).value.story.promise, inherited);
  assert.deepEqual(call(['story', 'ls', '--promised', 'next-sprint', '--json']).value.map((x) => x.story.key), [a, b]);
  // done in the run, after the epic was promised: still inherited, kept or dropped, and no longer listed by --promised
  call(['story', 'mv', a, 'done', '--resolution', 'completed', '--json']);
  call(['story', 'mv', b, 'done', '--resolution', 'dropped', '--json']);
  assert.deepEqual([promiseOf(a, '--epic', 'GRA-22').state, promiseOf(b, '--epic', 'GRA-22').state, promiseOf(a, '--epic', 'GRA-22').due], ['kept', 'dropped', null]);
  assert.deepEqual(call(['story', 'ls', '--promised', 'any', '--json']).value.map((x) => x.story.key), ['GRA-41']);
  // GRA-41's own promise (3 Nov) is earlier than the epic's (17 Nov): its own counts, and the epic's shows beside it
  call(['story', 'edit', 'GRA-41', '--version', '1', '--epic', 'GRA-22', '--json']);
  const p = promiseOf('GRA-41', '--promised', 'this-sprint');
  assert.deepEqual([p.holder, p.on, p.own.on, p.epic.key, p.state, p.due], ['own', '2026-11-03', '2026-11-03', 'GRA-22', 'open', 'this_sprint']);
});
test('goal link and unlink persist; a story serves a goal through the nearest link; story context and --goal see it', () => {
  const call = session();
  assert.deepEqual(call(['goal', 'link', '2', 'GRA-31', 'GRA-40', '--json']).value.links, ['GRA-20', 'GRA-31', 'GRA-40']);
  const ctx = call(['story', 'context', 'GRA-31', '--json']).value;
  assert.deepEqual(ctx.goals.map((g) => [g.goal.id, g.via, g.starts_on, g.ends_on]), [[2, 'story', '2026-10-20', '2026-11-03']]);
  assert.deepEqual(ctx.story.goals, [{ id: 2, outcome: 'A mentee gets a mentor within a day', via: 'story' }]);
  assert.deepEqual(call(['story', 'ls', '--goal', '2', '--json']).value.map((x) => x.story.key), ['GRA-31', 'GRA-32', 'GRA-40']);
  assert.ok(call(['story', 'ls', '--goal', 'none', '--json']).value.every((x) => !x.story.goals.length));
  assert.deepEqual(call(['goal', 'unlink', '2', 'GRA-40', 'GRA-47', '--json']).value.links, ['GRA-20', 'GRA-31']); // not linked: no change
  assert.equal(call(['goal', 'link', '2', 'GRA-999', '--json']).code, 'not_found');
  assert.equal(call(['story', 'ls', '--goal', 'some', '--json']).code, 'validation');
});
test('goal suggest fills the suggestion, never the confidence, on the active sprint only; a closed sprint refuses every goal write', () => {
  const call = session();
  const g = call(['goal', 'suggest', '3', 'off_track', '1 of 4 completed', '--json']).value;
  assert.deepEqual([g.confidence, g.suggested_confidence, g.suggested_note], ['at_risk', 'off_track', '1 of 4 completed']);
  assert.equal(call(['sprint', 'show', '--json']).value.sprint.goals[1].suggested_confidence, 'off_track');
  assert.deepEqual(call(['goal', 'suggest', '4', 'on_track', '--json']).reasons, [{ reason: 'sprint_not_active' }]);
  for (const args of [['goal', 'suggest', '1', 'on_track'], ['goal', 'link', '1', 'GRA-31'], ['goal', 'unlink', '1', 'GRA-21']]) {
    const r = call([...args, '--json']);
    assert.deepEqual([r.status, r.reasons], [2, [{ reason: 'sprint_closed' }]], args.join(' '));
  }
});
test('story context lists the screenshot on GRA-31; attachment get needs --dir, creates it and downloads there', () => {
  const ID = '0193a6a2-7b1c-7d2e-9f00-000000000031';
  const ctx = run(['story', 'context', 'GRA-31', '--json']).envelope.value;
  assert.deepEqual(ctx.attachments.map((a) => [a.id, a.owner.item, a.owner.key, a.content_type]), [[ID, 'story', 'GRA-31', 'image/png']]);
  assert.deepEqual(run(['story', 'context', 'GRA-32', '--json']).envelope.value.attachments, []);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-'));
  const nested = path.join(dir, 'a', 'b');
  const got = run(['attachment', 'get', ID, '--dir', nested, '--json']);
  assert.deepEqual([got.status, got.envelope.value.path], [0, path.join(nested, `${ID}.png`)]);
  assert.deepEqual(fs.readFileSync(got.envelope.value.path), fs.readFileSync(path.join(path.dirname(fake), 'shot.png')));
  assert.equal(fs.statSync(got.envelope.value.path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(nested).mode & 0o777, 0o700);
  assert.equal(got.log, `attachment get ${ID} --dir ${nested} --json\n`);
  const noDir = run(['attachment', 'get', ID, '--json']);
  assert.deepEqual([noDir.status, noDir.stdout, noDir.log], [1, '', '']);
  assert.match(noDir.stderr, /required arguments were not provided: --dir/);
  assert.equal(run(['attachment', 'get', '0193a6a2-7b1c-7d2e-9f00-000000000099', '--dir', dir, '--json']).envelope.code, 'not_found');
  const bad = run(['attachment', 'get', '7', '--dir', dir, '--json']);
  assert.deepEqual([bad.status, bad.stdout, bad.log], [1, '', '']);
  assert.match(bad.stderr, /invalid value '7' for '<ID>'/);
});

function runIn(log, args, env = {}, input) {
  const r = spawnSync(fake, args, { encoding: 'utf8', input, env: { ...process.env, REEVE_FAKE_LOG: log, ...env } });
  return { status: r.status, stdout: r.stdout, envelope: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null };
}
const freshLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');

test('story mv: entering active work assigns the signed-in user to an unowned story and keeps an owner', () => {
  const log = freshLog();
  assert.equal(runIn(log, ['story', 'mv', 'GRA-43', 'in-progress', '--json']).envelope.value.owner, 'dan@example.com');
  runIn(log, ['story', 'edit', 'GRA-44', '--owner', 'sam@example.com', '--version', '1', '--json']);
  assert.equal(runIn(log, ['story', 'mv', 'GRA-44', 'in-progress', '--json']).envelope.value.owner, 'sam@example.com');
  assert.equal(runIn(log, ['story', 'mv', 'GRA-45', 'done', '--resolution', 'dropped', '--json']).envelope.value.owner, null);
});
test('blocked_by: a blocker in review owned by someone else refuses a start, with its delivery and owner', () => {
  const log = freshLog();
  const env = { REEVE_FAKE_BLOCKED: 'GRA-43' };
  const r = runIn(log, ['story', 'mv', 'GRA-43', 'in-progress', '--json'], env);
  assert.equal(r.status, 2);
  const want = { reason: 'blocked_by', story: 'GRA-42', delivery: 'in_review', owner: 'mia@example.com' };
  assert.deepEqual(r.envelope.reasons.filter((x) => x.reason === 'blocked_by'), [want]);
  const ctx = runIn(log, ['story', 'context', 'GRA-43', '--json'], env).envelope.value;
  assert.deepEqual(r.envelope.reasons, ctx.readiness.reasons, 'context and mv agree');
  assert.deepEqual(ctx.blockers.map((b) => [b.key, b.delivery, b.owner]), [['GRA-42', 'in_review', 'mia@example.com']]);
});
test('blocked_by is owner-scoped: same-owner active blocker and a testing blocker do not block, another owner\'s does', () => {
  const log = freshLog();
  const apply = (blocks) => runIn(log, ['apply', '-', '--json'], {}, JSON.stringify({ id: 'blk', initiatives: [], epics: [], stories: [], decisions: [], blocks }));
  const blockedBy = (k) => runIn(log, ['story', 'context', k, '--json']).envelope.value.readiness.reasons.filter((x) => x.reason === 'blocked_by');
  assert.equal(apply([{ story: 'GRA-31', blocked_by: 'GRA-32' }, { story: 'GRA-43', blocked_by: 'GRA-44' }, { story: 'GRA-45', blocked_by: 'GRA-46' }]).status, 0);
  runIn(log, ['story', 'mv', 'GRA-32', 'in-progress', '--json']); // owner dan
  runIn(log, ['story', 'edit', 'GRA-31', '--owner', 'dan@example.com', '--version', '1', '--json']);
  assert.deepEqual(blockedBy('GRA-31'), [], 'same owner, in progress');
  runIn(log, ['story', 'edit', 'GRA-43', '--owner', 'sam@example.com', '--version', '2', '--json']);
  runIn(log, ['story', 'mv', 'GRA-44', 'in-progress', '--json']); // owner dan, dependent sam
  assert.deepEqual(blockedBy('GRA-43'), [{ reason: 'blocked_by', story: 'GRA-44', delivery: 'in_progress', owner: 'dan@example.com' }]);
  runIn(log, ['story', 'mv', 'GRA-46', 'testing', '--json']);
  assert.deepEqual(blockedBy('GRA-45'), [], 'testing blocker');
});
test('story show answers one story with its version, delivery, owner and criteria; an unknown key is not_found', () => {
  const r = run(['story', 'show', 'GRA-31', '--json']);
  assert.equal(r.status, 0);
  const s = r.envelope.value;
  assert.deepEqual([s.key, s.version, s.delivery, s.owner, s.epic], ['GRA-31', 1, 'todo', null, 'GRA-20']);
  assert.deepEqual(s.criteria[0], { text: 'A failed match is retried up to three times', done: false });
  assert.equal(r.log, 'story show GRA-31 --json\n');
  assert.equal(run(['story', 'show', 'GRA-999', '--json']).envelope.code, 'not_found');
});
test('REEVE_FAKE_TRIAGE=1 adds GRA-48 to the untriaged queue, a duplicate of GRA-46; unset, the queue is unchanged', () => {
  const keys = (env) => run(['story', 'ls', '--untriaged', '--json'], env).envelope.value.map((x) => x.story.key);
  assert.ok(!keys({}).includes('GRA-48'));
  assert.ok(keys({ REEVE_FAKE_TRIAGE: '1' }).includes('GRA-48'));
  const hits = run(['story', 'similar', 'Fax match summaries to the coordinators', '--limit', '6', '--json'], { REEVE_FAKE_TRIAGE: '1' }).envelope.value.map((x) => x.key);
  assert.ok(hits.includes('GRA-46') && hits.includes('GRA-48'), 'the item itself is a hit, as on the real planner');
});
test('a duplicate comment takes triage-dup:<KEY>:<DUP> and replays by it', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const add = () => JSON.parse(spawnSync(fake, ['comment', 'add', '--item', 'GRA-48', '--body', 'Duplicate of GRA-46.', '--idempotency-key', 'triage-dup:GRA-48:GRA-46', '--json'],
    { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log, REEVE_FAKE_TRIAGE: '1' } }).stdout);
  assert.equal(add().value.length, 1);
  assert.equal(add().value.length, 1, 'the same key adds nothing');
  assert.equal(run(['comment', 'add', '--item', 'GRA-42', '--body', 'B', '--idempotency-key', 'triage-dup:GRA-48', '--json']).envelope.code, 'validation');
});

// Item links and web links (kb/ADR-0031). `linkSession` shares one state file between calls, as one run does,
// and passes standard input (a plan).
function linkSession() {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args, input) => {
    const r = spawnSync(fake, args, { encoding: 'utf8', input, env: { ...process.env, REEVE_FAKE_LOG: log } });
    return { status: r.status, envelope: r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null, stdout: r.stdout, stderr: r.stderr };
  };
  call.log = log; // for a call that needs an environment of its own (runIn)
  return call;
}
test('link add, ls and rm: an item link is read from each side, stored once, and removed as it was added', () => {
  const call = linkSession();
  const added = call(['link', 'add', 'GRA-32', 'follows', 'GRA-31', '--json']);
  assert.equal(added.status, 0);
  assert.deepEqual(added.envelope.value, [{ type: 'follows', direction: 'out', label: 'follows', item: { key: 'GRA-31', level: 'story', title: 'Retry failed matches' } }]);
  assert.deepEqual(call(['link', 'add', 'GRA-32', 'follows', 'GRA-31', '--json']).envelope.value, added.envelope.value, 'a repeat changes nothing');
  // relates-to is one link whichever end adds it, `out` from both sides, and an item of any level takes one
  call(['link', 'add', 'GRA-31', 'relates-to', 'GRA-12', '--json']);
  assert.deepEqual(call(['link', 'add', 'GRA-12', 'relates-to', 'GRA-31', '--json']).envelope.value, [{ type: 'relates_to', direction: 'out', label: 'relates to', item: { key: 'GRA-31', level: 'story', title: 'Retry failed matches' } }]);
  call(['link', 'add', 'GRA-46', 'duplicates', 'GRA-31', '--json']);
  const listed = call(['link', 'ls', 'GRA-31', '--json']).envelope.value;
  assert.deepEqual(listed.links.map((l) => [l.type, l.direction, l.label, l.item.key, l.item.level]), [
    ['follows', 'in', 'is followed by', 'GRA-32', 'story'], ['duplicates', 'in', 'is duplicated by', 'GRA-46', 'story'], ['relates_to', 'out', 'relates to', 'GRA-12', 'initiative']]);
  assert.deepEqual(listed.web_links, []);
  // named the wrong way round, a removal answers ok and removes nothing; named as it was added, it removes the link
  assert.equal(call(['link', 'rm', 'GRA-31', 'follows', 'GRA-32', '--json']).envelope.value.length, 3);
  assert.deepEqual(call(['link', 'rm', 'GRA-32', 'follows', 'GRA-31', '--json']).envelope, { outcome: 'ok', value: [] });
  assert.deepEqual(call(['link', 'rm', 'GRA-32', 'follows', 'GRA-31', '--json']).envelope, { outcome: 'ok', value: [] }, 'removing what is not there changes nothing');
  assert.deepEqual(call(['link', 'ls', 'GRA-31', '--json']).envelope.value.links.map((l) => l.label), ['is duplicated by', 'relates to']);
});
test('an item link holds nothing back: follows leaves readiness and blocked_by alone; story block is the blocker', () => {
  const call = linkSession();
  const before = call(['story', 'context', 'GRA-31', '--json']).envelope.value.readiness;
  call(['link', 'add', 'GRA-31', 'follows', 'GRA-32', '--json']);
  const linked = call(['story', 'context', 'GRA-31', '--json']).envelope.value;
  assert.deepEqual(linked.readiness, before);
  assert.deepEqual([linked.story.blocked_by, linked.blockers, linked.story.links.map((l) => l.label)], [[], [], ['follows']]);
  assert.deepEqual(call(['story', 'block', 'GRA-31', '--by', 'GRA-32', '--json']).envelope, { outcome: 'ok', value: {} });
  assert.deepEqual(call(['story', 'block', 'GRA-31', '--by', 'GRA-32', '--json']).envelope, { outcome: 'ok', value: {} }, 'a repeat changes nothing');
  const blocked = call(['story', 'context', 'GRA-31', '--json']).envelope.value;
  assert.deepEqual(blocked.story.blocked_by, ['GRA-32']);
  assert.ok(blocked.readiness.reasons.some((r) => r.reason === 'blocked_by' && r.story === 'GRA-32'));
  call(['story', 'unblock', 'GRA-31', '--by', 'GRA-32', '--json']);
  assert.deepEqual(call(['story', 'show', 'GRA-31', '--json']).envelope.value.blocked_by, []);
  // a blocker is between two stories
  assert.equal(call(['story', 'block', 'GRA-20', '--by', 'GRA-31', '--json']).envelope.code, 'not_found');
  assert.equal(call(['story', 'block', 'GRA-31', '--json']).stdout, '', '--by is required');
});
test('a blocking word or another unknown name where the item link name goes is a usage error; an incomplete form is too', () => {
  for (const word of ['blocks', 'blocked-by', 'blocked_by', 'depends-on', 'depends_on']) {
    for (const verb of ['add', 'rm']) {
      const r = run(['link', verb, 'GRA-32', word, 'GRA-31', '--json']);
      assert.deepEqual([r.status, r.stdout, r.log], [1, '', ''], `${verb} ${word}`);
      assert.match(r.stderr, /blocking is not an item link: use `reeve story block <KEY> --by <OTHER>`/);
    }
  }
  const underscore = run(['link', 'add', 'GRA-32', 'relates_to', 'GRA-31', '--json']);
  assert.deepEqual([underscore.status, underscore.stdout], [1, '']);
  assert.match(underscore.stderr, /`relates_to` is not an item link name: use follows, duplicates or relates-to/);
  for (const args of [
    ['link', 'add', 'GRA-32', '--json'], ['link', 'add', 'GRA-32', 'follows', '--json'], ['link', 'rm', 'GRA-32', '--json'],
    ['link', 'add', 'GRA-32', '--url', 'https://example.com/a', '--json'], ['link', 'add', 'GRA-32', '--title', 'A', '--json'],
    ['link', 'add', 'GRA-32', 'follows', 'GRA-31', '--url', 'https://example.com/a', '--title', 'A', '--json'],
    ['link', 'rm', 'GRA-32', '--url', 'https://example.com/a', '--title', 'A', '--json'], ['link', 'ls', '--json'],
  ]) {
    const r = run(args);
    assert.deepEqual([r.status, r.stdout, r.log], [1, '', ''], args.join(' '));
  }
  // the planner's own answers: an item cannot link to itself, and a key that names nothing is not_found
  assert.deepEqual(run(['link', 'add', 'GRA-32', 'follows', 'GRA-32', '--json']).envelope, { outcome: 'error', code: 'validation', message: 'an item cannot have an item link to itself' });
  for (const args of [['link', 'add', 'GRA-32', 'follows', 'GRA-999', '--json'], ['link', 'add', 'GRA-999', 'follows', 'GRA-32', '--json'], ['link', 'ls', 'GRA-999', '--json']]) {
    assert.equal(run(args).envelope.code, 'not_found', args.join(' '));
  }
});
test('web links: a titled URL on an item, stored trimmed and in the parser\'s form, once per item, removed by its URL', () => {
  const call = linkSession();
  const first = call(['link', 'add', 'GRA-20', '--url', 'HTTPS://Example.com/wiki/Scenario', '--title', '  Scenario page ', '--json']);
  assert.deepEqual(first.envelope, { outcome: 'ok', value: [{ id: 1, title: 'Scenario page', url: 'https://example.com/wiki/Scenario' }] });
  assert.deepEqual(call(['link', 'add', 'GRA-20', '--url', 'https://example.com/wiki/Scenario', '--title', 'Scenario page', '--json']).envelope, first.envelope, 'a repeat changes nothing');
  const other = call(['link', 'add', 'GRA-20', '--url', 'https://example.com/wiki/Scenario', '--title', 'Another title', '--json']);
  assert.deepEqual([other.status, other.envelope.code], [1, 'validation']);
  assert.equal(other.envelope.message, 'this item already has a web link to that URL, titled "Scenario page": remove it first, then add it with the new title');
  assert.deepEqual(call(['link', 'add', 'GRA-20', '--url', 'http://example.com/board', '--title', 'Board', '--json']).envelope.value.map((w) => [w.id, w.title, w.url]),
    [[1, 'Scenario page', 'https://example.com/wiki/Scenario'], [2, 'Board', 'http://example.com/board']]);
  // another item may have the same URL, under any title
  assert.equal(call(['link', 'add', 'GRA-31', '--url', 'https://example.com/wiki/Scenario', '--title', 'Another title', '--json']).status, 0);
  for (const [url, title, message] of [
    ['ftp://example.com/a', 'A', /URL must start with http:\/\/ or https:\/\//], ['https://user:secret@example.com/a', 'A', /no user name or password/],
    ['example.com/a', 'A', /URL must start with/], [`https://example.com/${'a'.repeat(1000)}`, 'A', /at most 1000 characters/],
    ['https://example.com/a', '   ', /title must be 1 to 200 characters on one line/], ['https://example.com/a', 'a'.repeat(201), /title must be 1 to 200/],
    ['https://example.com/a', 'two\nlines', /on one line/], ['https://example.com/a', 'a\ttab', /no tab or other control character/],
  ]) {
    const r = call(['link', 'add', 'GRA-20', '--url', url, '--title', title, '--json']);
    assert.deepEqual([r.status, r.envelope.code], [1, 'validation'], `${url} ${JSON.stringify(title)}`);
    assert.match(r.envelope.message, message);
  }
  assert.equal(call(['link', 'add', 'GRA-20', '--url', 'https://example.com/a', '--title', 'å'.repeat(200), '--json']).status, 0, '200 characters, not bytes');
  // one item's answers carry both lists; a list of items carries neither
  const shown = call(['epic', 'show', 'GRA-20', '--json']).envelope.value;
  assert.deepEqual([shown.links, shown.web_links.length], [[], 3]);
  assert.ok(call(['epic', 'ls', '--json']).envelope.value.every((e) => !('links' in e) && !('web_links' in e)));
  assert.ok(call(['story', 'ls', '--epic', 'GRA-20', '--json']).envelope.value.every((x) => !('links' in x.story) && !('web_links' in x.story)));
  const ctx = call(['story', 'context', 'GRA-31', '--json']).envelope.value;
  assert.deepEqual([ctx.story.links, ctx.story.web_links.length, 'links' in ctx.epic, 'web_links' in ctx.epic, 'links' in ctx.initiative], [[], 1, false, false, false]);
  assert.deepEqual(Object.keys(call(['initiative', 'show', 'GRA-12', '--json']).envelope.value).slice(-2), ['links', 'web_links']);
  // removed by the URL in either spelling; a URL the item does not have removes nothing
  assert.equal(call(['link', 'rm', 'GRA-20', '--url', 'https://example.com/nothing', '--json']).envelope.value.length, 3);
  assert.deepEqual(call(['link', 'rm', 'GRA-20', '--url', 'https://EXAMPLE.com/wiki/Scenario', '--json']).envelope.value.map((w) => w.id), [2, 4]); // ids are the planner's, not the item's: 3 is GRA-31's
  assert.deepEqual(call(['link', 'ls', 'GRA-20', '--json']).envelope.value.web_links.map((w) => w.title), ['Board', 'å'.repeat(200)]);
});
test('a plan takes links and web_links: any level by name or key, created once, a relates_to stored lower key first', () => {
  const call = linkSession();
  const plan = {
    id: 'refining-epic:GRA-20:0a1b2c3d:1',
    stories: [{ name: 'step-1', title: 'Step one', epic: 'GRA-20', criteria: ['a'] }, { name: 'step-2', title: 'Step two', epic: 'GRA-20', criteria: ['b'] }],
    links: [{ from: 'step-2', type: 'follows', to: 'step-1' }, { from: 'step-1', type: 'relates_to', to: 'GRA-12' }, { from: 'GRA-32', type: 'relates_to', to: 'GRA-31' }],
    web_links: [{ on: 'step-1', title: ' Scenario page ', url: 'https://example.com/wiki/scenario' }, { on: 'GRA-20', title: 'Board', url: 'https://example.com/board' }],
  };
  const first = call(['apply', '-', '--json'], JSON.stringify(plan));
  assert.equal(first.status, 0, first.stdout);
  const [s1, s2] = first.envelope.value.items.map((i) => i.key);
  assert.deepEqual(first.envelope.value.links, [
    { from: s2, from_level: 'story', type: 'follows', to: s1, to_level: 'story', created: true },
    { from: s1, from_level: 'story', type: 'relates_to', to: 'GRA-12', to_level: 'initiative', created: true },
    { from: 'GRA-31', from_level: 'story', type: 'relates_to', to: 'GRA-32', to_level: 'story', created: true }, // the lower key first, whichever end the plan named
  ]);
  assert.deepEqual(first.envelope.value.web_links, [
    { on: s1, level: 'story', id: 1, title: 'Scenario page', url: 'https://example.com/wiki/scenario', created: true },
    { on: 'GRA-20', level: 'epic', id: 2, title: 'Board', url: 'https://example.com/board', created: true },
  ]);
  // follows is no blocker: the plan listed none, so the story has none
  assert.deepEqual(first.envelope.value.blocks, []);
  const shown = call(['story', 'show', s2, '--json']).envelope.value;
  assert.deepEqual([shown.blocked_by, shown.links.map((l) => `${l.label} ${l.item.key}`)], [[], [`follows ${s1}`]]);
  // the same plan again: every list is there, with the same keys, ends and ids, and nothing is created
  const again = call(['apply', '-', '--json'], JSON.stringify(plan)).envelope.value;
  const replayed = (list) => list.map((x) => ({ ...x, created: false }));
  assert.deepEqual(again.items, replayed(first.envelope.value.items));
  assert.deepEqual(again.links, replayed(first.envelope.value.links));
  assert.deepEqual(again.web_links, replayed(first.envelope.value.web_links));
  assert.deepEqual([again.items.length, again.links.length, again.web_links.length], [2, 3, 2]);
});
test('a plan with a bad link is refused whole; a blocking word as a type never reaches the planner', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const apply = (plan) => { const r = spawnSync(fake, ['apply', '-', '--json'], { encoding: 'utf8', input: JSON.stringify(plan), env: { ...process.env, REEVE_FAKE_LOG: log } }); return { status: r.status, ...JSON.parse(r.stdout) }; };
  const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  for (const type of ['blocks', 'blocked_by', 'depends_on']) {
    const r = apply({ id: 'p', links: [{ from: 'GRA-31', type: 'follows', to: 'GRA-32' }, { from: 'GRA-32', type, to: 'GRA-31' }] });
    assert.deepEqual([r.status, r.code], [1, 'internal'], type);
    assert.match(r.message, /blocking is not an item link: list it under `blocks` as `\{story, blocked_by\}` \(stories only; otherwise leave it out\)/);
  }
  assert.match(apply({ id: 'p', links: [{ from: 'GRA-31', type: 'relates-to', to: 'GRA-32' }] }).message, /links\[0\]\.type: unknown variant `relates-to`, expected one of `follows`, `duplicates`, `relates_to`/);
  assert.match(apply({ id: 'p', links: [{ from: 'GRA-31', type: 'follows', to: 'GRA-32', direction: 'in' }] }).message, /unknown field `direction`/);
  assert.match(apply({ id: 'p', web_links: [{ on: 'GRA-31', title: 'T', url: 'https://example.com/', note: 'x' }] }).message, /unknown field `note`/);
  assert.equal(logged(), '', 'none of them was sent');
  const bad = apply({
    id: 'p',
    stories: [{ name: 'a', title: 'A' }],
    links: [{ from: 'a', type: 'follows', to: 'GRA-999' }, { from: 'GRA-31', type: 'duplicates', to: 'GRA-31' }, { from: 'a', type: 'relates_to', to: 'a' }],
    web_links: [{ on: 'a', title: 'One', url: 'https://example.com/x' }, { on: 'a', title: 'Two', url: 'https://EXAMPLE.com/x' }, { on: 'GRA-31', title: '', url: 'ftp://example.com/' }, { on: 'nobody', title: 'T', url: 'https://example.com/' },
      { on: 'GRA-32', title: `  ${'x'.repeat(50)}  `, url: 'ftp://example.com/' }],
  });
  assert.deepEqual([bad.status, bad.code], [1, 'validation']);
  for (const want of [/item link "a" follows "GRA-999": to "GRA-999" is neither a name in the plan nor an existing item/, /item link "GRA-31" duplicates "GRA-31": an item cannot have an item link to itself/,
    /item link "a" relates_to "a": an item cannot have an item link to itself/, /web link "Two" on "a": the plan gives "a" that URL under two titles \("One" and "Two"\); an item has a URL once/,
    /web link "" on "GRA-31": a web link's title must be/, /web link "T" on "nobody": on "nobody" is neither a name in the plan nor an existing item/,
    // a problem is placed by the trimmed title's first 40 characters, never by the URL
    new RegExp(`web link "${'x'.repeat(40)}" on "GRA-32": a web link's URL must start with`)]) assert.match(bad.message, want);
  // as WebLink::new: a bad title is reported alone, whatever the URL is
  assert.doesNotMatch(bad.message, /on "GRA-31": a web link's URL/);
  assert.doesNotMatch(bad.message, /ftp:/);
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const big = apply({ id: 'p', links: many(501, () => ({ from: 'GRA-31', type: 'relates_to', to: 'GRA-32' })), web_links: many(501, (i) => ({ on: 'GRA-31', title: `T${i}`, url: `https://example.com/${i}` })) });
  assert.equal(big.message, 'a plan holds at most 500 item links; this one has 501; a plan holds at most 500 web links; this one has 501');
  // nothing was written by any of them
  const r = spawnSync(fake, ['link', 'ls', 'GRA-31', '--json'], { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } });
  assert.deepEqual(JSON.parse(r.stdout).value, { links: [], web_links: [] });
  // a URL the item already has under another title is a problem of the plan too
  spawnSync(fake, ['link', 'add', 'GRA-31', '--url', 'https://example.com/b', '--title', 'B', '--json'], { env: { ...process.env, REEVE_FAKE_LOG: log } });
  assert.match(apply({ id: 'p', web_links: [{ on: 'GRA-31', title: 'Other', url: 'https://example.com/b' }] }).message, /web link "Other" on "GRA-31": this item already has a web link to that URL, titled "B": remove it first/);
});

// The review of lorekeeper#60: the fake against the real CLI and planner (Reeve's crates/reeve-protocol/src/plan.rs,
// crates/reeve-planning/src/handler/{plans,item_links,mod}.rs and domain/web_link.rs).
const applyIn = (log, plan, env = {}) => { const r = runIn(log, ['apply', '-', '--json'], env, typeof plan === 'string' ? plan : JSON.stringify(plan)); return { status: r.status, ...JSON.parse(r.stdout) }; };
test('an item\'s item links come in the planner\'s order: name, out before in, the other key\'s number, its text', () => {
  const call = linkSession();
  for (const args of [
    ['GRA-31', 'relates-to', 'GRA-47'], ['GRA-47', 'follows', 'GRA-31'], ['GRA-32', 'follows', 'GRA-31'], ['GRA-31', 'follows', 'GRA-46'], ['GRA-31', 'follows', 'GRA-40'],
    ['GRA-31', 'relates-to', 'GRA-12'], ['GRA-45', 'duplicates', 'GRA-31'], ['GRA-31', 'duplicates', 'GRA-44'], ['GRA-31', 'follows', 'GRA-100'],
  ]) {
    if (args[2] === 'GRA-100') call(['story', 'create', '--title', 'A hundred', '--idempotency-key', KEY, '--json']); // the fake's first new key
    assert.equal(call(['link', 'add', ...args, '--json']).status, 0, args.join(' '));
  }
  assert.deepEqual(call(['link', 'ls', 'GRA-31', '--json']).envelope.value.links.map((l) => `${l.type} ${l.direction} ${l.item.key}`), [
    'follows out GRA-40', 'follows out GRA-46', 'follows out GRA-100', 'follows in GRA-32', 'follows in GRA-47',
    'duplicates out GRA-44', 'duplicates in GRA-45', 'relates_to out GRA-12', 'relates_to out GRA-47']);
  // two prefixes can hold one number: the key text breaks the tie
  const two = linkSession();
  const env = { REEVE_FAKE_COLLISION: '1' };
  const add = (other) => assert.equal(runIn(two.log, ['link', 'add', 'GRA-31', 'relates-to', other, '--json'], env).status, 0, other);
  add('GRA-32'); add('OLD-1');
  assert.deepEqual(JSON.parse(runIn(two.log, ['link', 'ls', 'GRA-31', '--json'], env).stdout).value.links.map((l) => l.item.key), ['OLD-1', 'GRA-32']);
});
test('link rm refuses an item link from an item to itself, as link add does; a flag given twice and a malformed key are usage errors', () => {
  const call = linkSession();
  for (const verb of ['add', 'rm']) {
    assert.deepEqual(call(['link', verb, 'GRA-31', 'follows', 'GRA-31', '--json']).envelope, { outcome: 'error', code: 'validation', message: 'an item cannot have an item link to itself' }, verb);
    // one item under two spellings (GRA-22 was migrated from PRM-1) is still one item
    assert.equal(call(['link', verb, 'GRA-22', 'relates-to', 'PRM-1', '--json']).envelope.code, 'validation', verb);
    assert.equal(call(['link', verb, 'GRA-999', 'follows', 'GRA-999', '--json']).envelope.code, 'not_found', `${verb}: the items are looked up first`);
  }
  for (const [args, message] of [
    [['link', 'add', 'GRA-20', '--url', 'https://example.com/a', '--url', 'https://example.com/b', '--title', 'A', '--json'], /the argument '--url' cannot be used multiple times/],
    [['link', 'add', 'GRA-20', '--url', 'https://example.com/a', '--title', 'A', '--title', 'B', '--json'], /the argument '--title' cannot be used multiple times/],
    [['link', 'rm', 'GRA-20', '--url', 'https://example.com/a', '--url', 'https://example.com/a', '--json'], /'--url' cannot be used multiple times/],
    [['story', 'ls', '--open', '--open', '--json'], /the argument '--open' cannot be used multiple times/],
    [['story', 'edit', 'GRA-31', '--version', '1', '--title', 'A', '--title', 'B', '--json'], /'--title' cannot be used multiple times/],
    [['link', 'add', 'gra-31', 'follows', 'GRA-32', '--json'], /invalid value 'gra-31' for '<KEY>': invalid key: gra-31/],
    [['link', 'rm', 'GRA-31', 'follows', '32', '--json'], /invalid value '32' for '\[OTHER\]': invalid key: 32/],
    [['link', 'add', 'GRA-31', 'follows', 'send-invoice', '--json'], /invalid key: send-invoice/],
    [['link', 'ls', 'thirty-one', '--json'], /invalid value 'thirty-one' for '<KEY>'/],
    [['link', 'rm', 'GRA_31', '--url', 'https://example.com/a', '--json'], /invalid key: GRA_31/],
    [['story', 'block', 'GRA-31', '--by', 'gra-32', '--json'], /invalid value 'gra-32' for '--by <BY>': invalid key: gra-32/],
    [['story', 'unblock', '31', '--by', 'GRA-32', '--json'], /invalid value '31' for '<KEY>'/],
  ]) {
    const r = run(args);
    assert.deepEqual([r.status, r.stdout, r.log], [1, '', ''], args.join(' '));
    assert.match(r.stderr, message, args.join(' '));
  }
  // a flag that repeats still repeats
  assert.equal(run(['story', 'create', '--title', 'A', '--criterion', 'a', '--criterion', 'b', '--label', 'x', '--label', 'y', '--idempotency-key', KEY, '--json']).envelope.value.criteria.length, 2);
  assert.deepEqual(call(['link', 'ls', 'GRA-31', '--json']).envelope.value, { links: [], web_links: [] }, 'nothing was written');
});
test('a plan is read as the real CLI reads it: required fields, list shapes and names checked before anything is sent, a scalar read as text', () => {
  const log = freshLog();
  const web = { on: 'GRA-31', title: 'T', url: 'https://example.com/' };
  for (const [plan, message] of [
    [{}, /: missing field `id`$/],
    [[], /: invalid type: sequence, expected struct ApplyPlan$/],
    [{ id: ['p'] }, /: id: invalid type: sequence, expected a string$/],
    [{ id: 'p', web_links: [{ on: 'GRA-31', url: 'https://example.com/' }] }, /: web_links\[0\]: missing field `title`$/],
    [{ id: 'p', web_links: [{ ...web, title: ['T'] }] }, /: web_links\[0\]\.title: invalid type: sequence, expected a string$/],
    [{ id: 'p', web_links: [{ ...web, url: { href: 'x' } }] }, /: web_links\[0\]\.url: invalid type: map, expected a string$/],
    [{ id: 'p', web_links: web }, /: web_links: invalid type: map, expected a sequence$/],
    [{ id: 'p', links: null }, /: links: invalid type: unit value, expected a sequence$/],
    [{ id: 'p', links: [{ from: 'GRA-31', type: 'follows' }] }, /: links\[0\]: missing field `to`$/],
    [{ id: 'p', links: [{ from: 'GRA-31', to: 'GRA-32' }] }, /: links\[0\]: missing field `type`$/],
    [{ id: 'p', links: [{ from: 'GRA-31', type: null, to: 'GRA-32' }] }, /: links\[0\]\.type: unknown variant `null`, expected one of `follows`, `duplicates`, `relates_to`$/],
    [{ id: 'p', links: ['GRA-31 follows GRA-32'] }, /: links\[0\]: invalid type: string "GRA-31 follows GRA-32", expected struct$/],
    [{ id: 'p', blocks: [{ story: 'GRA-31' }] }, /: blocks\[0\]: missing field `blocked_by`$/],
    [{ id: 'p', initiatives: [{ name: 'i', title: 'I' }] }, /: initiatives\[0\]: missing field `horizon`$/],
    [{ id: 'p', stories: [{ title: 'S' }] }, /: stories\[0\]: missing field `name`$/],
    [{ id: 'p', stories: [{ name: 's', title: 'S', criteria: 'one' }] }, /: stories\[0\]\.criteria: invalid type: string "one", expected a sequence$/],
    [{ id: 'p', stories: [{ name: 's', title: 'S', criteria: null }] }, /: stories\[0\]\.criteria: invalid type: unit value, expected a sequence$/],
    [{ id: 'p', stories: [{ name: 's', title: 'S', labels: [['x']] }] }, /: stories\[0\]\.labels\[0\]: invalid type: sequence, expected a string$/],
    [{ id: 'p', stories: [{ name: 's', title: 'S', kind: 'epic' }] }, /: stories\[0\]\.kind: unknown variant `epic`, expected one of `story`, `bug`, `chore`$/],
    [{ id: 'p', stories: [{ name: 's', title: 'S', delivery: 'in-progress' }] }, /: stories\[0\]\.delivery: unknown variant `in-progress`, expected one of `todo`, `in_progress`, `in_review`, `testing`, `done`$/],
    [{ id: 'p', decisions: [{ name: 'd', on: 'GRA-20', title: 'T', decider: 'dan@example.com', reversibility: 'one-way' }] }, /: decisions\[0\]\.reversibility: unknown variant `one-way`, expected `one_way` or `two_way`$/],
    [{ id: 'p', decisions: [{ name: 'd', on: 'GRA-20', title: 'T', decider: 'dan@example.com', due: '2026-13-01' }] }, /: decisions\[0\]\.due: /],
    [{ id: 'p', decisions: [{ name: 'd', on: 'GRA-20', title: 'T' }] }, /: decisions\[0\]: missing field `decider`$/],
    // a blocking word under links wins over whatever else stops the parse
    [{ id: 'p', stories: [{ title: 'S' }], links: [{ from: 'GRA-31', type: 'depends_on', to: 'GRA-32' }] }, /: blocking is not an item link: list it under `blocks`/],
  ]) {
    const r = applyIn(log, plan);
    assert.deepEqual([r.status, r.outcome, r.code], [1, 'error', 'internal'], JSON.stringify(plan));
    assert.match(r.message, message, JSON.stringify(plan));
  }
  assert.equal(fs.existsSync(log), false, 'none of them was sent');
  // Where a string goes, YAML reads a number, a boolean and (in a required field or a list) a null as its text, and
  // the real CLI sends that text: `title: 42` is the title "42". An optional field that is null is left out.
  const read = applyIn(log, { id: 7, stories: [{ name: 's', title: 42, criteria: [1, true, null], labels: [2], description: null, epic: null, kind: null }], web_links: [{ on: 's', title: 42, url: 'https://example.com/n' }] });
  assert.equal(read.status, 0, read.message);
  assert.deepEqual(read.value.web_links.map((w) => w.title), ['42']);
  const made = JSON.parse(runIn(log, ['story', 'show', read.value.items[0].key, '--json']).stdout).value;
  assert.deepEqual([made.title, made.kind, made.epic, made.description, made.labels, made.criteria.map((c) => c.text)], ['42', 'story', null, '', ['2'], ['1', 'true', 'null']]);
  assert.match(fs.readFileSync(log, 'utf8'), /^apply - --json \{"id":"7",.*"title":"42"/m, 'the log holds the plan as it was sent');
  // a number keeps its spelling, as serde_yaml reads the scalar's text: `1e3` is "1e3", a long integer keeps its digits
  const spelled = applyIn(log, '{"id": 1e3, "stories": [{"name": "n", "title": 1.50, "criteria": [12345678901234567890, -0]}]}');
  assert.equal(spelled.status, 0, spelled.message);
  const n = JSON.parse(runIn(log, ['story', 'show', spelled.value.items[0].key, '--json']).stdout).value;
  assert.deepEqual([n.title, n.criteria.map((c) => c.text)], ['1.50', ['12345678901234567890', '-0']]);
  assert.match(fs.readFileSync(log, 'utf8'), /^apply - --json \{"id":"1e3",/m);
  // a web link's title that is not text is no title: the planner's rule, not a crash
  const untitled = applyIn(log, { id: 'q', web_links: [{ on: 'GRA-31', title: '', url: 'https://example.com/' }] });
  assert.deepEqual([untitled.code, untitled.message], ['validation', "web link \"\" on \"GRA-31\": a web link's title must be 1 to 200 characters on one line, with no tab or other control character"]);
});
test('a plan name is the item an earlier apply of the plan made: no item link to itself and no second title under another spelling', () => {
  const log = freshLog();
  const plan = { id: 'refining-epic:GRA-20:0a1b2c3d:1', stories: [{ name: 's', title: 'S', criteria: ['a'] }, { name: 't', title: 'T', criteria: ['b'] }], web_links: [{ on: 's', title: 'Page', url: 'https://example.com/page' }] };
  const first = applyIn(log, plan);
  assert.equal(first.status, 0, first.message);
  const [s, t] = first.value.items.map((i) => i.key);
  // before the first apply `s` had no key, so `s` and a key were two items; now they are one
  const self = applyIn(log, { ...plan, links: [{ from: 's', type: 'follows', to: s }, { from: t, type: 'relates_to', to: 't' }, { from: 's', type: 'follows', to: 't' }] });
  assert.deepEqual([self.status, self.code], [1, 'validation']);
  assert.equal(self.message, `item link "s" follows "${s}": an item cannot have an item link to itself; item link "${t}" relates_to "t": an item cannot have an item link to itself`);
  assert.deepEqual(JSON.parse(runIn(log, ['link', 'ls', s, '--json']).stdout).value.links, [], 'nothing was written');
  // the URL the name got in the first apply cannot get another title under the item's key, nor the key's under the name
  const retitled = applyIn(log, { ...plan, web_links: [{ on: s, title: 'Other', url: 'https://example.com/page' }] });
  assert.equal(retitled.message, `web link "Other" on "${s}": this item already has a web link to that URL, titled "Page": remove it first, then add it with the new title`);
  const twice = applyIn(log, { ...plan, web_links: [{ on: 't', title: 'One', url: 'https://example.com/t' }, { on: t, title: 'Two', url: 'https://example.com/t' }] });
  assert.equal(twice.message, `web link "Two" on "${t}": the plan gives "${t}" that URL under two titles ("One" and "Two"); an item has a URL once`);
  // in a plan not applied yet a name and a key are two items: the same entries pass the check
  const fresh = applyIn(freshLog(), { id: 'other', stories: [{ name: 't', title: 'T' }], web_links: [{ on: 't', title: 'One', url: 'https://example.com/t' }, { on: 'GRA-31', title: 'Two', url: 'https://example.com/t' }] });
  assert.equal(fresh.status, 0, fresh.message);
  // a name keeps its level across applies of one plan id
  const moved = applyIn(log, { id: plan.id, epics: [{ name: 's', title: 'S' }] });
  assert.equal(moved.message, `"s" was a story (${s}) in an earlier apply of this plan; a name keeps its level`);
  // the finished plan applied again is unchanged by all of that
  assert.deepEqual(applyIn(log, plan).value.web_links, [{ ...first.value.web_links[0], created: false }]);
});
test('a plan story takes a migrated ticket\'s delivery state: only with an external_ref, never done', () => {
  const log = freshLog();
  const bad = applyIn(log, { id: 'p', stories: [{ name: 'a', title: 'A', delivery: 'in_progress' }, { name: 'b', title: 'B', delivery: 'done', external_ref: 'PIB-31' }, { name: 'c', title: 'C', delivery: 'todo' }] });
  assert.deepEqual([bad.status, bad.code], [1, 'validation']);
  assert.equal(bad.message, 'story "a": a delivery state requires an external_ref; only migrated work skips the gate; '
    + "story \"b\": delivery done is the importer's (it needs a resolution); a plan takes todo, in_progress, in_review or testing; "
    + 'story "c": a delivery state requires an external_ref; only migrated work skips the gate');
  const ok = applyIn(log, { id: 'p', stories: [{ name: 'a', title: 'A', delivery: 'in_review', external_ref: 'PIB-30' }, { name: 'b', title: 'B', external_ref: 'PIB-31' }, { name: 'c', title: 'C' }] });
  assert.equal(ok.status, 0, ok.message);
  const shown = ok.value.items.map((i) => JSON.parse(runIn(log, ['story', 'show', i.key, '--json']).stdout).value);
  assert.deepEqual(shown.map((x) => [x.delivery, x.external_ref, x.resolution]), [['in_review', 'PIB-30', null], ['todo', 'PIB-31', null], ['todo', null, null]]);
});
test('a plan names an existing item by key or external reference, in the scope of the place: one level, or any level with keys first', () => {
  // PRM-1 is the external reference of epic GRA-22: every place that can take an epic finds it
  const log = freshLog();
  const byRef = applyIn(log, {
    id: 'p',
    stories: [{ name: 's', title: 'S', epic: 'PRM-1' }],
    decisions: [{ name: 'd', on: 'PRM-1', title: 'T', decider: 'dan@example.com' }],
    links: [{ from: 's', type: 'relates_to', to: 'PRM-1' }, { from: 'PRM-1', type: 'follows', to: 'GRA-20' }],
    web_links: [{ on: 'PRM-1', title: 'Feedback page', url: 'https://example.com/feedback' }],
  });
  assert.equal(byRef.status, 0, byRef.message);
  const s = byRef.value.items[0].key;
  assert.equal(JSON.parse(runIn(log, ['story', 'show', s, '--json']).stdout).value.epic, 'GRA-22');
  assert.deepEqual(JSON.parse(runIn(log, ['decision', 'show', String(byRef.value.decisions[0].id), '--json']).stdout).value.on, 'GRA-22');
  assert.deepEqual(byRef.value.links, [
    // a relates_to is stored lower key first in byte order, so GRA-100 comes before GRA-22
    { from: s, from_level: 'story', type: 'relates_to', to: 'GRA-22', to_level: 'epic', created: true },
    { from: 'GRA-22', from_level: 'epic', type: 'follows', to: 'GRA-20', to_level: 'epic', created: true }]);
  assert.deepEqual(byRef.value.web_links.map((w) => [w.on, w.level]), [['GRA-22', 'epic']]);
  // a place that takes one level looks among that level only: PRM-1 is no story and no initiative
  const typed = applyIn(log, { id: 'q', epics: [{ name: 'e', title: 'E', initiative: 'PRM-1' }], stories: [{ name: 'x', title: 'X' }], blocks: [{ story: 'x', blocked_by: 'PRM-1' }] });
  assert.equal(typed.message, 'epic "e": initiative "PRM-1" is neither a name in the plan nor an existing initiative; block "x" by "PRM-1": story "PRM-1" is neither a name in the plan nor an existing story');
  // one item under its key and its external reference is one item
  const one = applyIn(log, { id: 'r', links: [{ from: 'GRA-22', type: 'duplicates', to: 'PRM-1' }], web_links: [{ on: 'GRA-22', title: 'Other', url: 'https://example.com/feedback' }] });
  assert.equal(one.message, 'item link "GRA-22" duplicates "PRM-1": an item cannot have an item link to itself; '
    + 'web link "Other" on "GRA-22": this item already has a web link to that URL, titled "Feedback page": remove it first, then add it with the new title');

  // The collision: OLD-1 is the key of an epic (issued under an earlier prefix) and the external reference of story
  // GRA-49. Under `blocks` and where a story stands it is the story; under `epic` and wherever any level is taken
  // (item link ends, a web link's `on`, a decision's `on`, `reeve link`) the key wins and it is the epic.
  const env = { REEVE_FAKE_COLLISION: '1' };
  const both = applyIn(log, {
    id: 's',
    stories: [{ name: 'child', title: 'Child', epic: 'OLD-1', criteria: ['a'] }],
    decisions: [{ name: 'd', on: 'OLD-1', title: 'T', decider: 'dan@example.com' }],
    blocks: [{ story: 'child', blocked_by: 'OLD-1' }],
    links: [{ from: 'child', type: 'follows', to: 'OLD-1' }, { from: 'GRA-49', type: 'relates_to', to: 'OLD-1' }],
    web_links: [{ on: 'OLD-1', title: 'Legacy page', url: 'https://example.com/legacy' }],
  }, env);
  assert.equal(both.status, 0, both.message);
  const child = both.value.items[0].key;
  assert.deepEqual(both.value.blocks, [{ story: child, blocked_by: 'GRA-49', created: true }]);
  assert.deepEqual(both.value.links, [
    { from: child, from_level: 'story', type: 'follows', to: 'OLD-1', to_level: 'epic', created: true },
    // not an item link from GRA-49 to itself: at a link's end OLD-1 is the epic
    { from: 'GRA-49', from_level: 'story', type: 'relates_to', to: 'OLD-1', to_level: 'epic', created: true }]);
  assert.deepEqual(both.value.web_links.map((w) => [w.on, w.level]), [['OLD-1', 'epic']]);
  const show = (args) => JSON.parse(runIn(log, [...args, '--json'], env).stdout).value;
  assert.deepEqual([show(['story', 'show', child]).epic, show(['story', 'show', child]).blocked_by, show(['decision', 'show', String(both.value.decisions[0].id)]).on, show(['decision', 'show', String(both.value.decisions[0].id)]).on_type],
    ['OLD-1', ['GRA-49'], 'OLD-1', 'epic']);
  assert.deepEqual(show(['link', 'ls', 'OLD-1']).links.map((l) => `${l.label} ${l.item.key}`), ['is followed by ' + child, 'relates to GRA-49']);
  assert.deepEqual(show(['link', 'ls', 'GRA-49']).links.map((l) => `${l.label} ${l.item.key} ${l.item.level}`), ['relates to OLD-1 epic']);
  // `reeve link` takes any level too: OLD-1 is the epic there, so the story can relate to it and the epic cannot to itself
  assert.equal(JSON.parse(runIn(log, ['link', 'add', 'OLD-1', 'duplicates', 'OLD-1', '--json'], env).stdout).code, 'validation');
  assert.deepEqual(show(['link', 'add', 'GRA-49', 'follows', 'OLD-1']).map((l) => `${l.type} ${l.item.key} ${l.item.level}`), ['follows OLD-1 epic', 'relates_to OLD-1 epic']);
  // the same plan again: the two scopes answer as they did
  const again = applyIn(log, {
    id: 's',
    stories: [{ name: 'child', title: 'Child', epic: 'OLD-1', criteria: ['a'] }],
    decisions: [{ name: 'd', on: 'OLD-1', title: 'T', decider: 'dan@example.com' }],
    blocks: [{ story: 'child', blocked_by: 'OLD-1' }],
    links: [{ from: 'child', type: 'follows', to: 'OLD-1' }, { from: 'GRA-49', type: 'relates_to', to: 'OLD-1' }],
    web_links: [{ on: 'OLD-1', title: 'Legacy page', url: 'https://example.com/legacy' }],
  }, env);
  assert.deepEqual([again.value.blocks, again.value.links, again.value.web_links.map((w) => [w.on, w.id, w.created])],
    [both.value.blocks.map((x) => ({ ...x, created: false })), both.value.links.map((x) => ({ ...x, created: false })), [['OLD-1', both.value.web_links[0].id, false]]]);
});
test('removing an item link or a web link takes exactly that one: the others stay, and so does the other item\'s side', () => {
  const call = linkSession();
  for (const args of [['GRA-31', 'relates-to', 'GRA-12'], ['GRA-31', 'relates-to', 'GRA-20'], ['GRA-31', 'follows', 'GRA-32'], ['GRA-32', 'follows', 'GRA-31']]) call(['link', 'add', ...args, '--json']);
  for (const [url, title] of [['https://example.com/one', 'One'], ['https://example.com/two', 'Two'], ['https://example.com/three', 'Three']]) call(['link', 'add', 'GRA-31', '--url', url, '--title', title, '--json']);
  const left = call(['link', 'rm', 'GRA-31', 'relates-to', 'GRA-20', '--json']).envelope.value;
  assert.deepEqual(left.map((l) => `${l.type} ${l.direction} ${l.item.key}`), ['follows out GRA-32', 'follows in GRA-32', 'relates_to out GRA-12']);
  assert.deepEqual(call(['link', 'ls', 'GRA-20', '--json']).envelope.value.links, [], 'gone from the other item too');
  // of two opposite item links between the same items, the one named goes and the other stays
  assert.deepEqual(call(['link', 'rm', 'GRA-32', 'follows', 'GRA-31', '--json']).envelope.value.map((l) => `${l.type} ${l.direction} ${l.item.key}`), ['follows in GRA-31']);
  assert.deepEqual(call(['link', 'ls', 'GRA-31', '--json']).envelope.value.links.map((l) => `${l.type} ${l.direction} ${l.item.key}`), ['follows out GRA-32', 'relates_to out GRA-12']);
  assert.deepEqual(call(['link', 'rm', 'GRA-31', '--url', 'https://example.com/two', '--json']).envelope.value, [{ id: 1, title: 'One', url: 'https://example.com/one' }, { id: 3, title: 'Three', url: 'https://example.com/three' }]);
  assert.deepEqual(call(['link', 'ls', 'GRA-31', '--json']).envelope.value.web_links.map((w) => w.id), [1, 3]);
});

// Brief templates (reeve-planner 0.9.0). The fake is a member's token unless REEVE_FAKE_ROLE=admin.
const ADMIN = { REEVE_FAKE_ROLE: 'admin' };
const templateArgs = (level, name, body) => ['template', 'create', '--level', level, '--name', name, '--body', body, '--json'];
const createArgs = (item, n, ...extra) => [item, 'create', '--title', `Item ${n}`, ...(item === 'initiative' ? ['--horizon', 'Now'] : []), ...extra, '--idempotency-key', `planning-initiative:GRA-12:0a1b2c3d:${n}`, '--json'];
test('every member reads brief templates; only an admin writes them, and a member is answered forbidden, exit 2', () => {
  const log = freshLog();
  assert.deepEqual(runIn(log, ['template', 'ls', '--json']).envelope, { outcome: 'ok', value: [] });
  assert.equal(runIn(log, ['auth', 'status', '--json']).envelope.value.role, 'member');
  assert.equal(runIn(log, ['auth', 'status', '--json'], ADMIN).envelope.value.role, 'admin');
  const made = runIn(log, templateArgs('initiative', ' Scenario ', '## Vision'), ADMIN);
  assert.deepEqual([made.status, made.envelope.value], [0, { id: 1, level: 'initiative', name: 'Scenario', body: '## Vision', is_default: false, version: 1 }]);
  for (const args of [templateArgs('epic', 'Outline', 'b'), ['template', 'edit', '1', '--version', '1', '--name', 'Mine', '--json'], ['template', 'rm', '1', '--json'],
    ['template', 'default', '1', '--json'], ['template', 'default', '1', '--clear', '--json']]) {
    const r = runIn(log, args);
    assert.deepEqual([r.status, r.envelope], [2, { outcome: 'error', code: 'forbidden', message: 'forbidden' }], args.join(' '));
  }
  // nothing a member tried was written, and a member still reads
  assert.deepEqual(runIn(log, ['template', 'ls', '--json']).envelope.value, [made.envelope.value]);
  assert.deepEqual(runIn(log, ['template', 'show', '1', '--json']).envelope.value, made.envelope.value);
  const none = runIn(log, ['template', 'show', '9', '--json']);
  assert.deepEqual([none.status, none.envelope.code, none.envelope.message], [1, 'not_found', 'not found']);
});
test('template create is idempotent by content; a name is one per level whatever its case, and the list is initiative first, then by name', () => {
  const log = freshLog();
  const call = (args, input) => runIn(log, args, ADMIN, input);
  const first = call(templateArgs('initiative', 'Scenario', 'body')).envelope.value;
  assert.deepEqual(call(templateArgs('initiative', ' scenario ', 'body')).envelope.value, first, 'the same content again answers the stored template');
  const taken = call(templateArgs('initiative', 'SCENARIO', 'another body'));
  assert.deepEqual([taken.status, taken.envelope.code, taken.envelope.message], [1, 'validation', 'the initiative brief template #1 is already named "Scenario": edit that one, or choose another name']);
  assert.equal(call(templateArgs('epic', 'Scenario', 'epic body')).envelope.value.id, 2, 'the same name at the other level is another template');
  assert.equal(call(templateArgs('initiative', 'Bet', 'b')).envelope.value.id, 3);
  assert.deepEqual(call(['template', 'ls', '--json']).envelope.value.map((t) => `${t.level} ${t.name}`), ['initiative Bet', 'initiative Scenario', 'epic Scenario']);
  assert.deepEqual(call(['template', 'ls', '--level', 'epic', '--json']).envelope.value.map((t) => t.id), [2]);
  for (const [name, body, message] of [['', 'b', "a brief template's name must be 1 to 100 characters on one line"], ['a'.repeat(101), 'b', "a brief template's name must be 1 to 100 characters on one line"],
    ['two\nlines', 'b', "a brief template's name must be 1 to 100 characters on one line"], ['Blank', '  ', "a brief template's text must not be blank"]]) {
    const r = call(templateArgs('epic', name, body));
    assert.deepEqual([r.status, r.envelope.code, r.envelope.message], [1, 'validation', message], JSON.stringify(name));
  }
  // the body through a file, unchanged; `-` reads standard input
  assert.equal(call(['template', 'create', '--level', 'epic', '--name', 'Piped', '--body-file', '-', '--json'], "## Why\n\n- it's piped\n").envelope.value.body, "## Why\n\n- it's piped\n");
});
test('what clap refuses of a template command is a usage error: a level, an id, a missing body, both bodies', () => {
  for (const [args, text] of [
    [templateArgs('story', 'A', 'b'), /`story` is neither initiative nor epic \(a story has no brief template\)/],
    [['template', 'ls', '--level', 'story', '--json'], /neither initiative nor epic/],
    [['template', 'create', '--level', 'epic', '--name', 'A', '--json'], /--body <BODY>/],
    [['template', 'create', '--level', 'epic', '--name', 'A', '--body', 'b', '--body-file', '-', '--json'], /'--body' cannot be used with '--body-file'/],
    [['template', 'create', '--name', 'A', '--body', 'b', '--json'], /--level/],
    [['template', 'show', 'abc', '--json'], /invalid value 'abc' for '<ID>'/],
    [['template', 'edit', '1', '--name', 'A', '--json'], /--version/],
    [['template', 'rm', '--json'], /positional/],
    [['template', 'default', '1', '--version', '1', '--json'], /unexpected argument '--version'/],
  ]) {
    const r = spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: freshLog(), ...ADMIN } });
    assert.deepEqual([r.status, r.stdout], [1, ''], args.join(' '));
    assert.match(r.stderr, text, args.join(' '));
  }
});
test('template edit goes under the version read and only a change raises it; rm answers empty and a second rm is not_found', () => {
  const log = freshLog();
  const call = (args) => runIn(log, args, ADMIN);
  call(templateArgs('initiative', 'Scenario', 'body'));
  call(templateArgs('initiative', 'Bet', 'body'));
  const renamed = call(['template', 'edit', '1', '--version', '1', '--name', 'User scenario', '--json']);
  assert.deepEqual([renamed.envelope.value.name, renamed.envelope.value.body, renamed.envelope.value.version], ['User scenario', 'body', 2]);
  const stale = call(['template', 'edit', '1', '--version', '1', '--body', 'stale', '--json']);
  assert.deepEqual([stale.status, stale.envelope], [1, { outcome: 'error', code: 'conflict', message: 'version conflict: current is 2', current: 2 }]);
  assert.equal(call(['template', 'edit', '1', '--version', '2', '--json']).envelope.value.version, 2, 'an edit that names nothing changes nothing');
  assert.equal(call(['template', 'edit', '1', '--version', '2', '--name', 'User scenario', '--json']).envelope.value.version, 2, 'nor does the name it has');
  const taken = call(['template', 'edit', '1', '--version', '2', '--name', 'bet', '--json']);
  assert.deepEqual([taken.envelope.code, taken.envelope.message], ['validation', 'the initiative brief template #2 is already named "Bet": edit that one, or choose another name']);
  assert.equal(call(['template', 'edit', '1', '--version', '2', '--body', '  ', '--json']).envelope.message, "a brief template's text must not be blank");
  assert.equal(call(['template', 'edit', '1', '--version', '2', '--name', 'user SCENARIO', '--body', 'new', '--json']).envelope.value.version, 3, 'its own name in another case is a rename');
  assert.equal(call(['template', 'edit', '9', '--version', '1', '--name', 'x', '--json']).envelope.code, 'not_found');
  assert.deepEqual(call(['template', 'rm', '2', '--json']).envelope, { outcome: 'ok', value: {} });
  const gone = call(['template', 'rm', '2', '--json']);
  assert.deepEqual([gone.status, gone.envelope.code], [1, 'not_found']);
  assert.equal(call(templateArgs('initiative', 'Bet', 'body')).envelope.value.id, 3, 'an id is never given twice');
});
test('template default marks one template per level and keeps the version; --clear takes the mark off', () => {
  const log = freshLog();
  const call = (args) => runIn(log, args, ADMIN);
  call(templateArgs('initiative', 'Scenario', 'body'));
  call(templateArgs('initiative', 'Bet', 'body'));
  call(templateArgs('epic', 'Outline', 'body'));
  const defaults = () => call(['template', 'ls', '--json']).envelope.value.filter((t) => t.is_default).map((t) => t.id);
  assert.deepEqual([call(['template', 'default', '1', '--json']).envelope.value.is_default, call(['template', 'default', '1', '--json']).envelope.value.version], [true, 1]);
  call(['template', 'default', '3', '--json']);
  assert.deepEqual(defaults(), [1, 3], 'one per level');
  assert.equal(call(['template', 'default', '2', '--json']).envelope.value.is_default, true);
  assert.deepEqual(defaults(), [2, 3], "the mark moved off the level's previous default");
  assert.equal(call(['template', 'default', '1', '--clear', '--json']).envelope.value.is_default, false, 'clearing a mark that is not there changes nothing');
  assert.deepEqual(defaults(), [2, 3]);
  assert.equal(call(['template', 'default', '2', '--clear', '--json']).envelope.value.is_default, false);
  assert.deepEqual(defaults(), [3]);
  assert.equal(call(['template', 'default', '9', '--json']).envelope.code, 'not_found');
  call(['template', 'rm', '3', '--json']);
  assert.deepEqual(defaults(), [], 'removing the default leaves its level with none');
});
test('a create starts from a template only when it passes no brief: --template names one, --no-template none, else the default', () => {
  const log = freshLog();
  const call = (args, input) => runIn(log, args, ADMIN, input);
  const briefOf = (args, input) => { const r = call(args, input); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stdout}`); return r.envelope.value.brief; };
  assert.equal(briefOf(createArgs('initiative', 1)), '', 'no default marked: empty');
  call(templateArgs('initiative', 'Scenario', '## Scenario\n'));
  call(templateArgs('initiative', 'Bet', '## Bet\n'));
  call(templateArgs('epic', 'Outline', '## Outline\n'));
  assert.equal(briefOf(createArgs('initiative', 2)), '', 'a template that is not the default is not applied');
  call(['template', 'default', '1', '--json']);
  assert.equal(briefOf(createArgs('initiative', 3)), '## Scenario\n', 'the default, asked for by passing nothing');
  assert.equal(briefOf(createArgs('epic', 4)), '', "the epic level has no default: the initiative's is not it");
  assert.equal(briefOf(createArgs('initiative', 5, '--template', ' bet ')), '## Bet\n', 'by name, trimmed and whatever its case');
  assert.equal(briefOf(createArgs('epic', 6, '--template', 'Outline')), '## Outline\n');
  assert.equal(briefOf(createArgs('initiative', 7, '--no-template')), '');
  // a brief flag is the brief, an empty one too
  assert.equal(briefOf(createArgs('initiative', 8, '--brief', '')), '');
  assert.equal(briefOf(createArgs('initiative', 9, '--brief-file', '-'), ''), '');
  assert.equal(briefOf(createArgs('initiative', 10, '--brief', 'Mine')), 'Mine');
  assert.equal(briefOf(createArgs('initiative', 11, '--brief', 'Mine', '--no-template')), 'Mine');
  // a name the level has no template for: a validation error, nothing created
  const unknown = call(createArgs('epic', 12, '--template', 'Scenario'));
  assert.deepEqual([unknown.status, unknown.envelope.code, unknown.envelope.message], [1, 'validation', 'no epic brief template is named "Scenario": `reeve template ls --level epic` lists them']);
  assert.equal(call(['search', 'Item 12', '--json']).envelope.value.length, 0);
  // a retry by its key answers the item it made, though the template is gone; a new create naming it is refused
  call(['template', 'rm', '2', '--json']);
  const retried = call(createArgs('initiative', 5, '--template', ' bet '));
  assert.deepEqual([retried.status, retried.envelope.value.brief], [0, '## Bet\n']);
  assert.equal(call(createArgs('initiative', 13, '--template', 'Bet')).envelope.code, 'validation');
  // a brief already made does not change with its template
  const made = call(createArgs('initiative', 3)).envelope.value.key;
  call(['template', 'edit', '1', '--version', '1', '--body', 'changed', '--json']);
  assert.equal(call(['initiative', 'show', made, '--json']).envelope.value.brief, '## Scenario\n');
  // a member's create starts from the default too: reading a template needs no admin
  assert.equal(runIn(log, createArgs('initiative', 14)).envelope.value.brief, 'changed');
});
test("a key is its level's: an epic create under a key an initiative used is no replay, so a missing template refuses it", () => {
  const log = freshLog();
  const call = (args) => runIn(log, args, ADMIN);
  call(templateArgs('epic', 'Outline', '## Outline\n'));
  const initiative = call(createArgs('initiative', 1)).envelope.value;
  const refused = call(createArgs('epic', 1, '--template', 'Missing'));
  assert.deepEqual([refused.status, refused.envelope.code, refused.envelope.message], [1, 'validation', 'no epic brief template is named "Missing": `reeve template ls --level epic` lists them']);
  const epic = call(createArgs('epic', 1, '--template', 'Outline')).envelope.value;
  assert.notEqual(epic.key, initiative.key, 'the same key at another level makes another item');
  assert.equal(epic.brief, '## Outline\n');
  assert.equal(call(['initiative', 'show', initiative.key, '--json']).envelope.value.brief, '', 'the initiative is as it was made');
  // once the epic level has used the key, a retry naming a template gone since answers the epic it made
  call(['template', 'rm', '1', '--json']);
  assert.equal(call(createArgs('epic', 1, '--template', 'Outline')).envelope.value.key, epic.key);
  const story = runIn(log, ['story', 'create', '--title', 'S', '--idempotency-key', 'planning-initiative:GRA-12:0a1b2c3d:1', '--json']).envelope.value;
  assert.ok(![initiative.key, epic.key].includes(story.key), 'a story under the key is a third item');
});
test('a brief with --template, and --template with --no-template, are usage errors; a plan applies no template', () => {
  const log = freshLog();
  for (const [extra, text] of [[['--brief', 'Mine', '--template', 'Scenario'], /'--brief' cannot be used with '--template'/], [['--brief', '', '--template', 'Scenario'], /'--brief' cannot be used with '--template'/],
    [['--brief-file', '-', '--template', 'Scenario'], /'--brief-file' cannot be used with '--template'/], [['--template', 'Scenario', '--no-template'], /'--template' cannot be used with '--no-template'/]]) {
    for (const item of ['initiative', 'epic']) {
      const r = spawnSync(fake, createArgs(item, 1, ...extra), { encoding: 'utf8', input: '', env: { ...process.env, REEVE_FAKE_LOG: log } });
      assert.deepEqual([r.status, r.stdout], [1, ''], `${item} ${extra.join(' ')}`);
      assert.match(r.stderr, text);
    }
  }
  assert.equal(fs.existsSync(log), false, 'none of them reached the planner');
  runIn(log, templateArgs('epic', 'Outline', '## Outline\n'), ADMIN);
  runIn(log, ['template', 'default', '1', '--json'], ADMIN);
  const applied = applyIn(log, { id: 'refining-epic:GRA-20:0a1b2c3d:1', epics: [{ name: 'plain', title: 'Plan epic' }] });
  assert.equal(runIn(log, ['epic', 'show', applied.value.items[0].key, '--json']).envelope.value.brief, '');
});
