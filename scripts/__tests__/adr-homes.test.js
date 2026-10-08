'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveHomes, homeOf, repoFromRemote, dirForPrefix } = require('../adr/homes');
const { tmpDir, write, gitEnv, initRepo } = require('./helpers/adr-fixtures');

const NO_ENV = { KNOWLEDGE_BASE_PATH: '' };

function household(t, manifest) {
    const root = tmpDir(t);
    write(path.join(root, 'household.json'), JSON.stringify(manifest));
    fs.mkdirSync(path.join(root, 'lore', 'knowledge'), { recursive: true });
    return root;
}

test('household: local homes per present repo, shared home in the team KB', (t) => {
    const root = household(t, {
        meta_repo: 'ws',
        knowledge_base: 'lore',
        repos: [{ name: 'ws' }, { name: 'lore' }, { name: 'api', adrDir: 'adr' }, { name: 'web' }, { name: 'gone' }],
        adr: { localDir: 'doc/decisions' },
    });
    fs.mkdirSync(path.join(root, 'api'));
    fs.mkdirSync(path.join(root, 'web'));
    const h = resolveHomes(path.join(root, 'api'), NO_ENV);
    assert.equal(h.mode, 'household');
    assert.deepEqual(h.localHomes.map((x) => [x.repo, path.relative(root, x.dir), x.present]), [
        ['api', path.join('api', 'adr'), true],
        ['web', path.join('web', 'doc', 'decisions'), true],
        ['gone', path.join('gone', 'doc', 'decisions'), false],
    ]);
    assert.equal(h.sharedHome, path.join(root, 'lore', 'knowledge', 'adrs'));
    assert.deepEqual(homeOf(h, path.join(root, 'web', 'doc', 'decisions')), { kind: 'local', repo: 'web', prefix: 'web', coinciding: false });
    assert.equal(homeOf(h, h.sharedHome).kind, 'shared');
    assert.equal(homeOf(h, path.join(root, 'api', 'src')), null);
});

test('household: shared_knowledge_bases are readable by prefix, never local homes', (t) => {
    const root = household(t, { knowledge_base: 'lore', shared_knowledge_bases: ['platform-kb'], repos: [{ name: 'platform-kb' }, { name: 'api' }] });
    const h = resolveHomes(root, NO_ENV);
    assert.deepEqual(h.localHomes.map((x) => x.repo), ['api']);
    assert.equal(dirForPrefix(h, 'platform-kb'), path.join(root, 'platform-kb', 'knowledge', 'adrs'));
    assert.equal(dirForPrefix(h, 'kb'), h.sharedHome);
    assert.equal(dirForPrefix(h, 'nope'), null);
});

test('single repo: config file sets the KB and the local dir', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    fs.mkdirSync(path.join(root, 'kb', 'knowledge'), { recursive: true });
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ knowledgeBasePath: 'kb', adr: { localDir: 'adr' } }));
    const h = resolveHomes(path.join(root), NO_ENV);
    assert.equal(h.mode, 'single');
    assert.equal(h.localHomes[0].dir, path.join(root, 'adr'));
    assert.equal(h.localHomes[0].repo, path.basename(root));
    assert.equal(h.sharedHome, path.join(root, 'kb', 'knowledge', 'adrs'));
    assert.equal(h.localHomes[0].coinciding, false);
});

test('single repo: no KB means one coinciding home', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    const h = resolveHomes(root, NO_ENV);
    assert.equal(h.mode, 'single');
    assert.equal(h.sharedHome, null);
    assert.equal(h.localHomes[0].coinciding, true);
});

test('single repo: a KB inside the repo whose adrs dir is the local dir coincides', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    fs.mkdirSync(path.join(root, 'lore', 'knowledge', 'adrs'), { recursive: true });
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ knowledgeBasePath: 'lore', adr: { localDir: 'lore/knowledge/adrs' } }));
    const h = resolveHomes(root, NO_ENV);
    assert.equal(h.mode, 'single');
    assert.equal(h.localHomes[0].coinciding, true);
    assert.equal(homeOf(h, h.sharedHome).kind, 'local');
});

test('single repo: KNOWLEDGE_BASE_PATH is used when no config file names a KB', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    const kb = tmpDir(t);
    fs.mkdirSync(path.join(kb, 'knowledge'));
    const h = resolveHomes(root, { KNOWLEDGE_BASE_PATH: kb });
    assert.equal(h.mode, 'single');
    assert.equal(h.sharedHome, path.join(kb, 'knowledge', 'adrs'));
});

test('repoFromRemote matches ssh and https forms of the same URL', () => {
    const homes = { repos: [{ name: 'api', url: 'git@github.com:Example/api.git' }] };
    assert.equal(repoFromRemote(homes, 'https://github.com/example/api'), 'api');
    assert.equal(repoFromRemote(homes, 'https://github.com/example/other.git'), null);
});
