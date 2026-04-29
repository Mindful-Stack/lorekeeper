const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { buildIndex, writeIndex, checkIndex, extractKeywords } = require('../build-index');

// --- Helpers ---

function createFile(tmpDir, name, content) {
  const filePath = path.join(tmpDir, name);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function setup() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'build-index-test-'));
}

function teardown(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function validMd(overrides = {}) {
  const title = overrides.title || 'Test Title';
  const description = overrides.description || 'A description';
  const tags = overrides.tags || '[test, example]';
  const body = overrides.body || '# Test Title\n\nSome body content.';
  return [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    `tags: ${tags}`,
    '---',
    '',
    body,
  ].join('\n');
}

// --- extractKeywords ---

describe('extractKeywords', () => {
  it('extracts keywords from Summary section', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [domain, test]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'This covers traffic management and device monitoring for road workers.',
      '',
      '## Details',
      '',
      'More info here.',
    ].join('\n');

    const keywords = extractKeywords(content, ['domain', 'test']);
    assert.ok(Array.isArray(keywords));
    assert.ok(keywords.length > 0);
    assert.ok(keywords.length <= 10);
    // All keywords should be lowercase strings
    for (const kw of keywords) {
      assert.equal(typeof kw, 'string');
      assert.equal(kw, kw.toLowerCase());
    }
  });

  it('returns empty array when no Summary section', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [test]',
      '---',
      '',
      '# Test',
      '',
      '## Details',
      '',
      'No summary here.',
    ].join('\n');

    const keywords = extractKeywords(content, ['test']);
    assert.deepEqual(keywords, []);
  });

  it('returns at most 10 keywords', () => {
    const longSummary = [
      'Alpha bravo charlie delta echo foxtrot golf hotel india juliet',
      'kilo lima mike november oscar papa quebec romeo sierra tango',
      'uniform victor whiskey xray yankee zulu',
    ].join(' ');

    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [test]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      longSummary,
      '',
      '## Next',
    ].join('\n');

    const keywords = extractKeywords(content, ['test']);
    assert.ok(keywords.length <= 10);
  });

  it('deduplicates against tags', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [domain, emcc]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'The domain context covers EMCC traffic management.',
      '',
      '## Next',
    ].join('\n');

    const keywords = extractKeywords(content, ['domain', 'emcc']);
    // "domain" and "emcc" should not appear in keywords since they are tags
    assert.ok(!keywords.includes('domain'));
    assert.ok(!keywords.includes('emcc'));
  });

  it('returns lowercase keywords', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [test]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'Traffic Management and Device Monitoring systems.',
      '',
      '## Next',
    ].join('\n');

    const keywords = extractKeywords(content, ['test']);
    for (const kw of keywords) {
      assert.equal(kw, kw.toLowerCase());
    }
  });

  it('filters out common stop words', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [test]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'This is a very important thing for the system and also the platform.',
      '',
      '## Next',
    ].join('\n');

    const keywords = extractKeywords(content, ['test']);
    // Common stop words should not be in keywords
    const stopWords = ['this', 'is', 'a', 'the', 'and', 'for', 'also', 'very'];
    for (const sw of stopWords) {
      assert.ok(!keywords.includes(sw), `Stop word "${sw}" should not be in keywords`);
    }
  });

  it('handles Summary as the last section (no following ##)', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [test]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'Traffic management and safety monitoring features.',
    ].join('\n');

    const keywords = extractKeywords(content, ['test']);
    assert.ok(Array.isArray(keywords));
    assert.ok(keywords.length > 0);
  });

  it('extracts multi-word phrases when present', () => {
    const content = [
      '---',
      'title: Test',
      'description: Desc',
      'tags: [domain]',
      '---',
      '',
      '# Test',
      '',
      '## Summary',
      '',
      'Covers traffic management, device monitoring, and road safety for workers.',
      '',
      '## Next',
    ].join('\n');

    const keywords = extractKeywords(content, ['domain']);
    // Should include multi-word phrases like "traffic management" or "device monitoring"
    const hasMultiWord = keywords.some(kw => kw.includes(' '));
    assert.ok(hasMultiWord, 'Should extract multi-word phrases');
  });
});

