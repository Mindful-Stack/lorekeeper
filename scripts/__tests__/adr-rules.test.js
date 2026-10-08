'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkHome } = require('../adr/rules');
const { loadRecord } = require('../adr/records');
const { makeRecord } = require('./helpers/adr-fixtures');

const SHARED = { kind: 'shared', prefix: 'kb', coinciding: false };
const LOCAL = { kind: 'local', prefix: 'api', repo: 'api', coinciding: false };

function rec(opts = {}) {
    const number = opts.number || '0001';
    const slug = opts.slug || 'session-storage';
    return loadRecord(`/h/${number}-${slug}.md`, makeRecord(opts));
}

function run(records, extra = {}) {
    return checkHome({
        home: SHARED,
        records,
        strays: [],
        config: { decisionOwners: [], deciders: [] },
        strict: false,
        resolveRef: () => ({ state: 'found', fm: {} }),
        base: base({}),
        ...extra,
    });
}

function base(map, opts = {}) {
    return {
        textAt: (name) => (name in map ? map[name] : null),
        baseNames: Object.keys(map),
        tipNumbers: opts.tipNumbers || new Map(Object.keys(map).map((n) => [n.slice(0, 4), n])),
        changedFiles: opts.changedFiles || [],
    };
}

const errors = (vs) => vs.filter((v) => v.level === 'error');
// Findings match on rule, message and level: a rule that fires at the wrong level is a bug.
const has = (vs, rule, re, level = 'error') => vs.some((v) => v.rule === rule && v.level === level && re.test(v.message));

test('fixture anchor: the default record passes in both homes, with and without a base', () => {
    assert.deepEqual(run([rec()]), []);
    assert.deepEqual(run([rec({ prefix: 'api' })], { home: LOCAL }), []);
    assert.deepEqual(run([rec()], { base: null }), []);
});

test('schema: missing title and a bad enum are errors', () => {
    const vs = run([rec({ fm: { title: undefined, reversibility: 'sideways' } })]);
    assert.ok(has(vs, 'schema', /title is required/));
    assert.ok(has(vs, 'schema', /reversibility must be one of/));
});

test('schema: an unknown key is a warning, not an error', () => {
    const vs = run([rec({ fm: { decidedby: ['x'] } })]);
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'schema', /unknown key decidedby/, 'warning'));
});

test('id must match the home prefix and the filename number', () => {
    assert.ok(has(run([rec({ fm: { id: 'api/ADR-0001' } })]), 'id', /must be kb\/ADR-0001/));
    assert.ok(has(run([rec({ number: '0002', fm: { id: 'kb/ADR-0001' } })]), 'id', /must be kb\/ADR-0002/));
});

test('home: a service record in the shared home is an error, skipped when homes coincide', () => {
    const r = rec({ fm: { blast_radius: 'service', scope: ['api:src/**'] } });
    assert.ok(has(run([r]), 'home', /belongs in the local home/));
    const one = { kind: 'local', prefix: 'api', repo: 'api', coinciding: true };
    const local = rec({ prefix: 'api', fm: { blast_radius: 'cross-service' } });
    assert.ok(!run([local], { home: one }).some((v) => v.rule === 'home'));
});

test('scope syntax depends on the home', () => {
    assert.ok(has(run([rec({ fm: { scope: ['src/**'] } })]), 'scope', /<repo>:<glob>/));
    assert.ok(has(run([rec({ prefix: 'api', fm: { scope: ['api:src/**'] } })], { home: LOCAL }), 'scope', /relative to the repo root/));
});

test('high tier needs a trigger, two options and a scope; low tier does not', () => {
    const thin = {
        sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.', 'Considered options': '- **Only one**' },
        fm: { scope: [] },
    };
    const vs = run([rec(thin)]);
    assert.ok(has(vs, 'high-tier', /invalidation trigger/));
    assert.ok(has(vs, 'high-tier', /two considered options/));
    assert.ok(has(vs, 'high-tier', /non-empty scope/));
    const low = rec({ prefix: 'api', ...thin, fm: { ...thin.fm, reversibility: 'two-way' } });
    assert.ok(!run([low], { home: LOCAL }).some((v) => v.rule === 'high-tier'));
});

