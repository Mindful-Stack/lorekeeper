'use strict';

// adr-lint snapshot: writes the base-revision content of a patch's touched paths under --out,
// plus `--out/MANIFEST.tsv` recording every path's state (present/absent/skipped/unavailable).
// The security property this module exists to hold: nothing is ever written outside --out,
// however the path is spelled and however --out is arranged on disk.

const fs = require('fs');
const path = require('path');
const G = require('./git');

// A control character (0x00-0x1f, 0x7f) in a path is refused on its own: a NUL would make
// spawnSync throw synchronously (git's argv is a C string), and a tab or newline would, if
// written straight into the manifest, forge a second, attacker-chosen manifest line.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

// A relative path with a `..`, `.` or empty segment (the last also catches a leading or
// trailing slash, and a doubled one, since split('/') puts an empty string either side of it),
// an absolute path, or one holding a control character, is refused outright: no git call, no
// fs touch. Only a canonical path is accepted, because git's own pathspec matching normalizes
// `.`/`..` away (see `lsTreeEntry`'s exact-match check below) — a non-canonical spelling must
// never be treated as if it named whatever git resolved it to. Exported for direct unit tests:
// the property this guards does not depend on git also happening to refuse the same path (it
// sometimes does not).
function looksUnsafe(relPath) {
    if (path.isAbsolute(relPath) || CONTROL_CHAR_RE.test(relPath)) return true;
    return relPath.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}

// A manifest path field: plain when it is printable, does not start with `"` (which would
// otherwise be read back as the start of a JSON-escaped field) and does not start with `#`
// (which would otherwise be mistaken for the header line); JSON-escaped otherwise, so a control
// character never becomes a stray line break or tab inside the manifest, and a path that
// happens to start with a literal `"` or `#` cannot be confused with those two other meanings.
function manifestField(p) {
    return CONTROL_CHAR_RE.test(p) || p.startsWith('"') || p.startsWith('#') ? JSON.stringify(p) : p;
}

// `candidateReal` is inside `outReal` (or is it), both already realpath'd. Exported alongside
// `looksUnsafe` for direct unit tests of the two guards that together hold the containment
// property, independent of whatever git itself does or does not accept.
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

// One path's state: 'skipped' (beyond --max), 'unavailable' (unsafe path, a git command failed,
// ls-tree resolved the pathspec to a different name than the one asked for, the entry at
// `base` is not a blob — a tree/directory or a commit/gitlink — or the write itself was
// refused), 'absent' (not in the tree at `base`), or 'present' (written under `out`).
function classify(root, base, outReal, relPath, index, max) {
    if (index >= max) return 'skipped';
    if (looksUnsafe(relPath)) return 'unavailable';
    const entry = G.lsTreeEntry(root, base, relPath);
    if (entry === null || entry === 'mismatch') return 'unavailable';
    if (entry === 'absent') return 'absent';
    if (entry.type !== 'blob') return 'unavailable';
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
        manifest.push(`${manifestField(p)}\t${state}`);
    });
    fs.writeFileSync(path.join(out, 'MANIFEST.tsv'), `${manifest.join('\n')}\n`);
    return counts;
}

module.exports = { snapshot, looksUnsafe, withinOut };
