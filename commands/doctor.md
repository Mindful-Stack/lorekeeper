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

The SessionStart hook sets one or more `Knowledge path:` markers in the system message, plus a `Team knowledge path:` marker (the team's writable KB). Use the **team** knowledge path for the per-KB checks below. The workspace root is the parent directory of `<knowledge-path>` (i.e. `<knowledge-path>/..`).

If no knowledge path is set, tell the user: "No knowledge base configured. Run /lore:init or set KNOWLEDGE_BASE_PATH."

### Step 2: Invoke the doctor tool

```bash
node <workspace-root>/lore/_tools/cli.js doctor --dir <workspace-root>/lore/knowledge
```

Capture stdout and stderr. The tool exits 0 if all checks pass, 1 if any errors were found.

### Step 2b: Validate shared knowledge bases (multi-KB households)

Read `household.json` from the household root (walk up from CWD if needed). If it declares a `shared_knowledge_bases` array, check each entry with native tools:

1. **Manifest cross-check** — the entry matches a `repos[].name`. If not: error, suggest adding the repo entry (with a `url` so `make setup` clones it) or removing the name from `shared_knowledge_bases`.
2. **Presence** — `<household-root>/<name>/` exists. If not: error, suggest `make setup`.
3. **Shape** — `<household-root>/<name>/knowledge/` exists. If not: error — the directory is not a knowledge base; the SessionStart hook will skip it.
4. **Index** — `<household-root>/<name>/knowledge/_index.json` exists. If not: warning, suggest running the KB's own index build (e.g. `make build-index` inside that repo).

Also warn if an entry duplicates `knowledge_base` (the team KB must not be listed as shared — it would be read twice).

Skip this step entirely when `household.json` is absent or has no `shared_knowledge_bases` — single-KB setups stay silent.

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
