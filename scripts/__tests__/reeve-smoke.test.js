// scripts/__tests__/reeve-smoke.test.js — node --test
// The real-planner smoke's pure parts (helpers/reeve-smoke.js): the Commands table, the fixture's coverage, placeholder
// binding and the shape checks. The smoke itself is reeve-real-server.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = require('./helpers/reeve-smoke');

const ok = (value) => ({ status: 0, stdout: JSON.stringify({ outcome: 'ok', value }) + '\n', stderr: '' });

test('commandRows reads the Commands table only and reads \\| inside a cell as |', () => {
  const md = [
    '## Envelope', '', '| Envelope | Exit |', '|---|---|', '| `{"outcome":"ok"}` | 0 |', '',
    '## Commands', '', '| Command | Read |', '|---|---|',
    '| `reeve a show <KEY> --json` | `value.x` |',
    '| `reeve b create --kind story\\|bug --json` | `value.key` |', '',
    'No command lists the buckets.', '',
    '## decision link', '', '| Result | Say |', '|---|---|', '| exit 0 | "Linked" |',
  ].join('\n');
  assert.deepEqual(s.commandRows(md), [
    { row: '`reeve a show <KEY> --json`', read: '`value.x`' },
    { row: '`reeve b create --kind story|bug --json`', read: '`value.key`' },
  ]);
});
test('commandRows finds the rows of the reference, each with its Read cell', () => {
  const rows = s.commandRows(fs.readFileSync(path.join(__dirname, '..', '..', 'references', 'reeve-cli.md'), 'utf8'));
  assert.equal(rows.length, 22);
  for (const r of rows) {
    assert.match(r.row, /^`reeve [a-z]+( [a-z]+)?[ `]/, r.row);
    assert.match(r.read, /`value/, r.row);
  }
});

test('formsOf: every `reeve …` span is a form, and an "(or `--flag …`)" suffix is the form before it with its first flag replaced', () => {
  assert.deepEqual(s.formsOf('`reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json`').map((f) => f.required), [['--epic', '--json'], ['--untriaged', '--json']]);
  assert.deepEqual(s.formsOf('`reeve comment add --decision <id> --body <text> --json` (or `--story <KEY>`)').map((f) => [f.label, f.required]), [
    ['comment add --decision <id> --body <text> --json', ['--decision', '--body', '--json']],
    ['comment add --story <KEY>', ['--story', '--body', '--json']],
  ]);
  assert.deepEqual(s.formsOf('`reeve epic ls [--initiative <KEY>] --json`')[0].required, ['--json']); // a [optional] flag is not required
  assert.deepEqual(s.formsOf('`reeve search <text> --json`').map((f) => f.words), ['search']); // a one-word command stops at its placeholder
});
test('readPaths: the field paths of a Read cell, with nesting and relative fields kept', () => {
  assert.deepEqual(s.readPaths('`value.brief`, `.owner` (null = not complete), `.version`'), ['value.brief', 'value.owner', 'value.version']);
  assert.deepEqual(s.readPaths('`value[]`: `{story, readiness: {ready, reasons[]}}`; `story.key`, `.title`. Untriaged: kind `story` with no epic'),
    ['value[]', 'value[].story', 'value[].readiness', 'value[].readiness.ready', 'value[].readiness.reasons[]', 'value[].story.key', 'value[].story.title']);
  assert.deepEqual(s.readPaths('`value[]`: `id`, `record` (null = no record), `check.kind`, `closed` (null, or `{at, by}`); closed ones too'),
    ['value[]', 'value[].id', 'value[].record', 'value[].check.kind', 'value[].closed', 'value[].closed.at', 'value[].closed.by']);
  assert.deepEqual(s.readPaths('`value.key`; a bucket the planner does not have is a `validation` error'), ['value.key']);
});

const ROW = '`reeve epic ls [--initiative <KEY>] --json`';
const READ = '`value[]`: `key`';
const TWO = '`reeve story ls --epic <KEY> --json` / `reeve story ls --untriaged --json`';
const OR = '`reeve comment add --decision <id> --body <text> --json` (or `--story <KEY>`)';
const r = (row, read = READ) => ({ row, read });
const entry = (o = {}) => ({ row: ROW, argv: ['epic', 'ls', '--initiative', '{{initiative.key}}', '--json'], reads: ['value[].key'], types: { 'value[].key': 'string' }, ...o });
const twoEntry = (alternates) => ({ row: TWO, argv: ['story', 'ls', '--epic', 'X', '--json'], alternates, reads: ['value[].key'], types: { 'value[].key': 'string' } });
const orEntry = (alternates) => ({ row: OR, argv: ['comment', 'add', '--decision', '7', '--body', 'B', '--json'], alternates, reads: ['value[].key'], types: { 'value[].key': 'string' } });
test('coverageProblems: a fixture that covers its rows, forms and reads has none', () => {
  assert.deepEqual(s.coverageProblems([r(ROW)], { seed: [], entries: [entry()] }), []);
  assert.deepEqual(s.coverageProblems([r(TWO), r(OR)], { seed: [], entries: [
    twoEntry([['story', 'ls', '--untriaged', '--json']]),
    orEntry([['comment', 'add', '--story', 'S', '--body', 'B', '--json']]),
  ] }), []);
});
test('coverageProblems names each defect', () => {
  const cases = [
    [[r(ROW), r('`reeve epic show <KEY> --json`')], [entry()], /^0 entries for the row `reeve epic show/],
    [[r(ROW)], [entry(), entry()], /^2 entries for the row `reeve epic ls/],
    [[r(ROW)], [entry(), entry({ row: '`reeve epic gone --json`' })], /names no row of the Commands table: `reeve epic gone/],
    // a missing alternate, a duplicated one, and the "or" form left out
    [[r(TWO)], [twoEntry(undefined)], /no run covers the form story ls --untriaged --json/],
    [[r(TWO)], [twoEntry([['story', 'ls', '--epic', 'Y', '--json']])], /2 runs cover the form story ls --epic <KEY> --json/],
    [[r(TWO)], [twoEntry([['story', 'ls', '--epic', 'Y', '--json']])], /no run covers the form story ls --untriaged --json/],
    [[r(OR)], [orEntry(undefined)], /no run covers the form comment add --story <KEY>/],
    [[r(ROW)], [entry({ argv: ['epic', 'show', 'X', '--json'] })], /run "epic show X --json" matches 0 of the row's forms/],
    [[r(ROW)], [entry({ argv: ['epic', 'ls', '--json', '--initiative', 'X'] })], /run "epic ls --json --initiative X" must end with --json/],
    [[r(ROW)], [entry({ argv: ['epic', 'ls', '--owner', 'X', '--json'] })], /--owner is not in the row/],
    // reads against the reference's Read cell
    [[r(ROW, '`value[]`: `key`, `title`')], [entry()], /the reference's Read names value\[\]\.title, which no read reaches/],
    // a known name under another parent is not covered by that name elsewhere (review round 2)
    [[r(ROW, '`value[]`: `key`, `record.key`')], [entry({ reads: ['value[].key', 'value[].record'], types: { 'value[].key': 'string', 'value[].record': 'object' } })], /names value\[\]\.record\.key, which no read reaches/],
    // "the same fields" inherits the list row's paths, value[] read as value (review round 3)
    [[r('`reeve epic ls --json`', '`value[]`: `key`, `title`'), r('`reeve epic show <KEY> --json`', '`value`: one epic, the same fields')],
      [entry({ row: '`reeve epic ls --json`', argv: ['epic', 'ls', '--json'], reads: ['value[].key', 'value[].title'], types: { 'value[].key': 'string', 'value[].title': 'string' } }),
        entry({ row: '`reeve epic show <KEY> --json`', argv: ['epic', 'show', 'X', '--json'], reads: ['value.key'], types: { 'value.key': 'string' } })],
      /`reeve epic show <KEY> --json`: the reference's Read names value\.title, which no read reaches/],
    [[r(ROW)], [entry({ reads: [], types: {} })], /the entry reads nothing/],
    [[r(ROW)], [entry({ unread: { 'value[].title': 'x' } })], /unread value\[\]\.title is not in the reference's Read/],
    [[r(ROW)], [entry({ unread: { 'value[].key': 'x' } })], /unread value\[\]\.key is read/],
    [[r(ROW, '`value[]`: `key`, `title`')], [entry({ unread: { 'value[].title': '' } })], /unread value\[\]\.title needs a reason/],
    [[r(ROW, '`value[]`: `key`, `title`')], [entry({ unread: { 'value[].title': 5 } })], /unread value\[\]\.title needs a reason/],
    [[r(ROW)], [entry({ types: {} })], /read value\[\]\.key has no declared type/],
    [[r(ROW)], [entry({ types: { 'value[].key': 'string', 'value[].title': 'string' } })], /type for value\[\]\.title, which is not read/],
    [[r(ROW)], [entry({ types: { 'value[].key': 'text' } })], /value\[\]\.key: text is not a JSON type/],
    [[r(ROW)], [entry({ may_be_empty: ['value.items[]'] })], /may_be_empty value\.items\[\] names no array the entry reads/],
    [[r(ROW)], [entry()], /seed step 1 must end with --json/, [{ argv: ['epic', 'create', '--json', '--title', 'T'] }]],
  ];
  for (const [rows, entries, want, seed = []] of cases) {
    const got = s.coverageProblems(rows, { seed, entries });
    assert.ok(got.some((p) => want.test(p)), `${want}: got ${JSON.stringify(got)}`);
  }
});

test('readPaths throws on a span it cannot classify and pins the real reference', () => {
  assert.throws(() => s.readPaths('`value.a`, see `mystery` here'), /cannot classify `mystery`/);
  assert.throws(() => s.readPaths('`.x`'), /no field to follow/);
  assert.deepEqual(s.readPaths('`value[]`, `.x`'), ['value[]', 'value[].x']); // a path without a dot is its own parent
  const rows = s.commandRows(fs.readFileSync(path.join(__dirname, '..', '..', 'references', 'reeve-cli.md'), 'utf8'));
  for (const x of rows) assert.ok(s.readPaths(x.read).every((p) => p.startsWith('value')), x.row);
  const of = (prefix) => s.readPaths(rows.find((x) => x.row.startsWith(prefix)).read);
  assert.deepEqual(of('`reeve story context'), ['value', 'value.story', 'value.epic', 'value.initiative', 'value.required_decisions[]', 'value.blockers[]', 'value.comments[]', 'value.readiness']);
  assert.ok(of('`reeve decision ls').includes('value[].closed.reason'));
  assert.ok(of('`reeve story ls').includes('value[].story.version'));
});
test('"the same fields" needs a value[] list source', () => {
  const rows = [r('`reeve epic ls --json`', '`value`: `key`'), r('`reeve epic show <KEY> --json`', '`value`: one epic, the same fields')];
  assert.throws(() => s.coverageProblems(rows, { seed: [], entries: [] }).concat(s.coverageProblems(rows, { seed: [], entries: [entry({ row: rows[1].row, argv: ['epic', 'show', 'X', '--json'], reads: ['value.key'], types: { 'value.key': 'string' } })] })), /does not read a value\[\] list/);
});

test('bind fills dotted placeholders and refuses unbound or non-scalar ones', () => {
  assert.deepEqual(s.bind(['show', '{{epic.key}}', 'v{{epic.version}}'], { epic: { key: 'SKS-2', version: 3 } }), ['show', 'SKS-2', 'v3']);
  assert.throws(() => s.bind(['{{story.key}}'], {}), /unbound \{\{story\.key\}\}/);
  assert.throws(() => s.bind(['{{epic}}'], { epic: { key: 'SKS-2' } }), /\{\{epic\}\} is an object/);
});

const E = (o = {}) => ({ row: 'r', argv: [], reads: ['value.brief', 'value.items[].key'], types: { 'value.brief': 'string', 'value.items[].key': 'string|null' }, ...o });
test('realProblems: a complete answer has none, a declared union admits both types', () => {
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: [{ key: 'A' }, { key: null }] })), []);
});
test('realProblems names a missing field, an empty array, a type outside the declaration and a wrong expected value', () => {
  assert.deepEqual(s.realProblems(E(), ok({ items: [{ key: 'A' }] })), ["the planner's answer has no value.brief"]);
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: [{}] })), ["the planner's answer has no value.items[0].key"]);
  assert.match(s.realProblems(E(), ok({ brief: 'b', items: [] }))[0], /^the planner's value\.items\[\] is empty/);
  assert.deepEqual(s.realProblems(E({ may_be_empty: ['value.items[]'] }), ok({ brief: 'b', items: [] })), []);
  assert.deepEqual(s.realProblems(E(), ok({ brief: 1, items: [{ key: 'A' }] })), ["the planner's value.brief is number, the fixture declares string"]);
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: {} })), ["the planner's value.items is not an array"]);
  const linked = E({ reads: ['value.check.kind'], types: { 'value.check.kind': 'string' }, expect: { 'value.check.kind': 'accepted' } });
  assert.deepEqual(s.realProblems(linked, ok({ check: { kind: 'unchecked' } })), ['the planner\'s value.check.kind is "unchecked", expected "accepted"']);
  assert.deepEqual(s.realProblems(linked, ok({ check: { kind: 'unchecked' } }), { expect: false }), []);
});
test('realProblems checks every element of an array, not the first', () => {
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: [{ key: 'A' }, {}] })), ["the planner's answer has no value.items[1].key"]);
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: [{ key: 'A' }, { key: 3 }] })), ["the planner's value.items[].key is number, the fixture declares string|null"]);
  assert.deepEqual(s.realProblems(E(), ok({ brief: 'b', items: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, 7] })), ["the planner's answer has no value.items[3].key"]);
});
test('realProblems: null is a type, and a plain declaration refuses it', () => {
  assert.deepEqual(s.realProblems(E(), ok({ brief: null, items: [{ key: 'A' }] })), ["the planner's value.brief is null, the fixture declares string"]);
});
test('realProblems accepts only exit 0 with an ok envelope', () => {
  assert.match(s.realProblems(E(), { status: 1, stdout: '', stderr: "error: unexpected argument '--x'\n" })[0], /^no JSON envelope on stdout \(exit 1\): error: unexpected argument/);
  assert.match(s.realProblems(E(), { status: 2, stdout: '{"outcome":"refused","reasons":[{"reason":"no_criteria"}]}', stderr: '' })[0], /^outcome refused \(exit 2\)/);
  const unreadable = { status: 1, stdout: JSON.stringify({ outcome: 'ok', value: { brief: 'b', items: [{ key: 'A' }] } }), stderr: 'decision 7: cannot read x\n' };
  assert.deepEqual(s.realProblems(E(), unreadable), ['exit 1 with an ok envelope: decision 7: cannot read x']);
});

