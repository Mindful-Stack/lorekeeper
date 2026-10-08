'use strict';

// Deterministic candidate selection for review: the records whose scope matches a diff's
// paths, plus the records a PR cites in its Decisions section.

const { matchesGlob } = require('./glob');

// Paths on the --- / +++ lines. Prefixes are a heuristic, since a patch does not say which it
// used: git's default `a/` `b/`, mnemonic prefixes (`i/` `w/` `c/` `o/`) and --no-prefix are
// all read. A `diff --git X Y` header whose two sides start with *different* one-letter
// prefixes marks a prefixed block; a header without them (or with the same letter on both
// sides, as a top-level one-letter directory gives under --no-prefix) marks an unprefixed one.
// Without a header, a leading `[a-z]/` is taken as a prefix.
function parsePatchPaths(patch) {
    const paths = new Set();
    let prefixed = true;
    for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
        if (line.startsWith('diff --git ')) {
            const h = /^diff --git ([a-z])\/.* ([a-z])\/.*$/.exec(line);
            prefixed = !!h && h[1] !== h[2];
            continue;
        }
        const m = /^(?:\+\+\+|---) (.+?)\t?$/.exec(line);
        if (!m || m[1] === '/dev/null') continue;
        paths.add(prefixed ? m[1].replace(/^[a-z]\//, '') : m[1]);
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
