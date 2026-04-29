#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../../knowledge');

/**
 * Parse YAML frontmatter from markdown content.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return {};

  const data = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim());
    }

    if (key) {
      data[key] = value;
    }
  }

  return data;
}

/**
 * Recursively find all markdown files in a directory.
 */
function findFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(fullPath, files);
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = findFiles(KNOWLEDGE_DIR);

const nodes = files.map(filePath => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = parseFrontmatter(content);
  const relativePath = path.relative(KNOWLEDGE_DIR, filePath).replace(/\\/g, '/');
  const pathWithoutExt = relativePath.replace(/\.md$/, '');
  const category = pathWithoutExt.split('/')[0];

  return {
    path: pathWithoutExt,
    file: relativePath,
    title: data.title || path.basename(pathWithoutExt),
    description: data.description || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    category
  };
}).sort((a, b) => a.path.localeCompare(b.path));

const index = {
  generated: new Date().toISOString(),
  total: nodes.length,
  nodes
};

const outputPath = path.join(KNOWLEDGE_DIR, '_index.json');
const lines = [
  `{"generated":${JSON.stringify(index.generated)},"total":${index.total},"nodes":[`
];
for (let i = 0; i < nodes.length; i++) {
  const comma = i < nodes.length - 1 ? ',' : '';
  lines.push(JSON.stringify(nodes[i]) + comma);
}
lines.push(']}');
fs.writeFileSync(outputPath, lines.join('\n') + '\n');

console.log(`Generated ${outputPath} with ${nodes.length} nodes`);
