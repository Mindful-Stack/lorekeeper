---
description: Initialize a knowledge base in the current project. Scaffolds directory structure, starter templates, and configuration.
---

# Init Command

Scaffold a knowledge base directory in the current project.

## Usage

```
/lore:init
```

## Implementation

### Step 1: Check if knowledge base already exists

Look for existing knowledge indicators:
- `docs/knowledge/` directory
- `docs/shared-knowledge/` directory
- `knowledge/` directory in current directory
- `knowledge.config.json` in current directory

If found: "A knowledge base already appears to exist at {path}. Use `/lore:explore` to browse it."

### Step 2: Ask setup questions

Use AskUserQuestion:

**Question 1:** "Where should the knowledge base live?"
- `docs/knowledge/` (recommended - inside this project)
- Current directory (for a standalone knowledge repo)

### Step 3: Scaffold structure

Based on the answer, create:

```
{target}/
├── knowledge/
│   ├── general/
│   │   └── _starter.md      # Example general standards node
│   ├── domain/
│   │   └── _starter.md      # Example domain context node
│   ├── languages/
│   │   └── _starter.md      # Example language node
│   └── frameworks/
│       └── _starter.md      # Example framework node
└── knowledge.config.json
```

Use the Write tool to create each file. The starter files should contain valid frontmatter and helpful comments explaining what belongs in each category.

### Step 4: Build initial index

Use the Read tool to check if `npx lorekeeper build-index` is available, or manually create a minimal `_index.json` with just the starter files.

### Step 5: Show next steps

```
Knowledge base initialized at {target}/

Next steps:
1. Set the KNOWLEDGE_BASE_PATH environment variable:
   export KNOWLEDGE_BASE_PATH="/absolute/path/to/{target}"

2. Restart Claude Code for the plugin to detect the knowledge base

3. Start adding knowledge:
   - Add your domain contexts to knowledge/domain/
   - Add coding standards to knowledge/general/
   - Add language-specific guidelines to knowledge/languages/
   - Add framework patterns to knowledge/frameworks/

4. Use /lore:explore to browse your knowledge base
5. Use /lore:prime <domain> to load domain context
```

## Important Notes

1. **Use Write tool** for all file creation - no bash scripts
2. **Use AskUserQuestion** for interactive choices
3. **Never overwrite** existing files without asking
4. The starter files should be named `_starter.md` (underscore prefix) so they're treated as entry points, not regular nodes
