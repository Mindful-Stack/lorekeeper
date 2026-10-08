'use strict';

const { isEmpty, asList, parseRecord, sections } = require('./frontmatter');
const { matchesGlob } = require('./glob');
const { lockedDiff } = require('./locked');
const R = require('./records');

const SHARED_SCOPE = /^[A-Za-z0-9._-]+:[^:]/;
const PREFIXED = /^[A-Za-z0-9._-]+:/;
const TIER_KEYS = ['reversibility', 'blast_radius', 'sensitivity'];
const RELATION_KEYS = ['supersedes', 'depends_on', 'related', 'superseded_by'];

function handle(s) {
    return String(s).trim().replace(/^@/, '').toLowerCase();
}

function countBullets(content) {
    return content === null ? 0 : content.split('\n').filter((l) => /^[-*+]\s/.test(l)).length;
}

function countTriggers(content) {
    return content === null ? 0 : content.split('\n').filter((l) => /Trigger:/i.test(l)).length;
}

function same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// Grandfathered: written before this design classified records, and not being moved through
// its lifecycle in this change. Without a base the record's own state stands in, so a local
// run may warn where CI with --base fails.
function grandfathered(record, baseText) {
    if (baseText === undefined) return R.isUnclassified(record.fm);
    if (baseText === null) return false;
    const b = parseRecord(baseText).fm;
    return R.isUnclassified(b) && b.status === record.fm.status;
}

// What the base says about one record. `frozen` decides how a finding the record cannot fix
// is reported: a record locked on the base changes only by the five allowed edits, so a finding
// about a key or section the change leaves as it was is skipped (it would block every later
// change to the home), while a value the change writes is always checked. Without a base, a
// locked status stands in and every such finding is a warning.
function describe(r, ctx) {
    const baseText = ctx.base ? ctx.base.textAt(r.name) : undefined;
    const b = baseText ? parseRecord(baseText) : null;
    const lockedOnBase = !!b && R.LOCKED.has(b.fm.status);
    const keys = new Set();
    if (lockedOnBase) {
        for (const k of new Set([...Object.keys(b.fm), ...Object.keys(r.fm), ...R.KNOWN_KEYS])) {
            if (same(b.fm[k], r.fm[k])) keys.add(k);
        }
        const bSections = new Map(sections(b.body).map((s) => [s.heading, s.content]));
        for (const s of r.sections) if (bSections.get(s.heading) === s.content) keys.add(`§${s.heading}`);
    }
    let mode = 'none';
    if (lockedOnBase) mode = 'base';
    else if (!ctx.base && R.LOCKED.has(r.fm.status)) mode = 'warn';
    return {
        baseText,
        lockedOnBase,
        gf: grandfathered(r, baseText),
        frozen: { mode, keys },
    };
}

// ctx:
//   home        { kind: 'local'|'shared', prefix, coinciding }
//   records     loadHome(...).records       strays   loadHome(...).strays
//   config      { decisionOwners: [], deciders: [] }
//   strict      boolean
//   resolveRef  (qualifiedId) -> { state: 'found'|'missing'|'unavailable', fm? }  (other homes only)
//   base        null, or {
//                 textAt(name) -> string | null   (record at the merge base; null if absent)
//                 baseNames    string[]           (record files at the merge base)
//                 tipNumbers   Map<NNNN, name>    (record files at the base tip)
//                 changedFiles string[]           (repo-relative, since the merge base)
//               }
// Returns [{ file, rule, level: 'error'|'warning', message }].
function checkHome(ctx) {
    const out = [];
    const ownId = (r) => (isEmpty(r.fm.id) ? R.impliedId(ctx.home.prefix, r.number) : r.fm.id);
    const home = {
        ctx,
        out,
        ownId,
        byId: new Map(ctx.records.map((r) => [ownId(r), r])),
        info: new Map(ctx.records.map((r) => [r, describe(r, ctx)])),
        err: (file, rule, message) => out.push({ file, rule, level: 'error', message }),
        warn: (file, rule, message) => out.push({ file, rule, level: 'warning', message }),
    };
    for (const r of ctx.records) checkRecord(home, r);
    checkAcrossRecords(home);
    if (ctx.base) checkAgainstBase(home);
    return out;
}

