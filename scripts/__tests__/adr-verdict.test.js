'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEVERITY, parseFindings, parseExemptions, verdict } = require('../adr/verdict');

const f = (cls, ids, extra = {}) => ({ class: cls, ids, summary: `${cls} finding`, ...extra });

test('severity table: the three blocking classes are critical; stale facts minor; dangling important', () => {
    assert.deepEqual(SEVERITY, {
        contradiction: 'critical', uncovered: 'critical', trigger: 'critical', 'stale-fact': 'minor', dangling: 'important',
    });
});

test('no findings: nothing blocks', () => {
    const v = verdict({ findings: [], exemptions: [] });
    assert.equal(v.blocking, 0);
    assert.deepEqual(v.counts, { critical: 0, important: 0, minor: 0 });
});

test('a contradiction blocks; a stale fact does not', () => {
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R1']), f('stale-fact', ['kb/ADR-0001.F2'])], exemptions: [] });
    assert.equal(v.blocking, 1);
    assert.deepEqual(v.findings.map((x) => [x.severity, x.blocking]), [['critical', true], ['minor', false]]);
});

test('a finding the base already had is capped at important and does not block', () => {
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001'], { introduced: false })], exemptions: [] });
    assert.equal(v.blocking, 0);
    assert.equal(v.findings[0].severity, 'important');
});

test('a bare exemption downgrades every blocking finding to important and is marked used', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: hotfix, superseding record follows' }]);
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001']), f('uncovered', [])], exemptions: ex.exemptions });
    assert.equal(v.blocking, 0);
    assert.deepEqual(v.findings.map((x) => x.severity), ['important', 'important']);
    assert.ok(v.findings.every((x) => JSON.stringify(x.exemptedBy) === '[0]'));
    assert.equal(v.exempted, 2);
    assert.equal(v.exemptions[0].used, true);
});

test('a per-record exemption covers that record and its rules only', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001 — load test only' }]);
    const v = verdict({
        findings: [f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R2']), f('contradiction', ['kb/ADR-0010', 'kb/ADR-0010.R1'])],
        exemptions: ex.exemptions,
    });
    assert.equal(v.blocking, 1);
    assert.deepEqual(v.findings.map((x) => x.blocking), [false, true]);
});

test('a per-rule exemption does not cover a sibling rule', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001.R1 - reason' }]);
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R2'])], exemptions: ex.exemptions });
    assert.equal(v.blocking, 1);
    assert.equal(v.exemptions[0].used, false);
});

test('kb/ADR-0001 does not cover kb/ADR-00010-like prefixes: matching is by id segment', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001: reason' }]);
    const v = verdict({ findings: [f('trigger', ['kb/ADR-0001x'])], exemptions: ex.exemptions });
    assert.equal(v.blocking, 1);
});

test('a finding breaking R1 and R2 is not cleared by exempting R1 alone; both clear it', () => {
    const finding = f('contradiction', ['kb/ADR-0001', 'kb/ADR-0001.R1', 'kb/ADR-0001.R2']);
    const one = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001.R1 — reason' }]);
    assert.equal(verdict({ findings: [finding], exemptions: one.exemptions }).blocking, 1);
    const both = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001.R1 — a\nADR-Exempt: kb/ADR-0001.R2 — b' }]);
    const v = verdict({ findings: [finding], exemptions: both.exemptions });
    assert.equal(v.blocking, 0);
    assert.deepEqual(v.findings[0].exemptedBy, [0, 1]);
    assert.deepEqual(v.exemptions.map((e) => e.used), [true, true]);
});

test('malformed targeted lines are invalid, never whole-PR; bullets and case are accepted', () => {
    const text = [
        'ADR-Exempt: kb/ADR-0001—no spaces round the dash',
        'ADR-Exempt: kb/ADR-0001.R1, kb/ADR-0002.R1 — a list',
        'ADR-Exempt: kb/ADR-00001 — five digits',
        'ADR-Exempt: kb/ADR-0001.R1, — stray comma',
        'ADR-Exempt: ADR-0003 — unqualified',
        'ADR-Exempt: kb/adr-0003 — lower case id',
        '- ADR-Exempt: kb/ADR-0003 — bulleted',
        '> adr-exempt: kb/ADR-0004 — quoted, lower case',
    ].join('\n');
    const { exemptions, invalid } = parseExemptions([{ source: 'pr-body', text }]);
    assert.equal(invalid.length, 6);
    assert.deepEqual(exemptions.map((e) => e.target), ['kb/ADR-0003', 'kb/ADR-0004']);
    assert.ok(exemptions.every((e) => e.target !== null));
});

test('an uncovered finding is exempted only by the bare form', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: 'ADR-Exempt: kb/ADR-0001 — reason' }]);
    const v = verdict({ findings: [f('uncovered', [])], exemptions: ex.exemptions });
    assert.equal(v.blocking, 1);
});

