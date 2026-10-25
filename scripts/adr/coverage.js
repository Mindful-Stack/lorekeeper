'use strict';

// Deterministic checks on a reviewer's findings document, against the candidates `select`
// computes and the records themselves. `coverage.checked` is the reviewer's attestation; this
// cannot prove the records were read, only that every selected record was attested and that no
// finding cites a record, rule or fact that does not exist. Errors here mean exit 2.

const { sections } = require('./frontmatter');

function fail(message) {
    const e = new Error(message);
    e.invalidFindings = true;
    return e;
}

// Ids opening a list item in one section, skipping fenced examples. `sections` already ignores
// headings inside fences; this also ignores list items inside them.
function idsIn(text, heading, re) {
    const s = sections(text.replace(/\r\n/g, '\n')).find((x) => x.heading === heading);
    const out = [];
    let fenced = false;
    for (const line of (s ? s.content : '').split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        const m = !fenced && re.exec(line);
        if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
}
const ruleIds = (text) => idsIn(text, 'Decision', /^\s*[-*]\s+\*\*(R\d+)\*\*/);
const factIds = (text) => idsIn(text, 'Facts relied on', /^\s*[-*]\s+(F\d+)\b/);
const recordOf = (id) => id.replace(/\.[RF]\d+$/, '');

const RECORD_CLASSES = new Set(['contradiction', 'trigger', 'stale-fact']);
const strings = (x) => Array.isArray(x) && x.every((y) => typeof y === 'string');

// doc: { coverage, findings }; picked: select output; recordText(id) → text or null.
function validate({ doc, picked, recordText }) {
    const cov = doc.coverage;
    if (!cov || typeof cov !== 'object' || !strings(cov.checked) || !strings(cov.notReviewed)) {
        throw fail('findings document needs "coverage": {"checked": [ids], "notReviewed": [strings]}');
    }
    for (const id of cov.checked) {
        if (!recordText(id)) throw fail(`coverage: checked ${id} does not resolve to a record`);
    }
    const attested = new Set(cov.checked);
    for (const f of doc.findings) {
        if (!RECORD_CLASSES.has(f.class)) continue;
        const records = [...new Set(f.ids.map(recordOf))];
        if (records.length !== 1) throw fail(`${f.class}: ids must name exactly one record, got ${records.length ? 'more than one record' : 'none'}`);
        const [rec] = records;
        const text = recordText(rec);
        if (!text) throw fail(`${f.class}: ${rec} does not resolve to a record`);
        const rules = ruleIds(text);
        const facts = factIds(text);
        for (const id of f.ids.filter((x) => x !== rec)) {
            const n = id.slice(rec.length + 1);
            if (!(n[0] === 'R' ? rules : facts).includes(n)) throw fail(`${f.class}: ${id} names no ${n} in ${rec}`);
        }
        if (f.class === 'contradiction' && rules.length && !f.ids.some((id) => /\.R\d+$/.test(id))) {
            throw fail(`contradiction on ${rec} must cite a rule id (${rules.join(', ')})`);
        }
        attested.add(rec);
    }
    const unchecked = picked.filter((p) => p.status !== 'missing' && !attested.has(p.id)).map((p) => p.id);
    if (unchecked.length) throw fail(`selected records not checked: ${unchecked.join(', ')}`);
    const reported = new Set(doc.findings.filter((f) => f.class === 'dangling').flatMap((f) => f.ids));
    const selected = new Set(picked.map((p) => p.id));
    return {
        extra: cov.checked.filter((id) => !selected.has(id)),
        notReviewed: cov.notReviewed,
        dangling: picked.filter((p) => p.status === 'missing' && !reported.has(p.id)).map((p) => p.id),
    };
}

module.exports = { ruleIds, factIds, recordOf, validate };
