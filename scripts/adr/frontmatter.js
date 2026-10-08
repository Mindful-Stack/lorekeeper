'use strict';

// Records keep every frontmatter value inline, one key per line, because retrieval greps
// `^key:`. This parser accepts exactly that subset of YAML and reports anything else.

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):(?:[ \t]+(.*))?$/;

function stripComment(raw) {
    let quote = null;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (quote) {
            if (c === '\\' && quote === '"') i++;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
            return raw.slice(0, i);
        }
    }
    return raw;
}

function unquote(s) {
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
        return s.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
        return s.slice(1, -1).replace(/''/g, "'");
    }
    return s;
}

function splitList(inner) {
    const items = [];
    let quote = null;
    let cur = '';
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (quote) {
            cur += c;
            if (c === '\\' && quote === '"' && i + 1 < inner.length) cur += inner[++i];
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
            cur += c;
        } else if (c === ',') {
            items.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    items.push(cur);
    return items.map((s) => unquote(s.trim())).filter((s) => s !== '');
}

function parseValue(raw) {
    const v = raw.trim();
    if (v === '') return { value: '' };
    if (v[0] === '[') {
        if (v[v.length - 1] !== ']') return { error: 'list does not close on the same line' };
        return { value: splitList(v.slice(1, -1)) };
    }
    return { value: unquote(v) };
}

// Returns { found, fm, order, errors, blockKeys, body }. `fm` maps key -> string | string[]
// ('' for an empty value); `order` lists keys as written; `blockKeys` lists keys whose value
// was written as block YAML (reported once each in `errors`, and not parsed).
function parseRecord(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const result = { found: false, fm: Object.create(null), order: [], errors: [], blockKeys: [], body: '' };
    if (lines[0] !== '---') {
        result.errors.push('no frontmatter: the file must start with ---');
        result.body = lines.join('\n');
        return result;
    }
    const end = lines.indexOf('---', 1);
    if (end === -1) {
        result.errors.push('frontmatter is not closed with ---');
        return result;
    }
    result.found = true;
    result.body = lines.slice(end + 1).join('\n');
    let prevKey = null;
    for (const line of lines.slice(1, end)) {
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        if (/^\s/.test(line) || line.startsWith('- ')) {
            if (!result.blockKeys.includes(prevKey)) {
                result.blockKeys.push(prevKey);
                result.errors.push(`block value under "${prevKey}": every value must be inline on the key's line`);
            }
            continue;
        }
        const m = KEY_LINE.exec(line);
        if (!m) {
            result.errors.push(`unparseable frontmatter line: ${line}`);
            continue;
        }
        const key = m[1];
        const raw = stripComment(m[2] || '');
        prevKey = key;
        if (/^[>|][+-]?\s*$/.test(raw.trim())) {
            result.blockKeys.push(key);
            result.errors.push(`${key} is a block scalar (> or |): put the value on one line`);
            continue;
        }
        if (key in result.fm) {
            result.errors.push(`duplicate key: ${key}`);
            continue;
        }
        const parsed = parseValue(raw);
        if (parsed.error) {
            result.errors.push(`${key}: ${parsed.error}`);
            continue;
        }
        result.fm[key] = parsed.value;
        result.order.push(key);
    }
    return result;
}

function isEmpty(v) {
    return v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asList(v) {
    if (isEmpty(v)) return [];
    return Array.isArray(v) ? v : [v];
}

// Level-2 sections in document order. The text before the first `## ` heading is the
// section with heading null. Headings inside fenced code blocks are ignored.
function sections(body) {
    const out = [{ heading: null, lines: [] }];
    let fenced = false;
    for (const line of body.split('\n')) {
        if (/^(```|~~~)/.test(line)) fenced = !fenced;
        const m = !fenced && /^## (.+?)\s*$/.exec(line);
        if (m) out.push({ heading: m[1], lines: [] });
        else out[out.length - 1].lines.push(line);
    }
    return out.map((s) => ({ heading: s.heading, content: s.lines.join('\n') }));
}

module.exports = { parseRecord, sections, isEmpty, asList };
