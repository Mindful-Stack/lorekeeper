'use strict';

// Candidate selection shared by `adr-lint select` and `adr-lint verdict`, so the records a
// review must cover are computed once, the same way, by both.

const path = require('path');
const { asList, isEmpty } = require('./frontmatter');
const R = require('./records');
const B = require('./behaviour');
const H = require('./homes');
const G = require('./git');
const { matchesGlob } = require('./glob');
const { parsePatchPaths, parseCitedIds, select } = require('./select');

class SelectionError extends Error {}

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
    if (homes.sharedBehaviourHome && !local.behaviourCoinciding) addDocs(homes.sharedBehaviourHome, 'shared', 'kb');
    const paths = given || parsePatchPaths(diffText);
    // A doc with no id cannot be reviewed; letting it drop out would pass a diff in its scope.
    for (const u of unusable) {
        const globs = u.kind === 'local' ? u.scope : u.scope.filter((s) => s.startsWith(`${repo}:`)).map((s) => s.slice(repo.length + 1));
        if (paths.some((p) => globs.some((g) => matchesGlob(p, g)))) {
            throw new SelectionError(`${u.file} has no usable prefix; fix it (adr-lint check) before review`);
        }
    }
    const picked = select({ candidates, repo, paths, cited: parseCitedIds(prBody || '') });
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
