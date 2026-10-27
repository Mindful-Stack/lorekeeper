// scripts/__tests__/helpers/reeve-smoke.js — the real-planner smoke's pure parts (reeve-real-server.test.js runs it):
// the Commands table of references/reeve-cli.md, the coverage of test/fixtures/reeve-real/commands.json, placeholder
// binding, and the shape checks on the planner's and the fake's answers.
'use strict';

const JSON_TYPES = ['null', 'array', 'object', 'string', 'number', 'boolean'];
const FIX_FAKE = 'fix test/fixtures/reeve-bin/reeve';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // JSON.parse yields only object, string, number and boolean besides
}
const firstLine = (text) => String(text || '').trim().split('\n')[0];
function envelopeOf(stdout) {
  try { const e = JSON.parse(stdout); return e && typeof e.outcome === 'string' ? e : null; } catch { return null; }
}

// Every body row of the table under `## Commands` as { row, read }: its two cells, with the Markdown escape `\|` read as
// `|`. PROPERTY: rows of any other table, the header and the separator are never returned.
function commandRows(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Commands');
  if (start < 0) throw new Error('references/reeve-cli.md has no "## Commands" heading');
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break;
    if (!line.startsWith('|')) { if (inTable) break; continue; }
    inTable = true;
    const [, row, read = ''] = line.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    if (row === 'Command' || /^:?-+:?$/.test(row)) continue;
    rows.push({ row, read });
  }
  return rows;
}

const flagsIn = (text) => [...new Set(text.match(/--[a-z][a-z-]*/g) || [])];
const runsOf = (entry) => [entry.argv, ...(entry.alternates || [])];

// The command forms a row names: every `reeve …` span is one (its required flags are those outside `[…]`), and an
// "(or `--flag <V>`)" suffix is the form before it with its first flag replaced by --flag (`comment add --story`).
// PROPERTY: two forms of one row differ in at least one required flag, so a run can cover only one of them.
function formsOf(row) {
  const forms = [];
  for (const m of row.matchAll(/`reeve ([^`]*)`|\(or `(--[a-z][a-z-]*)([^`]*)`\)/g)) {
    if (m[1] !== undefined) {
      forms.push({ label: m[1], words: m[1].split(' ').slice(0, 2).join(' '), required: flagsIn(m[1].replace(/\[[^\]]*\]/g, '')) });
    } else {
      const base = forms[forms.length - 1];
      forms.push({ label: `${base.words} ${m[2]}${m[3]}`, words: base.words, required: [m[2], ...base.required.slice(1)] });
    }
  }
  return forms;
}

