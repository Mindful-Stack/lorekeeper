const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['title', 'description', 'tags'];

/**
 * Parse YAML frontmatter from markdown content.
 * Uses a simple regex-based approach (no full YAML parser needed).
 *
 * @param {string} content - Markdown file content
 * @returns {Object} Parsed frontmatter key-value pairs, or {} if none found
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

    // Parse inline arrays: [a, b, c]
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
 * Validate a single markdown file's frontmatter.
 *
 * @param {string} content - The file content as a string
 * @param {string} filename - The filename (used to skip _-prefixed files)
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateFile(content, filename) {
  // Skip _-prefixed files
  if (path.basename(filename).startsWith('_')) {
    return [];
  }

  const frontmatter = parseFrontmatter(content);

  // If parseFrontmatter returned empty and no frontmatter fence was found
  if (Object.keys(frontmatter).length === 0 && !content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)) {
    return ['Missing or invalid frontmatter'];
  }

  const errors = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in frontmatter)) {
      errors.push(`Missing required field: ${field}`);
    } else if (!frontmatter[field] || (typeof frontmatter[field] === 'string' && frontmatter[field].length === 0)) {
      errors.push(`Empty required field: ${field}`);
    }
  }

  // Validate tags is a list
  if ('tags' in frontmatter && !Array.isArray(frontmatter.tags)) {
    errors.push('Tags must be a list');
  }

  // Validate title length
  if ('title' in frontmatter && typeof frontmatter.title === 'string' && frontmatter.title.length > 100) {
    errors.push('Title too long (max 100 characters)');
  }

  // Validate description length
  if ('description' in frontmatter && typeof frontmatter.description === 'string' && frontmatter.description.length > 300) {
    errors.push('Description too long (max 300 characters)');
  }

  return errors;
}

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
 * Validate all markdown files in a knowledge directory.
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {Object.<string, string[]>} Map of relative filename to error arrays (only files with errors)
 */
function validateAll(knowledgeDir) {
  const allErrors = {};
  const files = findMarkdownFiles(knowledgeDir);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(knowledgeDir, filePath).replace(/\\/g, '/');
    const filename = path.basename(filePath);

    const errors = validateFile(content, filename);
    if (errors.length > 0) {
      allErrors[relativePath] = errors;
    }
  }

  return allErrors;
}

module.exports = { parseFrontmatter, validateFile, validateAll };
