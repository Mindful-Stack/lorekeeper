'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDoc, ruleNumbers, DOC_ID_RE } = require('../adr/behaviour');
const { makeBehaviourDoc } = require('./helpers/adr-fixtures');

test('parseDoc reads rule headings, sources, sections and deviations', () => {
    const d = parseDoc('/x/device-status.md', makeBehaviourDoc());
    assert.deepEqual(d.sections, ['Purpose', 'Rules', 'Known deviations', 'Not yet decided']);
    assert.deepEqual(d.headings.map((h) => [h.id, h.n, h.name, h.sources]), [
        ['device.R1', 'R1', 'Status is current', ['kb/ADR-0001.R1']],
        ['device.R2', 'R2', 'Project scoped', []],
    ]);
    assert.deepEqual(d.deviations, ['device.R2']);
});

test('a bold group label is not a rule, and a ### in a fence is not a heading', () => {
    const rules = '**Group**\n\n### device.R1 One\nSHALL x.\n- Example: y\n\n```md\n### device.R9 Fenced\n```';
    const d = parseDoc('/x/a.md', makeBehaviourDoc({ sections: { Rules: rules } }));
    assert.deepEqual(d.headings.map((h) => h.id), ['device.R1']);
});

test('a heading with another prefix or no name has no id', () => {
    const rules = '### other.R1 Name\nSHALL x.\n### device.R2\nSHALL y.\n### Plain words\nz';
    const d = parseDoc('/x/a.md', makeBehaviourDoc({ sections: { Rules: rules } }));
    assert.deepEqual(d.headings.map((h) => h.id), [null, null, null]);
});

test('ruleNumbers lists the R<n> of every well-formed rule', () => {
    assert.deepEqual(ruleNumbers(makeBehaviourDoc()), ['R1', 'R2']);
});

test('DOC_ID_RE takes behaviour ids and refuses ADR ids', () => {
    assert.ok(DOC_ID_RE.test('backend/device'));
    assert.ok(DOC_ID_RE.test('kb/org-roles'));
    assert.ok(!DOC_ID_RE.test('kb/ADR-0001'));
});

test('a ### indented up to three spaces is a heading; its Source line is its own', () => {
    const rules = '### device.R1 One\nSHALL x\n   ### Group label\n- Source: kb/ADR-0002';
    const d = parseDoc('/x/a.md', makeBehaviourDoc({ sections: { Rules: rules } }));
    assert.deepEqual(d.headings.map((h) => h.id), ['device.R1', null]);
    assert.deepEqual(d.headings[0].sources, []);
});

test('only unindented list items in Known deviations name rules', () => {
    const dev = '- device.R1: archived (DEV-1)\n  - note: see thread';
    const d = parseDoc('/x/a.md', makeBehaviourDoc({ sections: { 'Known deviations': dev } }));
    assert.deepEqual(d.deviations, ['device.R1']);
});