// Children of a `{a, b[], c: {d}}` span, as paths under `base`.
function braced(text, base) {
  const out = [];
  const body = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  let depth = 0, cur = '';
  const items = [];
  for (const ch of body) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  for (const item of items) {
    const m = /^\s*([a-z_]+(?:\[\])?)\s*(?::\s*(\{.*\}))?\s*$/s.exec(item);
    if (!m) throw new Error(`cannot read "${item}" in ${text}`);
    const p = `${base}.${m[1]}`;
    out.push(p);
    if (m[2]) out.push(...braced(m[2], p));
  }
  return out;
}
// A path with no field after the base (`value`, `value[]`) is its own parent: `.x` after it is `value.x`.
const parentOf = (p) => (p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : p);
// Backticked words in a Read cell that are prose, not fields. Any other span that is not classified is an error.
const PROSE = new Set(['validation', 'story']);
// The field paths a Read cell names, nesting and relative fields kept. Spans are read left to right:
// - `value…` followed by ":" is a base (`value[]`: …): later bare names and `{…}` right after the ":" are under it;
// - `value…` otherwise is an absolute path; `.x` replaces the last path's final field (`value.brief`, `.owner`);
// - `a.b` (no leading `value`) is under the base (`story.key` after `value[]`: …);
// - a bare name is a field only in the base's list (`value[]`: `key`, `title`): after the ":" or after a "," with at
//   most a parenthetical before it; elsewhere it is prose (`a \`validation\` error`, "kind \`story\`");
// - `{a, b[], c: {d}}` lists children: of the base right after its ":", otherwise of the last path (`closed` …
//   `{at, by, reason}`).
function readPaths(cell) {
  const spans = [...cell.matchAll(/`([^`]*)`/g)];
  const paths = [];
  let base = 'value';
  let last = null;
  let inList = false;
  let prevWasBase = false;
  const absolute = (span) => /^value(\[\]|\.|$)/.test(span);
  spans.forEach((m, i) => {
    const span = m[1];
    const from = i ? spans[i - 1].index + spans[i - 1][0].length : 0;
    const before = cell.slice(from, m.index);
    const after = cell.slice(m.index + m[0].length, i + 1 < spans.length ? spans[i + 1].index : cell.length);
    const afterBase = prevWasBase && /^\s*:\s*$/.test(before);
    inList = afterBase || (inList && /^\s*(\([^)]*\))?\s*,\s*$/.test(before));
    prevWasBase = false;
    if (absolute(span) && /^\s*:/.test(after)) {
      base = span; last = span; paths.push(span); prevWasBase = true;
    } else if (span.startsWith('{')) {
      const parent = afterBase ? base : last;
      if (!parent) throw new Error(`readPaths: ${span} has no field to belong to in ${cell}`);
      paths.push(...braced(span, parent));
    } else if (absolute(span)) {
      last = span; paths.push(span);
    } else if (span.startsWith('.')) {
      if (!last) throw new Error(`readPaths: ${span} has no field to follow in ${cell}`);
      last = parentOf(last) + span; paths.push(last);
    } else if (span.includes('.')) {
      last = `${base}.${span}`; paths.push(last);
    } else if (inList && /^[a-z_]+(\[\])?$/.test(span)) {
      last = `${base}.${span}`; paths.push(last);
    } else if (!PROSE.has(span)) {
      throw new Error(`readPaths: cannot classify \`${span}\` in ${cell} (a field outside the base's list, or prose to add to PROSE)`);
    }
  });
  return paths;
}
// PROPERTY: a path the cell names is reached only by a read equal to it or below it (`value[].readiness.reasons[]` by
// `value[].readiness.reasons[].reason`); a read of the parent alone (`value[].record`) does not reach `value[].record.kind`.
const reaches = (read, p) => read === p || read.startsWith(`${p}.`) || read.startsWith(`${p}[`);

// A Read cell that says "the same fields" (`decision show`: "`value`: one decision, the same fields") names the fields
// of the nearest earlier row for the same item (`decision ls`), with that list's `value[]` read as the one item's
// `value`; the list entry's waivers carry over the same way. PROPERTY: a field added to the list's Read is also
// required of the show entry, and deleting a show read fails coverage (review round 3).
const SAME = /\bthe same fields\b/;
const asOne = (p) => p.replace(/^value\[\]/, 'value');
function cellPaths(rows, ref, entries) {
  const own = readPaths(ref.read);
  if (!SAME.test(ref.read)) return { paths: own, waived: {} };
  const item = ref.row.split(' ')[1];
  const src = rows.slice(0, rows.indexOf(ref)).reverse().find((x) => x.row.split(' ')[1] === item && !SAME.test(x.read));
  if (!src) throw new Error(`${ref.row}: "the same fields" names no earlier ${item} row`);
  if (!src.read.startsWith('`value[]`')) throw new Error(`${ref.row}: "the same fields" source ${src.row} does not read a value[] list`);
  const srcEntry = entries.find((e) => e.row === src.row);
  const waived = Object.fromEntries(Object.entries((srcEntry && srcEntry.unread) || {}).map(([k, v]) => [asOne(k), v]));
  return { paths: [...new Set([...own, ...readPaths(src.read).map(asOne)])], waived };
}

