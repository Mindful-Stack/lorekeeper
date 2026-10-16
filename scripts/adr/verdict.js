'use strict';

// The merge gate for the ADR review: classified findings (from the architect) in, a verdict
// with a blocking count out. Pure: the CLI does the reading.

// One row per finding class. Behaviour-doc findings (a later plan) add `behaviour-rule`.
const SEVERITY = {
    contradiction: 'critical',
    uncovered: 'critical',
    trigger: 'critical',
    'stale-fact': 'minor',
    dangling: 'important',
};
const BLOCKING = new Set(['critical']);

function fail(message) {
    const e = new Error(message);
    e.invalidFindings = true;
    return e;
}

// Accepts the JSON document, or a markdown report holding it in an ```adr-findings block.
function parseFindings(text) {
    const blocks = text.match(/```adr-findings\s*\n([\s\S]*?)\n```/g);
    if (blocks && blocks.length > 1) throw fail('more than one adr-findings block');
    const block = /```adr-findings\s*\n([\s\S]*?)\n```/.exec(text);
    let doc;
    try {
        doc = JSON.parse(block ? block[1] : text);
    } catch (e) {
        throw fail(`findings are not valid JSON: ${e.message}`);
    }
    if (!doc || !Array.isArray(doc.findings)) throw fail('findings document needs a "findings" array');
    return doc.findings.map((x, i) => {
        const at = `finding ${i + 1}`;
        if (!x || typeof x !== 'object') throw fail(`${at}: not an object`);
        if (!Object.prototype.hasOwnProperty.call(SEVERITY, x.class)) throw fail(`${at}: unknown class ${x.class}`);
        if (!Array.isArray(x.ids) || !x.ids.every((id) => typeof id === 'string')) throw fail(`${at}: ids must be an array of strings`);
        if (typeof x.summary !== 'string' || !x.summary.trim()) throw fail(`${at}: summary is required`);
        // Only the known keys are kept; an extra one (older output's `introduced`) is ignored.
        return { class: x.class, ids: x.ids, summary: x.summary, where: x.where || null };
    });
}

function verdict({ findings }) {
    const out = findings.map((x) => {
        if (!Object.prototype.hasOwnProperty.call(SEVERITY, x.class)) throw fail(`unknown class ${x.class}`);
        const severity = SEVERITY[x.class];
        return { ...x, severity, blocking: BLOCKING.has(severity) };
    });
    const counts = { critical: 0, important: 0, minor: 0 };
    for (const x of out) counts[x.severity]++;
    return { blocking: out.filter((x) => x.blocking).length, counts, findings: out };
}

module.exports = { SEVERITY, parseFindings, verdict };
