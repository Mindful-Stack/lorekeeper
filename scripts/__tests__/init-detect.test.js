'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../init-detect.js');

function detect(cwd, env = {}) {
    const out = execSync(`node ${SCRIPT}`, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    return JSON.parse(out);
}

function withTmp(callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'init-detect-'));
    try {
        return callback(fs.realpathSync(tmp));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

test('empty dir → greenfield', () => withTmp((tmp) => {
    assert.equal(detect(tmp).scenario, 'greenfield');
}));

test('dir with files but no .git/ → files-no-git', () => withTmp((tmp) => {
    fs.writeFileSync(path.join(tmp, 'something.txt'), 'hi');
    assert.equal(detect(tmp).scenario, 'files-no-git');
}));

test('git repo with no household.json → single-repo-retrofit', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(path.join(tmp, 'main.go'), 'package main');
    assert.equal(detect(tmp).scenario, 'single-repo-retrofit');
}));

test('git repo with docs/ → docs-migration', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'index.md'), '# Docs');
    const result = detect(tmp);
    assert.equal(result.scenario, 'docs-migration');
    assert.equal(result.context.dir, 'docs');
}));

test('git repo with knowledge/ → docs-migration with that dir', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'knowledge'));
    fs.writeFileSync(path.join(tmp, 'knowledge', 'foo.md'), '# foo');
    const result = detect(tmp);
    assert.equal(result.scenario, 'docs-migration');
    assert.equal(result.context.dir, 'knowledge');
}));

test('dir with multiple child git repos → poly-repo-retrofit', () => withTmp((tmp) => {
    for (const name of ['backend', 'frontend']) {
        fs.mkdirSync(path.join(tmp, name, '.git'), { recursive: true });
    }
    const result = detect(tmp);
    assert.equal(result.scenario, 'poly-repo-retrofit');
    assert.deepEqual(result.context.repos.sort(), ['backend', 'frontend']);
}));

test('existing household.json → already-a-workspace', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(path.join(tmp, 'household.json'), '{}');
    assert.equal(detect(tmp).scenario, 'already-a-workspace');
}));

test('refuses when CWD is $HOME', () => withTmp((tmp) => {
    for (const name of ['proj-a', 'proj-b', 'proj-c']) {
        fs.mkdirSync(path.join(tmp, name, '.git'), { recursive: true });
    }
    const result = detect(tmp, { HOME: tmp });
    assert.equal(result.scenario, 'refused');
    assert.match(result.context.reason, /\$HOME/);
}));
