# Workspace Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give witan-household workspaces a versioned `household.json` schema, a SessionStart nag when a workspace drifts behind the plugin's required schema, and a `/lore:migrate` command that brings it up to date (manifest rewrite + opt-in tooling refresh).

**Architecture:** A single source-of-truth file (`scripts/manifest-schema.json`) holds the current integer schema version. A pure, unit-tested JS engine (`scripts/migrate-manifest.js`) encodes an ordered, shape-aware migration registry. The SessionStart hook reads both and appends a user-visible drift nag (never blocks). `/lore:migrate` orchestrates the engine with git-dirty preflights and an optional template-tooling refresh. Plugin readers gain no backward-compat fallbacks — the gate is the only drift chokepoint.

**Tech Stack:** Node (CommonJS `.js`, `node:test`), Bash (the hook), Markdown (commands).

## Global Constraints

- **No reader fallbacks.** Do not add `?? workspace`-style compatibility to any runtime reader. Shape-awareness lives ONLY in the migration engine.
- **Hook must never break SessionStart.** If `node` is unavailable or `manifest-schema.json` is unreadable, skip the schema nag and preserve existing resolution behavior.
- **Pass paths to `node -e` via env vars or argv**, never interpolated into JS source (matches the existing hook pattern).
- **Current schema version = `2`** (v1 = pre-versioning `workspace`-key era; absent `schema_version` ⇒ v1).
- **`/lore:migrate` is the ONLY command that writes `household.json`.** `/lore:doctor` stays read-only.
- **Zero-runtime principle:** the only new executable is `migrate-manifest.js` (a deterministic transform, like the existing `*-detect.js`). No other scripts.
- **Version bump is mandatory and MINOR:** `1.1.0 → 1.2.0` in all three manifests (`.claude-plugin/plugin.json`, `package.json`, witan marketplace listing).
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work on branch `feat/workspace-schema-migration` (already created; the design spec is committed there).

---

### Task 1: Migration engine + source of truth

**Files:**
- Create: `scripts/manifest-schema.json`
- Create: `scripts/migrate-manifest.js`
- Test: `scripts/__tests__/migrate-manifest.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `scripts/manifest-schema.json` → `{ "current": 2 }`.
  - `migrate-manifest.js` exports `{ CURRENT, MIGRATIONS, resolveVersion, migrate }`.
    - `CURRENT: number` — read from `manifest-schema.json`.
    - `MIGRATIONS: Array<{ from: number, to: number, describe: string, transform(m) -> { manifest, changed: boolean, conflict: string|null } }>`.
    - `resolveVersion(manifest) -> number` (absent `schema_version` ⇒ 1).
    - `migrate(manifest) -> { ok: boolean, manifest: object, changed: boolean, conflict: string|null, fromVersion: number, toVersion: number }`. Never mutates the input. `ok:false` only on conflict.
  - CLI: `node scripts/migrate-manifest.js [--dry-run] [--dir=<path>]` — exit 0 (ok/no-op), 2 (unreadable manifest), 3 (conflict).

- [ ] **Step 1: Create the source-of-truth file**

Create `scripts/manifest-schema.json`:

```json
{
  "current": 2
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/__tests__/migrate-manifest.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CURRENT, MIGRATIONS, resolveVersion, migrate } = require('../migrate-manifest.js');

test('CURRENT is 2', () => {
    assert.equal(CURRENT, 2);
});

test('resolveVersion defaults absent schema_version to 1', () => {
    assert.equal(resolveVersion({ workspace: 'ws' }), 1);
    assert.equal(resolveVersion({ schema_version: 2, meta_repo: 'ws' }), 2);
});

test('registry integrity: contiguous chain ending at CURRENT', () => {
    assert.ok(MIGRATIONS.length >= 1);
    assert.equal(MIGRATIONS[0].from, 1);
    for (let i = 0; i < MIGRATIONS.length; i++) {
        assert.equal(MIGRATIONS[i].to, MIGRATIONS[i].from + 1);
        if (i > 0) assert.equal(MIGRATIONS[i].from, MIGRATIONS[i - 1].to);
    }
    assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, CURRENT);
});

