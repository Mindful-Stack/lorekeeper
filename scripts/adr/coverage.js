'use strict';

const { walk } = require('./markdown');
const { DOC_ID_RE, ruleNumbers } = require('./behaviour');

// Deterministic checks on a reviewer's findings document, against the candidates `select`
// computes and the records themselves. `coverage.checked` is the reviewer's attestation; this
// cannot prove the records were read, only that every selected record was attested and that no
// finding cites a record, rule or fact that does not exist. Errors here mean exit 2.

function fail(message) {
    const e = new Error(message);
    e.invalidFindings = true;
    return e;
}

// Ids opening a list item in one `## heading` section, skipping fenced examples.
function idsIn(text, heading, re) {
    const out = [];
    for (const { section, text: line } of walk(text).lines) {
        const m = section === heading && re.exec(line);
        if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
}
const ruleIds = (text) => idsIn(text, 'Decision', /^\s*[-*]\s+\*\*(R\d+)\*\*/);
const factIds = (text) => idsIn(text, 'Facts relied on', /^\s*[-*]\s+(F\d+)\b/);
const recordOf = (id) => id.replace(/\.[RF]\d+$/, '');

// Which kind of document each finding class must name.
const DOC_CLASSES = { contradiction: 'adr', trigger: 'adr', 'stale-fact': 'adr', 'behaviour-rule': 'behaviour' };
const strings = (x) => Array.isArray(x) && x.every((y) => typeof y === 'string');

// doc: { coverage, findings }; picked: select output; recordText(id) → text or null;
// kindOf(id) → 'adr' | 'behaviour' | null (the catalogue's view). Selected ids win, then
// kindOf, then the id's shape.
function validate({ doc, picked, recordText, kindOf }) {
    const pickedKind = new Map(picked.filter((p) => p.doc).map((p) => [p.id, p.doc]));
    const kind = (id) => pickedKind.get(id) || (kindOf && kindOf(id)) || (DOC_ID_RE.test(id) ? 'behaviour' : 'adr');
    const cov = doc.coverage;
    if (!cov || typeof cov !== 'object' || !strings(cov.checked) || !strings(cov.notReviewed)) {
        throw fail('findings document needs "coverage": {"checked": [ids], "notReviewed": [strings]}');
    }
    // A selected id that resolves nowhere is reported as dangling below, so attesting it is fine.
    const missing = new Set(picked.filter((p) => p.status === 'missing').map((p) => p.id));
    for (const id of cov.checked) {
        if (!missing.has(id) && !recordText(id)) throw fail(`coverage: checked ${id} does not resolve to a record or behaviour doc`);
    }
    const attested = new Set(cov.checked);
    for (const f of doc.findings) {
        const want = DOC_CLASSES[f.class];
        if (!want) continue;
        const noun = want === 'adr' ? 'record' : 'behaviour doc';
        const records = [...new Set(f.ids.map(recordOf))];
        if (records.length !== 1) throw fail(`${f.class}: ids must name exactly one ${noun}, got ${records.length ? `more than one ${noun}` : 'none'}`);
        const [rec] = records;
        const isDoc = kind(rec) === 'behaviour';
        if (want === 'adr' && isDoc) throw fail(`${f.class} names ${rec}, which is a behaviour doc; use behaviour-rule`);
        if (want === 'behaviour' && !isDoc) throw fail(`behaviour-rule names ${rec}, which is not a behaviour doc`);
        const text = recordText(rec);
        if (!text) throw fail(`${f.class}: ${rec} does not resolve to a ${noun}`);
        if (want === 'behaviour') {
            const rules = ruleNumbers(text);
            for (const id of f.ids.filter((x) => x !== rec)) {
                const n = id.slice(rec.length + 1);
                if (!rules.includes(n)) throw fail(`behaviour-rule: ${id} names no ${n} in ${rec}`);
            }
            if (!f.ids.some((id) => /\.R\d+$/.test(id))) throw fail(`behaviour-rule on ${rec} must cite a rule id (${rules.join(', ')})`);
        } else {
            const rules = ruleIds(text);
            const facts = factIds(text);
            for (const id of f.ids.filter((x) => x !== rec)) {
                const n = id.slice(rec.length + 1);
                if (!(n[0] === 'R' ? rules : facts).includes(n)) throw fail(`${f.class}: ${id} names no ${n} in ${rec}`);
            }
            if (f.class === 'contradiction' && rules.length && !f.ids.some((id) => /\.R\d+$/.test(id))) {
                throw fail(`contradiction on ${rec} must cite a rule id (${rules.join(', ')})`);
            }
        }
        attested.add(rec);
    }
    const unchecked = picked.filter((p) => p.status !== 'missing' && !attested.has(p.id)).map((p) => p.id);
    if (unchecked.length) throw fail(`selected records or behaviour docs not checked: ${unchecked.join(', ')}`);
    const reported = new Set(doc.findings.filter((f) => f.class === 'dangling').flatMap((f) => f.ids));
    const selected = new Set(picked.map((p) => p.id));
    return {
        extra: cov.checked.filter((id) => !selected.has(id)),
        notReviewed: cov.notReviewed,
        dangling: picked.filter((p) => p.status === 'missing' && !reported.has(p.id)).map((p) => p.id),
    };
}

module.exports = { ruleIds, factIds, recordOf, validate };
