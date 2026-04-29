const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { extractLinks, resolveLink, validateAll } = require('../validate-links');

// --- extractLinks ---

describe('extractLinks', () => {
  it('extracts simple wikilinks', () => {
    const content = 'See [[some-node]] for details.';
    assert.deepEqual(extractLinks(content), ['some-node']);
  });

  it('extracts multiple wikilinks', () => {
    const content = 'Link to [[node-a]] and [[node-b]] here.';
    assert.deepEqual(extractLinks(content), ['node-a', 'node-b']);
  });

  it('extracts wikilinks with paths', () => {
    const content = 'See [[domain/device-management-context]] for info.';
    assert.deepEqual(extractLinks(content), ['domain/device-management-context']);
  });

  it('extracts wikilinks with anchor fragments', () => {
    const content = 'See [[some-node#section-name]] for details.';
    assert.deepEqual(extractLinks(content), ['some-node#section-name']);
  });

  it('extracts wikilinks with prefixes like central:', () => {
    const content = 'See [[central:domain/emcc-context]] here.';
    assert.deepEqual(extractLinks(content), ['central:domain/emcc-context']);
  });

  it('extracts wikilinks with repo: prefix', () => {
    const content = 'See [[repo:frontend/architecture]] here.';
    assert.deepEqual(extractLinks(content), ['repo:frontend/architecture']);
  });

  it('returns empty array when no wikilinks', () => {
    const content = '# Just a heading\nNo links here.';
    assert.deepEqual(extractLinks(content), []);
  });

  it('does not match incomplete brackets', () => {
    const content = 'This [single] bracket and [[unclosed are not links.';
    assert.deepEqual(extractLinks(content), []);
  });

  it('handles multiple wikilinks on the same line', () => {
    const content = '[[node-a]] and [[node-b]] on same line';
    assert.deepEqual(extractLinks(content), ['node-a', 'node-b']);
  });
});

// --- resolveLink ---

describe('resolveLink', () => {
  const nodes = new Set([
    'domain/device-management-context',
    'device-management-context',
    'general/review/pr-guidelines',
    'pr-guidelines',
    'frameworks/svelte/patterns',
    'patterns',
  ]);

  it('resolves direct filename match', () => {
    assert.equal(resolveLink('device-management-context', nodes), true);
  });

  it('resolves full path match', () => {
    assert.equal(resolveLink('domain/device-management-context', nodes), true);
  });

  it('resolves link with anchor fragment by stripping it', () => {
    assert.equal(resolveLink('device-management-context#some-section', nodes), true);
  });

  it('resolves link ending with .md by stripping extension', () => {
    assert.equal(resolveLink('device-management-context.md', nodes), true);
  });

  it('resolves partial path match (suffix)', () => {
    // "pr-guidelines" should match "general/review/pr-guidelines"
    assert.equal(resolveLink('pr-guidelines', nodes), true);
  });

  it('returns false for non-existent link', () => {
    assert.equal(resolveLink('nonexistent-node', nodes), false);
  });

  it('returns false for partially matching name', () => {
    assert.equal(resolveLink('device-management', nodes), false);
  });

  it('handles anchor-only after stripping to empty string', () => {
    // Edge case: link is just "#section" - after stripping anchor, empty string
    assert.equal(resolveLink('#section', nodes), false);
  });

  it('resolves nested path link via suffix match', () => {
    assert.equal(resolveLink('svelte/patterns', nodes), true);
  });
});

// --- validateAll ---

describe('validateAll', () => {
  let tmpDir;

  function createFile(name, content) {
    const filePath = path.join(tmpDir, name);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-links-test-'));
  }

  function teardown() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  it('returns empty object when all links are valid', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[node-b]] for details.');
      createFile('node-b.md', 'See [[node-a]] for details.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('reports broken links', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[nonexistent]] for details.');

      const result = validateAll(tmpDir);
      assert.ok(result['node-a.md']);
      assert.ok(result['node-a.md'].includes('nonexistent'));
    } finally {
      teardown();
    }
  });

  it('skips external links containing colon (e.g., repo: prefix)', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[repo:frontend/architecture]] here.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('strips central: prefix and validates the remainder', () => {
    setup();
    try {
      createFile('domain/emcc-context.md', '# EMCC Context');
      createFile('node-a.md', 'See [[central:domain/emcc-context]] here.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('reports broken link after stripping central: prefix', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[central:nonexistent]] here.');

      const result = validateAll(tmpDir);
      assert.ok(result['node-a.md']);
      assert.ok(result['node-a.md'].includes('central:nonexistent'));
    } finally {
      teardown();
    }
  });

  it('resolves links to files in subdirectories', () => {
    setup();
    try {
      createFile('domain/device-context.md', '# Device Context');
      createFile('node-a.md', 'See [[domain/device-context]] here.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('resolves links by filename only (without path)', () => {
    setup();
    try {
      createFile('domain/device-context.md', '# Device Context');
      createFile('node-a.md', 'See [[device-context]] here.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('resolves links with anchor fragments', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[node-b#some-section]] here.');
      createFile('node-b.md', '# Node B\n## Some Section');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('returns empty object for directory with no markdown files', () => {
    setup();
    try {
      createFile('readme.txt', 'Not a markdown file');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('returns empty object for nonexistent directory', () => {
    const result = validateAll(path.join(os.tmpdir(), 'nonexistent-dir-xyz'));
    assert.deepEqual(result, {});
  });

  it('handles files with no links', () => {
    setup();
    try {
      createFile('node-a.md', '# Just a heading\nNo links at all.');

      const result = validateAll(tmpDir);
      assert.deepEqual(result, {});
    } finally {
      teardown();
    }
  });

  it('reports multiple broken links from the same file', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[broken-1]] and [[broken-2]] here.');

      const result = validateAll(tmpDir);
      assert.ok(result['node-a.md']);
      assert.equal(result['node-a.md'].length, 2);
      assert.ok(result['node-a.md'].includes('broken-1'));
      assert.ok(result['node-a.md'].includes('broken-2'));
    } finally {
      teardown();
    }
  });

  it('reports broken links from multiple files', () => {
    setup();
    try {
      createFile('node-a.md', 'See [[broken-a]] here.');
      createFile('node-b.md', 'See [[broken-b]] here.');

      const result = validateAll(tmpDir);
      assert.ok(result['node-a.md']);
      assert.ok(result['node-b.md']);
    } finally {
      teardown();
    }
  });

  it('uses forward-slash relative paths as keys for subdirectory files', () => {
    setup();
    try {
      createFile('sub/node-a.md', 'See [[broken-link]] here.');

      const result = validateAll(tmpDir);
      const keys = Object.keys(result);
      assert.equal(keys.length, 1);
      assert.equal(keys[0], 'sub/node-a.md');
    } finally {
      teardown();
    }
  });
});
