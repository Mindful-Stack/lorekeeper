# Witan System Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the witan + lorekeeper + witan-household system around a single canonical adoption path, with `/lore:init` as the smart entry point and the witan-household template as the only scaffolding source.

**Architecture:** Two phases over two repos. **Phase 1** lands the template overhaul in `Mindful-Stack/witan-household` (default-on Lorekeeper install, Makefile + bootstrap scripts, ported KB tooling under `lore/_tools/`, fattened starter content, adoption-scenarios README). **Phase 2** lands the plugin updates in `Mindful-Stack/lorekeeper` (smart `/lore:init` with state detection, new `/lore:doctor` command, deletion of the bundled standalone-KB template, README rewrite).

**Tech Stack:** Bash scripts (Make-driven), Node.js for manifest parsing + KB tooling (`node:test` for unit tests, no external deps), Claude Code plugin markdown for slash commands. Phase 1 ships to `Mindful-Stack/witan-household:main`; Phase 2 ships to `Mindful-Stack/lorekeeper:main`.

**Status:** Phase 0 (`repos.json` → `household.json` rename) is **done** — committed across reeve `feat/m4-refs-and-push-and-kb` (`28eb094`), witan-household `main` (`9eb3868` pushed), and the unification spec (`9fea974` in lorekeeper).

**Spec:** `docs/superpowers/specs/2026-05-16-witan-system-unification-design.md`

---

## File structure

### Phase 1 — witan-household template (in `Mindful-Stack/witan-household` repo)

| Path | Action | Purpose |
|---|---|---|
| `.devcontainer/devcontainer.json` | **Modify** | Default-on Lorekeeper install (fail-fast two-command structure) + marketplace-swap comment |
| `Makefile` | **Create** | Discoverable targets: `setup`, `pull`, `status`, `split-lore`, `rename`, `build-index`, `validate`, `doctor`, `help` |
| `scripts/setup.sh` | **Create** | Bootstrap siblings via Node-based manifest parser (no jq dep). Flags: `--repos=`, `--tag=` |
| `scripts/pull-all.sh` | **Create** | `git fetch --prune` + ff-pull per sibling |
| `scripts/status-all.sh` | **Create** | One-line `git status` summary per sibling |
| `scripts/split-lore.sh` | **Create** | Promote inline `lore/` to a separate sibling repo (interactive + `REMOTE=` flag) |
| `scripts/rename.sh` | **Create** | Substitute placeholder workspace name into `household.json` + `CLAUDE.md` |
| `lore/_tools/cli.js` | **Create** | Entrypoint dispatching to subcommands (`build-index`, `validate`, `check-orphans`, `doctor`) |
| `lore/_tools/build-index.js` | **Create** | Port from `lorekeeper/templates/knowledge-base/src/build-index.js` |
| `lore/_tools/validate-frontmatter.js` | **Create** | Port |
| `lore/_tools/validate-links.js` | **Create** | Port |
| `lore/_tools/check-orphans.js` | **Create** | Port |
| `lore/_tools/doctor.js` | **Create** | Aggregates all checks + workspace-level checks (manifest validity, sibling presence) |
| `lore/_tools/__tests__/*.test.js` | **Create** | Port + extend for `doctor.js` |
| `lore/_tools/package.json` | **Create** | Zero runtime deps, `node:test` for tests |
| `lore/knowledge/general/_starter.md` | **Modify** | Concrete worked example (pr-guidelines node) |
| `lore/knowledge/domain/_starter.md` | **Modify** | Concrete worked example (user-management bounded-context skeleton) |
| `lore/knowledge/frameworks/_starter.md` | **Modify** | Concrete worked example (react/component-conventions) |
| `lore/knowledge/languages/_starter.md` | **Modify** | Concrete worked example (typescript/code-style) |
| `lore/knowledge/learnings/_starter.md` | **Modify** | Concrete worked example with `confidence: verified`, real-feeling body |
| `README.md` | **Modify** | Add "Adopting witan in an existing project" section + "Two-install reality" note |

### Phase 2 — Lorekeeper plugin (in `Mindful-Stack/lorekeeper` repo)

| Path | Action | Purpose |
|---|---|---|
| `templates/knowledge-base/` | **Delete** | Entire directory — superseded by the witan-household template |
| `scripts/init-knowledge-base.js` | **Delete** | Replaced by `scripts/init-detect.js` + smart `/lore:init` |
| `scripts/__tests__/init-knowledge-base.test.js` | **Delete** | Tests for the deleted script |
| `scripts/init-detect.js` | **Create** | Detection logic — classifies CWD state, emits JSON {scenario, context} |
| `scripts/__tests__/init-detect.test.js` | **Create** | Unit tests for detection across all five scenarios |
| `commands/init.md` | **Rewrite** | Smart command: invokes detection, prompts via AskUserQuestion, dispatches per scenario |
| `commands/doctor.md` | **Create** | Thin command that runs `<knowledge-path>/_tools/cli.js doctor` and reports |
| `commands/help.md` | **Modify** | Add `/lore:doctor` to the commands table |
| `README.md` | **Modify** | Polish the setup section to match the unified story; document `/lore:doctor` |
| `test/scenarios.edn` | **Modify** | Add Babashka scenarios for `/lore:init` greenfield path and `/lore:doctor` basic invocation |

---

## Phase 1: witan-household template overhaul

