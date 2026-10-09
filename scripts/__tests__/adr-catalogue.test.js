'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveHomes } = require('../adr/homes');
const { buildCatalogue, nextNumber, renderMarkdown } = require('../adr/catalogue');
const { makeRecord, tmpDir, write, gitEnv, git, initRepo, commitAll, runCli } = require('./helpers/adr-fixtures');

const NO_ENV = { KNOWLEDGE_BASE_PATH: '' };

// A household with a team KB, two code repos (api present, web absent) and another team's KB.
function household(t) {
    const root = tmpDir(t);
    write(path.join(root, 'household.json'), JSON.stringify({
        meta_repo: 'ws',
        knowledge_base: 'lore',
        shared_knowledge_bases: ['platform-kb'],
        repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'platform-kb' }, { name: 'api' }, { name: 'web' }],
    }));
    const shared = path.join(root, 'lore', 'knowledge', 'adrs');
    const local = path.join(root, 'api', 'docs', 'adr');
    const other = path.join(root, 'platform-kb', 'knowledge', 'adrs');
    fs.mkdirSync(shared, { recursive: true });
    fs.mkdirSync(local, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    return { root, shared, local, other };
}

test('catalogue spans every present home and names the absent ones', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-session-storage.md'), makeRecord());
    write(path.join(h.local, '0001-cache.md'), makeRecord({ prefix: 'api' }));
    write(path.join(h.other, '0003-tenancy.md'), makeRecord({ number: '0003', prefix: 'platform-kb', fm: { id: 'platform-kb/ADR-0003' } }));
    const cat = buildCatalogue(resolveHomes(h.root, NO_ENV));
    assert.deepEqual(cat.records.map((e) => [e.id, e.home, e.kind]), [
        ['api/ADR-0001', 'api', 'local'],
        ['kb/ADR-0001', 'kb', 'shared'],
        ['platform-kb/ADR-0003', 'platform-kb', 'other'],
    ]);
    const web = cat.homes.find((x) => x.prefix === 'web');
    assert.equal(web.present, false);
    assert.match(renderMarkdown(cat), /Not on disk: web/);
});

test('reverse links are computed across homes, and through aliases', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-session-storage.md'), makeRecord({ fm: { aliases: ['api/ADR-0009'] } }));
    write(path.join(h.local, '0002-cache.md'), makeRecord({ prefix: 'api', number: '0002', fm: { related: ['kb/ADR-0001'], depends_on: ['api/ADR-0009'] } }));
    const cat = buildCatalogue(resolveHomes(h.root, NO_ENV));
    const kb1 = cat.records.find((e) => e.id === 'kb/ADR-0001');
    assert.deepEqual(kb1.relatedFrom, ['api/ADR-0002']);
    assert.deepEqual(kb1.dependedOnBy, ['api/ADR-0002']);
    // The declaring record keeps only what it declared: no reverse link is written into it.
    const api2 = cat.records.find((e) => e.id === 'api/ADR-0002');
    assert.deepEqual(api2.relatedFrom, []);
    assert.match(renderMarkdown(cat), /\*\*kb\/ADR-0001\*\*: depended on by api\/ADR-0002; related from api\/ADR-0002/);
});

test('legacy bare-number relations qualify within the declaring home', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-a.md'), makeRecord());
    write(path.join(h.shared, '0002-b.md'), makeRecord({ number: '0002', fm: { related: ['0001'] } }));
    const cat = buildCatalogue(resolveHomes(h.root, NO_ENV));
    assert.deepEqual(cat.records.find((e) => e.id === 'kb/ADR-0001').relatedFrom, ['kb/ADR-0002']);
});

test('a coinciding home is listed once, under the local prefix', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    fs.mkdirSync(path.join(root, 'lore', 'knowledge', 'adrs'), { recursive: true });
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ knowledgeBasePath: 'lore', adr: { localDir: 'lore/knowledge/adrs' } }));
    write(path.join(root, 'lore', 'knowledge', 'adrs', '0001-a.md'), makeRecord({ prefix: path.basename(root) }));
    const cat = buildCatalogue(resolveHomes(root, NO_ENV));
    assert.deepEqual(cat.homes.map((x) => x.kind), ['local']);
    assert.equal(cat.records.length, 1);
    assert.equal(cat.records[0].home, path.basename(root));
});