// --- buildIndex ---

describe('buildIndex', () => {
  it('builds index with total and nodes', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/test-context.md', validMd({
        title: 'Test Context',
        description: 'A test context',
        tags: '[domain, test]',
        body: '# Test Context\n\n## Summary\n\nManages testing infrastructure.\n\n## Details\n\nMore.',
      }));

      const index = buildIndex(tmpDir);
      assert.equal(typeof index.total, 'number');
      assert.equal(index.total, 1);
      assert.ok(Array.isArray(index.nodes));
      assert.equal(index.nodes.length, 1);
    } finally {
      teardown(tmpDir);
    }
  });

  it('does NOT include a generated timestamp', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd());
      const index = buildIndex(tmpDir);
      assert.ok(!('generated' in index), 'Index should not have a generated field');
    } finally {
      teardown(tmpDir);
    }
  });

  it('produces correct node shape', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/emcc-context.md', validMd({
        title: 'EMCC Context',
        description: 'Traffic management for EMCC',
        tags: '[domain, emcc]',
        body: '# EMCC Context\n\n## Summary\n\nTraffic management for chevron vans.\n\n## Next',
      }));

      const index = buildIndex(tmpDir);
      const node = index.nodes[0];

      assert.equal(node.path, 'domain/emcc-context');
      assert.equal(node.file, 'domain/emcc-context.md');
      assert.equal(node.title, 'EMCC Context');
      assert.equal(node.description, 'Traffic management for EMCC');
      assert.deepEqual(node.tags, ['domain', 'emcc']);
      assert.equal(node.category, 'domain');
      assert.ok(Array.isArray(node.keywords));
    } finally {
      teardown(tmpDir);
    }
  });

  it('includes keywords in each node', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/test.md', validMd({
        tags: '[domain, test]',
        body: '# Test\n\n## Summary\n\nCovers device monitoring and traffic management.\n\n## Next',
      }));

      const index = buildIndex(tmpDir);
      const node = index.nodes[0];
      assert.ok(Array.isArray(node.keywords));
      assert.ok(node.keywords.length > 0);
    } finally {
      teardown(tmpDir);
    }
  });

  it('skips _-prefixed files', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, '_index.json', '{}');
      createFile(tmpDir, '_overview.md', '# Overview');
      createFile(tmpDir, 'real.md', validMd());

      const index = buildIndex(tmpDir);
      assert.equal(index.total, 1);
      assert.equal(index.nodes[0].file, 'real.md');
    } finally {
      teardown(tmpDir);
    }
  });

  it('sorts nodes by path', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'zebra.md', validMd({ title: 'Zebra' }));
      createFile(tmpDir, 'alpha.md', validMd({ title: 'Alpha' }));
      createFile(tmpDir, 'middle.md', validMd({ title: 'Middle' }));

      const index = buildIndex(tmpDir);
      const paths = index.nodes.map(n => n.path);
      const sorted = [...paths].sort();
      assert.deepEqual(paths, sorted);
    } finally {
      teardown(tmpDir);
    }
  });

  it('uses filename as title when frontmatter title is missing', () => {
    const tmpDir = setup();
    try {
      const content = [
        '---',
        'description: Desc',
        'tags: [test]',
        '---',
        '',
        '# Heading',
      ].join('\n');
      createFile(tmpDir, 'my-node.md', content);

      const index = buildIndex(tmpDir);
      assert.equal(index.nodes[0].title, 'my-node');
    } finally {
      teardown(tmpDir);
    }
  });

  it('handles empty directory', () => {
    const tmpDir = setup();
    try {
      const index = buildIndex(tmpDir);
      assert.equal(index.total, 0);
      assert.deepEqual(index.nodes, []);
    } finally {
      teardown(tmpDir);
    }
  });

  it('handles nonexistent directory', () => {
    const index = buildIndex(path.join(os.tmpdir(), 'nonexistent-build-index-xyz'));
    assert.equal(index.total, 0);
    assert.deepEqual(index.nodes, []);
  });
});

