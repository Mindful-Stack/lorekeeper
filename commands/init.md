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
git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git .tmp-witan-clone
# Move template content into CWD
mv .tmp-witan-clone/.devcontainer .tmp-witan-clone/.gitignore .tmp-witan-clone/CLAUDE.md \
   .tmp-witan-clone/Makefile .tmp-witan-clone/README.md .tmp-witan-clone/household.json \
   .tmp-witan-clone/lore .tmp-witan-clone/scripts .
rm -rf .tmp-witan-clone
# Stamp schema_version from the plugin's source of truth (do NOT rely on the
# template alone — a stale template could otherwise birth a drifted workspace).
CUR=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/scripts/manifest-schema.json').current)")
CUR="$CUR" node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('./household.json', 'utf8'));
    m.schema_version = Number(process.env.CUR);
    fs.writeFileSync('./household.json', JSON.stringify(m, null, 2) + '\n');
"
chmod +x scripts/*.sh
./scripts/rename.sh "<workspace-name>"
git init -b main && git add -A && git commit -m "initial workspace (from Mindful-Stack/witan-household)"
```

3. Report what was created.

#### Files-no-git

1. Confirm: "I see files in this directory but no .git/. Initialise a new git repo and adopt witan here?"
2. If yes: same as Greenfield except the `git init`-then-commit includes the existing files.

#### Single-repo retrofit

1. Confirm: "This is an existing git repo. I'll add the witan workspace files (household.json, .devcontainer/, CLAUDE.md, lore/, .gitignore updates) without touching your existing code. OK?"
2. Clone the witan-household template to a tempdir and copy only the workspace files in:

```bash
TMPL=$(mktemp -d)
git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git "$TMPL"
# Copy only the workspace artefacts — handle existing CLAUDE.md specially
if [ -f CLAUDE.md ]; then
    echo "" >> CLAUDE.md
    echo "<!-- witan-household additions: -->" >> CLAUDE.md
    cat "$TMPL/CLAUDE.md" >> CLAUDE.md
else
    cp "$TMPL/CLAUDE.md" CLAUDE.md
fi
cp "$TMPL/household.json" .
# Stamp schema_version from the plugin's source of truth (do NOT rely on the
# template alone — a stale template could otherwise birth a drifted workspace).
CUR=$(node -e "console.log(require('${CLAUDE_PLUGIN_ROOT}/scripts/manifest-schema.json').current)")
CUR="$CUR" node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('./household.json', 'utf8'));
    m.schema_version = Number(process.env.CUR);
    fs.writeFileSync('./household.json', JSON.stringify(m, null, 2) + '\n');
"
cp -r "$TMPL/.devcontainer" .
cp -r "$TMPL/lore" .
cp "$TMPL/Makefile" .
cp -r "$TMPL/scripts" .
chmod +x scripts/*.sh
# Merge .gitignore: append the workspace-meta patterns to existing
if [ -f .gitignore ]; then
    echo "" >> .gitignore
    echo "# witan-household additions:" >> .gitignore
    cat "$TMPL/.gitignore" >> .gitignore
else
    cp "$TMPL/.gitignore" .
fi
rm -rf "$TMPL"
./scripts/rename.sh "<workspace-name>"
git add household.json .devcontainer lore Makefile scripts CLAUDE.md .gitignore
git commit -m "adopt witan-household pattern (in-place retrofit)"
```

3. Report; remind the user to review the merged CLAUDE.md and `.gitignore`.

#### Docs migration

The context has `dir` set to `docs`, `knowledge`, or `wiki`.

1. Show the user the detected dir.
2. AskUserQuestion with options:
   - "Rename `<dir>/` to `lore/knowledge/` (Recommended)"
   - "Keep `<dir>/` and set up `KNOWLEDGE_BASE_PATH` override instead"
   - "Cancel"

3. If rename: run single-repo retrofit, then move the existing dir into `lore/knowledge`:
   ```bash
   # After single-repo retrofit has scaffolded lore/knowledge/_starter.md files
   for f in <dir>/*; do
       mv "$f" lore/knowledge/
   done
   rmdir <dir>
   git add -A && git commit -m "migrate <dir>/ into lore/knowledge/"
   ```
4. If override: run single-repo retrofit; afterwards write `.lorekeeper/config.json`:
   ```bash
   mkdir -p .lorekeeper
   ABS=$(realpath <dir>)
   echo "{ \"knowledgeBasePath\": \"$ABS\" }" > .lorekeeper/config.json
   ```

#### Poly-repo retrofit

The context has `repos` array set to the detected child git repos.

1. List the detected repos. AskUserQuestion (multiSelect) for which to include in the workspace.

2. If user picks at least one: AskUserQuestion for KB topology:

   > "How should the `lore/` knowledge base live in this workspace?"

   Options:
   - **Inline (Recommended)** — `lore/` is tracked as a subdirectory of the workspace meta-repo. Simpler; one repo to push, one PR stream. Choose this if unsure.
   - **Sibling repo** — `lore/` is its own git repo at `<workspace>/lore/`, gitignored from the workspace meta-repo. KB has its own PR stream — useful if you want different access control or release cadence for KB vs workspace.

3. Scaffold the workspace at CWD (single-repo-retrofit flow without preserving existing CLAUDE.md, since CWD typically doesn't have one). Populate `household.json`'s `repos[]` with the selected siblings. Workspace name defaults to CWD basename.

   The scaffold and commit flow differs slightly between the two KB topologies.

   **If inline KB:**

   ```bash
   # After scaffolding the workspace files (lore/ included)...
   SELECTED="<comma-separated names from sibling AskUserQuestion answer>"
   SELECTED="$SELECTED" node -e "
       const fs = require('fs');
       const path = './household.json';
       const m = JSON.parse(fs.readFileSync(path, 'utf8'));
       const names = process.env.SELECTED.split(',').filter(Boolean);
       for (const name of names) {
           m.repos.push({ name });
       }
       fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
   "
   git init -b main && git add -A && git commit -m "wrap existing siblings in a witan-household meta-repo"
   ```

   **If sibling KB:**

   ```bash
   # After scaffolding the workspace files...
   SELECTED="<comma-separated names from sibling AskUserQuestion answer>"
   SELECTED="$SELECTED" node -e "
       const fs = require('fs');
       const path = './household.json';
       const m = JSON.parse(fs.readFileSync(path, 'utf8'));
       const names = process.env.SELECTED.split(',').filter(Boolean);
       for (const name of names) {
           m.repos.push({ name });
       }
       fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
   "

   # The template .gitignore uses an allowlist pattern (/* then !/lore/);
   # remove the !/lore/ line so the catch-all /* gitignores lore/ from the
   # workspace meta-repo BEFORE the initial commit.
   if grep -q '^!/lore/$' .gitignore 2>/dev/null; then
       grep -v '^!/lore/$' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
   fi

   git init -b main && git add -A && git commit -m "wrap existing siblings in a witan-household meta-repo (sibling KB)"

   # Initialize lore/ as its own sibling repo:
   (cd lore && git init -b main && git add -A && git commit -m "initial KB from witan-household template")
   ```

4. Report. Note that the siblings' `.git/` histories are unchanged. If sibling KB was chosen, also tell the user how to publish it:

   > "Sibling KB initialized at `<workspace>/lore/` as its own git repo. To publish it as a GitHub repo:
   > ```
   > cd lore
   > gh repo create <org>/lore --private
   > git remote add origin git@github.com:<org>/lore.git
   > git push -u origin main
   > ```
   > Then back in the workspace, update `household.json`'s `lore` entry's `url` field with the new remote and commit."

#### Already-a-workspace

1. Print: "This directory is already a witan-household (household.json exists). For status, run `/lore:help`. For diagnostics, run `/lore:doctor`."
2. Exit without changes.

#### Refused

1. Print the refusal reason from the detection context.
2. Suggest: `mkdir <name> && cd <name> && /lore:init`.
3. Exit without changes.

## Notes

- Most scaffold flows end with a single commit. The poly-repo-retrofit sibling-KB path is the exception: it produces one commit on the workspace meta-repo and one in `lore/`'s new git history. The user can amend or split before pushing.
- For greenfield and files-no-git, the script clones the witan-household template fresh each time. For air-gapped environments, the user can manually `git clone` the template once and pass its local path to a future invocation (not implemented in v1).
- The single-repo-retrofit MERGES the workspace's `.gitignore` into the existing one rather than overwriting. The user should review the result.
- The sibling-KB option is only offered in poly-repo-retrofit. Greenfield/files-no-git/single-repo-retrofit/docs-migration always scaffold inline; users can convert to sibling later via `./scripts/split-lore.sh` from the witan-household template.
