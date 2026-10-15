'use strict';

// adr-lint snapshot: writes the base-revision content of a patch's touched paths under --out,
// plus `--out/MANIFEST.tsv` recording every path's state (present/absent/skipped/unavailable).
// The security property this module exists to hold: nothing is ever written outside --out,
// however the path is spelled and however --out is arranged on disk.

const fs = require('fs');
const path = require('path');
const G = require('./git');

// A relative path with a `..` segment, or an absolute one, is refused outright: no git call,
// no fs touch. This alone stops `../evil` and `/etc/passwd`-shaped entries.
function looksUnsafe(relPath) {
    return path.isAbsolute(relPath) || relPath.split('/').some((seg) => seg === '..');
}

// `candidateReal` is inside `outReal` (or is it), both already realpath'd.
function withinOut(outReal, candidateReal) {
    const rel = path.relative(outReal, candidateReal);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Creates `relPath`'s parent under `outReal` and writes `buf` there — but only if the parent's
// realpath, taken *after* mkdir follows whatever is already on disk, still resolves inside
// `outReal`. A `<out>/src` symlink pointing elsewhere fails this check even though `relPath`
// itself (e.g. `src/a.cs`) is textually safe. Also refuses to write through an existing
// symlink at the leaf itself, by dropping it first. Any filesystem error here means the write
// did not happen, so the caller reports `unavailable`.
function writeUnderOut(outReal, relPath, buf) {
    const dest = path.join(outReal, relPath);
    const parent = path.dirname(dest);
    try {
        fs.mkdirSync(parent, { recursive: true });
        const parentReal = fs.realpathSync(parent);
        if (!withinOut(outReal, parentReal)) return false;
        const finalDest = path.join(parentReal, path.basename(dest));
        try {
            if (fs.lstatSync(finalDest).isSymbolicLink()) fs.unlinkSync(finalDest);
        } catch (e) {
            // ENOENT: nothing there yet, the common case.
        }
        fs.writeFileSync(finalDest, buf);
        return true;
    } catch (e) {
        return false;
    }
}

// One path's state: 'skipped' (beyond --max), 'unavailable' (unsafe path, or a git command
// failed, or the write itself was refused), 'absent' (not in the tree at `base`), or 'present'
// (written under `out`).
function classify(root, base, outReal, relPath, index, max) {
    if (index >= max) return 'skipped';
    if (looksUnsafe(relPath)) return 'unavailable';
    const presentAtBase = G.lsTreePresent(root, base, relPath);
    if (presentAtBase === null) return 'unavailable';
    if (!presentAtBase) return 'absent';
    const buf = G.showBuffer(root, base, relPath);
    if (buf === null) return 'unavailable';
    return writeUnderOut(outReal, relPath, buf) ? 'present' : 'unavailable';
}

// paths: unique, sorted, repo-relative paths (the caller does parsePatchPaths + sort/dedupe,
// since that is diff parsing, not snapshotting). Returns the per-state counts; writes the
// manifest and every present path's content as a side effect.
function snapshot({
    root, base, paths, out, max,
}) {
    fs.mkdirSync(out, { recursive: true });
    const outReal = fs.realpathSync(out);
    const counts = {
        present: 0, absent: 0, skipped: 0, unavailable: 0,
    };
    const manifest = [`# base ${base} head worktree`];
    paths.forEach((p, i) => {
        const state = classify(root, base, outReal, p, i, max);
        counts[state]++;
        manifest.push(`${p}\t${state}`);
    });
    fs.writeFileSync(path.join(out, 'MANIFEST.tsv'), `${manifest.join('\n')}\n`);
    return counts;
}

module.exports = { snapshot };
