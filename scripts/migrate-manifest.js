#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CURRENT = require('./manifest-schema.json').current;

// Ordered migration registry. Each step upgrades a manifest from `from` to `to`.
// transform(m) returns { manifest, changed, conflict }:
//   - manifest: the (mutated) manifest object
//   - changed:  true if a field was modified by this step
//   - conflict: a string describing an unresolvable state (stops the run), or null
const MIGRATIONS = [
    {
        from: 1,
        to: 2,
        describe: 'rename `workspace` -> `meta_repo`',
        transform(m) {
            const hasWs = typeof m.workspace === 'string';
            const hasMeta = typeof m.meta_repo === 'string';
            if (hasWs && !hasMeta) {
                m.meta_repo = m.workspace;
                delete m.workspace;
                return { manifest: m, changed: true, conflict: null };
            }
            if (hasWs && hasMeta) {
                if (m.workspace === m.meta_repo) {
                    delete m.workspace;
                    return { manifest: m, changed: true, conflict: null };
                }
                return {
                    manifest: m,
                    changed: false,
                    conflict: `both \`workspace\` ("${m.workspace}") and \`meta_repo\` ("${m.meta_repo}") are set with different values; resolve by hand`,
                };
            }
            // meta_repo-only, or neither present: shape is already fine for v2.
            return { manifest: m, changed: false, conflict: null };
        },
    },
];

function resolveVersion(m) {
    return Number.isInteger(m.schema_version) ? m.schema_version : 1;
}

// Apply every migration step from the manifest's version up to CURRENT.
// Result shape: { ok, manifest, changed, newer, conflict, fromVersion, toVersion }.
//   - newer: the manifest declares a schema this plugin doesn't understand yet
//     (fromVersion > CURRENT) — the plugin is out of date, not the workspace.
function migrate(manifestInput) {
    const m = JSON.parse(JSON.stringify(manifestInput)); // never mutate the caller's object
    const fromVersion = resolveVersion(m);
    if (fromVersion > CURRENT) {
        // Newer than we support: distinct from "current". The fix is to update the
        // plugin, not to migrate the manifest (mirrors the SessionStart ahead nag).
        return { ok: true, manifest: m, changed: false, newer: true, conflict: null, fromVersion, toVersion: fromVersion };
    }
    if (fromVersion === CURRENT) {
        return { ok: true, manifest: m, changed: false, newer: false, conflict: null, fromVersion, toVersion: fromVersion };
    }
    for (const step of MIGRATIONS) {
        if (step.from < fromVersion) continue; // already past this step
        if (step.to > CURRENT) break;          // don't overshoot the target
        const res = step.transform(m);
        if (res.conflict) {
            return { ok: false, manifest: m, changed: false, newer: false, conflict: res.conflict, fromVersion, toVersion: step.from };
        }
        m.schema_version = step.to;
    }
    // The file always changes when fromVersion < CURRENT: schema_version was stamped.
    return { ok: true, manifest: m, changed: true, newer: false, conflict: null, fromVersion, toVersion: CURRENT };
}

// --- CLI ---
function diffSummary(before, after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const lines = [];
    for (const k of keys) {
        const b = JSON.stringify(before[k]);
        const a = JSON.stringify(after[k]);
        if (b !== a) {
            lines.push(`  ${k}: ${b === undefined ? '(absent)' : b} -> ${a === undefined ? '(removed)' : a}`);
        }
    }
    return lines.join('\n');
}

function main(argv) {
    const args = argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const dirArg = args.find((a) => a.startsWith('--dir='));
    const dir = dirArg ? dirArg.slice('--dir='.length) : process.cwd();
    const manifestPath = path.join(dir, 'household.json');

    let before;
    try {
        before = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        console.error(`Cannot read household.json in ${dir}: ${e.message}`);
        process.exit(2);
    }

    const result = migrate(before);
    if (!result.ok) {
        console.error(`CONFLICT: ${result.conflict}`);
        process.exit(3);
    }
    if (result.newer) {
        console.error(`Workspace schema v${result.fromVersion} is newer than this plugin (v${CURRENT}). Update the plugin: /plugin update lorekeeper@witan.`);
        process.exit(4);
    }
    if (!result.changed) {
        console.log(`Already at schema v${CURRENT}. Nothing to migrate.`);
        process.exit(0);
    }

    const summary = diffSummary(before, result.manifest);
    if (dryRun) {
        console.log(`Would migrate v${result.fromVersion} -> v${result.toVersion}:`);
        console.log(summary);
        process.exit(0);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + '\n');
    console.log(`Migrated v${result.fromVersion} -> v${result.toVersion}:`);
    console.log(summary);
}

if (require.main === module) main(process.argv);

module.exports = { CURRENT, MIGRATIONS, resolveVersion, migrate };
