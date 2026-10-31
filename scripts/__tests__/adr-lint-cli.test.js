'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeRecord, makeBehaviourDoc, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli } = require('./helpers/adr-fixtures');

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
    // I6: a legacy proposal is classified when it is accepted, never by the backfill.
    const proposal = makeRecord({ number: '0002', status: 'proposed', fm: { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined } });
    write(path.join(w.shared, '0002-token-format.md'), proposal);
    commitAll(w.kb, w.env, 'legacy record');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'migrate');
    const b = runCli(w.root, w.env, 'backfill', w.shared);
    assert.equal(b.code, 0, b.stderr);
    assert.match(b.stdout, /0001-session-storage\.md: added id, reversibility, blast_radius, sensitivity, scope/);
    assert.match(b.stdout, /0002-token-format\.md: skipped: proposed \(classify on accept\)/);
    assert.equal(fs.readFileSync(path.join(w.shared, '0002-token-format.md'), 'utf8'), proposal);
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
    const bad = runCli(w.root, w.env, 'check', '--base', 'main', '--ci', w.local);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /ride-along: .*src\/Sessions\/Store\.cs/);
    write(record, makeRecord({ prefix: 'api', fm: { reversibility: 'two-way' } }));
    const ok = runCli(w.root, w.env, 'check', '--base', 'main', '--ci', w.local);
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

test('I3: --base: a record accepted on the base after branching cannot be rewritten', (t) => {
    const w = workspace(t);
    const file = path.join(w.local, '0001-session-storage.md');
    const draft = (context) => makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way', scope: [] }, sections: { Context: context } });
    write(file, draft('Draft context.'));
    commitAll(w.api, w.env, 'propose 0001');
    git(w.api, w.env, 'checkout', '-q', '-b', 'mine');
    git(w.api, w.env, 'checkout', '-q', 'main');
    write(file, makeRecord({ prefix: 'api', fm: { reversibility: 'two-way', scope: [] }, sections: { Context: 'Draft context.' } }));
    commitAll(w.api, w.env, 'accept 0001');
    git(w.api, w.env, 'checkout', '-q', 'mine');
    write(file, draft('Rewritten context.'));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: locked: accepted on main since this branch forked; rebase onto main/);
    git(w.api, w.env, 'checkout', '-q', '--', '.');
    const untouched = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(untouched.code, 0, untouched.stdout);
});

test('M1: an unknown flag is a usage error for each subcommand', (t) => {
    const w = workspace(t);
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/x\n');
    for (const args of [
        ['check', '--bogus', w.shared],
        ['check', '--diff', patch, w.shared],
        ['check', '--config', patch, w.shared],
        ['select', '--repo', 'api', '--diff', patch, '--strict'],
        ['backfill', '--base', 'main', w.shared],
    ]) {
        const r = runCli(w.root, w.env, ...args);
        assert.equal(r.code, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /unknown flag/);
    }
});

test('b3: who approves is not configured: an old adr.decisionOwners is ignored, not an error', (t) => {
    const w = workspace(t);
    const manifest = JSON.parse(fs.readFileSync(path.join(w.root, 'household.json'), 'utf8'));
    manifest.adr = { decisionOwners: ['@arch-team'], deciders: ['Sam Roe'] };
    write(path.join(w.root, 'household.json'), JSON.stringify(manifest));
    // An accepted high-tier record decided by someone in no list.
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord({ fm: { decided_by: ['Anyone Else'] } }));
    const r = runCli(w.root, w.env, 'check', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /decided-by/);
    const homes = JSON.parse(runCli(w.root, w.env, 'homes').stdout);
    assert.deepEqual(homes.config, { localDir: 'docs/adr', sharedDir: 'adrs' });
});

test('M2: a home directory that does not exist is empty, and deleting it is still checked', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    commitAll(w.kb, w.env, 'accept 0001');
    fs.rmSync(w.shared, { recursive: true });
    const plain = runCli(w.root, w.env, 'check', w.shared);
    assert.equal(plain.code, 0, plain.stdout + plain.stderr);
    const based = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(based.code, 1, based.stdout + based.stderr);
    assert.match(based.stdout, /0001-session-storage\.md: locked: a locked record is never deleted/);
});

test('M3: an unreadable --diff or --pr-body is a usage error', (t) => {
    const w = workspace(t);
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/x\n');
    const missing = path.join(w.root, 'nope');
    assert.equal(runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', missing).code, 2);
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch, '--pr-body', missing);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /cannot read --pr-body/);
});

test('M4: no merge base says to fetch, like a missing ref', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'main');
    git(w.kb, w.env, 'checkout', '-q', '--orphan', 'other');
    commitAll(w.kb, w.env, 'other');
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no merge base between main and HEAD; fetch .*fetch-depth: 0/);
});

