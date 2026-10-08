'use strict';

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

function gitRoot(dir) {
    const out = git(dir, ['rev-parse', '--show-toplevel']);
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

module.exports = { gitRoot, revExists, mergeBase, showFile, listDir, changedFiles, originUrl };
