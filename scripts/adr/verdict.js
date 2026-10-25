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

// A fenced-code-block opener for `adr-findings`, per CommonMark: 0-3 spaces of indentation,
// then a run of 3 or more backticks or tildes, then the info string "adr-findings" and nothing
// else (trailing spaces/tabs aside) on the line.
const OPENER_RE = /^ {0,3}(`{3,}|~{3,})adr-findings[ \t]*$/;

// A valid closer for an opener with fence character `fenceChar` and run length `minLen`: 0-3
// spaces of indentation, a run of at least `minLen` of that same character, and nothing but
// whitespace after it.
function closerRe(fenceChar, minLen) {
    const esc = fenceChar === '`' ? '`' : '~';
    return new RegExp(`^ {0,3}${esc}{${minLen},}[ \\t]*$`);
}

function findOpeners(lines) {
    const openers = [];
    lines.forEach((line, i) => {
        const m = OPENER_RE.exec(line);
        if (m) openers.push({ line: i, fence: m[1][0], len: m[1].length });
    });
    return openers;
}

// Accepts the JSON document, or a markdown report holding it in an ```adr-findings block.
//
// Cardinality is checked on opener *lines*, not on closed blocks: a block regex that only
// matches a terminated fence would silently ignore an opener with no closing ``` and judge
// whatever closed block it did find (or none), hiding a second, unterminated block's contents
// from the verdict entirely. Openers and closers are matched per CommonMark fence rules (0-3
// spaces of indentation; a tilde fence or a longer run of backticks is still an opener; the
// closer must use the same fence character, a run at least as long, and hold nothing else).
function parseFindings(text) {
    text = text.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    const openers = findOpeners(lines);
    if (openers.length > 1) throw fail('more than one adr-findings block');
    let block = null;
    if (openers.length === 1) {
        const { line: openLine, fence, len } = openers[0];
        const closeRe = closerRe(fence, len);
        let closeLine = -1;
        for (let i = openLine + 1; i < lines.length; i++) {
            if (closeRe.test(lines[i])) {
                closeLine = i;
                break;
            }
        }
        if (closeLine === -1) throw fail('adr-findings block is not terminated by a closing ```');
        block = lines.slice(openLine + 1, closeLine).join('\n');
    }
    let doc;
    try {
        doc = JSON.parse(block !== null ? block : text);
    } catch (e) {
        throw fail(`findings are not valid JSON: ${e.message}`);
    }
    if (!doc || !Array.isArray(doc.findings)) throw fail('findings document needs a "findings" array');
    const findings = doc.findings.map((x, i) => {
        const at = `finding ${i + 1}`;
        if (!x || typeof x !== 'object') throw fail(`${at}: not an object`);
        if (!Object.prototype.hasOwnProperty.call(SEVERITY, x.class)) throw fail(`${at}: unknown class ${x.class}`);
        if (!Array.isArray(x.ids) || !x.ids.every((id) => typeof id === 'string')) throw fail(`${at}: ids must be an array of strings`);
        if (typeof x.summary !== 'string' || !x.summary.trim()) throw fail(`${at}: summary is required`);
        if (x.where !== undefined && x.where !== null && typeof x.where !== 'string') throw fail(`${at}: where must be a string`);
        if (x.class !== 'dangling' && (typeof x.where !== 'string' || !x.where.trim())) throw fail(`${at}: ${x.class} needs "where"`);
        // Only the known keys are kept; an extra one (older output's `introduced`) is ignored.
        return { class: x.class, ids: x.ids, summary: x.summary, where: x.where || null };
    });
    return { coverage: doc.coverage, findings };
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