function checkRecord(home, r) {
    const { ctx, err, warn } = home;
    const fm = r.fm;
    for (const e of r.errors) err(r.file, 'frontmatter', e);
    if (r.errors.length && Object.keys(fm).length === 0) return;

    const { baseText, lockedOnBase, gf, frozen } = home.info.get(r);
    // `keys` names the frontmatter keys (and §sections) a finding is about.
    const fix = (keys, rule, message) => {
        if (frozen.mode === 'base' && keys.every((k) => frozen.keys.has(k))) return;
        home.out.push({ file: r.file, rule, level: frozen.mode === 'warn' ? 'warning' : 'error', message });
    };
    const need = (keys, rule, message) => {
        if (gf) home.out.push({ file: r.file, rule, level: ctx.strict ? 'error' : 'warning', message });
        else fix(keys, rule, message);
    };

    if (lockedOnBase) for (const m of lockedDiff(baseText, r.text)) err(r.file, 'locked', m);

    // A moved record is a stub pointing at its new id in another home, which names the
    // old id in its aliases.
    if (!isEmpty(fm.moved_to)) {
        if (!frozen.keys.has('moved_to')) checkMove(home, r, fm.moved_to);
        return;
    }

    // Schema.
    for (const key of ['title', 'description', 'tags', 'status', 'date']) {
        if (isEmpty(fm[key])) fix([key], 'schema', `${key} is required`);
    }
    for (const key of Object.keys(fm)) {
        if (!R.KNOWN_KEYS.has(key)) warn(r.file, 'schema', `unknown key ${key}`);
    }
    if (!isEmpty(fm.tags) && (!Array.isArray(fm.tags) || !fm.tags.includes('adr'))) {
        fix(['tags'], 'schema', 'tags must be an inline list that includes adr');
    }
    const enums = [
        ['status', R.STATUSES], ['confidence', R.CONFIDENCE],
        ['reversibility', R.REVERSIBILITY], ['blast_radius', R.BLAST_RADIUS],
    ];
    for (const [key, values] of enums) {
        if (!isEmpty(fm[key]) && !values.includes(fm[key])) fix([key], 'schema', `${key} must be one of ${values.join(', ')}`);
    }
    if (!isEmpty(fm.date) && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) fix(['date'], 'schema', 'date must be YYYY-MM-DD');
    for (const s of asList(fm.sensitivity)) {
        if (!R.SENSITIVITY.includes(s)) fix(['sensitivity'], 'schema', `sensitivity tag ${s} must be one of ${R.SENSITIVITY.join(', ')}`);
    }
    for (const key of ['scope', 'sensitivity', 'depends_on', 'related', 'implements', 'aliases', 'decided_by', 'consulted']) {
        if (fm[key] !== undefined && fm[key] !== '' && !Array.isArray(fm[key])) fix([key], 'schema', `${key} must be an inline list`);
    }
    if (isEmpty(fm.id)) need(['id'], 'schema', 'id is required');
    if (isEmpty(fm.reversibility)) need(['reversibility'], 'schema', 'reversibility is required');
    if (isEmpty(fm.blast_radius)) need(['blast_radius'], 'schema', 'blast_radius is required');
    if (!('sensitivity' in fm)) need(['sensitivity'], 'schema', 'sensitivity is required (use [] for none)');
    if (!('scope' in fm)) need(['scope'], 'schema', 'scope is required (use [] when the record governs no paths)');

    // Identity.
    const { home: h, config } = ctx;
    const expected = R.impliedId(h.prefix, r.number);
    if (!isEmpty(fm.id) && fm.id !== expected) fix(['id'], 'id', `id must be ${expected} (home and filename)`);
    if (!isEmpty(fm.title) && !String(fm.title).startsWith(`ADR-${r.number}:`)) fix(['title'], 'id', `title must start with "ADR-${r.number}:"`);

    // Home and scope syntax.
    if (!h.coinciding && !isEmpty(fm.blast_radius)) {
        const allowed = h.kind === 'shared' ? R.SHARED_BLAST : R.LOCAL_BLAST;
        if (!allowed.has(fm.blast_radius)) {
            const want = h.kind === 'shared' ? 'local home' : 'shared home';
            fix(['blast_radius'], 'home', `blast_radius ${fm.blast_radius} belongs in the ${want}`);
        }
    }
    for (const s of asList(fm.scope)) {
        if (h.kind === 'shared' && !h.coinciding && !SHARED_SCOPE.test(s)) {
            fix(['scope'], 'scope', `shared-home scope entries are <repo>:<glob>, got ${s}`);
        }
        if ((h.kind === 'local' || h.coinciding) && PREFIXED.test(s)) {
            fix(['scope'], 'scope', `local-home scope entries are globs relative to the repo root, got ${s}`);
        }
    }

    // Tier extras and deciders. Grandfathered records are exempt: they predate tiers.
    const high = R.isHighTier(fm);
    if (high && !gf) {
        const triggers = 'Assumptions and invalidation triggers';
        const options = 'Considered options';
        if (countTriggers(R.section(r, triggers)) < 1) fix([`§${triggers}`, ...TIER_KEYS], 'high-tier', 'needs at least one invalidation trigger');
        if (countBullets(R.section(r, options)) < 2) fix([`§${options}`, ...TIER_KEYS], 'high-tier', 'needs at least two considered options');
        if (asList(fm.scope).length === 0) fix(['scope', ...TIER_KEYS], 'high-tier', 'needs a non-empty scope');
    }
    const deciders = R.decidedBy(fm);
    if (R.RATIFIED.has(fm.status)) {
        if (deciders.length === 0) need(['decided_by', 'deciders'], 'decided-by', `${fm.status} requires a named human in decided_by`);
        const pool = asList(high ? config.decisionOwners : config.deciders);
        if (!gf && deciders.length && pool.length) {
            const allowed = new Set(pool.map(handle));
            if (!deciders.some((d) => allowed.has(handle(d)))) {
                fix(['decided_by', 'deciders', ...TIER_KEYS], 'decided-by', `decided_by must include one of the ${high ? 'decisionOwners' : 'deciders'}: ${pool.join(', ')}`);
            }
        }
    }

    // Relations. On a record locked on the base only a newly set superseded_by can change.
    for (const key of RELATION_KEYS) {
        if (lockedOnBase && frozen.keys.has(key)) continue;
        for (const ref of asList(fm[key])) checkRef(home, r, ref, key);
    }

    // An unchanged legacy proposal on the default branch predates this rule: warn only.
    if (h.kind === 'shared' && !h.coinciding && fm.status === 'proposed') {
        const touched = ctx.base && (baseText === null || baseText !== r.text);
        home.out.push({
            file: r.file, rule: 'proposed-shared', level: touched ? 'error' : 'warning',
            message: 'a shared-home record merges only as accepted or rejected',
        });
    }
}

