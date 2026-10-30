'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDoc, checkBehaviourHome } = require('../adr/behaviour');
const { makeBehaviourDoc, makeRecord } = require('./helpers/adr-fixtures');

const ADR = makeRecord(); // kb/ADR-0001 with R1, accepted
function resolveRef(id) {
    if (id === 'kb/ADR-0001') return { state: 'found', fm: { status: 'accepted' }, text: ADR };
    if (id === 'kb/ADR-0002') return { state: 'found', fm: { status: 'superseded' }, text: ADR };
    if (id === 'kb/ADR-0003') return { state: 'found', fm: { status: 'accepted' }, text: ADR.replace(/- \*\*R1\*\*/, '-') };
    if (id.startsWith('gone/')) return { state: 'unavailable' };
    return { state: 'missing' };
}
// Files only for the repo a scope entry names, so a wrong repo/glob split shows up.
const filesFor = (kind) => (repo) => ((kind === 'shared' ? repo === 'api' : repo === null) ? ['src/Devices/Status.cs'] : null);
function run(texts, { kind = 'shared', repoFiles = filesFor(kind) } = {}) {
    const docs = texts.map((t, i) => parseDoc(`/h/doc${i}.md`, t));
    const home = { kind, prefix: kind === 'shared' ? 'kb' : 'api' };
    return checkBehaviourHome({ home, docs, resolveRef, repoFiles });
}
const msgs = (out) => out.map((v) => `${v.level} ${v.rule}: ${v.message}`);

test('the default doc passes in both homes with no warnings', () => {
    assert.deepEqual(msgs(run([makeBehaviourDoc()])), []);
    assert.deepEqual(msgs(run([makeBehaviourDoc({ prefix: 'api' })], { kind: 'local' })), []);
});

test('a missing tags key is an error', () => {
    assert.match(msgs(run([makeBehaviourDoc({ fm: { tags: undefined } })])).join('\n'), /error schema: tags is required/);
});

test('prefix adr, a bad prefix and a duplicate prefix are errors', () => {
    assert.match(msgs(run([makeBehaviourDoc({ fm: { prefix: 'adr' } })])).join('\n'), /error prefix/);
    assert.match(msgs(run([makeBehaviourDoc({ fm: { prefix: 'Dev' } })])).join('\n'), /error prefix/);
    const dup = msgs(run([makeBehaviourDoc(), makeBehaviourDoc()]));
    assert.ok(dup.some((m) => /error prefix: prefix device is also used by doc0\.md/.test(m)), dup.join('\n'));
});

test('a prefix written as a list gets its own error', () => {
    const out = msgs(run([makeBehaviourDoc({ fm: { prefix: ['device'] } })]));
    assert.ok(out.includes('error prefix: prefix must be a single value'), out.join('\n'));
});

test('a ### that is not a rule, and a duplicate id, are errors', () => {
    const rules = '### Reading status\nx\n### device.R1 One\nSHALL a.\n- Example: b\n### device.R1 Again\nSHALL c.\n- Example: d';
    const out = msgs(run([makeBehaviourDoc({ sections: { Rules: rules, 'Known deviations': undefined } })]));
    assert.ok(out.some((m) => /error rules: "### Reading status" is not a rule heading/.test(m)), out.join('\n'));
    assert.ok(out.some((m) => /error rules: duplicate rule id device\.R1/.test(m)), out.join('\n'));
});

