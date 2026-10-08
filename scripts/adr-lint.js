#!/usr/bin/env node
'use strict';

// adr-lint: validates architecture decision records and selects the ones a diff touches.
// No dependencies; runs on Node 16+ on any platform with git on PATH.

const fs = require('fs');
const path = require('path');
const { asList, isEmpty } = require('./adr/frontmatter');
const { toPosix } = require('./adr/glob');
const R = require('./adr/records');
const H = require('./adr/homes');
const G = require('./adr/git');
const { checkHome } = require('./adr/rules');
const { backfill } = require('./adr/backfill');
const { parsePatchPaths, parseCitedIds, select } = require('./adr/select');

const USAGE = `usage:
  adr-lint check [--home local|shared] [--repo <name>] [--single-home] [--base <ref>]
                 [--strict] [--config <file>] <dir>
  adr-lint select --diff <patch-file|-> [--repo <name>] [--pr-body <file>] [--cwd <dir>]
  adr-lint backfill [--home local|shared] [--repo <name>] [--dry-run] <dir>

exit codes: 0 ok (warnings allowed), 1 violations, 2 usage or environment error`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['strict', 'single-home', 'dry-run']);

function parseArgs(argv) {
    const flags = {};
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            positional.push(a);
            continue;
        }
        const name = a.slice(2);
        if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
        else if (i + 1 < argv.length) flags[name] = argv[++i];
        else throw new UsageError(`--${name} needs a value`);
    }
    return { flags, positional };
}

// Relative to the CWD when the file is under it, absolute otherwise.
function display(file) {
    if (!path.isAbsolute(file)) return toPosix(file);
    const rel = path.relative(process.cwd(), file);
    return toPosix(rel.startsWith('..') ? file : rel);
}

// Works out which home `dir` is and the id prefix its records use.
function locateHome(dir, flags) {
    const homes = H.resolveHomes(dir);
    const inferredRepo = () => {
        const root = G.gitRoot(dir);
        return H.repoFromRemote(homes, root && G.originUrl(root)) || path.basename(root || dir);
    };
    if (flags.home) {
        if (flags.home !== 'local' && flags.home !== 'shared') throw new UsageError('--home is local or shared');
        if (flags.home === 'shared') return { homes, home: { kind: 'shared', prefix: 'kb', coinciding: false } };
        const fromManifest = H.homeOf(homes, dir);
        const repo = flags.repo || (fromManifest && fromManifest.repo) || inferredRepo();
        return { homes, home: { kind: 'local', repo, prefix: repo, coinciding: !!flags['single-home'] } };
    }
    const home = H.homeOf(homes, dir);
    if (!home) throw new UsageError(`cannot tell which ADR home ${display(dir)} is; pass --home local|shared`);
    if (flags.repo && home.kind === 'local') {
        home.repo = flags.repo;
        home.prefix = flags.repo;
    }
    return { homes, home };
}

function loadBase(dir, ref) {
    const root = G.gitRoot(dir);
    if (!root) throw new UsageError(`--base needs ${display(dir)} to be inside a git repository`);
    if (!G.revExists(root, ref)) {
        throw new UsageError(`base ref ${ref} not found; fetch it first (CI: fetch-depth: 0 or an explicit git fetch)`);
    }
    const mb = G.mergeBase(root, ref);
    if (!mb) throw new UsageError(`no merge base between ${ref} and HEAD`);
    const rel = toPosix(path.relative(fs.realpathSync(root), fs.realpathSync(dir)));
    const relFile = (name) => (rel ? `${rel}/${name}` : name);
    const recordNames = (names) => names.filter((n) => R.FILE_RE.test(n));
    const baseNames = recordNames(G.listDir(root, mb, rel));
    const tipNames = recordNames(G.listDir(root, ref, rel));
    const tipNumbers = new Map();
    for (const name of tipNames) tipNumbers.set(R.FILE_RE.exec(name)[1], name);
    const reader = (rev, names) => {
        const cache = new Map();
        return (name) => {
            if (!cache.has(name)) cache.set(name, names.includes(name) ? G.showFile(root, rev, relFile(name)) : null);
            return cache.get(name);
        };
    };
    return {
        ref,
        textAt: reader(mb, baseNames),
        tipTextAt: reader(ref, tipNames),
        baseNames,
        tipNumbers,
        // The records themselves are not code the change touches.
        changedFiles: G.changedFiles(root, mb).filter((f) => !rel || !f.startsWith(`${rel}/`)),
    };
}

