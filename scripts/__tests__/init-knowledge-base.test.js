'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../init-knowledge-base.js');

function runInit(args, opts = {}) {
  try {
    const stdout = execSync(`node ${SCRIPT} ${args}`, {
      encoding: 'utf8',
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

describe('init-knowledge-base: conflict detection', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lorekeeper-init-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses if target has knowledge/ subdir', () => {
    const target = path.join(tmpDir, 'kb');
    fs.mkdirSync(path.join(target, 'knowledge'), { recursive: true });
    const result = runInit(`--target ${target}`);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout + result.stderr, /already exists|conflict|refus/i);
  });

  it('refuses if target has knowledge.config.json', () => {
    const target = path.join(tmpDir, 'kb');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'knowledge.config.json'), '{}');
    const result = runInit(`--target ${target}`);
    assert.equal(result.exitCode, 1);
  });
});

describe('init-knowledge-base: happy path', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lorekeeper-init-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies template to empty target dir', () => {
    const target = path.join(tmpDir, 'kb');
    const result = runInit(`--target ${target}`);
    assert.equal(result.exitCode, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    assert.ok(fs.existsSync(path.join(target, 'knowledge', 'general', '_starter.md')));
    assert.ok(fs.existsSync(path.join(target, 'package.json')));
    assert.ok(fs.existsSync(path.join(target, 'src', 'cli.js')));
    assert.ok(fs.existsSync(path.join(target, 'Makefile')));
  });

  it('defaults target to ./shared-knowledge when --target omitted', () => {
    const result = runInit('', { cwd: tmpDir });
    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(path.join(tmpDir, 'shared-knowledge', 'package.json')));
  });

  it('creates target dir if missing', () => {
    const target = path.join(tmpDir, 'nested', 'kb');
    const result = runInit(`--target ${target}`);
    assert.equal(result.exitCode, 0);
    assert.ok(fs.existsSync(target));
  });
});