test('accepted needs decided_by; legacy deciders counts', () => {
    assert.ok(has(run([rec({ fm: { decided_by: [] } })]), 'decided-by', /requires a named human/));
    assert.deepEqual(run([rec({ fm: { decided_by: undefined, deciders: ['Alex Doe'] } })]), []);
});

test('owner rule: high tier needs a decisionOwner, low tier a decider', () => {
    const config = { decisionOwners: ['@arch-team'], deciders: ['Sam Roe'] };
    assert.ok(has(run([rec()], { config }), 'decided-by', /decisionOwners/));
    assert.deepEqual(run([rec({ fm: { decided_by: ['Arch-Team'] } })], { config }), []);
    const low = rec({ prefix: 'api', fm: { reversibility: 'two-way' } });
    assert.ok(has(run([low], { home: LOCAL, config }), 'decided-by', /deciders/));
});

const LEGACY_FM = { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined };

test('grandfathered: missing new fields warn, and fail under --strict', () => {
    const legacy = rec({ fm: LEGACY_FM });
    const b = base({ '0001-session-storage.md': legacy.text });
    const vs = run([legacy], { base: b });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'schema', /reversibility is required/, 'warning'));
    assert.ok(has(run([legacy], { base: b, strict: true }), 'schema', /reversibility is required/));
});

test('grandfathered: a legacy proposal on the default branch is not an error until it moves', () => {
    const draft = rec({ status: 'proposed', fm: { ...LEGACY_FM, scope: undefined } });
    const b = base({ '0001-session-storage.md': draft.text });
    assert.deepEqual(errors(run([draft], { base: b })), []);
    assert.ok(has(run([draft], { base: b }), 'proposed-shared', /merges only/, 'warning'));
    const accepting = rec({ fm: LEGACY_FM });
    assert.ok(has(run([accepting], { base: b }), 'schema', /reversibility is required/));
});

test('a record new in this change and missing fields is an error', () => {
    assert.ok(has(run([rec({ fm: { reversibility: undefined } })]), 'schema', /reversibility is required/));
});

test('without a base, unfixable findings on a locked record are warnings', () => {
    const vs = run([rec({ fm: { tags: ['sessions'] } })], { base: null });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'schema', /includes adr/, 'warning'));
    assert.ok(has(run([rec({ status: 'proposed', fm: { tags: ['sessions'] } })], { base: null }), 'schema', /includes adr/));
});

test('locked on the base: classifying a legacy record leaves the home green afterwards', () => {
    const thin = {
        sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.', 'Considered options': '- **Only one**' },
        fm: { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] },
    };
    const classified = rec({ ...thin, fm: { ...thin.fm, id: 'kb/ADR-0001', reversibility: 'one-way', blast_radius: 'cross-service', sensitivity: [], scope: [] } });
    const config = { decisionOwners: ['@arch-team'], deciders: [] };
    const vs = run([classified], { config, base: base({ '0001-session-storage.md': classified.text }) });
    assert.deepEqual(errors(vs), []);
});

test('relations: an unknown same-home id is an error; another home unavailable is a warning', () => {
    assert.ok(has(run([rec({ fm: { related: ['kb/ADR-0009'] } })]), 'relations', /does not exist in this home/));
    const vs = run([rec({ fm: { related: ['api/ADR-0001'] } })], { resolveRef: () => ({ state: 'unavailable' }) });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'relations', /not on disk/, 'warning'));
    assert.ok(has(run([rec({ fm: { related: ['api/ADR-0001'] } })], { resolveRef: () => ({ state: 'missing' }) }), 'relations', /does not exist$/));
});

test('relations: related needs no reverse link', () => {
    const a = rec();
    const b = rec({ number: '0002', slug: 'other', fm: { related: ['kb/ADR-0001'], depends_on: ['kb/ADR-0001'] } });
    assert.deepEqual(run([a, b]), []);
});

