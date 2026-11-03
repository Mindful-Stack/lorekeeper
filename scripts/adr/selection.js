'use strict';

// Candidate selection shared by `adr-lint select` and `adr-lint verdict`, so the records a
// review must cover are computed once, the same way, by both.

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

function selectFor({ cwd, repo: wanted, diffText, paths: given, prBody }) {
    const homes = H.resolveHomes(cwd);
    const root = G.gitRoot(cwd);
    const repo = wanted
        || H.repoFromRemote(homes, root && G.originUrl(root))
        || (homes.mode === 'single' ? homes.localHomes[0].repo : null)
        || (root ? [G.repoName(root), path.basename(root)].find((n) => homes.localHomes.some((h) => h.repo === n)) : null);
    if (!repo) throw new SelectionError('cannot tell which repo this is; pass --repo <name>');
    const local = homes.mode === 'single'
        ? homes.localHomes[0]
        : homes.localHomes.find((h) => h.repo === repo) || metaRepoHome(homes, repo);
    if (!local) throw new SelectionError(`repo ${repo} is not in household.json`);
    const candidates = [];
    const add = (dir, kind, prefix) => {
        for (const r of R.loadHome(dir).records) {
            candidates.push({
                id: isEmpty(r.fm.id) ? R.impliedId(prefix, r.number) : r.fm.id,
                kind, status: r.fm.status || '', file: r.file, scope: asList(r.fm.scope), fm: r.fm, text: r.text,
            });
        }
    };
    add(local.dir, 'local', repo);
    if (homes.sharedHome && !local.coinciding) add(homes.sharedHome, 'shared', 'kb');
    const paths = given || parsePatchPaths(diffText);
    const picked = select({ candidates, repo, paths, cited: parseCitedIds(prBody || '') });
    return { repo, homes, picked, candidates };
}

module.exports = { selectFor, SelectionError };
