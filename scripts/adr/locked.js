'use strict';

// The locked-record diff rule: a record that is locked on the base may differ from it only
// by the five edits in the design's *Amend or supersede* table. Every check here is
// mechanical; none judges whether a sentence kept its meaning.

const { parseRecord, sections, isEmpty } = require('./frontmatter');
const { BACKFILL_KEYS, isUnclassified, decidedBy } = require('./records');

const APPEND_ONLY = new Set(['Status', 'Later observations']);
const DATED_ENTRY = /^[-*+]\s+\**\s*\d{4}-\d{2}-\d{2}/;
const STATUS_MOVES = { accepted: ['superseded', 'deprecated'], deprecated: ['superseded'] };

// Edit 4: formatting and link targets may change; nothing else. Link text survives the
// normalisation, so a changed link text is still a change. A markdown link or an aliased
// wikilink has text apart from its target, so its target may change in any section. A bare
// wikilink or autolink is its own text, so its target may change only in *See also*, where a
// renamed file path is the expected repair.
const EMPHASIS = [
    /(^|[^A-Za-z0-9_*])\*\*(?=\S)([^\n]*?\S)\*\*(?![A-Za-z0-9_*])/g,
    /(^|[^A-Za-z0-9_])__(?=\S)([^\n]*?\S)__(?![A-Za-z0-9_])/g,
    /(^|[^A-Za-z0-9_*])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![A-Za-z0-9_*])/g,
    /(^|[^A-Za-z0-9_])_(?=[^\s_])([^_\n]*?[^\s_])?_(?![A-Za-z0-9_])/g,
];

