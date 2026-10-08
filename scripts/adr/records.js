'use strict';

const fs = require('fs');
const path = require('path');
const { parseRecord, sections, isEmpty, asList } = require('./frontmatter');

const STATUSES = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'];
const LOCKED = new Set(['accepted', 'rejected', 'deprecated', 'superseded']);
const RATIFIED = new Set(['accepted', 'deprecated', 'superseded']);
const CONFIDENCE = ['high', 'medium', 'low'];
const REVERSIBILITY = ['one-way', 'two-way'];
const BLAST_RADIUS = ['local', 'service', 'cross-service', 'customer'];
const SENSITIVITY = ['security', 'privacy', 'billing', 'legal', 'contract'];
const LOCAL_BLAST = new Set(['local', 'service']);
const SHARED_BLAST = new Set(['cross-service', 'customer']);
// Keys this design introduced; edit 5 (schema backfill) may add them to a locked record.
const BACKFILL_KEYS = ['id', 'reversibility', 'blast_radius', 'sensitivity', 'scope', 'decided_by'];
const KNOWN_KEYS = new Set([
    'id', 'title', 'description', 'tags', 'status', 'date', 'decided_by', 'deciders', 'consulted',
    'confidence', 'reversibility', 'blast_radius', 'sensitivity', 'scope', 'supersedes',
    'superseded_by', 'depends_on', 'related', 'implements', 'rfc', 'aliases', 'moved_to',
]);
const FILE_RE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const ID_RE = /^([A-Za-z0-9._-]+)\/ADR-(\d{4})$/;

function impliedId(prefix, number) {
    return `${prefix}/ADR-${number}`;
}

function loadRecord(file, text) {
    const parsed = parseRecord(text);
    const m = FILE_RE.exec(path.basename(file));
    return {
        file,
        name: path.basename(file),
        number: m ? m[1] : null,
        text,
        fm: parsed.fm,
        order: parsed.order,
        errors: parsed.errors,
        sections: sections(parsed.body),
        body: parsed.body,
    };
}

// Every `NNNN-slug.md` record in a home. `_`-prefixed and non-markdown files are ignored;
// other markdown files are returned as strays so the validator can name them.
function loadHome(dir) {
    const records = [];
    const strays = [];
    if (!fs.existsSync(dir)) return { records, strays };
    for (const name of fs.readdirSync(dir).sort()) {
        if (name.startsWith('_') || !name.endsWith('.md')) continue;
        const file = path.join(dir, name);
        if (!FILE_RE.test(name)) {
            strays.push(file);
            continue;
        }
        records.push(loadRecord(file, fs.readFileSync(file, 'utf8')));
    }
    return { records, strays };
}

// `decided_by`, falling back to the pre-design `deciders` key.
function decidedBy(fm) {
    return isEmpty(fm.decided_by) ? asList(fm.deciders) : asList(fm.decided_by);
}

// Unclassified records count as high tier: the conservative default wherever tier is read.
function isHighTier(fm) {
    if (isEmpty(fm.reversibility) || isEmpty(fm.blast_radius)) return true;
    return fm.reversibility === 'one-way'
        || SHARED_BLAST.has(fm.blast_radius)
        || asList(fm.sensitivity).length > 0;
}

// Accepted before this design: no classification was ever written.
function isUnclassified(fm) {
    return isEmpty(fm.reversibility);
}

// Normalises a relation value to a qualified id. Legacy records wrote bare numbers
// (`0002`, `2`, `ADR-0002`); those resolve within the record's own home.
function qualify(ref, ownPrefix) {
    const s = String(ref).trim();
    if (ID_RE.test(s)) return s;
    const m = /^(?:ADR-)?(\d{1,4})$/.exec(s);
    if (m) return impliedId(ownPrefix, m[1].padStart(4, '0'));
    return null;
}

function section(record, heading) {
    const s = record.sections.find((x) => x.heading === heading);
    return s ? s.content : null;
}

module.exports = {
    STATUSES, LOCKED, RATIFIED, CONFIDENCE, REVERSIBILITY, BLAST_RADIUS, SENSITIVITY,
    LOCAL_BLAST, SHARED_BLAST, BACKFILL_KEYS, KNOWN_KEYS, FILE_RE, ID_RE,
    impliedId, loadRecord, loadHome, decidedBy, isHighTier, isUnclassified, qualify, section,
};