// Strays, duplicate numbers and ids, supersession symmetry and cycles.
function checkAcrossRecords(home) {
    const { ctx, err, ownId, byId } = home;
    const { records, home: h } = ctx;
    for (const file of ctx.strays || []) {
        err(file, 'filename', 'record files are named NNNN-<problem-slug>.md (prefix with _ to exclude)');
    }

    const byNumber = new Map();
    const byExplicitId = new Map();
    for (const r of records) {
        if (byNumber.has(r.number)) err(r.file, 'number', `number ${r.number} is also used by ${byNumber.get(r.number).name}`);
        else byNumber.set(r.number, r);
        if (isEmpty(r.fm.id)) continue;
        if (byExplicitId.has(r.fm.id)) err(r.file, 'id', `id ${r.fm.id} is also used by ${byExplicitId.get(r.fm.id).name}`);
        else byExplicitId.set(r.fm.id, r);
    }

    for (const r of records) {
        const succ = R.qualify(r.fm.superseded_by || '', h.prefix);
        if (succ && byId.has(succ)) {
            const s = byId.get(succ);
            if (!asList(s.fm.supersedes).map((x) => R.qualify(x, h.prefix)).includes(ownId(r))) {
                err(r.file, 'relations', `superseded_by ${succ}, but ${succ} does not list ${ownId(r)} in supersedes`);
            }
        }
        if (R.RATIFIED.has(r.fm.status)) {
            for (const ref of asList(r.fm.supersedes)) {
                const pred = byId.get(R.qualify(ref, h.prefix));
                if (pred && (pred.fm.status !== 'superseded' || R.qualify(pred.fm.superseded_by || '', h.prefix) !== ownId(r))) {
                    err(r.file, 'relations', `${ownId(pred)} must be flipped to superseded_by ${ownId(r)} in the same change`);
                }
            }
        }
    }
    for (const r of records) {
        const seen = new Set([ownId(r)]);
        let cur = r;
        while (cur && !isEmpty(cur.fm.superseded_by)) {
            const next = R.qualify(cur.fm.superseded_by, h.prefix);
            if (seen.has(next)) {
                err(r.file, 'cycle', `supersession cycle through ${next}`);
                break;
            }
            seen.add(next);
            cur = byId.get(next);
        }
    }
}

