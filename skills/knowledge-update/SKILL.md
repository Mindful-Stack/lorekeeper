---
name: knowledge-update
description: >
  Suggest updates to the team knowledge base when information is wrong, outdated, or missing.
  Also detects non-obvious discoveries that should be captured as learnings.
  Use when you notice knowledge gaps, incorrect documentation, when the user says something
  should be documented, or when review feedback reveals missing guidelines.

  When detecting an issue, decide which action to propose:
  - "The docs say Y but it should say Z" → propose a doc correction (existing update flow)
  - "I discovered X that isn't documented anywhere" → propose a learning (new tribal knowledge)
---

# Knowledge Update

Propose updates to the shared-knowledge repository when issues are noticed.

## When to Use This Skill

- You notice knowledge is outdated or incorrect
- User says "this should be documented" or "the docs are wrong"
- You discover a pattern/convention not captured in knowledge
- A domain concept is missing or incomplete
- Review feedback reveals a missing guideline
- User asks to add something to the knowledge base

## Decision: Doc Update vs Learning

When this skill triggers, first decide which type of knowledge change to propose:

### Doc Correction (existing flow)
The knowledge base has content that is **wrong or outdated**. This modifies existing files.
- A standard or pattern description is incorrect
- A domain context file is missing an entity or integration point
- A framework pattern has changed

→ Continue with the existing update flow below.

### Learning (new tribal knowledge)
You discovered something **not documented anywhere**. This creates a new file in `learnings/`.
- Non-obvious root cause discovered during debugging
- Gotcha or edge case that contradicts expectations from the docs
- Undocumented integration quirk
- Behaviour that's correct but surprising

→ Ask the developer: "This seems like a useful learning — want to capture it?"
  - If yes: follow the `/lore:learn` command flow (draft, review, approve, branch, PR)
  - If no: move on, no further prompting

**Key constraint:** The agent never commits without the developer seeing and approving the draft.

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers (read sources, priority order lowest -> highest) and a `Team knowledge path:` marker (the default writable KB).

When `<knowledge-path>` appears below:
- In **search/read contexts**: iterate over all `Knowledge path:` markers to find existing content.
- In **write contexts**: all KBs accept changes via PR — including shared KBs owned by other teams.
  - **Edits**: the proposed file path should be the file's actual location (whichever KB it lives in). knowledge-updater will route the PR to the right repo.
  - **New team-flavored content** (learnings, domain): default to the team KB.
  - **New cross-cutting content** (`general/`, `languages/`, `frameworks/`): if multiple KBs are configured, ask the user where it belongs ("This is a shared standard — propose to the shared KB or to your team KB?"), then pass the chosen path to knowledge-updater.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## How to Propose Updates

### Step 1: Identify the Change Type

| Type | Action |
|------|--------|
| New knowledge | Create new file |
| Correction | Edit existing file |
| Addition | Add section to existing file |
| Restructure | Multiple file changes |

### Step 2: Find the Right File

Use Grep to search existing knowledge:
- Pattern: `<topic keywords>`
- Path: `<knowledge-path>/`
- Glob: `*.md`

Also grep the frontmatter: `^(title|description|tags|keywords):.*<topic>` with `-i`. A
frontmatter hit means the node is *about* the topic; a body hit may only mean it mentions it.

### Step 3: Draft the Change

**For new files**, use the knowledge template:
```markdown
---
title: [Title]
description: [One-line description, max 300 chars]
tags: [tag1, tag2]
---

# [Title]

## Summary
2-3 sentences for quick consumption.

## Details
Full content...

## See Also
- [[related-node]]
```

**For edits**, show a diff-style proposal:
```diff
File: <knowledge-path>/domain/my-context.md

Add after "## Key Entities":

+ - **NewEntity** - Description of the new entity
```

### Step 4: Determine Location

Recommend appropriate directory:

| Content Type | Directory |
|--------------|-----------|
| Cross-repo standards | `general/` |
| TypeScript/C# rules | `languages/{lang}/` |
| React/.NET/Svelte patterns | `frameworks/{framework}/` |
| Business domain contexts | `domain/` |

### Step 5: Present to User

Always get confirmation before making changes:

> **Proposed Knowledge Update**
>
> **File:** `<knowledge-path>/domain/my-context.md`
> **Type:** Addition
> **Reason:** Discovered missing entity during code review
>
> ```diff
> + ## New Section
> + Content here...
> ```
>
> Would you like me to:
> 1. Apply this change and create a branch
> 2. Just show you the change (copy/paste yourself)

### Step 6: Apply (If Confirmed)

Dispatch the **knowledge-updater** agent with:
- **Type:** The knowledge type (`learning` for new learnings, `standard`/`domain`/`adr` for doc corrections)
- **Content:** The approved content from Step 5
- **Action:** `create` for new files, `update` for modifications
- **File path:** For updates, the path to the file being modified

The knowledge-updater agent handles:
- Creating a branch
- Writing/modifying the file
- Committing
- Creating a PR

Wait for the agent to return the PR URL, then show it to the developer.

## Important Rules

1. **Never auto-apply** - Always get user confirmation
2. **Show diffs** - Make it clear what will change
3. **Atomic changes** - One concept per update
4. **Follow conventions** - Use existing file structure and frontmatter
5. **Branch workflow** - Create a branch, don't commit to main
6. **Validate** - The knowledge-updater agent handles validation