// Strips paired emphasis outside code spans; a lone `**` (as in a glob) is text.
function stripEmphasis(s) {
    return s.split(/(`[^`\n]*`)/).map((part, i) => {
        if (i % 2 === 1) return part;
        let out = part;
        for (const re of EMPHASIS) out = out.replace(re, (_m, pre, inner) => `${pre}${inner || ''}`);
        return out;
    }).join('');
}

function normaliseForRepair(s, seeAlso = false) {
    let out = s
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '[$1]()')
        .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '[[|$1]]');
    if (seeAlso) {
        out = out
            .replace(/\[\[[^\]|]*\]\]/g, '[[]]')
            .replace(/<https?:\/\/[^>]+>/g, '<>');
    }
    out = out.replace(/^[ \t]*[-*+][ \t]+/gm, '- ');
    return stripEmphasis(out)
        .replace(/\s+/g, ' ')
        .trim();
}

function same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

function nonBlankLines(s) {
    return s.split('\n').filter((l) => l.trim() !== '').length;
}

// The text appended to an append-only section, or null when the base text is not a prefix.
function appended(baseContent, curContent) {
    const b = baseContent.trimEnd();
    const c = curContent.trimEnd();
    if (!c.startsWith(b)) return null;
    const extra = c.slice(b.length);
    return extra === '' || b === '' || extra.startsWith('\n') ? extra : null;
}

// Top-level lines must be dated bullets; indented lines belong to the entry above them.
function undatedObservation(text) {
    const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
    const top = stripped.split('\n').filter((l) => l.trim() !== '' && !/^\s/.test(l));
    return top.some((l) => !DATED_ENTRY.test(l));
}

function lockedDiff(baseText, curText) {
    const b = parseRecord(baseText);
    const c = parseRecord(curText);
    const out = [];

    // Edit 2, move: the file becomes a stub pointing at its new id.
    if (isEmpty(b.fm.moved_to) && !isEmpty(c.fm.moved_to)) {
        for (const key of new Set([...b.order, ...c.order])) {
            if (key !== 'moved_to' && !same(b.fm[key], c.fm[key])) out.push(`a moved record keeps its frontmatter; ${key} changed`);
        }
        if (nonBlankLines(c.body) > 1) out.push('a moved record is a stub with a one-line body');
        return out;
    }

    const backfillOpen = isUnclassified(b.fm);
    const keys = [...new Set([...b.order, ...c.order])];
    for (const key of keys) {
        const bv = b.fm[key];
        const cv = c.fm[key];
        if (same(bv, cv)) continue;
        if (key === 'status') {
            if (!(STATUS_MOVES[bv] || []).includes(cv)) {
                out.push(`status ${bv} -> ${cv} is not an allowed transition`);
            }
        } else if (key === 'superseded_by') {
            if (!isEmpty(bv)) out.push('superseded_by is already set and cannot change');
            else if (c.fm.status !== 'superseded') {
                // A proposed supersession is a Status note only: a link set early could never
                // be corrected if the successor were rejected. A record already superseded
                // on the base (a legacy one without its link) may gain the link alone.
                out.push('superseded_by is set only together with status: superseded');
            }
        } else if (key === 'decided_by' && decidedBy(b.fm).length && !same(decidedBy(b.fm), cv)) {
            out.push('decided_by cannot replace the deciders already recorded');
        } else if (BACKFILL_KEYS.includes(key)) {
            if (!backfillOpen) out.push(`${key} cannot change once the record is classified; supersede instead`);
            else if (!isEmpty(bv)) out.push(`${key} is set on the base and cannot change; supersede instead`);
        } else {
            out.push(`frontmatter ${key} changed; only status, superseded_by and backfilled keys may`);
        }
    }

    // Classification is all-or-nothing: a half-classified record could never be completed.
    // Checked only when this change writes it, so an untouched record always passes.
    const classifying = !same(b.fm.reversibility, c.fm.reversibility) || !same(b.fm.blast_radius, c.fm.blast_radius);
    if (backfillOpen && classifying && !(isEmpty(c.fm.reversibility) && isEmpty(c.fm.blast_radius))) {
        if (isEmpty(c.fm.reversibility) || isEmpty(c.fm.blast_radius) || !('sensitivity' in c.fm) || !('scope' in c.fm)) {
            out.push('classify a record in one change: reversibility, blast_radius, sensitivity and scope together');
        }
    }

    const bs = sections(b.body);
    const cs = sections(c.body);
    const cByHeading = new Map(cs.map((s) => [s.heading, s]));
    const bHeadings = bs.map((s) => s.heading);
    const cHeadings = cs.map((s) => s.heading);
    const added = cHeadings.filter((h) => !bHeadings.includes(h));
    const cWithoutAdded = cHeadings.filter((h) => bHeadings.includes(h));
    if (added.some((h) => h !== 'Later observations')) {
        out.push(`sections added: ${added.filter((h) => h !== 'Later observations').join(', ')}`);
    }
    if (!same(cWithoutAdded, bHeadings.filter((h) => cHeadings.includes(h)))) {
        out.push('sections were reordered');
    }

    let statusGrew = false;
    for (const base of bs) {
        const cur = cByHeading.get(base.heading);
        const label = base.heading === null ? 'the title block' : `section "${base.heading}"`;
        if (!cur) {
            out.push(`${label} was removed`);
            continue;
        }
        if (APPEND_ONLY.has(base.heading)) {
            const extra = appended(base.content, cur.content);
            if (extra === null) {
                out.push(`${label} may only grow at the end`);
            } else if (base.heading === 'Status') {
                statusGrew = extra.trim() !== '';
                if (nonBlankLines(extra) > 1) out.push('append one line to ## Status per change (a transition or a note)');
            } else if (extra.trim() !== '' && undatedObservation(extra)) {
                out.push('each later observation is a bullet that starts with its date');
            }
        } else if (normaliseForRepair(base.content, base.heading === 'See also') !== normaliseForRepair(cur.content, base.heading === 'See also')) {
            out.push(`${label} changed; only formatting and link targets may change on a locked record`);
        }
    }
    if (added.includes('Later observations')) {
        const obs = cByHeading.get('Later observations').content;
        if (obs.trim() !== '' && undatedObservation(obs)) {
            out.push('each later observation is a bullet that starts with its date');
        }
    }
    if (!same(b.fm.status, c.fm.status) && !statusGrew) {
        out.push('a status transition needs a line appended to ## Status');
    }
    return out;
}

module.exports = { lockedDiff, normaliseForRepair };