All Phase 1 tasks operate inside `/home/daniel/Source/witan-household/`. Commit messages prefix with `feat:`, `chore:`, etc. — match existing style. Each task ends with a `git push origin main` (template repo doesn't use feature branches for v1 development).

---

### Task 1: Default-on Lorekeeper install in devcontainer.json

**Files:**
- Modify: `.devcontainer/devcontainer.json`

- [ ] **Step 1: Replace the file contents**

```jsonc
{
  "name": "witan-household",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {}
  },
  "postCreateCommand": [
    "curl -fsSL https://claude.ai/install.sh | bash",
    // To use a different marketplace, replace 'Mindful-Stack/witan' below.
    "claude plugin marketplace add Mindful-Stack/witan",
    "claude plugin install lorekeeper@witan"
  ],
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

The three `postCreateCommand` entries run sequentially; any failing aborts container creation with a clear error.

- [ ] **Step 2: Verify JSON parses**

Run: `node -e 'JSON.parse(require("fs").readFileSync(".devcontainer/devcontainer.json", "utf8"))'`
Expected: no output (success).

Note: `devcontainer.json` is `jsonc` (with comments) for tooling but devcontainer CLI strips them. The above check fails if there's a JSONC comment, so a stricter validator: `node -e 'const c = require("fs").readFileSync(".devcontainer/devcontainer.json", "utf8").replace(/\/\/.*$/gm, ""); JSON.parse(c)'`.

- [ ] **Step 3: Commit and push**

```bash
git add .devcontainer/devcontainer.json
git commit -m "feat(devcontainer): default-on Lorekeeper install + marketplace-swap comment"
git push origin main
```

---

### Task 2: Makefile with discoverable targets

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Create the Makefile**

```makefile
.PHONY: help setup pull status split-lore rename build-index validate doctor test

help:    ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup:   ## Clone every sibling declared in household.json
	@./scripts/setup.sh

pull:    ## Fetch all siblings; ff-pull if on clean main
	@./scripts/pull-all.sh

status:  ## One-line git status per sibling
	@./scripts/status-all.sh

split-lore: ## Promote the inline `lore/` to its own sibling repo (interactive; pass REMOTE=<url> to skip prompt)
	@./scripts/split-lore.sh "$(REMOTE)"

rename:  ## Substitute placeholder workspace name (usage: make rename NAME=foo)
	@./scripts/rename.sh "$(NAME)"

build-index: ## Rebuild lore/_index.json
	@node lore/_tools/cli.js build-index

validate: ## Run KB validators (frontmatter, links, orphans)
	@node lore/_tools/cli.js validate

doctor:  ## Run full workspace + KB diagnostic
	@node lore/_tools/cli.js doctor

test:    ## Run lore tooling unit tests
	@node --test lore/_tools/__tests__/*.test.js
```

- [ ] **Step 2: Verify `make help` runs**

Run: `make help`
Expected: a colored table listing every target. (The targets `setup` through `test` will fail until subsequent tasks land their scripts; that's fine for now.)

- [ ] **Step 3: Commit and push**

```bash
git add Makefile
git commit -m "feat(make): add discoverable target index (help/setup/pull/status/split-lore/rename/build-index/validate/doctor/test)"
git push origin main
```

---

### Task 3: scripts/setup.sh — bootstrap siblings

**Files:**
- Create: `scripts/setup.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/bash
set -euo pipefail

# Bootstrap the witan-household: clone declared sibling repos.
# Reads the manifest at ./household.json (Node parser; no jq dependency).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$WORKSPACE/household.json"

# --- Flag parsing ---
TAG_FILTER=""
REPOS_FILTER=""

for arg in "$@"; do
    case "$arg" in
        --tag=*)    TAG_FILTER="${arg#*=}" ;;
        --repos=*)  REPOS_FILTER="${arg#*=}" ;;
        -h|--help)
            cat <<EOF
Usage: $0 [--tag=foo] [--repos=name1,name2]

No args: clone every sibling repo that has a 'url' field in household.json,
         excluding the workspace entry itself.

Flags:
  --tag=foo       Only clone repos tagged 'foo'.
  --repos=a,b,c   Only clone the named repos.
EOF
            exit 0
            ;;
        *)
            echo "Unknown flag: $arg" >&2
            exit 2
            ;;
    esac
done

# --- Prereq check ---
echo "[1/3] Checking prerequisites..."
MISSING=""
for tool in git node; do
    if ! command -v "$tool" &>/dev/null; then
        MISSING="$MISSING $tool"
    fi
done
if [ -n "$MISSING" ]; then
    echo "ERROR: Missing required tools:$MISSING" >&2
    exit 1
fi
if [ ! -f "$MANIFEST" ]; then
    echo "ERROR: No household.json at $MANIFEST. Run this from inside a witan-household workspace." >&2
    exit 1
fi
echo "  OK"

# --- Parse manifest (Node, no jq dep) ---
echo ""
echo "[2/3] Selecting repos..."

SELECTED=$(node -e "
    const m = require('$MANIFEST');
    const tag = '$TAG_FILTER';
    const repos = '$REPOS_FILTER'.split(',').filter(Boolean);
    let result = m.repos.filter(r => r.name !== m.workspace && r.url);
    if (tag)          result = result.filter(r => (r.tags || []).includes(tag));
    if (repos.length) result = result.filter(r => repos.includes(r.name));
    result.forEach(r => console.log(r.name + ' ' + r.url));
")

if [ -z "$SELECTED" ]; then
    echo "  No siblings selected (manifest may declare none with 'url', or filters excluded all)."
    exit 0
fi

COUNT=$(echo "$SELECTED" | wc -l | xargs)
echo "  $COUNT repo(s) selected."

# --- Clone ---
echo ""
echo "[3/3] Cloning..."
SUCCESS=0
SKIPPED=0
FAILED=0
while IFS=' ' read -r name url; do
    if [ -d "$WORKSPACE/$name" ]; then
        echo "  SKIP $name (already exists at $WORKSPACE/$name)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    echo "  CLONE $name from $url"
    if git -C "$WORKSPACE" clone --quiet "$url" "$name"; then
        SUCCESS=$((SUCCESS + 1))
    else
        echo "    FAILED: git clone exited non-zero" >&2
        FAILED=$((FAILED + 1))
    fi
done <<< "$SELECTED"

echo ""
echo "Done. $SUCCESS cloned, $SKIPPED skipped, $FAILED failed."
[ $FAILED -eq 0 ] || exit 1
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/setup.sh`

- [ ] **Step 3: Smoke test in a tempdir**

Run:
```bash
TMP=$(mktemp -d)
cp -r .devcontainer Makefile household.json lore CLAUDE.md README.md .gitignore "$TMP/"
mkdir -p "$TMP/scripts" && cp scripts/setup.sh "$TMP/scripts/" && chmod +x "$TMP/scripts/setup.sh"
cd "$TMP" && ./scripts/setup.sh --help
```
Expected: the help text from the script.

Then test the no-siblings case: the starter `household.json` only has the workspace entry plus an inline `lore` entry (no url), so:
```bash
cd "$TMP" && ./scripts/setup.sh
```
Expected: "No siblings selected" exit-0.

Clean up: `rm -rf "$TMP"; cd /home/daniel/Source/witan-household`

- [ ] **Step 4: Commit and push**

```bash
git add scripts/setup.sh
git commit -m "feat(scripts): setup.sh — bootstrap siblings from household.json (Node parser, no jq)"
git push origin main
```

---

### Task 4: scripts/pull-all.sh and scripts/status-all.sh

**Files:**
- Create: `scripts/pull-all.sh`
- Create: `scripts/status-all.sh`

- [ ] **Step 1: Create pull-all.sh**

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$WORKSPACE/household.json"

if [ ! -f "$MANIFEST" ]; then
    echo "ERROR: No household.json. Run from inside a witan-household workspace." >&2
    exit 1
fi

# List non-workspace repo names from manifest.
SIBLINGS=$(node -e "
    const m = require('$MANIFEST');
    m.repos.filter(r => r.name !== m.workspace).forEach(r => console.log(r.name));
")

for name in $SIBLINGS; do
    DIR="$WORKSPACE/$name"
    if [ ! -d "$DIR/.git" ]; then
        echo "[SKIP] $name (no .git/)"
        continue
    fi
    echo "[FETCH] $name"
    git -C "$DIR" fetch --prune --quiet
    BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")
    if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
        if [ -z "$(git -C "$DIR" status --porcelain)" ]; then
            git -C "$DIR" pull --ff-only --quiet && echo "  pulled" || echo "  ff-pull failed"
        else
            echo "  dirty; skipping pull"
        fi
    else
        echo "  on '$BRANCH'; not pulling"
    fi
done
```

- [ ] **Step 2: Create status-all.sh**

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$WORKSPACE/household.json"

if [ ! -f "$MANIFEST" ]; then
    echo "ERROR: No household.json. Run from inside a witan-household workspace." >&2
    exit 1
fi

SIBLINGS=$(node -e "
    const m = require('$MANIFEST');
    m.repos.filter(r => r.name !== m.workspace).forEach(r => console.log(r.name));
")

for name in $SIBLINGS; do
    DIR="$WORKSPACE/$name"
    if [ ! -d "$DIR/.git" ]; then
        printf "%-30s (no .git/)\n" "$name"
        continue
    fi
    BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || echo "?")
    DIRTY=$(git -C "$DIR" status --porcelain | wc -l | xargs)
    AHEAD=$(git -C "$DIR" rev-list --count "@{u}..HEAD" 2>/dev/null || echo "0")
    BEHIND=$(git -C "$DIR" rev-list --count "HEAD..@{u}" 2>/dev/null || echo "0")
    printf "%-30s %s  %d dirty  %d ahead  %d behind\n" "$name" "$BRANCH" "$DIRTY" "$AHEAD" "$BEHIND"
done
```

- [ ] **Step 3: Make both executable**

Run: `chmod +x scripts/pull-all.sh scripts/status-all.sh`

- [ ] **Step 4: Smoke test (no siblings declared → no output)**

Run: `./scripts/status-all.sh`
Expected: no output (no siblings to report on in the template's starter household.json).

Run: `./scripts/pull-all.sh`
Expected: no output.

- [ ] **Step 5: Commit and push**

```bash
git add scripts/pull-all.sh scripts/status-all.sh
git commit -m "feat(scripts): pull-all.sh and status-all.sh — sync and inspect siblings"
git push origin main
```

---

### Task 5: scripts/split-lore.sh — interactive lore promotion

**Files:**
- Create: `scripts/split-lore.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/bash
set -euo pipefail

# Promote the inline `lore/` to a separate sibling git repo.
# Usage: ./scripts/split-lore.sh [REMOTE_URL]
#        REMOTE_URL is optional; if omitted, prompts interactively.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
LORE="$WORKSPACE/lore"
REMOTE="${1:-}"

if [ ! -d "$LORE" ]; then
    echo "ERROR: No lore/ directory at $LORE" >&2
    exit 1
fi
if [ -d "$LORE/.git" ]; then
    echo "ERROR: $LORE already has its own .git/ — already a separate sibling" >&2
    exit 1
fi

# --- Resolve remote ---
if [ -z "$REMOTE" ]; then
    echo "Inline lore/ is currently tracked in this workspace's git history."
    echo "Where should the extracted lore repo's origin point?"
    echo ""
    echo "  [1] local-only (no remote; you'll set one up later)"
    echo "  [2] create a new GitHub repo via 'gh repo create' (requires gh CLI)"
    echo "  [3] paste a remote URL I already have"
    echo "  [q] cancel"
    echo ""
    read -p "Choice: " CHOICE
    case "$CHOICE" in
        1) REMOTE="" ;;
        2)
            command -v gh >/dev/null 2>&1 || { echo "gh CLI not installed; aborting" >&2; exit 1; }
            read -p "Target repo name (e.g. you/my-workspace-lore): " GH_NAME
            read -p "Visibility (public/private) [private]: " GH_VIS
            GH_VIS="${GH_VIS:-private}"
            echo "Will run: gh repo create $GH_NAME --$GH_VIS"
            read -p "Proceed? [y/N]: " CONFIRM
            [ "$CONFIRM" = "y" ] || { echo "Aborted."; exit 1; }
            gh repo create "$GH_NAME" --"$GH_VIS" >/dev/null
            REMOTE="git@github.com:$GH_NAME.git"
            echo "Created $GH_NAME"
            ;;
        3)
            read -p "Remote URL: " REMOTE
            ;;
        q|Q) echo "Cancelled."; exit 0 ;;
        *) echo "Invalid choice." >&2; exit 1 ;;
    esac
fi

# --- Confirm before destructive ops ---
echo ""
echo "About to:"
echo "  1. Preserve lore content (cp -r lore lore.split-backup)"
echo "  2. Remove inline lore from this workspace's git history"
echo "  3. Restore lore as a fresh sibling repo"
[ -n "$REMOTE" ] && echo "  4. Set origin = $REMOTE and push"
echo "  5. Update parent .gitignore and household.json"
echo ""
read -p "Proceed? [y/N]: " CONFIRM
[ "$CONFIRM" = "y" ] || { echo "Aborted."; exit 1; }

# --- Execute ---
cd "$WORKSPACE"

echo ""
echo "[1/5] Preserving lore content..."
cp -r lore lore.split-backup

echo "[2/5] Removing from workspace history..."
rm -rf lore
git add -A
git commit -m "split: remove inline lore (becomes a sibling repo)"

echo "[3/5] Restoring as fresh sibling..."
mv lore.split-backup lore
cd lore
git init -b main --quiet
git add -A
git commit -m "initial lore" --quiet
cd "$WORKSPACE"

if [ -n "$REMOTE" ]; then
    echo "[4/5] Wiring remote: $REMOTE"
    git -C lore remote add origin "$REMOTE"
    git -C lore push -u origin main --quiet
fi

echo "[5/5] Updating parent files..."

# .gitignore: remove the `!/lore/` allowlist line (catch-all /* will gitignore lore now)
if grep -q '^!/lore/$' .gitignore 2>/dev/null; then
    grep -v '^!/lore/$' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
fi

# household.json: if a remote was provided, set the lore entry's url
if [ -n "$REMOTE" ]; then
    node -e "
        const fs = require('fs');
        const path = './household.json';
        const m = JSON.parse(fs.readFileSync(path, 'utf8'));
        const kb = m.knowledge_base || 'lore';
        const entry = m.repos.find(r => r.name === kb);
        if (entry) entry.url = '$REMOTE';
        fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
    "
fi

git add .gitignore household.json
git commit -m "split: lore is now a sibling repo"

echo ""
echo "Done. lore/ is now a sibling git repo."
[ -n "$REMOTE" ] && echo "  Remote: $REMOTE"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/split-lore.sh`

- [ ] **Step 3: Integration test in tempdir**

Run:
```bash
TMP=$(mktemp -d) && cp -r .devcontainer Makefile household.json lore CLAUDE.md README.md .gitignore "$TMP/"
mkdir -p "$TMP/scripts" && cp scripts/*.sh "$TMP/scripts/" && chmod +x "$TMP/scripts/"*.sh
cd "$TMP" && git init -b main --quiet && git add -A && git commit -m "initial" --quiet
echo "1" | ./scripts/split-lore.sh 2>&1 | tail -20
```
Expected: the script asks for confirmation; reading "1" selects local-only; reading the second confirmation (which won't be supplied) aborts. To get a full smoke test, feed both `1\ny\n` and verify lore is now a separate git repo with no remote.

```bash
cd "$TMP" && rm -rf .git lore && cp -r /home/daniel/Source/witan-household/.git . && cp -r /home/daniel/Source/witan-household/lore .
# Reset to known state, then:
printf '1\ny\n' | ./scripts/split-lore.sh
test -d lore/.git && echo "lore is a separate repo: OK"
test ! -e lore.split-backup && echo "backup cleaned: OK"
grep -q '^!/lore/' .gitignore && echo "gitignore NOT updated: FAIL" || echo "gitignore updated: OK"
```
Clean up: `cd /home/daniel/Source/witan-household && rm -rf "$TMP"`.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/split-lore.sh
git commit -m "feat(scripts): split-lore.sh — promote inline lore/ to a sibling repo (interactive + REMOTE= flag)"
git push origin main
```

---

### Task 6: scripts/rename.sh — workspace name substitution

**Files:**
- Create: `scripts/rename.sh`

- [ ] **Step 1: Create the script**

```bash
#!/bin/bash
set -euo pipefail

# Substitute the workspace placeholder name into household.json + CLAUDE.md.
# Usage: ./scripts/rename.sh <new-name>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
NEW_NAME="${1:-}"

if [ -z "$NEW_NAME" ]; then
    echo "Usage: $0 <new-name>" >&2
    echo "Example: $0 my-cool-project" >&2
    exit 1
fi

cd "$WORKSPACE"

OLD_NAME=$(node -e "console.log(require('./household.json').workspace)")

if [ "$OLD_NAME" = "$NEW_NAME" ]; then
    echo "Workspace name is already '$NEW_NAME'; nothing to do."
    exit 0
fi

# household.json: rewrite the `workspace` field AND the matching repos[] entry's name.
node -e "
    const fs = require('fs');
    const path = './household.json';
    const m = JSON.parse(fs.readFileSync(path, 'utf8'));
    const old = m.workspace;
    const entry = m.repos.find(r => r.name === old);
    m.workspace = '$NEW_NAME';
    if (entry) entry.name = '$NEW_NAME';
    fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
"

# CLAUDE.md: substitute the old name (typically appears in the layout diagram + headings).
if [ -f CLAUDE.md ]; then
    sed -i "s|$OLD_NAME|$NEW_NAME|g" CLAUDE.md
fi

echo "Renamed workspace: $OLD_NAME → $NEW_NAME"
echo "  Updated: household.json"
[ -f CLAUDE.md ] && echo "  Updated: CLAUDE.md"
echo ""
echo "Review the diff and commit:"
echo "  git diff household.json CLAUDE.md"
echo "  git add household.json CLAUDE.md && git commit -m 'rename: workspace → $NEW_NAME'"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/rename.sh`

- [ ] **Step 3: Smoke test in tempdir**

Run:
```bash
TMP=$(mktemp -d) && cp household.json CLAUDE.md "$TMP/" && cp scripts/rename.sh "$TMP/" && cd "$TMP"
./rename.sh my-test-project
grep -q '"workspace": "my-test-project"' household.json && echo "workspace updated: OK"
grep -q '"name": "my-test-project"' household.json && echo "repos[] entry renamed: OK"
grep -q 'my-test-project' CLAUDE.md && echo "CLAUDE.md updated: OK"
cd /home/daniel/Source/witan-household && rm -rf "$TMP"
```

- [ ] **Step 4: Commit and push**

```bash
git add scripts/rename.sh
git commit -m "feat(scripts): rename.sh — substitute workspace placeholder name everywhere"
git push origin main
```

---

### Task 7: Port lore/_tools/ from lorekeeper's standalone-KB template

**Files:**
- Create: `lore/_tools/cli.js`
- Create: `lore/_tools/build-index.js`
- Create: `lore/_tools/check-orphans.js`
- Create: `lore/_tools/validate-frontmatter.js`
- Create: `lore/_tools/validate-links.js`
- Create: `lore/_tools/doctor.js`
- Create: `lore/_tools/package.json`
- Create: `lore/_tools/__tests__/build-index.test.js`
- Create: `lore/_tools/__tests__/check-orphans.test.js`
- Create: `lore/_tools/__tests__/cli.test.js`
- Create: `lore/_tools/__tests__/validate-frontmatter.test.js`
- Create: `lore/_tools/__tests__/validate-links.test.js`
- Create: `lore/_tools/__tests__/doctor.test.js`

- [ ] **Step 1: Copy the existing standalone-KB tooling**

Source: `/home/daniel/Source/lorekeeper/templates/knowledge-base/src/` and its `__tests__/`. Destination: `lore/_tools/`.

```bash
mkdir -p lore/_tools/__tests__
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/build-index.js          lore/_tools/
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/check-orphans.js        lore/_tools/
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/cli.js                  lore/_tools/
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/validate-frontmatter.js lore/_tools/
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/validate-links.js       lore/_tools/
cp /home/daniel/Source/lorekeeper/templates/knowledge-base/src/__tests__/*.test.js     lore/_tools/__tests__/
```

- [ ] **Step 2: Audit the copied files for paths/imports**

Read `lore/_tools/cli.js` and each `.js` file. The originals were structured as `templates/knowledge-base/src/*.js` and reference each other via `require('./validate-frontmatter')` etc. — those relative requires keep working in the new location.

The tests in `__tests__/` may use `path.resolve(__dirname, '../..')` or similar to find a sample knowledge base. The originals expect a layout like `../../knowledge/` relative to `__tests__/`. With the new layout (`lore/_tools/__tests__/`), the knowledge base is at `../knowledge/`. Update test setups:

For every test file in `lore/_tools/__tests__/`, look for path resolutions that assume the standalone-template layout and adjust to the new layout. Specifically, anywhere a test does `path.resolve(__dirname, '../../knowledge')` becomes `path.resolve(__dirname, '../../knowledge')` — wait, that's the same. Let me re-examine:

In standalone-KB layout: `templates/knowledge-base/src/__tests__/foo.test.js` and knowledge is at `templates/knowledge-base/knowledge/`. From the test file, `../../knowledge` is correct.

In witan-household: `lore/_tools/__tests__/foo.test.js` and knowledge is at `lore/knowledge/`. From the test file, `../../knowledge` is correct.

The relative paths happen to match. No path changes needed in test files. Read each to verify.

- [ ] **Step 3: Create package.json**

```json
{
  "name": "witan-lore-tools",
  "version": "1.0.0",
  "private": true,
  "description": "Witan-household KB tooling: build-index, validate, check-orphans, doctor",
  "scripts": {
    "test": "node --test __tests__/*.test.js"
  }
}
```

- [ ] **Step 4: Run the ported tests to confirm they pass**

Run: `cd lore/_tools && npm test`
Expected: all tests pass. If any fail because of path assumptions, fix them.

- [ ] **Step 5: Add `doctor` subcommand to cli.js**

In `lore/_tools/cli.js`, find the command dispatch (after `parseArgs`). The existing dispatch handles `build-index`, `validate`, `check-orphans`, `check-index`. Add a `doctor` case:

```javascript
// In cli.js, alongside the existing command handlers:
} else if (command === 'doctor') {
    const { runDoctor } = require('./doctor');
    const exitCode = runDoctor(flags.dir || '../knowledge');
    process.exit(exitCode);
}
```

Update the usage help text in cli.js to document the new subcommand.

- [ ] **Step 6: Create doctor.js**

```javascript
// lore/_tools/doctor.js
'use strict';

const fs = require('fs');
const path = require('path');
const { validateAll: validateFrontmatter } = require('./validate-frontmatter');
const { validateAll: validateLinks } = require('./validate-links');
const { findOrphans } = require('./check-orphans');

/**
 * Run the full doctor diagnostic. Returns exit code (0 = clean, 1 = issues).
 * @param {string} knowledgeDir - path to the knowledge directory (default: ../knowledge)
 * @param {Object} options - { manifestPath: string }
 */
function runDoctor(knowledgeDir, options = {}) {
    const issues = { error: [], warning: [], info: [] };

    // --- Workspace checks ---
    const manifestPath = options.manifestPath || findManifest(knowledgeDir);
    if (manifestPath) {
        checkManifest(manifestPath, issues);
    } else {
        issues.warning.push('No household.json found — workspace checks skipped.');
    }

    // --- Lore checks ---
    if (!fs.existsSync(knowledgeDir)) {
        issues.error.push(`Knowledge dir not found at ${knowledgeDir}`);
        return reportAndExit(issues);
    }
    checkIndexStaleness(knowledgeDir, issues);
    const frontmatterErrors = validateFrontmatter(knowledgeDir);
    frontmatterErrors.forEach(e => issues.error.push(`Frontmatter: ${e.file}: ${e.message}`));
    const linkErrors = validateLinks(knowledgeDir);
    linkErrors.forEach(e => issues.error.push(`Broken wikilink in ${e.file}: ${e.link}`));
    const orphans = findOrphans(knowledgeDir);
    orphans.forEach(o => issues.warning.push(`Orphan: ${o}`));

    return reportAndExit(issues);
}

function findManifest(knowledgeDir) {
    let dir = path.resolve(knowledgeDir, '..');
    for (let i = 0; i < 4; i++) {
        const candidate = path.join(dir, 'household.json');
        if (fs.existsSync(candidate)) return candidate;
        dir = path.dirname(dir);
    }
    return null;
}

function checkManifest(manifestPath, issues) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        issues.error.push(`household.json parse error: ${e.message}`);
        return;
    }
    if (!manifest.workspace) {
        issues.error.push('household.json: missing required "workspace" field');
        return;
    }
    const workspaceEntry = manifest.repos.find(r => r.name === manifest.workspace);
    if (!workspaceEntry) {
        issues.error.push(`household.json: workspace = "${manifest.workspace}" has no matching repos[] entry`);
    }
    if (manifest.knowledge_base) {
        const kbEntry = manifest.repos.find(r => r.name === manifest.knowledge_base);
        if (!kbEntry) {
            issues.error.push(`household.json: knowledge_base = "${manifest.knowledge_base}" has no matching repos[] entry`);
        }
    }
    // Sibling presence
    const workspaceDir = path.dirname(manifestPath);
    for (const entry of manifest.repos) {
        if (entry.name === manifest.workspace) continue;
        const dir = path.join(workspaceDir, entry.name);
        if (!fs.existsSync(dir)) {
            issues.warning.push(`Sibling "${entry.name}" declared in household.json but not present at ${dir}`);
        }
    }
}