test('parseExemptions: line-anchored, separators, empty reason invalid, prose mention ignored', () => {
    const text = [
        'Some prose mentioning ADR-Exempt: not at line start? it is at line start of nothing',
        'We discussed the ADR-Exempt: line in review.',
        'ADR-Exempt: kb/ADR-0002 — reason one',
        '  ADR-Exempt: api/ADR-0003.R2 -- reason two',
        'ADR-Exempt: api/ADR-0004: reason three',
        'ADR-Exempt:   ',
        'ADR-Exempt: see kb/ADR-0005 for why',
        'ADR-Exempt: kb/ADR-0006',
        'ADR-Exempt: kb/ADR-0007 —',
    ].join('\n');
    const { exemptions, invalid } = parseExemptions([{ source: 'pr-body', text }]);
    assert.deepEqual(exemptions.map((e) => [e.target, e.reason]), [
        ['kb/ADR-0002', 'reason one'],
        ['api/ADR-0003.R2', 'reason two'],
        ['api/ADR-0004', 'reason three'],
        [null, 'see kb/ADR-0005 for why'],
    ]);
    // Empty, id-only and id-plus-separator lines are invalid, never bare (whole-PR) exemptions.
    assert.deepEqual(invalid.map((i) => i.problem.split(' ')[0]), ['no', 'names', 'names']);
    assert.ok(invalid.every((i) => i.source === 'pr-body'));
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

test('decisionsSection: true / false from the PR body, null without one', () => {
    assert.equal(verdict({ findings: [], exemptions: [], prBody: '## Decisions\nNo new decisions.' }).decisionsSection, true);
    assert.equal(verdict({ findings: [], exemptions: [], prBody: '## Summary\nx' }).decisionsSection, false);
    assert.equal(verdict({ findings: [], exemptions: [] }).decisionsSection, null);
});

test('HTML comments and fenced code blocks do not count as exemptions', () => {
    const text = [
        '<!--',
        'ADR-Exempt: hidden',
        '-->',
        '```text',
        'ADR-Exempt: kb/ADR-0001 — in a fence',
        '```',
        '<!-- ADR-Exempt: x -->',
        'ADR-Exempt: kb/ADR-0002 — visible',
    ].join('\n');
    const { exemptions, invalid } = parseExemptions([{ source: 'pr-body', text }]);
    assert.equal(exemptions.length, 1);
    assert.equal(exemptions[0].target, 'kb/ADR-0002');
    assert.equal(invalid.length, 0);
});

test('parseExemptions strips unterminated HTML comments and code fences', () => {
    const text = 'ADR-Exempt: kb/ADR-0001 — before\n<!--\nADR-Exempt: hidden\n(no close)';
    const { exemptions } = parseExemptions([{ source: 'pr-body', text }]);
    assert.equal(exemptions.length, 1);
    assert.equal(exemptions[0].target, 'kb/ADR-0001');
});

test('an introduced contradiction with exemption only in HTML comment still blocks', () => {
    const ex = parseExemptions([{ source: 'pr-body', text: '<!-- ADR-Exempt: kb/ADR-0001 — hidden -->' }]);
    const v = verdict({ findings: [f('contradiction', ['kb/ADR-0001'])], exemptions: ex.exemptions });
    assert.equal(v.blocking, 1);
});

test('parseFindings rejects markdown with more than one adr-findings block', () => {
    const md = '```adr-findings\n{"findings":[]}\n```\ntext\n```adr-findings\n{"findings":[]}\n```';
    assert.throws(() => parseFindings(md), /more than one adr-findings block/);
});

test('verdict throws on unknown finding class, protecting against prototype pollution', () => {
    assert.throws(
        () => verdict({ findings: [{ class: '__proto__', ids: [], summary: 'x', introduced: true }], exemptions: [] }),
        /unknown class __proto__/
    );
});

test('fences indented by up to 3 spaces are still fences (CommonMark)', () => {
    const text = [
        '   ```',
        'ADR-Exempt: kb/ADR-0001 — hidden',
        '   ```',
    ].join('\n');
    const { exemptions } = parseExemptions([{ source: 'pr-body', text }]);
    assert.equal(exemptions.length, 0);
});

test('a fence closed only by "```js" (not same delimiter) continues stripping', () => {
    const text = [
        '```',
        'ADR-Exempt: kb/ADR-0001 — in fence',
        '```js',
        'ADR-Exempt: kb/ADR-0002 — also in fence',
        '```',
    ].join('\n');
    const { exemptions } = parseExemptions([{ source: 'pr-body', text }]);
    assert.equal(exemptions.length, 0);
});

test('decisionsSection ignores ## Decisions inside HTML comments', () => {
    const prBody = 'Some text\n<!-- ## Decisions\nNo new decisions. -->\n## Summary\nDone';
    const v = verdict({ findings: [], exemptions: [], prBody });
    assert.equal(v.decisionsSection, false);
});
