'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFindings, SEVERITY } = require('../adr/verdict');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'adr-findings.v1.schema.json'), 'utf8'));

// The two OpenAI strict-mode rules that `codex exec --output-schema` rejected a schema for in
// testing: every object closes additionalProperties and lists every property as required.
// This is a structural guard, not proof of acceptance; Task 8 runs real Codex against it.
function strictProblems(node, at = '$') {
    const out = [];
    if (node && typeof node === 'object') {
        const t = node.type;
        if (t === 'object' || (Array.isArray(t) && t.includes('object'))) {
            if (node.additionalProperties !== false) out.push(`${at}: additionalProperties must be false`);
            const keys = Object.keys(node.properties || {}).sort();
            if (JSON.stringify(keys) !== JSON.stringify([...(node.required || [])].sort())) out.push(`${at}: required must list every property`);
        }
        for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') out.push(...strictProblems(v, `${at}.${k}`));
    }
    return out;
}

test('the v1 schema follows the strict-mode rules', () => {
    assert.deepEqual(strictProblems(SCHEMA), []);
});

test('the schema class enum is exactly the severity table', () => {
    assert.deepEqual([...SCHEMA.properties.findings.items.properties.class.enum].sort(), Object.keys(SEVERITY).sort());
});

test('a strict-mode document parses', () => {
    const doc = { coverage: { checked: ['kb/ADR-0001'], notReviewed: [] },
        findings: [{ class: 'dangling', ids: ['kb/ADR-0042'], where: null, summary: 's' }] };
    assert.equal(parseFindings(JSON.stringify(doc)).findings.length, 1);
});