// Deleted locked records, numbers taken on the base tip, and ride-along.
function checkAgainstBase(home) {
    const { ctx, err } = home;
    const { records, base, home: h } = ctx;
    const names = new Set(records.map((r) => r.name));
    for (const name of base.baseNames) {
        if (names.has(name)) continue;
        const b = parseRecord(base.textAt(name) || '').fm;
        if (R.LOCKED.has(b.status)) err(name, 'locked', 'a locked record is never deleted or renamed');
    }
    for (const r of records) {
        const owner = base.tipNumbers.get(r.number);
        if (owner && owner !== r.name) err(r.file, 'number', `ADR-${r.number} is already ${owner} on the base branch; renumber this record`);
    }
    for (const r of records) {
        if (base.textAt(r.name) !== null || r.fm.status !== 'proposed' || h.kind !== 'local') continue;
        const scope = asList(r.fm.scope);
        const hit = base.changedFiles.find((f) => scope.some((g) => matchesGlob(f, g)));
        if (hit) err(r.file, 'ride-along', `this change touches ${hit} in its scope, so the record must be accepted before merge`);
    }
}

function checkRef(home, r, ref, key) {
    const { ctx, err, warn, ownId, byId } = home;
    const { prefix } = ctx.home;
    const id = R.qualify(ref, prefix);
    if (!id) return err(r.file, 'relations', `${key} ${ref} is not a qualified id (<home>/ADR-NNNN)`);
    if (id === ownId(r)) return err(r.file, 'relations', `${key} points at the record itself`);
    if (id.startsWith(`${prefix}/`)) {
        if (!byId.has(id)) err(r.file, 'relations', `${key} ${id} does not exist in this home`);
        return undefined;
    }
    const found = ctx.resolveRef ? ctx.resolveRef(id) : { state: 'unavailable' };
    if (found.state === 'missing') err(r.file, 'relations', `${key} ${id} does not exist`);
    else if (found.state === 'unavailable') warn(r.file, 'relations', `${key} ${id}: its home is not on disk, so it was not checked`);
    return found;
}

function checkMove(home, r, ref) {
    const { ctx, err, ownId } = home;
    const { prefix } = ctx.home;
    const id = R.qualify(ref, prefix);
    if (!id) return err(r.file, 'move', `moved_to ${ref} is not a qualified id`);
    if (id.startsWith(`${prefix}/`)) return err(r.file, 'move', 'moved_to names this home; a move goes to the other home');
    const found = checkRef(home, r, id, 'moved_to');
    if (found && found.state === 'found' && !asList(found.fm && found.fm.aliases).includes(ownId(r))) {
        err(r.file, 'move', `${id} must list ${ownId(r)} in its aliases`);
    }
    return undefined;
}

module.exports = { checkHome, grandfathered };
