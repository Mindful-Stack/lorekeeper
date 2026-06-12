'use strict';

// Tests for hooks/load-standards-reminder.sh.
//
// The hook's dominant failure mode is emitting INVALID JSON (a stray quote or
// backslash in a resolved path silently breaks the SessionStart systemMessage for
// the whole session). These tests spawn the real hook across the resolution matrix
// and assert: (a) stdout is always valid JSON, and (b) content lands on the correct
// channel — markers/router on the model-visible `additionalContext`, warnings and
// setup guidance on the user-visible `systemMessage`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.resolve(__dirname, '../../hooks/load-standards-reminder.sh');

function runHook(cwd, extraEnv = {}) {
    const base = { ...process.env };
    // Don't let the test runner's own environment leak into resolution.
    delete base.KNOWLEDGE_BASE_PATH;
    delete base.KNOWLEDGE_DEBUG;
    delete base.KNOWLEDGE_MAX_AGE_DAYS;
    const raw = execFileSync('bash', [HOOK], {
        cwd,
        encoding: 'utf8',
        env: { ...base, PWD: cwd, ...extraEnv },
    });
    return { raw, json: JSON.parse(raw) }; // JSON.parse throws -> test fails loudly
}

function ctx(json) {
    return json.hookSpecificOutput ? json.hookSpecificOutput.additionalContext : '';
}

function withTmp(callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-hook-'));
    try {
        return callback(fs.realpathSync(tmp));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function mkKb(root) {
    fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true });
    return root;
}

function gitInit(root, { committerDate } = {}) {
    const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e',
        GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e',
    };
    if (committerDate) {
        env.GIT_COMMITTER_DATE = committerDate;
        env.GIT_AUTHOR_DATE = committerDate;
    }
    const run = (args) => execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
    run(['init', '-q']);
    fs.writeFileSync(path.join(root, 'README.md'), 'x');
    run(['add', '-A']);
    run(['commit', '-qm', 'seed']);
}

// --- Valid JSON + channel routing for an explicitly configured KB ----------------

test('env-var KB: valid JSON, markers on additionalContext, summary on systemMessage', () =>
    withTmp((tmp) => {
        const kb = mkKb(path.join(tmp, 'kb'));
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: kb });

        assert.equal(json.hookSpecificOutput.hookEventName, 'SessionStart');
        assert.match(ctx(json), /Knowledge path: .*\/kb\/knowledge\//);
        assert.match(ctx(json), /Team knowledge path: .*\/kb\/knowledge\//);
        assert.match(ctx(json), /Lorekeeper Skill Router:/);
        // The skill-router and markers must NOT be dumped on the user channel.
        assert.doesNotMatch(json.systemMessage, /Skill Router/);
        assert.match(json.systemMessage, /knowledge base loaded/);
    }));

test('not configured: valid JSON, detectable on both channels', () =>
    withTmp((tmp) => {
        const { json } = runHook(tmp); // empty dir, no env, no household
        assert.match(json.systemMessage, /No knowledge base configured/);
        assert.match(ctx(json), /No knowledge base configured/);
    }));

test('broken explicit path: surfaced, never silently bypassed', () =>
    withTmp((tmp) => {
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: path.join(tmp, 'nope') });
        assert.match(json.systemMessage, /does not exist/);
    }));

// --- household.json walk-up (multi-KB) ------------------------------------------

