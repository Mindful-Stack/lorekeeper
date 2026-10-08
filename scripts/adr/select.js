'use strict';

// Deterministic candidate selection for review: the records whose scope matches a diff's
// paths, plus the records a PR cites in its Decisions section.

const { matchesGlob } = require('./glob');

const PREFIX = /^[a-z]\//;
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

// git C-quotes a path with special characters (core.quotepath, on by default): "a/src/\303\251.cs".
// Reads such a string at the start of `s` and returns { value, rest }, or null when `s` does
// not start with one. Octal escapes are bytes, so a multi-byte UTF-8 character decodes whole.
function readQuoted(s) {
    if (s[0] !== '"') return null;
    const bytes = [];
    let i = 1;
    while (i < s.length) {
        const c = s[i];
        if (c === '"') return { value: Buffer.from(bytes).toString('utf8'), rest: s.slice(i + 1) };
        if (c === '\\') {
            const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1));
            if (oct) {
                bytes.push(parseInt(oct[0], 8));
                i += 1 + oct[0].length;
            } else {
                const e = s[i + 1];
                if (e in C_ESCAPES) bytes.push(C_ESCAPES[e]);
                else bytes.push(...Buffer.from(e || '', 'utf8'));
                i += 2;
            }
            continue;
        }
        const run = /^[^"\\]+/.exec(s.slice(i))[0];
        bytes.push(...Buffer.from(run, 'utf8'));
        i += run.length;
    }
    return null;
}

// A whole path token: C-quoted, or taken as it is.
function pathToken(s) {
    const q = readQuoted(s);
    return q && q.rest === '' ? q.value : s;
}

// A `diff --git X Y` pair is prefixed when both sides start with *different* one-letter
// prefixes (`a/` `b/`, or mnemonic `i/` `w/` `c/` `o/`); the same letter on both sides is a
// top-level one-letter directory under --no-prefix.
function isPrefixed(x, y) {
    return PREFIX.test(x) && PREFIX.test(y) && x[0] !== y[0];
}

// The two paths of a `diff --git X Y` header, or null when spaces make the split ambiguous
// (a rename between paths with spaces; its `rename from` / `rename to` lines say it plainly).
// Of the possible splits, the one whose two sides name the same path wins; a single space is
// the only split there is.
function splitGitHeader(rest) {
    const side = (x, y) => {
        const prefixed = isPrefixed(x, y);
        return { prefixed, from: prefixed ? x.slice(2) : x, to: prefixed ? y.slice(2) : y };
    };
    const first = readQuoted(rest);
    if (first && first.rest.startsWith(' ')) return side(first.value, pathToken(first.rest.slice(1)));
    if (rest.endsWith('"')) {
        for (let i = 0; i < rest.length; i++) {
            const q = rest[i] === ' ' && readQuoted(rest.slice(i + 1));
            if (q && q.rest === '') return side(rest.slice(0, i), q.value);
        }
    }
    const spaces = [];
    for (let i = 0; i < rest.length; i++) if (rest[i] === ' ') spaces.push(i);
    const splits = spaces.map((i) => side(rest.slice(0, i), rest.slice(i + 1)));
    return splits.find((sp) => sp.from === sp.to) || (splits.length === 1 ? splits[0] : null);
}

// Every path a patch touches, for matching scope globs, with git C-quoted paths decoded
// (readQuoted). Read from file headers only:
//   - `diff --git X Y` (both sides), so renames, binary and mode-only changes count;
//   - `rename from` / `rename to` / `copy from` / `copy to` in the extended header;
//   - `---` / `+++` lines, which also cover patches with no `diff` lines (`diff -u`).
// Prefixes are a heuristic, since a patch does not say which it used: the `diff --git` header
// decides for its block (see isPrefixed); without one, a leading `[a-z]/` is a prefix.
// Each `@@ -a,b +c,d @@` header gives the hunk's old and new line counts (1 when `,b` / `,d` is
// omitted), so a removed `-- …` or added `++ …` line inside a hunk is content, and the next
// file's headers are read even without `diff` lines. Any `diff ` line ends a hunk. A tab and
// what follows it (the timestamp `diff -u` writes) is not part of a `---` / `+++` path.
function parsePatchPaths(patch) {
    const paths = new Set();
    let prefixed = true;
    let oldLeft = 0;
    let newLeft = 0;
    for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
        if (line.startsWith('diff ')) {
            oldLeft = 0;
            newLeft = 0;
            prefixed = true;
            if (line.startsWith('diff --git ')) {
                const sp = splitGitHeader(line.slice('diff --git '.length));
                if (sp) {
                    prefixed = sp.prefixed;
                    paths.add(sp.from);
                    paths.add(sp.to);
                } else {
                    const h = /^diff --git ([a-z])\/.* ([a-z])\/.*$/.exec(line);
                    prefixed = !!h && h[1] !== h[2];
                }
            }
            continue;
        }
        if (oldLeft > 0 || newLeft > 0) {
            if (line.startsWith('-')) oldLeft--;
            else if (line.startsWith('+')) newLeft--;
            else if (!line.startsWith('\\')) {
                oldLeft--;
                newLeft--;
            }
            continue;
        }
        if (line.startsWith('@@')) {
            const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
            // A malformed hunk header: treat the rest of the file as hunk content.
            oldLeft = m ? (m[1] === undefined ? 1 : Number(m[1])) : Infinity;
            newLeft = m ? (m[2] === undefined ? 1 : Number(m[2])) : Infinity;
            continue;
        }
        const moved = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
        if (moved) {
            paths.add(pathToken(moved[1]));
            continue;
        }
        const m = /^(?:\+\+\+|---) (.+)$/.exec(line);
        if (!m) continue;
        const q = readQuoted(m[1]);
        const file = q ? q.value : m[1].replace(/\t.*$/, '');
        if (file === '/dev/null') continue;
        paths.add(prefixed ? file.replace(PREFIX, '') : file);
    }
    return [...paths];
}

function parseCitedIds(prBody) {
    const lines = prBody.replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex((l) => /^#{1,6}\s+Decisions\s*$/.test(l));
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const stop = rest.findIndex((l) => /^#{1,6}\s/.test(l));
    const text = (stop === -1 ? rest : rest.slice(0, stop)).join('\n');
    return [...new Set(text.match(/[A-Za-z0-9._-]+\/ADR-\d{4}/g) || [])];
}

// candidates: [{ id, kind: 'local'|'shared', status, file, scope: string[] }]
// Returns [{ id, status, file, reasons: ['scope'|'cited'] }], sorted by id.
function select({ candidates, repo, paths, cited }) {
    const out = [];
    for (const c of candidates) {
        const reasons = [];
        const globs = c.kind === 'local'
            ? c.scope
            : c.scope
                .filter((s) => s.startsWith(`${repo}:`))
                .map((s) => s.slice(repo.length + 1));
        if (paths.some((p) => globs.some((g) => matchesGlob(p, g)))) reasons.push('scope');
        if (cited.includes(c.id)) reasons.push('cited');
        if (reasons.length) out.push({ id: c.id, status: c.status, file: c.file, reasons });
    }
    // A cited id that resolves nowhere is reported, not dropped: the reviewer must see it.
    for (const id of cited) {
        if (!candidates.some((c) => c.id === id)) out.push({ id, status: 'missing', file: '', reasons: ['cited'] });
    }
    // Codepoint order, not locale order: Plan C parses this output.
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = { parsePatchPaths, parseCitedIds, select };