test('M8 (decision 17): a proposed record whose scope covers its own home does not ride along', (t) => {
    const w = workspace(t);
    write(path.join(w.api, 'README.md'), 'api\n');
    commitAll(w.api, w.env, 'init');
    git(w.api, w.env, 'checkout', '-q', '-b', 'propose');
    write(path.join(w.local, '0001-docs-layout.md'), makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way', scope: ['docs/**'] } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /ride-along/);
});

test('G: a proposal merged without code still rides along when a later change touches its scope', (t) => {
    const w = workspace(t);
    commitAll(w.api, w.env, 'empty');
    git(w.api, w.env, 'checkout', '-q', '-b', 'pr1');
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api', status: 'proposed' }));
    commitAll(w.api, w.env, 'propose 0001');
    git(w.api, w.env, 'checkout', '-q', 'main');
    git(w.api, w.env, 'merge', '-q', '--no-ff', '-m', 'merge pr1', 'pr1');
    git(w.api, w.env, 'checkout', '-q', '-b', 'pr2');
    write(path.join(w.api, 'src', 'Sessions', 'Store.cs'), 'class Store {}\n');
    const r = runCli(w.root, w.env, 'check', '--base', 'main', '--ci', w.local);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: ride-along: this change touches src\/Sessions\/Store\.cs/);
});

test('I: renaming a proposed record\'s slug keeps its number', (t) => {
    const w = workspace(t);
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way', scope: [] } }));
    commitAll(w.api, w.env, 'proposal on main');
    git(w.api, w.env, 'checkout', '-q', '-b', 'pr1');
    git(w.api, w.env, 'mv', path.join(w.local, '0001-session-storage.md'), path.join(w.local, '0001-session-state.md'));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', '--ci', w.local);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /number/);
});

test('I: renaming an accepted record still fails, and a new record cannot take its number', (t) => {
    const w = workspace(t);
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api' }));
    commitAll(w.api, w.env, 'accepted on main');
    git(w.api, w.env, 'checkout', '-q', '-b', 'pr1');
    git(w.api, w.env, 'mv', path.join(w.local, '0001-session-storage.md'), path.join(w.local, '0001-session-state.md'));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: locked: a locked record is never deleted or renamed/);
    assert.match(r.stdout, /0001-session-state\.md: number: ADR-0001 is already 0001-session-storage\.md/);
});

test('fix4-4: --base: deleting a record accepted on the base since the fork fails', (t) => {
    const w = workspace(t);
    const file = path.join(w.local, '0001-session-storage.md');
    write(file, makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way', scope: [] } }));
    commitAll(w.api, w.env, 'propose 0001');
    git(w.api, w.env, 'checkout', '-q', '-b', 'feature');
    git(w.api, w.env, 'checkout', '-q', 'main');
    write(file, makeRecord({ prefix: 'api', fm: { reversibility: 'two-way', scope: [] } }));
    commitAll(w.api, w.env, 'accept 0001');
    git(w.api, w.env, 'checkout', '-q', 'feature');
    fs.rmSync(file);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: locked: accepted on main since this branch forked; rebase onto main/);
});

test('fix4-7: a declared team KB that is not checked out makes kb/ references warnings', (t) => {
    const w = workspace(t);
    fs.rmSync(w.kb, { recursive: true });
    write(path.join(w.api, 'README.md'), 'api\n');
    commitAll(w.api, w.env, 'init');
    git(w.api, w.env, 'checkout', '-q', '-b', 'feature');
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api', fm: { reversibility: 'two-way', related: ['kb/ADR-0002'] } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /relations: warning: related kb\/ADR-0002: its home is not on disk/);
    // A prefix the household does not declare is still an error.
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api', fm: { reversibility: 'two-way', related: ['nope/ADR-0002'] } }));
    const unknown = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(unknown.code, 1, unknown.stdout);
    assert.match(unknown.stdout, /related nope\/ADR-0002 does not exist/);
});

// B4: a legacy record (no frontmatter, or not classified on the base) is not locked: the change
// that converts it may rewrite it, and the converted record meets every new-format rule.
const LEGACY_BARE = [
    '# ADR-0001: Sessions',
    '',
    '## Status',
    'Accepted 2025-03-01',
    '',
    '## Context',
    'Cookies are too small for our sessions.',
    '',
    '## Decision',
    'We keep sessions on the server.',
    '',
].join('\n');

function legacyOnMain(w, dir, repo, text) {
    const file = path.join(dir, '0001-session-storage.md');
    write(file, text);
    commitAll(repo, w.env, 'legacy record');
    git(repo, w.env, 'checkout', '-q', '-b', 'convert');
    return file;
}

test('B4a: a frontmatter-less legacy record may be rewritten into a valid new-format record', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.shared, w.kb, LEGACY_BARE);
    write(file, makeRecord());
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /locked/);
});

test('B4b: the converted record meets the full rules (a high-tier record without a trigger fails)', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.shared, w.kb, LEGACY_BARE);
    write(file, makeRecord({ sections: { 'Assumptions and invalidation triggers': '- Assumes nothing.' } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /high-tier: needs at least one invalidation trigger/);
});

test('B4c: an unclassified legacy record may have its body rewritten as it is classified', (t) => {
    const w = workspace(t);
    const legacy = makeRecord({ fm: { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined, decided_by: undefined, deciders: ['Alex Doe'] } });
    const file = legacyOnMain(w, w.shared, w.kb, legacy);
    write(file, makeRecord({ sections: { Context: 'Rewritten from the old text: cookies cap at 4 KB and sessions outgrow them.' } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('B4d: once the converted record is on the base, the lock applies', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.shared, w.kb, LEGACY_BARE);
    write(file, makeRecord());
    commitAll(w.kb, w.env, 'convert 0001');
    git(w.kb, w.env, 'checkout', '-q', 'main');
    git(w.kb, w.env, 'merge', '-q', '--ff-only', 'convert');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'later');
    write(file, makeRecord({ sections: { Decision: 'Sessions live in cookies.' } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /locked: section "Decision" changed/);
});

test('B4e: a converted legacy shared record in a local home warns; a new one fails', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.local, w.api, LEGACY_BARE);
    const sharedRecord = makeRecord({ prefix: 'api', fm: { blast_radius: 'shared' } });
    write(file, sharedRecord);
    const legacy = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
    assert.match(legacy.stdout, /home: warning: blast_radius shared belongs in the shared home; leave it here, or supersede it with a record there/);
    write(path.join(w.local, '0002-audit-log.md'), sharedRecord.replace(/0001/g, '0002'));
    const fresh = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(fresh.code, 1, fresh.stdout);
    assert.match(fresh.stdout, /0002-audit-log\.md: home: blast_radius shared belongs in the shared home/);
});

test('B4f: backfill skips a frontmatter-less record and says to convert it by rewriting', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), LEGACY_BARE);
    const r = runCli(w.root, w.env, 'backfill', w.shared);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /0001-session-storage\.md: skipped: no frontmatter: convert it by rewriting \(legacy records may be rewritten in place\)/);
    assert.equal(fs.readFileSync(path.join(w.shared, '0001-session-storage.md'), 'utf8'), LEGACY_BARE);
});

// B6: a legacy record with a locked status is not free text. Left unclassified it changes only
// by the five locked edits; the change that classifies it may rewrite its body, but its status
// moves only forward and the deciders it already records stay.
const LEGACY_ACCEPTED_FM = { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined, decided_by: undefined, deciders: ['Alex Doe'] };

test('B6a: an unclassified legacy accepted record changes only by the locked edits', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.local, w.api, makeRecord({ prefix: 'api', fm: LEGACY_ACCEPTED_FM }));
    write(file, makeRecord({ prefix: 'api', fm: LEGACY_ACCEPTED_FM, sections: { Decision: 'The API stores sessions in cookies.\n\n- **R1** Session state MUST be written to cookies.' } }));
    const rewritten = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(rewritten.code, 1, rewritten.stdout);
    assert.match(rewritten.stdout, /0001-session-storage\.md: locked: section "Decision" changed/);
    write(file, makeRecord({ prefix: 'api', fm: { ...LEGACY_ACCEPTED_FM, deciders: ['Mallory'] } }));
    const swapped = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(swapped.code, 1, swapped.stdout);
    assert.match(swapped.stdout, /locked: frontmatter deciders changed/);
    // A dated observation is still one of the five edits.
    write(file, makeRecord({ prefix: 'api', fm: LEGACY_ACCEPTED_FM, sections: { 'Later observations': '<!-- append-only, accepted records only; newest last -->\n- 2026-11-02 (PR 7): F1 still holds.' } }));
    const observed = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(observed.code, 0, observed.stdout + observed.stderr);
});

test('B6b: converting a legacy accepted record cannot move its status back or drop its deciders', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.local, w.api, makeRecord({ prefix: 'api', fm: LEGACY_ACCEPTED_FM }));
    write(file, makeRecord({ prefix: 'api', status: 'proposed', fm: { decided_by: [] }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nReopened 2026-10-09.' } }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.local);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /locked: status accepted -> proposed is not an allowed transition/);
    assert.match(r.stdout, /locked: decided_by cannot replace the deciders already recorded/);
});

test('B6c: converting a legacy accepted record in the shared home keeps its deciders and cannot reject it', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.shared, w.kb, makeRecord({ fm: LEGACY_ACCEPTED_FM }));
    write(file, makeRecord({ fm: { decided_by: ['Mallory'] }, sections: { Decision: 'Inverted.\n\n- **R1** Session state MUST be written to cookies.' } }));
    const swapped = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(swapped.code, 1, swapped.stdout);
    assert.match(swapped.stdout, /locked: decided_by cannot replace the deciders already recorded/);
    write(file, makeRecord({ status: 'rejected', fm: { decided_by: ['Mallory'] }, sections: { Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.\nRejected 2026-10-09 by Mallory: no.' } }));
    const rejected = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(rejected.code, 1, rejected.stdout);
    assert.match(rejected.stdout, /locked: status accepted -> rejected is not an allowed transition/);
    // Keeping the recorded decider, the body may be rewritten as the record is classified.
    write(file, makeRecord({ sections: { Context: 'Rewritten on conversion.' } }));
    const kept = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(kept.code, 0, kept.stdout + kept.stderr);
});

test('B6d: a frontmatter-less legacy record reads its status from ## Status; its conversion moves only forward', (t) => {
    const w = workspace(t);
    const bare = LEGACY_BARE.replace('Accepted 2025-03-01', 'Proposed 2024-02-01\naccepted 2024-03-01');
    const file = legacyOnMain(w, w.shared, w.kb, bare);
    write(file, makeRecord({ status: 'proposed', fm: { decided_by: [] }, sections: { Status: 'Proposed 2024-02-01.\nAccepted 2024-03-01.' } }));
    const back = runCli(w.root, w.env, 'check', '--ci', '--base', 'main', w.shared);
    assert.equal(back.code, 1, back.stdout);
    assert.match(back.stdout, /locked: status accepted -> proposed is not an allowed transition/);
    write(file, makeRecord());
    const kept = runCli(w.root, w.env, 'check', '--ci', '--base', 'main', w.shared);
    assert.equal(kept.code, 0, kept.stdout + kept.stderr);
});

test('B6e: an accepted frontmatter-less record cannot be renamed or deleted around its lock', (t) => {
    const w = workspace(t);
    const file = legacyOnMain(w, w.shared, w.kb, LEGACY_BARE);
    const renamed = path.join(path.dirname(file), file.endsWith('0001-session-storage.md') ? '0001-session-state.md' : '0001-renamed.md');
    fs.renameSync(file, renamed);
    write(renamed, makeRecord({ status: 'proposed', fm: { decided_by: [] }, sections: { Decision: 'Sessions live in cookies.' } }));
    const r = runCli(w.root, w.env, 'check', '--ci', '--base', 'main', w.shared);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /locked: a locked record is never deleted or renamed/);
    fs.rmSync(renamed);
    const d = runCli(w.root, w.env, 'check', '--ci', '--base', 'main', w.shared);
    assert.equal(d.code, 1, d.stdout);
    assert.match(d.stdout, /locked: a locked record is never deleted or renamed/);
});

// B5: an edit of an existing record is validated only by the knowledge-updater, in a worktree
// against the real base with its flags; a scratch copy (no base) misjudges these two cases.
function updaterWorktree(t, w, repo, branch, start) {
    const wt = path.join(tmpDir(t), 'wt');
    git(repo, w.env, 'update-ref', 'refs/remotes/origin/main', 'main');
    if (branch) git(repo, w.env, 'update-ref', `refs/remotes/origin/${branch}`, branch);
    git(repo, w.env, 'worktree', 'add', '-q', ...(start ? ['-b', 'adr-edit', wt, start] : ['--detach', wt, `origin/${branch}`]));
    return wt;
}

test('B5a: reject on a pr-branch: an incomplete high-tier proposal passes once in its final rejected form', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'empty');
    git(w.kb, w.env, 'checkout', '-q', '-b', 'knowledge/adr-0001-session-storage');
    const incomplete = {
        'Considered options': '- **Server-side store** — sessions can grow without a size cap.',
        'Assumptions and invalidation triggers': '- Assumes nothing.',
    };
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord({ status: 'proposed', sections: incomplete }));
    commitAll(w.kb, w.env, 'propose 0001');
    git(w.kb, w.env, 'checkout', '-q', 'main');
    const wt = updaterWorktree(t, w, w.kb, 'knowledge/adr-0001-session-storage');
    const home = path.join(wt, 'knowledge', 'adrs');
    const check = () => runCli(w.root, w.env, 'check', '--home', 'shared', '--base', 'origin/main', home);
    const before = check();
    assert.equal(before.code, 1, 'still proposed, the tier rules apply');
    assert.match(before.stdout, /high-tier:/);
    write(path.join(home, '0001-session-storage.md'), makeRecord({
        status: 'rejected',
        sections: { ...incomplete, Status: 'Proposed 2026-09-30.\nRejected 2026-10-09 by Alex Doe: cookies suffice for now.' },
    }));
    const r = check();
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('B5b: accepting an unclassified legacy proposal as shared in its local home passes against the base, with a home warning', (t) => {
    const w = workspace(t);
    const legacy = makeRecord({ prefix: 'api', status: 'proposed', fm: { id: undefined, reversibility: undefined, blast_radius: undefined, sensitivity: undefined, scope: undefined } });
    write(path.join(w.local, '0001-session-storage.md'), legacy);
    commitAll(w.api, w.env, 'legacy proposal');
    const converted = makeRecord({ prefix: 'api', fm: { blast_radius: 'shared' } });
    // The old accept step 2 linted the classified, still-proposed record in a scratch copy, which
    // has no base, so it cannot see the record is legacy: the wrong home is an error there.
    const scratch = path.join(tmpDir(t), 'adr');
    write(path.join(scratch, '0001-session-storage.md'), makeRecord({ prefix: 'api', status: 'proposed', fm: { blast_radius: 'shared' } }));
    const lost = runCli(w.root, w.env, 'check', '--home', 'local', '--repo', 'api', scratch);
    assert.equal(lost.code, 1, lost.stdout);
    assert.match(lost.stdout, /home: blast_radius shared belongs in the shared home/);
    const wt = updaterWorktree(t, w, w.api, null, 'origin/main');
    const file = path.join(wt, 'docs', 'adr', '0001-session-storage.md');
    write(file, converted);
    const r = runCli(w.root, w.env, 'check', '--home', 'local', '--repo', 'api', '--base', 'origin/main', path.dirname(file));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /home: warning: blast_radius shared belongs in the shared home; leave it here, or supersede it with a record there/);
});

test('B9a-3: --ci without --base is a usage error, so a CI job cannot drop the lock silently', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const r = runCli(w.root, w.env, 'check', '--ci', w.shared);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--ci needs --base <ref>/);
});

test('C1: select --json prints repo and candidates with kind adr and home', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.local, '0001-cache.md'), makeRecord({ prefix: 'api', fm: { scope: ['src/Sessions/**'] } }));
    const patch = path.join(w.root, 'change.patch');
    write(patch, 'diff --git a/src/Sessions/Store.cs b/src/Sessions/Store.cs\n--- a/src/Sessions/Store.cs\n+++ b/src/Sessions/Store.cs\n');
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch, '--json');
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.repo, 'api');
    assert.deepEqual(out.candidates.map((c) => [c.id, c.kind, c.home, c.status, c.reasons]), [
        ['api/ADR-0001', 'adr', 'local', 'accepted', ['scope']],
        ['kb/ADR-0001', 'adr', 'shared', 'accepted', ['scope']],
    ]);
    assert.match(out.candidates[0].file, /0001-cache\.md$/);
});

test('C1: select without --json still prints TSV', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/src/Sessions/Store.cs\n');
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch);
    assert.match(r.stdout, /^kb\/ADR-0001\taccepted\t[^\t]+\tscope$/m);
});

const COV = { checked: ['kb/ADR-0001'], notReviewed: [] };
const findingsDoc = (findings, coverage = COV) => JSON.stringify({ coverage, findings });
const contradiction = { class: 'contradiction', ids: ['kb/ADR-0001', 'kb/ADR-0001.R1'], where: 'src/Sessions/Store.cs:10', summary: 'caches sessions in memory' };

// A household with one accepted KB record whose scope matches the patch, and the patch file.
function verdictWorkspace(t) {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    w.patch = path.join(w.root, 'change.patch');
    write(w.patch, 'diff --git a/src/Sessions/Store.cs b/src/Sessions/Store.cs\n--- a/src/Sessions/Store.cs\n+++ b/src/Sessions/Store.cs\n');
    return w;
}
const verdict = (w, file, ...extra) => runCli(w.api, w.env, 'verdict', '--findings', file, '--diff', w.patch, '--repo', 'api', ...extra);

test('C3: verdict without --diff exits 2', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.json');
    write(file, findingsDoc([]));
    const r = runCli(w.api, w.env, 'verdict', '--findings', file, '--repo', 'api');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /needs --diff/);
});

test('C3: verdict exits 1 and reports one blocking finding, with coverage', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.json');
    write(file, findingsDoc([contradiction]));
    const r = verdict(w, file);
    assert.equal(r.code, 1, r.stderr);
    const v = JSON.parse(r.stdout);
    assert.equal(v.blocking, 1);
    assert.equal(v.findings[0].severity, 'critical');
    assert.deepEqual(Object.keys(v), ['blocking', 'counts', 'findings', 'coverage']);
    assert.deepEqual(v.coverage.extra, []);
});

test('C3: a selected record that is not attested exits 2', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.json');
    write(file, findingsDoc([], { checked: [], notReviewed: [] }));
    const r = verdict(w, file);
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stderr, /not checked/);
});

test('C3: a PR-body citation that resolves nowhere is added as a dangling finding that does not block', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.json');
    const body = path.join(w.root, 'body.md');
    write(file, findingsDoc([]));
    write(body, '## Decisions\n\nFollows kb/ADR-0042.\n');
    const r = verdict(w, file, '--pr-body', body);
    assert.equal(r.code, 0, r.stderr);
    const v = JSON.parse(r.stdout);
    assert.deepEqual(v.findings.map((x) => [x.class, x.ids, x.severity, x.blocking]), [['dangling', ['kb/ADR-0042'], 'important', false]]);
});

test('C3: verdict reads the block out of a full report file, not just bare JSON (the review writes the whole report)', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.md');
    write(file, [
        '## Contradictions with accepted records',
        `- caches sessions in memory, contradicting kb/ADR-0001.R1.`,
        '',
        '```adr-findings',
        findingsDoc([contradiction]),
        '```',
        '',
    ].join('\n'));
    const r = verdict(w, file);
    assert.equal(r.code, 1, r.stderr);
    const v = JSON.parse(r.stdout);
    assert.equal(v.blocking, 1);
});

test('C3: a report with no adr-findings block at all exits 2', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.md');
    write(file, [
        '## Contradictions with accepted records',
        'none',
        '',
        '## Triggers fired',
        'none',
        '',
    ].join('\n'));
    const r = verdict(w, file);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid JSON/);
});

test('C3: a findings file that does not exist exits 2 (CI fails closed when the review wrote none)', (t) => {
    const w = verdictWorkspace(t);
    const r = verdict(w, path.join(w.root, 'never-written.json'));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /cannot read --findings/);
});

test('C3: findings from stdin; invalid findings and missing --findings exit 2', (t) => {
    const w = verdictWorkspace(t);
    const CLI = path.join(__dirname, '..', 'adr-lint.js');
    const ok = spawnSync(process.execPath, [CLI, 'verdict', '--findings', '-', '--diff', w.patch, '--repo', 'api'], { cwd: w.api, env: w.env, input: findingsDoc([]), encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const bad = path.join(w.root, 'bad.json');
    write(bad, '{"coverage":{"checked":[],"notReviewed":[]},"findings":[{"class":"nope","ids":[],"summary":"x"}]}');
    const r = verdict(w, bad);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown class nope/);
    assert.equal(runCli(w.api, w.env, 'verdict').code, 2);
});

test('C3: --repo reaches verdict exactly as it reaches select (repo resolvable only through the flag)', (t) => {
    const w = verdictWorkspace(t);
    // From the household root there is no git repo to infer the repo from.
    const sel = runCli(w.root, w.env, 'select', '--repo', 'api', '--diff', w.patch, '--json');
    assert.equal(sel.code, 0, sel.stderr);
    const ids = JSON.parse(sel.stdout).candidates.map((c) => c.id);
    assert.deepEqual(ids, ['kb/ADR-0001']);
    const file = path.join(w.root, 'findings.json');
    write(file, findingsDoc([], { checked: ids, notReviewed: [] }));
    const run = () => runCli(w.root, w.env, 'verdict', '--findings', file, '--diff', w.patch, '--repo', 'api');
    assert.equal(run().code, 0);
    write(file, findingsDoc([], { checked: ids.slice(1), notReviewed: [] }));
    const r = run();
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not checked: kb\/ADR-0001/);
    assert.equal(runCli(w.root, w.env, 'verdict', '--findings', file, '--diff', w.patch).code, 2);
});

test('C3: single repo without a KB, record without id:, --repo differing from the directory name', (t) => {
    const base = tmpDir(t);
    const root = path.join(base, 'checkout');
    const env = gitEnv(base);
    initRepo(root, env);
    write(path.join(root, 'docs', 'adr', '0001-cache.md'), makeRecord({ prefix: 'svc', fm: { id: undefined } }));
    const patch = path.join(base, 'change.patch');
    write(patch, '+++ b/src/Sessions/Store.cs\n');
    const sel = runCli(root, env, 'select', '--repo', 'svc', '--diff', patch, '--json');
    assert.equal(sel.code, 0, sel.stderr);
    assert.deepEqual(JSON.parse(sel.stdout).candidates.map((c) => c.id), ['svc/ADR-0001']);
    const file = path.join(base, 'findings.json');
    write(file, JSON.stringify({ coverage: { checked: ['svc/ADR-0001'], notReviewed: [] }, findings: [] }));
    const r = runCli(root, env, 'verdict', '--findings', file, '--diff', patch, '--repo', 'svc');
    assert.equal(r.code, 0, r.stderr);
    write(file, JSON.stringify({
        coverage: { checked: [], notReviewed: [] },
        findings: [{ class: 'contradiction', ids: ['svc/ADR-0001.R1'], where: 'a:1', summary: 's' }],
    }));
    assert.equal(runCli(root, env, 'verdict', '--findings', file, '--diff', patch, '--repo', 'svc').code, 1);
});

test('C3: a selected missing id listed in coverage.checked does not exit 2', (t) => {
    const w = verdictWorkspace(t);
    const file = path.join(w.root, 'findings.json');
    const body = path.join(w.root, 'body.md');
    write(body, '## Decisions\n\nFollows kb/ADR-0042.\n');
    write(file, findingsDoc([], { checked: ['kb/ADR-0001', 'kb/ADR-0042'], notReviewed: [] }));
    const r = verdict(w, file, '--pr-body', body);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).findings.map((x) => x.class), ['dangling']);
});

test('C3: an unreadable record file exits 2 with the message, not a stack', (t) => {
    if (process.getuid && process.getuid() === 0) return t.skip('root ignores file modes');
    const w = verdictWorkspace(t);
    const rec = path.join(w.shared, '0001-session-storage.md');
    fs.chmodSync(rec, 0o000);
    t.after(() => { try { fs.chmodSync(rec, 0o644); } catch { /* already removed */ } });
    const file = path.join(w.root, 'findings.json');
    write(file, findingsDoc([]));
    const r = verdict(w, file);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /EACCES/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('C3: --findings - together with --diff - is a usage error', (t) => {
    const w = verdictWorkspace(t);
    const r = runCli(w.api, w.env, 'verdict', '--findings', '-', '--diff', '-', '--repo', 'api');
    assert.equal(r.code, 2);
    assert.match(r.stderr, /only one input may be stdin/);
});

