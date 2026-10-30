'use strict';

// Behaviour docs: the rules a capability must keep, beside the ADRs that say why. Same homes
// as ADRs (each repo's docs/behaviour, the KB's behaviour/), a different file shape: any
// `<capability>.md`, rules as `### <prefix>.R<n> <name>` headings under `## Rules`.

const fs = require('fs');
const path = require('path');
const { parseRecord } = require('./frontmatter');
const { walk } = require('./markdown');

const PREFIX_RE = /^[a-z][a-z0-9-]*$/;
// `<home>/<prefix>`; a prefix is lowercase, so an ADR id (`kb/ADR-0001`) never matches.
const DOC_ID_RE = /^[A-Za-z0-9._-]+\/[a-z][a-z0-9-]*$/;
const RULE_HEAD = /^([a-z][a-z0-9-]*)\.(R[1-9]\d*)\s+(\S.*?)\s*$/;

function parseDoc(file, text) {
    const parsed = parseRecord(text);
    const prefix = typeof parsed.fm.prefix === 'string' ? parsed.fm.prefix : '';
    const { sections, lines } = walk(parsed.body);
    const headings = [];
    const deviations = [];
    let cur = null;
    for (const { section, text: line } of lines) {
        if (section === 'Rules') {
            const h = /^ {0,3}###\s+(.*?)\s*$/.exec(line);
            if (h) {
                const m = RULE_HEAD.exec(h[1]);
                const ok = m && m[1] === prefix;
                cur = { raw: h[1], id: ok ? `${m[1]}.${m[2]}` : null, n: ok ? m[2] : null, name: ok ? m[3] : null, sources: [], body: [] };
                headings.push(cur);
                continue;
            }
            if (cur) {
                const s = /^\s*[-*]\s+Source:\s*(.+?)\s*$/.exec(line);
                if (s) cur.sources.push(...s[1].split(',').map((x) => x.trim()).filter(Boolean));
                cur.body.push(line);
            }
        } else {
            cur = null;
            const d = section === 'Known deviations' && /^[-*]\s+([^:]+):/.exec(line);
            if (d) deviations.push(...d[1].split(',').map((x) => x.trim()).filter(Boolean));
        }
    }
    for (const h of headings) h.body = h.body.join('\n');
    return {
        file, name: path.basename(file), text, found: parsed.found, fm: parsed.fm, errors: parsed.errors,
        sections, headings, deviations,
    };
}

// The R<n> of every well-formed rule in a doc's text, for checking finding ids.
function ruleNumbers(text) {
    return parseDoc('', text).headings.filter((h) => h.id).map((h) => h.n);
}

// Every behaviour doc in a home: `.md` files other than `_`-prefixed ones and a README.
function loadBehaviourHome(dir) {
    const docs = [];
    if (!fs.existsSync(dir)) return { docs };
    for (const name of fs.readdirSync(dir).sort()) {
        if (name.startsWith('_') || !name.endsWith('.md') || name.toLowerCase() === 'readme.md') continue;
        const file = path.join(dir, name);
        docs.push(parseDoc(file, fs.readFileSync(file, 'utf8')));
    }
    return { docs };
}

module.exports = { PREFIX_RE, DOC_ID_RE, RULE_HEAD, parseDoc, ruleNumbers, loadBehaviourHome };
