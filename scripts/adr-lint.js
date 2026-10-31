#!/usr/bin/env node
'use strict';

// adr-lint: validates architecture decision records and selects the ones a diff touches.
// No dependencies; runs on Node 22+ on any platform with git on PATH.

const fs = require('fs');
const path = require('path');
const { toPosix } = require('./adr/glob');
const R = require('./adr/records');
const H = require('./adr/homes');
const G = require('./adr/git');
const { checkHome } = require('./adr/rules');
const { backfill } = require('./adr/backfill');
const C = require('./adr/catalogue');
const V = require('./adr/verdict');
const S = require('./adr/selection');
const Cov = require('./adr/coverage');
const B = require('./adr/behaviour');
const { parseRecord } = require('./adr/frontmatter');
const P = require('./adr/prs');

const USAGE = `usage:
  adr-lint check [--home local|shared] [--repo <name>] [--single-home] [--base <ref>]
                 [--strict] [--ci] <dir>   (an ADR or a behaviour home)
  adr-lint select (--diff <patch-file|-> | --paths <path,...>) [--repo <name>] [--pr-body <file>]
                  [--cwd <dir>] [--json]
  adr-lint backfill [--home local|shared] [--repo <name>] [--dry-run] <dir>
  adr-lint homes [--cwd <dir>]                      (JSON)
  adr-lint index [--cwd <dir>] [--status <status>] [--json]
  adr-lint next [--base <ref>] [--no-prs] <dir>
  adr-lint verdict --findings <file|-> --diff <patch-file> [--repo <name>] [--pr-body <file>]
                   [--cwd <dir>]                    (JSON)

exit codes: 0 ok (warnings allowed), 1 violations or blocking findings, 2 usage or environment error`;

class UsageError extends Error {}

const BOOLEAN_FLAGS = new Set(['strict', 'single-home', 'dry-run', 'json', 'ci', 'no-prs']);
const FLAGS = {
    check: ['home', 'repo', 'single-home', 'base', 'strict', 'ci'],
    select: ['diff', 'paths', 'repo', 'pr-body', 'cwd', 'json'],
    backfill: ['home', 'repo', 'dry-run'],
    homes: ['cwd'],
    index: ['cwd', 'status', 'json'],
    next: ['base', 'no-prs'],
    verdict: ['findings', 'diff', 'repo', 'pr-body', 'cwd'],
};

// `known` lists the flags the subcommand takes; any other flag is a usage error, so a typo
// never silently drops a check.
function parseArgs(argv, known) {
    const flags = {};
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            positional.push(a);
            continue;
        }
        const name = a.slice(2);
        if (known && !known.includes(name)) throw new UsageError(`unknown flag --${name}`);
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

// realpath of a path that may not exist yet: its nearest existing ancestor, resolved, plus
// the rest. A home directory that does not exist is an empty home.
function realpathLoose(p) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs)) return fs.realpathSync(abs);
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realpathLoose(parent), path.basename(abs));
}

function readInput(file, flag) {
    try {
        return file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new UsageError(`cannot read --${flag} ${file}: ${e.message}`);
    }
}

// Works out which home `dir` is and the id prefix its records use.
function locateHome(dir, flags, homes = H.resolveHomes(dir)) {
    const inferredRepo = () => {
        const root = G.gitRoot(dir);
        return H.repoFromRemote(homes, root && G.originUrl(root)) || (root ? G.repoName(root) : path.basename(dir));
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
    if (!mb) {
        throw new UsageError(`no merge base between ${ref} and HEAD; fetch the full history (CI: fetch-depth: 0 or an explicit git fetch)`);
    }
    const rel = toPosix(path.relative(fs.realpathSync(root), realpathLoose(dir)));
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
        return hit ? { state: 'found', fm: hit.fm, text: hit.text } : { state: 'missing' };
    };
}

