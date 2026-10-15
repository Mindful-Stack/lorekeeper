'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    tmpDir, write, gitEnv, git, initRepo, commitAll, runCli,
} = require('./helpers/adr-fixtures');

// A one-repo fixture: no household, just a git repo to snapshot against.
function repo(t) {
    const root = tmpDir(t);
    const env = gitEnv(root);
    initRepo(root, env);
    return { root, env };
}

function patchFor(root, pairs) {
    const file = path.join(root, 'change.patch');
    write(file, pairs.map(([from, to]) => `--- a/${from}\n+++ b/${to}\n`).join(''));
    return file;
}

// Distinguishes: present/absent are classified correctly, and present content comes from the
// base commit, not whatever the worktree holds at snapshot time.
test('present + absent: base content for a path on main, absent for one that is not', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'src', 'a.cs'), 'original content\n');
    commitAll(root, env, 'add a.cs');
    const patch = patchFor(root, [['src/a.cs', 'src/a.cs'], ['src/new.cs', 'src/new.cs']]);
    // Modify the worktree copy after the commit, so a correct snapshot must ignore it.
    write(path.join(root, 'src', 'a.cs'), 'modified in worktree\n');
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^src\/a\.cs\tpresent$/m);
    assert.match(manifest, /^src\/new\.cs\tabsent$/m);
    assert.equal(fs.readFileSync(path.join(out, 'src', 'a.cs'), 'utf8'), 'original content\n');
    assert.ok(!fs.existsSync(path.join(out, 'src', 'new.cs')));
    const v = JSON.parse(r.stdout);
    assert.deepEqual(v.counts, { present: 1, absent: 1, skipped: 0, unavailable: 0 });
});

// Distinguishes: --max truncates in sorted order and a skipped path never reaches git or fs.
test('skipped: paths beyond --max are skipped and no file is written for them', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'a.txt'), 'A');
    write(path.join(root, 'b.txt'), 'B');
    write(path.join(root, 'c.txt'), 'C');
    commitAll(root, env, 'add three files');
    const patch = patchFor(root, [['a.txt', 'a.txt'], ['b.txt', 'b.txt'], ['c.txt', 'c.txt']]);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out, '--max', '2');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^a\.txt\tpresent$/m);
    assert.match(manifest, /^b\.txt\tpresent$/m);
    assert.match(manifest, /^c\.txt\tskipped$/m);
    assert.ok(!fs.existsSync(path.join(out, 'c.txt')));
    assert.equal(JSON.parse(r.stdout).counts.skipped, 1);
});

// Distinguishes: a textual traversal attempt is refused before any fs write, and nothing lands
// next to --out (not just "not inside the expected subfolder").
test('traversal: a path naming ../escape.txt is unavailable, nothing written next to --out', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const patch = patchFor(root, [['../escape.txt', '../escape.txt']]);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^\.\.\/escape\.txt\tunavailable$/m);
    assert.ok(!fs.existsSync(path.join(root, 'escape.txt')));
    assert.ok(!fs.existsSync(path.join(path.dirname(out), 'escape.txt')));
});

// Distinguishes: --base is resolved to a full sha (not left as the ref name "main"), and the
// manifest header names the fixed "head worktree" source.
test('header: first manifest line names the resolved base sha and head worktree', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const sha = git(root, env, 'rev-parse', 'main').trim();
    const patch = path.join(root, 'change.patch');
    write(patch, '');
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.equal(manifest.split('\n')[0], `# base ${sha} head worktree`);
    assert.equal(JSON.parse(r.stdout).base, sha);
});

// Distinguishes: an unresolvable --base and "no git repository at all" are two different usage
// errors, both failing closed with exit 2.
test('bad --base exits 2; running outside a git repository exits 2', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const patch = path.join(root, 'change.patch');
    write(patch, '');
    const out = path.join(root, 'out');
    const bad = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'nope', '--out', out);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /base ref nope not found/);

    const noRepo = tmpDir(t);
    const patch2 = path.join(noRepo, 'change.patch');
    write(patch2, '');
    const r = runCli(noRepo, env, 'snapshot', '--diff', patch2, '--base', 'main', '--out', path.join(noRepo, 'out'));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /git repository/);
});

// Distinguishes: the base content is read as bytes (spawnSync with no encoding), not decoded
// and re-encoded as UTF-8, which would mangle 0xff/0x80.
test('binary: snapshot bytes equal the committed bytes exactly', (t) => {
    const { root, env } = repo(t);
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x41]);
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'blob.bin'), bytes);
    commitAll(root, env, 'add binary');
    const patch = patchFor(root, [['assets/blob.bin', 'assets/blob.bin']]);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const got = fs.readFileSync(path.join(out, 'assets', 'blob.bin'));
    assert.ok(got.equals(bytes));
});

// Distinguishes: a textually-safe path can still escape --out through a pre-existing directory
// symlink; the realpath-after-mkdir check must catch that too, not just the textual one above.
test('symlink: a pre-existing <out>/src symlink pointing outside --out cannot be written through', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'src', 'a.cs'), 'base content\n');
    commitAll(root, env, 'add a.cs');
    const patch = patchFor(root, [['src/a.cs', 'src/a.cs']]);
    const out = path.join(root, 'out');
    const escapeTarget = path.join(root, 'escape-target');
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(escapeTarget, { recursive: true });
    fs.symlinkSync(escapeTarget, path.join(out, 'src'));
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^src\/a\.cs\tunavailable$/m);
    assert.ok(!fs.existsSync(path.join(escapeTarget, 'a.cs')));
});
