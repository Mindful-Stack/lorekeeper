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
        // YAML double-quoted escapes: \n and \t are characters, any other \x is x.
        return s.slice(1, -1).replace(/\\(.)/g, (_m, c) => ({ n: '\n', t: '\t' }[c] || c));
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

// Returns { found, fm, order, errors, errorKeys, blockKeys, blockRaw, body }. `fm` maps
// key -> string | string[] ('' for an empty value); `order` lists keys as written. `errorKeys[i]`
// is the key `errors[i]` is about, or null. `blockKeys` lists keys whose value was written as
// block YAML (reported once each in `errors`, and not parsed into `fm`); `blockRaw[key]` keeps
// that block as written ({ indicator, lines }) so decodeBlock can read the legacy forms.
function parseRecord(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const result = {
        found: false, fm: Object.create(null), order: [], errors: [], errorKeys: [],
        blockKeys: [], blockRaw: Object.create(null), body: '',
    };
    const fail = (message, key = null) => {
        result.errors.push(message);
        result.errorKeys.push(key);
    };
    if (lines[0] !== '---') {
        fail('no frontmatter: the file must start with ---');
        result.body = lines.join('\n');
        return result;
    }
    const end = lines.indexOf('---', 1);
    if (end === -1) {
        fail('frontmatter is not closed with ---');
        return result;
    }
    result.found = true;
    result.body = lines.slice(end + 1).join('\n');
    let prevKey = null;
    let open = null;
    for (const line of lines.slice(1, end)) {
        const blockLine = /^\s/.test(line) || line.startsWith('- ');
        if (open !== null && (blockLine || line.trim() === '')) {
            result.blockRaw[open].lines.push(line);
            continue;
        }
        if (line.trim() === '' || /^\s*#/.test(line)) continue;
        if (blockLine) {
            if (!result.blockKeys.includes(prevKey)) {
                result.blockKeys.push(prevKey);
                fail(`block value under "${prevKey}": every value must be inline on the key's line`, prevKey);
            }
            if (!result.blockRaw[prevKey]) {
                // A block list hangs off an empty value; anything else is a form decodeBlock refuses.
                result.blockRaw[prevKey] = { indicator: result.fm[prevKey] === '' ? '' : '?', lines: [] };
            }
            result.blockRaw[prevKey].lines.push(line);
            open = prevKey;
            continue;
        }
        open = null;
        const m = KEY_LINE.exec(line);
        if (!m) {
            fail(`unparseable frontmatter line: ${line}`);
            continue;
        }
        const key = m[1];
        const raw = stripComment(m[2] || '');
        prevKey = key;
        if (/^[>|][+-]?\s*$/.test(raw.trim())) {
            result.blockKeys.push(key);
            result.blockRaw[key] = { indicator: raw.trim(), lines: [] };
            open = key;
            fail(`${key} is a block scalar (> or |): put the value on one line`, key);
            continue;
        }
        if (key in result.fm) {
            fail(`duplicate key: ${key}`, key);
            continue;
        }
        const parsed = parseValue(raw);
        if (parsed.error) {
            fail(`${key}: ${parsed.error}`, key);
            continue;
        }
        result.fm[key] = parsed.value;
        result.order.push(key);
    }
    return result;
}

// The value a legacy block form means, for the forms older tooling wrote: a folded scalar (`>`,
// lines joined with single spaces), a literal scalar (`|`, lines joined with newlines), either
// with a `+`/`-` chomping indicator (the trailing newline is dropped either way), and a block
// list of plain or quoted `- item` lines. Returns { ok: true, value } or { ok: false } for any
// other form (indentation indicators, folded paragraphs, nested items, ...).
function decodeBlock(raw) {
    if (!raw) return { ok: false };
    const lines = raw.lines.slice();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length === 0) return { ok: false };
    if (raw.indicator === '') {
        if (!lines.every((l) => /^\s*- \S/.test(l))) return { ok: false };
        const items = lines.map((l) => stripComment(l.replace(/^\s*- /, '')).trim());
        if (items.some((i) => i === '' || /^[[{&*!|>]/.test(i) || /:(\s|$)/.test(i))) return { ok: false };
        return { ok: true, value: items.map(unquote) };
    }
    const m = /^([>|])[+-]?$/.exec(raw.indicator);
    if (!m) return { ok: false };
    const indent = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => /^\s*/.exec(l)[0].length));
    if (indent === 0) return { ok: false };
    const body = lines.map((l) => l.slice(indent));
    if (m[1] === '>') {
        if (body.some((l) => l.trim() === '' || /^\s/.test(l))) return { ok: false };
        return { ok: true, value: body.join(' ') };
    }
    return { ok: true, value: body.join('\n') };
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

module.exports = { parseRecord, decodeBlock, sections, isEmpty, asList };
