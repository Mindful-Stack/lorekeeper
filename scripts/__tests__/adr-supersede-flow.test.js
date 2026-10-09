'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeRecord, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli } = require('./helpers/adr-fixtures');

// A same-home supersede proposes the successor and adds a Status note to the predecessor in
// one PR; accepting the successor in that same PR must leave the predecessor one Status line
// past the base, so the note is replaced by the flip rather than followed by it.

const ACCEPTED = 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.';
const NOTE = 'Supersession proposed 2026-10-08 by kb/ADR-0002; this record remains binding until it is accepted.';
const FLIP = 'Superseded 2026-10-09 by kb/ADR-0002.';

function household(t) {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2,
        meta_repo: 'ws',
        knowledge_base: 'lore',
        repos: [{ name: 'ws' }, { name: 'lore' }],
    }));
    const kb = path.join(root, 'lore');
    initRepo(kb, env);
    const shared = path.join(kb, 'knowledge', 'adrs');
    const pred = path.join(shared, '0001-session-storage.md');
    const succ = path.join(shared, '0002-session-transport.md');
    write(pred, makeRecord());
    commitAll(kb, env, 'accept 0001');
    git(kb, env, 'checkout', '-q', '-b', 'knowledge/adr-0002-session-transport');
    // The supersede flow: a proposed successor plus the note on the predecessor.
    write(succ, makeRecord({ number: '0002', status: 'proposed', fm: { supersedes: ['kb/ADR-0001'] } }));
    write(pred, makeRecord({ sections: { Status: `${ACCEPTED}\n${NOTE}` } }));
    commitAll(kb, env, 'propose 0002');
    return { root, env, shared, pred, succ };
}

function acceptSuccessor(w, predStatus) {
    write(w.pred, makeRecord({ fm: { status: 'superseded', superseded_by: 'kb/ADR-0002' }, sections: { Status: predStatus } }));
    write(w.succ, makeRecord({
        number: '0002',
        fm: { supersedes: ['kb/ADR-0001'] },
        sections: { Status: 'Proposed 2026-10-08.\nAccepted 2026-10-09 by Alex Doe.' },
    }));
}

test('same-home accept in the supersede PR: replacing the unmerged note passes', (t) => {
    const w = household(t);
    acceptSuccessor(w, `${ACCEPTED}\n${FLIP}`);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('same-home accept in the supersede PR: appending the flip after the note fails', (t) => {
    const w = household(t);
    acceptSuccessor(w, `${ACCEPTED}\n${NOTE}\n${FLIP}`);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: locked: append one line to ## Status per change/);
});

test('same-home reject in the supersede PR: removing the note leaves the predecessor as on the base', (t) => {
    const w = household(t);
    write(w.pred, makeRecord());
    write(w.succ, makeRecord({
        number: '0002',
        status: 'rejected',
        fm: { supersedes: ['kb/ADR-0001'], decided_by: ['Alex Doe'] },
        sections: { Status: 'Proposed 2026-10-08.\nRejected 2026-10-09 by Alex Doe: cookies still fit.' },
    }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});