test('fakeProblems blames the fake for a missing field, a different type set or an empty array', () => {
  const FIX = 'fix test/fixtures/reeve-bin/reeve';
  const e = E({ reads: ['value.owner', 'value.items[]'], types: { 'value.owner': 'string|null', 'value.items[]': 'object' } });
  const real = { outcome: 'ok', value: { owner: null, items: [{ a: 1 }] } };
  assert.deepEqual(s.fakeProblems(e, real, ok({ owner: null, items: [{ b: 2 }] })), []);
  assert.deepEqual(s.fakeProblems(e, real, ok({ items: [{}] })), [`the fake's answer has no value.owner (the planner's has it); ${FIX}`]);
  assert.deepEqual(s.fakeProblems(e, real, ok({ owner: 'dan@example.com', items: [{}] })), [`value.owner is null from the planner but string from the fake; ${FIX}`]);
  assert.deepEqual(s.fakeProblems(e, real, ok({ owner: null, items: [] })), [`value.items[] is object from the planner but (nothing: empty) from the fake; ${FIX}`]);
  // the planner reaches {string,null} across elements; a fake that only ever gives string is a subset, not the same
  const e2 = E({ reads: ['value.items[].key'], types: { 'value.items[].key': 'string|null' } });
  const real2 = { outcome: 'ok', value: { items: [{ key: 'A' }, { key: null }] } };
  assert.deepEqual(s.fakeProblems(e2, real2, ok({ items: [{ key: 'A' }, { key: 'B' }] })), [`value.items[].key is null|string from the planner but string from the fake; ${FIX}`]);
  assert.deepEqual(s.fakeProblems(e2, real2, ok({ items: [{ key: null }, { key: 'B' }] })), []);
  // the planner's array empty, the fake's not (and the reverse)
  assert.deepEqual(s.fakeProblems(e2, { outcome: 'ok', value: { items: [] } }, ok({ items: [{ key: 'A' }] })), [`value.items[].key is (nothing: empty) from the planner but string from the fake; ${FIX}`]);
  assert.deepEqual(s.fakeProblems(e, real, { status: 1, stdout: '', stderr: "error: unexpected argument '--household'\n" }),
    [`the fake answered exit 1 without an envelope: error: unexpected argument '--household'; ${FIX}`]);
});

test('liveConfig skips without REEVE_SMOKE_SEED and lists what else a live run lacks', () => {
  assert.match(s.liveConfig({}).skip, /REEVE_SMOKE_SEED is not set/);
  assert.deepEqual(s.liveConfig({ REEVE_SMOKE_SEED: 'seed.json', REEVE_URL: 'http://127.0.0.1:7476' }), { skip: false, missing: ['REEVE_REAL_BIN', 'REEVE_TOKEN'] });
  assert.deepEqual(s.liveConfig({ REEVE_SMOKE_SEED: 'seed.json', REEVE_REAL_BIN: 'reeve', REEVE_URL: 'u', REEVE_TOKEN: 't' }), { skip: false, missing: [] });
  // the seed alone decides skipping: the CLI's own variables in a developer shell are not a smoke run
  assert.match(s.liveConfig({ REEVE_REAL_BIN: 'reeve', REEVE_URL: 'u', REEVE_TOKEN: 't' }).skip, /REEVE_SMOKE_SEED is not set/);
  assert.match(s.liveConfig({ REEVE_TOKEN: 't', REEVE_SMOKE_SEED: '' }).skip, /REEVE_SMOKE_SEED is not set/);
});
