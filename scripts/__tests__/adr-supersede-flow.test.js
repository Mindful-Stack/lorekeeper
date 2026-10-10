'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeRecord, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli } = require('./helpers/adr-fixtures');

// A same-home supersede proposes the successor without touching the predecessor; the reverse
// link is computed. Accepting the successor in that PR flips the predecessor with exactly one
// appended Status line.

const ACCEPTED = 'Proposed 2026-09-30.\nAccepted 2026-10-01 by Alex Doe.';
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
    git(kb, env, 'checkout', '-q', '-b', 'adr/0002-own-pr-20261008');
    write(succ, makeRecord({ number: '0002', status: 'proposed', fm: { supersedes: ['kb/ADR-0001'] } }));
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

test('same-home supersede: the proposal leaves the predecessor untouched and binding', (t) => {
    const w = household(t);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.doesNotMatch(r.stdout, /0001-session-storage\.md/);
    assert.match(r.stdout, /0002-session-transport\.md: proposed-shared: /);
});

test('same-home accept in the supersede PR: the predecessor gains exactly the flip', (t) => {
    const w = household(t);
    acceptSuccessor(w, `${ACCEPTED}\n${FLIP}`);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('same-home accept in the supersede PR: a note before the flip is a second Status line and fails', (t) => {
    const w = household(t);
    acceptSuccessor(w, `${ACCEPTED}\nNote 2026-10-08: kb/ADR-0002 proposed.\n${FLIP}`);
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /0001-session-storage\.md: locked: append one line to ## Status per change/);
});

test('same-home reject in the supersede PR: the predecessor stays as on the base', (t) => {
    const w = household(t);
    write(w.succ, makeRecord({
        number: '0002',
        status: 'rejected',
        fm: { supersedes: ['kb/ADR-0001'], decided_by: ['Alex Doe'] },
        sections: { Status: 'Proposed 2026-10-08.\nRejected 2026-10-09 by Alex Doe: cookies still fit.' },
    }));
    const r = runCli(w.root, w.env, 'check', '--base', 'main', w.shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
});

// Cross-home links are a review responsibility: a KB-only CI cannot see the successor's home,
// so a predecessor flipped to a successor in another repo is a warning there, not an error.
test('cross-home flip: a successor whose home is not on disk is a warning', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    const kb = path.join(root, 'kb-checkout');
    const shared = path.join(kb, 'knowledge', 'adrs');
    initRepo(kb, env);
    const pred = path.join(shared, '0001-session-storage.md');
    write(pred, makeRecord());
    commitAll(kb, env, 'accept 0001');
    git(kb, env, 'checkout', '-q', '-b', 'adr/0001-flip-20261009');
    write(pred, makeRecord({
        fm: { status: 'superseded', superseded_by: 'api/ADR-0002' },
        sections: { Status: `${ACCEPTED}\nSuperseded 2026-10-09 by api/ADR-0002.` },
    }));
    const r = runCli(kb, env, 'check', '--home', 'shared', '--base', 'main', shared);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /relations: warning: superseded_by api\/ADR-0002: its home is not on disk, so it was not checked/);
});

// A discover batch opens one PR with several shared proposals; accepting one of them on that
// PR's branch leaves the others proposed: a plain check passes with a warning, the CI gate
// (--ci) stays red until every record in the PR is accepted or rejected.
test('pr-branch accept of one record in a two-proposal shared PR passes a plain check, not --ci', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        schema_version: 2, meta_repo: 'ws', knowledge_base: 'lore', repos: [{ name: 'ws' }, { name: 'lore' }],
    }));
    const kb = path.join(root, 'lore');
    initRepo(kb, env);
    const shared = path.join(kb, 'knowledge', 'adrs');
    write(path.join(shared, '0001-session-storage.md'), makeRecord());
    commitAll(kb, env, 'accept 0001');
    git(kb, env, 'checkout', '-q', '-b', 'knowledge/adrs-0002-0003-discover');
    write(path.join(shared, '0002-cache.md'), makeRecord({ number: '0002', status: 'proposed' }));
    write(path.join(shared, '0003-queue.md'), makeRecord({ number: '0003', status: 'proposed' }));
    commitAll(kb, env, 'propose 0002 and 0003');
    write(path.join(shared, '0002-cache.md'), makeRecord({
        number: '0002',
        sections: { Status: 'Proposed 2026-10-08.\nAccepted 2026-10-09 by Alex Doe.' },
    }));
    const strict = runCli(root, env, 'check', '--home', 'shared', '--base', 'main', '--ci', shared);
    assert.equal(strict.code, 1, strict.stdout);
    assert.match(strict.stdout, /0003-queue\.md: proposed-shared: /);
    const draft = runCli(root, env, 'check', '--home', 'shared', '--base', 'main', shared);
    assert.equal(draft.code, 0, draft.stdout + draft.stderr);
    assert.match(draft.stdout, /0003-queue\.md: proposed-shared: warning:/);
});
