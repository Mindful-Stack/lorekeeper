'use strict';

const { isEmpty, asList, parseRecord } = require('./frontmatter');
const { matchesGlob } = require('./glob');
const { lockedDiff } = require('./locked');
const R = require('./records');

const SHARED_SCOPE = /^[A-Za-z0-9._-]+:[^:]/;
const PREFIXED = /^[A-Za-z0-9._-]+:/;

function handle(s) {
    return String(s).trim().replace(/^@/, '').toLowerCase();
}

function countBullets(content) {
    return content === null ? 0 : content.split('\n').filter((l) => /^[-*+]\s/.test(l)).length;
}

function countTriggers(content) {
    return content === null ? 0 : content.split('\n').filter((l) => /Trigger:/i.test(l)).length;
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
    const { home, records, config } = ctx;
    const err = (file, rule, message) => out.push({ file, rule, level: 'error', message });
    const soft = (file, rule, message, gf) => out.push({
        file, rule, level: gf && !ctx.strict ? 'warning' : 'error', message,
    });
    // A record locked on the base can change only by the five allowed edits, so a finding no
    // allowed edit can fix is not reported there: it would block every later change to the home.
    // Without a base, a locked status stands in and such findings are warnings.
    let frozen = 'no';
    const fix = (file, rule, message) => {
        if (frozen === 'skip') return;
        out.push({ file, rule, level: frozen === 'warn' ? 'warning' : 'error', message });
    };

    for (const file of ctx.strays || []) {
        err(file, 'filename', 'record files are named NNNN-<problem-slug>.md (prefix with _ to exclude)');
    }

    const byNumber = new Map();
    for (const r of records) {
        if (byNumber.has(r.number)) err(r.file, 'number', `number ${r.number} is also used by ${byNumber.get(r.number).name}`);
        else byNumber.set(r.number, r);
    }
    const ownId = (r) => (isEmpty(r.fm.id) ? R.impliedId(home.prefix, r.number) : r.fm.id);
    const byId = new Map(records.map((r) => [ownId(r), r]));

    for (const r of records) {
        const fm = r.fm;
        for (const e of r.errors) err(r.file, 'frontmatter', e);
        if (r.errors.length && Object.keys(fm).length === 0) continue;

        const baseText = ctx.base ? ctx.base.textAt(r.name) : undefined;
        const baseFm = baseText ? parseRecord(baseText).fm : null;
        const lockedOnBase = !!baseFm && R.LOCKED.has(baseFm.status);
        const gf = grandfathered(r, baseText);
        frozen = lockedOnBase ? 'skip' : (!ctx.base && R.LOCKED.has(fm.status) ? 'warn' : 'no');
        const unchanged = (key) => baseFm && JSON.stringify(baseFm[key]) === JSON.stringify(fm[key]);

        if (lockedOnBase) for (const m of lockedDiff(baseText, r.text)) err(r.file, 'locked', m);

        // A moved record is a stub pointing at its new id in another home, which names the
        // old id in its aliases.
        if (!isEmpty(fm.moved_to)) {
            if (!unchanged('moved_to')) checkMove(r, fm.moved_to);
            continue;
        }

        // Schema.
        for (const key of ['title', 'description', 'tags', 'status', 'date']) {
            if (isEmpty(fm[key])) fix(r.file, 'schema', `${key} is required`);
        }
        for (const key of Object.keys(fm)) {
            if (!R.KNOWN_KEYS.has(key)) out.push({ file: r.file, rule: 'schema', level: 'warning', message: `unknown key ${key}` });
        }
        if (!isEmpty(fm.tags) && (!Array.isArray(fm.tags) || !fm.tags.includes('adr'))) {
            fix(r.file, 'schema', 'tags must be an inline list that includes adr');
        }
        if (!isEmpty(fm.status) && !R.STATUSES.includes(fm.status)) fix(r.file, 'schema', `status must be one of ${R.STATUSES.join(', ')}`);
        if (!isEmpty(fm.date) && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) fix(r.file, 'schema', 'date must be YYYY-MM-DD');
        if (!isEmpty(fm.confidence) && !R.CONFIDENCE.includes(fm.confidence)) fix(r.file, 'schema', `confidence must be one of ${R.CONFIDENCE.join(', ')}`);
        if (!isEmpty(fm.reversibility) && !R.REVERSIBILITY.includes(fm.reversibility)) fix(r.file, 'schema', `reversibility must be one of ${R.REVERSIBILITY.join(', ')}`);
        if (!isEmpty(fm.blast_radius) && !R.BLAST_RADIUS.includes(fm.blast_radius)) fix(r.file, 'schema', `blast_radius must be one of ${R.BLAST_RADIUS.join(', ')}`);
        for (const s of asList(fm.sensitivity)) {
            if (!R.SENSITIVITY.includes(s)) fix(r.file, 'schema', `sensitivity tag ${s} must be one of ${R.SENSITIVITY.join(', ')}`);
        }
        for (const key of ['scope', 'sensitivity', 'depends_on', 'related', 'implements', 'aliases', 'decided_by', 'consulted']) {
            if (fm[key] !== undefined && fm[key] !== '' && !Array.isArray(fm[key])) fix(r.file, 'schema', `${key} must be an inline list`);
        }
        const need = (file, rule, message) => (gf ? soft(file, rule, message, true) : fix(file, rule, message));
        if (isEmpty(fm.id)) need(r.file, 'schema', 'id is required');
        if (isEmpty(fm.reversibility)) need(r.file, 'schema', 'reversibility is required');
        if (isEmpty(fm.blast_radius)) need(r.file, 'schema', 'blast_radius is required');
        if (!('sensitivity' in fm)) need(r.file, 'schema', 'sensitivity is required (use [] for none)');
        if (!('scope' in fm)) need(r.file, 'schema', 'scope is required (use [] when the record governs no paths)');

        // Identity.
        const expected = R.impliedId(home.prefix, r.number);
        if (!isEmpty(fm.id) && fm.id !== expected) fix(r.file, 'id', `id must be ${expected} (home and filename)`);
        if (!isEmpty(fm.title) && !String(fm.title).startsWith(`ADR-${r.number}:`)) fix(r.file, 'id', `title must start with "ADR-${r.number}:"`);

        // Home and scope syntax.
        if (!home.coinciding && !isEmpty(fm.blast_radius)) {
            const allowed = home.kind === 'shared' ? R.SHARED_BLAST : R.LOCAL_BLAST;
            if (!allowed.has(fm.blast_radius)) {
                const want = home.kind === 'shared' ? 'local home' : 'shared home';
                fix(r.file, 'home', `blast_radius ${fm.blast_radius} belongs in the ${want}`);
            }
        }
        for (const s of asList(fm.scope)) {
            if (home.kind === 'shared' && !home.coinciding && !SHARED_SCOPE.test(s)) {
                fix(r.file, 'scope', `shared-home scope entries are <repo>:<glob>, got ${s}`);
            }
            if ((home.kind === 'local' || home.coinciding) && PREFIXED.test(s)) {
                fix(r.file, 'scope', `local-home scope entries are globs relative to the repo root, got ${s}`);
            }
        }

        // Tier extras and deciders. Grandfathered records are exempt: they predate tiers.
        const high = R.isHighTier(fm);
        if (high && !gf) {
            if (countTriggers(R.section(r, 'Assumptions and invalidation triggers')) < 1) fix(r.file, 'high-tier', 'needs at least one invalidation trigger');
            if (countBullets(R.section(r, 'Considered options')) < 2) fix(r.file, 'high-tier', 'needs at least two considered options');
            if (asList(fm.scope).length === 0) fix(r.file, 'high-tier', 'needs a non-empty scope');
        }
        const deciders = R.decidedBy(fm);
        if (R.RATIFIED.has(fm.status)) {
            if (deciders.length === 0) need(r.file, 'decided-by', `${fm.status} requires a named human in decided_by`);
            const pool = asList(high ? config.decisionOwners : config.deciders);
            if (!gf && deciders.length && pool.length) {
                const allowed = new Set(pool.map(handle));
                if (!deciders.some((d) => allowed.has(handle(d)))) {
                    fix(r.file, 'decided-by', `decided_by must include one of the ${high ? 'decisionOwners' : 'deciders'}: ${pool.join(', ')}`);
                }
            }
        }

        // Relations.
        // Relations. On a record locked on the base only a newly set superseded_by can change.
        for (const key of ['supersedes', 'depends_on', 'related', 'superseded_by']) {
            if (lockedOnBase && unchanged(key)) continue;
            for (const ref of asList(fm[key])) checkRef(r, ref, key);
        }

        // An unchanged legacy proposal on the default branch predates this rule: warn only.
        if (home.kind === 'shared' && !home.coinciding && fm.status === 'proposed') {
            const touched = ctx.base && (baseText === null || baseText !== r.text);
            out.push({
                file: r.file, rule: 'proposed-shared', level: touched ? 'error' : 'warning',
                message: 'a shared-home record merges only as accepted or rejected',
            });
        }
    }

    // Supersession symmetry within the home, and cycles.
    for (const r of records) {
        const succ = R.qualify(r.fm.superseded_by || '', home.prefix);
        if (succ && byId.has(succ)) {
            const s = byId.get(succ);
            if (!asList(s.fm.supersedes).map((x) => R.qualify(x, home.prefix)).includes(ownId(r))) {
                err(r.file, 'relations', `superseded_by ${succ}, but ${succ} does not list ${ownId(r)} in supersedes`);
            }
        }
        if (R.RATIFIED.has(r.fm.status)) {
            for (const ref of asList(r.fm.supersedes)) {
                const pred = byId.get(R.qualify(ref, home.prefix));
                if (pred && (pred.fm.status !== 'superseded' || R.qualify(pred.fm.superseded_by || '', home.prefix) !== ownId(r))) {
                    err(r.file, 'relations', `${ownId(pred)} must be flipped to superseded_by ${ownId(r)} in the same change`);
                }
            }
        }
    }
    for (const r of records) {
        const seen = new Set([ownId(r)]);
        let cur = r;
        while (cur && !isEmpty(cur.fm.superseded_by)) {
            const next = R.qualify(cur.fm.superseded_by, home.prefix);
            if (seen.has(next)) {
                err(r.file, 'cycle', `supersession cycle through ${next}`);
                break;
            }
            seen.add(next);
            cur = byId.get(next);
        }
    }

    if (ctx.base) {
        const names = new Set(records.map((r) => r.name));
        for (const name of ctx.base.baseNames) {
            if (names.has(name)) continue;
            const b = parseRecord(ctx.base.textAt(name) || '').fm;
            if (R.LOCKED.has(b.status)) err(name, 'locked', 'a locked record is never deleted or renamed');
        }
        for (const r of records) {
            const owner = ctx.base.tipNumbers.get(r.number);
            if (owner && owner !== r.name) err(r.file, 'number', `ADR-${r.number} is already ${owner} on the base branch; renumber this record`);
        }
        for (const r of records) {
            if (ctx.base.textAt(r.name) !== null || r.fm.status !== 'proposed' || home.kind !== 'local') continue;
            const scope = asList(r.fm.scope);
            const hit = ctx.base.changedFiles.find((f) => scope.some((g) => matchesGlob(f, g)));
            if (hit) err(r.file, 'ride-along', `this change touches ${hit} in its scope, so the record must be accepted before merge`);
        }
    }

    return out;

    function checkRef(r, ref, key) {
        const id = R.qualify(ref, home.prefix);
        if (!id) return err(r.file, 'relations', `${key} ${ref} is not a qualified id (<home>/ADR-NNNN)`);
        if (id === ownId(r)) return err(r.file, 'relations', `${key} points at the record itself`);
        if (id.startsWith(`${home.prefix}/`)) {
            if (!byId.has(id)) err(r.file, 'relations', `${key} ${id} does not exist in this home`);
            return undefined;
        }
        const found = ctx.resolveRef ? ctx.resolveRef(id) : { state: 'unavailable' };
        if (found.state === 'missing') err(r.file, 'relations', `${key} ${id} does not exist`);
        else if (found.state === 'unavailable') out.push({ file: r.file, rule: 'relations', level: 'warning', message: `${key} ${id}: its home is not on disk, so it was not checked` });
        return found;
    }

    function checkMove(r, ref) {
        const id = R.qualify(ref, home.prefix);
        if (!id) return err(r.file, 'move', `moved_to ${ref} is not a qualified id`);
        if (id.startsWith(`${home.prefix}/`)) return err(r.file, 'move', 'moved_to names this home; a move goes to the other home');
        const found = checkRef(r, id, 'moved_to');
        if (found && found.state === 'found' && !asList(found.fm && found.fm.aliases).includes(ownId(r))) {
            err(r.file, 'move', `${id} must list ${ownId(r)} in its aliases`);
        }
        return undefined;
    }
}

module.exports = { checkHome, grandfathered };
