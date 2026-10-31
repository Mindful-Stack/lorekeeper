'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../adr/coverage');

const RECORD = [
    '# ADR-0001: x', '', '## Decision', 'Text.', '',
    '- **R1** MUST a,', '  continued on a second line.',
    '- **R2** MUST NOT b.', '',
    '```markdown', '- **R8** an example inside a fence, not a rule', '```', '',
    '## Facts relied on', '- F1 one — source: x', '- F2 two — source: y', '',
    '## Consequences', '- **R9** is not a rule here.', '',
].join('\n');

test('ruleIds and factIds read their own section only, and skip fenced examples', () => {
    assert.deepEqual(C.ruleIds(RECORD), ['R1', 'R2']);
    assert.deepEqual(C.factIds(RECORD), ['F1', 'F2']);
    assert.deepEqual(C.ruleIds(RECORD.replace(/\n/g, '\r\n')), ['R1', 'R2']);
});

test('recordOf strips a rule or fact suffix', () => {
    assert.equal(C.recordOf('kb/ADR-0001.R2'), 'kb/ADR-0001');
    assert.equal(C.recordOf('kb/ADR-0001.F1'), 'kb/ADR-0001');
    assert.equal(C.recordOf('kb/ADR-0001'), 'kb/ADR-0001');
});

const LEGACY = '# legacy\n\n## Decision\nNo numbered rules.\n';
const cat = { 'kb/ADR-0001': RECORD, 'kb/ADR-0002': LEGACY };
const base = { picked: [{ id: 'kb/ADR-0001', status: 'accepted' }], recordText: (id) => cat[id] || null };
const doc = (checked, findings = [], notReviewed = []) => ({ coverage: { checked, notReviewed }, findings });
const v = (d, over = {}) => C.validate({ ...base, ...over, doc: d });

test('full attestation with no findings passes; extra and notReviewed are reported', () => {
    assert.deepEqual(v(doc(['kb/ADR-0001'])), { extra: [], notReviewed: [], dangling: [] });
    const r = v(doc(['kb/ADR-0001', 'kb/ADR-0002'], [], ['package-lock.json not assessed']));
    assert.deepEqual(r.extra, ['kb/ADR-0002']);
    assert.deepEqual(r.notReviewed, ['package-lock.json not assessed']);
});

test('missing coverage, an unresolvable checked id, or an unattested selected record exits 2', () => {
    assert.throws(() => v({ findings: [] }), /coverage/);
    assert.throws(() => v(doc(['kb/ADR-0001', 'kb/ADR-0099'])), /checked kb\/ADR-0099 does not resolve/);
    assert.throws(() => v(doc([])), /not checked: kb\/ADR-0001/);
});

test('a finding on a selected record counts as checking it', () => {
    const f = { class: 'contradiction', ids: ['kb/ADR-0001.R1'], where: 'a:1', summary: 's' };
    assert.doesNotThrow(() => v(doc([], [f])));
});

