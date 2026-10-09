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
        'lore/knowledge/adrs/0002-inventory-reservation.md: proposed-shared: warning: a shared-home record merges only as accepted or rejected',
    ]);
});

test('the fixture holds exactly the records the scenarios assert against', () => {
    const r = spawnSync(process.execPath, [CLI, 'index', '--json'], { cwd: WORKSPACE, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const ids = JSON.parse(r.stdout).records.map((e) => `${e.id} ${e.status}`);
    assert.deepEqual(ids, ['backend/ADR-0001 accepted', 'kb/ADR-0001 accepted', 'kb/ADR-0002 proposed']);
});
