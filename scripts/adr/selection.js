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