test('select --json gives each candidate its title, description, scope and full record', (t) => {
    const w = workspace(t);
    const text = makeRecord();
    write(path.join(w.shared, '0001-session-storage.md'), text);
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/src/Sessions/Store.cs\n');
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch, '--json');
    assert.equal(r.code, 0, r.stderr);
    const [c] = JSON.parse(r.stdout).candidates;
    assert.equal(c.title, 'ADR-0001: Store sessions server-side');
    assert.equal(c.description, 'The API stores sessions server-side because payloads outgrow cookies.');
    assert.deepEqual(c.scope, ['api:src/Sessions/**']);
    assert.equal(c.record, text);
});

test('select --json gives a missing candidate empty reviewer context', (t) => {
    const w = workspace(t);
    const patch = path.join(w.root, 'change.patch');
    write(patch, '+++ b/src/Other.cs\n');
    const body = path.join(w.root, 'body.md');
    write(body, '## Decisions\n- Follows: kb/ADR-0042\n');
    const r = runCli(w.api, w.env, 'select', '--repo', 'api', '--diff', patch, '--pr-body', body, '--json');
    assert.equal(r.code, 0, r.stderr);
    const c = JSON.parse(r.stdout).candidates.find((x) => x.id === 'kb/ADR-0042');
    assert.equal(c.status, 'missing');
    assert.equal(c.home, null);
    assert.equal(c.title, '');
    assert.equal(c.description, '');
    assert.deepEqual(c.scope, []);
    assert.equal(c.record, '');
});