test('supersession: an accepted successor requires the predecessor flipped', () => {
    const pred = rec();
    const succ = rec({ number: '0002', slug: 'other', fm: { supersedes: ['kb/ADR-0001'] } });
    assert.ok(has(run([pred, succ]), 'relations', /must be flipped to superseded_by kb\/ADR-0002/));
    const flipped = rec({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' } });
    assert.deepEqual(run([flipped, succ]), []);
});

test('supersession: a proposed successor leaves the predecessor accepted', () => {
    const pred = rec();
    const succ = rec({ number: '0002', slug: 'other', status: 'proposed', fm: { supersedes: ['kb/ADR-0001'] } });
    assert.ok(!run([pred, succ]).some((v) => v.rule === 'relations'));
});

test('supersession: superseded_by must be mirrored by supersedes, and cycles fail', () => {
    const a = rec({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' } });
    const b = rec({ number: '0002', slug: 'other', fm: { status: 'superseded', superseded_by: 'kb/ADR-0001', supersedes: ['kb/ADR-0001'] } });
    const vs = run([a, b]);
    assert.ok(has(vs, 'cycle', /supersession cycle/));
    assert.ok(has(vs, 'relations', /does not list kb\/ADR-0002 in supersedes/));
});

test('proposed in the shared home: warning locally, error when the change adds or edits it', () => {
    const p = rec({ status: 'proposed' });
    assert.ok(has(run([p], { base: null }), 'proposed-shared', /merges only/, 'warning'));
    assert.ok(has(run([p]), 'proposed-shared', /merges only/));
    const edited = base({ '0001-session-storage.md': makeRecord({ status: 'proposed', sections: { Context: 'Old.' } }) });
    assert.ok(has(run([p], { base: edited }), 'proposed-shared', /merges only/));
});

test('move: a stub must point at another home whose record lists the old id in aliases', () => {
    const stubText = makeRecord({ fm: { moved_to: 'api/ADR-0004' } });
    const stub = loadRecord('/h/0001-session-storage.md', stubText);
    const listed = () => ({ state: 'found', fm: { aliases: ['kb/ADR-0001'] } });
    assert.deepEqual(errors(run([stub], { resolveRef: listed })), []);
    assert.ok(has(run([stub], { resolveRef: () => ({ state: 'found', fm: { aliases: [] } }) }), 'move', /list kb\/ADR-0001 in its aliases/));
    const sameHome = loadRecord('/h/0001-session-storage.md', makeRecord({ fm: { moved_to: 'kb/ADR-0002' } }));
    assert.ok(has(run([sameHome, rec({ number: '0002', slug: 'other' })]), 'move', /goes to the other home/));
});

test('base: editing a locked record fails; editing a proposed one does not', () => {
    const before = makeRecord();
    const after = rec({ sections: { Context: 'Rewritten.' } });
    assert.ok(has(run([after], { base: base({ '0001-session-storage.md': before }) }), 'locked', /Context" changed/));
    const draft = makeRecord({ status: 'proposed' });
    const redrafted = rec({ status: 'proposed', sections: { Context: 'Rewritten.' } });
    assert.ok(!run([redrafted], { base: base({ '0001-session-storage.md': draft }) }).some((v) => v.rule === 'locked'));
});

test('base: deleting a locked record fails', () => {
    const vs = run([], { base: base({ '0001-session-storage.md': makeRecord() }) });
    assert.ok(has(vs, 'locked', /never deleted/));
});

test('base: a number taken on the base tip under another name fails', () => {
    const tip = new Map([['0002', '0002-someone-else.md']]);
    const mine = rec({ number: '0002', slug: 'mine' });
    assert.ok(has(run([mine], { base: base({}, { tipNumbers: tip }) }), 'number', /already 0002-someone-else.md/));
});

test('ride-along: a new proposed local record whose scope the change touches fails', () => {
    const proposed = rec({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way' } });
    const b = base({}, { changedFiles: ['src/Sessions/Store.cs', 'docs/adr/0001-session-storage.md'] });
    assert.ok(has(run([proposed], { home: LOCAL, base: b }), 'ride-along', /src\/Sessions\/Store.cs/));
    const untouched = base({}, { changedFiles: ['README.md'] });
    assert.ok(!run([proposed], { home: LOCAL, base: untouched }).some((v) => v.rule === 'ride-along'));
    const accepted = rec({ prefix: 'api', fm: { reversibility: 'two-way' } });
    assert.ok(!run([accepted], { home: LOCAL, base: b }).some((v) => v.rule === 'ride-along'));
});

test('strays and duplicate numbers are reported', () => {
    const vs = run([rec(), rec({ slug: 'dup' })], { strays: ['/h/notes.md'] });
    assert.ok(has(vs, 'filename', /NNNN-<problem-slug>/));
    assert.ok(has(vs, 'number', /also used by/));
});

// C1: freezing covers only what the change leaves alone; values it writes are always checked.
const { backfill } = require('../adr/backfill');
const BACKFILLED = () => backfill(makeRecord({ fm: { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] } }), 'kb/ADR-0001').text;

function classify(text, values) {
    let out = text;
    for (const [k, v] of Object.entries(values)) out = out.replace(new RegExp(`^${k}:.*$`, 'm'), `${k}: ${v}`);
    return out;
}

test('C1: values a change writes on a locked record are checked (enums, scope syntax)', () => {
    const b = base({ '0001-session-storage.md': BACKFILLED() });
    const cur = loadRecord('/h/0001-session-storage.md', classify(BACKFILLED(), { reversibility: 'banana', blast_radius: 'galaxy', scope: '[src/**]' }));
    const vs = run([cur], { base: b });
    assert.ok(has(vs, 'schema', /reversibility must be one of/));
    assert.ok(has(vs, 'schema', /blast_radius must be one of/));
    assert.ok(has(vs, 'scope', /<repo>:<glob>/));
});

test('C1: a backfilled id must equal the implied id', () => {
    const legacy = makeRecord({ fm: { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] } });
    const cur = loadRecord('/h/0001-session-storage.md', backfill(legacy, 'kb/ADR-0007').text);
    assert.ok(has(run([cur], { base: base({ '0001-session-storage.md': legacy }) }), 'id', /must be kb\/ADR-0001/));
});

test('C1: a backfilled blast_radius that belongs in the other home is an error', () => {
    const b = base({ '0001-session-storage.md': BACKFILLED() });
    const cur = loadRecord('/h/0001-session-storage.md', classify(BACKFILLED(), { reversibility: 'two-way', blast_radius: 'service', scope: '[api:src/**]' }));
    assert.ok(has(run([cur], { base: b }), 'home', /belongs in the local home/));
});

test('C1: a correct classification of a locked legacy record is clean', () => {
    const b = base({ '0001-session-storage.md': BACKFILLED() });
    const cur = loadRecord('/h/0001-session-storage.md', classify(BACKFILLED(), { reversibility: 'two-way', blast_radius: 'cross-service', scope: '[api:src/Sessions/**]' }));
    assert.deepEqual(run([cur], { base: b }), []);
});

test('C1: two records with the same explicit id are an error', () => {
    const a = rec();
    const b = rec({ number: '0002', slug: 'other', fm: { id: 'kb/ADR-0001' } });
    assert.ok(has(run([a, b]), 'id', /kb\/ADR-0001 is also used by 0001-session-storage.md/));
});

// I4: a home the change does not touch never fails. Every record below is on the base exactly
// as it is now; any error would block every later change to the home.
test('I4: an identical base and current produce no errors, whatever shape the home is in', () => {
    const legacyFm = { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] };
    const half = BACKFILLED().replace('blast_radius:', 'blast_radius: cross-service');
    const head = makeRecord({ fm: { moved_to: 'api/ADR-0004' } });
    const stubText = `${head.slice(0, head.indexOf('\n---\n') + 5)}Moved to api/ADR-0004.\n`;
    const shapes = {
        'legacy accepted': [makeRecord({ fm: legacyFm })],
        'half-classified': [half],
        'superseded with an asymmetric link': [
            makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' } }),
            makeRecord({ number: '0002' }),
        ],
        'duplicate-number pair': [makeRecord(), makeRecord()],
        'legacy proposal': [makeRecord({ status: 'proposed', fm: LEGACY_FM })],
        'moved stub': [stubText],
    };
    for (const [shape, texts] of Object.entries(shapes)) {
        const map = {};
        const records = texts.map((text, i) => {
            const name = `${parseNumber(text)}-shape-${i}.md`;
            map[name] = text;
            return loadRecord(`/h/${name}`, text);
        });
        const vs = run(records, { base: base(map) });
        assert.deepEqual(errors(vs), [], `${shape}: ${JSON.stringify(errors(vs))}`);
    }
});

function parseNumber(text) {
    return /^title: "?ADR-(\d{4})/m.exec(text)[1];
}
