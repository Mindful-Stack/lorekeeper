const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./validate-frontmatter');

/**
 * Common English stop words to filter out of keyword extraction.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'this', 'that', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
  'can', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
  'just', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'any',
  'as', 'both', 'each', 'few', 'here', 'how', 'into', 'more', 'most',
  'much', 'my', 'other', 'our', 'out', 'own', 'same', 'she', 'he', 'they',
  'them', 'their', 'these', 'those', 'through', 'under', 'until', 'up',
  'we', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'you', 'your', 'such', 'only', 'some', 'over', 'between', 'before',
  'during', 'there', 'because', 'once', 'per', 'via', 'etc', 'e.g',
]);

/**
 * Recursively find all .md files in a directory, skipping _-prefixed files.
 *
 * @param {string} dir - Directory to search
 * @param {string[]} [files=[]] - Accumulator
 * @returns {string[]} Array of full file paths
 */
function findMarkdownFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMarkdownFiles(fullPath, files);
    } else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extract the text content of the ## Summary section from markdown.
 *
 * @param {string} content - Full markdown file content
 * @returns {string} Summary section text, or empty string if not found
 */
function extractSummarySection(content) {
  const match = content.match(/## Summary\s*\n([\s\S]*?)(?:\n## |\n#+ |$)/);
  if (!match) return '';
  return match[1].trim();
}

/**
 * Extract keywords from markdown content.
 *
 * Finds the ## Summary section and extracts meaningful multi-word phrases
 * and single significant words. Deduplicates against provided tags.
 *
 * @param {string} content - Full markdown file content
 * @param {string[]} [tags=[]] - Tags to deduplicate against
 * @returns {string[]} Array of 0-10 lowercase keyword strings
 */
function extractKeywords(content, tags = []) {
  const summary = extractSummarySection(content);
  if (!summary) return [];

  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  // Extract multi-word phrases by splitting on common delimiters
  // (commas, semicolons, periods, dashes used as separators, parentheses)
  const phrases = [];
  const singleWords = [];

  // Split summary into sentences/clauses
  const clauses = summary
    .replace(/[()[\]{}]/g, ' ')
    .split(/[,;.\n—–]+/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    // Clean the clause: strip markdown formatting
    const clean = clause
      .replace(/\*\*|__|`|#+/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // inline links
      .replace(/\[\[([^\]]*)\]\]/g, '$1')        // wikilinks
      .trim();

    if (!clean) continue;

    // Split into words
    const words = clean
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())
      .filter(w => w.length > 1);

    // Try to find meaningful 2-3 word phrases
    for (let len = 3; len >= 2; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        const phrase = words.slice(i, i + len);
        // A phrase is meaningful if at least one word is not a stop word
        const meaningful = phrase.filter(w => !STOP_WORDS.has(w) && !tagSet.has(w));
        if (meaningful.length >= Math.ceil(len / 2)) {
          const phraseStr = phrase.join(' ');
          if (!tagSet.has(phraseStr)) {
            phrases.push(phraseStr);
          }
        }
      }
    }

    // Collect single significant words
    for (const w of words) {
      if (w.length > 2 && !STOP_WORDS.has(w) && !tagSet.has(w)) {
        singleWords.push(w);
      }
    }
  }

  // Deduplicate: prefer multi-word phrases, then fill with single words
  const seen = new Set();
  const result = [];

  // Add multi-word phrases first (deduplicated)
  for (const phrase of phrases) {
    if (!seen.has(phrase) && result.length < 10) {
      seen.add(phrase);
      result.push(phrase);
    }
  }

  // Fill remaining slots with single words not already covered
  for (const word of singleWords) {
    if (result.length >= 10) break;
    // Skip if the word is already part of an included phrase
    const alreadyCovered = result.some(r => r.includes(word));
    if (!seen.has(word) && !alreadyCovered) {
      seen.add(word);
      result.push(word);
    }
  }

  return result;
}

/**
 * Build the knowledge index object from a knowledge directory.
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {{ total: number, nodes: Array }} Index object (no generated timestamp)
 */
function buildIndex(knowledgeDir) {
  const files = findMarkdownFiles(knowledgeDir);

  const nodes = files.map(filePath => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = parseFrontmatter(content);
    const relativePath = path.relative(knowledgeDir, filePath).replace(/\\/g, '/');
    const pathWithoutExt = relativePath.replace(/\.md$/, '');
    const category = pathWithoutExt.split('/')[0];
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const keywords = extractKeywords(content, tags);

    return {
      path: pathWithoutExt,
      file: relativePath,
      title: data.title || path.basename(pathWithoutExt),
      description: data.description || '',
      tags,
      keywords,
      category,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  return { total: nodes.length, nodes };
}

/**
 * Format an index object as one-node-per-line JSON string.
 *
 * @param {{ total: number, nodes: Array }} index
 * @returns {string} Formatted JSON string
 */
function formatIndex(index) {
  const lines = [
    `{"total":${index.total},"nodes":[`,
  ];
  for (let i = 0; i < index.nodes.length; i++) {
    const comma = i < index.nodes.length - 1 ? ',' : '';
    lines.push(JSON.stringify(index.nodes[i]) + comma);
  }
  lines.push(']}');
  return lines.join('\n') + '\n';
}

/**
 * Build and write _index.json to the knowledge directory.
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 */
function writeIndex(knowledgeDir) {
  const index = buildIndex(knowledgeDir);
  const outputPath = path.join(knowledgeDir, '_index.json');
  fs.writeFileSync(outputPath, formatIndex(index));
}

/**
 * Build index in memory and compare against committed _index.json.
 *
 * @param {string} knowledgeDir - Path to the knowledge directory
 * @returns {{ upToDate: boolean, diff?: string }}
 */
function checkIndex(knowledgeDir) {
  const index = buildIndex(knowledgeDir);
  const expected = formatIndex(index);
  const indexPath = path.join(knowledgeDir, '_index.json');

  if (!fs.existsSync(indexPath)) {
    return {
      upToDate: false,
      diff: '_index.json does not exist. Run build-index to generate it.',
    };
  }

  const actual = fs.readFileSync(indexPath, 'utf-8');

  if (actual === expected) {
    return { upToDate: true };
  }

  // Produce a simple diff description
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const diffLines = [];

  const maxLines = Math.max(actualLines.length, expectedLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (actualLines[i] !== expectedLines[i]) {
      if (actualLines[i] && !expectedLines[i]) {
        diffLines.push(`- line ${i + 1}: ${actualLines[i]}`);
      } else if (!actualLines[i] && expectedLines[i]) {
        diffLines.push(`+ line ${i + 1}: ${expectedLines[i]}`);
      } else {
        diffLines.push(`- line ${i + 1}: ${actualLines[i]}`);
        diffLines.push(`+ line ${i + 1}: ${expectedLines[i]}`);
      }
    }
  }

  return {
    upToDate: false,
    diff: diffLines.join('\n'),
  };
}

module.exports = { buildIndex, writeIndex, checkIndex, extractKeywords };