test('check validates a local behaviour home the household names', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'src', 'Devices', 'Status.cs'), 'class S {}\n');
    commitAll(w.api, w.env, 'code');
    const dir = path.join(w.api, 'docs', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const ok = runCli(w.root, w.env, 'check', dir);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.equal(ok.stdout, '');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api', sections: { 'Not yet decided': undefined } }));
    const bad = runCli(w.root, w.env, 'check', dir);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /device-status\.md: sections: needs a ## Not yet decided section/);
});

test('check --home shared recognises a dir named like the shared behaviour dir', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    // The own-home rule: kb/ refs resolve against the sibling adrs dir (here it holds ADR-0001).
    write(path.join(root, 'knowledge', 'adrs', '0001-session-storage.md'), makeRecord());
    const dir = path.join(root, 'knowledge', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ fm: { related: ['kb/ADR-0001'] }, sections: { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined } }));
    const r = runCli(root, env, 'check', '--home', 'shared', '--ci', '--base', 'main', dir);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, '');
});

test('a KB repo checking its own behaviour dir: a dangling kb/ ref is an error', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'knowledge', 'adrs', '0001-session-storage.md'), makeRecord());
    const dir = path.join(root, 'knowledge', 'behaviour');
    const doc = (src) => makeBehaviourDoc({ sections: { Rules: `### device.R1 One\nSHALL a.\n- Example: b\n- Source: ${src}`, 'Known deviations': undefined } });
    write(path.join(dir, 'device-status.md'), doc('kb/ADR-0042'));
    const bad = runCli(root, env, 'check', '--ci', '--home', 'shared', '--base', 'main', dir);
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /Source kb\/ADR-0042 does not exist/);
    write(path.join(dir, 'device-status.md'), doc('kb/ADR-0001.R1'));
    const ok = runCli(root, env, 'check', '--ci', '--home', 'shared', '--base', 'main', dir);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

test('--repo names the own local home: a dangling <repo>/ADR ref is an error', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'docs', 'adr', '0001-session-storage.md'), makeRecord({ prefix: 'webapp' }));
    write(path.join(root, 'src', 'Devices', 'Status.cs'), 'x');
    const dir = path.join(root, 'docs', 'behaviour');
    const doc = (src) => makeBehaviourDoc({ prefix: 'api', sections: { Rules: `### device.R1 One\nSHALL a.\n- Example: b\n- Source: ${src}`, 'Known deviations': undefined } });
    write(path.join(dir, 'device-status.md'), doc('webapp/ADR-0042'));
    const bad = runCli(root, env, 'check', '--home', 'local', '--repo', 'webapp', dir);
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /Source webapp\/ADR-0042 does not exist/);
    write(path.join(dir, 'device-status.md'), doc('webapp/ADR-0001.R1'));
    const ok = runCli(root, env, 'check', '--home', 'local', '--repo', 'webapp', dir);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
});

