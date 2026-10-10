'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkHome } = require('../adr/rules');
const { loadRecord } = require('../adr/records');
const { backfill } = require('../adr/backfill');
const { makeRecord, blockYamlLegacy } = require('./helpers/adr-fixtures');

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
        strict: false,
        resolveRef: () => ({ state: 'found', fm: {} }),
        base: base({}),
        ...extra,
    });
}

// `opts.tip` maps names to their text at the base tip (default: the same as the merge base).
function base(map, opts = {}) {
    const tip = opts.tip || map;
    return {
        ref: 'main',
        textAt: (name) => (name in map ? map[name] : null),
        tipTextAt: (name) => (name in tip ? tip[name] : null),
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

test('schema: moved_to and aliases are unknown keys (there is no move)', () => {
    const vs = run([rec({ fm: { moved_to: 'api/ADR-0004', aliases: ['api/ADR-0009'] } })]);
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'schema', /unknown key moved_to/, 'warning'));
    assert.ok(has(vs, 'schema', /unknown key aliases/, 'warning'));
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

test('a rejected high-tier record need not carry the tier extras; the same record proposed does', () => {
    const thin = {
        sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.', 'Considered options': '- **Only one**' },
        fm: { scope: [] },
    };
    const rejected = rec({ ...thin, status: 'rejected', fm: { ...thin.fm, decided_by: ['Alex Doe'] } });
    assert.ok(!run([rejected]).some((v) => v.rule === 'high-tier'));
    const proposed = run([rec({ ...thin, status: 'proposed' })]);
    assert.ok(has(proposed, 'high-tier', /invalidation trigger/));
    assert.ok(has(proposed, 'high-tier', /two considered options/));
    assert.ok(has(proposed, 'high-tier', /non-empty scope/));
});

test('accepted needs decided_by; legacy deciders counts', () => {
    assert.ok(has(run([rec({ fm: { decided_by: [] } })]), 'decided-by', /requires a named human/));
    assert.deepEqual(run([rec({ fm: { decided_by: undefined, deciders: ['Alex Doe'] } })]), []);
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

test('classifying a legacy record checks it in full; the home stays green afterwards', () => {
    const thin = {
        sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.', 'Considered options': '- **Only one**' },
        fm: { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] },
    };
    const backfilled = backfill(makeRecord(thin), 'kb/ADR-0001').text;
    const classifiedText = backfilled
        .replace(/^reversibility:.*$/m, 'reversibility: one-way')
        .replace(/^blast_radius:.*$/m, 'blast_radius: cross-service');
    assert.notEqual(classifiedText, backfilled);
    const name = '0001-session-storage.md';
    // The classifying change itself converts the record, so it must meet the high-tier rules.
    const classified = loadRecord(`/h/${name}`, classifiedText);
    assert.ok(has(run([classified], { base: base({ [name]: backfilled }) }), 'high-tier', /invalidation trigger/));
    const full = classify(backfill(makeRecord({ fm: thin.fm }), 'kb/ADR-0001').text, { reversibility: 'one-way', blast_radius: 'cross-service', scope: '[api:src/Sessions/**]' });
    assert.deepEqual(errors(run([loadRecord(`/h/${name}`, full)], { base: base({ [name]: backfilled }) })), []);
    // A later, unrelated change to the home: base is the classified record, whatever it lacks.
    const later = rec({ number: '0002', slug: 'other', fm: { decided_by: ['arch-team'] } });
    assert.deepEqual(errors(run([classified, later], { base: base({ [name]: classifiedText }) })), []);
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

test('proposed in the shared home: a warning, and under --ci an error when the change adds or edits it', () => {
    const p = rec({ status: 'proposed' });
    assert.ok(has(run([p], { base: null, ci: true }), 'proposed-shared', /merges only/, 'warning'));
    assert.ok(has(run([p]), 'proposed-shared', /merges only/, 'warning'));
    assert.ok(has(run([p], { ci: true }), 'proposed-shared', /merges only/));
    const edited = base({ '0001-session-storage.md': makeRecord({ status: 'proposed', sections: { Context: 'Old.' } }) });
    assert.ok(has(run([p], { base: edited, ci: true }), 'proposed-shared', /merges only/));
});

test('proposed-shared, ride-along and decided-by name the next step', () => {
    const next = ' — record a named human\'s approval: `/lore:adr accept kb/ADR-0001 by <name>` (or tell Claude who approved it)';
    const shared = run([rec({ status: 'proposed' })], { ci: true }).find((v) => v.rule === 'proposed-shared');
    assert.equal(shared.message, `a shared-home record merges only as accepted or rejected${next}`);
    const decided = run([rec({ fm: { decided_by: [] } })]).find((v) => v.rule === 'decided-by');
    assert.equal(decided.message, `accepted requires a named human in decided_by${next}`);
    const proposed = rec({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way' } });
    const b = base({}, { changedFiles: ['src/Sessions/Store.cs'] });
    const ride = run([proposed], { home: LOCAL, base: b }).find((v) => v.rule === 'ride-along');
    assert.ok(ride.message.endsWith(next.replace('kb/', 'api/')), ride.message);
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

test('ride-along: a proposed local record whose scope the change touches fails under --ci', () => {
    const proposed = rec({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way' } });
    const b = base({}, { changedFiles: ['src/Sessions/Store.cs', 'docs/adr/0001-session-storage.md'] });
    assert.ok(has(run([proposed], { home: LOCAL, base: b }), 'ride-along', /src\/Sessions\/Store.cs/, 'warning'));
    assert.ok(has(run([proposed], { home: LOCAL, base: b, ci: true }), 'ride-along', /src\/Sessions\/Store.cs/));
    const untouched = base({}, { changedFiles: ['README.md'] });
    assert.ok(!run([proposed], { home: LOCAL, base: untouched }).some((v) => v.rule === 'ride-along'));
    const accepted = rec({ prefix: 'api', fm: { reversibility: 'two-way' } });
    assert.ok(!run([accepted], { home: LOCAL, base: b }).some((v) => v.rule === 'ride-along'));
});

test('strays and duplicate numbers are reported', () => {
    const vs = run([rec(), rec({ slug: 'dup' })], { strays: ['/h/notes.md'] });
    // A stray is a likely misnamed record: worth a warning, never a blocked merge.
    assert.ok(has(vs, 'filename', /NNNN-<problem-slug>/, 'warning'));
    assert.ok(!has(vs, 'filename', /NNNN-<problem-slug>/));
    assert.ok(has(vs, 'number', /also used by/));
});

// C1: freezing covers only what the change leaves alone; values it writes are always checked.
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

test('C1: a legacy record classified into the other home warns (B4)', () => {
    const b = base({ '0001-session-storage.md': BACKFILLED() });
    const cur = loadRecord('/h/0001-session-storage.md', classify(BACKFILLED(), { reversibility: 'two-way', blast_radius: 'service', scope: '[api:src/**]' }));
    assert.ok(has(run([cur], { base: b }), 'home', /belongs in the local home; leave it here, or supersede it with a record there/, 'warning'));
});

test('C1: a correct classification of a locked legacy record is clean', () => {
    const b = base({ '0001-session-storage.md': BACKFILLED() });
    const cur = loadRecord('/h/0001-session-storage.md', classify(BACKFILLED(), { reversibility: 'two-way', blast_radius: 'cross-service', scope: '[api:src/Sessions/**]' }));
    assert.deepEqual(run([cur], { base: b }), []);
});

test('C1: two records with the same explicit id are an error', () => {
    const a = rec();
    const b = rec({ number: '0002', slug: 'other', fm: { id: 'kb/ADR-0001' } });
    // a is locked and untouched on the base; b is new, so the change caused the clash.
    const locked = base({ '0001-session-storage.md': a.text });
    assert.ok(has(run([a, b], { base: locked }), 'id', /kb\/ADR-0001 is also used by 0001-session-storage.md/));
});

// I4: a home the change does not touch never fails. Every record below is on the base exactly
// as it is now; any error would block every later change to the home.
test('I4: an identical base and current produce no errors, whatever shape the home is in', () => {
    const legacyFm = { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] };
    const half = BACKFILLED().replace('blast_radius:', 'blast_radius: cross-service');
    const shapes = {
        'legacy accepted': [makeRecord({ fm: legacyFm })],
        'half-classified': [half],
        'superseded with an asymmetric link': [
            makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' } }),
            makeRecord({ number: '0002' }),
        ],
        'duplicate-number pair': [makeRecord(), makeRecord()],
        'legacy proposal': [makeRecord({ status: 'proposed', fm: LEGACY_FM })],
        'legacy block YAML': [blockYamlLegacy()],
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

test('I5: a CRLF working copy of a committed proposal is not an edit', () => {
    const committed = makeRecord({ status: 'proposed' });
    const crlf = loadRecord('/h/0001-session-storage.md', committed.replace(/\n/g, '\r\n'));
    const vs = run([crlf], { base: base({ '0001-session-storage.md': committed }) });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'proposed-shared', /merges only/, 'warning'));
});

test('I5: a CRLF working copy of an untouched locked pair still counts as untouched', () => {
    const a = makeRecord();
    const b = base({ '0001-a.md': a, '0001-b.md': a }, { tipNumbers: new Map() });
    const crlf = [loadRecord('/h/0001-a.md', a.replace(/\n/g, '\r\n')), loadRecord('/h/0001-b.md', a.replace(/\n/g, '\r\n'))];
    assert.deepEqual(errors(run(crlf, { base: b })), []);
});

test('fix3-1a: frontmatter parse errors are warnings on a record the change leaves alone', () => {
    const legacy = blockYamlLegacy();
    const b = base({ '0001-session-storage.md': legacy });
    const vs = run([loadRecord('/h/0001-session-storage.md', legacy)], { base: b });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'frontmatter', /block value under "tags"/, 'warning'));
    const edited = loadRecord('/h/0001-session-storage.md', legacy.replace('Cookies cap at 4 KB.', 'Cookies cap at 8 KB.'));
    assert.ok(has(run([edited], { base: b }), 'frontmatter', /block value under "tags"/));
    assert.ok(has(run([loadRecord('/h/0001-session-storage.md', legacy)], { base: base({}) }), 'frontmatter', /block value/));
});

test('fix3-1: rewriting a locked block-YAML record inline leaves the home green', () => {
    const b = base({ '0001-session-storage.md': blockYamlLegacy() });
    assert.deepEqual(errors(run([loadRecord('/h/0001-session-storage.md', blockYamlLegacy({ inline: true }))], { base: b })), []);
});

test('fix3-2: superseded_by requires status superseded, unless the change leaves it as it was', () => {
    const early = rec({ fm: { superseded_by: 'kb/ADR-0002' } });
    const succ = rec({ number: '0002', slug: 'other', fm: { supersedes: ['kb/ADR-0001'] } });
    assert.ok(has(run([early, succ]), 'relations', /superseded_by is set, so status must be superseded/));
    const legacyText = makeRecord({ fm: { superseded_by: 'kb/ADR-0002' } });
    const legacy = loadRecord('/h/0001-session-storage.md', legacyText);
    const succText = makeRecord({ number: '0002', fm: { supersedes: ['kb/ADR-0001'] } });
    const b = base({ '0001-session-storage.md': legacyText, '0002-other.md': succText });
    assert.ok(!run([legacy, loadRecord('/h/0002-other.md', succText)], { base: b }).some((v) => /status must be superseded/.test(v.message)));
});

test('fix3-2: a newly set superseded_by needs an accepted successor', () => {
    const name = '0001-session-storage.md';
    const b = base({ [name]: makeRecord() });
    const flipped = loadRecord(`/h/${name}`, makeRecord({
        fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' },
        sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSuperseded 2026-11-01 by kb/ADR-0002.' },
    }));
    const proposed = rec({ number: '0002', slug: 'other', status: 'proposed', fm: { supersedes: ['kb/ADR-0001'] } });
    assert.ok(has(run([flipped, proposed], { base: b }), 'relations', /successor kb\/ADR-0002 is proposed; it must be accepted/));
    const accepted = rec({ number: '0002', slug: 'other', fm: { supersedes: ['kb/ADR-0001'] } });
    assert.deepEqual(errors(run([flipped, accepted], { base: b })), []);
    // Across homes the successor merged earlier; the resolver reports its status.
    const across = loadRecord(`/h/${name}`, makeRecord({
        fm: { status: 'superseded', superseded_by: 'api/ADR-0002' },
        sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSuperseded 2026-11-01 by api/ADR-0002.' },
    }));
    assert.ok(has(run([across], { base: b, resolveRef: () => ({ state: 'found', fm: { status: 'proposed' } }) }), 'relations', /successor api\/ADR-0002 is proposed/));
    assert.deepEqual(errors(run([across], { base: b, resolveRef: () => ({ state: 'found', fm: { status: 'accepted' } }) })), []);
    const away = run([across], { base: b, resolveRef: () => ({ state: 'unavailable' }) });
    assert.deepEqual(errors(away), []);
    assert.ok(has(away, 'relations', /superseded_by api\/ADR-0002: its home is not on disk/, 'warning'));
});

test('fix3-3: deleting a record a locked record points at is an error', () => {
    const aText = makeRecord({ fm: { related: ['kb/ADR-0002'] } });
    const b = base({ '0001-session-storage.md': aText, '0002-other.md': makeRecord({ number: '0002', status: 'proposed' }) });
    const vs = run([loadRecord('/h/0001-session-storage.md', aText)], { base: b });
    assert.ok(has(vs, 'relations', /related kb\/ADR-0002 does not exist in this home/));
});

test('fix3-3: a frozen reference already broken on the base is a warning', () => {
    const aText = makeRecord({ fm: { related: ['kb/ADR-0009', 'not-an-id'], depends_on: ['web/ADR-0001'] } });
    const b = base({ '0001-session-storage.md': aText });
    const vs = run([loadRecord('/h/0001-session-storage.md', aText)], { base: b, resolveRef: () => ({ state: 'missing' }) });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'relations', /related kb\/ADR-0009 does not exist in this home/, 'warning'));
    assert.ok(has(vs, 'relations', /not-an-id is not a qualified id/, 'warning'));
    assert.ok(has(vs, 'relations', /depends_on web\/ADR-0001 does not exist/, 'warning'));
});

test('fix3-4: linking a legacy predecessor to a locked successor without supersedes warns', () => {
    const predBase = makeRecord({ fm: { status: 'superseded' }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSuperseded 2026-11-01.' } });
    const predNow = predBase.replace(/^superseded_by:.*$/m, 'superseded_by: kb/ADR-0002');
    const succText = makeRecord({ number: '0002', fm: { supersedes: undefined } });
    const b = base({ '0001-session-storage.md': predBase, '0002-other.md': succText });
    const records = [loadRecord('/h/0001-session-storage.md', predNow), loadRecord('/h/0002-other.md', succText)];
    const vs = run(records, { base: b });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'relations', /does not list kb\/ADR-0001 in supersedes/, 'warning'));
    // A successor that lists other predecessors, or one this change edits, can be made symmetric.
    const listsOther = makeRecord({ number: '0002', fm: { supersedes: ['kb/ADR-0005'] } });
    const b2 = base({ '0001-session-storage.md': predBase, '0002-other.md': listsOther });
    assert.ok(has(run([records[0], loadRecord('/h/0002-other.md', listsOther)], { base: b2, resolveRef: () => ({ state: 'found', fm: {} }) }), 'relations', /does not list kb\/ADR-0001/));
});

test('fix3-5: findings between records the change leaves unchanged warn, whatever their status', () => {
    const draft = makeRecord({ status: 'proposed', fm: LEGACY_FM });
    const b = base({ '0001-a.md': draft, '0001-b.md': draft });
    const vs = run([loadRecord('/h/0001-a.md', draft), loadRecord('/h/0001-b.md', draft)], { base: b });
    assert.deepEqual(errors(vs), []);
    assert.ok(has(vs, 'number', /also used by 0001-a.md/, 'warning'));
});

test('fix3-9 (I3): a record accepted on the base tip since the fork cannot be edited here', () => {
    const name = '0001-session-storage.md';
    const draft = makeRecord({ status: 'proposed' });
    const b = base({ [name]: draft }, { tip: { [name]: makeRecord() } });
    const edited = loadRecord(`/h/${name}`, makeRecord({ status: 'proposed', sections: { Context: 'Rewritten.' } }));
    assert.ok(has(run([edited], { base: b }), 'locked', /accepted on main since this branch forked; rebase onto main/));
    assert.ok(!run([loadRecord(`/h/${name}`, draft)], { base: b }).some((v) => v.rule === 'locked'));
});

test('fix4-1: a locked record with an unreadable block key it keeps can still take an allowed edit', () => {
    const name = '0001-session-storage.md';
    const was = blockYamlLegacy().replace(/^rfc:.*$/m, 'rfc: >2\n  one\n  two');
    const deprecated = was
        .replace('status: accepted', 'status: deprecated')
        .replace('Accepted 2026-10-01 by Alex Doe.', 'Accepted 2026-10-01 by Alex Doe.\nDeprecated 2026-11-01.');
    const vs = run([loadRecord(`/h/${name}`, deprecated)], { base: base({ [name]: was }) });
    assert.ok(has(vs, 'frontmatter', /block value under "rfc"/, 'warning'));
    // The readable block keys can be rewritten inline, so they stay errors; nothing else fails.
    assert.deepEqual(errors(vs).map((v) => v.message).sort(), [
        'block value under "tags": every value must be inline on the key\'s line',
        'description is a block scalar (> or |): put the value on one line',
    ]);
});

test('fix4-2: a locked high-tier record missing sections it can never add is not failed for them', () => {
    const name = '0001-session-storage.md';
    const text = makeRecord({ sections: { 'Considered options': undefined, 'Assumptions and invalidation triggers': undefined } });
    const vs = run([loadRecord(`/h/${name}`, text)], { base: base({ [name]: text }) });
    assert.deepEqual(errors(vs), []);
    // A new record still needs them.
    assert.ok(has(run([loadRecord(`/h/${name}`, text)]), 'high-tier', /two considered options/));
});

test('fix4-4: a deleted record locked on the base tip since the fork needs a rebase', () => {
    const name = '0001-session-storage.md';
    const b = base({ [name]: makeRecord({ status: 'proposed' }) }, { tip: { [name]: makeRecord() } });
    assert.ok(has(run([], { base: b }), 'locked', /accepted on main since this branch forked/));
    assert.ok(!run([], { base: base({ [name]: makeRecord({ status: 'proposed' }) }) }).some((v) => v.level === 'error'));
});

// B4: legacy records (no frontmatter, or not classified on the base) are not locked; the change
// that converts them may rewrite anything, and full rules apply to the result.
const BARE = '# ADR-0001: Sessions\n\n## Status\nAccepted 2025-03-01\n\n## Decision\nWe keep sessions on the server.\n';
const UNCLASSIFIED = () => makeRecord({ fm: { ...LEGACY_FM, decided_by: undefined, deciders: ['Alex Doe'] } });

test('B4: a frontmatter-less base record may be rewritten into a valid record', () => {
    const name = '0001-session-storage.md';
    assert.deepEqual(run([rec()], { base: base({ [name]: BARE }) }), []);
    const thin = rec({ sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.' } });
    assert.ok(has(run([thin], { base: base({ [name]: BARE }) }), 'high-tier', /invalidation trigger/));
});

test('B6: a frontmatter-less base takes its status from the last status word in ## Status', () => {
    const name = '0001-session-storage.md';
    const back = rec({ status: 'proposed', fm: { decided_by: [] } });
    assert.ok(has(run([back], { base: base({ [name]: BARE }) }), 'locked', /status accepted -> proposed/));
    // Prose statuses map to any settled status in the conversion (the parsed word may be wrong);
    // only reopening as a proposal is refused.
    const deprecated = BARE.replace('Accepted 2025-03-01', 'Accepted 2025-03-01\nDeprecated 2025-06-01: gone');
    assert.ok(!run([rec()], { base: base({ [name]: deprecated }) }).some((v) => v.rule === 'locked'));
    assert.ok(has(run([back], { base: base({ [name]: deprecated }) }), 'locked', /status deprecated -> proposed/));
    // A proposal stays a draft: no status word that locks it, so nothing to keep.
    const proposal = BARE.replace('Accepted 2025-03-01', 'Proposed 2025-03-01');
    assert.ok(!run([back], { base: base({ [name]: proposal }) }).some((v) => v.rule === 'locked'));
});

test('B4: an unclassified base record is not locked; its conversion meets the full rules', () => {
    const name = '0001-session-storage.md';
    const rewritten = rec({ sections: { Context: 'Rewritten.' } });
    assert.deepEqual(run([rewritten], { base: base({ [name]: UNCLASSIFIED() }) }), []);
    // Classified now, so not grandfathered: a missing decided_by is an error, not a warning.
    const noDecider = rec({ fm: { decided_by: [] }, sections: { Context: 'Rewritten.' } });
    assert.ok(has(run([noDecider], { base: base({ [name]: UNCLASSIFIED() }) }), 'decided-by', /named human/));
    // Once classified on the base, the lock applies.
    assert.ok(has(run([rewritten], { base: base({ [name]: makeRecord() }) }), 'locked', /section "Context" changed/));
});

test('B4: an unclassified record accepted on both base and tip may be converted without a rebase', () => {
    const name = '0001-session-storage.md';
    const b = base({ [name]: UNCLASSIFIED() });
    assert.ok(!run([rec({ sections: { Context: 'Rewritten.' } })], { base: b }).some((v) => v.rule === 'locked'));
});

test('B4: a legacy record in the wrong home warns; a new or classified one fails', () => {
    const name = '0001-session-storage.md';
    const service = rec({ fm: { reversibility: 'two-way', blast_radius: 'service', scope: ['api:src/**'] } });
    for (const legacyBase of [BARE, UNCLASSIFIED()]) {
        const vs = run([service], { base: base({ [name]: legacyBase }) });
        assert.deepEqual(errors(vs), []);
        assert.ok(has(vs, 'home', /belongs in the local home; leave it here, or supersede it with a record there/, 'warning'));
    }
    assert.ok(has(run([service]), 'home', /belongs in the local home/));
    const classifiedBase = makeRecord({ fm: { reversibility: 'two-way' } });
    assert.ok(has(run([service], { base: base({ [name]: classifiedBase }) }), 'home', /belongs in the local home/));
});