// The behaviour home `dir` is, or null for an ADR home. A resolved behaviour home is one; with
// --home, so is a dir whose path ends in that kind's configured behaviour dir, unless it is a
// resolved ADR home. Anything else stays an ADR home, so no existing invocation changes meaning.
function locateBehaviourHome(dir, flags, homes) {
    if (flags.home && flags.home !== 'local' && flags.home !== 'shared') throw new UsageError('--home is local or shared');
    let home = H.behaviourHomeOf(homes, dir);
    const isAdrHome = !!H.homeOf(homes, dir);
    if (home && isAdrHome) throw new UsageError(`${display(dir)} is configured as both an ADR home and a behaviour home`);
    if (!home && flags.home && !isAdrHome) {
        const want = flags.home === 'shared' ? homes.behaviourConfig.sharedDir : homes.behaviourConfig.localDir;
        if (toPosix(dir).endsWith(`/${toPosix(want).replace(/\/+$/, '')}`)) {
            home = flags.home === 'shared' ? { kind: 'shared', prefix: 'kb' } : { kind: 'local', repo: null, prefix: null };
        }
    }
    if (!home) return null;
    if (home.kind === 'local') {
        const root = G.gitRoot(dir);
        // Outside git, the repo is the dir holding the behaviour dir.
        const want = toPosix(homes.behaviourConfig.localDir).replace(/\/+$/, '');
        const holder = toPosix(dir).endsWith(`/${want}`) ? toPosix(dir).slice(0, -(want.length + 1)) : path.dirname(dir);
        home.repo = flags.repo || home.repo || (root ? G.repoName(root) : path.basename(holder));
        home.prefix = home.repo;
    }
    return home;
}

// The ADR dir beside a behaviour home, or null when it cannot be told.
function ownAdrDir(homes, dir, home) {
    if (home.kind === 'shared') {
        const b = toPosix(homes.behaviourConfig.sharedDir).replace(/\/+$/, '');
        const d = toPosix(dir);
        return d.endsWith(`/${b}`) ? path.join(d.slice(0, -b.length), homes.config.sharedDir) : homes.sharedHome;
    }
    // The repo root is what holds the behaviour dir; outside git, homes.root is only the start dir.
    const b = toPosix(homes.behaviourConfig.localDir).replace(/\/+$/, '');
    const d = toPosix(dir);
    if (d.endsWith(`/${b}`)) {
        const entry = homes.mode === 'household' && homes.localHomes.find((h) => realpathLoose(h.behaviourDir) === realpathLoose(dir));
        return entry ? entry.dir : path.join(d.slice(0, -b.length), homes.config.localDir);
    }
    if (homes.mode === 'single') return path.join(homes.root, homes.config.localDir);
    const entry = homes.localHomes.find((h) => realpathLoose(h.behaviourDir) === realpathLoose(dir));
    if (entry) return entry.dir;
    const root = G.gitRoot(dir);
    return root ? path.join(root, homes.config.localDir) : null;
}

// Resolves refs into the home's own ADR dir by that dir, so a KB repo checked alone, or a
// --repo override, still finds them; a ref not there is missing even if the dir is absent.
// Other prefixes resolve as for an ADR check.
function behaviourResolver(homes, dir, home) {
    const fallback = makeResolver(homes);
    const adrDir = ownAdrDir(homes, dir, home);
    let records = null;
    return (id) => {
        const m = R.ID_RE.exec(id);
        if (!adrDir || !m || m[1] !== home.prefix) return fallback(id);
        if (!records) records = R.loadHome(adrDir).records;
        const hit = records.find((r) => r.number === m[2]);
        return hit ? { state: 'found', fm: hit.fm, text: hit.text } : { state: 'missing' };
    };
}

// The tracked files of the repo a scope glob is relative to, or null (skip the dead-glob
// warning). In a household each repo is its own checkout: a sibling that is a plain directory
// must not answer with the meta repo's files, which G.gitRoot would walk up to.
function repoFilesFor(homes, dir, home) {
    const cache = new Map();
    const own = (repoDir) => {
        const top = fs.existsSync(repoDir) ? G.gitRoot(repoDir) : null;
        return top && realpathLoose(top) === realpathLoose(repoDir) ? top : null;
    };
    return (repo) => {
        let root;
        if (home.kind === 'local') {
            root = G.gitRoot(dir);
            // The meta repo, or any repo the household sits inside, is not this repo's checkout.
            if (root && homes.mode === 'household' && !path.relative(realpathLoose(root), realpathLoose(homes.root)).startsWith('..')) root = null;
        } else root = homes.mode === 'single' ? null : own(path.join(homes.root, repo));
        if (!root) return null;
        if (!cache.has(root)) cache.set(root, G.trackedFiles(root));
        return cache.get(root);
    };
}