// Resolves a qualified id in another home. Without a manifest (single repo, or CI passing
// --home) an unknown prefix is a home that is simply not checked out: unavailable, not missing.
function makeResolver(homes) {
    const loaded = new Map();
    return (id) => {
        const m = R.ID_RE.exec(id);
        const dir = m && H.dirForPrefix(homes, m[1]);
        if (!dir) return { state: homes.mode === 'household' ? 'missing' : 'unavailable' };
        if (!fs.existsSync(dir)) return { state: 'unavailable' };
        if (!loaded.has(dir)) loaded.set(dir, R.loadHome(dir).records);
        const hit = loaded.get(dir).find((r) => r.number === m[2]);
        return hit ? { state: 'found', fm: hit.fm } : { state: 'missing' };
    };
}

function readConfig(flags, homes) {
    if (!flags.config) return homes.config;
    let json;
    try {
        json = JSON.parse(fs.readFileSync(flags.config, 'utf8'));
    } catch (e) {
        throw new UsageError(`cannot read --config ${flags.config}: ${e.message}`);
    }
    return { ...H.DEFAULTS, ...(json.adr || json) };
}

function cmdCheck(flags, positional) {
    if (positional.length !== 1) throw new UsageError('check takes exactly one directory');
    const dir = path.resolve(positional[0]);
    if (!fs.existsSync(dir)) throw new UsageError(`${display(dir)} does not exist`);
    const { homes, home } = locateHome(dir, flags);
    const { records, strays } = R.loadHome(dir);
    const violations = checkHome({
        home,
        records,
        strays,
        config: readConfig(flags, homes),
        strict: !!flags.strict,
        resolveRef: makeResolver(homes),
        base: flags.base ? loadBase(dir, flags.base) : null,
    });
    for (const v of violations) {
        const file = path.isAbsolute(v.file) ? v.file : path.join(dir, v.file);
        const level = v.level === 'warning' ? 'warning: ' : '';
        console.log(`${display(file)}: ${v.rule}: ${level}${v.message}`);
    }
    return violations.some((v) => v.level === 'error') ? 1 : 0;
}

function cmdSelect(flags) {
    if (!flags.diff) throw new UsageError('select needs --diff <patch-file|->');
    const cwd = path.resolve(flags.cwd || process.cwd());
    const homes = H.resolveHomes(cwd);
    const root = G.gitRoot(cwd);
    const repo = flags.repo
        || H.repoFromRemote(homes, root && G.originUrl(root))
        || (homes.mode === 'single' ? homes.localHomes[0].repo : null)
        || (root && homes.localHomes.some((h) => h.repo === path.basename(root)) ? path.basename(root) : null);
    if (!repo) throw new UsageError('cannot tell which repo this is; pass --repo <name>');
    const local = homes.mode === 'single' ? homes.localHomes[0] : homes.localHomes.find((h) => h.repo === repo);
    if (!local) throw new UsageError(`repo ${repo} is not in household.json`);

    const candidates = [];
    const add = (dir, kind, prefix) => {
        for (const r of R.loadHome(dir).records) {
            candidates.push({
                id: isEmpty(r.fm.id) ? R.impliedId(prefix, r.number) : r.fm.id,
                kind,
                status: r.fm.status || '',
                file: r.file,
                scope: asList(r.fm.scope),
            });
        }
    };
    add(local.dir, 'local', repo);
    if (homes.sharedHome && !local.coinciding) add(homes.sharedHome, 'shared', 'kb');

    const patch = flags.diff === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(flags.diff, 'utf8');
    const prBody = flags['pr-body'] ? fs.readFileSync(flags['pr-body'], 'utf8') : '';
    const picked = select({ candidates, repo, paths: parsePatchPaths(patch), cited: parseCitedIds(prBody) });
    for (const p of picked) {
        console.log([p.id, p.status, p.file ? display(p.file) : '-', p.reasons.join(',')].join('\t'));
    }
    return 0;
}

function cmdBackfill(flags, positional) {
    if (positional.length !== 1) throw new UsageError('backfill takes exactly one directory');
    const dir = path.resolve(positional[0]);
    const { home } = locateHome(dir, flags);
    const { records } = R.loadHome(dir);
    for (const r of records) {
        const res = backfill(r.text, R.impliedId(home.prefix, r.number));
        if (res.error) {
            console.log(`${display(r.file)}: skipped: ${res.error}`);
            continue;
        }
        if (!res.changed) continue;
        if (!flags['dry-run']) fs.writeFileSync(r.file, res.text);
        console.log(`${display(r.file)}: ${flags['dry-run'] ? 'would add' : 'added'} ${res.added.join(', ')}`);
    }
    return 0;
}

function main(argv) {
    const [cmd, ...rest] = argv.slice(2);
    try {
        const { flags, positional } = parseArgs(rest);
        if (cmd === 'check') return cmdCheck(flags, positional);
        if (cmd === 'select') return cmdSelect(flags);
        if (cmd === 'backfill') return cmdBackfill(flags, positional);
        throw new UsageError(cmd ? `unknown command ${cmd}` : 'missing command');
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        console.error(`adr-lint: ${e.message}\n\n${USAGE}`);
        return 2;
    }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { main, parseArgs };
