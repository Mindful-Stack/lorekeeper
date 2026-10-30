'use strict';

// Behaviour docs: the rules a capability must keep, beside the ADRs that say why. Same homes
// as ADRs (each repo's docs/behaviour, the KB's behaviour/), a different file shape: any
// `<capability>.md`, rules as `### <prefix>.R<n> <name>` headings under `## Rules`.

const fs = require('fs');
const path = require('path');
const { walk } = require('./markdown');
const { parseRecord, isEmpty, asList } = require('./frontmatter');
const { globToRegExp, toPosix } = require('./glob');
const { SHARED_SCOPE, PREFIXED } = require('./rules');

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
    const nearSources = [];
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
            const s = cur && /^\s*[-*]\s+Source:\s*(.+?)\s*$/.exec(line);
            if (s) cur.sources.push(...s[1].split(',').map((x) => x.trim()).filter(Boolean));
            else if (/^\s*[-*]?\s*\**source\**\s*:/i.test(line)) nearSources.push(line.trim());
            if (cur) cur.body.push(line);
        } else {
            cur = null;
            const d = section === 'Known deviations' && /^[-*]\s+([^:]+):/.exec(line);
            if (d) deviations.push(...d[1].split(',').map((x) => x.trim()).filter(Boolean));
        }
    }
    for (const h of headings) h.body = h.body.join('\n');
    return {
        file, name: path.basename(file), text, found: parsed.found, fm: parsed.fm, errors: parsed.errors,
        sections, headings, deviations, nearSources,
    };
}

