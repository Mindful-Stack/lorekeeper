'use strict';

// Candidate selection shared by `adr-lint select` and `adr-lint verdict`, so the records a
// review must cover are computed once, the same way, by both.

const fs = require('fs');
const path = require('path');
const { asList, isEmpty } = require('./frontmatter');
const R = require('./records');
const H = require('./homes');
const G = require('./git');
const { parsePatchPaths, parseCitedIds, select } = require('./select');

class SelectionError extends Error {}

// The meta-repo is not a local home, since it usually holds only the manifest. In a household
// whose meta-repo is also its code repo, listed in `repos`, it is the repo under review: its
// local home sits at the household root and the shared home still applies (GRA-86).
function metaRepoHome(homes, repo) {
    if (homes.mode !== 'household' || repo !== homes.metaRepo) return null;
    const entry = homes.repos.find((r) => r && r.name === repo);
    if (!entry) return null;
    const dir = path.join(homes.root, entry.adrDir || homes.config.localDir);
    return { repo, dir, present: true, coinciding: H.sameDir(dir, homes.sharedHome) };
}

// The team KB is not a local home: a pull request to it is checked against the shared records,
// under kb/ (GRA-921). When the KB coincides with a code repo's local home, its records keep that
// repo's prefix, as the catalogue lists them, but their globs are relative to the code repo, so
// they are selected by citation only. `shared_knowledge_bases` repos stay out: their authors call
// their own records kb/, which here are the team KB's.
function kbHome(homes, repo) {
    if (homes.mode !== 'household' || repo !== homes.teamKb) return null;
    const co = homes.localHomes.find((h) => h.coinciding);
    return co ? { dir: co.dir, prefix: co.repo, citedOnly: true } : { dir: homes.sharedHome, prefix: 'kb' };
}

function kbNames(homes) {
    return homes.mode === 'household' ? [homes.teamKb] : [];
}

// The repo a checkout is, from its names; a code repo wins over a KB of the same name, so a
// checkout keeps the answer it had before KBs could be selected.
function repoFromNames(homes, names) {
    return names.find((n) => homes.localHomes.some((h) => h.repo === n))
        || names.find((n) => kbNames(homes).includes(n))
        || null;
}

function selectFor({ cwd, repo: wanted, diffText, paths: given, prBody }) {
    const homes = H.resolveHomes(cwd);
    const root = G.gitRoot(cwd);
    const repo = wanted
        || H.repoFromRemote(homes, root && G.originUrl(root))
        || (homes.mode === 'single' ? homes.localHomes[0].repo : null)
        || (root ? repoFromNames(homes, [G.repoName(root), path.basename(root)]) : null);
    if (!repo) throw new SelectionError('cannot tell which repo this is; pass --repo <name>');
    const local = homes.mode === 'single'
        ? homes.localHomes[0]
        : homes.localHomes.find((h) => h.repo === repo) || metaRepoHome(homes, repo);
    const kb = local ? null : kbHome(homes, repo);
    if (!local && !kb) throw new SelectionError(`repo ${repo} is not in household.json`);
    // Reviewing the KB with its records absent would pass with nothing selected.
    if (kb && !fs.existsSync(kb.dir)) {
        throw new SelectionError(`knowledge base ${repo} is not checked out at ${path.relative(homes.root, kb.dir)}`);
    }
    const candidates = [];
    const add = (dir, kind, prefix, citedOnly = false) => {
        for (const r of R.loadHome(dir).records) {
            candidates.push({
                id: isEmpty(r.fm.id) ? R.impliedId(prefix, r.number) : r.fm.id,
                kind, status: r.fm.status || '', file: r.file, scope: citedOnly ? [] : asList(r.fm.scope), fm: r.fm, text: r.text,
            });
        }
    };
    if (local) add(local.dir, 'local', repo);
    if (kb) add(kb.dir, 'shared', kb.prefix, !!kb.citedOnly);
    else if (homes.sharedHome && !(local && local.coinciding)) add(homes.sharedHome, 'shared', 'kb');
    const paths = given || parsePatchPaths(diffText);
    const picked = select({ candidates, repo, paths, cited: parseCitedIds(prBody || '') });
    return { repo, homes, picked, candidates };
}

module.exports = { selectFor, SelectionError };