test('a dir configured as both an ADR home and a behaviour home is a usage error', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2, meta_repo: 'ws', knowledge_base: 'lore',
        repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api', behaviourDir: 'docs/adr' }],
    }));
    fs.mkdirSync(path.join(root, 'api', 'docs', 'adr'), { recursive: true });
    const r = runCli(root, env, 'check', path.join(root, 'api', 'docs', 'adr'));
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /is configured as both an ADR home and a behaviour home/);
});

test('a dead shared-home glob warns against a real sibling checkout', (t) => {
    const w = workspace(t);
    write(path.join(w.api, 'src', 'Devices', 'Status.cs'), 'class S {}\n');
    commitAll(w.api, w.env, 'code');
    const dir = path.join(w.kb, 'knowledge', 'behaviour');
    const rules = { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined };
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ fm: { scope: ['api:src/Nope/**'] }, sections: rules }));
    const r = runCli(w.root, w.env, 'check', dir);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /scope: warning: api:src\/Nope\/\*\* matches no tracked file/);
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ sections: rules }));
    assert.equal(runCli(w.root, w.env, 'check', dir).stdout, '');
});

test('a --repo override on a household local home reads that checkout, not the meta repo', (t) => {
    const w = workspace(t);
    write(path.join(w.api, 'src', 'Devices', 'Status.cs'), 'class S {}\n');
    commitAll(w.api, w.env, 'code');
    const dir = path.join(w.api, 'docs', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api', fm: { scope: ['src/Nope/**'] }, sections: { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined } }));
    const r = runCli(w.root, w.env, 'check', '--repo', 'other', dir);
    assert.match(r.stdout, /scope: warning: src\/Nope\/\*\* matches no tracked file/);
});

test('a household inside another git repo does not answer a local glob with that repo\'s files', (t) => {
    const outer = tmpDir(t);
    const env = gitEnv(outer);
    write(path.join(outer, 'README.md'), 'outer\n');
    initRepo(outer, env);
    commitAll(outer, env, 'outer');
    const root = path.join(outer, 'nested');
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2, meta_repo: 'ws', knowledge_base: 'lore',
        repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api' }],
    }));
    const dir = path.join(root, 'api', 'docs', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api', fm: { scope: ['src/Nope/**'] }, sections: { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined } }));
    const r = runCli(root, env, 'check', dir);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, '', 'api is not a checkout of its own: its globs are not checked');
});

test('trackedFiles returns names with quotes, backslashes and tabs unquoted', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    const names = ['a"b.txt', 'c\\d.txt', 'e\tf.txt'];
    for (const n of names) write(path.join(root, n), 'x');
    initRepo(root, env);
    commitAll(root, env, 'odd names');
    assert.deepEqual(require('../adr/git').trackedFiles(root).filter((n) => names.includes(n)).sort(), [...names].sort());
});

test('an ADR dir checked with --home is still read as ADRs', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const r = runCli(w.root, w.env, 'check', '--home', 'shared', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('a sibling that is not its own checkout skips the dead-glob warning', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2, meta_repo: 'ws', knowledge_base: 'lore', repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api' }],
    }));
    write(path.join(root, 'api', 'src', 'Devices', 'Status.cs'), 'class S {}\n');
    initRepo(root, env);
    commitAll(root, env, 'meta repo tracks api by accident');
    const dir = path.join(root, 'lore', 'knowledge', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({
        fm: { scope: ['api:src/Nope/**'] },
        sections: { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined },
    }));
    const r = runCli(root, env, 'check', dir);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /scope:/);
});

test('an absent own-home ADR dir makes a Source missing', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    // No knowledge/adrs at all: absent means missing, not unavailable.
    const dir = path.join(root, 'knowledge', 'behaviour');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ sections: { Rules: '### device.R1 One\nSHALL a.\n- Example: b\n- Source: kb/ADR-0042', 'Known deviations': undefined } }));
    const r = runCli(root, env, 'check', '--ci', '--home', 'shared', '--base', 'main', dir);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Source kb\/ADR-0042 does not exist/);
});

test('verdict blocks on a behaviour-rule finding for a selected doc, and select --json says kind behaviour', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const patch = path.join(w.root, 'p.patch');
    write(patch, 'diff --git a/src/Devices/Status.cs b/src/Devices/Status.cs\n--- a/src/Devices/Status.cs\n+++ b/src/Devices/Status.cs\n@@ -1 +1 @@\n-a\n+b\n');
    const sel = runCli(w.root, w.env, 'select', '--json', '--diff', patch, '--repo', 'api');
    assert.equal(sel.code, 0, sel.stderr);
    const c = JSON.parse(sel.stdout).candidates.find((x) => x.id === 'api/device');
    assert.equal(c.kind, 'behaviour');
    assert.equal(c.status, '-');
    assert.match(c.record, /### device\.R2 Project scoped/);
    const findings = path.join(w.root, 'f.json');
    write(findings, JSON.stringify({ coverage: { checked: ['api/device', 'kb/ADR-0001'], notReviewed: [] },
        findings: [{ class: 'behaviour-rule', ids: ['api/device.R2'], where: 'src/Devices/Status.cs:1', summary: 'lists other projects\' devices' }] }));
    const v = runCli(w.root, w.env, 'verdict', '--findings', findings, '--diff', patch, '--repo', 'api');
    assert.equal(v.code, 1, v.stdout + v.stderr);
    assert.equal(JSON.parse(v.stdout).findings[0].severity, 'critical');
});

const PATCH = 'diff --git a/src/Devices/Status.cs b/src/Devices/Status.cs\n--- a/src/Devices/Status.cs\n+++ b/src/Devices/Status.cs\n@@ -1 +1 @@\n-a\n+b\n';
const ONE_RULE = { Rules: '### device.R1 One\nSHALL a.\n- Example: b', 'Known deviations': undefined };

test('homes reports behaviour dirs and the shared one relative to the KB repo root', (t) => {
    const w = workspace(t);
    commitAll(w.kb, w.env, 'init');
    fs.mkdirSync(path.join(w.kb, 'knowledge', 'behaviour'), { recursive: true });
    fs.mkdirSync(path.join(w.api, 'docs', 'behaviour'), { recursive: true });
    const out = JSON.parse(runCli(w.root, w.env, 'homes').stdout);
    const api = out.localHomes.find((h) => h.repo === 'api');
    assert.equal(api.behaviourDir, path.join(w.api, 'docs', 'behaviour'));
    assert.equal(api.behaviourExists, true);
    assert.equal(out.sharedBehaviourHome, path.join(w.kb, 'knowledge', 'behaviour'));
    assert.equal(out.sharedBehaviourHomeExists, true);
    assert.equal(out.sharedBehaviourRelDir, 'knowledge/behaviour');
});

function patchIn(w) {
    const patch = path.join(w.root, 'p.patch');
    write(patch, PATCH);
    return patch;
}

test('two behaviour docs with one id are a selection error for select and verdict', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.api, 'docs', 'behaviour');
    write(path.join(dir, 'a-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    write(path.join(dir, 'b-other.md'), makeBehaviourDoc({ prefix: 'api', sections: { Rules: '### device.R3 Third\nSHALL x.\n- Example: y', 'Known deviations': undefined } }));
    const patch = patchIn(w);
    const sel = runCli(w.root, w.env, 'select', '--json', '--diff', patch, '--repo', 'api');
    assert.equal(sel.code, 2, sel.stdout + sel.stderr);
    assert.match(sel.stderr, /a-status\.md and .*b-other\.md both have id api\/device/);
    const f = path.join(w.root, 'f.json');
    write(f, JSON.stringify({ coverage: { checked: ['api/device'], notReviewed: [] }, findings: [] }));
    const v = runCli(w.root, w.env, 'verdict', '--findings', f, '--diff', patch, '--repo', 'api');
    assert.equal(v.code, 2, v.stdout + v.stderr);
});

test('a behaviour doc with no usable prefix blocks review only when its scope matches the diff', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.api, 'docs', 'behaviour');
    const patch = patchIn(w);
    for (const prefix of [['device', 'dev'], undefined]) {
        write(path.join(dir, 'a.md'), makeBehaviourDoc({ prefix: 'api', fm: { prefix } }));
        const r = runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api');
        assert.equal(r.code, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /a\.md has no usable prefix; fix it \(adr-lint check\) before review/);
    }
    write(path.join(dir, 'a.md'), makeBehaviourDoc({ prefix: 'api', fm: { prefix: undefined, scope: ['src/Other/**'] } }));
    const ok = runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api');
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    // A shared doc is matched through its `api:` scope.
    fs.rmSync(path.join(dir, 'a.md'));
    write(path.join(w.kb, 'knowledge', 'behaviour', 'x.md'), makeBehaviourDoc({ fm: { prefix: undefined } }));
    const shared = runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api');
    assert.equal(shared.code, 2, shared.stdout + shared.stderr);
    assert.match(shared.stderr, /x\.md has no usable prefix/);
});

test('a scoped doc with an uppercase prefix has no usable prefix', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'a.md'), makeBehaviourDoc({ prefix: 'api', fm: { prefix: 'Device' }, sections: ONE_RULE }));
    const patch = patchIn(w);
    const f = path.join(w.root, 'f.json');
    write(f, JSON.stringify({ coverage: { checked: [], notReviewed: [] }, findings: [{ class: 'stale-fact', ids: ['api/Device'], where: 'src/Devices/Status.cs:1', summary: 's' }] }));
    const v = runCli(w.root, w.env, 'verdict', '--findings', f, '--diff', patch, '--repo', 'api');
    assert.equal(v.code, 2, v.stdout + v.stderr);
    assert.match(v.stderr, /a\.md has no usable prefix/);
});

test('a single repo whose KB lives inside it lists a shared-and-local behaviour dir once', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ knowledgeBasePath: '.', behaviour: { localDir: 'knowledge/behaviour' } }));
    write(path.join(root, 'knowledge', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    initRepo(root, env);
    const patch = path.join(root, 'p.patch');
    write(patch, PATCH);
    const sel = runCli(root, env, 'select', '--json', '--diff', patch);
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    const ids = JSON.parse(sel.stdout).candidates.filter((c) => c.kind === 'behaviour').map((c) => c.id);
    assert.equal(ids.length, 1);
    assert.match(ids[0], /\/device$/);
    assert.doesNotMatch(ids[0], /^kb\//);
    const idx = JSON.parse(runCli(root, env, 'index', '--json').stdout);
    assert.deepEqual(idx.behaviour.map((d) => d.id), ids);
});

test('a duplicate behaviour id blocks only when one of the duplicates is selected', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.kb, 'knowledge', 'behaviour');
    write(path.join(dir, 'a.md'), makeBehaviourDoc({ fm: { scope: ['web:src/**'] } }));
    write(path.join(dir, 'b.md'), makeBehaviourDoc({ fm: { scope: ['web:lib/**'] } }));
    const patch = patchIn(w);
    const ok = runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api');
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    write(path.join(dir, 'b.md'), makeBehaviourDoc({ fm: { scope: ['api:src/Devices/**'] } }));
    const bad = runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api');
    assert.equal(bad.code, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /both have id kb\/device/);
});

// A patch touching each path once (a one-line edit), for diffs that touch behaviour docs.
function touchPatch(...paths) {
    return paths.map((p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`).join('');
}

function selectAndVerdict(w, patchText, checked = []) {
    const patch = path.join(w.root, 'p.patch');
    write(patch, patchText);
    const f = path.join(w.root, 'f.json');
    write(f, JSON.stringify({ coverage: { checked, notReviewed: [] }, findings: [] }));
    return {
        sel: runCli(w.root, w.env, 'select', '--diff', patch, '--repo', 'api'),
        ver: runCli(w.root, w.env, 'verdict', '--findings', f, '--diff', patch, '--repo', 'api'),
    };
}

test('D1: a doc whose own file the diff touches is selected, reason touched, whatever its scope', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api', fm: { scope: ['src/Other/**'] } }));
    const { sel, ver } = selectAndVerdict(w, touchPatch('docs/behaviour/device-status.md'));
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    assert.match(sel.stdout, /^api\/device\t-\t\S+device-status\.md\ttouched/m);
    assert.equal(ver.code, 2, ver.stdout + ver.stderr);
    assert.match(ver.stderr, /not checked: .*api\/device/);
    // In scope as well: both reasons.
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const both = selectAndVerdict(w, PATCH + touchPatch('docs/behaviour/device-status.md')).sel;
    assert.match(both.stdout, /^api\/device\t.*\tscope,touched$/m);
});

// File-level patches as git writes them: a deletion, an addition (with the doc's prefix line in
// the hunk) and a -M rename.
const delPatch = (p, prefix = 'device') => `diff --git a/${p} b/${p}\ndeleted file mode 100644\n--- a/${p}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n----\n-prefix: ${prefix}\n`;
const addPatch = (p, prefix = 'device') => `diff --git a/${p} b/${p}\nnew file mode 100644\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,2 @@\n+---\n+prefix: ${prefix}\n`;
const renamePatch = (from, to) => `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}\n`;
const GONE = /docs\/behaviour\/device-status\.md is (deleted by the diff|moved by the diff to \S+, which is not a doc in its home)/;

test('I1: a doc the patch deletes or moves out of being a doc exits 2, whatever the working tree holds', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.api, 'docs', 'behaviour');
    const from = 'docs/behaviour/device-status.md';
    const cases = {
        deleted: delPatch(from),
        'deleted, the working tree still on the base': delPatch(from),
        underscore: renamePatch(from, 'docs/behaviour/_device-status.md'),
        readme: renamePatch(from, 'docs/behaviour/README.md'),
        upper: renamePatch(from, 'docs/behaviour/device-status.MD'),
        subdir: renamePatch(from, 'docs/behaviour/devices/device-status.md'),
        'out of the home': renamePatch(from, 'docs/old/device-status.md'),
    };
    for (const [label, patch] of Object.entries(cases)) {
        fs.rmSync(dir, { recursive: true, force: true });
        if (label.includes('working tree')) write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
        const { sel, ver } = selectAndVerdict(w, PATCH + patch);
        assert.equal(sel.code, 2, `${label}: ${sel.stdout}${sel.stderr}`);
        assert.match(sel.stderr, GONE, label);
        assert.equal(ver.code, 2, `${label}: ${ver.stdout}${ver.stderr}`);
        assert.match(ver.stderr, GONE, label);
    }
});

test('I1/N1: a rename is read only from git\'s rename markers', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.api, 'docs', 'behaviour');
    write(path.join(dir, 'device-statuses.md'), makeBehaviourDoc({ prefix: 'api', fm: { scope: ['src/Other/**'] } }));
    const from = 'docs/behaviour/device-status.md';
    const to = 'docs/behaviour/device-statuses.md';
    const m = selectAndVerdict(w, renamePatch(from, to)).sel;
    assert.equal(m.code, 0, m.stdout + m.stderr);
    assert.match(m.stdout, /^api\/device\t-\t\S+device-statuses\.md\ttouched$/m);
    // --no-renames: a delete plus an add, even of the same doc, fails closed.
    const nr = selectAndVerdict(w, delPatch(from) + addPatch(to)).sel;
    assert.equal(nr.code, 2, nr.stdout + nr.stderr);
    assert.match(nr.stderr, /is deleted by the diff.*if this is a rename, produce the diff with rename detection \(git's default\)/);
    // A delete plus another doc whose body carries the same prefix line is not a rename either.
    const spoof = `${delPatch(from)}diff --git a/docs/behaviour/other.md b/docs/behaviour/other.md\n--- a/docs/behaviour/other.md\n+++ b/docs/behaviour/other.md\n@@ -5,0 +6,1 @@\n+prefix: device\n`;
    write(path.join(dir, 'other.md'), makeBehaviourDoc({ prefix: 'api', fm: { prefix: 'other', scope: ['src/Other/**'] } }));
    const sp = selectAndVerdict(w, spoof).sel;
    assert.equal(sp.code, 2, sp.stdout + sp.stderr);
});

test('M-a: deleting or editing a note (no frontmatter at line 1) is not a doc change', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const p = 'docs/behaviour/login.md';
    const del = `diff --git a/${p} b/${p}\ndeleted file mode 100644\n--- a/${p}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-# Login notes\n-Some notes.\n`;
    const d = selectAndVerdict(w, del);
    assert.equal(d.sel.code, 0, d.sel.stdout + d.sel.stderr);
    assert.equal(d.ver.code, 0, d.ver.stdout + d.ver.stderr);
    write(path.join(w.api, p), '# Login notes\nSome notes.\nx\n');
    const edit = `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,2 +1,3 @@\n # Login notes\n Some notes.\n+x\n`;
    const e = selectAndVerdict(w, edit);
    assert.equal(e.sel.code, 0, e.sel.stdout + e.sel.stderr);
    // An edit that strips a doc's frontmatter (removes a `---` line 1) is still a doc, and exits 2.
    write(path.join(w.api, p), '# Login notes\n');
    const strip = `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,3 +1,1 @@\n----\n-prefix: login\n----\n # Login notes\n`;
    const st = selectAndVerdict(w, strip).sel;
    assert.equal(st.code, 2, st.stdout + st.stderr);
    // So is a line inserted above a doc's `---`.
    write(path.join(w.api, p), `# Login notes\n${makeBehaviourDoc({ prefix: 'api', fm: { prefix: 'login' } })}`);
    const above = `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1,1 +1,2 @@\n+# Login notes\n ---\n`;
    assert.equal(selectAndVerdict(w, above).sel.code, 2);
    // A deletion whose first line is not in the patch (binary) still fails closed.
    const bin = `diff --git a/docs/behaviour/device-status.md b/docs/behaviour/device-status.md\ndeleted file mode 100644\nBinary files a/docs/behaviour/device-status.md and /dev/null differ\n`;
    assert.equal(selectAndVerdict(w, bin).sel.code, 2);
});

test('M-b: a copy is not a move; the source stays', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const copy = 'diff --git a/docs/behaviour/device-status.md b/docs/archive/device-status.md\nsimilarity index 100%\ncopy from docs/behaviour/device-status.md\ncopy to docs/archive/device-status.md\n';
    const { sel } = selectAndVerdict(w, copy);
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    assert.doesNotMatch(sel.stderr, /moved/);
});

test('I1: an added doc missing from the working tree, and planned --paths, do not exit 2', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    // An off-branch review of a PR that adds a doc: the doc is not on disk.
    const off = selectAndVerdict(w, PATCH + addPatch('docs/behaviour/events.md', 'events'), ['api/device', 'kb/ADR-0001']);
    assert.equal(off.sel.code, 0, off.sel.stdout + off.sel.stderr);
    assert.equal(off.ver.code, 0, off.ver.stdout + off.ver.stderr);
    // A plan names a doc it will create.
    const plan = runCli(w.root, w.env, 'select', '--paths', 'src/Devices/Status.cs,docs/behaviour/events.md', '--repo', 'api');
    assert.equal(plan.code, 0, plan.stdout + plan.stderr);
    assert.match(plan.stdout, /^api\/device\t/m);
});

test('I2b: a file in a behaviour home with no frontmatter is not a doc, unless the diff touches it', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const notes = path.join(w.api, 'docs', 'behaviour', 'notes.md');
    write(notes, '# notes\n');
    const ok = selectAndVerdict(w, PATCH, ['kb/ADR-0001']);
    assert.equal(ok.sel.code, 0, ok.sel.stdout + ok.sel.stderr);
    assert.equal(ok.ver.code, 0, ok.ver.stdout + ok.ver.stderr);
    // Touched where the patch does not show its first line, it is taken as a doc left unreadable.
    const deep = 'diff --git a/docs/behaviour/notes.md b/docs/behaviour/notes.md\n--- a/docs/behaviour/notes.md\n+++ b/docs/behaviour/notes.md\n@@ -5 +5 @@\n-a\n+b\n';
    const touched = selectAndVerdict(w, deep);
    assert.equal(touched.sel.code, 2, touched.sel.stdout + touched.sel.stderr);
    assert.match(touched.sel.stderr, /notes\.md: no frontmatter.*behaviour\.localDir \/ repos\[\]\.behaviourDir/);
    // Starting with --- (a BOM before it included) it is a doc that fails to parse: exit 2.
    write(notes, '﻿---\ntitle: x\n');
    const bom = selectAndVerdict(w, PATCH);
    assert.equal(bom.sel.code, 2, bom.sel.stdout + bom.sel.stderr);
    assert.match(bom.sel.stderr, /behaviour\.localDir \/ repos\[\]\.behaviourDir/);
});

test('M2: a Source record whose home is not on disk is neither selected nor missing', (t) => {
    const w = workspace(t);
    const hh = JSON.parse(fs.readFileSync(path.join(w.root, 'household.json'), 'utf8'));
    hh.repos.push({ name: 'web' });
    write(path.join(w.root, 'household.json'), JSON.stringify(hh));
    // web is declared but not checked out; the KB's adrs dir does not exist either.
    fs.rmSync(w.shared, { recursive: true, force: true });
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api',
        sections: { Rules: '### device.R1 One\nA read SHALL a.\n- Example: b\n- Source: web/ADR-0003, kb/ADR-0001.R1', 'Known deviations': undefined } }));
    const { sel, ver } = selectAndVerdict(w, PATCH, ['api/device']);
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    assert.doesNotMatch(sel.stdout, /ADR-/);
    assert.equal(ver.code, 0, ver.stdout + ver.stderr);
    assert.deepEqual(JSON.parse(ver.stdout).findings, []);
});

test('D1: a non-doc file in a behaviour home that the diff touches and that exists is not a doc', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'README.md'), '# Behaviour docs\n');
    write(path.join(w.api, 'docs', 'behaviour', '_template.md'), '# Template\n');
    const { sel } = selectAndVerdict(w, touchPatch('docs/behaviour/README.md', 'docs/behaviour/_template.md'));
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    assert.equal(sel.stdout, '');
});

test('D1: a touched doc with no usable prefix exits 2 even out of scope', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api', fm: { prefix: 'Device', scope: ['src/Other/**'] } }));
    const { sel } = selectAndVerdict(w, touchPatch('docs/behaviour/device-status.md'));
    assert.equal(sel.code, 2, sel.stdout + sel.stderr);
    assert.match(sel.stderr, /device-status\.md has no usable prefix/);
});

test('1: a doc whose scope or prefix cannot be read exits 2 for select and verdict, touched or not', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const file = path.join(w.api, 'docs', 'behaviour', 'device-status.md');
    const good = makeBehaviourDoc({ prefix: 'api' });
    const broken = {
        unclosed: good.replace(/\n---\n/, '\n\n'),
        bom: `﻿${good}`,
        'block scope': good.replace(/^scope: .*$/m, 'scope:\n  - src/Devices/**'),
        'duplicate prefix': good.replace(/^prefix: .*$/m, 'prefix: device\nprefix: dev'),
    };
    for (const [label, text] of Object.entries(broken)) {
        write(file, text);
        const { sel, ver } = selectAndVerdict(w, PATCH);
        assert.equal(sel.code, 2, `${label}: ${sel.stdout}${sel.stderr}`);
        assert.match(sel.stderr, /device-status\.md: .*cannot tell what it binds/, label);
        assert.equal(ver.code, 2, `${label}: ${ver.stdout}${ver.stderr}`);
    }
    assert.match(selectAndVerdict(w, PATCH).sel.stderr, /prefix/);
    write(file, broken.bom);
    assert.match(selectAndVerdict(w, PATCH).sel.stderr, /byte-order mark/);
    // A shared-home doc blocks every repo's review the same way.
    write(file, good);
    write(path.join(w.kb, 'knowledge', 'behaviour', 'x.md'), makeBehaviourDoc({ fm: { scope: ['web:src/**'] } }).replace(/\n---\n/, '\n\n'));
    assert.equal(selectAndVerdict(w, PATCH).sel.code, 2);
});

test('2: a directory named like a doc is skipped; a dangling symlink exits 2 for select and check', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const dir = path.join(w.api, 'docs', 'behaviour');
    fs.mkdirSync(path.join(dir, 'archive.md'), { recursive: true });
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const ok = selectAndVerdict(w, PATCH, ['api/device', 'kb/ADR-0001']);
    assert.equal(ok.sel.code, 0, ok.sel.stdout + ok.sel.stderr);
    assert.equal(ok.ver.code, 0, ok.ver.stdout + ok.ver.stderr);
    const chk = runCli(w.root, w.env, 'check', dir);
    assert.notEqual(chk.code, 2, chk.stdout + chk.stderr);
    fs.symlinkSync(path.join(w.root, 'nowhere.md'), path.join(dir, 'gone.md'));
    for (const r of [selectAndVerdict(w, PATCH).sel, selectAndVerdict(w, PATCH).ver, runCli(w.root, w.env, 'check', dir), runCli(w.root, w.env, 'index')]) {
        assert.equal(r.code, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /gone\.md/);
        assert.doesNotMatch(r.stderr, /\n\s+at /);
    }
});

test('D3: select adds the records a selected doc\'s rules name in Source:, reason source', (t) => {
    const w = workspace(t);
    // kb/ADR-0001's scope is api:src/Sessions/**, which the patch does not touch.
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const { sel, ver } = selectAndVerdict(w, PATCH, ['api/device']);
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    assert.match(sel.stdout, /^kb\/ADR-0001\taccepted\t\S+\tsource$/m);
    // It must be attested like any selected record.
    assert.equal(ver.code, 2, ver.stdout + ver.stderr);
    assert.match(ver.stderr, /not checked: kb\/ADR-0001/);
    assert.equal(selectAndVerdict(w, PATCH, ['api/device', 'kb/ADR-0001']).ver.code, 0);
    // Already selected by scope: one entry with both reasons.
    const both = selectAndVerdict(w, PATCH + touchPatch('src/Sessions/Store.cs')).sel;
    assert.match(both.stdout, /^kb\/ADR-0001\t.*\tscope,source$/m);
    assert.equal(both.stdout.match(/^kb\/ADR-0001\t/gm).length, 1);
});

test('D3: a Source record that resolves nowhere is missing and becomes a dangling finding', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api',
        sections: { Rules: '### device.R1 One\nA read SHALL a.\n- Example: b\n- Source: kb/ADR-0042.R1', 'Known deviations': undefined } }));
    const { sel, ver } = selectAndVerdict(w, PATCH, ['api/device']);
    assert.match(sel.stdout, /^kb\/ADR-0042\tmissing\t-\tsource$/m);
    assert.equal(ver.code, 0, ver.stdout + ver.stderr);
    const d = JSON.parse(ver.stdout).findings.find((x) => x.class === 'dangling');
    assert.deepEqual(d.ids, ['kb/ADR-0042']);
    assert.match(d.summary, /Source/);
});

test('D3: a Source record in another repo\'s home is read from there, not reported missing', (t) => {
    const w = workspace(t);
    const hh = JSON.parse(fs.readFileSync(path.join(w.root, 'household.json'), 'utf8'));
    hh.repos.push({ name: 'web' });
    write(path.join(w.root, 'household.json'), JSON.stringify(hh));
    write(path.join(w.root, 'web', 'docs', 'adr', '0003-session-storage.md'), makeRecord({ prefix: 'web', number: '0003' }));
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api',
        sections: { Rules: '### device.R1 One\nA read SHALL a.\n- Example: b\n- Source: web/ADR-0003', 'Known deviations': undefined } }));
    const patch = path.join(w.root, 'p.patch');
    write(patch, PATCH);
    const sel = runCli(w.root, w.env, 'select', '--json', '--diff', patch, '--repo', 'api');
    assert.equal(sel.code, 0, sel.stdout + sel.stderr);
    const c = JSON.parse(sel.stdout).candidates.find((x) => x.id === 'web/ADR-0003');
    assert.equal(c.status, 'accepted');
    assert.deepEqual(c.reasons, ['source']);
    assert.match(c.record, /## Decision/);
});

function verdictOn(w, findings, checked) {
    const patch = path.join(w.root, 'p.patch');
    write(patch, PATCH);
    const f = path.join(w.root, 'f.json');
    write(f, JSON.stringify({ coverage: { checked, notReviewed: [] }, findings }));
    return runCli(w.root, w.env, 'verdict', '--findings', f, '--diff', patch, '--repo', 'api');
}
const BREAK_R2 = (id) => [{ class: 'behaviour-rule', ids: [id], where: 'src/Devices/Status.cs:1', summary: 'lists other projects\' devices' }];

test('D5: a doc-local rule id is qualified when exactly one selected doc has its prefix', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const v = verdictOn(w, BREAK_R2('device.R2'), ['api/device', 'kb/ADR-0001']);
    assert.equal(v.code, 1, v.stdout + v.stderr);
    assert.deepEqual(JSON.parse(v.stdout).findings[0].ids, ['api/device.R2']);
});

test('D5: a doc-local rule id with no or several selected docs of that prefix exits 2', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const none = verdictOn(w, BREAK_R2('status.R2'), ['api/device', 'kb/ADR-0001']);
    assert.equal(none.code, 2, none.stdout + none.stderr);
    assert.match(none.stderr, /status\.R2 .*no selected behaviour doc has prefix status; write the qualified id/);
    write(path.join(w.kb, 'knowledge', 'behaviour', 'device-status.md'), makeBehaviourDoc());
    const two = verdictOn(w, BREAK_R2('device.R2'), ['api/device', 'kb/device', 'kb/ADR-0001']);
    assert.equal(two.code, 2, two.stdout + two.stderr);
    assert.match(two.stderr, /device\.R2 .*api\/device, kb\/device.*write the qualified id, e\.g\. api\/device\.R2/);
});

test('D5: a rule id in coverage.checked exits 2: checked takes doc ids, not rule ids', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(w.api, 'docs', 'behaviour', 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    for (const id of ['api/device.R2', 'device.R2', 'kb/ADR-0001.R1']) {
        const v = verdictOn(w, [], ['api/device', 'kb/ADR-0001', id]);
        assert.equal(v.code, 2, v.stdout + v.stderr);
        assert.match(v.stderr, new RegExp(`checked ${id.replace(/[./]/g, '\\$&')} is a rule id; checked takes record and doc ids, not rule ids`));
    }
});

test('3: check on an unrecognised folder of behaviour docs exits 2 and says how to configure it', (t) => {
    const w = workspace(t);
    const dir = path.join(w.api, 'spec', 'rules');
    write(path.join(dir, 'device-status.md'), makeBehaviourDoc({ prefix: 'api' }));
    const r = runCli(w.root, w.env, 'check', '--home', 'local', dir);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /spec\/rules looks like a behaviour home; configure behaviour\.localDir \/ repos\[\]\.behaviourDir, or pass --home with the configured name/);
    // A real ADR home with a stray note is still checked as one.
    write(path.join(w.local, '0001-session-storage.md'), makeRecord({ prefix: 'api', fm: { id: 'api/ADR-0001' } }));
    write(path.join(w.local, 'notes.md'), makeBehaviourDoc({ prefix: 'api' }));
    assert.notEqual(runCli(w.root, w.env, 'check', w.local).code, 2);
});

test('a selected doc with no ## Rules section as parsed exits 2 for select and verdict', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const file = path.join(w.api, 'docs', 'behaviour', 'device-status.md');
    const good = makeBehaviourDoc({ prefix: 'api' });
    for (const [label, text] of Object.entries({
        'unclosed fence': good.replace('## Rules', '```\n## Rules'),
        lowercase: good.replace('## Rules', '## rules'),
    })) {
        write(file, text);
        const { sel, ver } = selectAndVerdict(w, PATCH, ['api/device', 'kb/ADR-0001']);
        assert.equal(sel.code, 2, `${label}: ${sel.stdout}${sel.stderr}`);
        assert.match(sel.stderr, /device-status\.md has no ## Rules section; review cannot read its rules/, label);
        assert.equal(ver.code, 2, `${label}: ${ver.stdout}${ver.stderr}`);
    }
    // Out of scope and untouched, it is not selected and does not block.
    write(file, good.replace('## Rules', '## rules').replace(/^scope: .*$/m, 'scope: ["src/Other/**"]'));
    assert.equal(selectAndVerdict(w, PATCH, ['kb/ADR-0001']).sel.code, 0);
});

test('a keyless frontmatter error (an unparseable line) makes a doc unreadable', (t) => {
    const w = workspace(t);
    write(path.join(w.shared, '0001-session-storage.md'), makeRecord());
    const file = path.join(w.api, 'docs', 'behaviour', 'device-status.md');
    write(file, makeBehaviourDoc({ prefix: 'api' }).replace(/^scope: (.*)$/m, 'scope:$1'));
    const { sel, ver } = selectAndVerdict(w, PATCH);
    assert.equal(sel.code, 2, sel.stdout + sel.stderr);
    assert.match(sel.stderr, /device-status\.md: unparseable frontmatter line: scope:\[.*review cannot tell what it binds/);
    assert.equal(ver.code, 2, ver.stdout + ver.stderr);
});
