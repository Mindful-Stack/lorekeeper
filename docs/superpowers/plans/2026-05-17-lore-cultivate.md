# `/lore:cultivate <domain>` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/lore:cultivate <domain>` — a smart-dispatching slash command that bootstraps a brand-new bounded-context node, refines an incomplete one, or audits a mature one for drift, all driven by a per-suggestion interactive-apply loop ending in a single PR via the existing `knowledge-updater` agent.

**Architecture:** A small JS helper (`scripts/cultivate-detect.js`) classifies the domain's current state and emits `{ mode, context }` JSON. The slash command markdown (`commands/cultivate.md`) reads that, dispatches per mode (bootstrap / refine / audit), runs the codebase scan via Claude's native tools (Glob/Grep/Read), drives the interactive flow via AskUserQuestion, batches approved suggestions, and dispatches the existing `knowledge-updater` agent (extended for batch input) to land them in one PR.

**Tech Stack:** Node.js (`node:test` for unit tests, no external deps). Babashka for integration scenarios. Markdown for command + agent definitions.

**Spec:** `docs/superpowers/specs/2026-05-17-lore-cultivate-design.md`

**Branch:** `feat/lore-cultivate` (already created; spec commit `3757a66` on it).

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/cultivate-detect.js` | **Create** | Mode classifier. Reads `household.json` + the candidate domain file. Emits `{ mode, context }` JSON. Pure: no codebase scan, no writes. ~80 lines. |
| `scripts/__tests__/cultivate-detect.test.js` | **Create** | Unit tests for the 5 detection cases from the spec's Testing section. |
| `agents/knowledge-updater/AGENT.md` | **Modify** | Extend the agent's accepted input shape to include an optional `changes: [...]` batch alongside the existing single-change fields. Back-compat preserved. |
| `commands/cultivate.md` | **Create** | The slash-command orchestration. Reads detect output; dispatches per mode; drives interactive flow; calls knowledge-updater. No JS logic — pure Claude-instruction markdown. |
| `commands/help.md` | **Modify** | Add `/lore:cultivate` row to the commands table. |
| `README.md` | **Modify** | Add `/lore:cultivate` to the commands table; add a `### Cultivate` subsection. |
| `test/scenarios.edn` | **Modify** | Add two Babashka scenarios per the spec's Testing section. |

---

## Task 1: `cultivate-detect.js` — TDD

**Files:**
- Create: `scripts/__tests__/cultivate-detect.test.js`
- Create: `scripts/cultivate-detect.js`

