---
description: Propose an update to the team knowledge base. Use to add, correct, or improve documentation.
---

# Update Knowledge Command

Explicitly propose a knowledge base update.

## Usage

```
/lore:update <description>
```

## Examples

```
/lore:update Add authentication patterns to auth context
/lore:update Fix incorrect API design description
/lore:update Document the new OrderCreatedEvent entity
/lore:update Add React Query patterns to react knowledge
```

## Knowledge Path

The knowledge base path is provided by the SessionStart hook. Look for "Knowledge path:" in the
session context — that is the absolute path to the knowledge directory.

All file references below use `<knowledge-path>` as a placeholder. Replace it with the actual
path from the session context when using Read, Glob, or Grep tools.

If the session says KNOWLEDGE_BASE_PATH is not set, tell the user:
"Set the KNOWLEDGE_BASE_PATH environment variable to the path of your knowledge base repo clone
and restart Claude Code."

## Steps

### 1. Search Existing Knowledge

Use Grep to search knowledge files for the topic:
- Pattern: `<keywords from description>`
- Path: `<knowledge-path>/`
- Glob: `*.md`

Also check `<knowledge-path>/_index.json` for matches in title, description, and tags to find related files.

### 2. Determine Update Type

| Type | When to Use |
|------|-------------|
| **New file** | Topic doesn't exist |
| **Edit existing** | Topic exists but needs changes |
| **Add section** | Topic exists, adding new content |

### 3. Draft the Change

**For new files**, use the template:
```markdown
---
title: [Title]
description: [Brief description, max 300 chars]
tags: [relevant, tags]
---

# [Title]

## Summary
2-3 sentences for quick consumption.

## Details
Full content here...

## See Also
- [[related-node]]
```

**For edits**, show diff:
```diff
File: <knowledge-path>/domain/my-context.md

+ ## New Section
+ New content here...
```

### 4. Determine Location

| Content Type | Directory |
|--------------|-----------|
| Cross-repo standards | `general/` |
| TypeScript rules | `languages/typescript/` |
| C# rules | `languages/csharp/` |
| React patterns | `frameworks/react/` |
| .NET patterns | `frameworks/dotnet/` |
| Svelte patterns | `frameworks/svelte/` |
| Business domain | `domain/` |

### 5. Present and Confirm

Show the user exactly what will change:

> **Proposed Knowledge Update**
>
> **File:** `<knowledge-path>/domain/my-context.md`
> **Type:** Addition
> **Reason:** [from user description]
>
> ```diff
> + [changes]
> ```
>
> Options:
> 1. Apply and create branch
> 2. Show content only (copy/paste yourself)

### 6. Apply Changes (if confirmed)

Dispatch the **knowledge-updater** agent with:
- **Type:** The knowledge type (`standard`/`domain`/`adr` for doc corrections)
- **Content:** The approved content from Step 5
- **Action:** `create` for new files, `update` for modifications
- **File path:** For updates, the path to the file being modified

The knowledge-updater agent handles:
- Creating a branch
- Writing/modifying the file
- Rebuilding the index
- Committing
- Creating a PR

Wait for the agent to return the PR URL, then show it to the developer.

## Important Rules

1. **Always confirm** - Never auto-apply changes
2. **Show diffs** - Make changes clear
3. **One concept per update** - Keep changes atomic
4. **Follow conventions** - Use existing structure
5. **Branch workflow** - Never commit directly to main
6. **Validate** - The knowledge-updater agent handles validation