function checkIndexStaleness(knowledgeDir, issues) {
    const indexPath = path.join(knowledgeDir, '_index.json');
    if (!fs.existsSync(indexPath)) {
        issues.warning.push('_index.json missing — run `make build-index` for fast lookups.');
        return;
    }
    const indexMtime = fs.statSync(indexPath).mtimeMs;
    let staleFiles = 0;
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                if (fs.statSync(full).mtimeMs > indexMtime) staleFiles++;
            }
        }
    };
    walk(knowledgeDir);
    if (staleFiles > 0) {
        issues.warning.push(`_index.json is older than ${staleFiles} .md file(s) — run \`make build-index\`.`);
    }
}

function reportAndExit(issues) {
    const lines = [];
    lines.push('Lore + workspace diagnostic\n');
    if (issues.error.length === 0 && issues.warning.length === 0) {
        lines.push('  ✓ All checks passed.');
    } else {
        for (const e of issues.error) lines.push(`  ✗ ${e}`);
        for (const w of issues.warning) lines.push(`  ⚠ ${w}`);
    }
    lines.push('');
    lines.push(`Summary: ${issues.error.length} error(s), ${issues.warning.length} warning(s).`);
    console.log(lines.join('\n'));
    return issues.error.length > 0 ? 1 : 0;
}

