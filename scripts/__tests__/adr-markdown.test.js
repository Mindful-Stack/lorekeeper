'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { walk } = require('../adr/markdown');

test('walk tags each line with its ## section and skips fenced lines', () => {
    const text = 'intro\n## Rules\n### a.R1 One\n````md\n## Not a heading\n```\nstill fenced\n````\nafter\n## Other\nx';
    const out = walk(text);
    assert.deepEqual(out.sections, ['Rules', 'Other']);
    assert.deepEqual(out.lines.map((l) => [l.section, l.text]), [
        [null, 'intro'], ['Rules', '### a.R1 One'], ['Rules', 'after'], ['Other', 'x'],
    ]);
});

test('a backtick opener whose info string holds a backtick is not a fence', () => {
    const out = walk('## S\n``` a`b\n## T\n');
    assert.deepEqual(out.sections, ['S', 'T']);
});

test('CRLF input reads the same as LF', () => {
    assert.deepEqual(walk('## S\r\nx').lines.map((l) => l.text), ['x']);
});
