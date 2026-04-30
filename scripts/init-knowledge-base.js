#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '../templates/knowledge-base');
const CONFLICT_MARKERS = ['knowledge', 'knowledge.config.json', '_index.json'];

function ok(msg) { console.log(`[OK] ${msg}`); }
function fail(msg) { console.log(`[FAIL] ${msg}`); }

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && i + 1 < argv.length) {
      flags.target = argv[++i];
    }
  }
  return flags;
}

function detectConflicts(target) {
  if (!fs.existsSync(target)) return [];
  return CONFLICT_MARKERS.filter(m => fs.existsSync(path.join(target, m)));
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const target = path.resolve(flags.target || './shared-knowledge');

  const conflicts = detectConflicts(target);
  if (conflicts.length > 0) {
    fail(`Target ${target} already has: ${conflicts.join(', ')}`);
    console.log('Choose a different --target or remove the conflicting files.');
    process.exit(1);
  }

  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(TEMPLATE_DIR, target, { recursive: true, force: false, errorOnExist: true });
  ok(`Initialised knowledge base at ${target}`);
  console.log('Next steps:');
  console.log(`  1. Set KNOWLEDGE_BASE_PATH="${target}" or add { "knowledgeBasePath": "${target}" } to .lorekeeper/config.json`);
  console.log('  2. Restart Claude Code');
  console.log('  3. /lore:explore to browse');
}

main();
