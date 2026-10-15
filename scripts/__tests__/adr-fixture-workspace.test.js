'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

// The Babashka scenarios assert against these records, so they must stay valid: a scenario that
// "finds" a broken record would pass for the wrong reason.
const WORKSPACE = path.join(__dirname, '..', '..', 'test', 'fixtures', 'workspace');
const CLI = path.join(__dirname, '..', 'adr-lint.js');

function check(home) {
    const r = spawnSync(process.execPath, [CLI, 'check', home], { cwd: WORKSPACE, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
}

test('the fixture local home passes the validator with no findings', () => {
    const r = check('backend/docs/adr');
    assert.equal(r.code, 0, r.out);
    assert.equal(r.out, '');
});

test('the fixture shared home passes, its proposal only warning', () => {
    const r = check('lore/knowledge/adrs');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.out.trim().split('\n'), [
        'lore/knowledge/adrs/0002-inventory-reservation.md: proposed-shared: warning: a shared-home record merges only as accepted or rejected'
            + ' — record a named human\'s approval: `/lore:adr accept kb/ADR-0002 by <name>` (or tell Claude who approved it)',
    ]);
});

test('the fixture holds exactly the records the scenarios assert against', () => {
    const r = spawnSync(process.execPath, [CLI, 'index', '--json'], { cwd: WORKSPACE, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const ids = JSON.parse(r.stdout).records.map((e) => `${e.id} ${e.status}`);
    assert.deepEqual(ids, ['backend/ADR-0001 accepted', 'kb/ADR-0001 accepted', 'kb/ADR-0002 proposed']);
});

test('review fixture: the device-cache patch hunk header matches its line counts', () => {
    const fs = require('fs');
    const lines = fs.readFileSync(path.join(WORKSPACE, '.review', 'device-cache.patch'), 'utf8').split('\n');
    const at = lines.findIndex((l) => l.startsWith('@@'));
    const [, oldN, newN] = /^@@ -1,(\d+) \+1,(\d+) @@/.exec(lines[at]).map(Number);
    const hunk = lines.slice(at + 1).filter((l) => l !== '');
    assert.equal(hunk.filter((l) => !l.startsWith('+')).length, oldN);
    assert.equal(hunk.filter((l) => !l.startsWith('-')).length, newN);
});

function selectFixture(patch) {
    const r = spawnSync(process.execPath, [CLI, 'select', '--json', '--repo', 'backend', '--diff', path.join('.review', patch)], { cwd: WORKSPACE, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).candidates.map((c) => c.id);
}

test('review fixture: the device-cache patch selects exactly backend/ADR-0001', () => {
    assert.deepEqual(selectFixture('device-cache.patch'), ['backend/ADR-0001']);
});

test('review fixture: the search-store patch selects nothing, so only judgment can find it', () => {
    assert.deepEqual(selectFixture('search-store.patch'), []);
});

test('review fixture: the device-cache patch adds a cache, which backend/ADR-0001.R1 forbids', () => {
    const fs = require('fs');
    const patch = fs.readFileSync(path.join(WORKSPACE, '.review', 'device-cache.patch'), 'utf8');
    const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    assert.match(added, /IMemoryCache/);
    const record = fs.readFileSync(path.join(WORKSPACE, 'backend', 'docs', 'adr', '0001-device-status-reads.md'), 'utf8');
    assert.match(record, /\*\*R1\*\* Device status queries MUST NOT read from an in-process or distributed cache\./);
});
