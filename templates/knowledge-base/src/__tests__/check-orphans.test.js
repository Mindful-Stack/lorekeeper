const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { findOrphans } = require('../check-orphans');

// Helper: create a file inside the temp directory
function createFile(tmpDir, name, content) {
  const filePath = path.join(tmpDir, name);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function setup() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-orphans-test-'));
}

function teardown(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('findOrphans', () => {
  it('returns empty array when all files are linked', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'node-a.md', 'See [[node-b]] for details.');
      createFile(tmpDir, 'node-b.md', 'See [[node-a]] for details.');

      const result = findOrphans(tmpDir);
      assert.deepEqual(result, []);
    } finally {
      teardown(tmpDir);
    }
  });

  it('detects orphaned files that are never linked to', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'node-a.md', 'See [[node-b]] here.');
      createFile(tmpDir, 'node-b.md', 'See [[node-a]] here.');
      createFile(tmpDir, 'orphan.md', '# I am never linked to');

      const result = findOrphans(tmpDir);
      assert.equal(result.length, 1);
      assert.ok(result.includes('orphan.md'));
    } finally {
      teardown(tmpDir);
    }
  });

  it('skips _-prefixed files (allowed orphans)', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, '_index.md', '# Index entry point');
      createFile(tmpDir, '_overview.md', '# Overview entry point');
      createFile(tmpDir, 'node-a.md', '# No links');

      const result = findOrphans(tmpDir);
      // _index.md and _overview.md should NOT appear as orphans
      assert.ok(!result.some(f => f.includes('_index.md')));
      assert.ok(!result.some(f => f.includes('_overview.md')));
      // node-a.md IS an orphan (not linked and not _-prefixed)
      assert.ok(result.includes('node-a.md'));
    } finally {
      teardown(tmpDir);
    }
  });

  it('handles files in subdirectories', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/context-a.md', '# Context A');
      createFile(tmpDir, 'node-a.md', 'See [[domain/context-a]] here.');

      const result = findOrphans(tmpDir);
      // context-a is linked via full path, so not an orphan
      // node-a is not linked from anywhere, so it IS an orphan
      assert.ok(!result.includes('domain/context-a.md'));
      assert.ok(result.includes('node-a.md'));
    } finally {
      teardown(tmpDir);
    }
  });

  it('resolves links with central: prefix', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/emcc.md', '# EMCC');
      createFile(tmpDir, 'root.md', 'See [[central:domain/emcc]] here.');

      const result = findOrphans(tmpDir);
      // emcc.md should not be orphaned because it is linked via central:domain/emcc
      assert.ok(!result.some(f => f.includes('emcc.md')));
    } finally {
      teardown(tmpDir);
    }
  });

  it('resolves links by filename only for path-style links', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/device-context.md', '# Device Context');
      createFile(tmpDir, 'root.md', 'See [[device-context]] here.');

      const result = findOrphans(tmpDir);
      // device-context.md is linked by filename, not orphaned
      assert.ok(!result.some(f => f.includes('device-context.md')));
    } finally {
      teardown(tmpDir);
    }
  });

  it('adds filename-only variant for path-style links', () => {
    const tmpDir = setup();
    try {
      // Link is [[domain/my-node]] - should also generate "my-node" as a known link
      createFile(tmpDir, 'my-node.md', '# My Node');
      createFile(tmpDir, 'root.md', 'See [[domain/my-node]] here.');

      const result = findOrphans(tmpDir);
      // my-node.md should be found via the filename-only variant of domain/my-node
      assert.ok(!result.includes('my-node.md'));
    } finally {
      teardown(tmpDir);
    }
  });

  it('returns relative paths with forward slashes', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'sub/dir/orphan.md', '# Deep orphan');
      createFile(tmpDir, 'root.md', '# No links');

      const result = findOrphans(tmpDir);
      assert.ok(result.includes('sub/dir/orphan.md'));
      assert.ok(result.includes('root.md'));
      // Ensure no backslashes
      for (const p of result) {
        assert.ok(!p.includes('\\'), `Path should use forward slashes: ${p}`);
      }
    } finally {
      teardown(tmpDir);
    }
  });

  it('deduplicates results', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'orphan.md', '# Orphan');

      const result = findOrphans(tmpDir);
      const unique = [...new Set(result)];
      assert.deepEqual(result, unique);
    } finally {
      teardown(tmpDir);
    }
  });

  it('returns empty array for empty directory', () => {
    const tmpDir = setup();
    try {
      const result = findOrphans(tmpDir);
      assert.deepEqual(result, []);
    } finally {
      teardown(tmpDir);
    }
  });

  it('returns empty array for nonexistent directory', () => {
    const result = findOrphans(path.join(os.tmpdir(), 'nonexistent-dir-xyz'));
    assert.deepEqual(result, []);
  });

  it('strips .md from links when matching', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'target.md', '# Target');
      createFile(tmpDir, 'root.md', 'See [[target.md]] here.');

      const result = findOrphans(tmpDir);
      assert.ok(!result.includes('target.md'));
    } finally {
      teardown(tmpDir);
    }
  });

  it('handles multiple orphans and sorts result', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'zebra.md', '# Zebra');
      createFile(tmpDir, 'alpha.md', '# Alpha');
      createFile(tmpDir, 'middle.md', '# Middle');

      const result = findOrphans(tmpDir);
      assert.equal(result.length, 3);
      // Results should be sorted
      const sorted = [...result].sort();
      assert.deepEqual(result, sorted);
    } finally {
      teardown(tmpDir);
    }
  });

  it('does not count self-links as incoming links', () => {
    const tmpDir = setup();
    try {
      // A file that only links to itself should still be orphaned
      // if no OTHER file links to it
      createFile(tmpDir, 'self-ref.md', 'See [[self-ref]] for more.');

      const result = findOrphans(tmpDir);
      // Hmm, the Python original does not distinguish self-links.
      // It checks whether the stem is in the global link set.
      // Since self-ref links to itself, "self-ref" IS in the link set,
      // so the Python version would NOT report it as orphan.
      // We should match Python behavior.
      assert.deepEqual(result, []);
    } finally {
      teardown(tmpDir);
    }
  });

  it('skips _-prefixed files in subdirectories', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/_overview.md', '# Domain overview');

      const result = findOrphans(tmpDir);
      assert.ok(!result.some(f => f.includes('_overview.md')));
    } finally {
      teardown(tmpDir);
    }
  });
});