test('status filter in the markdown table', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-a.md'), makeRecord());
    write(path.join(h.shared, '0002-b.md'), makeRecord({ number: '0002', status: 'proposed' }));
    const md = renderMarkdown(buildCatalogue(resolveHomes(h.root, NO_ENV)), 'proposed');
    assert.match(md, /records \(1\)/);
    assert.match(md, /\| kb\/ADR-0002 \|/);
    assert.doesNotMatch(md, /\| kb\/ADR-0001 \|/);
});

test('nextNumber is one past the highest record number, counting extra names and ignoring strays', (t) => {
    const dir = tmpDir(t);
    assert.equal(nextNumber(path.join(dir, 'missing')), '0001');
    write(path.join(dir, '0002-a.md'), 'x');
    write(path.join(dir, '_0099-template.md'), 'x');
    write(path.join(dir, 'notes.md'), 'x');
    assert.equal(nextNumber(dir), '0003');
    assert.equal(nextNumber(dir, ['0007-on-base.md']), '0008');
});

test('CLI homes reports the governed repo for a checkout inside the household', (t) => {
    const h = household(t);
    const env = gitEnv(h.root);
    const fromApi = JSON.parse(runCli(path.join(h.root, 'api'), env, 'homes').stdout);
    assert.equal(fromApi.mode, 'household');
    assert.equal(fromApi.governedRepo, 'api');
    assert.equal(fromApi.sharedHomeExists, true);
    assert.deepEqual(fromApi.localHomes.map((x) => [x.repo, x.present]), [['api', true], ['web', false]]);
    const fromRoot = JSON.parse(runCli(h.root, env, 'homes').stdout);
    assert.equal(fromRoot.governedRepo, null);
});

test('CLI index prints the table, and JSON with --json', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-session-storage.md'), makeRecord());
    const env = gitEnv(h.root);
    const md = runCli(h.root, env, 'index');
    assert.equal(md.code, 0, md.stderr);
    assert.match(md.stdout, /\| kb\/ADR-0001 \| kb \| Store sessions server-side \|/);
    const json = JSON.parse(runCli(h.root, env, 'index', '--json').stdout);
    assert.equal(json.records[0].id, 'kb/ADR-0001');
    assert.equal(runCli(h.root, env, 'index', '--status', 'bogus').code, 2);
});

test('CLI next counts records on the base tip that this checkout lacks', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    initRepo(root, env);
    const adr = path.join(root, 'docs', 'adr');
    write(path.join(adr, '0001-a.md'), makeRecord({ prefix: 'x' }));
    commitAll(root, env, 'one');
    git(root, env, 'checkout', '-q', '-b', 'feature');
    git(root, env, 'checkout', '-q', 'main');
    write(path.join(adr, '0002-b.md'), makeRecord({ prefix: 'x', number: '0002' }));
    commitAll(root, env, 'two');
    git(root, env, 'checkout', '-q', 'feature');
    assert.equal(runCli(root, env, 'next', adr).stdout.trim(), '0002');
    assert.equal(runCli(root, env, 'next', '--base', 'main', adr).stdout.trim(), '0003');
});

test('CLI select --paths matches scopes without a patch, and needs exactly one input', (t) => {
    const h = household(t);
    write(path.join(h.shared, '0001-session-storage.md'), makeRecord());
    const env = gitEnv(h.root);
    const r = runCli(h.root, env, 'select', '--repo', 'api', '--paths', 'src/Sessions/Store.cs, README.md');
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^kb\/ADR-0001\taccepted\t.*\tscope$/m);
    assert.equal(runCli(h.root, env, 'select', '--repo', 'api').code, 2);
});

