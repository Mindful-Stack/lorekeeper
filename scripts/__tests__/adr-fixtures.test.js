'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseRecord, sections } = require('../adr/frontmatter');
const { KNOWN_KEYS } = require('../adr/records');
const { makeRecord } = require('./helpers/adr-fixtures');

const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'references', 'adr-template.md'), 'utf8');

// Keys a record may carry that the template deliberately leaves out.
const NOT_IN_TEMPLATE = new Set(['deciders', 'moved_to']);

test('the template parses cleanly and carries exactly the known keys', () => {
    const t = parseRecord(TEMPLATE);
    assert.deepEqual(t.errors, []);
    const expected = [...KNOWN_KEYS].filter((k) => !NOT_IN_TEMPLATE.has(k)).sort();
    assert.deepEqual([...t.order].sort(), expected);
});

test('the fixture uses the template frontmatter keys and sections, in order', () => {
    const t = parseRecord(TEMPLATE);
    const f = parseRecord(makeRecord());
    assert.deepEqual(f.order, t.order);
    assert.deepEqual(sections(f.body).map((s) => s.heading), sections(t.body).map((s) => s.heading));
});
