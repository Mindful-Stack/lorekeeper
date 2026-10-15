'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    tmpDir, write, gitEnv, git, initRepo, commitAll, runCli,
} = require('./helpers/adr-fixtures');
const Snap = require('../adr/snapshot');

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

// Distinguishes: a path containing a tab/newline (reachable via git's C-quoting, decoded by
// parsePatchPaths) must not be able to forge a second, attacker-chosen manifest line. Without
// escaping, `${path}\t${state}` would write the real line break and comma-split "src/a.cs" off
// as if it were its own, differently-stated entry.
test('control characters: a path with a tab/newline is unavailable and stays on one manifest line', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const patch = '--- "a/zz\\tabsent\\nsrc/a.cs"\n+++ "a/zz\\tabsent\\nsrc/a.cs"\n';
    const patchFile = path.join(root, 'change.patch');
    write(patchFile, patch);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patchFile, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    const dataLines = manifest.split('\n').slice(1).filter(Boolean);
    assert.equal(dataLines.length, 1);
    assert.equal(dataLines[0], `${JSON.stringify('zz\tabsent\nsrc/a.cs')}\tunavailable`);
    assert.ok(!manifest.includes('src/a.cs\tabsent'));
});

// Distinguishes: a NUL byte in a path (also reachable via C-quoting, `\000`) must never reach
// spawnSync's argv: Node throws synchronously on an embedded NUL, which (uncaught) used to take
// the whole process down with exit 1 instead of a clean, reported "unavailable".
test('NUL byte: a path containing NUL is unavailable, not a crash', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const patch = '--- "a/zz\\000bad"\n+++ "a/zz\\000bad"\n';
    const patchFile = path.join(root, 'change.patch');
    write(patchFile, patch);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patchFile, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    const dataLines = manifest.split('\n').slice(1).filter(Boolean);
    assert.equal(dataLines.length, 1);
    assert.match(dataLines[0], /\tunavailable$/);
});

// Distinguishes: a tree (directory) at base is refused outright, never confused with a blob by
// name-only presence; a real file nested under that same name still snapshots correctly (no
// ENOTDIR from the directory's wrongly-written content blocking the file's parent mkdir).
test('directory: a path that is a tree at base is unavailable; a file under it still snapshots', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'src', 'a.cs'), 'nested content\n');
    commitAll(root, env, 'add src/a.cs');
    const patch = patchFor(root, [['src', 'src'], ['src/a.cs', 'src/a.cs']]);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^src\tunavailable$/m);
    assert.match(manifest, /^src\/a\.cs\tpresent$/m);
    assert.equal(fs.readFileSync(path.join(out, 'src', 'a.cs'), 'utf8'), 'nested content\n');
});

// Distinguishes: a gitlink (submodule commit entry) is its own type, also refused, not a blob
// and not quietly skipped as absent. Built with plumbing (update-index --cacheinfo 160000,...)
// so the test needs no real submodule.
test('gitlink: a commit (submodule) entry at base is unavailable, not present', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const sha = 'a'.repeat(40);
    git(root, env, 'update-index', '--add', '--cacheinfo', `160000,${sha},modpath`);
    git(root, env, 'commit', '-q', '-m', 'add gitlink');
    const patch = patchFor(root, [['modpath', 'modpath']]);
    const out = path.join(root, 'out');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const manifest = fs.readFileSync(path.join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^modpath\tunavailable$/m);
    assert.ok(!fs.existsSync(path.join(out, 'modpath')));
});

