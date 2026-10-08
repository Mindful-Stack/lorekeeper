'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePatchPaths, parseCitedIds, select } = require('../adr/select');

test('parsePatchPaths reads both sides and skips /dev/null', () => {
    const patch = 'diff --git a/src/a.cs b/src/a.cs\n--- a/src/a.cs\n+++ b/src/a.cs\n@@\ndiff --git a/new.txt b/new.txt\n--- /dev/null\n+++ b/new.txt\n';
    assert.deepEqual(parsePatchPaths(patch).sort(), ['new.txt', 'src/a.cs']);
});

test('parseCitedIds reads only the Decisions section', () => {
    const body = '## Summary\nSee kb/ADR-0009.\n\n## Decisions\n- Follows kb/ADR-0001 and api/ADR-0002.\n\n## Testing\napi/ADR-0003';
    assert.deepEqual(parseCitedIds(body), ['kb/ADR-0001', 'api/ADR-0002']);
});

test('select matches local globs, repo-prefixed shared globs, and citations', () => {
    const candidates = [
        { id: 'api/ADR-0001', kind: 'local', status: 'accepted', file: 'a', scope: ['src/Sessions/**'] },
        { id: 'kb/ADR-0001', kind: 'shared', status: 'accepted', file: 'b', scope: ['api:src/**', 'web:src/**'] },
        { id: 'kb/ADR-0002', kind: 'shared', status: 'accepted', file: 'c', scope: ['web:src/**'] },
        { id: 'kb/ADR-0003', kind: 'shared', status: 'rejected', file: 'd', scope: [] },
    ];
    const out = select({ candidates, repo: 'api', paths: ['src/Sessions/Store.cs'], cited: ['kb/ADR-0003', 'kb/ADR-0042'] });
    assert.deepEqual(out.map((o) => [o.id, o.reasons.join(',')]), [
        ['api/ADR-0001', 'scope'],
        ['kb/ADR-0001', 'scope'],
        ['kb/ADR-0003', 'cited'],
        ['kb/ADR-0042', 'cited'],
    ]);
    assert.equal(out[3].status, 'missing');
});

test('select sorts by codepoint, independent of locale', () => {
    const candidates = ['B/ADR-0001', 'api-x/ADR-0001', 'api_x/ADR-0001', 'a/ADR-0001']
        .map((id) => ({ id, kind: 'local', status: 'accepted', file: id, scope: ['**'] }));
    const out = select({ candidates, repo: 'api', paths: ['x'], cited: [] });
    assert.deepEqual(out.map((o) => o.id), ['B/ADR-0001', 'a/ADR-0001', 'api-x/ADR-0001', 'api_x/ADR-0001']);
});

test('M7: parsePatchPaths reads mnemonic prefixes (diff.mnemonicPrefix)', () => {
    const patch = 'diff --git i/src/a.cs w/src/a.cs\n--- i/src/a.cs\n+++ w/src/a.cs\ndiff --git c/src/b.cs w/src/b.cs\n--- c/src/b.cs\n+++ w/src/b.cs\n';
    assert.deepEqual(parsePatchPaths(patch).sort(), ['src/a.cs', 'src/b.cs']);
});

test('M7: parsePatchPaths reads --no-prefix patches, including a top-level one-letter directory', () => {
    const patch = 'diff --git src/a.cs src/a.cs\n--- src/a.cs\n+++ src/a.cs\ndiff --git a/x.cs a/x.cs\n--- a/x.cs\n+++ a/x.cs\n';
    assert.deepEqual(parsePatchPaths(patch).sort(), ['a/x.cs', 'src/a.cs']);
});

test('fix2-3: --- and +++ lines inside a hunk are content, not file headers', () => {
    const withHeader = 'diff --git a/db/init.sql b/db/init.sql\n--- a/db/init.sql\n+++ b/db/init.sql\n@@ -1,2 +1,2 @@\n--- comment\n+++ x\n context\n';
    assert.deepEqual(parsePatchPaths(withHeader), ['db/init.sql']);
    const headerless = '--- a/db/init.sql\n+++ b/db/init.sql\n@@ -1,2 +1,2 @@\n--- comment\n+++ x\n--- a/src/b.cs\n';
    assert.deepEqual(parsePatchPaths(headerless), ['db/init.sql']);
    const next = `${withHeader}diff --git a/src/b.cs b/src/b.cs\n--- a/src/b.cs\n+++ b/src/b.cs\n@@ -1 +1 @@\n`;
    assert.deepEqual(parsePatchPaths(next).sort(), ['db/init.sql', 'src/b.cs']);
});
