'use strict';

const fs = require('fs');
const path = require('path');
const { gitRoot, repoName } = require('./git');

const DEFAULTS = { localDir: 'docs/adr', sharedDir: 'adrs', decisionOwners: [], deciders: [] };
// Mirrors the SessionStart hook's tier-4 sibling fallback.
const KB_FALLBACKS = ['lore', 'docs/lore', 'docs/shared-knowledge', 'shared-knowledge', 'knowledge'];

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch (e) {
        return false;
    }
}

function readJson(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return null;
    }
}

function findHousehold(start) {
    let dir = path.resolve(start);
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, 'household.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function knowledgeDir(kbRoot) {
    return kbRoot && isDir(path.join(kbRoot, 'knowledge')) ? path.join(kbRoot, 'knowledge') : null;
}

function sameDir(a, b) {
    if (!a || !b) return false;
    const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));
    return real(a) === real(b);
}

// Resolves every ADR home visible from `start`. Shape:
//   { mode, root, config, repos, localHomes: [{ repo, dir, present, coinciding }], sharedHome,
//     sharedRoot, otherKbs }
// `sharedRoot` is the team KB's root (the directory holding knowledge/), or null.
// A local home `coinciding` is the only home: the shared home is the same directory, or
// (single repo) no knowledge base resolves at all.
function resolveHomes(start, env = process.env) {
    const household = findHousehold(start);
    if (household) {
        const m = readJson(path.join(household, 'household.json')) || {};
        const config = { ...DEFAULTS, ...(m.adr || {}) };
        const kbName = m.knowledge_base || 'lore';
        const shared = m.shared_knowledge_bases || [];
        const skip = new Set([m.meta_repo, kbName, ...shared]);
        // The manifest declares the team KB, so its home is known even when it is not checked
        // out; references into it then resolve as unavailable (a warning), not missing.
        const sharedHome = path.join(household, kbName, 'knowledge', config.sharedDir);
        const localHomes = (m.repos || [])
            .filter((r) => r && r.name && !skip.has(r.name))
            .map((r) => ({
                repo: r.name,
                dir: path.join(household, r.name, r.adrDir || config.localDir),
                present: isDir(path.join(household, r.name)),
            }))
            .map((h) => ({ ...h, coinciding: sameDir(h.dir, sharedHome) }));
        const otherKbs = shared.map((name) => ({
            name,
            dir: path.join(household, name, 'knowledge', config.sharedDir),
        }));
        return {
            mode: 'household',
            root: household,
            config,
            repos: m.repos || [],
            localHomes,
            sharedHome,
            sharedRoot: path.join(household, kbName),
            otherKbs,
        };
    }

    const top = gitRoot(start);
    const root = top || path.resolve(start);
    const file = readJson(path.join(root, '.lorekeeper', 'config.json')) || {};
    const config = { ...DEFAULTS, ...(file.adr || {}) };
    let kbRoot = null;
    if (file.knowledgeBasePath) kbRoot = path.resolve(root, file.knowledgeBasePath);
    else if (env.KNOWLEDGE_BASE_PATH) kbRoot = path.resolve(root, env.KNOWLEDGE_BASE_PATH);
    else kbRoot = KB_FALLBACKS.map((c) => path.join(root, c)).find((c) => knowledgeDir(c)) || null;
    const team = knowledgeDir(kbRoot);
    const sharedHome = team ? path.join(team, config.sharedDir) : null;
    const localDir = path.join(root, config.localDir);
    const coinciding = sharedHome === null || sameDir(localDir, sharedHome);
    const local = { repo: top ? repoName(top) : path.basename(root), dir: localDir, present: true, coinciding };
    return {
        mode: 'single',
        root,
        config,
        repos: [],
        localHomes: [local],
        sharedHome,
        sharedRoot: team ? kbRoot : null,
        otherKbs: [],
    };
}

// Which home `dir` is, or null. Local wins when the two coincide (ids use the local prefix).
function homeOf(homes, dir) {
    const local = homes.localHomes.find((h) => sameDir(h.dir, dir));
    if (local) {
        return { kind: 'local', repo: local.repo, prefix: local.repo, coinciding: local.coinciding };
    }
    if (sameDir(homes.sharedHome, dir)) return { kind: 'shared', prefix: 'kb', coinciding: false };
    return null;
}

function normaliseRemote(url) {
    return String(url)
        .trim()
        .replace(/^[a-z+]+:\/\//i, '')
        .replace(/^[^@/]+@/, '')
        .replace(/:(?!\d)/, '/')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function repoFromRemote(homes, url) {
    if (!url) return null;
    const want = normaliseRemote(url);
    const hit = homes.repos.find((r) => r.url && normaliseRemote(r.url) === want);
    return hit ? hit.name : null;
}

// The home directory a qualified id prefix names, or null when the prefix is unknown.
function dirForPrefix(homes, prefix) {
    if (prefix === 'kb') return homes.sharedHome;
    const other = homes.otherKbs.find((k) => k.name === prefix);
    if (other) return other.dir;
    const local = homes.localHomes.find((h) => h.repo === prefix);
    return local ? local.dir : null;
}

module.exports = {
    DEFAULTS, resolveHomes, homeOf, repoFromRemote, normaliseRemote, dirForPrefix, findHousehold,
};