module.exports = { runDoctor };
```

- [ ] **Step 7: Create doctor.test.js**

```javascript
// lore/_tools/__tests__/doctor.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDoctor } = require('../doctor');

function withTempWorkspace(callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
    try { return callback(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('doctor returns 0 for a clean workspace', () => {
    withTempWorkspace((tmp) => {
        fs.writeFileSync(path.join(tmp, 'household.json'), JSON.stringify({
            workspace: 'ws',
            repos: [{ name: 'ws' }, { name: 'lore' }]
        }));
        const kbDir = path.join(tmp, 'lore', 'knowledge');
        fs.mkdirSync(path.join(kbDir, 'general'), { recursive: true });
        fs.writeFileSync(path.join(kbDir, 'general', 'hello.md'),
            '---\ntitle: Hello\ndescription: Sample\ntags: [general]\n---\n\n# Hello\n');
        // Note: lore/knowledge/_starter is excluded by orphan checks via prefix _.
        const exitCode = runDoctor(kbDir);
        assert.equal(exitCode, 0);
    });
});

test('doctor returns 1 when manifest workspace pointer is invalid', () => {
    withTempWorkspace((tmp) => {
        fs.writeFileSync(path.join(tmp, 'household.json'), JSON.stringify({
            workspace: 'ghost',
            repos: [{ name: 'ws' }]
        }));
        const kbDir = path.join(tmp, 'lore', 'knowledge');
        fs.mkdirSync(kbDir, { recursive: true });
        const exitCode = runDoctor(kbDir);
        assert.equal(exitCode, 1);
    });
});

test('doctor reports sibling presence', () => {
    withTempWorkspace((tmp) => {
        fs.writeFileSync(path.join(tmp, 'household.json'), JSON.stringify({
            workspace: 'ws',
            repos: [{ name: 'ws' }, { name: 'missing-sibling' }]
        }));
        const kbDir = path.join(tmp, 'lore', 'knowledge');
        fs.mkdirSync(kbDir, { recursive: true });
        // Capture stdout to assert on the warning.
        const origLog = console.log;
        let captured = '';
        console.log = (msg) => { captured += msg + '\n'; };
        try {
            runDoctor(kbDir);
        } finally {
            console.log = origLog;
        }
        assert.match(captured, /missing-sibling/);
    });
});
```

- [ ] **Step 8: Run all tests**

Run: `cd lore/_tools && node --test __tests__/*.test.js`
Expected: all tests (including the 3 new doctor tests) pass.

- [ ] **Step 9: Commit and push**

```bash
git add lore/_tools/
git commit -m "feat(lore-tools): port build-index/validate/check-orphans + add doctor"
git push origin main
```

---

### Task 8: Fatten lore/knowledge/*/_starter.md files

**Files:**
- Modify: `lore/knowledge/general/_starter.md`
- Modify: `lore/knowledge/domain/_starter.md`
- Modify: `lore/knowledge/frameworks/_starter.md`
- Modify: `lore/knowledge/languages/_starter.md`
- Modify: `lore/knowledge/learnings/_starter.md`

- [ ] **Step 1: Replace general/_starter.md with a worked PR-guidelines example**

```markdown
---
title: Pull-request guidelines
description: Conventions for PR titles, descriptions, and reviewer expectations across every repo in this household.
tags: [general, code-review, pr]
---

# Pull-request guidelines

Replace this content with your team's actual standards. This file ships as a starter so newcomers see the shape of a node.

## Title

- Imperative mood, lowercase, no trailing period: `add user-deletion endpoint` not `Added user-deletion endpoint.`
- Keep under 70 characters. The body is for detail.
- Prefix with a conventional-commit type when useful: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.

## Description

A good PR description answers three questions:

1. **What changed?** A bullet list of the user-facing or architectural changes.
2. **Why?** The problem being solved. Link to issues/specs.
3. **How to verify?** A test plan reviewer can execute.

## Review expectations

- At least one approving review before merge.
- All resolved threads.
- CI green.
- See [[domain/_starter]] for domain-specific review concerns.
```

- [ ] **Step 2: Replace domain/_starter.md with a worked bounded-context example**

```markdown
---
title: User management — bounded context
description: Domain context for user accounts, authentication, and authorization. One node per bounded context in this household.
tags: [domain, ddd, core]
---

# User management

> Replace this placeholder with your actual bounded context. The shape below follows DDD conventions; keep the headings even when the content changes.

## Purpose

This context owns the lifecycle of user accounts: registration, authentication, profile data, deletion, and the audit trail of each.

## Key entities

- **User** — root aggregate. Holds identity, email, account state.
- **Session** — represents an authenticated browser/client. Belongs to a User.
- **Role** — a named permission set; many-to-many with User.

## Ubiquitous language

- *Account* and *User* are synonyms; *account* is preferred in user-facing copy, *user* in code.
- *Registered* means email confirmed; *unregistered* means email pending.
- *Disabled* (admin-deactivated) is distinct from *deleted* (user-initiated, irreversible after 30 days).

## Integration points

- **Inbound:** registration flow from the marketing site; SSO callbacks from identity providers.
- **Outbound:** account-lifecycle events on the message bus (`user.registered`, `user.deleted`); audit log writes.

## Key workflows

1. **Registration:** marketing-site → backend → email-confirmation → User registered.
2. **Deletion:** user-initiated → 30-day soft-delete → hard-delete cron.

See also [[frameworks/_starter]] for framework conventions used here.
```

- [ ] **Step 3: Replace frameworks/_starter.md**

```markdown
---
title: React component conventions
description: Naming, file structure, and composition rules for React components in this household.
tags: [frameworks, react, conventions]
---

# React component conventions

> Replace with your team's actual conventions. This is a starter showing structure and how to cross-reference other nodes.

## File structure

- One component per file.
- Filename matches the default export: `UserCard.tsx` exports `UserCard`.
- Co-locate styles: `UserCard.tsx` + `UserCard.module.css` in the same dir.

## Composition

- Functional components only; no class components in new code.
- Hooks at the top of the function; no conditional hook calls.
- Extract custom hooks when logic exceeds ~20 lines.

## Naming

- Components: `PascalCase`.
- Hooks: `useCamelCase`.
- Boolean props: `isX`, `hasY`, `shouldZ`. Avoid bare `flag` or `enabled`.

## Cross-references

- For PR-review expectations, see [[general/_starter]].
- For TypeScript-specific style, see [[languages/_starter]].
```

- [ ] **Step 4: Replace languages/_starter.md**

```markdown
---
title: TypeScript code style
description: Language-level conventions for TypeScript code in this household.
tags: [languages, typescript, style]
---

# TypeScript code style

> Replace with your team's actual style guide.

## Types

- `interface` for public shapes, `type` for unions and computed types.
- No `any` unless interfacing with an untyped library; prefer `unknown` + narrowing.
- Function return types explicit at API boundaries; inferred elsewhere.

## Naming

- `PascalCase` for types and classes, `camelCase` for variables and functions.
- Boolean variables: `isX`, `hasY`. Avoid bare `flag`.
- Constants: `SCREAMING_SNAKE_CASE` only for module-level immutable primitives.

## Imports

- Absolute imports (`@/foo/bar`) for cross-module references.
- Relative imports (`./baz`) for same-module siblings.
- Never `import * as X` for first-party code.

See [[frameworks/_starter]] for React-specific overlay on this.
```

- [ ] **Step 5: Replace learnings/_starter.md**

```markdown
---
title: Database connection pool exhaustion under load test
tags: [database, performance, load-testing]
confidence: verified
source: developer-input
date: 2026-05-16
---

# Database connection pool exhaustion under load test

> Replace this with real learnings as your team encounters them. This file shows the shape of a verified learning.

## What happened

During the v2.3 load test, the API tier exhausted its database connection pool at ~120 concurrent requests, leading to 30-second timeouts and cascading retries. The issue did not reproduce on staging because staging's max_connections was lower than production but the API tier's pool size was identical.

## Root cause

A long-running report query (introduced in PR #1234) held a connection for ~8 seconds. Under load, even moderate report-generation traffic could lock out the rest of the API.

## Fix

- Moved the report query to a separate read-replica connection pool.
- Added a per-endpoint connection-acquisition timeout of 2 seconds; over-budget requests fast-fail to 503 with a Retry-After header.

## When this matters

Any future endpoint that holds a DB connection longer than 1 second should follow the same pattern. See [[general/_starter]] for PR-level guardrails.
```

- [ ] **Step 6: Build the index and verify validators pass on the new content**

Run: `make build-index && make validate`
Expected: index builds; validators report no errors.

- [ ] **Step 7: Commit and push**

```bash
git add lore/knowledge/*/_starter.md lore/_index.json
git commit -m "feat(lore): fatten _starter.md files with one concrete worked example per category"
git push origin main
```

---

### Task 9: README sections — adoption scenarios + two-install reality

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add "Adopting witan in an existing project" section**

After the existing "Getting started" section, insert:

```markdown
## Adopting witan in an existing project

If you already have a project, you don't need to start fresh. Run `/lore:init` from inside any directory and Lorekeeper detects your state:

### Scenario 1 — greenfield (no project yet)

```sh
mkdir my-workspace && cd my-workspace
# In Claude Code:
/lore:init
```

Lorekeeper scaffolds the witan-household structure (household.json, .devcontainer/, CLAUDE.md, lore/, .gitignore), substitutes the workspace name, and initialises a git repo.

### Scenario 2 — existing single-repo project, no KB yet

```sh
cd ~/Source/my-existing-project
/lore:init
```

Lorekeeper detects the existing `.git/`, asks before touching anything, then adds the workspace files alongside your existing code. Your `.git/` history, your code, and your remote stay exactly as they were — you just gain `household.json`, `lore/`, and the `.devcontainer/` directory.

### Scenario 3 — existing single-repo with `docs/` or `knowledge/` already

Same as Scenario 2, but `/lore:init` notices the existing docs directory. It offers to rename it to `lore/knowledge/` (recommended) or set up `KNOWLEDGE_BASE_PATH` to point at the existing location.

### Scenario 4 — poly-repo (multiple sibling repos)

```sh
mkdir ~/Source/my-workspace && mv ~/Source/backend ~/Source/frontend ~/Source/my-workspace/
cd ~/Source/my-workspace
/lore:init
```

Lorekeeper detects the sibling repos, asks which to include, and populates `household.json` accordingly. The workspace meta-repo wraps them; their individual `.git/` histories are unchanged.

### Scenario 5 — poly-repo + existing separate KB

Same as Scenario 4, plus move your existing KB repo into the workspace as `lore/` (or any other name; declare it in `household.json` and set `knowledge_base` to point at it).

## Two-install reality

Lorekeeper is installed in **two distinct contexts**:

1. **On your host** — for direct Claude Code use outside any devcontainer. Install via `/plugin marketplace add Mindful-Stack/witan` + `/plugin install lorekeeper@witan`.
2. **Inside every Reeve card's container** — automatically, via this template's `.devcontainer/devcontainer.json` `postCreateCommand`.

Same plugin, two install paths, both deliberate. The host install serves general CC work; the container install serves Reeve cards (which run with `--dangerously-skip-permissions`). They don't share state.

If you're not using Reeve, the container install is still useful: any `devcontainer up`-spawned dev shell from this workspace ships with Lorekeeper. If you want to disable it, edit `.devcontainer/devcontainer.json` and remove the last two entries in `postCreateCommand`.
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs(readme): adoption scenarios + two-install reality sections"
git push origin main
```

---

## Phase 2: Lorekeeper plugin updates

All Phase 2 tasks operate inside `/home/daniel/Source/lorekeeper/`. Branch decision is the user's; this plan assumes one feature branch `feat/witan-unification` from `main`.

---

### Task 10: Create the feature branch + delete the standalone-KB artefacts

**Files:**
- Delete: `templates/knowledge-base/` (entire directory)
- Delete: `scripts/init-knowledge-base.js`
- Delete: `scripts/__tests__/init-knowledge-base.test.js`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/witan-unification main
```

- [ ] **Step 2: Delete the standalone template**

```bash
git rm -r templates/knowledge-base
git rm scripts/init-knowledge-base.js
git rm scripts/__tests__/init-knowledge-base.test.js
```

- [ ] **Step 3: Verify nothing else in the repo still references the deleted paths**

Run: `grep -rln 'templates/knowledge-base\|init-knowledge-base' --include='*.md' --include='*.js' --include='*.sh' .`
Expected: zero hits (or only docs/superpowers/specs/ where the deletion is explicitly described).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove standalone-KB template + init script (superseded by witan-household)"
```

---

### Task 11: Detection script — scripts/init-detect.js

**Files:**
- Create: `scripts/init-detect.js`
- Create: `scripts/__tests__/init-detect.test.js`

- [ ] **Step 1: Write the detection test (TDD)**

```javascript
// scripts/__tests__/init-detect.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../init-detect.js');

function detect(cwd) {
    const out = execSync(`node ${SCRIPT}`, { cwd, encoding: 'utf8' });
    return JSON.parse(out);
}

function withTmp(callback) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'init-detect-'));
    try { return callback(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('empty dir → greenfield', () => withTmp((tmp) => {
    assert.equal(detect(tmp).scenario, 'greenfield');
}));

test('dir with files but no .git/ → files-no-git', () => withTmp((tmp) => {
    fs.writeFileSync(path.join(tmp, 'something.txt'), 'hi');
    assert.equal(detect(tmp).scenario, 'files-no-git');
}));

test('git repo with no household.json → single-repo-retrofit', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(path.join(tmp, 'main.go'), 'package main');
    assert.equal(detect(tmp).scenario, 'single-repo-retrofit');
}));

test('git repo with docs/ → docs-migration', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(path.join(tmp, 'docs', 'index.md'), '# Docs');
    const result = detect(tmp);
    assert.equal(result.scenario, 'docs-migration');
    assert.equal(result.context.dir, 'docs');
}));

test('git repo with knowledge/ → docs-migration with that dir', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.mkdirSync(path.join(tmp, 'knowledge'));
    fs.writeFileSync(path.join(tmp, 'knowledge', 'foo.md'), '# foo');
    const result = detect(tmp);
    assert.equal(result.scenario, 'docs-migration');
    assert.equal(result.context.dir, 'knowledge');
}));

test('dir with multiple child git repos → poly-repo-retrofit', () => withTmp((tmp) => {
    for (const name of ['backend', 'frontend']) {
        fs.mkdirSync(path.join(tmp, name, '.git'), { recursive: true });
    }
    const result = detect(tmp);
    assert.equal(result.scenario, 'poly-repo-retrofit');
    assert.deepEqual(result.context.repos.sort(), ['backend', 'frontend']);
}));

test('existing household.json → already-a-workspace', () => withTmp((tmp) => {
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(path.join(tmp, 'household.json'), '{}');
    assert.equal(detect(tmp).scenario, 'already-a-workspace');
}));

test('refuses common dump dirs (HOME)', () => withTmp((tmp) => {
    // Simulate $HOME being the CWD by setting HOME=tmp.
    for (const name of ['proj-a', 'proj-b', 'proj-c']) {
        fs.mkdirSync(path.join(tmp, name, '.git'), { recursive: true });
    }
    const out = execSync(`HOME=${tmp} node ${SCRIPT}`, { cwd: tmp, encoding: 'utf8' });
    const result = JSON.parse(out);
    assert.equal(result.scenario, 'refused');
    assert.match(result.context.reason, /\$HOME/);
}));
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node --test scripts/__tests__/init-detect.test.js`
Expected: every test fails with "Cannot find module '../init-detect.js'" or similar.

- [ ] **Step 3: Write the detection script**

```javascript
// scripts/init-detect.js
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

    // No .git/ but has files → files-no-git
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --test scripts/__tests__/init-detect.test.js`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/init-detect.js scripts/__tests__/init-detect.test.js
git commit -m "feat(init): detection script — classify CWD state for /lore:init dispatch"
```

---

### Task 12: Rewrite commands/init.md as smart command

**Files:**
- Rewrite: `commands/init.md`

- [ ] **Step 1: Replace commands/init.md**

```markdown
---
description: Adopt witan in this directory. Smart: detects whether it's empty, an existing repo, a project with docs, or a poly-repo parent, and dispatches accordingly.
---

# Init Command

Adopt witan in the current directory. The command detects state and offers the right setup.

## Usage

```
/lore:init                # Run in the current directory
/lore:init <name>         # Override the workspace name (otherwise inferred)
```

## Implementation

### Step 1: Detect state

Use the Bash tool to run the detection script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/init-detect.js
```

Parse the JSON output. The `scenario` field is one of:

- `greenfield` — empty directory; scaffold from scratch
- `files-no-git` — has files but no .git/; confirm before initialising
- `single-repo-retrofit` — git repo, no household.json; add workspace files in place
- `docs-migration` — git repo with `docs/`/`knowledge/`/`wiki/` directory; offer rename or override
- `poly-repo-retrofit` — multiple child git repos at depth 1; offer to wrap them
- `already-a-workspace` — has household.json; refuse with helpful message
- `refused` — running in `$HOME` or `$HOME/Source`; refuse with safety message

### Step 2: Dispatch per scenario

Use AskUserQuestion to confirm the scenario interpretation and gather any additional input (workspace name, sibling selection for poly-repo). Then run the scenario-specific actions via Bash.

For each scenario, the workspace name defaults to the basename of CWD unless the user provided an argument to /lore:init.

#### Greenfield

1. Confirm with the user: "I'll scaffold a fresh witan-household workspace here. Workspace name will be `<inferred>`. OK?"
2. If yes, clone the witan-household template from GitHub:

```bash
gh repo clone Mindful-Stack/witan-household .tmp-witan-clone 2>/dev/null \
  || git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git .tmp-witan-clone
mv .tmp-witan-clone/{.devcontainer,.gitignore,CLAUDE.md,Makefile,README.md,household.json,lore,scripts} .
rm -rf .tmp-witan-clone
node ./scripts/rename.sh "<workspace-name>"  # script substitutes names
git init -b main && git add -A && git commit -m "initial workspace (from Mindful-Stack/witan-household)"
```

3. Report what was created.

#### Files-no-git

1. Confirm: "I see files in this directory but no .git/. Initialise a new git repo and adopt witan here?"
2. If yes: same as Greenfield except `git init` happens with the existing files included in the initial commit.

#### Single-repo retrofit

1. Confirm: "This is an existing git repo. I'll add the witan workspace files (household.json, .devcontainer/, CLAUDE.md, lore/, .gitignore updates) without touching your existing code. OK?"
2. Clone the witan-household template to a tempdir and copy only the workspace files in:

```bash
TMPL=$(mktemp -d)
git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git "$TMPL"
# Copy only the workspace artefacts — do not overwrite existing CLAUDE.md
[ -f CLAUDE.md ] && echo "Existing CLAUDE.md preserved; new content appended" \
  && cat "$TMPL/CLAUDE.md" >> CLAUDE.md \
  || cp "$TMPL/CLAUDE.md" CLAUDE.md
cp "$TMPL/household.json" .
cp -r "$TMPL/.devcontainer" .
cp -r "$TMPL/lore" .
cp "$TMPL/Makefile" .
cp -r "$TMPL/scripts" .
# Merge .gitignore: append the workspace-meta patterns to the existing one
cat "$TMPL/.gitignore" >> .gitignore
rm -rf "$TMPL"
node scripts/rename.sh "<workspace-name>"
git add household.json .devcontainer lore Makefile scripts CLAUDE.md .gitignore
git commit -m "adopt witan-household pattern (in-place retrofit)"
```

3. Report; suggest the user review the merged CLAUDE.md and `.gitignore`.

#### Docs migration

The context has `dir` set to `docs`, `knowledge`, or `wiki`.

1. Show the user the detected dir.
2. AskUserQuestion with options:
   - "Rename `<dir>/` to `lore/knowledge/` (Recommended)"
   - "Keep `<dir>/` and set up `KNOWLEDGE_BASE_PATH` override instead"
   - "Cancel"

3. If rename: run single-repo retrofit, then `git mv <dir> lore/knowledge` (handling sub-dir merge if `lore/` was already created by the retrofit).
4. If override: run single-repo retrofit; afterwards write `.lorekeeper/config.json` with `{ "knowledgeBasePath": "<absolute-dir-path>" }`.

#### Poly-repo retrofit

The context has `repos` array set to the detected child git repos.

1. List the detected repos. AskUserQuestion (multiSelect) for which to include in the workspace.
2. If user picks at least one: scaffold the workspace at CWD (single-repo-retrofit flow without preserving existing CLAUDE.md, since CWD typically doesn't have one) and populate `household.json`'s `repos[]` with the selected siblings. Workspace name defaults to CWD basename.

```bash
# After scaffolding the workspace files...
node -e "
    const fs = require('fs');
    const path = './household.json';
    const m = JSON.parse(fs.readFileSync(path, 'utf8'));
    const selected = process.argv.slice(1);
    for (const name of selected) {
        m.repos.push({ name });
    }
    fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
" "$@"  # pass the selected repo names as CLI args
git init -b main && git add -A && git commit -m "wrap existing siblings in a witan-household meta-repo"
```

3. Report. Note that the siblings' `.git/` histories are unchanged.

#### Already-a-workspace

1. Print: "This directory is already a witan-household (household.json exists). For status, run `/lore:help`. For diagnostics, run `/lore:doctor`."
2. Exit without changes.

#### Refused

1. Print the refusal reason from the detection context.
2. Suggest: `mkdir <name> && cd <name> && /lore:init`.
3. Exit without changes.

## Notes

- Every scaffold flow ends with a single commit. The user can amend or split before pushing.
- For greenfield and files-no-git, the script clones the witan-household template fresh each time. For air-gapped environments, the user can manually `git clone` the template once and pass its local path to a future invocation via `--template <path>` (not implemented in v1; see plan for follow-up).
- The single-repo-retrofit MERGES the workspace's `.gitignore` into the existing one rather than overwriting. The user should review the result.
```

- [ ] **Step 2: Commit**

```bash
git add commands/init.md
git commit -m "feat(commands): rewrite /lore:init as smart command with state detection + dispatch"
```

---

### Task 13: Create commands/doctor.md

**Files:**
- Create: `commands/doctor.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Full workspace + KB diagnostic. Reports manifest issues, sibling presence, KB frontmatter, broken wikilinks, and orphans.
---

# Doctor Command

Run a full diagnostic against the current witan-household workspace and its knowledge base.

## Usage

```
/lore:doctor
```

## Implementation

### Step 1: Locate the workspace

The SessionStart hook sets the knowledge path in the system message. The workspace root is the parent directory of `<knowledge-path>` (i.e. `<knowledge-path>/..`).

If no knowledge path is set, tell the user: "No knowledge base configured. Run /lore:init or set KNOWLEDGE_BASE_PATH."

### Step 2: Invoke the doctor tool

```bash
node <workspace-root>/lore/_tools/cli.js doctor
```

Capture stdout and stderr. The tool exits 0 if all checks pass, 1 if any errors were found.

### Step 3: Render the output

Display the tool's output verbatim. If there are errors (exit code 1):

- For broken-wikilink errors: offer to run `/lore:update` to propose adding the missing node.
- For frontmatter errors: print the file:line and suggest the fix.
- For missing sibling errors: print `make setup` as the suggested fix.
- For `_index.json` staleness: print `make build-index` as the suggested fix.

### Step 4: Exit cleanly

End the response with a one-line summary: "X errors, Y warnings. <suggested next step or 'All clear.'>"

## Notes

- /lore:doctor never modifies files. It's read-only.
- The diagnostic tool lives in the witan-household template under `lore/_tools/`. If the user's workspace was created before the tooling was added, `cli.js doctor` won't exist; in that case, suggest the user run `make build-index` from inside the new witan-household template they should adopt.
```

- [ ] **Step 2: Commit**

```bash
git add commands/doctor.md
git commit -m "feat(commands): /lore:doctor — full workspace + KB diagnostic"
```

---

### Task 14: Update commands/help.md

**Files:**
- Modify: `commands/help.md`

- [ ] **Step 1: Read the current help.md**

Read `commands/help.md` and locate the commands table. Add `/lore:doctor` to it.

- [ ] **Step 2: Apply the edit**

Find the existing table (something like a markdown table listing `/lore:help`, `/lore:init`, `/lore:onboard`, etc.) and add a row:

```markdown
| `/lore:doctor` | Run full workspace + KB diagnostic |
```

Place it alphabetically (between `/lore:explore` and `/lore:help` or wherever fits the existing ordering).

If help.md also has a "Quick Start" section that references `/lore:init` with old wording about "scaffold a fresh knowledge base from templates," update it to "Adopt witan in this directory (smart: detects existing repos and dispatches)."

- [ ] **Step 3: Commit**

```bash
git add commands/help.md
git commit -m "docs(help): add /lore:doctor; align /lore:init description with smart command"
```

---

### Task 15: README.md polish for unified setup story

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the commands table**

Find the existing commands table near the top of the README. Add `/lore:doctor` between `/lore:review` and `/lore:update`:

```markdown
| `/lore:doctor` | Run a full workspace + KB diagnostic (manifest validity, sibling presence, KB hygiene) |
```

- [ ] **Step 2: Update the `/lore:init` section**

Find the existing "### Init" subsection (under "## Commands"). Replace it with:

```markdown
### Init

Adopt witan in the current directory. The command detects state and dispatches:

```bash
/lore:init                # Detect CWD state, scaffold or retrofit accordingly
/lore:init <name>         # Override workspace name (otherwise inferred from CWD basename)
```

Scenarios it handles:

- **Greenfield** (empty dir): fresh witan-household scaffold.
- **Single-repo retrofit** (existing git repo): adds workspace files in place; existing code untouched.
- **Docs migration** (existing repo with `docs/`/`knowledge/`/`wiki/`): offers rename to `lore/knowledge/` or env-var override.
- **Poly-repo retrofit** (parent of multiple git repos): wraps them in a meta-repo.
- **Already-a-workspace**: refuses; suggests `/lore:help`.
- **Refused** (running in `$HOME` or `$HOME/Source`): suggests creating a dedicated dir first.

The bundled standalone-KB template flow (`/lore:init <path>` that scaffolds a separate repo) is gone — the witan-household pattern covers both standalone-Lorekeeper and Lorekeeper-with-Reeve use cases.
```

- [ ] **Step 3: Add a "Doctor" subsection**

After the existing "### Update Knowledge" section, add:

```markdown
### Doctor

Run a full diagnostic against your workspace and KB:

```bash
/lore:doctor
```

Checks include: manifest parses + workspace pointer resolves + KB pointer resolves + sibling presence on host + KB index freshness + frontmatter validity + broken wikilinks + orphan files.

Exits non-zero if errors are found; surfaces each with a file:line reference and suggested fix.
```

- [ ] **Step 4: Audit and tighten the rest of the README**

Read the full README and remove any references to:

- The standalone-KB template (`templates/knowledge-base/`)
- The `init-knowledge-base.js` script
- Any "scaffold a new knowledge base" wording that implies the standalone template

Replace with witan-household pattern wording where applicable. The "Setup" section at the top should already lead with witan-household (from earlier commit `bc4cf04`); just polish.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): document /lore:doctor and smart /lore:init; drop standalone-template references"
```

---

### Task 16: Babashka scenario tests for smart /lore:init and /lore:doctor

**Files:**
- Modify: `test/scenarios.edn`

- [ ] **Step 1: Read the existing scenarios.edn**

Read `test/scenarios.edn` and find the existing scenarios. They have the shape:

```clojure
{:name "command-name"
 :prompt "/lore:command-name"
 :workdir "."
 :expects [...]}
```

- [ ] **Step 2: Add scenarios for /lore:init greenfield and /lore:doctor**

Add two new scenarios to the vector:

```clojure
 {:name "command-init-greenfield"
  :prompt "/lore:init"
  :workdir "/tmp/init-test-empty"
  :setup-fn (fn [dir] (when (.exists (clojure.java.io/file dir)) (clojure.java.io/delete-file dir)) (.mkdirs (clojure.java.io/file dir)))
  :expects ["greenfield" "witan-household|workspace"]}

 {:name "command-doctor-runs"
  :prompt "/lore:doctor"
  :workdir "."  ; runs in the workspace root where this plugin lives
  :expects ["diagnostic|doctor|errors|warnings|all clear"]}
```

Note: the existing `run-tests.clj` may not support `:setup-fn`; if so, simplify the init scenario to assume the test runner is invoked from an already-empty workdir managed externally.

Alternative simpler scenarios that work with the current harness:

```clojure
 {:name "command-doctor-runs"
  :prompt "/lore:doctor"
  :workdir "."
  :expects ["doctor|diagnostic|errors|warnings"]}

 {:name "command-init-already-workspace"
  :prompt "/lore:init"
  :workdir "."  ; the plugin repo is NOT a witan-household; this exercises the "no household.json + has .git" branch
  :expects ["retrofit|workspace|adopt"]}
```

- [ ] **Step 3: Run the Babashka tests**

Run: `bb test/run-tests.clj --filter "doctor\|init"`
Expected: new scenarios pass.

- [ ] **Step 4: Commit**

```bash
git add test/scenarios.edn
git commit -m "test(scenarios): add /lore:init and /lore:doctor Babashka scenarios"
```

---

### Task 17: Final integration smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full lorekeeper test suite**

```bash
node --test scripts/__tests__/*.test.js
bb test/run-tests.clj
```

Both should exit zero.

- [ ] **Step 2: Verify the deletion didn't break sibling-fallback**

Run a small smoke against the lorekeeper README's claims:

```bash
TMP=$(mktemp -d) && cd "$TMP"
mkdir lore && cd lore && mkdir -p knowledge/general && cd ..
echo "---\ntitle: hi\ndescription: x\ntags: [t]\n---" > lore/knowledge/general/test.md
# Confirm: the hook would resolve this as the KB via sibling-fallback.
# (We can't easily run the hook standalone here; this verifies the layout.)
ls lore/knowledge/general/
cd / && rm -rf "$TMP"
```

- [ ] **Step 3: Open a PR for the feature branch**

```bash
gh pr create --title "feat: witan system unification (Phase 2 — Lorekeeper plugin)" \
  --body "$(cat <<'EOF'
## Summary

Implements Phase 2 of the witan system unification (spec: docs/superpowers/specs/2026-05-16-witan-system-unification-design.md).

Phase 1 (witan-household template overhaul) is already merged in Mindful-Stack/witan-household:main.

### Changes
- Smart /lore:init: detects CWD state and dispatches (greenfield / single-repo retrofit / poly-repo retrofit / docs migration / already-a-workspace / refused).
- New /lore:doctor: full workspace + KB diagnostic via the witan-household template's bundled lore/_tools/cli.js.
- Deleted templates/knowledge-base/ and scripts/init-knowledge-base.js — superseded by the witan-household template and smart /lore:init.
- README polished to drop standalone-template references; commands/help.md updated.
- Babashka scenarios added for /lore:init and /lore:doctor.

### Test plan
- [x] node --test scripts/__tests__/*.test.js passes
- [x] bb test/run-tests.clj passes (full suite + new scenarios)
- [ ] Manual smoke: /lore:init in greenfield dir → working workspace
- [ ] Manual smoke: /lore:init in existing project dir → in-place retrofit
- [ ] Manual smoke: /lore:doctor in a workspace → reports clean
- [ ] Manual smoke: /lore:doctor after intentionally breaking a wikilink → reports the broken link
EOF
)"
```

---

## Self-review

### Spec coverage

Skim the spec at `docs/superpowers/specs/2026-05-16-witan-system-unification-design.md`. For each section/feature:

- Manifest rename → **DONE in Phase 0** (committed pre-plan)
- Witan-household template overhaul:
  - Default-on Lorekeeper install → Task 1
  - Makefile + bootstrap scripts → Tasks 2-6
  - `lore/_tools/` port + `doctor` subcommand → Task 7
  - Fattened `_starter.md` files → Task 8
  - Adoption-scenarios README + two-install note → Task 9
- Lorekeeper plugin changes:
  - Smart /lore:init → Tasks 11-12
  - /lore:doctor → Task 13
  - Standalone template deletion → Task 10
  - help.md + README updates → Tasks 14-15
- Reeve coordination → **DONE in Phase 0** (committed pre-plan)
- Testing — covered per-task plus Task 16 (Babashka scenarios) plus Task 17 (final smoke).

All sections mapped.

### Placeholder scan

No "TBD" / "implement later" / "similar to Task N" wording. Each task has concrete code blocks, exact paths, exact commands.

### Type / interface consistency

- `init-detect.js` outputs `{ scenario, context }` — same shape used by `commands/init.md`'s dispatch logic.
- `runDoctor(knowledgeDir, options)` signature consistent across `doctor.js` and `doctor.test.js`.
- `household.json` schema (workspace, knowledge_base, repos[]) consistent with what Phase 0 already locked in.
- Test scenarios (`scenarios.edn`) keys: `:name`, `:prompt`, `:workdir`, `:expects` — match existing harness.

### Sequencing

Phase 1 (witan-household) lands first; Task 7's `lore/_tools/` is what Phase 2's `/lore:doctor` invokes. Phase 1 tasks can run mostly in any order (Tasks 1-9 are largely independent within Phase 1). Phase 2 tasks depend on Phase 1 being shipped:

- Task 10 (delete standalone) — only safe after Phase 1's `lore/_tools/` is in the template.
- Task 13 (doctor command) — depends on `lore/_tools/cli.js doctor` existing.

Within Phase 2, Tasks 10-12 should land before Tasks 13-16.
