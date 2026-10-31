'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEVERITY, parseFindings, verdict } = require('../adr/verdict');

const f = (cls, ids) => ({ class: cls, ids, summary: `${cls} finding` });

test('severity table: the four blocking classes are critical; stale facts minor; dangling important', () => {
    assert.deepEqual(SEVERITY, {
        contradiction: 'critical', uncovered: 'critical', trigger: 'critical', 'behaviour-rule': 'critical', 'stale-fact': 'minor', dangling: 'important',
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
    assert.throws(() => parseFindings('{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"not-a-class","ids":[],"summary":"x","where":"a:1"}]}'), /unknown class not-a-class/);
    assert.throws(() => parseFindings('{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"trigger","ids":[],"where":"a:1"}]}'), /summary/);
    assert.throws(() => parseFindings('{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"trigger","ids":"kb/ADR-0001","summary":"x","where":"a:1"}]}'), /ids/);
    assert.throws(() => parseFindings('not json'), /JSON/);
    assert.throws(() => parseFindings('{}'), /findings/);
});

test('parseFindings accepts a markdown report and reads its adr-findings block', () => {
    const md = 'Report\n\n```adr-findings\n{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"stale-fact","ids":["kb/ADR-0001.F1"],"summary":"x","where":"a:1"}]}\n```\n';
    assert.equal(parseFindings(md).findings.length, 1);
});

test('parseFindings rejects markdown with more than one adr-findings block', () => {
    const md = '```adr-findings\n{"coverage":{"checked":[],"notReviewed":[]},"findings":[]}\n```\ntext\n```adr-findings\n{"coverage":{"checked":[],"notReviewed":[]},"findings":[]}\n```';
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

// Regression: a complete, empty block followed by a second opener that is never closed. The old
// block-matching regex (which only counts *closed* blocks) saw one closed block (the empty one)
// and silently ignored the unterminated second block, so a contradiction hiding there never
// surfaced and the verdict exited 0. Counting openers, not closed blocks, catches this.
test('parseFindings rejects a complete block followed by a second, unterminated opener hiding a contradiction', () => {
    const md = [
        '```adr-findings',
        '{"coverage":{"checked":[],"notReviewed":[]},"findings":[]}',
        '```',
        '```adr-findings',
        '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"hidden","where":"a:1"}]}',
    ].join('\n');
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

test('parseFindings rejects a single opener with no closing fence', () => {
    const md = '```adr-findings\n{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"x","where":"a:1"}]}';
    assert.throws(() => parseFindings(md), /not terminated/);
});

// Regression: a complete block followed by a SECOND opener indented two spaces. CommonMark
// allows 0-3 spaces of indentation before a fence; the old opener regex was anchored at column
// 0, so this second opener (holding a contradiction) was invisible to the cardinality check and
// the verdict silently read only the first, empty block: blocking: 0.
test('parseFindings counts a second opener indented up to 3 spaces (CommonMark fence indentation)', () => {
    const md = [
        '```adr-findings',
        '{"coverage":{"checked":[],"notReviewed":[]},"findings":[]}',
        '```',
        '  ```adr-findings',
        '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"hidden","where":"a:1"}]}',
        '```',
    ].join('\n');
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

test('parseFindings accepts a four-backtick opener (CommonMark: a run of 3 or more)', () => {
    const md = ['````adr-findings', '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"stale-fact","ids":["kb/ADR-0001.F1"],"summary":"x","where":"a:1"}]}', '````'].join('\n');
    const [x] = parseFindings(md).findings;
    assert.equal(x.class, 'stale-fact');
});

test('parseFindings accepts a tilde fence', () => {
    const md = ['~~~adr-findings', '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"dangling","ids":[],"summary":"x"}]}', '~~~'].join('\n');
    const [x] = parseFindings(md).findings;
    assert.equal(x.class, 'dangling');
});

test('parseFindings rejects a closer with trailing text after the fence (not a valid CommonMark closer)', () => {
    const md = ['```adr-findings', '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"dangling","ids":[],"summary":"x"}]}', '``` oops'].join('\n');
    assert.throws(() => parseFindings(md), /not terminated/);
});

test('parseFindings requires the closer to use the same fence character as the opener', () => {
    const md = ['```adr-findings', '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"dangling","ids":[],"summary":"x"}]}', '~~~'].join('\n');
    assert.throws(() => parseFindings(md), /not terminated/);
});

test('parseFindings requires the closer run to be at least as long as the opener\'s', () => {
    const md = ['````adr-findings', '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"dangling","ids":[],"summary":"x"}]}', '```'].join('\n');
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
        '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"uncovered","ids":[],"summary":"message broker has no record","where":"a:1"}]}',
        '```',
    ].join('\n');
    const [x] = parseFindings(report).findings;
    assert.equal(x.class, 'uncovered');
});

test('verdict throws on unknown finding class, protecting against prototype pollution', () => {
    assert.throws(
        () => verdict({ findings: [{ class: '__proto__', ids: [], summary: 'x' }] }),
        /unknown class __proto__/
    );
});

test('parseFindings rejects a non-string "where"', () => {
    assert.throws(
        () => parseFindings('{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"trigger","ids":[],"summary":"x","where":42}]}'),
        /where must be a string/
    );
});

test('parseFindings accepts a string "where" and keeps it', () => {
    const [x] = parseFindings('{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"trigger","ids":[],"summary":"x","where":"kb/ADR-0001"}]}').findings;
    assert.equal(x.where, 'kb/ADR-0001');
});

test('parseFindings ignores an extra key, so older architect output still parses', () => {
    const doc = '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"contradiction","ids":["kb/ADR-0001"],"summary":"x","introduced":false,"where":"a:1"}]}';
    const [x] = parseFindings(doc).findings;
    assert.deepEqual(x, { class: 'contradiction', ids: ['kb/ADR-0001'], summary: 'x', where: 'a:1' });
    assert.equal(verdict({ findings: [x] }).blocking, 1);
});

const cov = { checked: [], notReviewed: [] };
const one = (f) => JSON.stringify({ coverage: cov, findings: [f] });

test('parseFindings returns {coverage, findings}; located classes need where; null is absent', () => {
    const r = parseFindings(one({ class: 'stale-fact', ids: ['kb/ADR-0001.F1'], where: 'a:1', summary: 's' }));
    assert.deepEqual(r.coverage, cov);
    for (const cls of ['contradiction', 'trigger', 'uncovered', 'stale-fact']) {
        assert.throws(() => parseFindings(one({ class: cls, ids: [], where: null, summary: 's' })), /where/, cls);
    }
    assert.doesNotThrow(() => parseFindings(one({ class: 'dangling', ids: ['kb/ADR-0042'], where: null, summary: 's' })));
});

test('parseFindings reads a CRLF markdown report', () => {
    const md = ['Report', '', '```adr-findings', JSON.stringify({ coverage: cov, findings: [] }), '```', ''].join('\r\n');
    assert.deepEqual(parseFindings(md).findings, []);
});

test('behaviour-rule is critical and blocks', () => {
    const v = verdict({ findings: [{ class: 'behaviour-rule', ids: ['api/device.R1'], where: 'x:1', summary: 's' }] });
    assert.equal(v.findings[0].severity, 'critical');
    assert.equal(v.blocking, 1);
});

test('parseFindings needs where on a behaviour-rule finding', () => {
    const doc = { coverage: { checked: [], notReviewed: [] }, findings: [{ class: 'behaviour-rule', ids: ['api/device.R1'], where: null, summary: 's' }] };
    assert.throws(() => parseFindings(JSON.stringify(doc)), /behaviour-rule needs "where"/);
});
