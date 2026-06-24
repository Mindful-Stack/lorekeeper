'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CURRENT, MIGRATIONS, resolveVersion, migrate } = require('../migrate-manifest.js');

test('CURRENT is 2', () => {
    assert.equal(CURRENT, 2);
});

test('resolveVersion defaults absent schema_version to 1', () => {
    assert.equal(resolveVersion({ workspace: 'ws' }), 1);
    assert.equal(resolveVersion({ schema_version: 2, meta_repo: 'ws' }), 2);
});

test('registry integrity: contiguous chain ending at CURRENT', () => {
    assert.ok(MIGRATIONS.length >= 1);
    assert.equal(MIGRATIONS[0].from, 1);
    for (let i = 0; i < MIGRATIONS.length; i++) {
        assert.equal(MIGRATIONS[i].to, MIGRATIONS[i].from + 1);
        if (i > 0) assert.equal(MIGRATIONS[i].from, MIGRATIONS[i - 1].to);
    }
    assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, CURRENT);
});

test('v1->v2: workspace-only renames to meta_repo and stamps version', () => {
    const r = migrate({ workspace: 'grantigo', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.changed, true);
    assert.equal(r.manifest.meta_repo, 'grantigo');
    assert.equal('workspace' in r.manifest, false);
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: meta_repo-only just stamps version, no rename', () => {
    const r = migrate({ meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.manifest.meta_repo, 'ws');
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: both keys with same value drops workspace', () => {
    const r = migrate({ workspace: 'ws', meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal('workspace' in r.manifest, false);
    assert.equal(r.manifest.meta_repo, 'ws');
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: both keys with different values is a conflict (no write)', () => {
    const r = migrate({ workspace: 'old', meta_repo: 'new', repos: [] });
    assert.equal(r.ok, false);
    assert.match(r.conflict, /different values/);
});

test('idempotency: already-current manifest is a no-op', () => {
    const r = migrate({ schema_version: 2, meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
});

test('migrate never mutates the input object', () => {
    const input = { workspace: 'ws', repos: [] };
    migrate(input);
    assert.equal(input.workspace, 'ws');
    assert.equal('meta_repo' in input, false);
});
