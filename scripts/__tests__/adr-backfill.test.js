'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backfill } = require('../adr/backfill');
const { parseRecord } = require('../adr/frontmatter');

const LEGACY = '---\ntitle: "ADR-0003: Test tiers"\ndescription: "x"\ntags: [adr]\nstatus: accepted\ndate: 2026-09-20\ndeciders: [Alex Doe]\nconfidence: high\n---\n\n# ADR-0003\n';

test('backfill adds id first and empty classification keys last, touching nothing else', () => {
    const r = backfill(LEGACY, 'kb/ADR-0003');
    assert.deepEqual(r.added, ['id', 'reversibility', 'blast_radius', 'sensitivity', 'scope']);
    const lines = r.text.split('\n');
    assert.equal(lines[1], 'id: kb/ADR-0003');
    const kept = lines.filter((l) => !/^(id|reversibility|blast_radius|sensitivity|scope):/.test(l));
    assert.equal(kept.join('\n'), LEGACY);
    const fm = parseRecord(r.text).fm;
    assert.equal(fm.reversibility, '');
    assert.deepEqual(fm.sensitivity, []);
    assert.deepEqual(fm.deciders, ['Alex Doe']);
    assert.equal(fm.decided_by, undefined);
});

test('backfill is idempotent and fills an empty id in place', () => {
    const once = backfill(LEGACY, 'kb/ADR-0003').text;
    assert.equal(backfill(once, 'kb/ADR-0003').changed, false);
    const emptyId = once.replace('id: kb/ADR-0003', 'id:');
    assert.equal(backfill(emptyId, 'kb/ADR-0003').text, once);
});

test('backfill keeps CRLF line endings', () => {
    const r = backfill(LEGACY.replace(/\n/g, '\r\n'), 'kb/ADR-0003');
    assert.ok(!/[^\r]\n/.test(r.text));
});