- [ ] **Step 1: Write the test file (failing — script doesn't exist yet)**

Create `scripts/__tests__/cultivate-detect.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test, confirm all six tests fail**

Run: `node --test scripts/__tests__/cultivate-detect.test.js`
Expected: every test fails with "Cannot find module '../cultivate-detect.js'" or similar.

- [ ] **Step 3: Write the script**

Create `scripts/cultivate-detect.js`:

```javascript
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

function main() {
    const domainName = process.argv[2];
    if (!domainName) {
        console.error('Usage: cultivate-detect <domain-name>');
        process.exit(2);
    }
    const result = detect(domainName, process.cwd());
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();

module.exports = { detect, CANONICAL_SECTIONS };
```

- [ ] **Step 4: Run the test, confirm all six tests pass**

Run: `node --test scripts/__tests__/cultivate-detect.test.js`
Expected: PASS for all six tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/cultivate-detect.js scripts/__tests__/cultivate-detect.test.js
git commit -m "feat(cultivate): detection script — classify domain state for /lore:cultivate dispatch"
```

---

## Task 2: Extend `knowledge-updater` agent for batch input

**Files:**
- Modify: `agents/knowledge-updater/AGENT.md`

- [ ] **Step 1: Read the current AGENT.md**

```bash
cat agents/knowledge-updater/AGENT.md
```

Find the "Input" section that lists `type`, `action`, `content`, `file_path`.

- [ ] **Step 2: Replace the Input section**

Find the existing `## Input` section. Replace it with:

```markdown
## Input

You receive ONE of these two shapes:

### Single-change shape (back-compat)

1. **Type** — what kind of knowledge: `learning`, `standard`, `domain`, `adr`
2. **Content** — the approved content to write (already reviewed by the developer)
3. **Action** — `create` (new file) or `update` (modify existing file)
4. **File path** (for updates) — which file to modify

### Batch shape (used by `/lore:cultivate`)

1. **changes** — an array of `{ action, file_path, content }` entries. Each entry is a single-file change. All entries in the batch land in ONE PR.
2. **pr_title** — title for the PR (e.g. `cultivate: grant-matching — bootstrap`).
3. **pr_body** — body for the PR; typically a bulleted list of which suggestions were applied.

When you receive the batch shape, you:
- Create ONE branch and ONE PR for the entire batch (do not open multiple PRs).
- Apply every `changes[i]` in order before committing.
- Use `pr_title` and `pr_body` verbatim for the PR.
- Run `make build-index` once at the end (not per-change), then commit the index alongside the substantive changes.
```

- [ ] **Step 3: Update the PR Workflow section to handle batch**

Find the existing `## PR Workflow` section. Update its preamble to:

```markdown
## PR Workflow

All changes follow this exact flow. For batch input (multiple `changes`), apply all changes within steps 4-6 BEFORE the index rebuild and commit:
```

(Leave the numbered steps that follow unchanged; only the preamble explanation adjusts.)

- [ ] **Step 4: Commit**

```bash
git add agents/knowledge-updater/AGENT.md
git commit -m "feat(knowledge-updater): accept batch input for /lore:cultivate sessions"
```

---

## Task 3: `commands/cultivate.md` — the orchestration

**Files:**
- Create: `commands/cultivate.md`

- [ ] **Step 1: Write the command markdown**

Create `commands/cultivate.md`:

```markdown
---
description: Cultivate a bounded-context domain node. Smart-dispatches by state — bootstraps a new node from a codebase scan, refines an existing one with missing sections, or audits a mature one for drift.
---

# Cultivate Command

Cultivate (bootstrap / refine / audit) a single bounded-context domain node. The command detects the domain's state and dispatches accordingly.

## Usage

```
/lore:cultivate <domain>     # required: the domain's slug (e.g. grant-matching)
```

Bare `/lore:cultivate` with no argument is reserved for a future whole-KB cultivation pass and currently refuses with usage instructions.

## Implementation

### Step 1: Validate argument

If the user invoked `/lore:cultivate` with no argument, print:

> `domain name required; usage: /lore:cultivate <domain>. (Future: whole-KB cultivation pass — see docs/superpowers/specs/2026-05-17-lore-cultivate-design.md "Future expansion".)`

Stop. Do not proceed.

### Step 2: Detect state

Use the Bash tool to run the detection script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/cultivate-detect.js <domain>
```

Parse the JSON output. Two top-level shapes:

- `{ error: "...", message: "..." }` — bail with the message and suggest `/lore:doctor`.
- `{ mode: "bootstrap"|"refine"|"audit", context: {...} }` — proceed to per-mode dispatch.

The `context` object has: `domain_name`, `domain_file_path`, `exists`, `missing_sections` (only populated for refine), `code_repos` (array of sibling repo names to scan), `kb_root` (relative path to the lore knowledge dir), optional `warning`.

### Step 3: Dispatch per mode

#### Bootstrap mode

1. Confirm with the user via AskUserQuestion:
   > "No existing doc for `<domain_name>`. I'll scan the codebase (`<code_repos joined>`), then walk you through DDD-shape Q&A. Continue?"
   Options: [Yes, proceed] / [Cancel].

2. **Codebase scan** using Claude's native tools. For each repo in `code_repos`:
   - Use Glob to find source files: `**/*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` (cap at first 500 files per repo to bound token usage).
   - Use Grep for class/struct/type/interface declarations. Patterns:
     - TypeScript/JS: `^(export\s+)?(class|interface|type)\s+(\w+)`
     - Rust: `^(pub\s+)?(struct|enum|trait)\s+(\w+)`
     - Python: `^class\s+(\w+)`
     - Go: `^type\s+(\w+)\s+(struct|interface)`
     - Generic noun capture: `^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=`
   - Read each match's surrounding context (5-10 lines) to extract the identifier.

3. Aggregate into a frequency-ranked list. Group by category:
   - **Candidate Entities** (class/struct/interface/type declarations) — top 15.
   - **Candidate Ubiquitous-Language Terms** — frequent multi-word noun phrases in identifiers (e.g. `matchingScore`, `eligibilityCheck`).
   - **Recent activity** — files changed in the last 30 days (`git log --since=30.days.ago --name-only --pretty=format:` filtered to source files).

4. Present the aggregated list inline; then run the interview via AskUserQuestion with FOUR questions (one at a time):

   Q1: **Purpose** — free text. Prompt: "What's the purpose of the `<domain_name>` domain? One sentence."

   Q2: **Key Entities** — multiSelect from candidates. Prompt: "Which of these are Key Entities for this domain? (Selectable from the scan; user can also type additional entities in 'Other'.)" Options: top 15 candidates each as an option label.

   Q3: **Ubiquitous Language terms** — multiSelect. Prompt: "Which terms belong in the Ubiquitous Language?" Options: top 15 term candidates.

   Q4: **Integration points** — multiSelect from existing domain-tagged nodes in the KB + free-text. Prompt: "Which other domains does this one integrate with?" Options: list `<kb_root>/domain/*.md` filenames (excluding `<domain_name>` itself).

5. Draft the full node body following the structure:

   ```markdown
   ---
   title: <Domain Name (title-cased from domain_name slug)>
   description: <derived from Purpose answer>
   tags: [domain, <user-supplied or inferred>]
   ---

   # <Domain Name>

   ## Purpose

   <Purpose answer>

   ## Key Entities

   <bullet list, one per selected entity, with placeholder description>

   ## Ubiquitous Language

   <bullet list, one per term>

   ## Integration Points

   <bullet list, with wikilinks to selected domain nodes>

   ## Key Workflows

   > To fill in — list 2-3 typical user-or-system workflows that pass through this domain. The cultivate command did not auto-generate workflows; they require human input.
   ```

6. Show the draft to the user. Run AskUserQuestion: [Looks good — open PR] / [Let me edit it first] / [Cancel].

7. If [Looks good — open PR]: dispatch the `knowledge-updater` agent via the Task tool with:
   ```
   subagent_type: knowledge-updater
   prompt: |
     Batch shape:
     changes:
       - action: create
         file_path: <domain_file_path>
         content: |
           <draft>
     pr_title: "cultivate: <domain_name> — bootstrap"
     pr_body: |
       Bootstrap from /lore:cultivate session:
       - Purpose: <Purpose answer>
       - Key Entities: <list>
       - Ubiquitous Language: <list>
       - Integration Points: <list>
   ```

8. Report the PR URL the agent returns.

#### Refine mode

1. Confirm: "Refining `<domain_name>` — `missing_sections` are: <list>. I'll scan the codebase for terms/entities to add and walk you through each suggestion. Continue?" Options: [Yes] / [Cancel].

2. Read the existing `<domain_file_path>`.

3. Codebase scan (same as bootstrap step 2-3) — aggregate candidates.

4. Build a suggestion list. Each suggestion is one of:
   - `missing-section` — one per entry in `missing_sections`, with proposed section heading + stub content.
   - `add-term` — a term appearing frequently in code but not in the doc's Ubiquitous Language section.
   - `add-entity` — a class/struct in code matching the domain area but not in Key Entities.
   - `link-cross-ref` — an integration point that exists but has no wikilink to a partner-context node.
   - `fix-broken-wikilink` — wikilinks in the doc that don't resolve to existing nodes.

5. Walk suggestions one at a time via AskUserQuestion. For each:
   - Show the suggestion (kind + proposed text).
   - Options: [Apply] / [Skip] / [Show more context].
   - On [Show more context]: display the relevant code lines or sibling-node text inline, then re-ask.

6. Accumulate approved suggestions. Compute the final updated file content by applying each approved suggestion in order (insert new sections at the end if missing; insert new bullets under existing sections; replace broken wikilinks).

7. Dispatch `knowledge-updater` with:
   ```
   changes:
     - action: update
       file_path: <domain_file_path>
       content: <updated full file>
   pr_title: "cultivate: <domain_name> — refine"
   pr_body: |
     Refine pass from /lore:cultivate session. Applied N of M suggestions:
     - <bullet per approved suggestion>
   ```

8. Report PR URL.

#### Audit mode

Identical to refine mode in structure. The suggestion mix is drift-flavoured rather than gap-flavoured:
- Terms in code but not in the doc's Ubiquitous Language.
- Class/struct names in code not in Key Entities.
- Files in domain code areas (heuristic: code paths containing the domain slug) changed in the last 30 days without a corresponding KB update (last commit on the domain file is older than the latest commit on those code paths).
- Dead wikilinks.

Use the same per-suggestion AskUserQuestion loop, same batch-PR dispatch. PR title: `cultivate: <domain_name> — audit`.

### Step 4: Handle warning context

If the detect output's `context.warning` is set (e.g. file exists but lacks the `domain` tag), surface it to the user BEFORE the confirmation in step 3. The user can [Continue anyway] (the bootstrap will replace whatever's there) or [Cancel] (preserves the existing untagged file).

## Notes

- The codebase scan iterates `context.code_repos` (already excludes the workspace meta-repo and the knowledge_base entry per the detect script's filter). No need to re-filter in the command.
- One `/lore:cultivate` invocation = at most one PR. If the user cancels at any prompt, NO PR is opened.
- Bootstrap creates one new file; refine/audit update one existing file. The `knowledge-updater` agent handles the branch/commit/PR mechanics either way.
```

- [ ] **Step 2: Sanity-check the markdown parses as a slash command**

Run: `head -3 commands/cultivate.md`
Expected: starts with `---\ndescription: ...\n---`.

Run: `grep -c '^### ' commands/cultivate.md`
Expected: ≥3 (sections for each mode).

- [ ] **Step 3: Commit**

```bash
git add commands/cultivate.md
git commit -m "feat(commands): /lore:cultivate — bounded-context cultivation with smart dispatch"
```

---

## Task 4: `commands/help.md` — add /lore:cultivate row

**Files:**
- Modify: `commands/help.md`

- [ ] **Step 1: Read the current help.md commands table**

```bash
grep -n "lore:" commands/help.md | head -15
```

Locate the commands table (rows like `| /lore:help | ... |`).

- [ ] **Step 2: Insert a row for /lore:cultivate**

Use the Edit tool. Find the row for `/lore:doctor` (alphabetically nearest) and insert the cultivate row immediately after it. Example old_string + new_string:

```
old_string:
| `/lore:doctor` | Run full workspace + KB diagnostic |

new_string:
| `/lore:doctor` | Run full workspace + KB diagnostic |
| `/lore:cultivate` | Cultivate a bounded-context domain (bootstrap / refine / audit) |
```

If the help.md uses a different exact wording for `/lore:doctor`'s row, match that exactly.

- [ ] **Step 3: Commit**

```bash
git add commands/help.md
git commit -m "docs(help): add /lore:cultivate row"
```

---

## Task 5: README.md — add /lore:cultivate to table + subsection

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add to the commands table near the top**

Find the existing commands table in `README.md` (search for `| /lore:help |` or similar). Insert after the `/lore:doctor` row:

```markdown
| `/lore:cultivate` | Cultivate a bounded-context domain (bootstrap a new one, refine gaps, or audit drift) |
```

- [ ] **Step 2: Add a `### Cultivate` subsection**

After the existing `### Doctor` subsection (or wherever the per-command subsections live), add:

```markdown
### Cultivate

Cultivate a single bounded-context domain node:

```bash
/lore:cultivate <domain>      # e.g. /lore:cultivate grant-matching
```

The command detects the domain's current state and dispatches:

- **Bootstrap** (no doc exists): scans the codebase for entity + language candidates, walks you through DDD-shape Q&A, drafts a complete node, opens a PR.
- **Refine** (doc exists, missing canonical sections or has gaps): identifies missing sections + drift, walks you through per-suggestion [Apply]/[Skip] prompts, batches approved changes into one PR.
- **Audit** (mature doc): same loop as refine, focused on drift detection (terms in code not in doc, recent file activity without KB updates, dead wikilinks).

All three modes scan the manifest repos (excluding the workspace meta-repo and the knowledge-base entry). One invocation = at most one PR; cancelling at any prompt = no PR.

Bare `/lore:cultivate` with no argument is reserved for a future whole-KB cultivation pass.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document /lore:cultivate"
```

---

## Task 6: Babashka scenarios

**Files:**
- Modify: `test/scenarios.edn`

- [ ] **Step 1: Read the current scenarios.edn**

```bash
cat test/scenarios.edn
```

Locate the closing `]` of the scenarios vector.

- [ ] **Step 2: Append two scenarios before the closing `]`**

Use Edit. Find the LAST scenario in the file (whatever it currently is) and insert these two scenarios after it (before the `]` that closes the vector):

```clojure
 {:name "cultivate-no-arg-refuses"
  :prompt "/lore:cultivate"
  :workdir "."
  :expects ["domain name required|usage|future"]}

 {:name "cultivate-bootstrap-prompts-for-purpose"
  :prompt "/lore:cultivate fresh-domain"
  :workdir "."
  :expects ["Purpose|Key Entities|Ubiquitous Language|household.json"]}
```

The second scenario will likely hit the `not-in-witan-household` error path because the plugin repo itself isn't a household. The regex tolerates that with the `household.json` alternation — Claude's output will mention the missing manifest, which is the expected behaviour from `cultivate-detect`.

- [ ] **Step 3: Commit**

```bash
git add test/scenarios.edn
git commit -m "test(scenarios): add /lore:cultivate Babashka scenarios"
```

---

## Task 7: Final smoke + open PR

**Files:** none (verification only)

- [ ] **Step 1: Run all Node tests**

```bash
node --test scripts/__tests__/*.test.js 2>&1 | tail -10
```

Expected: all tests pass (init-detect from earlier + the 6 new cultivate-detect tests).

- [ ] **Step 2: Run Babashka scenarios if installed**

```bash
bb test/run-tests.clj 2>&1 | tail -15 || echo "bb not installed; skipping"
```

If bb is installed: confirm the two new cultivate scenarios pass.
If not installed: skip (the user runs them later).

- [ ] **Step 3: Verify no orphan references**

```bash
grep -rln 'cultivate-detect\|lore:cultivate' \
    --include='*.md' --include='*.js' \
    /home/daniel/Source/lorekeeper/ | sort
```

Expected output (the spec + plan + code + tests + commands + readme + scenarios):
- `commands/cultivate.md`
- `commands/help.md`
- `README.md`
- `scripts/cultivate-detect.js`
- `scripts/__tests__/cultivate-detect.test.js`
- `test/scenarios.edn`
- `docs/superpowers/specs/2026-05-17-lore-cultivate-design.md`
- `docs/superpowers/plans/2026-05-17-lore-cultivate.md`

No others. If there are unexpected hits, investigate before opening the PR.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --repo Mindful-Stack/lorekeeper \
  --base main --head feat/lore-cultivate \
  --title "feat: /lore:cultivate — bounded-context domain cultivation" \
  --body "$(cat <<'EOF'
## Summary

Adds `/lore:cultivate <domain>` — a smart-dispatching slash command for cultivating bounded-context lore. Designed against Grantigo's just-starting DDD journey as the canonical case.

Spec: docs/superpowers/specs/2026-05-17-lore-cultivate-design.md

## Behaviour

Detects the state of `lore/knowledge/domain/<name>.md` and dispatches:
- **bootstrap** (no doc) — codebase scan + DDD-shape interview → drafts a full node → PR
- **refine** (doc missing sections) — gap detection + per-suggestion apply → batch PR
- **audit** (mature doc) — drift detection + per-suggestion apply → batch PR

All three modes scan `manifest.repos` minus workspace minus knowledge_base. Per-suggestion interactive apply via AskUserQuestion. Single PR per session via the existing knowledge-updater agent (extended for batch input).

## Changes

- `scripts/cultivate-detect.js` (new) + 6 unit tests
- `commands/cultivate.md` (new) — the orchestration markdown
- `agents/knowledge-updater/AGENT.md` — extended to accept batch input (back-compat preserved)
- `commands/help.md`, `README.md` — surface the new command
- `test/scenarios.edn` — two Babashka scenarios

## Test plan

- [x] node --test scripts/__tests__/cultivate-detect.test.js — 6/6 pass
- [ ] bb test/run-tests.clj — runs on a machine with Babashka installed
- [ ] Manual smoke against Grantigo: /lore:cultivate grant-matching from inside a witan-household → bootstrap mode → entity candidates surface from portal/file-extractor → interview produces draft → PR opens against the household's lore.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Print the PR URL**

The `gh pr create` command outputs the URL. Capture and report.

---

## Self-review

### Spec coverage

Each spec section maps to at least one task:

- **Architecture** (spec §3) → Tasks 1 (detect helper), 3 (command markdown), 2 (knowledge-updater extension).
- **Per-mode behaviour** → Task 3 (all three modes encoded in the command markdown).
- **Data flow** (detect JSON shape, codebase-scan output, suggestion structure, knowledge-updater batch) → Tasks 1, 3, 2.
- **Error semantics** → Task 1 (detect handles missing-household, malformed manifest); Task 3 (command handles cancel-mid-interview, knowledge-updater failure, missing-arg, warning context).
- **Testing** (unit + Babashka) → Tasks 1, 6, 7.
- **Future expansion** (whole-KB, per-category, Reeve integration) → captured in the spec; out of scope for this plan.

No spec section is unaddressed.

### Placeholder scan

No "TBD" / "implement later" / "similar to Task N" in any step. Each task has concrete code, exact paths, exact commands.

### Type/interface consistency

- `cultivate-detect` output shape (`{ mode, context: {domain_name, domain_file_path, exists, missing_sections, code_repos, kb_root, warning? } }`) used identically in Task 1 (defined), Task 3 (consumed by the command markdown).
- `knowledge-updater` batch input shape (`{ changes: [...], pr_title, pr_body }`) defined in Task 2, consumed in Task 3 (both bootstrap and refine/audit dispatch).
- `CANONICAL_SECTIONS` array (5 entries) — defined in Task 1, referenced for the same 5 sections in Task 3's bootstrap-draft template.
- AskUserQuestion `multiSelect` option used for entity / term / integration selection in Task 3 — consistent with how `/lore:init` and `/lore:doctor` use it.

No inconsistencies.

### Sequencing

Task ordering matters:
1. cultivate-detect.js (independent — pure JS) → ships first; unblocks Task 3.
2. knowledge-updater extension (independent — markdown) → can ship before or alongside Task 3; safe ordering puts it before.
3. commands/cultivate.md (consumes both Task 1 and Task 2 artefacts) → ships third.
4. help.md, README.md (documentation) → after the command exists.
5. scenarios.edn (tests the command) → after the command exists.
6. PR (everything green) → last.

This ordering is reflected in the task numbers; subagent-driven-development should follow it.
