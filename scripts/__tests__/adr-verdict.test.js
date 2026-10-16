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

// Regression: a complete, empty block followed by a second opener that is never closed. The old
// block-matching regex (which only counts *closed* blocks) saw one closed block (the empty one)
// and silently ignored the unterminated second block, so a contradiction hiding there never
// surfaced and the verdict exited 0. Counting openers, not closed blocks, catches this.
test('parseFindings rejects a complete block followed by a second, unterminated opener hiding a contradiction', () => {
    const md = [
        '```adr-findings',
        '{"findings":[]}',
        '```',
        '```adr-findings',
        '{"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"hidden"}]}',
    ].join('\n');
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

test('parseFindings rejects a single opener with no closing fence', () => {
    const md = '```adr-findings\n{"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"x"}]}';
    assert.throws(() => parseFindings(md), /not terminated/);
});

// The review now writes the architect's whole report (every section, not just the fenced block)
// to the findings file; parseFindings must find the one block inside it unaided.
test('parseFindings reads the block out of a full architect report, headed sections and all', () => {
    const report = [
        '## Contradictions with accepted records',
        'none',
        '',
        '## Triggers fired',
        'none',
        '',
        '## Uncovered hard-to-reverse choices',
        '- `infra/docker-compose.yml:10-31` introduces a message broker; no record covers messaging.',
        '',
        '```adr-findings',
        '{"findings":[{"class":"uncovered","ids":[],"summary":"message broker has no record"}]}',
        '```',
    ].join('\n');
    const [x] = parseFindings(report);
    assert.equal(x.class, 'uncovered');
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
