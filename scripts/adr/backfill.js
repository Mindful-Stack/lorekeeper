'use strict';

// Schema backfill (edit 5): adds `id` and empty classification keys to a record that lacks
// them. Only absent or empty keys are touched; every other line stays byte-for-byte.

const { parseRecord, isEmpty } = require('./frontmatter');

const EMPTY_KEYS = [
    ['reversibility', 'reversibility:'],
    ['blast_radius', 'blast_radius:'],
    ['sensitivity', 'sensitivity: []'],
    ['scope', 'scope: []'],
];

function backfill(text, id) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const parsed = parseRecord(text);
    // A record with no frontmatter is converted by hand: legacy records may be rewritten in place.
    if (!parsed.found && !text.startsWith('---')) {
        return { text, changed: false, added: [], error: 'no frontmatter: convert it by rewriting (legacy records may be rewritten in place)' };
    }
    if (!parsed.found || parsed.errors.length) {
        return { text, changed: false, added: [], error: parsed.errors[0] || 'no frontmatter' };
    }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const end = lines.indexOf('---', 1);
    const added = [];

    const tail = [];
    for (const [key, line] of EMPTY_KEYS) {
        if (!(key in parsed.fm)) {
            tail.push(line);
            added.push(key);
        }
    }
    lines.splice(end, 0, ...tail);

    if (!('id' in parsed.fm)) {
        lines.splice(1, 0, `id: ${id}`);
        added.unshift('id');
    } else if (isEmpty(parsed.fm.id)) {
        const at = lines.findIndex((l, i) => i > 0 && i < end && /^id:/.test(l));
        lines[at] = `id: ${id}`;
        added.unshift('id');
    }

    return { text: lines.join(eol), changed: added.length > 0, added };
}

module.exports = { backfill };