test('v1->v2: workspace-only renames to meta_repo and stamps version', () => {
    const r = migrate({ workspace: 'grantigo', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.changed, true);
    assert.equal(r.manifest.meta_repo, 'grantigo');
    assert.equal('workspace' in r.manifest, false);
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: meta_repo-only just stamps version, no rename', () => {
    const r = migrate({ meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.manifest.meta_repo, 'ws');
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: both keys with same value drops workspace', () => {
    const r = migrate({ workspace: 'ws', meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal('workspace' in r.manifest, false);
    assert.equal(r.manifest.meta_repo, 'ws');
    assert.equal(r.manifest.schema_version, 2);
});

test('v1->v2: both keys with different values is a conflict (no write)', () => {
    const r = migrate({ workspace: 'old', meta_repo: 'new', repos: [] });
    assert.equal(r.ok, false);
    assert.match(r.conflict, /different values/);
});

test('idempotency: already-current manifest is a no-op', () => {
    const r = migrate({ schema_version: 2, meta_repo: 'ws', repos: [] });
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
});

test('migrate never mutates the input object', () => {
    const input = { workspace: 'ws', repos: [] };
    migrate(input);
    assert.equal(input.workspace, 'ws');
    assert.equal('meta_repo' in input, false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/__tests__/migrate-manifest.test.js`
Expected: FAIL — `Cannot find module '../migrate-manifest.js'`.

- [ ] **Step 4: Implement the engine**

Create `scripts/migrate-manifest.js`:

```js
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
function migrate(manifestInput) {
    const m = JSON.parse(JSON.stringify(manifestInput)); // never mutate the caller's object
    const fromVersion = resolveVersion(m);
    if (fromVersion >= CURRENT) {
        return { ok: true, manifest: m, changed: false, conflict: null, fromVersion, toVersion: fromVersion };
    }
    for (const step of MIGRATIONS) {
        if (step.from < fromVersion) continue; // already past this step
        if (step.to > CURRENT) break;          // don't overshoot the target
        const res = step.transform(m);
        if (res.conflict) {
            return { ok: false, manifest: m, changed: false, conflict: res.conflict, fromVersion, toVersion: step.from };
        }
        m.schema_version = step.to;
    }
    // The file always changes when fromVersion < CURRENT: schema_version was stamped.
    return { ok: true, manifest: m, changed: true, conflict: null, fromVersion, toVersion: CURRENT };
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test scripts/__tests__/migrate-manifest.test.js`
Expected: PASS — all tests green.

- [ ] **Step 6: Add a CLI smoke check against a fixture**

Run:

```bash
TMP=$(mktemp -d)
printf '{\n  "workspace": "demo",\n  "repos": []\n}\n' > "$TMP/household.json"
node scripts/migrate-manifest.js --dry-run --dir="$TMP"
node scripts/migrate-manifest.js --dir="$TMP"
cat "$TMP/household.json"
rm -rf "$TMP"
```

Expected: dry-run prints `Would migrate v1 -> v2:` with `workspace`/`meta_repo`/`schema_version` lines; the apply rewrites the file so it contains `"meta_repo": "demo"` and `"schema_version": 2` and no `workspace` key.

- [ ] **Step 7: Commit**

```bash
git add scripts/manifest-schema.json scripts/migrate-manifest.js scripts/__tests__/migrate-manifest.test.js
git commit -m "feat: schema-version migration engine + source of truth

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: SessionStart hook schema gate

**Files:**
- Modify: `hooks/load-standards-reminder.sh`
- Test: `scripts/__tests__/load-standards-hook.test.js`

**Interfaces:**
- Consumes: `scripts/manifest-schema.json` (`current`), a workspace `household.json` (`schema_version`). Uses existing hook vars `HOUSEHOLD_ROOT`, `PLUGIN_ROOT`, `SYS_MSG`.
- Produces: appends a drift line to the user-visible `systemMessage`. No new model-facing marker.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/__tests__/load-standards-hook.test.js` (after the existing household.json walk-up tests). These mirror the file's existing `runHook`/`withTmp` helpers:

```js
// --- schema-version gate -------------------------------------------------------

test('schema gate: nags when workspace schema_version is behind the plugin', () =>
    withTmp((tmp) => {
        fs.mkdirSync(path.join(tmp, 'lore', 'knowledge'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ workspace: 'ws', knowledge_base: 'lore' })); // v1 (no schema_version)
        const { json } = runHook(tmp);
        assert.match(json.systemMessage, /schema v1 is older than this plugin \(v2\)/);
        assert.match(json.systemMessage, /\/lore:migrate/);
    }));

test('schema gate: silent when schema_version matches the plugin', () =>
    withTmp((tmp) => {
        fs.mkdirSync(path.join(tmp, 'lore', 'knowledge'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ schema_version: 2, meta_repo: 'ws', knowledge_base: 'lore' }));
        const { json } = runHook(tmp);
        assert.doesNotMatch(json.systemMessage, /older than this plugin/);
        assert.doesNotMatch(json.systemMessage, /newer than this plugin/);
    }));

test('schema gate: reverse-nags when workspace schema is newer than the plugin', () =>
    withTmp((tmp) => {
        fs.mkdirSync(path.join(tmp, 'lore', 'knowledge'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ schema_version: 99, meta_repo: 'ws', knowledge_base: 'lore' }));
        const { json } = runHook(tmp);
        assert.match(json.systemMessage, /newer than this plugin/);
        assert.match(json.systemMessage, /\/plugin update lorekeeper@witan/);
    }));

test('schema gate: composes with a missing-KB nag (both appear)', () =>
    withTmp((tmp) => {
        // household found, but the declared KB dir is missing -> KB nag path.
        fs.writeFileSync(path.join(tmp, 'household.json'),
            JSON.stringify({ workspace: 'ws', knowledge_base: 'lore' })); // v1, no lore/ dir
        const { json } = runHook(tmp);
        assert.match(json.systemMessage, /no knowledge bases resolved/);
        assert.match(json.systemMessage, /schema v1 is older than this plugin/);
    }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/__tests__/load-standards-hook.test.js`
Expected: FAIL — the new schema-gate assertions don't match (no drift text yet).

- [ ] **Step 3: Compute the nag in the household-resolution block**

In `hooks/load-standards-reminder.sh`, inside the `if HOUSEHOLD_ROOT=$(find_household_walkup); then` block, immediately AFTER the `while ... done <<< "$KB_LIST"` loop closes (the line `done <<< "$KB_LIST"`, currently line 131) and BEFORE the `if [ ${#KNOWLEDGE_PATHS[@]} -eq 0 ]; then` check, insert:

```bash
        # --- Schema-version gate (composes with KB nags below; never blocks) ---
        # Read the workspace's declared schema_version (absent -> 1) and the plugin's
        # current schema. On drift, set SCHEMA_NAG; it is appended to SYS_MSG after the
        # message is assembled. Degrade silently (no nag, no crash) if node or the
        # schema file is unavailable — the gate must never break SessionStart.
        SCHEMA_NAG=""
        if command -v node &>/dev/null && [ -f "$PLUGIN_ROOT/scripts/manifest-schema.json" ]; then
            SCHEMA_CMP=$(HH="$HOUSEHOLD_ROOT" SCHEMA_FILE="$PLUGIN_ROOT/scripts/manifest-schema.json" node -e "
try {
  const m = require(process.env.HH + '/household.json');
  const cur = require(process.env.SCHEMA_FILE).current;
  const ws = Number.isInteger(m.schema_version) ? m.schema_version : 1;
  if (typeof cur !== 'number') process.exit(0);
  if (ws < cur) console.log('behind ' + ws + ' ' + cur);
  else if (ws > cur) console.log('ahead ' + ws + ' ' + cur);
} catch (e) {}
" 2>/dev/null || echo "")
            if [ -n "$SCHEMA_CMP" ]; then
                # shellcheck disable=SC2086
                set -- $SCHEMA_CMP
                SCHEMA_STATUS=$1; SCHEMA_WS=$2; SCHEMA_CUR=$3
                if [ "$SCHEMA_STATUS" = "behind" ]; then
                    SCHEMA_NAG="⚠️  Workspace schema v${SCHEMA_WS} is older than this plugin (v${SCHEMA_CUR}). Run /lore:migrate to update household.json. Some /lore:* commands may misbehave until you do."
                elif [ "$SCHEMA_STATUS" = "ahead" ]; then
                    SCHEMA_NAG="Workspace schema v${SCHEMA_WS} is newer than this plugin (v${SCHEMA_CUR}). Update the plugin: /plugin update lorekeeper@witan."
                fi
            fi
        fi
```

Note: `SCHEMA_WS`/`SCHEMA_CUR` are integers from a controlled `node` output, safe to interpolate without `json_escape`. Declare `SCHEMA_NAG=""` near the other resolution vars (line ~64, beside `HOUSEHOLD_ROOT=""`) so it is always defined under `set -u`.

- [ ] **Step 4: Append the nag after message assembly**

In `hooks/load-standards-reminder.sh`, AFTER the big `if/elif/else` that builds `SYS_MSG`/`MODEL_CTX` closes (the `fi` currently on line 255) and BEFORE the `# --- Output ---` comment (line 257), insert:

```bash
# Append the schema-drift nag (if any) to the user-visible message, composing with
# whatever KB summary/nags were already assembled. User-facing only; not a marker.
if [ -n "${SCHEMA_NAG:-}" ]; then
    if [ -n "$SYS_MSG" ]; then
        SYS_MSG="${SYS_MSG}\\n\\n${SCHEMA_NAG}"
    else
        SYS_MSG="$SCHEMA_NAG"
    fi
fi
```

- [ ] **Step 5: Run the hook tests to verify they pass**

Run: `node --test scripts/__tests__/load-standards-hook.test.js`
Expected: PASS — all existing tests plus the four new schema-gate tests.

- [ ] **Step 6: Manually verify graceful degradation (no schema file)**

Run:

```bash
TMP=$(mktemp -d); mkdir -p "$TMP/lore/knowledge"
printf '{"workspace":"ws","knowledge_base":"lore"}' > "$TMP/household.json"
# Temporarily hide the schema file and confirm the hook still emits valid JSON.
mv scripts/manifest-schema.json scripts/manifest-schema.json.bak
( cd "$TMP" && PWD="$TMP" bash /home/daniel/Source/lorekeeper/hooks/load-standards-reminder.sh ) | node -e 'JSON.parse(require("fs").readFileSync(0)); console.log("valid JSON, no crash")'
mv scripts/manifest-schema.json.bak scripts/manifest-schema.json
rm -rf "$TMP"
```

Expected: prints `valid JSON, no crash` (hook output parses; no schema nag present).

- [ ] **Step 7: Commit**

```bash
git add hooks/load-standards-reminder.sh scripts/__tests__/load-standards-hook.test.js
git commit -m "feat: SessionStart schema-drift nag (composes with KB nags, never blocks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/lore:migrate` command

**Files:**
- Create: `commands/migrate.md`

**Interfaces:**
- Consumes: `migrate-manifest.js` CLI (`--dry-run`, `--dir=`, exit codes 0/2/3); `${CLAUDE_PLUGIN_ROOT}/scripts/manifest-schema.json`.
- Produces: a user-facing command, the only writer of `household.json`.

- [ ] **Step 1: Write the command file**

Create `commands/migrate.md`:

````markdown
---
description: Migrate this workspace's household.json to the schema version the current plugin expects, then optionally refresh template-managed tooling.
---

# Migrate Command

Bring the current witan-household workspace up to the `household.json` schema the
installed plugin expects. This is the **only** command that writes `household.json`.

## Usage

```
/lore:migrate
```

## Implementation

### Step 1: Locate the workspace

Find `household.json` by walking up from CWD (bounded, like the SessionStart hook).
The workspace root is the directory containing it. If none is found, tell the user:
"No witan-household workspace here (no household.json). Run /lore:init first." and stop.

### Step 2: Dry-run to see what would change

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dry-run --dir=<workspace-root>
```

- Exit 0 with "Already at schema vN. Nothing to migrate." → report it and **skip to
  Step 6** (offer tooling refresh anyway — tooling can be stale even when the schema
  is current).
- Exit 3 (CONFLICT) → show the conflict message verbatim. Do **not** write anything.
  Explain that both `workspace` and `meta_repo` are set to different values and the
  user must pick one by hand, then stop.
- Exit 0 with a "Would migrate ..." diff → show the diff and continue.

### Step 3: Dirty-state preflight (manifest)

```bash
git -C <workspace-root> status --porcelain -- household.json
```

If the output is non-empty, `household.json` has uncommitted changes. Stop and ask
the user to commit or stash first — "review git diff before committing" does not
protect uncommitted edits from being overwritten.

### Step 4: Confirm and apply

Show the dry-run diff and ask the user to confirm. On yes:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dir=<workspace-root>
```

Report the applied diff. Remind the user to review `git diff household.json` before
committing.

### Step 5: Offer to commit the manifest change

Offer (do not force):

```bash
git -C <workspace-root> add household.json
git -C <workspace-root> commit -m "chore: migrate household.json to schema v<N>"
```

### Step 6: Optional tooling refresh

Ask, phrased as an optional refresh (not a staleness claim):

> "This migration can also refresh template-managed tooling (`scripts/` and
> `Makefile`) from the current witan-household template. This overwrites those
> paths. Refresh? [y/N]"

If yes:

1. **Dirty-state preflight (tooling):**
   ```bash
   git -C <workspace-root> status --porcelain -- scripts Makefile
   ```
   If non-empty, warn that `scripts/`/`Makefile` have uncommitted changes and require
   a second explicit confirmation before overwriting (git only protects committed state).

2. **Fetch + copy** (mode-preserving; temp clone cleaned up on success and failure):
   ```bash
   TMPL=$(mktemp -d)
   trap 'rm -rf "$TMPL"' EXIT
   git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git "$TMPL"
   cp -a "$TMPL/scripts/." <workspace-root>/scripts/
   cp -a "$TMPL/Makefile" <workspace-root>/Makefile
   rm -rf "$TMPL"; trap - EXIT
   ```

3. **Report what changed** (bounded):
   ```bash
   git -C <workspace-root> diff --name-status -- scripts Makefile
   ```
   List the changed files and tell the user to review `git diff` before committing.
   Do not commit the tooling refresh automatically.

### Step 7: Exit cleanly

End with a one-line summary: the schema version before → after, and whether tooling
was refreshed. If a conflict stopped the run, say so and name the offending fields.

## Notes

- `/lore:migrate` is the only command that writes `household.json`.
- The migration is shape-aware: a workspace already on `meta_repo` is just stamped
  with `schema_version`; a workspace with both keys set to different values is
  reported as a conflict rather than guessed.
````

- [ ] **Step 2: Verify the command's CLI contract end-to-end**

Run (exercises the exact commands the markdown invokes):

```bash
TMP=$(mktemp -d)
printf '{\n  "workspace": "demo",\n  "repos": []\n}\n' > "$TMP/household.json"
node scripts/migrate-manifest.js --dry-run --dir="$TMP"   # expect: Would migrate v1 -> v2
printf '{\n  "workspace":"a","meta_repo":"b","repos":[]\n}\n' > "$TMP/household.json"
node scripts/migrate-manifest.js --dry-run --dir="$TMP"; echo "exit=$?"  # expect: CONFLICT, exit=3
rm -rf "$TMP"
```

Expected: first prints the v1→v2 diff (exit 0); second prints `CONFLICT: both ...` with `exit=3`.

- [ ] **Step 3: Commit**

```bash
git add commands/migrate.md
git commit -m "feat: /lore:migrate command (manifest migration + opt-in tooling refresh)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Init stamps schema_version; doctor reports drift

**Files:**
- Modify: `commands/init.md`
- Modify: `commands/doctor.md`

**Interfaces:**
- Consumes: `${CLAUDE_PLUGIN_ROOT}/scripts/manifest-schema.json` (`current`).
- Produces: every freshly-scaffolded `household.json` carries `schema_version`; `/lore:doctor` reports drift (read-only) and points to `/lore:migrate`.

- [ ] **Step 1: Add a reusable stamp snippet to init.md (greenfield flow)**

In `commands/init.md`, in the **greenfield** flow, after the `rm -rf .tmp-witan-clone`
line and before `./scripts/rename.sh` (around line 56), insert the stamp:

```bash
# Stamp schema_version from the plugin's source of truth (do NOT rely on the
# template alone — a stale template could otherwise birth a drifted workspace).
CUR=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/scripts/manifest-schema.json').current)")
CUR="$CUR" node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('./household.json', 'utf8'));
    m.schema_version = Number(process.env.CUR);
    fs.writeFileSync('./household.json', JSON.stringify(m, null, 2) + '\n');
"
```

- [ ] **Step 2: Add the same stamp to init.md (single-repo-retrofit flow)**

In `commands/init.md`, in the **single-repo-retrofit** flow, immediately after
`cp "$TMPL/household.json" .` (line 82), insert the identical stamp snippet from
Step 1. (Poly-repo and docs-migration build on this scaffold and read-modify-write
the already-stamped file, so they inherit it.)

- [ ] **Step 3: Add a drift check to doctor.md**

In `commands/doctor.md`, add a new step between "Step 3: Validate shared knowledge
bases" and "Step 4: Render the output". Renumber the later steps (Render → Step 5,
Exit cleanly → Step 6):

```markdown
### Step 4: Check schema version (read-only)

Compare the workspace's `household.json` `schema_version` (absent ⇒ 1) against the
plugin's current schema:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dry-run --dir=<workspace-root>
```

- "Already at schema vN. Nothing to migrate." → report the schema is current.
- "Would migrate vA -> vB:" → report drift as a warning and suggest `/lore:migrate`.
- Exit 3 (CONFLICT) → report the conflicting fields as an error and suggest
  `/lore:migrate` (which will surface the same conflict for the user to resolve).

This step never writes — it only reports. `/lore:migrate` is the writer.
```

Also update doctor.md's Notes line "It's read-only." to reaffirm: doctor reports
schema drift but never applies it — `/lore:migrate` does.

- [ ] **Step 4: Verify the doctor drift check against a fixture**

Run:

```bash
TMP=$(mktemp -d)
printf '{\n  "workspace": "demo",\n  "repos": []\n}\n' > "$TMP/household.json"
node scripts/migrate-manifest.js --dry-run --dir="$TMP"   # doctor calls this exact command
rm -rf "$TMP"
```

Expected: `Would migrate v1 -> v2:` with the field diff (exit 0).

- [ ] **Step 5: Commit**

```bash
git add commands/init.md commands/doctor.md
git commit -m "feat: init stamps schema_version; doctor reports schema drift (read-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Docs, command lists, and version bump

**Files:**
- Modify: `commands/help.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `.claude-plugin/plugin.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `/lore:migrate` listed in user-facing docs; accurate "executable code" wording; synced `1.2.0` version.

- [ ] **Step 1: Add `/lore:migrate` to help.md**

In `commands/help.md`, in the command table (alphabetical, currently `cultivate`,
`doctor`, `init`, `onboard`, `prime`, `review`, `update` around lines 86–95), add a
row after the `/lore:init` row:

```markdown
| `/lore:migrate` | Migrate household.json to the plugin's expected schema version (+ optional tooling refresh) |
```

- [ ] **Step 2: Add `/lore:migrate` to the README command table**

In `README.md`, in the command table (around lines 112–119), add after the
`/lore:init` row:

```markdown
| `/lore:migrate` | Bring household.json up to the schema the current plugin expects; optionally refresh template tooling |
```

- [ ] **Step 3: Update CLAUDE.md "only executable code" sentence**

In `CLAUDE.md` line 7, replace:

```
The only executable code is `hooks/load-standards-reminder.sh` and `scripts/init-detect.js`.
```

with:

```
The only executable code is `hooks/load-standards-reminder.sh` and the scripts under `scripts/` (`init-detect.js`, `cultivate-detect.js`, and `migrate-manifest.js`).
```

- [ ] **Step 4: Bump the two in-repo manifests to 1.2.0**

In `.claude-plugin/plugin.json` change `"version": "1.1.0"` → `"version": "1.2.0"`.
In `package.json` change `"version": "1.1.0"` → `"version": "1.2.0"`.

- [ ] **Step 5: Verify version sync and full test suite**

Run:

```bash
grep '"version"' .claude-plugin/plugin.json package.json
node --test scripts/__tests__/*.test.js
```

Expected: both manifests show `1.2.0`; all tests pass (init-detect, cultivate-detect,
load-standards-hook, migrate-manifest).

- [ ] **Step 6: Commit**

```bash
git add commands/help.md README.md CLAUDE.md .claude-plugin/plugin.json package.json
git commit -m "docs: document /lore:migrate; bump plugin to 1.2.0

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Companion PRs (separate repos)

These ship in lockstep with the 1.2.0 plugin release. They are NOT in the lorekeeper
repo, so they are separate PRs — but the release is incomplete without them.

**Files:**
- Modify (witan-household): `household.json` — add `"schema_version": 2`.
- Modify (witan marketplace, `Mindful-Stack/witan`): the lorekeeper listing `version` → `1.2.0`.

- [ ] **Step 1: Stamp the template manifest**

In a clone of `Mindful-Stack/witan-household`, add `"schema_version": 2` as a
top-level field in `household.json` (so new "Use this template" workspaces are born
current). Branch, commit, open a PR.

- [ ] **Step 2: Bump the marketplace listing**

In a clone of `Mindful-Stack/witan`, set the lorekeeper entry's `version` to `1.2.0`
in `.claude-plugin/marketplace.json`. Branch, commit, open a PR. (The updater compares
this version; without it, cached installs keep running 1.1.0.)

- [ ] **Step 3: Verify the marketplace points at the right repo**

Run:

```bash
gh api repos/Mindful-Stack/witan/contents/.claude-plugin/marketplace.json --jq '.content' | base64 -d | grep -A4 lorekeeper
```

Expected (after the PR merges): `"version": "1.2.0"` and `"repo": "Mindful-Stack/lorekeeper"`.

---

## Validation on grantigo (post-release)

Manual, after 1.2.0 is published and the host plugin is updated:

1. `/plugin marketplace update witan && /plugin update lorekeeper@witan` (host), or rebuild the devcontainer.
2. Open a session in `grantigo` → its manifest has no `schema_version` → the hook nags ("schema v1 is older than this plugin (v2)").
3. Run `/lore:migrate` → renames `workspace` → `meta_repo`, stamps `schema_version: 2`, then offers the tooling refresh (pulling in `repo-rename` + setup selection modes).
4. Confirm `/lore:doctor` reports the schema as current, the next session's hook is silent, and `/lore:cultivate` filters the meta-repo correctly.
