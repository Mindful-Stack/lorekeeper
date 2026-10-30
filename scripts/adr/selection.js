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
const { parsePatchPaths, parseCitedIds, select } = require('./select');

class SelectionError extends Error {}

// The doc files the diff touches, from each behaviour home inside this repo's checkout. A
// doc-named path that is gone at head (deleted, or moved or renamed out of being a doc) throws:
// its rules would silently stop binding the PR that removes them.
function touchedDocs(homes, repo, dirs, paths) {
    const repoDir = homes.mode === 'single' ? homes.root : path.join(homes.root, repo);
    const out = new Set();
    for (const dir of dirs) {
        const rel = toPosix(path.relative(repoDir, dir));
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        for (const p of paths) {
            const name = p.startsWith(`${rel}/`) ? p.slice(rel.length + 1) : null;
            if (!name || name.includes('/') || !B.isDocName(name)) continue;
            const file = path.join(dir, name);
            let present = true;
            try {
                fs.lstatSync(file);
            } catch (e) {
                present = false;
            }
            if (!present) {
                throw new SelectionError(`behaviour doc ${p} is in the diff but not at head (deleted, moved or renamed); review cannot judge rules it no longer sees. Retiring a doc needs the admin bypass`);
            }
            out.add(file);
        }
    }
    return out;
}

// The records a selected doc's rules name in `Source:` bind the same diff: each is selected
// (reason `source`) so the reviewer reads it and must attest it. A record in a home select does
// not load (another repo's) is read from there; one that resolves nowhere is `missing`.
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
        let c = candidates.find((x) => x.id === id && x.doc === 'adr');
        if (!c) c = loadElsewhere(homes, local, id);
        if (c) candidates.push(c);
        picked.push(c
            ? { id, home: c.kind, doc: 'adr', status: c.status, file: c.file, reasons: ['source'] }
            : { id, home: null, doc: 'adr', status: 'missing', file: '', reasons: ['source'] });
    }
    picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// A record in a home other than this repo's and the team KB's, as a candidate, or null.
function loadElsewhere(homes, local, id) {
    const m = R.ID_RE.exec(id);
    const dir = m && H.dirForPrefix(homes, m[1]);
    if (!dir || dir === local.dir || dir === homes.sharedHome) return null;
    const r = R.loadHome(dir).records.find((x) => x.number === m[2]);
    if (!r) return null;
    const kind = homes.localHomes.some((h) => h.repo === m[1]) ? 'local' : 'shared';
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
    const unusable = [];
    const addDocs = (dir, kind, prefix) => {
        for (const d of B.loadBehaviourHome(dir).docs) {
            // Its scope cannot be read, so whether it binds this diff cannot be told.
            const why = B.unreadable(d);
            if (why) throw new SelectionError(`${d.file}: ${why}; review cannot tell what it binds. Fix it (adr-lint check) before review`);
            const id = B.docId(d, prefix);
            const scope = asList(d.fm.scope);
            if (!id) {
                unusable.push({ file: d.file, kind, scope });
                continue;
            }
            candidates.push({ id, kind, doc: 'behaviour', status: '-', file: d.file, scope, fm: d.fm, text: d.text });
        }
    };
    const docHomes = [local.behaviourDir];
    addDocs(local.behaviourDir, 'local', repo);
    if (homes.sharedBehaviourHome && !local.behaviourCoinciding) {
        docHomes.push(homes.sharedBehaviourHome);
        addDocs(homes.sharedBehaviourHome, 'shared', 'kb');
    }
    const paths = given || parsePatchPaths(diffText);
    const touched = touchedDocs(homes, repo, docHomes, paths);
    // A doc with no id cannot be reviewed; letting it drop out would pass a diff in its scope.
    for (const u of unusable) {
        const globs = u.kind === 'local' ? u.scope : u.scope.filter((s) => s.startsWith(`${repo}:`)).map((s) => s.slice(repo.length + 1));
        if (touched.has(u.file) || paths.some((p) => globs.some((g) => matchesGlob(p, g)))) {
            throw new SelectionError(`${u.file} has no usable prefix; fix it (adr-lint check) before review`);
        }
    }
    const picked = select({ candidates, repo, paths, cited: parseCitedIds(prBody || ''), touched });
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