// A loaded doc's id under a home prefix, or null when its `prefix:` is unusable (missing, a list, not lowercase).
function docId(doc, homePrefix) {
    const p = doc.fm.prefix;
    return typeof p === 'string' && PREFIX_RE.test(p) && p !== 'adr' ? `${homePrefix}/${p}` : null;
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

// Rule ids of an ADR, as coverage.ruleIds reads them (kept here to avoid a require cycle).
const adrRuleIds = (text) => [...new Set(walk(text).lines
    .filter((l) => l.section === 'Decision')
    .map((l) => /^\s*[-*]\s+\*\*(R\d+)\*\*/.exec(l.text))
    .filter(Boolean)
    .map((m) => m[1]))];

const SOURCE_RE = /^([A-Za-z0-9._-]+\/ADR-\d{4})(?:\.(R\d+))?$/;

// ctx: { home: {kind, prefix}, docs, resolveRef(qualifiedAdrId), repoFiles(repo|null) }.
// Returns [{ file, rule, level, message }], the shape checkHome returns.
function checkBehaviourHome(ctx) {
    const out = [];
    const err = (file, rule, message) => out.push({ file, rule, level: 'error', message });
    const warn = (file, rule, message) => out.push({ file, rule, level: 'warning', message });
    const byPrefix = new Map();
    for (const d of ctx.docs) {
        const p = d.fm.prefix;
        if (typeof p === 'string' && p) {
            if (!byPrefix.has(p)) byPrefix.set(p, []);
            byPrefix.get(p).push(d);
        }
    }
    for (const d of ctx.docs) checkDoc(ctx, d, byPrefix, err, warn);
    return out;
}

function checkRef(ctx, d, ref, key, allowRule, err, warn) {
    const m = SOURCE_RE.exec(ref);
    if (!m || (m[2] && !allowRule)) return err(d.file, 'relations', `${key} ${ref} is not a qualified ADR id (<home>/ADR-NNNN${allowRule ? '[.R<n>]' : ''})`);
    const found = ctx.resolveRef ? ctx.resolveRef(m[1]) : { state: 'unavailable' };
    if (found.state === 'missing') return err(d.file, 'relations', `${key} ${m[1]} does not exist`);
    if (found.state === 'unavailable') return warn(d.file, 'relations', `${key} ${ref}: its home is not on disk, so it was not checked`);
    if (m[2] && found.text) {
        const rules = adrRuleIds(found.text);
        if (rules.length && !rules.includes(m[2])) err(d.file, 'relations', `${key} ${ref}: ${m[1]} has no ${m[2]}`);
    }
    if (found.fm && found.fm.status === 'superseded') warn(d.file, 'relations', `${key} ${m[1]} is superseded; update the rule to its successor`);
    return undefined;
}

function checkDoc(ctx, d, byPrefix, err, warn) {
    const { home } = ctx;
    const fm = d.fm;
    for (const e of d.errors) err(d.file, 'schema', e);
    if (!d.found) return;
    for (const key of ['title', 'description', 'tags', 'prefix', 'scope']) {
        if (isEmpty(fm[key])) err(d.file, 'schema', `${key} is required`);
    }
    for (const key of ['tags', 'scope', 'related']) {
        if (!isEmpty(fm[key]) && !Array.isArray(fm[key])) err(d.file, 'schema', `${key} must be an inline list ([a, b])`);
    }
    const listPrefix = Array.isArray(fm.prefix);
    const prefix = typeof fm.prefix === 'string' ? fm.prefix : '';
    const badPrefix = !!prefix && (!PREFIX_RE.test(prefix) || prefix === 'adr');
    if (listPrefix) err(d.file, 'prefix', 'prefix must be a single value');
    else if (badPrefix) {
        err(d.file, 'prefix', `prefix ${prefix} must match ^[a-z][a-z0-9-]*$ and may not be adr`);
    }
    const others = (byPrefix.get(prefix) || []).filter((x) => x !== d);
    if (prefix && others.length) err(d.file, 'prefix', `prefix ${prefix} is also used by ${others.map((x) => x.name).join(', ')}`);
    if (!d.sections.includes('Rules')) err(d.file, 'sections', 'needs a ## Rules section');
    if (d.sections.includes('Rules') && !d.headings.length) warn(d.file, 'rules', '## Rules has no rules');
    for (const line of d.nearSources) {
        warn(d.file, 'rules', `"${line}" looks like a Source line but is not read; write "- Source: <id>"`);
    }
    if (!d.sections.includes('Not yet decided')) err(d.file, 'sections', 'needs a ## Not yet decided section (it may say "none")');
    const seen = new Set();
    for (const h of d.headings) {
        if (!h.id) {
            // A list, missing or invalid prefix is already reported once; every heading would repeat it.
            if (!listPrefix && prefix && !badPrefix) err(d.file, 'rules', `"### ${h.raw}" is not a rule heading (### ${prefix || '<prefix>'}.R<n> <name>); a group is a bold label line`);
            continue;
        }
        if (seen.has(h.id)) err(d.file, 'rules', `duplicate rule id ${h.id}`);
        seen.add(h.id);
        if (!/\b(SHALL|MUST)\b/.test(h.body)) warn(d.file, 'rules', `${h.id} has no SHALL or MUST`);
        if (!/^\s*[-*]\s+Example:/m.test(h.body)) warn(d.file, 'rules', `${h.id} has no Example line`);
        for (const s of h.sources) checkRef(ctx, d, s, 'Source', true, err, warn);
    }
    for (const r of asList(fm.related)) checkRef(ctx, d, r, 'related', false, err, warn);
    for (const id of d.deviations) {
        if (!badPrefix && !listPrefix && prefix && !seen.has(id)) warn(d.file, 'deviations', `${id} is not a rule in this doc`);
    }
    for (const s of Array.isArray(fm.scope) ? fm.scope : []) {
        if (home.kind === 'shared' && !SHARED_SCOPE.test(s)) {
            err(d.file, 'scope', `shared-home scope entries are <repo>:<glob>, got ${s}`);
            continue;
        }
        if (home.kind === 'local' && PREFIXED.test(s)) {
            err(d.file, 'scope', `local-home scope entries are globs relative to the repo root, got ${s}`);
            continue;
        }
        const [repo, glob] = home.kind === 'shared' ? [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)] : [null, s];
        const files = ctx.repoFiles ? ctx.repoFiles(repo) : null;
        const re = files && globToRegExp(glob);
        if (files && !files.some((f) => re.test(toPosix(f)))) warn(d.file, 'scope', `${s} matches no tracked file`);
    }
}

module.exports = {
    PREFIX_RE, DOC_ID_RE, RULE_HEAD, docId, parseDoc, ruleNumbers, loadBehaviourHome, checkBehaviourHome, adrRuleIds,
};