// Prints one line per violation; the exit code is 1 when any is an error.
function report(dir, violations) {
    for (const v of violations) {
        const file = path.isAbsolute(v.file) ? v.file : path.join(dir, v.file);
        const level = v.level === 'warning' ? 'warning: ' : '';
        console.log(`${display(file)}: ${v.rule}: ${level}${v.message}`);
    }
    return violations.some((v) => v.level === 'error') ? 1 : 0;
}

function looksLikeBehaviourDoc(file) {
    try {
        return 'prefix' in parseRecord(fs.readFileSync(file, 'utf8')).fm;
    } catch (e) {
        return false;
    }
}

function cmdCheck(flags, positional) {
    if (positional.length !== 1) throw new UsageError('check takes exactly one directory');
    // Without a base the merge gate would skip the lock and pass.
    if (flags.ci && !flags.base) throw new UsageError('--ci needs --base <ref>');
    const dir = path.resolve(positional[0]);
    const homes0 = H.resolveHomes(dir);
    const behaviour = locateBehaviourHome(dir, flags, homes0);
    if (behaviour) {
        const { docs } = B.loadBehaviourHome(dir);
        const violations = B.checkBehaviourHome({
            home: behaviour, docs, resolveRef: behaviourResolver(homes0, dir, behaviour),
            repoFiles: repoFilesFor(homes0, dir, behaviour),
        });
        return report(dir, violations);
    }
    const { homes, home } = locateHome(dir, flags, homes0);
    const { records, strays } = R.loadHome(dir);
    // No records but a doc with a `prefix:`: a behaviour home check does not recognise. Checked
    // as ADRs it would only warn about file names, and its rules would go unchecked.
    if (!records.length && strays.some(looksLikeBehaviourDoc)) {
        throw new UsageError(`${display(dir)} looks like a behaviour home; configure behaviour.localDir / repos[].behaviourDir, or pass --home with the configured name`);
    }
    const violations = checkHome({
        home,
        records,
        strays,
        strict: !!flags.strict,
        // The merge gate: a proposal that has not been accepted or rejected fails.
        ci: !!flags.ci,
        resolveRef: makeResolver(homes),
        base: flags.base ? loadBase(dir, flags.base) : null,
    });
    return report(dir, violations);
}

