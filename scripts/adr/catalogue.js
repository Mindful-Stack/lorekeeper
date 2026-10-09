'use strict';

// The ADR catalogue across every resolved home, rendered on demand and never committed.
// Reverse links ("related from", "depended on by") are computed here, because records only
// store the links they declare: a new record never edits an accepted one.

const fs = require('fs');
const path = require('path');
const { isEmpty, asList } = require('./frontmatter');
const R = require('./records');

// Every home in reading order: local homes, the team KB, then other teams' KBs (read-only).
// A coinciding local home is listed once, under its local prefix.
function listHomes(homes) {
    const out = [];
    for (const h of homes.localHomes) {
        out.push({ kind: 'local', prefix: h.repo, dir: h.dir, present: h.present && fs.existsSync(h.dir) });
    }
    const coincides = homes.localHomes.some((h) => h.coinciding && homes.sharedHome);
    if (homes.sharedHome && !coincides) {
        out.push({ kind: 'shared', prefix: 'kb', dir: homes.sharedHome, present: fs.existsSync(homes.sharedHome) });
    }
    for (const k of homes.otherKbs) {
        out.push({ kind: 'other', prefix: k.name, dir: k.dir, present: fs.existsSync(k.dir) });
    }
    return out;
}

function entry(home, r) {
    const fm = r.fm;
    const own = (ref) => R.qualify(ref, home.prefix);
    const refs = (key) => asList(fm[key]).map(own).filter(Boolean);
    return {
        id: isEmpty(fm.id) ? R.impliedId(home.prefix, r.number) : fm.id,
        home: home.prefix,
        kind: home.kind,
        number: r.number,
        file: r.file,
        title: fm.title || '',
        description: fm.description || '',
        status: fm.status || '',
        date: fm.date || '',
        decidedBy: R.decidedBy(fm),
        reversibility: fm.reversibility || '',
        blastRadius: fm.blast_radius || '',
        sensitivity: asList(fm.sensitivity),
        scope: asList(fm.scope),
        highTier: R.isHighTier(fm),
        supersedes: refs('supersedes'),
        supersededBy: own(fm.superseded_by || '') || '',
        dependsOn: refs('depends_on'),
        related: refs('related'),
        movedTo: own(fm.moved_to || '') || '',
        aliases: asList(fm.aliases),
        relatedFrom: [],
        dependedOnBy: [],
    };
}

// { homes: [{ kind, prefix, dir, present, count }], records: [entry] }, records sorted by id.
function buildCatalogue(homes) {
    const listed = listHomes(homes);
    const records = [];
    for (const h of listed) {
        h.count = 0;
        if (!h.present) continue;
        for (const r of R.loadHome(h.dir).records) {
            records.push(entry(h, r));
            h.count++;
        }
    }
    const byId = new Map(records.map((e) => [e.id, e]));
    for (const e of records) for (const a of e.aliases) if (!byId.has(a)) byId.set(a, e);
    for (const e of records) {
        for (const id of e.related) if (byId.has(id)) byId.get(id).relatedFrom.push(e.id);
        for (const id of e.dependsOn) if (byId.has(id)) byId.get(id).dependedOnBy.push(e.id);
    }
    const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    records.sort((a, b) => order(a.id, b.id));
    for (const e of records) {
        e.relatedFrom.sort(order);
        e.dependedOnBy.sort(order);
    }
    return { homes: listed, records };
}

// The next free number in a home: one more than the highest used in the directory or in
// `extraNames` (record files on the base tip, so an unmerged collision is avoided early).
function nextNumber(dir, extraNames = []) {
    const names = [...(fs.existsSync(dir) ? fs.readdirSync(dir) : []), ...extraNames];
    let max = 0;
    for (const n of names) {
        const m = R.FILE_RE.exec(path.basename(n));
        if (m) max = Math.max(max, Number(m[1]));
    }
    return String(max + 1).padStart(4, '0');
}

function cell(s) {
    return String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

// Markdown rendering: one table across homes, then the relations each record has.
function renderMarkdown(cat, statusFilter) {
    const rows = cat.records.filter((e) => !statusFilter || e.status === statusFilter);
    const lines = [`## Architecture decision records (${rows.length})`, ''];
    lines.push('| ID | Home | Title | Decision | Status | Date |', '|---|---|---|---|---|---|');
    for (const e of rows) {
        const title = cell(e.title.replace(/^ADR-\d{4}:\s*/, ''));
        lines.push(`| ${e.id} | ${e.home} | ${title} | ${cell(e.description)} | ${e.status} | ${e.date} |`);
    }
    const rel = rows.filter((e) => e.supersedes.length || e.supersededBy || e.dependsOn.length
        || e.related.length || e.relatedFrom.length || e.dependedOnBy.length || e.movedTo);
    if (rel.length) {
        lines.push('', '### Relations', '');
        for (const e of rel) {
            const parts = [];
            if (e.supersedes.length) parts.push(`supersedes ${e.supersedes.join(', ')}`);
            if (e.supersededBy) parts.push(`superseded by ${e.supersededBy}`);
            if (e.movedTo) parts.push(`moved to ${e.movedTo}`);
            if (e.dependsOn.length) parts.push(`depends on ${e.dependsOn.join(', ')}`);
            if (e.dependedOnBy.length) parts.push(`depended on by ${e.dependedOnBy.join(', ')}`);
            if (e.related.length) parts.push(`related to ${e.related.join(', ')}`);
            if (e.relatedFrom.length) parts.push(`related from ${e.relatedFrom.join(', ')}`);
            lines.push(`- **${e.id}**: ${parts.join('; ')}`);
        }
    }
    const absent = cat.homes.filter((h) => !h.present);
    if (absent.length) {
        lines.push('', `Not on disk: ${absent.map((h) => `${h.prefix} (${h.dir})`).join(', ')}`);
    }
    return lines.join('\n');
}

module.exports = { listHomes, buildCatalogue, nextNumber, renderMarkdown };
