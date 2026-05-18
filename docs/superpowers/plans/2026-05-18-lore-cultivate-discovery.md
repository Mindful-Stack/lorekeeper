# `/lore:cultivate` (no-arg) Discovery + Skill Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add no-arg `/lore:cultivate` that surveys candidate bounded contexts + audits existing domain nodes, lets the user prioritize 0-3 items, and chains the existing per-domain cultivate flow once per pick. Concurrently refactor per-domain cultivate from a slash-command body into a skill so the discovery flow can chain it via the Skill tool.

**Architecture:** `commands/cultivate.md` becomes a thin ~10-line wrapper that dispatches on arg presence (mirroring `commands/review.md`'s pattern). Per-domain logic moves verbatim to `skills/cultivate/SKILL.md`. New `skills/cultivate-discovery/SKILL.md` runs the survey flow. `scripts/cultivate-detect.js` gains a `--survey` mode emitting a household-wide JSON snapshot.

**Tech Stack:** Node.js (`node:test`). Markdown for slash command + skills. Babashka for integration scenarios. No external deps.

**Spec:** `docs/superpowers/specs/2026-05-18-lore-cultivate-discovery-design.md`

**Branch:** `feat/lore-cultivate` (rides on PR #3; spec commit `e507417` on it).

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/cultivate-detect.js` | **Modify** | Add `--survey` flag handling at the top of `main()`. When the flag is present, dispatch to a new `survey()` function that emits the household-wide snapshot. The existing per-domain `detect()` path stays unchanged. |
| `scripts/__tests__/cultivate-detect.test.js` | **Modify** | Add 3 new tests for survey mode (empty domains, mixed domains, untagged-files-skipped). Existing 6 tests untouched. |
| `commands/cultivate.md` | **Rewrite** | Reduce to ~10-line thin wrapper. Body moves to `skills/cultivate/SKILL.md`. |
| `skills/cultivate/SKILL.md` | **Create** | Skill frontmatter + the verbatim body lifted from current `commands/cultivate.md`. Zero functional change. |
| `skills/cultivate-discovery/SKILL.md` | **Create** | New skill — survey, prioritize, chain. ~150-line markdown driving Claude through the discovery flow. |
| `test/scenarios.edn` | **Modify** | Replace `cultivate-no-arg-refuses` with `cultivate-no-arg-runs-discovery`. Keep `cultivate-bootstrap-prompts-for-purpose`. |
| `commands/help.md` | **Modify** | Update `/lore:cultivate` row description to mention both forms (with arg = per-domain; without = discovery). |
| `README.md` | **Modify** | Update `/lore:cultivate` table row + `### Cultivate` subsection to describe the no-arg discovery form. |

---

## Task 1: `cultivate-detect.js --survey` mode (TDD)

**Files:**
- Modify: `scripts/__tests__/cultivate-detect.test.js`
- Modify: `scripts/cultivate-detect.js`

- [ ] **Step 1: Append 3 failing tests for survey mode**

Open `scripts/__tests__/cultivate-detect.test.js`. After the existing 6 tests (before any `module.exports` if present, otherwise just before EOF), append:

```javascript
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
}));
```

- [ ] **Step 2: Run tests, confirm the 3 new ones fail**

```bash
cd /home/daniel/Source/lorekeeper
node --test scripts/__tests__/cultivate-detect.test.js 2>&1 | tail -15
```

Expected: existing 6 tests pass; the 3 new tests fail with `survey is not a valid command` or similar.

- [ ] **Step 3: Add survey-mode handling to `cultivate-detect.js`**

Open `scripts/cultivate-detect.js`. Add a `survey` function after the existing `detect` function (and before `main`):

```javascript
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
    if (fs.existsSync(domainDir)) {
        for (const entry of fs.readdirSync(domainDir)) {
            if (!entry.endsWith('.md')) continue;
            const filePath = path.join(domainDir, entry);
            const content = fs.readFileSync(filePath, 'utf8');
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
        },
    };
}
```

- [ ] **Step 4: Update `main()` to dispatch on `--survey`**

Find the existing `main()`:

```javascript
function main() {
    const domainName = process.argv[2];
    if (!domainName) {
        console.error('Usage: cultivate-detect <domain-name>');
        process.exit(2);
    }
    const result = detect(domainName, process.cwd());
    console.log(JSON.stringify(result, null, 2));
}
```

Replace with:

```javascript
function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error('Usage: cultivate-detect <domain-name> | --survey');
        process.exit(2);
    }
    const result = arg === '--survey' ? survey(process.cwd()) : detect(arg, process.cwd());
    console.log(JSON.stringify(result, null, 2));
}
```

- [ ] **Step 5: Update `module.exports`**

Find the bottom of the file:

```javascript
module.exports = { detect, CANONICAL_SECTIONS };
```

Replace with:

```javascript
module.exports = { detect, survey, CANONICAL_SECTIONS };
```

- [ ] **Step 6: Run tests, confirm all 9 pass**

```bash
cd /home/daniel/Source/lorekeeper
node --test scripts/__tests__/cultivate-detect.test.js 2>&1 | tail -10
```

Expected: 9 tests pass (6 existing + 3 new survey).

- [ ] **Step 7: Commit and push**

```bash
git add scripts/cultivate-detect.js scripts/__tests__/cultivate-detect.test.js
git commit -m "feat(cultivate-detect): --survey mode for household-wide snapshot"
git push origin feat/lore-cultivate
```

---

## Task 2: Extract cultivate skill from slash command

**Files:**
- Create: `skills/cultivate/SKILL.md`
- Rewrite: `commands/cultivate.md`

- [ ] **Step 1: Read the current cultivate.md body**

```bash
cat /home/daniel/Source/lorekeeper/commands/cultivate.md
```

Note the body content (everything after the closing `---` of frontmatter). This is what moves verbatim into the skill.

- [ ] **Step 2: Create the cultivate skill file**

Create `skills/cultivate/SKILL.md` with frontmatter + the body verbatim:

```markdown
---
name: cultivate
description: Cultivate a single bounded-context domain node — bootstrap a new one from a codebase scan, refine an existing one with missing canonical DDD sections, or audit a mature one for drift. Use when the user invokes /lore:cultivate <domain> or asks to flesh out a specific bounded context.
---

# Cultivate

Cultivate (bootstrap / refine / audit) a single bounded-context domain node. The command detects the domain's state and dispatches accordingly.

## Usage

...
```

The body (from "Cultivate (bootstrap / refine / audit) a single bounded-context domain node..." through the Notes section) must match the current `commands/cultivate.md` body exactly. Use `cat commands/cultivate.md` to extract, then prepend the skill frontmatter above.

Note that the "Usage" section's `/lore:cultivate <domain>` syntax stays the same — the skill is invoked by Claude on the user's behalf, with the same effective shape.

- [ ] **Step 3: Rewrite commands/cultivate.md to a thin wrapper**

Replace the entire contents of `commands/cultivate.md` with:

```markdown
---
description: Cultivate a bounded-context domain. With a name argument, work on that specific domain. Without an argument, discover candidate bounded contexts in the codebase and audit existing ones.
---

# Cultivate Command

If the user provided a domain name argument, invoke the `cultivate` skill and follow it exactly as presented, passing the domain name through.

If no argument was provided, invoke the `cultivate-discovery` skill and follow it exactly as presented.
```

- [ ] **Step 4: Verify the slash command file shrank**

```bash
wc -l /home/daniel/Source/lorekeeper/commands/cultivate.md
```

Expected: ~10 lines (frontmatter + body).

```bash
wc -l /home/daniel/Source/lorekeeper/skills/cultivate/SKILL.md
```

Expected: ~190 lines (matches the original cultivate.md size minus the 3-line frontmatter difference, plus the slightly longer skill frontmatter).

- [ ] **Step 5: Commit and push**

```bash
git add skills/cultivate/SKILL.md commands/cultivate.md
git commit -m "refactor(cultivate): extract per-domain logic to skill; commands/cultivate.md becomes thin wrapper"
git push origin feat/lore-cultivate
```

---

## Task 3: Add `cultivate-discovery` skill

**Files:**
- Create: `skills/cultivate-discovery/SKILL.md`

- [ ] **Step 1: Create the discovery skill**

Create `skills/cultivate-discovery/SKILL.md` with EXACTLY this content:

````markdown
---
name: cultivate-discovery
description: Discover candidate bounded contexts in a witan-household's codebase and audit existing domain nodes. Use when the user invokes /lore:cultivate with no argument, or when they ask "what domains does this project have?" or "help me find bounded contexts" or similar exploratory DDD questions in a witan-household with code repos.
---

# Cultivate — Discovery

Survey a witan-household: discover candidate bounded contexts from the codebase, audit existing domain nodes, let the user prioritize 0-3 items, then chain the `cultivate` skill once per pick.

## Implementation

### Step 1: Pre-flight via `cultivate-detect.js --survey`

Use the Bash tool:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/cultivate-detect.js --survey
```

Parse the JSON output. Two shapes:

- `{ error: "...", message: "..." }` — bail. Print the message; suggest `/lore:doctor` for diagnostics. Do not proceed.
- `{ mode: "survey", context: {...} }` — proceed. The `context` has: `workspace_root`, `kb_root`, `code_repos`, `existing_domains` (array of `{ name, file_path, missing_sections }`).

### Step 2: Codebase scan

For each repo in `context.code_repos`:

- Use Glob to find source files: `**/*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` (cap at the first 500 files per repo to bound token usage).
- Use Grep for class/struct/type/interface declarations. Patterns:
  - TypeScript/JS: `^(export\s+)?(class|interface|type)\s+(\w+)`
  - Rust: `^(pub\s+)?(struct|enum|trait)\s+(\w+)`
  - Python: `^class\s+(\w+)`
  - Go: `^type\s+(\w+)\s+(struct|interface)`
  - C#/Java/Kotlin: `^(public\s+)?(class|interface|record|enum)\s+(\w+)`
- Sample top-2 levels of directory structure to understand the repo's organisation.

Aggregate into a frequency-ranked list of identifiers per repo, grouped by their directory location.

### Step 3: Existing-node audit

For each entry in `context.existing_domains`:

- The detect script already computed `missing_sections`.
- Additionally check (Claude inspects the file content from `<workspace_root>/<file_path>`):
  - **Drift signals**: terms appearing frequently in `context.code_repos` source files but NOT in the doc's `## Ubiquitous Language` section.
  - **Stale activity**: files matching the domain's slug in code paths changed in the last 30 days while the doc itself wasn't touched (compare `git log --since="30 days ago"` on code paths vs the doc's last commit).
  - **Dead wikilinks**: `[[wikilink]]` references in the doc that don't resolve to existing nodes anywhere under `<kb_root>`.

Aggregate findings per existing domain.

### Step 4: Claude judgment — propose candidate contexts

With the scan + audit signals in mind, propose **candidate bounded contexts** that the codebase suggests but the KB doesn't have. Use pattern recognition:

- **Directory clustering**: a single subdirectory housing many related types (e.g. `portal/src/grants/*` with `Grant`, `GrantApplication`, `Eligibility`, ... → candidate "grants" context).
- **Naming clustering**: types sharing a prefix or thematic keyword across files (e.g. all `*Match*` types → candidate "matching" context).
- **Import topology**: clusters of modules that import each other tightly while having few imports across the cluster boundary.

For each candidate, capture:
- A proposed name (kebab-case slug suitable for `domain/<name>.md`).
- The strongest evidence: 1-2 lines (e.g. "12 entity declarations in `portal/src/grants/`").
- A one-sentence rationale.

Cap displayed candidates at 10. If more were detected, mention the cap in the survey output.

### Step 5: Render sectioned survey

Print the survey as inline markdown:

```
## New candidate domains (N found)

- **<slug>** — <evidence>; rationale: <one sentence>.
- ...

## Existing domains with findings (M total)

- **<name>** — missing sections: <list or "none">; drift signals: <list or "none">.
- ...

## Healthy domains (K total)

<comma-separated names of existing domains with no findings, or skip section if K = 0 or list is overwhelming>
```

If both N and M are zero, print:

> Your KB looks healthy; nothing to surface today.

And exit (do not run Step 6 or 7).

### Step 6: Prioritize via AskUserQuestion

Use AskUserQuestion with `multiSelect: true` and a hard cap of 3 selections:

> "Which items do you want to act on now? (Pick 0-3. Each pick chains into a full `/lore:cultivate <name>` flow with its own PR. Re-run discovery after acting on these to see the rest.)"

Options: every new candidate's `<slug>` + every existing-domain-with-findings entry, each presented as `<name> — <one-line summary>`.

If the user picks 0 items: print `Survey complete; nothing actioned.` and exit zero.

### Step 7: Chain into cultivate skill (sequential)

For each picked item, in the order the user listed them:

- Use the Skill tool: `skill: cultivate`, prompt context including the picked domain name.
- Wait for the chained skill to complete. It will run its full per-domain flow (bootstrap for new candidates / refine or audit for existing domains, per its own state detection) and either return a PR URL or a cancellation message.
- Record the result (`{ name, status: "pr-opened" | "cancelled" | "failed", detail: <url or message> }`).
- Continue to the next picked item even if one failed — don't abort the whole session on a single failure.

### Step 8: Final summary

Print a recap:

```
Discovery session complete.
Surveyed: N candidate domains, M existing-domain findings, K healthy domains.
Actioned: <count> of the picks.
PRs opened:
  - <name>: <url>
  - <name>: <url>
Other outcomes:
  - <name>: cancelled / failed — <reason>
```

## Error semantics

- **Not in a witan-household** → bail with the detect-script error; suggest `/lore:doctor`.
- **Zero candidates AND zero existing-node findings** → friendly "your KB looks healthy" message; exit.
- **One existing-node file has malformed frontmatter** → already filtered out by `--survey`'s tag check; nothing to handle here.
- **Codebase scan yields no parseable source** in any repo → flag in the report ("no candidates surfaced from code; you may need to declare domains manually") and continue with the audit-only survey.
- **A chained cultivate skill invocation fails** → record in final summary; continue with the next pick.

## Notes

- Discovery never modifies files directly. All writes happen via the chained cultivate skill's own knowledge-updater dispatch.
- One discovery session can open up to 3 PRs (one per chained per-domain run).
- The 3-pick cap is intentional. Users wanting to act on more items re-run discovery after the first batch lands.
- The slash command `/lore:cultivate` (no arg) is the canonical entry point, but Claude can also auto-invoke this skill when the user asks "what domains does this project have?" or similar exploratory questions in a witan-household.
````

The outer quad-backticks in this prompt wrap the file content; the file itself uses triple-backticks for its internal code fences. When writing, use Write tool with the content between the outer fences.

- [ ] **Step 2: Sanity-check the file**

```bash
head -3 /home/daniel/Source/lorekeeper/skills/cultivate-discovery/SKILL.md
wc -l /home/daniel/Source/lorekeeper/skills/cultivate-discovery/SKILL.md
grep -c '^### ' /home/daniel/Source/lorekeeper/skills/cultivate-discovery/SKILL.md
```

Expected: line 1 is `---`, lines 2-4 are the frontmatter, line count is ~150-170, grep finds 8 `### ` Step headings.

- [ ] **Step 3: Commit and push**

```bash
git add skills/cultivate-discovery/SKILL.md
git commit -m "feat(skills): cultivate-discovery — survey + prioritize + chain"
git push origin feat/lore-cultivate
```

---

## Task 4: Update Babashka scenarios

**Files:**
- Modify: `test/scenarios.edn`

- [ ] **Step 1: Read scenarios.edn**

```bash
cat /home/daniel/Source/lorekeeper/test/scenarios.edn
```

Locate `cultivate-no-arg-refuses`.

- [ ] **Step 2: Replace `cultivate-no-arg-refuses` with `cultivate-no-arg-runs-discovery`**

Use Edit:

```
old_string:
 {:name "cultivate-no-arg-refuses"
  :prompt "/lore:cultivate"
  :workdir "."
  :expects ["domain name required|usage|future"]}

new_string:
 {:name "cultivate-no-arg-runs-discovery"
  :prompt "/lore:cultivate"
  :workdir "."
  :expects ["candidate|survey|discover|household.json|domain"]}
```

If the existing scenario's exact whitespace differs, match the file's actual content.

- [ ] **Step 3: Commit and push**

```bash
git add test/scenarios.edn
git commit -m "test(scenarios): cultivate-no-arg now runs discovery, not refusal"
git push origin feat/lore-cultivate
```

---

## Task 5: Update `commands/help.md` + `README.md`

**Files:**
- Modify: `commands/help.md`
- Modify: `README.md`

- [ ] **Step 1: Update `/lore:cultivate` row in `commands/help.md`**

Find the existing row:

```
| `/lore:cultivate` | Cultivate a bounded-context domain (bootstrap / refine / audit) |
```

Replace with:

```
| `/lore:cultivate` | Cultivate a bounded-context domain — with arg: bootstrap/refine/audit; without arg: discover candidates + audit existing |
```

If the row's existing text differs, match the actual content for the `old_string`.

- [ ] **Step 2: Update `README.md` commands table row**

Find the existing `/lore:cultivate` row in `README.md`'s commands table:

```
| `/lore:cultivate` | Cultivate a bounded-context domain (bootstrap a new one, refine gaps, or audit drift) |
```

Replace with:

```
| `/lore:cultivate` | Cultivate a bounded-context domain. With a name: bootstrap/refine/audit. Without: discover candidate domains in the codebase + audit existing ones |
```

- [ ] **Step 3: Update `### Cultivate` subsection in `README.md`**

Find the existing `### Cultivate` subsection. After the existing usage code block (which shows `/lore:cultivate <domain>`), insert a new paragraph describing the no-arg form. Use Edit:

```
old_string:
```bash
/lore:cultivate <domain>      # e.g. /lore:cultivate grant-matching
```

The command detects the domain's current state and dispatches:

new_string:
```bash
/lore:cultivate <domain>      # work on a specific domain (e.g. /lore:cultivate grant-matching)
/lore:cultivate               # discover candidate domains + audit existing ones
```

**With a name argument**, the command detects the domain's current state and dispatches:
```

- [ ] **Step 4: Append a "no-arg form" paragraph to the README subsection**

Find the end of the `### Cultivate` subsection (just before the next `### ` heading or the end of the per-command subsections). Insert before the existing closing paragraph ("Bare `/lore:cultivate`..." line — which now says the no-arg form is reserved). Use Edit to replace that closing paragraph:

```
old_string:
Bare `/lore:cultivate` with no argument is reserved for a future whole-KB cultivation pass.

new_string:
**Without an argument**, the command surveys the household: it scans `manifest.repos` for candidate bounded contexts and audits existing `domain/*.md` nodes for gaps or drift. It renders a sectioned report (new candidates + existing-domain findings), lets you prioritize 0-3 items via interactive prompts, then chains into a full `/lore:cultivate <name>` flow for each picked item (one PR per chained run, capped at 3 per session).
```

- [ ] **Step 5: Verify the README still reads coherently**

```bash
sed -n '/### Cultivate/,/^### /p' /home/daniel/Source/lorekeeper/README.md
```

Expected: section starts with `### Cultivate`, has the updated usage block + with-arg flow + no-arg paragraph, ends before the next `###` heading.

- [ ] **Step 6: Commit and push**

```bash
git add commands/help.md README.md
git commit -m "docs(cultivate): document no-arg discovery form in help.md and README"
git push origin feat/lore-cultivate
```

---

## Task 6: Final smoke

**Files:** none (verification only)

- [ ] **Step 1: Run all Node tests**

```bash
cd /home/daniel/Source/lorekeeper
node --test scripts/__tests__/*.test.js 2>&1 | tail -10
```

Expected: 9 tests pass for cultivate-detect (6 existing + 3 new survey), plus whatever init-detect tests exist (likely 8). Total likely 17.

- [ ] **Step 2: Run Babashka scenarios if installed**

```bash
bb test/run-tests.clj 2>&1 | tail -15 || echo "bb not installed; skipping"
```

If `bb` is installed: expect the cultivate scenarios pass (including the renamed `cultivate-no-arg-runs-discovery`).
If not installed: skip with the note.

- [ ] **Step 3: Verify file structure**

```bash
ls -la /home/daniel/Source/lorekeeper/skills/cultivate/SKILL.md /home/daniel/Source/lorekeeper/skills/cultivate-discovery/SKILL.md
wc -l /home/daniel/Source/lorekeeper/commands/cultivate.md /home/daniel/Source/lorekeeper/skills/cultivate/SKILL.md /home/daniel/Source/lorekeeper/skills/cultivate-discovery/SKILL.md
```

Expected:
- `commands/cultivate.md` — ~10 lines (thin wrapper)
- `skills/cultivate/SKILL.md` — ~190 lines (extracted from original cultivate.md)
- `skills/cultivate-discovery/SKILL.md` — ~150 lines (new)

- [ ] **Step 4: Verify no orphan references**

```bash
grep -rln 'cultivate-discovery\|skills/cultivate\b' \
    --include='*.md' --include='*.js' \
    /home/daniel/Source/lorekeeper/ | sort
```

Expected hits:
- `commands/cultivate.md` (mentions the discovery skill in the wrapper)
- `skills/cultivate/SKILL.md`
- `skills/cultivate-discovery/SKILL.md`
- `docs/superpowers/specs/2026-05-18-lore-cultivate-discovery-design.md`
- `docs/superpowers/plans/2026-05-18-lore-cultivate-discovery.md`

If unexpected hits appear, investigate.

- [ ] **Step 5: Note the existing PR**

PR #3 (https://github.com/Mindful-Stack/lorekeeper/pull/3) is already open on `feat/lore-cultivate`. The commits from this plan land on the same branch and append to the PR automatically — no `gh pr create` needed. Confirm by:

```bash
gh pr view 3 --repo Mindful-Stack/lorekeeper --json title,headRefName,commits --jq '{title, branch: .headRefName, commits: (.commits | length)}'
```

Expected: branch matches `feat/lore-cultivate`, commit count reflects the new commits from this plan (Tasks 1-5).

- [ ] **Step 6: Update the PR description with the discovery scope (optional)**

```bash
gh pr edit 3 --repo Mindful-Stack/lorekeeper --body "$(cat <<'EOF'
## Summary

Adds `/lore:cultivate` as a smart-dispatching command:
- **With a domain argument** — bootstrap, refine, or audit that bounded context (the per-domain flow from earlier commits).
- **Without an argument** — discover candidate bounded contexts in the codebase, audit existing domain nodes, let the user pick 0-3 items to act on, chain the per-domain flow for each (one PR per chained run).

Designed against Grantigo's just-starting DDD journey as the canonical case.

- Per-domain spec: `docs/superpowers/specs/2026-05-17-lore-cultivate-design.md`
- Discovery spec: `docs/superpowers/specs/2026-05-18-lore-cultivate-discovery-design.md`

## Changes

- `scripts/cultivate-detect.js` (modified) — added `--survey` mode for household-wide snapshots; 3 new tests on top of the existing 6.
- `commands/cultivate.md` (rewritten) — thin wrapper that dispatches on arg presence; body extracted to skill.
- `skills/cultivate/SKILL.md` (new) — per-domain bootstrap/refine/audit (extracted from original cultivate.md body).
- `skills/cultivate-discovery/SKILL.md` (new) — survey + prioritize + chain.
- `agents/knowledge-updater/AGENT.md` — extended for batch input (back-compat preserved).
- `commands/help.md`, `README.md` — surface the no-arg form.
- `test/scenarios.edn` — `cultivate-no-arg-runs-discovery` replaces the old refusal scenario.

## Test plan

- [x] `node --test scripts/__tests__/*.test.js` — all pass (init-detect + cultivate-detect including new --survey tests)
- [ ] `bb test/run-tests.clj` — runs on a machine with Babashka installed
- [ ] Manual smoke against Grantigo: `/lore:cultivate` (no arg) from inside the household → sectioned survey of candidate domains from portal + file-extractor → pick 1-3 → chained cultivations open one PR each.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh pr edit` is denied or you skip this step, the PR's existing description from earlier still applies — it just won't reflect the discovery additions until the user updates it.

---

## Self-review

### Spec coverage

Mapping spec sections to tasks:

- **Architecture** (spec §) — Tasks 2 (extract skill), 3 (new discovery skill), refactor of `commands/cultivate.md`.
- **Per-skill content** (spec §) — Tasks 2, 3.
- **`--survey` mode** (Data flow) — Task 1.
- **Skill-tool chaining contract** (Data flow) — Task 3 (Step 7 of the discovery skill body).
- **Sectioned survey rendering** (Data flow) — Task 3 (Step 5 of the discovery skill body).
- **Error semantics** — Task 3 (encoded in the discovery skill body).
- **Testing** — Tasks 1 (unit), 4 (Babashka).
- **Out of scope** — captured in the spec; no task needed.
- **Open items** — `--survey` invocation shape resolved by Task 1 (chose `--survey` flag). Candidate-cap resolved by Task 3 (cap at 10 displayed, 3 selected). `/lore:help` skill listing remains deferred (not addressed here).

No spec section is unaddressed.

### Placeholder scan

No "TBD" / "implement later" / "similar to Task N" patterns. Each task has concrete code, exact paths, exact commands. The `gh pr edit` step is optional and noted as such.

### Type / interface consistency

- `cultivate-detect.js --survey` output shape (`{ mode: "survey", context: { workspace_root, kb_root, code_repos, existing_domains: [{name, file_path, missing_sections}] } }`) — defined in Task 1, consumed in Task 3 (Step 1 of the discovery skill).
- `module.exports = { detect, survey, CANONICAL_SECTIONS }` — Task 1 Step 5, used by the test file in Task 1 Step 1.
- Skill names (`cultivate`, `cultivate-discovery`) — used consistently in Tasks 2 (extract), 3 (new), and the thin wrapper in Task 2.
- AskUserQuestion `multiSelect` cap-of-3 contract — Task 3 Step 6.
- Survey markdown section headings (`## New candidate domains`, `## Existing domains with findings`, `## Healthy domains`) — Task 3 Step 5.

No inconsistencies.

### Sequencing

Task 1 must precede Task 3 (the discovery skill calls `cultivate-detect.js --survey`).
Task 2 must precede Task 3 (the discovery skill chains the `cultivate` skill — the skill must exist).
Tasks 4 and 5 must follow Task 2 + Task 3 (they describe the new behavior).
Task 6 (smoke) is last.

This is the order the task numbers reflect.
