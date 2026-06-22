---
description: Discover what's in the knowledge base. List nodes, filter by category, or search for topics.
---

# Explore Command

Discover available knowledge without loading full files into context.

## Usage

```
/lore:explore [category-or-query]
```

## Examples

```
/lore:explore                     # List all nodes grouped by category
/lore:explore domain              # List nodes in the domain category
/lore:explore frameworks          # List nodes in the frameworks category
/lore:explore error-handling      # Search for "error-handling"
```

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers into the session context, listed in **priority order from lowest to highest** (when the same relative path exists in multiple KBs, the higher-priority file replaces the lower-priority one entirely — no section-level or paragraph-level merging). It also injects a `Team knowledge path:` marker — the team's writable KB.

When `<knowledge-path>` appears below, it refers to **any** of the configured knowledge paths:
- Reading `_index.json`: read each path's `_index.json` and merge results.
- Grepping across `**/*.md`: run one Grep per path and combine results.
- For category listing: iterate all paths and aggregate nodes per category.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## Implementation

### No Arguments -> List All

If no arguments provided, use the Read tool to load `<knowledge-path>/_index.json`.

Parse the JSON and display nodes grouped by category:

```
## Knowledge Base

### domain/
- my-context - Description of domain context
- another-context - Another domain description
- ...

### frameworks/
- react/hooks-conventions - React hooks patterns
- ...

### general/
- pr-guidelines - Pull request standards
- ...

### languages/
- typescript/code-style - TypeScript conventions
- ...
```

Use the `title` and `description` from each node in the index.

### Argument Matches Category -> List That Category

If the argument is one of: `domain`, `frameworks`, `languages`, `general` -- Read `<knowledge-path>/_index.json` and filter nodes where `category` matches the argument.

### Anything Else -> Search

Use Grep to search knowledge files:
- Pattern: `{query}` (the user's argument, as a regex)
- Path: `<knowledge-path>/`
- Glob: `*.md`

Also check `<knowledge-path>/_index.json` for matches in title, description, and tags.

Review matches and select the most relevant files based on context. Display matching files as a simple list:
- File path
- Title
- Brief description

### Always End With

After any output, append:

```
Use `/lore:prime <topic>` to load any of these into context.
```