// Every row has exactly one entry and every entry names a row; every form of the row is covered by exactly one run and
// every run matches exactly one form, uses only the row's flags and ends with --json; the entry reads something, every
// path in the row's Read cell (readPaths) is reached by a read path or waived in `unread` (with a reason), and a waiver names
// something the cell has and no read reaches; every read has a JSON type and every type a read; every may_be_empty
// path is an array the entry reads.
function coverageProblems(rows, fixture) {
  const problems = [];
  (fixture.seed || []).forEach((step, i) => {
    if (step.argv[step.argv.length - 1] !== '--json') problems.push(`seed step ${i + 1} must end with --json`);
  });
  for (const { row } of rows) {
    const n = fixture.entries.filter((e) => e.row === row).length;
    if (n !== 1) problems.push(`${n} entries for the row ${row} (want exactly 1)`);
  }
  for (const e of fixture.entries) {
    const ref = rows.find((x) => x.row === e.row);
    if (!ref) { problems.push(`an entry names no row of the Commands table: ${e.row}`); continue; }
    const forms = formsOf(e.row);
    const hits = forms.map(() => 0);
    const flags = new Set(flagsIn(e.row));
    for (const argv of runsOf(e)) {
      const shown = `"${argv.join(' ')}"`;
      const has = new Set(argv.filter((a) => a.startsWith('--')));
      const match = forms.flatMap((f, i) => (f.words === argv.slice(0, 2).join(' ') && f.required.every((x) => has.has(x)) ? [i] : []));
      if (match.length !== 1) problems.push(`${e.row}: run ${shown} matches ${match.length} of the row's forms (want exactly 1)`);
      else hits[match[0]] += 1;
      if (argv[argv.length - 1] !== '--json') problems.push(`${e.row}: run ${shown} must end with --json`);
      for (const a of has) if (!flags.has(a)) problems.push(`${e.row}: ${a} is not in the row`);
    }
    forms.forEach((f, i) => {
      if (hits[i] === 0) problems.push(`${e.row}: no run covers the form ${f.label}`);
      if (hits[i] > 1) problems.push(`${e.row}: ${hits[i]} runs cover the form ${f.label}`);
    });
    if (!e.reads.length) problems.push(`${e.row}: the entry reads nothing`);
    const { paths: named, waived } = cellPaths(rows, ref, fixture.entries);
    const reached = (p) => e.reads.some((read) => reaches(read, p));
    const unread = e.unread || {};
    for (const n of named) {
      if (!reached(n) && !(n in unread) && !(n in waived)) problems.push(`${e.row}: the reference's Read names ${n}, which no read reaches (read it, or list it in unread with a reason)`);
    }
    for (const [n, why] of Object.entries(unread)) {
      if (typeof why !== 'string' || !why.trim()) problems.push(`${e.row}: unread ${n} needs a reason (a non-empty string)`);
      if (!named.includes(n)) problems.push(`${e.row}: unread ${n} is not in the reference's Read`);
      if (reached(n)) problems.push(`${e.row}: unread ${n} is read`);
    }
    const types = e.types || {};
    for (const r of e.reads) if (!(r in types)) problems.push(`${e.row}: read ${r} has no declared type`);
    for (const [p, t] of Object.entries(types)) {
      if (!e.reads.includes(p)) problems.push(`${e.row}: type for ${p}, which is not read`);
      for (const one of t.split('|')) if (!JSON_TYPES.includes(one)) problems.push(`${e.row}: ${p}: ${one} is not a JSON type`);
    }
    for (const p of e.may_be_empty || []) {
      if (!p.endsWith('[]') || !e.reads.some((r) => r === p || r.startsWith(`${p}.`))) problems.push(`${e.row}: may_be_empty ${p} names no array the entry reads`);
    }
  }
  return problems;
}

// `{{name}}` and `{{name.field}}` from the scope; PROPERTY: an unbound or non-scalar placeholder is an error, never text.
function bind(argv, scope) {
  return argv.map((a) => a.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    const v = name.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), scope);
    if (v === undefined || v === null) throw new Error(`unbound {{${name}}} (an earlier step failed or never bound it)`);
    if (typeof v === 'object') throw new Error(`{{${name}}} is an object; name one of its fields`);
    return String(v);
  }));
}

// Every value a read path reaches in an envelope. `x[]` expands every element of the array x.
// PROPERTY: a missing key, a non-array under `[]` and an empty array are each reported, never skipped silently.
function walk(root, spec) {
  const segs = spec.split('.');
  const out = { types: new Set(), missing: [], notArray: [], empty: [] };
  let nodes = [{ at: '', v: root }];
  segs.forEach((seg, k) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(\[\])?$/.exec(seg);
    if (!m) throw new Error(`bad segment "${seg}" in ${spec}`);
    const [, key, many] = m;
    const next = [];
    for (const { at, v } of nodes) {
      const here = at ? `${at}.${key}` : key;
      if (v === null || typeof v !== 'object' || Array.isArray(v) || !Object.hasOwn(v, key)) { out.missing.push(here); continue; }
      if (!many) { next.push({ at: here, v: v[key] }); continue; }
      if (!Array.isArray(v[key])) { out.notArray.push(here); continue; }
      if (v[key].length === 0) out.empty.push({ pattern: segs.slice(0, k + 1).join('.'), at: `${here}[]` });
      v[key].forEach((x, i) => next.push({ at: `${here}[${i}]`, v: x }));
    }
    nodes = next;
  });
  for (const { v } of nodes) out.types.add(typeOf(v));
  return out;
}
const valueAt = (root, spec) => spec.split('.').reduce((o, k) => (o === null || typeof o !== 'object' ? undefined : o[k]), root);

