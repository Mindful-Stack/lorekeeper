#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function detect(cwd) {
    cwd = fs.realpathSync(cwd);

    // Refuse common dump directories.
    const home = process.env.HOME ? fs.realpathSync(process.env.HOME) : null;
    if (home && (cwd === home || cwd === path.join(home, 'Source'))) {
        return {
            scenario: 'refused',
            context: { reason: `$HOME or $HOME/Source is too broad. Create a dedicated dir and run /lore:init there.` }
        };
    }

    const entries = fs.existsSync(cwd) ? fs.readdirSync(cwd) : [];

    // Already a workspace?
    if (entries.includes('household.json')) {
        return { scenario: 'already-a-workspace', context: {} };
    }

    // Empty dir → greenfield
    if (entries.length === 0) {
        return { scenario: 'greenfield', context: {} };
    }

    const hasGit = entries.includes('.git') && fs.statSync(path.join(cwd, '.git')).isDirectory();

    if (!hasGit) {
        // Check for poly-repo-retrofit (multiple child git repos)
        const childRepos = entries.filter(name => {
            const full = path.join(cwd, name);
            try {
                return fs.statSync(full).isDirectory()
                    && fs.existsSync(path.join(full, '.git'))
                    && fs.statSync(path.join(full, '.git')).isDirectory();
            } catch (_) {
                return false;
            }
        });
        if (childRepos.length >= 2) {
            return {
                scenario: 'poly-repo-retrofit',
                context: { repos: childRepos }
            };
        }
        return { scenario: 'files-no-git', context: {} };
    }

    // Has .git/ — check for docs/knowledge dir
    const docsDir = ['docs', 'knowledge', 'wiki'].find(d => {
        const full = path.join(cwd, d);
        return fs.existsSync(full) && fs.statSync(full).isDirectory();
    });
    if (docsDir) {
        return { scenario: 'docs-migration', context: { dir: docsDir } };
    }

    return { scenario: 'single-repo-retrofit', context: {} };
}

function main() {
    const result = detect(process.cwd());
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { detect };