// --- writeIndex ---

describe('writeIndex', () => {
  it('writes _index.json to the knowledge directory', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd({ body: '# Test\n\n## Summary\n\nSome content.\n\n## Next' }));

      writeIndex(tmpDir);

      const outputPath = path.join(tmpDir, '_index.json');
      assert.ok(fs.existsSync(outputPath));

      const content = fs.readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      assert.equal(parsed.total, 1);
      assert.ok(Array.isArray(parsed.nodes));
      assert.ok(!('generated' in parsed), 'Should not include generated timestamp');
    } finally {
      teardown(tmpDir);
    }
  });

  it('writes one-node-per-line format', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'alpha.md', validMd({ title: 'Alpha' }));
      createFile(tmpDir, 'beta.md', validMd({ title: 'Beta' }));

      writeIndex(tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, '_index.json'), 'utf-8');
      const lines = content.trimEnd().split('\n');

      // First line: header with total and opening bracket
      assert.ok(lines[0].startsWith('{"total":'));
      assert.ok(lines[0].endsWith(',"nodes":['));
      // Last line: closing bracket
      assert.equal(lines[lines.length - 1], ']}');
      // Middle lines: one node each
      assert.equal(lines.length, 2 + 2); // header + 2 nodes + closing
    } finally {
      teardown(tmpDir);
    }
  });

  it('produces valid JSON', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'domain/ctx.md', validMd({
        title: 'Context',
        tags: '[domain, ctx]',
        body: '# Context\n\n## Summary\n\nManages context things.\n\n## End',
      }));

      writeIndex(tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, '_index.json'), 'utf-8');
      // Should not throw
      const parsed = JSON.parse(content);
      assert.equal(parsed.total, 1);
    } finally {
      teardown(tmpDir);
    }
  });
});

// --- checkIndex ---

describe('checkIndex', () => {
  it('returns upToDate: true when committed index matches', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd({
        body: '# Test\n\n## Summary\n\nSome content.\n\n## Next',
      }));

      // First write the index
      writeIndex(tmpDir);

      // Then check - should be up to date
      const result = checkIndex(tmpDir);
      assert.equal(result.upToDate, true);
      assert.equal(result.diff, undefined);
    } finally {
      teardown(tmpDir);
    }
  });

  it('returns upToDate: false when index is missing', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd());

      const result = checkIndex(tmpDir);
      assert.equal(result.upToDate, false);
      assert.ok(result.diff);
    } finally {
      teardown(tmpDir);
    }
  });

  it('returns upToDate: false when index is stale', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd({
        body: '# Test\n\n## Summary\n\nOriginal content.\n\n## Next',
      }));

      writeIndex(tmpDir);

      // Now add a new file
      createFile(tmpDir, 'new-file.md', validMd({ title: 'New File' }));

      const result = checkIndex(tmpDir);
      assert.equal(result.upToDate, false);
      assert.ok(result.diff);
    } finally {
      teardown(tmpDir);
    }
  });

  it('diff describes what changed', () => {
    const tmpDir = setup();
    try {
      createFile(tmpDir, 'test.md', validMd());
      writeIndex(tmpDir);

      // Add a file
      createFile(tmpDir, 'added.md', validMd({ title: 'Added' }));

      const result = checkIndex(tmpDir);
      assert.equal(result.upToDate, false);
      assert.ok(typeof result.diff === 'string');
      assert.ok(result.diff.length > 0);
    } finally {
      teardown(tmpDir);
    }
  });
});