function cmdSelect(flags) {
    if (!flags.diff === !flags.paths) throw new UsageError('select needs exactly one of --diff <patch-file|-> or --paths <path,...>');
    const cwd = path.resolve(flags.cwd || process.cwd());
    const paths = flags.paths ? flags.paths.split(',').map((p) => toPosix(p.trim())).filter(Boolean) : null;
    const diffText = paths ? '' : readInput(flags.diff, 'diff');
    const prBody = flags['pr-body'] ? readInput(flags['pr-body'], 'pr-body') : '';
    let sel;
    try {
        sel = S.selectFor({ cwd, repo: flags.repo, diffText, paths, prBody });
    } catch (e) {
        if (e instanceof S.SelectionError) throw new UsageError(e.message);
        throw e;
    }
    const { repo, picked, candidates } = sel;
    if (flags.json) {
        const byId = new Map(candidates.map((c) => [c.id, c]));
        console.log(JSON.stringify({
            repo,
            candidates: picked.map((p) => {
                const c = byId.get(p.id);
                return {
                    id: p.id, kind: p.doc, home: p.home, status: p.status, file: p.file ? display(p.file) : null, reasons: p.reasons,
                    title: c ? c.fm.title || '' : '', description: c ? c.fm.description || '' : '',
                    scope: c ? c.scope : [], record: c ? c.text : '',
                };
            }),
        }, null, 2));
        return 0;
    }
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
        // A shared-home proposal is classified when it is accepted; touching it now would make
        // the migration PR edit a proposal, which the check fails.
        if (home.kind === 'shared' && !home.coinciding && r.fm.status === 'proposed') {
            console.log(`${display(r.file)}: skipped: proposed (classify on accept)`);
            continue;
        }
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

// The repo whose checkout contains `cwd`, or null (the household root itself, or elsewhere).
function governedRepo(homes, cwd) {
    const here = realpathLoose(cwd);
    const inside = (dir) => {
        const rel = path.relative(realpathLoose(dir), here);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };
    if (homes.mode === 'single') return inside(homes.root) ? homes.localHomes[0].repo : null;
    const hit = homes.localHomes.find((h) => inside(path.join(homes.root, h.repo)));
    return hit ? hit.repo : null;
}

function cmdHomes(flags) {
    const cwd = path.resolve(flags.cwd || process.cwd());
    const homes = H.resolveHomes(cwd);
    const exists = (p) => !!p && fs.existsSync(p);
    // The git toplevel holding a home's repo or KB root, which must exist. In a household each
    // is its own repo, so a missing or unversioned sibling never reports the meta repo; a
    // single repo's KB may sit inside the code repo, which is then its repo.
    const repoRootOf = (dir) => {
        const top = exists(dir) ? G.gitRoot(dir) : null;
        if (!top) return null;
        return homes.mode === 'household' && realpathLoose(top) !== realpathLoose(dir) ? null : top;
    };
    const place = (home, dir) => {
        const repoRoot = repoRootOf(dir);
        return {
            repoRoot,
            relDir: repoRoot ? toPosix(path.relative(realpathLoose(repoRoot), realpathLoose(home))) : null,
            defaultBranch: repoRoot ? G.defaultBranch(repoRoot) : null,
        };
    };
    const repoDirOf = (h) => (homes.mode === 'single' ? homes.root : path.join(homes.root, h.repo));
    const shared = homes.sharedHome ? place(homes.sharedHome, homes.sharedRoot) : place(null, null);
    const sharedB = homes.sharedBehaviourHome ? place(homes.sharedBehaviourHome, homes.sharedRoot) : place(null, null);
    console.log(JSON.stringify({
        mode: homes.mode,
        root: homes.root,
        governedRepo: governedRepo(homes, cwd),
        config: homes.config,
        localHomes: homes.localHomes.map((h) => ({
            ...h, exists: exists(h.dir), behaviourExists: exists(h.behaviourDir), ...place(h.dir, h.present ? repoDirOf(h) : null),
        })),
        sharedHome: homes.sharedHome,
        sharedHomeExists: exists(homes.sharedHome),
        sharedRoot: homes.sharedRoot,
        sharedRepoRoot: shared.repoRoot,
        sharedRelDir: shared.relDir,
        sharedDefaultBranch: shared.defaultBranch,
        behaviourConfig: homes.behaviourConfig,
        sharedBehaviourHome: homes.sharedBehaviourHome,
        sharedBehaviourHomeExists: exists(homes.sharedBehaviourHome),
        sharedBehaviourRelDir: sharedB.relDir,
        otherKbs: homes.otherKbs.map((k) => ({ ...k, exists: exists(k.dir) })),
    }, null, 2));
    return 0;
}

function cmdIndex(flags) {
    const cwd = path.resolve(flags.cwd || process.cwd());
    const cat = C.buildCatalogue(H.resolveHomes(cwd));
    if (flags.status && !R.STATUSES.includes(flags.status)) {
        throw new UsageError(`--status is one of ${R.STATUSES.join(', ')}`);
    }
    if (flags.json) {
        const records = cat.records.filter((e) => !flags.status || e.status === flags.status);
        console.log(JSON.stringify({ homes: cat.homes, records, behaviour: cat.behaviour }, null, 2));
    } else {
        console.log(C.renderMarkdown(cat, flags.status));
    }
    return 0;
}

function cmdNext(flags, positional) {
    if (positional.length !== 1) throw new UsageError('next takes exactly one directory');
    const dir = path.resolve(positional[0]);
    let extra = [];
    const root = G.gitRoot(dir);
    const rel = root ? toPosix(path.relative(fs.realpathSync(root), realpathLoose(dir))) : null;
    if (flags.base) {
        if (!root) throw new UsageError(`--base needs ${display(dir)} to be inside a git repository`);
        if (!G.revExists(root, flags.base)) throw new UsageError(`base ref ${flags.base} not found; fetch it first`);
        extra = G.listDir(root, flags.base, rel);
    }
    const without = C.nextNumber(dir, extra);
    const claimed = claimedByOpenPrs(root, rel, flags['no-prs']);
    const next = C.nextNumber(dir, [...extra, ...claimed.map((c) => c.name)]);
    if (next !== without) {
        const prs = [...new Set(claimed.map((c) => `#${c.pr}`))].join(', ');
        const last = String(Number(next) - 1).padStart(4, '0');
        console.error(`adr-lint next: skipped ${without === last ? last : `${without}–${last}`}, claimed by open pull requests ${prs}`);
    }
    console.log(next);
    return 0;
}

// Record names that open PRs add under the home (`rel`, repo-relative). Whenever they cannot be
// read, say so on stderr: a number printed without them may collide with an open PR's record.
function claimedByOpenPrs(root, rel, skip) {
    const warn = (why) => console.error(`adr-lint next: open pull requests not checked (${why}); the number may collide with an open PR's record`);
    if (skip) return warn('--no-prs'), [];
    if (!root) return warn('not inside a git repository'), [];
    if (!G.originUrl(root)) return warn('the repository has no origin remote'), [];
    const r = P.openPrFiles(root);
    if (r.error) return warn(r.error), [];
    if (r.truncated) console.error(`adr-lint next: read only the first ${P.LIMIT} open pull requests`);
    const prefix = rel === '' ? '' : `${rel}/`;
    const names = [];
    for (const { pr, path: p } of r.paths) {
        if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
        if (R.FILE_RE.test(path.posix.basename(p))) names.push({ name: p.slice(prefix.length), pr });
    }
    return names;
}

function cmdVerdict(flags) {
    if (!flags.findings) throw new UsageError('verdict needs --findings <file|->');
    if (!flags.diff) throw new UsageError('verdict needs --diff <patch-file> (selection is re-run from it)');
    if (['findings', 'diff', 'pr-body'].filter((k) => flags[k] === '-').length > 1) {
        throw new UsageError('only one input may be stdin (-)');
    }
    const diffText = readInput(flags.diff, 'diff');
    const prBody = flags['pr-body'] ? readInput(flags['pr-body'], 'pr-body') : '';
    const cwd = path.resolve(flags.cwd || process.cwd());
    try {
        const doc = V.parseFindings(readInput(flags.findings, 'findings'));
        const { homes, picked } = S.selectFor({ cwd, repo: flags.repo, diffText, prBody });
        // Selected candidates first: their ids come from --repo, which the catalogue may not share.
        const cat = C.buildCatalogue(homes);
        const files = new Map([...cat.records, ...cat.behaviour].map((r) => [r.id, r.file]));
        for (const p of picked) if (p.file) files.set(p.id, p.file);
        const texts = new Map();
        const recordText = (id) => {
            if (!files.has(id)) return null;
            if (!texts.has(id)) texts.set(id, fs.readFileSync(files.get(id), 'utf8'));
            return texts.get(id);
        };
        const kinds = new Map([...cat.records.map((r) => [r.id, 'adr']), ...cat.behaviour.map((d) => [d.id, 'behaviour'])]);
        const cov = Cov.validate({ doc, picked, recordText, kindOf: (id) => kinds.get(id) });
        const added = cov.dangling.map((id) => ({
            class: 'dangling',
            ids: [id],
            where: null,
            summary: picked.find((p) => p.id === id).reasons.includes('cited')
                ? `${id} is cited in the PR description but resolves nowhere`
                : `${id} is named in a behaviour rule's Source: line but resolves nowhere`,
        }));
        const v = V.verdict({ findings: [...doc.findings, ...added] });
        console.log(JSON.stringify({ ...v, coverage: { checked: doc.coverage.checked, extra: cov.extra, notReviewed: cov.notReviewed } }, null, 2));
        return v.blocking > 0 ? 1 : 0;
    } catch (e) {
        // Anything else (an unreadable record) is "could not judge", not a crash.
        if (e instanceof UsageError) throw e;
        throw new UsageError(e.message);
    }
}

function main(argv) {
    const [cmd, ...rest] = argv.slice(2);
    try {
        if (!Object.prototype.hasOwnProperty.call(FLAGS, cmd)) throw new UsageError(cmd ? `unknown command ${cmd}` : 'missing command');
        const { flags, positional } = parseArgs(rest, FLAGS[cmd]);
        if (cmd === 'check') return cmdCheck(flags, positional);
        if (cmd === 'select') return cmdSelect(flags);
        if (cmd === 'verdict') return cmdVerdict(flags);
        if (cmd === 'homes') return cmdHomes(flags);
        if (cmd === 'index') return cmdIndex(flags);
        if (cmd === 'next') return cmdNext(flags, positional);
        return cmdBackfill(flags, positional);
    } catch (e) {
        // An unreadable behaviour-home entry is an environment error: exit 2, not a stack.
        if (!(e instanceof UsageError) && !(e instanceof B.HomeReadError)) throw e;
        console.error(`adr-lint: ${e.message}\n\n${USAGE}`);
        return 2;
    }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { main, parseArgs };