test('household multi-KB: shared listed before team, team is write target', () =>
    withTmp((tmp) => {
        mkKb(path.join(tmp, 'org-lore'));
        mkKb(path.join(tmp, 'lore'));
        fs.writeFileSync(path.join(tmp, 'household.json'), JSON.stringify({
            meta_repo: 'ws', knowledge_base: 'lore', shared_knowledge_bases: ['org-lore'],
        }));
        const { json } = runHook(tmp);
        const c = ctx(json);
        // Count only real marker lines (line-anchored), not the skill-router's
        // incidental "`Knowledge path:` markers" mention.
        const markers = c.match(/^Knowledge path:/gm) || [];
        assert.equal(markers.length, 2);
        assert.ok(c.indexOf('/org-lore/knowledge') < c.indexOf('Team knowledge path'),
            'shared KB should appear before the team write-target marker');
        assert.match(c, /Team knowledge path: .*\/lore\/knowledge\//);
    }));

test('household walk-up resolves from a nested subdirectory', () =>
    withTmp((tmp) => {
        mkKb(path.join(tmp, 'lore'));
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ meta_repo: 'ws', knowledge_base: 'lore' }));
        const sub = path.join(tmp, 'services', 'api');
        fs.mkdirSync(sub, { recursive: true });
        const { json } = runHook(sub);
        assert.match(ctx(json), /Knowledge path: .*\/lore\/knowledge\//);
    }));

test('household with a shared KB that has no knowledge/ dir: nag + team still loads', () =>
    withTmp((tmp) => {
        mkKb(path.join(tmp, 'lore'));
        // org-lore declared but not cloned
        fs.writeFileSync(path.join(tmp, 'household.json'), JSON.stringify({
            meta_repo: 'ws', knowledge_base: 'lore', shared_knowledge_bases: ['org-lore'],
        }));
        const { json } = runHook(tmp);
        assert.match(json.systemMessage, /no knowledge\/ directory: org-lore/);
        assert.match(ctx(json), /Knowledge path: .*\/lore\/knowledge\//);
    }));

// --- #2: a path containing a double-quote must not break the JSON ----------------

test('path with a double-quote stays valid JSON (json_escape regression)', () =>
    withTmp((tmp) => {
        const weird = mkKb(path.join(tmp, 'kb"x'));
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: weird });
        // If json_escape were missing, JSON.parse in runHook would already have thrown.
        assert.ok(ctx(json).includes('kb"x/knowledge'),
            'decoded additionalContext should contain the real (unescaped) path');
    }));

// --- #3: staleness splits across the two channels -------------------------------

test('stale KB: compact list to the user, update offer to the model', () =>
    withTmp((tmp) => {
        const kb = mkKb(path.join(tmp, 'kb'));
        gitInit(kb, { committerDate: '2001-01-01T00:00:00 +0000' });
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: kb });
        assert.match(json.systemMessage, /may be stale/);
        assert.match(json.systemMessage, /Claude will offer to update them/);
        // Model channel carries the actual command to offer; never a bare `cd && git`.
        assert.match(ctx(json), /git -C <kb-root> pull --ff-only/);
        assert.doesNotMatch(ctx(json), /cd .* && git pull/);
    }));

test('stale KB inside a household: offers the make target with a git fallback', () =>
    withTmp((tmp) => {
        const lore = mkKb(path.join(tmp, 'lore'));
        gitInit(lore, { committerDate: '2001-01-01T00:00:00 +0000' });
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ meta_repo: 'ws', knowledge_base: 'lore' }));
        const { json } = runHook(tmp);
        assert.match(ctx(json), /make -C .* update-kb/);
        assert.match(ctx(json), /fall back to .*git -C <kb-root> pull --ff-only/);
    }));

test('fresh KB: no staleness warning on either channel', () =>
    withTmp((tmp) => {
        const kb = mkKb(path.join(tmp, 'kb'));
        gitInit(kb); // committed "now"
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: kb });
        assert.doesNotMatch(json.systemMessage, /may be stale/);
    }));

// --- Debug mode -----------------------------------------------------------------

test('debug mode: instructions on the model channel, still valid JSON', () =>
    withTmp((tmp) => {
        const kb = mkKb(path.join(tmp, 'kb'));
        const { json } = runHook(tmp, { KNOWLEDGE_BASE_PATH: kb, KNOWLEDGE_DEBUG: '1' });
        assert.match(ctx(json), /LOREKEEPER DEBUG MODE ENABLED/);
    }));
