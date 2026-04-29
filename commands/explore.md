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

## Knowledge Path

The knowledge base path is provided by the SessionStart hook. Look for "Knowledge path:" in the
session context — that is the absolute path to the knowledge directory.

All file references below use `<knowledge-path>` as a placeholder. Replace it with the actual
path from the session context when using Read, Glob, or Grep tools.

If the session says KNOWLEDGE_BASE_PATH is not set, tell the user:
"Set the KNOWLEDGE_BASE_PATH environment variable to the path of your knowledge base repo clone
and restart Claude Code."

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
