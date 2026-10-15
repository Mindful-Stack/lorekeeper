'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Output must not depend on the caller's git config: quotepath would escape non-ASCII
// names, and rename detection would hide the old name of a moved file.
const PINNED = ['-c', 'core.quotepath=off'];

function git(cwd, args) {
    const r = spawnSync('git', [...PINNED, ...args], { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
}

function lines(s) {
    return s === null ? [] : s.split('\n').filter((l) => l !== '');
}

// The repository holding `dir`, which need not exist yet (an empty home): git runs from its
// nearest existing ancestor.
function gitRoot(dir) {
    let cwd = path.resolve(dir);
    while (!fs.existsSync(cwd) && path.dirname(cwd) !== cwd) cwd = path.dirname(cwd);
    const out = git(cwd, ['rev-parse', '--show-toplevel']);
    return out === null ? null : out.trim();
}

function revExists(root, ref) {
    return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
}

function mergeBase(root, ref) {
    const out = git(root, ['merge-base', ref, 'HEAD']);
    return out === null ? null : out.trim();
}

// `relPath` is repo-relative with forward slashes. Null when the file is absent at `ref`.
function showFile(root, ref, relPath) {
    return git(root, ['show', `${ref}:${relPath}`]);
}

function listDir(root, ref, relDir) {
    return lines(git(root, ['ls-tree', '--name-only', `${ref}:${relDir}`]));
}

// The full sha of a commit-ish, so a snapshot keeps naming the exact commit it read even if
// `ref` (a branch) later moves. Null when `ref` does not resolve to a commit.
function fullSha(root, ref) {
    const out = git(root, ['rev-parse', `${ref}^{commit}`]);
    return out === null ? null : out.trim();
}

// The single tree entry for `relPath` at `ref`: the full `ls-tree` line (not --name-only), read
// with `-z` (NUL-terminated entries, paths never C-quoted) so a path with an unusual byte is
// read back exactly rather than guessed at by splitting on `\n`. git's own pathspec matching
// normalizes a `.`/`..` in the path before matching (e.g. `a/../b` resolves to `b`), so the
// entry's own name field is checked against `relPath` verbatim: only an exact match is
// accepted, letting the caller tell a blob from a tree (a directory) or a commit (a gitlink),
// each needing a different outcome. Returns `{ mode, type, sha }` on an exact match, the string
// `'absent'` when ls-tree printed nothing, the string `'mismatch'` when it printed an entry
// whose name is not `relPath`, or null when the git command itself failed.
function lsTreeEntry(root, ref, relPath) {
    const out = git(root, ['ls-tree', '-z', ref, '--', relPath]);
    if (out === null) return null;
    const entry = out.split('\0').find((e) => e !== '');
    if (!entry) return 'absent';
    const m = /^(\d+) (\S+) (\S+)\t([\s\S]*)$/.exec(entry);
    if (!m || m[4] !== relPath) return 'mismatch';
    return { mode: m[1], type: m[2], sha: m[3] };
}

// Like showFile, but the exact bytes git stored: spawnSync with no `encoding`, so a binary
// blob is not mangled by a decode/re-encode round trip through a string. Null on failure.
function showBuffer(root, ref, relPath) {
    const r = spawnSync('git', [...PINNED, 'show', `${ref}:${relPath}`], { cwd: root });
    return r.status === 0 ? r.stdout : null;
}

// Files changed between `ref` and the working tree, plus untracked files, so the result is
// the same in CI (clean checkout) and in a local run before committing.
function changedFiles(root, ref) {
    const tracked = lines(git(root, ['diff', '--name-only', '--no-renames', ref]));
    const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard']));
    return [...new Set([...tracked, ...untracked])];
}

function originUrl(root) {
    const out = git(root, ['remote', 'get-url', 'origin']);
    return out === null ? null : out.trim();
}

// The repository's name, the same from every worktree: origin's last path segment, else the
// main worktree's directory (a linked worktree's own name is arbitrary), else `root`'s name.
function repoName(root) {
    const url = originUrl(root);
    const fromUrl = url && url.replace(/[/\\]+$/, '').replace(/\.git$/, '').split(/[/:\\]/).pop();
    if (fromUrl) return fromUrl;
    const common = git(root, ['rev-parse', '--git-common-dir']);
    const dir = common === null ? null : path.resolve(root, common.trim());
    if (dir && path.basename(dir) === '.git') return path.basename(path.dirname(dir));
    return path.basename(root);
}

// The remote default branch's name, or null when it cannot be known. A clone's `origin/HEAD`
// may be unset, so ask origin itself (read-only); never guess from origin/main or master.
function defaultBranch(root) {
    const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (head !== null && head.trim().startsWith('origin/')) return head.trim().slice('origin/'.length);
    // No prompt and a time limit, so an offline or credential-gated remote fails instead of hanging.
    const r = spawnSync('git', [...PINNED, 'ls-remote', '--symref', 'origin', 'HEAD'], {
        cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const m = r.status === 0 && /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(r.stdout);
    return m ? m[1] : null;
}

// The ADR-Exempt trailer values on the commits this branch adds over `ref`
// (`git log --help`, PRETTY FORMATS, %(trailers:key=…,valueonly,unfold)).
function exemptTrailers(root, ref) {
    const mb = mergeBase(root, ref);
    if (!mb) return null;
    const output = git(root, ['log', '--format=%(trailers:key=ADR-Exempt,valueonly,unfold)', `${mb}..HEAD`]);
    if (output === null) return null;
    return lines(output);
}

module.exports = {
    gitRoot, revExists, mergeBase, showFile, listDir, changedFiles, originUrl, repoName, defaultBranch, exemptTrailers,
    fullSha, lsTreeEntry, showBuffer,
};
