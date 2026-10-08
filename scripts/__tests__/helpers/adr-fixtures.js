'use strict';

// Shared fixtures for the adr-lint tests. Every negative test elsewhere starts from
// makeRecord()'s defaults and changes one thing, so the defaults must pass every rule in
// both homes; adr-fixtures.test.js pins that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SECTIONS = {
    Status: 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.',
    Context: 'Sessions are stored in signed cookies today. Cookies cap at 4 KB.',
    'Facts relied on': '- F1 The session payload is under 4 KB — source: `src/Sessions/Payload.cs`',
    'Considered options': '- **Server-side store** — sessions can grow without a size cap.\n- **Signed cookies** — no shared state between instances.',
    Decision: 'The API stores sessions server-side because payloads outgrow cookies.\n\n- **R1** Session state MUST NOT be written to cookies.',
    Consequences: '- Every instance needs the store, so a store outage logs everyone out.',
    'Assumptions and invalidation triggers': '- *Assumes payloads stay under 1 MB.* Trigger: a payload over 1 MB ⇒ supersede.',
    'Later observations': '<!-- append-only, accepted records only; newest last -->',
    'See also': '- The session RFC.',
};

function q(v) {
    return /^[A-Za-z0-9._/@-]+$/.test(v) ? v : JSON.stringify(v);
}

function serialise(v) {
    if (Array.isArray(v)) return `[${v.map(q).join(', ')}]`;
    if (v === '') return '';
    return q(String(v));
}

// opts.prefix 'kb' builds a shared-home record; any other prefix a local-home one.
// opts.fm overrides keys (undefined deletes a key); opts.sections overrides sections
// (undefined deletes one); opts.extraFrontmatter appends raw frontmatter lines.
function makeRecord(opts = {}) {
    const number = opts.number || '0001';
    const prefix = opts.prefix || 'kb';
    const shared = prefix === 'kb';
    const status = opts.status || 'accepted';
    const fm = {
        id: `${prefix}/ADR-${number}`,
        title: `ADR-${number}: Store sessions server-side`,
        description: 'The API stores sessions server-side because payloads outgrow cookies.',
        tags: ['adr', 'sessions'],
        status,
        date: '2026-10-01',
        decided_by: status === 'proposed' ? [] : ['Alex Doe'],
        consulted: [],
        confidence: 'medium',
        reversibility: 'one-way',
        blast_radius: shared ? 'cross-service' : 'service',
        sensitivity: [],
        scope: shared ? ['api:src/Sessions/**'] : ['src/Sessions/**'],
        supersedes: [],
        superseded_by: '',
        depends_on: [],
        related: [],
        implements: [],
        rfc: '',
        aliases: [],
        ...(opts.fm || {}),
    };
    const lines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
        if (v === undefined) continue;
        const s = serialise(v);
        lines.push(s === '' ? `${k}:` : `${k}: ${s}`);
    }
    if (opts.extraFrontmatter) lines.push(opts.extraFrontmatter);
    lines.push('---', '', `# ADR-${number}: Store sessions server-side`, '');
    const sections = { ...SECTIONS, ...(opts.sections || {}) };
    for (const [h, body] of Object.entries(sections)) {
        if (body === undefined) continue;
        lines.push(`## ${h}`, body, '');
    }
    return lines.join('\n');
}

function tmpDir(t) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adr-lint-')));
    if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function write(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

// Git with no ambient configuration: no global or system config (signing, hooks,
// quotepath, defaultBranch), and a fixed identity. Every git call in the tests and every
// CLI run under test uses this environment.
function gitEnv(home) {
    const empty = path.join(home, '.gitconfig-empty');
    if (!fs.existsSync(empty)) fs.writeFileSync(empty, '');
    return {
        ...process.env,
        GIT_CONFIG_GLOBAL: empty,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
        KNOWLEDGE_BASE_PATH: '',
    };
}

function git(cwd, env, ...args) {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
}

function initRepo(dir, env) {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, env, 'init', '-q', '-b', 'main');
}

function commitAll(dir, env, message) {
    git(dir, env, 'add', '-A');
    git(dir, env, 'commit', '-q', '--allow-empty', '-m', message);
}

const CLI = path.join(__dirname, '..', '..', 'adr-lint.js');

function runCli(cwd, env, ...args) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

module.exports = { makeRecord, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli };
