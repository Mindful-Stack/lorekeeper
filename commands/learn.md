---
description: Capture a learning from the current conversation. Use when you discover a gotcha, edge case, or non-obvious behaviour worth remembering.
---

# Learn Command

Capture tribal knowledge as a learning in the shared knowledge base.

## Usage

```
/lore:learn [description]
```

If no description provided, extract the learning from recent conversation context.

## Examples

```
/lore:learn EF Core doesn't lazy-load Device-Listener relationship
/lore:learn Inventory integration times out on payloads over 5MB
/lore:learn
```

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers (read sources, priority order lowest -> highest) and a `Team knowledge path:` marker (the team's writable KB).

When `<knowledge-path>` appears below:
- In **read/search contexts**: iterate over all `Knowledge path:` markers.
- In **write contexts** (proposed file paths, paths passed to knowledge-updater): always use the `Team knowledge path:` — learnings are team-owned and never go to shared KBs.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## Steps

### 1. Extract the Learning

If description provided, use it as the basis. If not, review the recent conversation for non-obvious discoveries, gotchas, or edge cases.

### 2. Draft the Learning File

Generate a learning file with this format:

```markdown
---
title: "[Concise description of the learning]"
tags: [domain-tag, tech-tag, concept-tag]
confidence: verified
source: developer-input
date: YYYY-MM-DD
---

[Free-form explanation of the learning. Explain the what, why, and
when-it-matters naturally. Keep it concise — a paragraph or a few
bullets is ideal.]
```

**Tag conventions:**
- Domain tags should match domain file slugs (e.g., `payments`, `inventory-integration`)
- Technology tags should match framework/language directory names (e.g., `dotnet`, `react`, `typescript`)
- Add concept tags for cross-cutting concerns (e.g., `performance`, `security`, `integration`)

**Filename:** Generate a descriptive slug from the title (e.g., `ef-core-device-listener-eager-loading.md`). Lowercase, hyphens, no dates in filename.

### 3. Present Draft to Developer

Show the complete file to the developer:

> **Proposed Learning**
>
> **File:** `<knowledge-path>/learnings/{filename}.md`
>
> ```markdown
> [complete file contents]
> ```
>
> Does this look right? I can adjust the title, tags, confidence, or body before saving.

### 4. Apply (If Confirmed)

Dispatch the **knowledge-updater** agent with:
- **Type:** `learning`
- **Content:** The approved learning file content from Step 3
- **Action:** `create`

The agent handles branching, writing the file, rebuilding the index, committing, and creating the PR.

Wait for the agent to return the PR URL.

### 5. Confirm

Show the PR URL returned by the knowledge-updater agent:

> Learning captured and PR created: {pr-url}

## Important Rules

1. **Always get developer approval** before writing the file
2. **Set confidence to `verified`** for developer-initiated learnings (they're confirming it's true)
3. **Set source to `developer-input`**
4. **Use today's date** for the date field
5. **Always create a branch and PR** — never commit directly to main
6. **Rebuild the index** after writing the file
