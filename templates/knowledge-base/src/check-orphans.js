const fs = require('fs');
const path = require('path');
const { extractLinks } = require('./validate-links');

/**
 * Recursively find all .md files in a directory.
 *
 * @param {string} dir - Directory to search
 * @param {string[]} [files=[]] - Accumulator for found files
 * @returns {string[]} Array of full file paths
 */
function findMarkdownFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMarkdownFiles(fullPath, files);
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Build a map of all knowledge nodes: { name -> relativePath }.
 * Each file contributes two entries:
 *   - stem (filename without extension)
 *   - full relative path without extension (e.g., "domain/device-management-context")
 *
 * Skips files whose name starts with _ (allowed orphans / entry points).
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {Map<string, string>} Map of node name to relative file path (with .md)
 */
function findAllNodes(knowledgeDir) {
  const nodes = new Map();
  const files = findMarkdownFiles(knowledgeDir);

  for (const filePath of files) {
    const basename = path.basename(filePath);

    // Skip _-prefixed files (allowed orphans)
    if (basename.startsWith('_')) {
      continue;
    }

    const relative = path.relative(knowledgeDir, filePath).replace(/\\/g, '/');
    const stem = path.basename(filePath, '.md');
    const relativeNoExt = relative.replace(/\.md$/, '');

    // Map both stem and full relative path (without ext) to the relative file path
    nodes.set(stem, relative);
    nodes.set(relativeNoExt, relative);
  }

  return nodes;
}

/**
 * Collect all wikilinks across all .md files in the knowledge directory.
 * Normalizes links by stripping "central:" prefix and ".md" extension.
 * For path-style links, also adds the filename-only variant.
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {Set<string>} Set of normalized link targets
 */
function findAllLinks(knowledgeDir) {
  const links = new Set();
  const files = findMarkdownFiles(knowledgeDir);

  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const rawLinks = extractLinks(content);
    for (const raw of rawLinks) {
      // Normalize: strip central: prefix and .md extension
      const clean = raw.replace('central:', '').replace('.md', '');
      links.add(clean);

      // Also add just the filename part for path-style links
      if (clean.includes('/')) {
        const filenamePart = clean.split('/').pop();
        links.add(filenamePart);
      }
    }
  }

  return links;
}

/**
 * Find orphaned knowledge nodes - files that are never linked to from any other file.
 * Skips _-prefixed files (allowed orphans / entry points).
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {string[]} Sorted, deduplicated array of relative file paths (forward slashes) for orphaned nodes
 */
function findOrphans(knowledgeDir) {
  if (!fs.existsSync(knowledgeDir)) {
    return [];
  }

  const nodes = findAllNodes(knowledgeDir);
  const links = findAllLinks(knowledgeDir);

  const orphanSet = new Set();

  for (const [name, relativePath] of nodes.entries()) {
    const stem = path.basename(relativePath, '.md');
    const relativeNoExt = relativePath.replace(/\.md$/, '');

    // Check if this node is linked anywhere (by stem or by relative path without ext)
    const isLinked = links.has(stem) || links.has(relativeNoExt);

    if (!isLinked) {
      orphanSet.add(relativePath);
    }
  }

  // Sort and return as array
  return [...orphanSet].sort();
}

module.exports = { findOrphans };