// The planner's side of one run: exit 0, an ok envelope, every read present with a declared type, arrays non-empty
// unless listed in may_be_empty, and (when `expect`) the entry's expected values.
function realProblems(entry, r, { expect = true } = {}) {
  const env = envelopeOf(r.stdout);
  if (!env) return [`no JSON envelope on stdout (exit ${r.status}): ${firstLine(r.stderr)}`];
  if (env.outcome !== 'ok') return [`outcome ${env.outcome} (exit ${r.status}): ${[env.code, env.message, env.reasons && JSON.stringify(env.reasons)].filter(Boolean).join(' ')}`];
  if (r.status !== 0) return [`exit ${r.status} with an ok envelope: ${firstLine(r.stderr)}`];
  const problems = [];
  for (const p of entry.reads) {
    const w = walk(env, p);
    for (const at of w.missing) problems.push(`the planner's answer has no ${at}`);
    for (const at of w.notArray) problems.push(`the planner's ${at} is not an array`);
    for (const e of w.empty) {
      if (!(entry.may_be_empty || []).includes(e.pattern)) problems.push(`the planner's ${e.at} is empty, so nothing under it was checked (seed an element, or list ${e.pattern} in may_be_empty)`);
    }
    const declared = entry.types[p].split('|');
    for (const t of w.types) if (!declared.includes(t)) problems.push(`the planner's ${p} is ${t}, the fixture declares ${entry.types[p]}`);
  }
  if (expect) {
    for (const [p, want] of Object.entries(entry.expect || {})) {
      const got = valueAt(env, p);
      if (got !== want) problems.push(`the planner's ${p} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
  return problems;
}

// The fake's side, against the planner's envelope: every read reaches values of the same set of JSON types.
// PROPERTY: every problem names the fake as the side to fix.
function fakeProblems(entry, realEnvelope, r) {
  const env = envelopeOf(r.stdout);
  if (!env) return [`the fake answered exit ${r.status} without an envelope: ${firstLine(r.stderr)}; ${FIX_FAKE}`];
  if (env.outcome !== 'ok' || r.status !== 0) return [`the fake answered exit ${r.status}, outcome ${env.outcome} ${env.code || ''} ${env.message || ''}`.trim() + `; ${FIX_FAKE}`];
  const problems = [];
  for (const p of entry.reads) {
    const real = walk(realEnvelope, p);
    const fake = walk(env, p);
    if (fake.missing.length || fake.notArray.length) {
      for (const at of fake.missing) problems.push(`the fake's answer has no ${at} (the planner's has it); ${FIX_FAKE}`);
      for (const at of fake.notArray) problems.push(`the fake's ${at} is not an array (the planner's is); ${FIX_FAKE}`);
      continue;
    }
    const a = [...real.types].sort().join('|') || '(nothing: empty)';
    const b = [...fake.types].sort().join('|') || '(nothing: empty)';
    if (a !== b) problems.push(`${p} is ${a} from the planner but ${b} from the fake; ${FIX_FAKE}`);
  }
  return problems;
}

// Whether the live test runs. PROPERTY: REEVE_SMOKE_SEED alone decides skipping; once it is set, a missing companion
// variable is a failure (listed), never a skip.
const LIVE_COMPANIONS = ['REEVE_REAL_BIN', 'REEVE_URL', 'REEVE_TOKEN'];
function liveConfig(env) {
  if (!env.REEVE_SMOKE_SEED) return { skip: "REEVE_SMOKE_SEED is not set (the Reeve repository's `mise run skill-smoke` sets it)" };
  return { skip: false, missing: LIVE_COMPANIONS.filter((k) => !env[k]) };
}

module.exports = { typeOf, envelopeOf, commandRows, formsOf, readPaths, coverageProblems, runsOf, bind, walk, realProblems, fakeProblems, liveConfig };
