'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lockedDiff } = require('../adr/locked');
const { backfill } = require('../adr/backfill');
const { makeRecord } = require('./helpers/adr-fixtures');

const BASE = makeRecord();
const S = (extra) => makeRecord({ sections: extra });

function legacy() {
    return makeRecord({
        fm: { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined, decided_by: undefined, deciders: ['Alex Doe'] },
    });
}

test('an identical record passes', () => {
    assert.deepEqual(lockedDiff(BASE, BASE), []);
});

test('edit 1: appended Status line with a transition to superseded passes', () => {
    const cur = makeRecord({
        fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' },
        sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSuperseded 2026-11-01 by kb/ADR-0002.' },
    });
    assert.deepEqual(lockedDiff(BASE, cur), []);
});

test('edit 1: a transition without a Status line fails', () => {
    const cur = makeRecord({ fm: { status: 'deprecated' } });
    assert.ok(lockedDiff(BASE, cur).some((m) => /needs a line appended to ## Status/.test(m)));
});

test('edit 1: never back to proposed', () => {
    const cur = makeRecord({ status: 'proposed', fm: { decided_by: ['Alex Doe'] }, sections: { Status: `${'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.'}\nReopened.` } });
    assert.ok(lockedDiff(BASE, cur).some((m) => /accepted -> proposed/.test(m)));
});

test('edit 1: rewriting an earlier Status line fails', () => {
    const cur = S({ Status: 'Proposed 2026-09-29.\nAccepted 2026-10-01 by Alex Doe.' });
    assert.ok(lockedDiff(BASE, cur).some((m) => /Status" may only grow/.test(m)));
});

test('edit 2: superseded_by is set only with the superseded transition, and never changes', () => {
    const noted = 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSupersession proposed by kb/ADR-0002.';
    assert.deepEqual(lockedDiff(BASE, makeRecord({ sections: { Status: noted } })), []);
    const early = makeRecord({ fm: { superseded_by: 'kb/ADR-0002' }, sections: { Status: noted } });
    assert.ok(lockedDiff(BASE, early).some((m) => /superseded_by is set only together with status: superseded/.test(m)));
    const flipped = 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nSuperseded 2026-11-01 by kb/ADR-0002.';
    const set = makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' }, sections: { Status: flipped } });
    assert.deepEqual(lockedDiff(BASE, set), []);
    const changed = makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0003' }, sections: { Status: flipped } });
    assert.ok(lockedDiff(set, changed).some((m) => /superseded_by is already set/.test(m)));
});

function stub(fm, body = 'Moved to api/ADR-0004.') {
    const head = makeRecord({ fm: { moved_to: 'api/ADR-0004', ...fm } });
    return `${head.slice(0, head.indexOf('\n---\n') + 5)}${body}\n`;
}

test('edit 2: a move replaces the file with a one-line stub', () => {
    assert.deepEqual(lockedDiff(BASE, stub({})), []);
    assert.ok(lockedDiff(BASE, stub({}, 'Moved.\nAnd more.')).some((m) => /one-line body/.test(m)));
});

test('edit 2: a stub keeps every base frontmatter value', () => {
    assert.ok(lockedDiff(BASE, stub({ title: 'ADR-0001: Something else' })).some((m) => /title changed/.test(m)));
    assert.ok(lockedDiff(BASE, stub({ decided_by: ['Mallory'] })).some((m) => /decided_by changed/.test(m)));
});

test('edit 1: deprecated may later be superseded; nothing leaves superseded or rejected', () => {
    const dep = makeRecord({ fm: { status: 'deprecated' }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nDeprecated 2026-11-01.' } });
    const sup = makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nDeprecated 2026-11-01.\nSuperseded 2026-12-01 by kb/ADR-0002.' } });
    assert.deepEqual(lockedDiff(dep, sup), []);
    const back = makeRecord({ fm: { status: 'accepted', superseded_by: 'kb/ADR-0002' }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nDeprecated 2026-11-01.\nSuperseded 2026-12-01 by kb/ADR-0002.\nReinstated.' } });
    assert.ok(lockedDiff(sup, back).some((m) => /superseded -> accepted/.test(m)));
    const rejected = makeRecord({ status: 'rejected', fm: { decided_by: ['Alex Doe'] } });
    const revived = makeRecord({ status: 'accepted', fm: { decided_by: ['Alex Doe'] }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nRevived.' } });
    assert.ok(lockedDiff(rejected, revived).some((m) => /rejected -> accepted/.test(m)));
});

test('edit 1: appending to the last Status line instead of adding one fails', () => {
    const cur = makeRecord({ fm: { status: 'deprecated' }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe. Deprecated.' } });
    assert.ok(lockedDiff(BASE, cur).some((m) => /Status" may only grow/.test(m)));
});

test('edit 3: a dated observation appended passes; an undated one fails', () => {
    const base = '<!-- append-only, accepted records only; newest last -->';
    const ok = S({ 'Later observations': `${base}\n- 2026-11-02 (PR 41): F1 no longer holds; payloads reach 6 KB. No trigger fired.\n  - source: metrics` });
    assert.deepEqual(lockedDiff(BASE, ok), []);
    const bad = S({ 'Later observations': `${base}\n- F1 no longer holds.` });
    assert.ok(lockedDiff(BASE, bad).some((m) => /starts with its date/.test(m)));
    const loose = S({ 'Later observations': `${base}\n- 2026-11-02 F1 holds.\nAlso, R1 is now optional.` });
    assert.ok(lockedDiff(BASE, loose).some((m) => /starts with its date/.test(m)));
});

test('edit 3: editing an earlier observation fails', () => {
    const one = S({ 'Later observations': '- 2026-11-02 first.' });
    const edited = S({ 'Later observations': '- 2026-11-02 first, amended.' });
    assert.ok(lockedDiff(one, edited).some((m) => /may only grow/.test(m)));
});

test('edit 3: a legacy record may gain a Later observations section', () => {
    const base = makeRecord({ sections: { 'Later observations': undefined } });
    const cur = makeRecord({ sections: { 'Later observations': '- 2026-11-02 F1 still holds.' } });
    assert.deepEqual(lockedDiff(base, cur), []);
});

test('edit 4: reflowed whitespace, emphasis and bullets pass', () => {
    const cur = S({ Context: 'Sessions are stored in *signed* cookies today.\nCookies   cap at 4 KB.' });
    assert.deepEqual(lockedDiff(BASE, cur), []);
    const bullets = S({ Consequences: '* Every instance needs the store, so a store outage logs everyone out.' });
    assert.deepEqual(lockedDiff(BASE, bullets), []);
});

test('edit 4: a link target may change, its text may not', () => {
    const base = S({ 'See also': '- [the RFC](https://old.example/rfc) and [[adrs/0002-old-slug]]' });
    const target = S({ 'See also': '- [the RFC](https://new.example/rfc) and [[adrs/0002-new-slug]]' });
    assert.deepEqual(lockedDiff(base, target), []);
    const text = S({ 'See also': '- [the old RFC](https://old.example/rfc) and [[adrs/0002-old-slug]]' });
    assert.ok(lockedDiff(base, text).some((m) => /See also" changed/.test(m)));
});

test('edit 4: a spelling fix is not a repair', () => {
    const cur = S({ Context: 'Sessions are stored in signed cookies today. Cookies cap at 4 KiB.' });
    assert.ok(lockedDiff(BASE, cur).some((m) => /Context" changed/.test(m)));
});

test('edit 4: MUST NOT -> MUST is caught', () => {
    const cur = S({ Decision: 'The API stores sessions server-side because payloads outgrow cookies.\n\n- **R1** Session state MUST be written to cookies.' });
    assert.ok(lockedDiff(BASE, cur).some((m) => /Decision" changed/.test(m)));
});

test('edit 4: snake_case identifiers are not treated as emphasis', () => {
    const base = S({ Context: 'The user_id column is the key.' });
    const cur = S({ Context: 'The userid column is the key.' });
    assert.ok(lockedDiff(base, cur).some((m) => /Context" changed/.test(m)));
});

test('edit 5: backfilling a legacy record passes', () => {
    const base = legacy();
    const filled = backfill(base, 'kb/ADR-0001').text;
    assert.deepEqual(lockedDiff(base, filled), []);
});

test('edit 5: classifying a backfilled legacy record passes, once', () => {
    const base = backfill(legacy(), 'kb/ADR-0001').text;
    const classified = base
        .replace('reversibility:', 'reversibility: two-way')
        .replace('blast_radius:', 'blast_radius: cross-service')
        .replace('sensitivity: []', 'sensitivity: [billing]');
    assert.deepEqual(lockedDiff(base, classified), []);
    const reclassified = classified.replace('sensitivity: [billing]', 'sensitivity: [billing, legal]');
    assert.ok(lockedDiff(classified, reclassified).some((m) => /sensitivity cannot change once the record is classified/.test(m)));
});

test('edit 5: an empty key on a classified record cannot be filled', () => {
    const cur = makeRecord({ fm: { sensitivity: ['security'] } });
    assert.ok(lockedDiff(BASE, cur).some((m) => /sensitivity cannot change/.test(m)));
});

test('decided_by cannot override the legacy deciders', () => {
    const base = legacy();
    const overridden = base.replace(/^(deciders: .*)$/m, '$1\ndecided_by: [Mallory]');
    assert.notEqual(overridden, base);
    assert.ok(lockedDiff(base, overridden).some((m) => /cannot replace the deciders/.test(m)));
});

test('edit 5: a partial classification is rejected', () => {
    const base = backfill(legacy(), 'kb/ADR-0001').text;
    const partial = base.replace('reversibility:', 'reversibility: two-way');
    assert.ok(lockedDiff(base, partial).some((m) => /classify a record in one change/.test(m)));
});

test('renaming deciders to decided_by is not a backfill', () => {
    const base = legacy();
    const renamed = base.replace('deciders: [', 'decided_by: [');
    assert.ok(lockedDiff(base, renamed).some((m) => /frontmatter deciders changed/.test(m)));
});

test('related and depends_on cannot be added to a locked record', () => {
    const cur = makeRecord({ fm: { related: ['kb/ADR-0002'] } });
    assert.ok(lockedDiff(BASE, cur).some((m) => /frontmatter related changed/.test(m)));
});

test('adding, removing or reordering sections fails', () => {
    assert.ok(lockedDiff(BASE, S({ Notes: 'extra' })).some((m) => /sections added: Notes/.test(m)));
    assert.ok(lockedDiff(BASE, S({ 'See also': undefined })).some((m) => /See also" was removed/.test(m)));
    const moved = BASE.replace(/## Consequences\n[^\n]*\n\n/, '') + '## Consequences\n- Every instance needs the store, so a store outage logs everyone out.\n';
    assert.ok(lockedDiff(BASE, moved).some((m) => /reordered/.test(m)));
});

test('I4: an identical half-classified record passes (classification is checked only when it changes)', () => {
    const half = backfill(legacy(), 'kb/ADR-0001').text.replace('blast_radius:', 'blast_radius: cross-service');
    assert.deepEqual(lockedDiff(half, half), []);
});

test('M5: only paired emphasis is formatting; a glob losing its ** is a change', () => {
    const base = S({ Context: 'Applies to src/** and `lib/**` today.' });
    assert.ok(lockedDiff(base, S({ Context: 'Applies to src/ and `lib/**` today.' })).some((m) => /Context" changed/.test(m)));
    assert.ok(lockedDiff(base, S({ Context: 'Applies to src/** and `lib/` today.' })).some((m) => /Context" changed/.test(m)));
    const plain = S({ Context: 'Sessions are stored in signed cookies today.' });
    for (const marked of ['**signed**', '*signed*', '__signed__', '_signed_']) {
        assert.deepEqual(lockedDiff(plain, S({ Context: `Sessions are stored in ${marked} cookies today.` })), [], marked);
    }
});

test('M5: markdown link targets may change anywhere; bare wikilinks and autolinks only in See also', () => {
    const at = (section, link) => S({ [section]: `- Read ${link} first.` });
    const pairs = [
        ['[the RFC](https://old.example/rfc)', '[the RFC](https://new.example/rfc)', true],
        ['[[adrs/0002-old|ADR-0002]]', '[[adrs/0002-new|ADR-0002]]', true],
        ['[[adrs/0002-old]]', '[[adrs/0002-new]]', false],
        ['<https://old.example/rfc>', '<https://new.example/rfc>', false],
    ];
    for (const [before, after, anywhere] of pairs) {
        assert.deepEqual(lockedDiff(at('See also', before), at('See also', after)), [], `See also: ${before}`);
        const elsewhere = lockedDiff(at('Context', before), at('Context', after));
        if (anywhere) assert.deepEqual(elsewhere, [], `Context: ${before}`);
        else assert.ok(elsewhere.some((m) => /Context" changed/.test(m)), `Context: ${before}`);
    }
});