test('CLI homes names each repo\'s default branch from origin, never a parent repo\'s', (t) => {
    const h = household(t);
    const env = gitEnv(h.root);
    initRepo(h.root, env); // the meta repo: a missing sibling must not inherit its branch
    commitAll(h.root, env, 'meta');
    git(h.root, env, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git(h.root, env, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const api = path.join(h.root, 'api');
    initRepo(api, env);
    commitAll(api, env, 'api');
    git(api, env, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(api, env, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    const kb = path.join(h.root, 'lore');
    initRepo(kb, env);
    commitAll(kb, env, 'kb');
    git(kb, env, 'update-ref', 'refs/remotes/origin/master', 'HEAD'); // no origin/HEAD: fallback
    const out = JSON.parse(runCli(h.root, env, 'homes').stdout);
    assert.deepEqual(out.localHomes.map((x) => [x.repo, x.defaultBranch]), [['api', 'develop'], ['web', null]]);
    assert.equal(out.sharedDefaultBranch, 'master');
});

test('check --draft turns a new shared proposal and a ride-along into warnings', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        meta_repo: 'ws', knowledge_base: 'lore', repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api' }],
    }));
    const kb = path.join(root, 'lore');
    const api = path.join(root, 'api');
    initRepo(kb, env);
    commitAll(kb, env, 'empty');
    initRepo(api, env);
    write(path.join(api, 'src', 'Sessions', 'Store.cs'), 'class Store {}\n');
    commitAll(api, env, 'init');
    write(path.join(kb, 'knowledge', 'adrs', '0001-session-storage.md'), makeRecord({ status: 'proposed' }));
    const shared = path.join(kb, 'knowledge', 'adrs');
    assert.equal(runCli(root, env, 'check', '--base', 'main', shared).code, 1);
    const draft = runCli(root, env, 'check', '--base', 'main', '--draft', shared);
    assert.equal(draft.code, 0, draft.stdout);
    assert.match(draft.stdout, /proposed-shared: warning:/);
    write(path.join(api, 'src', 'Sessions', 'Store.cs'), 'class Store { int x; }\n');
    write(path.join(api, 'docs', 'adr', '0001-session-storage.md'), makeRecord({ prefix: 'api', status: 'proposed', fm: { reversibility: 'two-way' } }));
    const local = path.join(api, 'docs', 'adr');
    assert.equal(runCli(root, env, 'check', '--base', 'main', local).code, 1);
    const ride = runCli(root, env, 'check', '--base', 'main', '--draft', local);
    assert.equal(ride.code, 0, ride.stdout);
    assert.match(ride.stdout, /ride-along: warning:/);
});

test('CLI homes gives each home its repo root and path inside it; an embedded KB uses the enclosing repo\'s branch', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    initRepo(root, env);
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ knowledgeBasePath: 'lore' }));
    fs.mkdirSync(path.join(root, 'lore', 'knowledge', 'adrs'), { recursive: true });
    commitAll(root, env, 'init');
    git(root, env, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(root, env, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    const out = JSON.parse(runCli(root, env, 'homes').stdout);
    assert.equal(out.sharedRepoRoot, root);
    assert.equal(out.sharedRelDir, 'lore/knowledge/adrs');
    assert.equal(out.sharedDefaultBranch, 'develop');
    assert.deepEqual(out.localHomes.map((x) => [x.repoRoot, x.relDir, x.defaultBranch]), [[root, 'docs/adr', 'develop']]);
});

test('CLI homes finds the KB repo\'s branch under a nested sharedDir, and nulls for a missing KB or sibling', (t) => {
    const root = tmpDir(t);
    const env = gitEnv(root);
    write(path.join(root, 'household.json'), JSON.stringify({
        meta_repo: 'ws', knowledge_base: 'lore', repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api' }, { name: 'web' }],
        adr: { sharedDir: 'architecture/adrs' },
    }));
    initRepo(root, env);
    commitAll(root, env, 'meta');
    git(root, env, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git(root, env, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const missing = JSON.parse(runCli(root, env, 'homes').stdout);
    assert.deepEqual([missing.sharedRepoRoot, missing.sharedRelDir, missing.sharedDefaultBranch], [null, null, null]);
    const kb = path.join(root, 'lore');
    initRepo(kb, env);
    fs.mkdirSync(path.join(kb, 'knowledge', 'architecture'), { recursive: true });
    commitAll(kb, env, 'kb');
    git(kb, env, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(kb, env, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    const api = path.join(root, 'api');
    initRepo(api, env);
    const out = JSON.parse(runCli(root, env, 'homes').stdout);
    assert.equal(out.sharedRepoRoot, kb);
    assert.equal(out.sharedRelDir, 'knowledge/architecture/adrs');
    assert.equal(out.sharedDefaultBranch, 'develop');
    assert.deepEqual(out.localHomes.map((x) => [x.repo, x.repoRoot, x.relDir]), [['api', api, 'docs/adr'], ['web', null, null]]);
});
