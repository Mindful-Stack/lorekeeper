'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeRecord, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli } = require('./helpers/adr-fixtures');

// A household with a team KB (`lore`, its own git repo) and one code repo (`api`).
function workspace(t) {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2,
        meta_repo: 'ws',
        knowledge_base: 'lore',
        repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api', url: 'git@example.invalid:org/api.git' }],
    }));
    const kb = path.join(root, 'lore');
    const shared = path.join(kb, 'knowledge', 'adrs');
    const api = path.join(root, 'api');
    initRepo(kb, env);
    initRepo(api, env);
    fs.mkdirSync(shared, { recursive: true });
    return { root, env, kb, shared, api, local: path.join(api, 'docs', 'adr') };
}

test('check infers the shared home from the household and passes a valid record', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const r = runCli(w.root, w.env, 'check', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, '');
});

test('check prints path: rule: message and exits 1 on a violation', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'empty');
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord({ fm: { id: 'kb/ADR-0007' } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^lore\/knowledge\/adrs\/0001-session-storage\.md: id: id must be kb\/ADR-0001/m);
});

test('--base: rewriting a locked record fails; a dated observation passes', (t) => {
    const w = workspace(t);
    const file = path.join(w.shared, '0001-session-storage.md');
    write(file, makeRecord());
    commitAll(w.kb, w.env, 'accept 0001');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'change');
    write(file, makeRecord({ sections: { Decision: 'Sessions live in cookies.' } }));
    const bad = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /locked: section "Decision" changed/);
    write(file, makeRecord({ sections: { 'Later observations': '<!-- append-only, accepted records only; newest last -->\n- 2026-11-02 (PR 7): F1 still holds.' } }));
    const ok = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(ok.code, 0, ok.stdout);
});

test('--base: the migration backfill passes against the base', (t) => {
    const w = workspace(t);
    const legacy = makeRecord({ fm: { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined, decided_by: undefined, deciders: ['Alex Doe'] } });
    write(path.join(w.shared, '0001-session-storage.md'), legacy);
    commitAll(w.kb, w.env, 'legacy record');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'migrate');
    const b = runCli(w.root, w.env, 'backfill', w.shared);
    assert.equal(b.code, 0, b.stderr);
    assert.match(b.stdout, /added id, reversibility, blast_radius, sensitivity, scope/);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /warning: reversibility is required/);
    const strict = runCli(w.root, w.env, 'check', '--base', 'main', '--strict', w.shared);
    assert.equal(strict.code, 1);
});

test('--base: relating a new record to an accepted one passes without touching it', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    commitAll(w.kb, w.env, 'accept 0001');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'add-0002');
    write(path.join(w.shared, '0002-token-format.md'), makeRecord({ number: '0002', fm: { related: ['kb/ADR-0001'], depends_on: ['kb/ADR-0001'] } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(git(w.kb, w.env, 'status', '--porcelain', '--', 'knowledge/adrs/0001-session-storage.md'), '');
});

test('--base: a number merged on the base after branching collides', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'empty');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'mine');
    write(path.join(w.shared, '0001-mine.md'), makeRecord());
    commitAll(w.kb, w.env, 'mine');
    git(w.kb, w.env, 'checkout', '-q', 'main');
    write(path.join(w.shared, '0001-theirs.md'), makeRecord());
    commitAll(w.kb, w.env, 'theirs');
    git(w.kb, w.env, 'checkout', '-q', 'mine');
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /number: ADR-0001 is already 0001-theirs.md on the base branch/);
    // Base texts come from the merge base: the tip's record is not "deleted" by this branch.
    assert.doesNotMatch(r.stdout, /never deleted/);
});

test('--base: records merged on the base after branching do not affect this branch', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    commitAll(w.kb, w.env, 'accept 0001');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'mine');
    write(path.join(w.shared, '0002-token-format.md'), makeRecord({ number: '0002' }));
    commitAll(w.kb, w.env, 'mine');
    git(w.kb, w.env, 'checkout', '-q', 'main');
    write(path.join(w.shared, '0003-audit-log.md'), makeRecord({ number: '0003' }));
    commitAll(w.kb, w.env, 'theirs');
    git(w.kb, w.env, 'checkout', '-q', 'mine');
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.stdout, '');
});

test('--base: ride-along requires acceptance when the change touches the scope', (t) => {
    const w = workspace(t);
    write(path.join(w.api, 'src', 'Sessions', 'Store.cs'), 'class Store {}\n');
    commitAll(w.api, w.env, 'init');
    git(w.api, w.env, 'checkout', '-q', '-b', 'feature');
    write(path.join(w.api, 'src', 'Sessions', 'Store.cs'), 'class Store { int x; }\n');
    const record = path.join(w.local, '0001-session-storage.md');
    write(record, makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way' } }));
    const bad = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /ride-along: .*src\/Sessions\/Store\.cs/);
    write(record, makeRecord({ prefix: 'api', fm: { reversibility: 'two-way' } }));
    const ok = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(ok.code, 0, ok.stdout);
});

test('--base with a ref that does not exist exits 2 and says to fetch', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'empty');
    const r = runCli(w.root, w.env, 'check', '--base', 'origin/main', w.shared);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /fetch-depth: 0/);
});

test('check without a household needs --home, and --home local takes --repo for ids', (t) => {
    const dir = tmpDir(t);
    const env = gitEnv(dir);
    initRepo(dir, env);
    const adrs = path.join(dir, 'decisions');
    write(path.join(adrs, '0001-session-storage.md'), makeRecord({ prefix: 'billing-api' }));
    assert.equal(runCli(dir, env, 'check', adrs).code, 2);
    const r = runCli(dir, env, 'check', '--home', 'local', '--repo', 'billing-api', adrs);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('without a manifest, a reference into another home is a warning, not an error', (t) => {
    const dir = tmpDir(t);
    const env = gitEnv(dir);
    initRepo(dir, env);
    commitAll(dir, env, 'init');
    const adrs = path.join(dir, 'docs', 'adr');
    write(path.join(adrs, '0001-session-storage.md'), makeRecord({ prefix: 'api', fm: { related: ['kb/ADR-0002'] } }));
    const r = runCli(dir, env, 'check', '--home', 'local', '--repo', 'api', '--base', 'main', adrs);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /relations: warning: related kb\/ADR-0002: its home is not on disk/);
});

test('select prints matching and cited records as tab-separated lines', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.shared, '0002-web-only.md'), makeRecord({ number: '0002', fm: { scope: ['web:src/**'] } }));
    write(path.join(w.local, '0001-cache.md'), makeRecord({ prefix: 'api', fm: { scope: ['src/Cache/**'] } }));
    const patch = path.join(w.root, 'change.patch');
    write(patch, 'diff --git a/src/Sessions/Store.cs b/src/Sessions/Store.cs\n--- a/src/Sessions/Store.cs\n+++ b/src/Sessions/Store.cs\n');
    const body = path.join(w.root, 'body.md');
    write(body, '## Decisions\n- Follows api/ADR-0001.\n');
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch, '--pr-body', body);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n').map((l) => l.split('\t')[0] + ' ' + l.split('\t')[3]), [
        'api/ADR-0001 cited',
        'kb/ADR-0001 scope',
    ]);
});

test('select infers the repo from the origin remote', (t) => {
    const w = workspace(t);
    git(w.api, w.env, 'remote', 'add', 'origin', 'https://example.invalid/org/api.git');
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/src/Sessions/Store.cs\n');
    const r = runCli(w.api, w.env, 'select', '--diff', patch);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^kb\/ADR-0001\taccepted\t/);
});
