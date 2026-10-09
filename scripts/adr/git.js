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

// The remote default branch's name, or null. `origin/HEAD` is often unset in a clone, so fall
// back to whichever of origin/main and origin/master exists.
function defaultBranch(root) {
    const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (head !== null && head.trim().startsWith('origin/')) return head.trim().slice('origin/'.length);
    for (const name of ['main', 'master']) if (revExists(root, `origin/${name}`)) return name;
    return null;
}

module.exports = {
    gitRoot, revExists, mergeBase, showFile, listDir, changedFiles, originUrl, repoName, defaultBranch,
};