// Direct unit tests on the exported guard predicates: these are the properties the brief calls
// out as load-bearing, pinned independently of git's own (incidental, version-dependent)
// refusal of out-of-repository pathspecs. Deleting a branch of `looksUnsafe`, or gutting
// `withinOut`'s comparison, fails one of these immediately.
test('looksUnsafe: absolute paths, .. segments (even internal ones) and control characters', () => {
    assert.equal(Snap.looksUnsafe('/etc/passwd'), true);
    assert.equal(Snap.looksUnsafe('../evil'), true);
    assert.equal(Snap.looksUnsafe('foo/../bar.txt'), true);
    assert.equal(Snap.looksUnsafe('zz\tabsent'), true);
    assert.equal(Snap.looksUnsafe('zz\u0000bad'), true);
    assert.equal(Snap.looksUnsafe('zz\u007fbad'), true);
    assert.equal(Snap.looksUnsafe('src/a.cs'), false);
});

test('withinOut: a path under --out is within it; its own ancestor or a sibling is not', () => {
    const out = path.join(path.sep, 'tmp', 'adr-snapshot-out');
    assert.equal(Snap.withinOut(out, out), true);
    assert.equal(Snap.withinOut(out, path.join(out, 'src')), true);
    assert.equal(Snap.withinOut(out, path.dirname(out)), false);
    assert.equal(Snap.withinOut(out, path.join(path.dirname(out), 'sibling')), false);
});

// Distinguishes: a pre-existing <out>/src *directory* symlink pointing outside --out must not
// be written through. Called at the module level (bypassing the CLI's "fresh --out" refusal,
// see Fix 4) specifically to pre-seed --out with the trap and still exercise withinOut.
test('symlink: a pre-existing <out>/src directory symlink pointing outside --out is not written through', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'src', 'a.cs'), 'base content\n');
    commitAll(root, env, 'add a.cs');
    const out = path.join(root, 'out');
    const escapeTarget = path.join(root, 'escape-target');
    fs.mkdirSync(out, { recursive: true });
    fs.mkdirSync(escapeTarget, { recursive: true });
    fs.symlinkSync(escapeTarget, path.join(out, 'src'));
    const counts = Snap.snapshot({
        root, base: 'main', paths: ['src/a.cs'], out, max: 200,
    });
    assert.equal(counts.unavailable, 1);
    assert.ok(!fs.existsSync(path.join(escapeTarget, 'a.cs')));
});

// Distinguishes: a pre-existing <out>/<path> *file* symlink pointing at a victim file outside
// --out must be dropped, not followed: fs.writeFileSync follows a symlink at the leaf by
// default, which would silently overwrite the victim instead of writing a fresh file under out.
test('symlink: a pre-existing <out>/<path> file symlink pointing at a victim file is dropped, not followed', (t) => {
    const { root, env } = repo(t);
    write(path.join(root, 'src', 'a.cs'), 'base content\n');
    commitAll(root, env, 'add a.cs');
    const out = path.join(root, 'out');
    const victim = path.join(root, 'victim.txt');
    fs.writeFileSync(victim, 'victim content\n');
    fs.mkdirSync(path.join(out, 'src'), { recursive: true });
    fs.symlinkSync(victim, path.join(out, 'src', 'a.cs'));
    const counts = Snap.snapshot({
        root, base: 'main', paths: ['src/a.cs'], out, max: 200,
    });
    assert.equal(counts.present, 1);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'victim content\n');
    assert.equal(fs.readFileSync(path.join(out, 'src', 'a.cs'), 'utf8'), 'base content\n');
    assert.ok(!fs.lstatSync(path.join(out, 'src', 'a.cs')).isSymbolicLink());
});

// Distinguishes: --out is refused when it already holds anything, so a stale or attacker-primed
// directory is never written into; and refusing never deletes what was already there.
test('non-empty --out is refused without touching it', (t) => {
    const { root, env } = repo(t);
    commitAll(root, env, 'empty');
    const patch = path.join(root, 'change.patch');
    write(patch, '');
    const out = path.join(root, 'out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'marker.txt'), 'keep me\n');
    const r = runCli(root, env, 'snapshot', '--diff', patch, '--base', 'main', '--out', out);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--out .* is not empty; pass a fresh directory/);
    assert.equal(fs.readFileSync(path.join(out, 'marker.txt'), 'utf8'), 'keep me\n');
});
