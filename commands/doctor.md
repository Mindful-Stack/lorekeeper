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
node <workspace-root>/lore/_tools/cli.js doctor --dir <workspace-root>/lore/knowledge
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
