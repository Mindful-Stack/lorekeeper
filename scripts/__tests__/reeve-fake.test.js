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
  assert.equal(r.stdout, 'reeve-planner 0.1.0-fake\n');
  assert.equal(r.log, '');
});
test('a flag the real CLI lacks is a usage error: no envelope, text on stderr, exit 1', () => {
  const r = run(['epic', 'edit', 'GRA-20', '--brief-file', 'brief.md', '--version', '2', '--json']);
  assert.deepEqual([r.status, r.stdout], [1, '']);
  assert.match(r.stderr, /unexpected argument '--brief-file'/);
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
  assert.deepEqual([mv.status, mv.envelope.value.delivery, mv.log], [0, 'in-progress', 'story mv GRA-31 in-progress --json\n']);
});
test('story ls --untriaged lists stories of kind story with no epic, as the real planner does', () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reeve-fake-')), 'log');
  const call = (args) => JSON.parse(spawnSync(fake, args, { encoding: 'utf8', env: { ...process.env, REEVE_FAKE_LOG: log } }).stdout);
  assert.ok(call(['story', 'ls', '--untriaged', '--json']).value.some((x) => x.story.key === 'GRA-41'));
  call(['story', 'edit', 'GRA-41', '--version', '1', '--kind', 'chore', '--json']);
  assert.ok(!call(['story', 'ls', '--untriaged', '--json']).value.some((x) => x.story.key === 'GRA-41'));
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
