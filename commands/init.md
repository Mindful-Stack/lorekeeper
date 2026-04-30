---
description: Scaffold a fresh knowledge base from the bundled template by invoking the init-knowledge-base script.
---

# Init Command

Create a fully-equipped knowledge base from the bundled template.

## Usage

```
/lore:init                    # Default target: ./shared-knowledge
/lore:init <target-path>      # Custom target
```

## Implementation

When this command is invoked:

1. **Resolve target path:**
   - If the user provided an argument, use it as `<target>`.
   - Otherwise, default to `./shared-knowledge` relative to the current working directory.

2. **Invoke the init script:**
   Use the Bash tool:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/init-knowledge-base.js --target <target>
   ```

3. **On success (exit code 0):** display the script's output verbatim. The script prints next-step instructions including how to wire up `KNOWLEDGE_BASE_PATH` or `.lorekeeper/config.json`.

4. **On conflict (exit code 1 with "already has" in output):** explain the conflict and suggest either:
   - Picking a different `<target-path>`, or
   - Removing the conflicting files (the script lists them).

5. **Offer to set up `.lorekeeper/config.json`** if the user agrees:
   - Create `.lorekeeper/` directory in the current project root if missing
   - Write `.lorekeeper/config.json` with `{ "knowledgeBasePath": "<absolute-target-path>" }`
   - Tell the user to restart Claude Code

## Notes

- The script is deterministic — it does **not** top up partial structures.
- The bundled template includes its own validation/index tooling. After init, the user runs `make build-index` (or `npm run build-index`) inside the new knowledge-base directory.
