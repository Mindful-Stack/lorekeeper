#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CANONICAL_SECTIONS = [
    'Purpose',
    'Key Entities',
    'Ubiquitous Language',
    'Integration Points',
    'Key Workflows',
];

function findWorkspaceRoot(cwd) {
    let dir = fs.realpathSync(cwd);
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, 'household.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

function detect(domainName, cwd) {
    const workspaceRoot = findWorkspaceRoot(cwd);
    if (!workspaceRoot) {
        return {
            error: 'not-in-witan-household',
            message: 'Could not find household.json in this directory or any parent. Run /lore:init to set up a witan-household first.',
        };
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'household.json'), 'utf8'));
    } catch (e) {
        return {
            error: 'manifest-unreadable',
            message: `household.json could not be parsed: ${e.message}`,
        };
    }

    const codeRepos = (manifest.repos || [])
        .filter((r) => r.name !== manifest.workspace && r.name !== manifest.knowledge_base)
        .map((r) => r.name);

    const kbDirName = manifest.knowledge_base || 'lore';
    const kbRoot = path.join(workspaceRoot, kbDirName, 'knowledge');
    const domainFileAbs = path.join(kbRoot, 'domain', `${domainName}.md`);
    const exists = fs.existsSync(domainFileAbs);

    const baseContext = {
        domain_name: domainName,
        domain_file_path: path.relative(workspaceRoot, domainFileAbs),
        exists,
        missing_sections: [],
        code_repos: codeRepos,
        kb_root: path.relative(workspaceRoot, kbRoot),
    };

    if (!exists) {
        return { mode: 'bootstrap', context: baseContext };
    }

    const content = fs.readFileSync(domainFileAbs, 'utf8');

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const isTaggedDomain =
        !!frontmatterMatch && /tags:\s*\[[^\]]*\bdomain\b/.test(frontmatterMatch[1]);

    if (!isTaggedDomain) {
        return {
            mode: 'bootstrap',
            context: {
                ...baseContext,
                warning: `File exists but frontmatter lacks tags: [domain, ...]; treating as bootstrap. Existing content will be preserved; review before applying.`,
            },
        };
    }

    const missing = CANONICAL_SECTIONS.filter((section) => {
        const pattern = new RegExp(`^##\\s+${section}\\b`, 'm');
        return !pattern.test(content);
    });

    if (missing.length > 0) {
        return { mode: 'refine', context: { ...baseContext, missing_sections: missing } };
    }

    return { mode: 'audit', context: baseContext };
}

function survey(cwd) {
    const workspaceRoot = findWorkspaceRoot(cwd);
    if (!workspaceRoot) {
        return {
            error: 'not-in-witan-household',
            message: 'Could not find household.json in this directory or any parent. Run /lore:init to set up a witan-household first.',
        };
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'household.json'), 'utf8'));
    } catch (e) {
        return {
            error: 'manifest-unreadable',
            message: `household.json could not be parsed: ${e.message}`,
        };
    }

    const codeRepos = (manifest.repos || [])
        .filter((r) => r.name !== manifest.workspace && r.name !== manifest.knowledge_base)
        .map((r) => r.name);

    const kbDirName = manifest.knowledge_base || 'lore';
    const kbRoot = path.join(workspaceRoot, kbDirName, 'knowledge');
    const domainDir = path.join(kbRoot, 'domain');

    const existingDomains = [];
    const kbWarnings = [];
    const readErrors = [];

    if (!fs.existsSync(kbRoot)) {
        kbWarnings.push(`knowledge dir not found at ${path.relative(workspaceRoot, kbRoot)}/ — no existing-domain audit possible. Run /lore:doctor to investigate.`);
    } else if (!fs.existsSync(domainDir)) {
        kbWarnings.push(`${path.relative(workspaceRoot, domainDir)}/ does not exist — no domain nodes to audit. New candidates from the codebase scan will still be surfaced.`);
    } else {
        for (const entry of fs.readdirSync(domainDir)) {
            if (!entry.endsWith('.md')) continue;
            const filePath = path.join(domainDir, entry);
            let content;
            try {
                content = fs.readFileSync(filePath, 'utf8');
            } catch (e) {
                readErrors.push({
                    file_path: path.relative(workspaceRoot, filePath),
                    message: e.message,
                });
                continue;
            }
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            const isTaggedDomain =
                !!frontmatterMatch && /tags:\s*\[[^\]]*\bdomain\b/.test(frontmatterMatch[1]);
            if (!isTaggedDomain) continue;
            const missing = CANONICAL_SECTIONS.filter((section) => {
                const pattern = new RegExp(`^##\\s+${section}\\b`, 'm');
                return !pattern.test(content);
            });
            existingDomains.push({
                name: entry.replace(/\.md$/, ''),
                file_path: path.relative(workspaceRoot, filePath),
                missing_sections: missing,
            });
        }
    }

    return {
        mode: 'survey',
        context: {
            workspace_root: workspaceRoot,
            kb_root: path.relative(workspaceRoot, kbRoot),
            code_repos: codeRepos,
            existing_domains: existingDomains,
            kb_warnings: kbWarnings,
            read_errors: readErrors,
        },
    };
}

function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error('Usage: cultivate-detect <domain-name> | --survey');
        process.exit(2);
    }
    const result = arg === '--survey' ? survey(process.cwd()) : detect(arg, process.cwd());
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { detect, survey, CANONICAL_SECTIONS };
