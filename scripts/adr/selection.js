'use strict';

// Candidate selection shared by `adr-lint select` and `adr-lint verdict`, so the records a
// review must cover are computed once, the same way, by both.

const fs = require('fs');
const path = require('path');
const { asList, isEmpty } = require('./frontmatter');
const R = require('./records');
const B = require('./behaviour');
const H = require('./homes');
const G = require('./git');
const { matchesGlob, toPosix } = require('./glob');
const { parsePatchPaths, patchFiles, parseCitedIds, select } = require('./select');

class SelectionError extends Error {}

// The doc files the diff touches, from each behaviour home inside this repo's checkout, decided
// from the patch, not the working tree (an off-branch review has the base on disk). A doc the
// patch deletes, or moves to a path that is not a doc in the same home, throws: its rules would
// silently stop binding the PR that removes them. A rename written without -M (a delete plus an
// add of a doc in the same home with the same `prefix:`) is a rename. Planned paths (`--paths`)
// are never checked for absence: a plan may create a doc.
function touchedDocs(homes, repo, dirs, { paths, files }) {
    const repoDir = homes.mode === 'single' ? homes.root : path.join(homes.root, repo);
    const rels = dirs.map((dir) => ({ dir, rel: toPosix(path.relative(repoDir, dir)) }))
        .filter(({ rel }) => rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    // The home and file of a doc-shaped repo path, or null.
    const docAt = (p) => {
        for (const { dir, rel } of rels) {
            const name = p && p.startsWith(`${rel}/`) ? p.slice(rel.length + 1) : null;
            if (name && !name.includes('/') && B.isDocName(name)) return { dir, file: path.join(dir, name) };
        }
        return null;
    };
    const gone = (from, how) => new SelectionError(`behaviour doc ${from} is ${how}; review cannot judge rules it no longer sees. Retiring a doc needs the admin bypass`);
    for (const f of files || []) {
        const old = f.from && docAt(f.from);
        if (!old || f.to === f.from) continue;
        if (f.to) {
            const now = docAt(f.to);
            if (!now || now.dir !== old.dir) throw gone(f.from, `moved by the diff to ${f.to}, which is not a doc in its home`);
            continue;
        }
        const readded = files.some((g) => g !== f && g.to && (docAt(g.to) || {}).dir === old.dir
            && g.prefixes.added.some((x) => f.prefixes.removed.includes(x)));
        if (!readded) throw gone(f.from, 'deleted by the diff');
    }
    const out = new Set();
    for (const p of files ? files.map((f) => f.to) : paths) {
        const hit = docAt(p);
        if (!hit) continue;
        try {
            fs.lstatSync(hit.file);
            out.add(hit.file);
        } catch (e) {
            // Not on disk: an off-branch review of a PR that adds it, or a planned doc.
        }
    }
    return out;
}

// The records a selected doc's rules name in `Source:` bind the same diff: each is selected
// (reason `source`) so the reviewer reads it and must attest it. A record in a home select does
// not load (another repo's) is read from there. As in `check`, a home that is not on disk is
// unavailable: its records are not selected and not missing. Only a record its available home
// does not have is `missing`.
function addSources({ homes, local, candidates, picked }) {
    const ids = new Set();
    for (const p of picked.filter((x) => x.doc === 'behaviour' && x.file)) {
        for (const h of B.parseDoc(p.file, candidates.find((c) => c.file === p.file).text).headings) {
            for (const s of h.sources) {
                const m = /^([A-Za-z0-9._-]+\/ADR-\d{4})(?:\.R\d+)?$/.exec(s);
                if (m) ids.add(m[1]);
            }
        }
    }
    for (const id of ids) {
        const hit = picked.find((p) => p.id === id);
        if (hit) {
            if (!hit.reasons.includes('source')) hit.reasons.push('source');
            continue;
        }
        const c = candidates.find((x) => x.id === id && x.doc === 'adr') || resolveSource(homes, local, id);
        if (c === 'unavailable') continue;
        if (c) {
            if (!candidates.includes(c)) candidates.push(c);
            picked.push({ id, home: c.kind, doc: 'adr', status: c.status, file: c.file, reasons: ['source'] });
        } else picked.push({ id, home: null, doc: 'adr', status: 'missing', file: '', reasons: ['source'] });
    }
    picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// A Source record not among the candidates: a candidate from its home, null when that home is on
// disk without it (or, in a household, the prefix names no home), or 'unavailable' when the home
// is not on disk (or, outside a household, unknown).
function resolveSource(homes, local, id) {
    const m = R.ID_RE.exec(id);
    const dir = m && H.dirForPrefix(homes, m[1]);
    if (!dir) return homes.mode === 'household' ? null : 'unavailable';
    if (!fs.existsSync(dir)) return 'unavailable';
    const r = R.loadHome(dir).records.find((x) => x.number === m[2]);
    if (!r) return null;
    const kind = dir === local.dir || homes.localHomes.some((h) => h.repo === m[1]) ? 'local' : 'shared';
    return { id, kind, doc: 'adr', status: r.fm.status || '', file: r.file, scope: asList(r.fm.scope), fm: r.fm, text: r.text };
}

function selectFor({ cwd, repo: wanted, diffText, paths: given, prBody }) {
    const homes = H.resolveHomes(cwd);
    const root = G.gitRoot(cwd);
    const repo = wanted
        || H.repoFromRemote(homes, root && G.originUrl(root))
        || (homes.mode === 'single' ? homes.localHomes[0].repo : null)
        || (root ? [G.repoName(root), path.basename(root)].find((n) => homes.localHomes.some((h) => h.repo === n)) : null);
    if (!repo) throw new SelectionError('cannot tell which repo this is; pass --repo <name>');
    const local = homes.mode === 'single' ? homes.localHomes[0] : homes.localHomes.find((h) => h.repo === repo);
    if (!local) throw new SelectionError(`repo ${repo} is not in household.json`);
    const candidates = [];
    const add = (dir, kind, prefix) => {
        for (const r of R.loadHome(dir).records) {
            candidates.push({
                id: isEmpty(r.fm.id) ? R.impliedId(prefix, r.number) : r.fm.id,
                kind, doc: 'adr', status: r.fm.status || '', file: r.file, scope: asList(r.fm.scope), fm: r.fm, text: r.text,
            });
        }
    };
    add(local.dir, 'local', repo);
    if (homes.sharedHome && !local.coinciding) add(homes.sharedHome, 'shared', 'kb');
    const paths = given || parsePatchPaths(diffText);
    const docHomes = [local.behaviourDir];
    if (homes.sharedBehaviourHome && !local.behaviourCoinciding) docHomes.push(homes.sharedBehaviourHome);
    const touched = touchedDocs(homes, repo, docHomes, given ? { paths } : { files: patchFiles(diffText) });
    const unusable = [];
    const addDocs = (dir, kind, prefix) => {
        for (const d of B.loadBehaviourHome(dir).docs) {
            // No frontmatter at all: not a behaviour doc (a note), unless this PR touches it.
            if (!d.text.replace(/^\uFEFF/, '').startsWith('---') && !touched.has(d.file)) continue;
            // Its scope cannot be read, so whether it binds this diff cannot be told.
            const why = B.unreadable(d);
            if (why) {
                throw new SelectionError(`${d.file}: ${why}; review cannot tell what it binds. Fix it (adr-lint check) before review, or, if this dir is not a behaviour home, set behaviour.localDir / repos[].behaviourDir (behaviour.sharedDir in the knowledge base)`);
            }
            const id = B.docId(d, prefix);
            const scope = asList(d.fm.scope);
            if (!id) {
                unusable.push({ file: d.file, kind, scope });
                continue;
            }
            candidates.push({ id, kind, doc: 'behaviour', status: '-', file: d.file, scope, fm: d.fm, text: d.text });
        }
    };
    addDocs(local.behaviourDir, 'local', repo);
    if (docHomes.length > 1) addDocs(homes.sharedBehaviourHome, 'shared', 'kb');
    // A doc with no id cannot be reviewed; letting it drop out would pass a diff in its scope.
    for (const u of unusable) {
        const globs = u.kind === 'local' ? u.scope : u.scope.filter((s) => s.startsWith(`${repo}:`)).map((s) => s.slice(repo.length + 1));
        if (touched.has(u.file) || paths.some((p) => globs.some((g) => matchesGlob(p, g)))) {
            throw new SelectionError(`${u.file} has no usable prefix; fix it (adr-lint check) before review`);
        }
    }
    const picked = select({ candidates, repo, paths, cited: parseCitedIds(prBody || ''), touched });
    // A selected doc whose rules cannot be read (no `## Rules` as parsed) cannot be judged.
    for (const p of picked.filter((x) => x.doc === 'behaviour' && x.file)) {
        const c = candidates.find((x) => x.file === p.file);
        if (!B.parseDoc(p.file, c.text).sections.includes('Rules')) {
            throw new SelectionError(`${p.file} has no ## Rules section; review cannot read its rules (an unclosed fence, or a heading in another case?). Fix it (adr-lint check) before review`);
        }
    }
    addSources({ homes, local, candidates, picked });
    // Two docs under one id would share one attestation and one file lookup; that only matters
    // when one of them is selected.
    const files = new Map();
    for (const c of candidates.filter((x) => x.doc === 'behaviour')) files.set(c.id, [...(files.get(c.id) || []), c.file]);
    for (const p of picked) {
        const dup = files.get(p.id);
        if (p.doc === 'behaviour' && dup && dup.length > 1) throw new SelectionError(`behaviour docs ${dup.join(' and ')} both have id ${p.id}; give one a different prefix (adr-lint check)`);
    }
    return { repo, homes, picked, candidates };
}

module.exports = { selectFor, SelectionError };
