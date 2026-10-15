'use strict';

// The merge gate for the ADR review: classified findings (from the architect) plus exemptions
// (from the PR body and commit trailers) in, a verdict with a blocking count out. Pure: the
// CLI does the reading.

// One row per finding class. Behaviour-doc findings (a later plan) add `behaviour-rule`.
const SEVERITY = {
    contradiction: 'critical',
    uncovered: 'critical',
    trigger: 'critical',
    'stale-fact': 'minor',
    dangling: 'important',
};
const BLOCKING = new Set(['critical']);

// An exemption target: a qualified record id, optionally one of its rules or facts.
// Behaviour rule ids (`<home>/<prefix>.R<n>`) are added here by the behaviour-doc plan.
const TARGET_RE = /^[A-Za-z0-9._-]+\/ADR-\d{4}(?:\.[RF]\d+)?$/;
// Anything that starts like a record id is meant as a targeted exemption: it is either a
// well-formed `<id> — <reason>` or invalid, never a whole-PR exemption.
const LOOKS_TARGETED_RE = /^[A-Za-z0-9._-]+\/ADR-\d/;
// A list bullet or quote marker before the key is allowed (Decisions-style lists invite it), and
// the key is case-insensitive, as git's trailer `key=` match is.
const LINE_RE = /^\s*(?:[-*>]\s*)?ADR-Exempt:(.*)$/i;
const TARGETED_RE = /^(\S+)\s+(?:—|–|--|-|:)\s+(.+)$|^(\S+?):\s+(.+)$/;

function fail(message) {
    const e = new Error(message);
    e.invalidFindings = true;
    return e;
}

// Accepts the JSON document, or a markdown report holding it in an ```adr-findings block.
function parseFindings(text) {
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
        if (x.introduced !== undefined && typeof x.introduced !== 'boolean') throw fail(`${at}: introduced must be true or false`);
        return { class: x.class, ids: x.ids, summary: x.summary, where: x.where || null, introduced: x.introduced !== false };
    });
}

// sources: [{ source: 'pr-body' | 'trailer', text }]
function parseExemptions(sources) {
    const exemptions = [];
    const invalid = [];
    for (const { source, text } of sources) {
        for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
            const m = LINE_RE.exec(line);
            if (!m) continue;
            const value = m[1].trim();
            if (!value) {
                invalid.push({ source, line: line.trim(), problem: 'no reason given' });
                continue;
            }
            const t = TARGETED_RE.exec(value);
            const target = t && (t[1] || t[3]);
            if (target && TARGET_RE.test(target)) {
                exemptions.push({ source, target, reason: (t[2] || t[4]).trim() });
                continue;
            }
            // A malformed targeted line (no reason, no spaced separator, a list of ids, a bad id)
            // must never widen into a whole-PR exemption.
            if (LOOKS_TARGETED_RE.test(value)) {
                invalid.push({ source, line: line.trim(), problem: 'names a record but is not "<id> — <reason>" (one id per line)' });
            } else {
                exemptions.push({ source, target: null, reason: value });
            }
        }
    }
    return { exemptions, invalid };
}

const covers = (target, id) => id === target || id.startsWith(`${target}.`);

// The most specific ids of a finding: a record id is dropped when one of its rules or facts is
// also listed. Exempting one rule must not clear a finding that also breaks another.
const leaves = (ids) => ids.filter((id) => !ids.some((o) => o !== id && o.startsWith(`${id}.`)));

// Index of the exemption(s) that clear this finding, or -1. A bare exemption clears anything;
// otherwise every leaf id needs a covering exemption, and a finding with no ids needs a bare one.
function exemptionFor(finding, exemptions) {
    const bare = exemptions.findIndex((e) => e.target === null);
    if (bare !== -1) return [bare];
    const ls = leaves(finding.ids);
    if (!ls.length) return -1;
    const hits = ls.map((id) => exemptions.findIndex((e) => covers(e.target, id)));
    return hits.includes(-1) ? -1 : [...new Set(hits)];
}

function verdict({ findings, exemptions, invalidExemptions = [], prBody = null }) {
    const used = exemptions.map(() => false);
    const out = findings.map((x) => {
        let severity = SEVERITY[x.class];
        // Only an explicit false: a finding built without the key was introduced by this change.
        if (x.introduced === false && severity === 'critical') severity = 'important';
        let exemptedBy = null;
        if (BLOCKING.has(severity)) {
            const hit = exemptionFor(x, exemptions);
            if (hit !== -1) {
                exemptedBy = hit;
                for (const i of hit) used[i] = true;
                severity = 'important';
            }
        }
        return { ...x, severity, blocking: BLOCKING.has(severity), exemptedBy };
    });
    const counts = { critical: 0, important: 0, minor: 0 };
    for (const x of out) counts[x.severity]++;
    return {
        blocking: out.filter((x) => x.blocking).length,
        exempted: out.filter((x) => x.exemptedBy !== null).length,
        counts,
        findings: out,
        exemptions: exemptions.map((e, i) => ({ ...e, used: used[i] })),
        invalidExemptions,
        decisionsSection: prBody === null ? null : /^#{1,6}\s+Decisions\s*$/m.test(prBody),
    };
}

module.exports = { SEVERITY, TARGET_RE, parseFindings, parseExemptions, verdict };
