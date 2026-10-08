'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRecord, sections, isEmpty } = require('../adr/frontmatter');

test('parses inline scalars, quoted strings, lists and empty values', () => {
    const r = parseRecord('---\ntitle: "ADR-0001: a, b"\ntags: [adr, "x, y"]\nsuperseded_by:\nscope: []\n---\nbody');
    assert.deepEqual(r.errors, []);
    assert.equal(r.fm.title, 'ADR-0001: a, b');
    assert.deepEqual(r.fm.tags, ['adr', 'x, y']);
    assert.equal(r.fm.superseded_by, '');
    assert.deepEqual(r.fm.scope, []);
    assert.equal(r.body, 'body');
});

test('strips a trailing comment but keeps # inside values', () => {
    const r = parseRecord('---\nstatus: proposed   # proposed | accepted\nrfc: https://x.test/a#frag\n---\n');
    assert.equal(r.fm.status, 'proposed');
    assert.equal(r.fm.rfc, 'https://x.test/a#frag');
});

test('reports block scalars, block lists and duplicate keys', () => {
    const r = parseRecord('---\ndescription: >\n  folded\ntags:\n  - adr\ntags: [adr]\n---\n');
    assert.ok(r.errors.some((e) => /description is a block scalar/.test(e)));
    assert.ok(r.errors.some((e) => /block value under "description"/.test(e)));
    assert.ok(r.errors.some((e) => /duplicate key: tags/.test(e)));
});

test('a file without frontmatter is reported, not parsed as empty', () => {
    const r = parseRecord('# just a heading\n');
    assert.equal(r.found, false);
    assert.match(r.errors[0], /no frontmatter/);
});

test('CRLF input parses like LF', () => {
    const r = parseRecord('---\r\nstatus: accepted\r\n---\r\n## Status\r\nok\r\n');
    assert.equal(r.fm.status, 'accepted');
    assert.equal(sections(r.body)[1].content, 'ok\n');
});

test('sections split on level-2 headings outside code fences', () => {
    const s = sections('# T\n\n## A\none\n```\n## not a heading\n```\n## B\ntwo');
    assert.deepEqual(s.map((x) => x.heading), [null, 'A', 'B']);
    assert.match(s[1].content, /## not a heading/);
});

test('isEmpty treats absent, empty string and empty list alike', () => {
    assert.ok(isEmpty(undefined) && isEmpty('') && isEmpty([]));
    assert.ok(!isEmpty('x') && !isEmpty(['x']));
});