test('finding ids: rule-only, fact-only and record-plus-rule forms; unknown ids exit 2', () => {
    const f = (cls, ids) => doc(['kb/ADR-0001'], [{ class: cls, ids, where: 'a:1', summary: 's' }]);
    assert.doesNotThrow(() => v(f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R2'])));
    assert.doesNotThrow(() => v(f('stale-fact', ['kb/ADR-0001.F2'])));
    assert.throws(() => v(f('contradiction', ['kb/ADR-0001.R8'])), /R8/);
    assert.throws(() => v(f('stale-fact', ['kb/ADR-0001.F3'])), /F3/);
    assert.throws(() => v(f('trigger', ['kb/ADR-0099'])), /kb\/ADR-0099 does not resolve/);
    assert.throws(() => v(f('contradiction', ['kb/ADR-0001.R1', 'kb/ADR-0002'])), /more than one record/);
});

test('a contradiction cites a rule when the record has numbered rules; a legacy record may be cited whole', () => {
    assert.throws(() => v(doc(['kb/ADR-0001'], [{ class: 'contradiction', ids: ['kb/ADR-0001'], where: 'a:1', summary: 's' }])), /rule id/);
    const legacy = { picked: [{ id: 'kb/ADR-0002', status: 'accepted' }] };
    assert.doesNotThrow(() => v(doc(['kb/ADR-0002'], [{ class: 'contradiction', ids: ['kb/ADR-0002'], where: 'a:1', summary: 's' }]), legacy));
});

test('selected missing ids the reviewer did not report come back as dangling, not as an error', () => {
    const over = { picked: [...base.picked, { id: 'kb/ADR-0042', status: 'missing' }, { id: 'kb/ADR-0043', status: 'missing' }] };
    const reported = { class: 'dangling', ids: ['kb/ADR-0042'], where: null, summary: 's' };
    assert.deepEqual(v(doc(['kb/ADR-0001'], [reported]), over).dangling, ['kb/ADR-0043']);
});

test('rule ids follow CommonMark fences: a longer fence containing a shorter fence line hides nothing after it', () => {
    const text = [
        '## Decision', '````markdown', '```', '- **R8** example', '```', '````', '- **R1** real rule.', '',
        '## Facts relied on', '- F1 one', '',
    ].join('\n');
    assert.deepEqual(C.ruleIds(text), ['R1']);
    assert.deepEqual(C.factIds(text), ['F1']);
    const tilde = ['## Decision', '~~~', '- **R8** example', '~~~', '- **R2** real.'].join('\n');
    assert.deepEqual(C.ruleIds(tilde), ['R2']);
});

test('a selected missing id in checked is not an unresolvable error', () => {
    const over = { picked: [...base.picked, { id: 'kb/ADR-0042', status: 'missing' }] };
    assert.deepEqual(v(doc(['kb/ADR-0001', 'kb/ADR-0042']), over).dangling, ['kb/ADR-0042']);
});

const { validate } = C;
const { makeBehaviourDoc } = require('./helpers/adr-fixtures');
const { adrRuleIds } = require('../adr/behaviour');
const DOC = makeBehaviourDoc({ prefix: 'api' }); // rules device.R1, device.R2
const pickedB = [{ id: 'api/device', status: '-', doc: 'behaviour' }];
const textB = (id) => (id === 'api/device' ? DOC : null);
const docOf = (findings, checked = []) => ({ coverage: { checked, notReviewed: [] }, findings });

test('a behaviour-rule finding attests its doc and must name one of its rules', () => {
    const f = (ids) => ({ class: 'behaviour-rule', ids, where: 'src/x.cs:1-2', summary: 's' });
    assert.doesNotThrow(() => validate({ doc: docOf([f(['api/device.R2'])]), picked: pickedB, recordText: textB }));
    assert.throws(() => validate({ doc: docOf([f(['api/device'])]), picked: pickedB, recordText: textB }), /must cite a rule id/);
    assert.throws(() => validate({ doc: docOf([f(['api/device.R9'])]), picked: pickedB, recordText: textB }), /names no R9/);
    assert.throws(() => validate({ doc: docOf([f(['kb/ADR-0001.R1'])]), picked: pickedB, recordText: () => 'x' }), /behaviour-rule names kb\/ADR-0001, which is not a behaviour doc/);
});

test('an ADR class naming a behaviour doc is refused', () => {
    const f = { class: 'contradiction', ids: ['api/device.R1'], where: 'src/x.cs:1', summary: 's' };
    assert.throws(() => validate({ doc: docOf([f]), picked: pickedB, recordText: textB }), /contradiction names api\/device, which is a behaviour doc; use behaviour-rule/);
});

test('a selected behaviour doc must be attested like a record', () => {
    assert.throws(() => validate({ doc: docOf([]), picked: pickedB, recordText: textB }), /selected records or behaviour docs not checked: api\/device/);
    assert.doesNotThrow(() => validate({ doc: docOf([], ['api/device']), picked: pickedB, recordText: textB }));
});

test('coverage and the behaviour validator read ADR rule ids identically', () => {
    for (const text of [RECORD, RECORD.replace(/\n/g, '\r\n')]) {
        assert.deepEqual(adrRuleIds(text), C.ruleIds(text));
        assert.deepEqual(C.ruleIds(text), ['R1', 'R2']);
    }
});

test('the document kind comes from kindOf, not from the id\'s shape', () => {
    const upper = (id) => (id === 'api/Device' ? DOC.replace(/device/g, 'Device') : null);
    const kindOf = (id) => (id === 'api/Device' ? 'behaviour' : 'adr');
    const f = (cls, ids) => ({ class: cls, ids, where: 'src/x.cs:1', summary: 's' });
    assert.throws(() => validate({ doc: docOf([f('stale-fact', ['api/Device'])]), picked: [], recordText: upper, kindOf }), /stale-fact names api\/Device, which is a behaviour doc/);
    // Past the kind check, so the failure is about rules, not "not a behaviour doc".
    assert.throws(() => validate({ doc: docOf([f('behaviour-rule', ['api/Device.R1'])]), picked: [], recordText: upper, kindOf }), /names no R1/);
});
