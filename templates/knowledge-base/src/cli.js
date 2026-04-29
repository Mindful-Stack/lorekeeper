#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

const { validateAll: validateFrontmatter } = require('./validate-frontmatter');
const { validateAll: validateLinks } = require('./validate-links');
const { findOrphans } = require('./check-orphans');
const { writeIndex, checkIndex } = require('./build-index');

// --- Argument parsing ---

/**
 * Parse CLI arguments into a command and flags object.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ command: string, flags: Object }}
 */
function parseArgs(argv) {
  const flags = {};
  let command = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' && i + 1 < argv.length) {
      flags.dir = argv[++i];
    } else if (arg === '--links') {
      flags.links = true;
    } else if (arg === '--frontmatter') {
      flags.frontmatter = true;
    } else if (arg === '--orphans') {
      flags.orphans = true;
    } else if (!arg.startsWith('-') && !command) {
      command = arg;
    }
  }

  return { command, flags };
}

// --- Knowledge dir resolution ---

/**
 * Resolve the knowledge directory path.
 * Priority: --dir flag > KNOWLEDGE_BASE_PATH env var + /knowledge > ./knowledge
 *
 * @param {Object} flags - Parsed flags
 * @returns {string} Resolved knowledge directory path
 */
function resolveKnowledgeDir(flags) {
  // 1. --dir flag
  if (flags.dir) {
    return path.resolve(flags.dir);
  }

  // 2. KNOWLEDGE_BASE_PATH env var -> append /knowledge
  if (process.env.KNOWLEDGE_BASE_PATH) {
    return path.resolve(process.env.KNOWLEDGE_BASE_PATH, 'knowledge');
  }

  // 3. ./knowledge fallback
  return path.resolve('knowledge');
}

// --- Output helpers ---

function ok(msg) {
  console.log(`[OK] ${msg}`);
}

function warn(msg) {
  console.log(`[WARN] ${msg}`);
}

function fail(msg) {
  console.log(`[FAIL] ${msg}`);
}

// --- Commands ---

/**
 * Run validate command.
 * @param {string} knowledgeDir
 * @param {Object} flags
 * @returns {number} Exit code
 */
function cmdValidate(knowledgeDir, flags) {
  const runAll = !flags.links && !flags.frontmatter && !flags.orphans;
  let hasErrors = false;

  // Frontmatter validation
  if (runAll || flags.frontmatter) {
    const fmErrors = validateFrontmatter(knowledgeDir);
    const errorCount = Object.keys(fmErrors).length;

    if (errorCount > 0) {
      fail('Frontmatter errors found:');
      for (const [file, errors] of Object.entries(fmErrors)) {
        console.log(`  ${file}:`);
        for (const err of errors) {
          console.log(`    - ${err}`);
        }
      }
      hasErrors = true;
    } else {
      ok('All frontmatter valid');
    }
  }

  // Link validation
  if (runAll || flags.links) {
    const linkErrors = validateLinks(knowledgeDir);
    const brokenCount = Object.keys(linkErrors).length;

    if (brokenCount > 0) {
      fail('Broken links found:');
      for (const [file, broken] of Object.entries(linkErrors)) {
        console.log(`  ${file}:`);
        for (const link of broken) {
          console.log(`    - [[${link}]]`);
        }
      }
      hasErrors = true;
    } else {
      ok('All links valid');
    }
  }

  // Orphan check
  if (runAll || flags.orphans) {
    const orphans = findOrphans(knowledgeDir);

    if (orphans.length > 0) {
      warn(`${orphans.length} orphaned nodes found (not linked from anywhere):`);
      for (const orphan of orphans) {
        console.log(`  - ${orphan}`);
      }
    } else {
      ok('No orphaned nodes');
    }
  }

  return hasErrors ? 1 : 0;
}

/**
 * Run build-index command.
 * @param {string} knowledgeDir
 * @returns {number} Exit code
 */
function cmdBuildIndex(knowledgeDir) {
  if (!fs.existsSync(knowledgeDir)) {
    fail(`Knowledge directory not found: ${knowledgeDir}`);
    return 1;
  }

  try {
    writeIndex(knowledgeDir);
    const indexPath = path.join(knowledgeDir, '_index.json');
    ok(`Index built: ${indexPath}`);
    return 0;
  } catch (err) {
    fail(`Failed to build index: ${err.message}`);
    return 1;
  }
}

/**
 * Run check-index command.
 * @param {string} knowledgeDir
 * @returns {number} Exit code
 */
function cmdCheckIndex(knowledgeDir) {
  if (!fs.existsSync(knowledgeDir)) {
    fail(`Knowledge directory not found: ${knowledgeDir}`);
    return 1;
  }

  const result = checkIndex(knowledgeDir);

  if (result.upToDate) {
    ok('_index.json is up to date');
    return 0;
  }

  fail('_index.json is stale. Run `node src/cli.js build-index` to update.');
  if (result.diff) {
    console.log(result.diff);
  }
  return 1;
}

/**
 * Print help text.
 */
function printHelp() {
  console.log(`Usage: node src/cli.js <command> [options]

Commands:
  validate                  Run all validations (frontmatter, links, orphans)
  validate --frontmatter    Only frontmatter validation
  validate --links          Only link validation
  validate --orphans        Only orphan check (warnings)
  build-index               Rebuild _index.json
  check-index               Verify _index.json is up to date
  help                      Show this help message

Options:
  --dir <path>              Path to knowledge directory (default: auto-resolved)

Knowledge directory resolution (first wins):
  1. --dir <path>
  2. KNOWLEDGE_BASE_PATH env var + /knowledge
  3. ./knowledge (fallback)

Exit codes:
  0  Success (orphan warnings do not cause failure)
  1  Errors found or command failed`);
}

// --- Main ---

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (!['validate', 'build-index', 'check-index'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error('Run `node src/cli.js help` for usage information.');
    process.exit(1);
  }

  const knowledgeDir = resolveKnowledgeDir(flags);

  let exitCode;
  switch (command) {
    case 'validate':
      exitCode = cmdValidate(knowledgeDir, flags);
      break;
    case 'build-index':
      exitCode = cmdBuildIndex(knowledgeDir);
      break;
    case 'check-index':
      exitCode = cmdCheckIndex(knowledgeDir);
      break;
  }

  process.exit(exitCode);
}

main();
