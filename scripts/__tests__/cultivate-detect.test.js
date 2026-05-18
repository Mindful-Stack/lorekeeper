'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../cultivate-detect.js');

function detect(cwd, domainName) {
    const out = execSync(`node ${SCRIPT} ${domainName}`, { cwd, encoding: 'utf8' });
    return JSON.parse(out);
}

function withWorkspace(callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cultivate-detect-'));
    const root = fs.realpathSync(tmp);
    fs.writeFileSync(path.join(root, 'household.json'), JSON.stringify({
        workspace: 'test-workspace',
        knowledge_base: 'lore',
        repos: [
            { name: 'test-workspace' },
            { name: 'backend' },
            { name: 'lore' },
        ],
    }));
    fs.mkdirSync(path.join(root, 'lore', 'knowledge', 'domain'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    try {
        return callback(root);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

const COMPLETE_DOMAIN = `---
title: Grant Matching
description: Domain context for grant matching.
tags: [domain, core]
---

# Grant Matching

## Purpose

Match grants to users.

## Key Entities

- **Grant** — ...

## Ubiquitous Language

- *Grant* — ...

## Integration Points

- ...

## Key Workflows

- ...
`;

const INCOMPLETE_DOMAIN = `---
title: Grant Matching
description: ...
tags: [domain]
---

# Grant Matching

## Purpose

...

## Key Entities

...

## Ubiquitous Language

...

## Integration Points

...
`; // missing Key Workflows

const UNTAGGED_DOMAIN = `---
title: Grant Matching
tags: [general]
---

# Grant Matching

## Purpose

...
`;

test('domain file missing → bootstrap', () => withWorkspace((root) => {
    const result = detect(root, 'grant-matching');
    assert.equal(result.mode, 'bootstrap');
    assert.equal(result.context.exists, false);
    assert.equal(result.context.domain_name, 'grant-matching');
    assert.deepEqual(result.context.code_repos, ['backend']);
    assert.deepEqual(result.context.missing_sections, []);
}));

test('domain file with all canonical sections → audit', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grant-matching.md'), COMPLETE_DOMAIN);
    const result = detect(root, 'grant-matching');
    assert.equal(result.mode, 'audit');
    assert.deepEqual(result.context.missing_sections, []);
}));

test('domain file missing one canonical section → refine', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grant-matching.md'), INCOMPLETE_DOMAIN);
    const result = detect(root, 'grant-matching');
    assert.equal(result.mode, 'refine');
    assert.deepEqual(result.context.missing_sections, ['Key Workflows']);
}));

test('domain file without domain tag → bootstrap with warning', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grant-matching.md'), UNTAGGED_DOMAIN);
    const result = detect(root, 'grant-matching');
    assert.equal(result.mode, 'bootstrap');
    assert.match(result.context.warning, /tags.*\bdomain\b/);
}));

test('not in a witan-household → error payload', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cultivate-detect-'));
    try {
        const out = execSync(`node ${SCRIPT} grant-matching`, {
            cwd: fs.realpathSync(tmp),
            encoding: 'utf8',
        });
        const parsed = JSON.parse(out);
        assert.equal(parsed.error, 'not-in-witan-household');
        assert.match(parsed.message, /household\.json/i);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('missing domain arg → exit 2', () => {
    let exitCode = 0;
    try {
        execSync(`node ${SCRIPT}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        exitCode = e.status;
    }
    assert.equal(exitCode, 2);
});

// --- Survey mode tests ---

const COMPLETE_DOMAIN_FOR_SURVEY = COMPLETE_DOMAIN; // already defined above

const SECOND_DOMAIN_INCOMPLETE = `---
title: Users
description: User accounts.
tags: [domain]
---

# Users

## Purpose

...

## Key Entities

...
`; // missing Ubiquitous Language, Integration Points, Key Workflows

const UNTAGGED_FILE = `---
title: Some Notes
tags: [misc]
---

# Some Notes
`;

function survey(cwd) {
    const out = execSync(`node ${SCRIPT} --survey`, { cwd, encoding: 'utf8' });
    return JSON.parse(out);
}

test('survey: no domain files → empty existing_domains, populated code_repos', () => withWorkspace((root) => {
    const result = survey(root);
    assert.equal(result.mode, 'survey');
    assert.deepEqual(result.context.code_repos, ['backend']);
    assert.deepEqual(result.context.existing_domains, []);
    assert.equal(result.context.kb_root, 'lore/knowledge');
    assert.equal(result.context.workspace_root, root);
}));

test('survey: mixed domain files → each listed with missing_sections', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grants.md'), COMPLETE_DOMAIN_FOR_SURVEY);
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/users.md'), SECOND_DOMAIN_INCOMPLETE);
    const result = survey(root);
    assert.equal(result.context.existing_domains.length, 2);
    const grants = result.context.existing_domains.find(d => d.name === 'grants');
    const users = result.context.existing_domains.find(d => d.name === 'users');
    assert.deepEqual(grants.missing_sections, []);
    assert.deepEqual(users.missing_sections, ['Ubiquitous Language', 'Integration Points', 'Key Workflows']);
    assert.equal(grants.file_path, 'lore/knowledge/domain/grants.md');
}));

test('survey: skips files lacking domain tag in frontmatter', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grants.md'), COMPLETE_DOMAIN_FOR_SURVEY);
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/notes.md'), UNTAGGED_FILE);
    const result = survey(root);
    assert.equal(result.context.existing_domains.length, 1);
    assert.equal(result.context.existing_domains[0].name, 'grants');
    assert.deepEqual(result.context.kb_warnings, []);
    assert.deepEqual(result.context.read_errors, []);
}));

test('survey: domain/ dir missing → kb_warnings populated, no abort', () => withWorkspace((root) => {
    fs.rmSync(path.join(root, 'lore/knowledge/domain'), { recursive: true });
    const result = survey(root);
    assert.equal(result.mode, 'survey');
    assert.deepEqual(result.context.existing_domains, []);
    assert.equal(result.context.kb_warnings.length, 1);
    assert.match(result.context.kb_warnings[0], /domain\/ does not exist/);
}));

test('survey: knowledge/ dir missing → kb_warnings populated, no abort', () => withWorkspace((root) => {
    fs.rmSync(path.join(root, 'lore/knowledge'), { recursive: true });
    const result = survey(root);
    assert.equal(result.mode, 'survey');
    assert.deepEqual(result.context.existing_domains, []);
    assert.equal(result.context.kb_warnings.length, 1);
    assert.match(result.context.kb_warnings[0], /knowledge dir not found/);
}));

test('survey: unreadable .md file → recorded in read_errors, survey continues', () => withWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'lore/knowledge/domain/grants.md'), COMPLETE_DOMAIN_FOR_SURVEY);
    const badPath = path.join(root, 'lore/knowledge/domain/broken.md');
    fs.writeFileSync(badPath, 'placeholder');
    fs.chmodSync(badPath, 0o000);
    try {
        const result = survey(root);
        assert.equal(result.mode, 'survey');
        assert.equal(result.context.existing_domains.length, 1);
        assert.equal(result.context.existing_domains[0].name, 'grants');
        assert.equal(result.context.read_errors.length, 1);
        assert.equal(result.context.read_errors[0].file_path, 'lore/knowledge/domain/broken.md');
    } finally {
        fs.chmodSync(badPath, 0o644);
    }
}));
