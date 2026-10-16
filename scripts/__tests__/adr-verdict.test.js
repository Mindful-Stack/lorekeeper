'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEVERITY, parseFindings, verdict } = require('../adr/verdict');

const f = (cls, ids) => ({ class: cls, ids, summary: `${cls} finding` });

test('severity table: the three blocking classes are critical; stale facts minor; dangling important', () => {
    assert.deepEqual(SEVERITY, {
        contradiction: 'critical', uncovered: 'critical', trigger: 'critical', 'stale-fact': 'minor', dangling: 'important',
    });
});

test('no findings: nothing blocks', () => {
    const v = verdict({ findings: [] });
    assert.equal(v.blocking, 0);
    assert.deepEqual(v.counts, { critical: 0, important: 0, minor: 0 });
});

test('a contradiction blocks; a stale fact does not', () => {
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R1']), f('stale-fact', ['kb/ADR-0001.F2'])] });
    assert.equal(v.blocking, 1);
    assert.deepEqual(v.findings.map((x) => [x.severity, x.blocking]), [['critical', true], ['minor', false]]);
});

test('parseFindings rejects an unknown class, a missing summary and a non-array ids', () => {
    assert.throws(() => parseFindings('{"findings":[{"class":"behaviour-rule","ids":[],"summary":"x"}]}'), /unknown class behaviour-rule/);
    assert.throws(() => parseFindings('{"findings":[{"class":"trigger","ids":[]}]}'), /summary/);
    assert.throws(() => parseFindings('{"findings":[{"class":"trigger","ids":"kb/ADR-0001","summary":"x"}]}'), /ids/);
    assert.throws(() => parseFindings('not json'), /JSON/);
    assert.throws(() => parseFindings('{}'), /findings/);
});

test('parseFindings accepts a markdown report and reads its adr-findings block', () => {
    const md = 'Report\n\n```adr-findings\n{"findings":[{"class":"stale-fact","ids":["kb/ADR-0001.F1"],"summary":"x"}]}\n```\n';
    assert.equal(parseFindings(md).length, 1);
});

test('parseFindings rejects markdown with more than one adr-findings block', () => {
    const md = '```adr-findings\n{"findings":[]}\n```\ntext\n```adr-findings\n{"findings":[]}\n```';
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

test('verdict throws on unknown finding class, protecting against prototype pollution', () => {
    assert.throws(
        () => verdict({ findings: [{ class: '__proto__', ids: [], summary: 'x' }] }),
        /unknown class __proto__/
    );
});

test('parseFindings ignores an extra key, so older architect output still parses', () => {
    const doc = '{"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"x","introduced":false}]}';
    const [x] = parseFindings(doc);
    assert.deepEqual(x, { class: 'contradiction', ids: ['kb/ADR-0001'], summary: 'x', where: null });
    assert.equal(verdict({ findings: [x] }).blocking, 1);
});