test('no Not yet decided section is an error', () => {
    assert.match(msgs(run([makeBehaviourDoc({ sections: { 'Not yet decided': undefined } })])).join('\n'), /error sections: needs a ## Not yet decided section/);
});

test('Source resolution: missing, unknown rule, legacy whole-record, unavailable, superseded', () => {
    const doc = (src) => makeBehaviourDoc({ sections: { Rules: `### device.R1 One\nSHALL a.\n- Example: b\n- Source: ${src}`, 'Known deviations': undefined } });
    assert.match(msgs(run([doc('kb/ADR-0042')])).join('\n'), /error relations: Source kb\/ADR-0042 does not exist/);
    assert.match(msgs(run([doc('kb/ADR-0001.R7')])).join('\n'), /error relations: Source kb\/ADR-0001\.R7: kb\/ADR-0001 has no R7/);
    assert.deepEqual(msgs(run([doc('kb/ADR-0003.R7')])), [], 'a record without numbered rules is cited whole');
    assert.match(msgs(run([doc('gone/ADR-0001')])).join('\n'), /warning relations: Source gone\/ADR-0001: its home is not on disk/);
    assert.match(msgs(run([doc('kb/ADR-0002')])).join('\n'), /warning relations: Source kb\/ADR-0002 is superseded/);
    assert.match(msgs(run([doc('ADR-0001')])).join('\n'), /error relations: Source ADR-0001 is not a qualified ADR id/);
});

test('scope syntax per home, and a dead glob warns', () => {
    assert.match(msgs(run([makeBehaviourDoc({ fm: { scope: ['src/**'] } })])).join('\n'), /error scope: shared-home scope entries are <repo>:<glob>/);
    assert.match(msgs(run([makeBehaviourDoc({ prefix: 'api', fm: { scope: ['api:src/**'] } })], { kind: 'local' })).join('\n'), /error scope: local-home scope entries/);
    assert.match(msgs(run([makeBehaviourDoc({ fm: { scope: ['api:src/Nope/**'] } })])).join('\n'), /warning scope: api:src\/Nope\/\*\* matches no tracked file/);
    assert.deepEqual(msgs(run([makeBehaviourDoc({ fm: { scope: ['api:src/Nope/**'] } })], { repoFiles: () => null })), [], 'not checked out: skipped');
});

test('a rule with no SHALL/MUST or no example warns; a deviation naming no rule warns', () => {
    const rules = '### device.R1 One\nIt works.\n';
    const out = msgs(run([makeBehaviourDoc({ sections: { Rules: rules, 'Known deviations': '- device.R9: x (T-1)' } })]));
    assert.ok(out.includes('warning rules: device.R1 has no SHALL or MUST'), out.join('\n'));
    assert.ok(out.includes('warning rules: device.R1 has no Example line'), out.join('\n'));
    assert.ok(out.includes('warning deviations: device.R9 is not a rule in this doc'), out.join('\n'));
});

test('near-miss Source lines and an empty Rules section warn', () => {
    const doc = (src) => makeBehaviourDoc({ sections: { Rules: `### device.R1 One\nSHALL a.\n- Example: b\n${src}`, 'Known deviations': undefined } });
    for (const src of ['- source: kb/ADR-0001', '- **Source:** kb/ADR-0001', 'Source: kb/ADR-0001']) {
        const out = msgs(run([doc(src)]));
        assert.ok(out.some((m) => /^warning rules: ".*" looks like a Source line but is not read; write "- Source: <id>"$/.test(m)), `${src}: ${out.join('\n')}`);
    }
    const before = msgs(run([makeBehaviourDoc({ sections: { Rules: '- Source: kb/ADR-0001\n### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined } })]));
    assert.ok(before.some((m) => /looks like a Source line/.test(m)), before.join('\n'));
    const empty = msgs(run([makeBehaviourDoc({ sections: { Rules: 'none yet', 'Known deviations': undefined } })]));
    assert.ok(empty.includes('warning rules: ## Rules has no rules'), empty.join('\n'));
});

test('a missing prefix reports once, not once per heading', () => {
    const out = msgs(run([makeBehaviourDoc({ fm: { prefix: undefined } })]));
    assert.deepEqual(out.filter((m) => /is not a rule heading/.test(m)), [], out.join('\n'));
    assert.ok(out.includes('error schema: prefix is required'), out.join('\n'));
});

test('an invalid prefix gives only the prefix error, not heading or deviation noise', () => {
    assert.deepEqual(msgs(run([makeBehaviourDoc({ fm: { prefix: 'Device' } })])),
        ['error prefix: prefix Device must match ^[a-z][a-z0-9-]*$ and may not be adr']);
});
