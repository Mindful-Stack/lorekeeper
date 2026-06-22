---
description: Interactive onboarding walkthrough for new team members. Guides through repo setup, system architecture, and codebase exploration.
---

# Onboard Command

Interactive onboarding for developers joining the team. This command is data-driven and adapts to whatever repos and architecture are defined in the knowledge base.

## Usage

```
/lore:onboard              # Interactive - asks role, shows menu
/lore:onboard backend      # Skip role question, backend path
/lore:onboard frontend     # Skip role question, frontend path
/lore:onboard fullstack    # Skip role question, fullstack path
```

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers into the session context, listed in **priority order from lowest to highest**. It also injects a `Team knowledge path:` marker — the team's writable KB.

When `<knowledge-path>` appears below, it refers to **any** of the configured knowledge paths. For `general/repo-map.md`, look in each path in priority order (highest first); the team KB may override a shared KB's map. The knowledge repo root for each path is the parent directory of `knowledge/`.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## Repos Gate

Before proceeding, locate the repos catalog. Resolve it in this order:

1. **`household.json` walk-up** — walk up from the current working directory looking for a `household.json` file (bounded to ~6 levels). If found and it has a non-empty `repos` array, use that as the catalog.
2. **Legacy `repos_catalog`** — read `knowledge.config.json` from the team KB repo root (parent of the `Team knowledge path:`). If it has a `repos_catalog` field, read the file it points to (relative to the KB repo root).

If neither resolves:

```
The /lore:onboard command requires a repos catalog.

Either run /lore:onboard from inside a witan-household (household.json lists the repos),
or add `repos_catalog` to your knowledge base's knowledge.config.json pointing to a repos.json file.

Then re-run /lore:onboard.
```

Stop here.

## Data Files

The command uses two data sources:

1. **Repos catalog** — `household.json`'s `repos` array, or the legacy `repos_catalog` file (see Repos Gate above)
2. **`<knowledge-path>/general/repo-map.md`** - architecture overview and starter packs (if it exists)

## Implementation

### Step 1: Load Data

1. Resolve the repos catalog (see Repos Gate above)
2. Read `<knowledge-path>/general/repo-map.md` if it exists
3. Parse repos data: extract names, descriptions, roles, tags, starter flags, clone URLs (tolerate missing fields — household.json entries may only carry name and url)
4. When the catalog comes from `household.json`, exclude the entries named by `meta_repo` and `knowledge_base` — they are infrastructure, not code repos to onboard into

### Step 2: Detect Context

Determine where the command is being run:

1. Check if current directory contains multiple repo folders (parent folder mode)
2. Or if we're inside a single repo (single repo mode)

### Step 3: Check Which Repos Are Present

Use Glob to detect which repos from the catalog exist locally:

```
For each repo in the catalog:
  - Check if {repo.name}/ directory exists (parent folder mode)
  - Or check if current directory is that repo (single repo mode)
```

Build a list of present and missing repos.

### Step 4: Ask Role (if not provided as argument)

If no argument was provided, use AskUserQuestion:

```
Welcome! Let's get you set up.

What's your situation?
```

Options:
1. New to the team (backend focus)
2. New to the team (frontend focus)
3. New to the team (fullstack)
4. Returning after time away
5. Just exploring / asking questions

### Step 5: Show Tailored Menu

Based on role, present a menu using AskUserQuestion. Build the menu dynamically from the repos catalog:

```
Here's what I'd suggest for you:
```

**For each role**, generate menu items from repos data:
- Check your setup (X/Y starter repos present)
- System architecture overview (from repo-map.md if available)
- Deep dive into repos tagged with the user's role (dynamically generated from catalog)
- Ask me anything

Example for a backend role (generated from repos where `roles` includes "backend" and `starter` is true):
- Check your setup (X/Y starter repos present)
- System architecture overview
- Deep dive: {repo.name} ({repo.description}) — for each starter repo matching role
- Ask me anything

**For returning/exploring:**
- Check your setup
- System architecture overview
- Ask me anything

### Step 6: Execute Menu Choice

#### Choice: Check Your Setup

Show which repos are present and missing. Generate dynamically from repos catalog:

```markdown
Detecting repos in current directory...

For each repo matching the user's role:
  Show: ✓ {repo.name}  Present    OR    ✗ {repo.name}  Missing

You have X/Y starter repos for your role.
```

If there are missing repos with valid clone URLs, show clone commands:

```
To clone missing repos:

  git clone {repo.url}
```

Then offer next steps:
- Continue with architecture overview
- Deep dive into a repo you have
- Ask me anything

#### Choice: System Architecture Overview

If `<knowledge-path>/general/repo-map.md` exists, Read and present it.

Provide a high-level explanation of how the repos relate to each other, based on the repos catalog descriptions and tags.

Then offer to drill deeper:

```
Want to learn more about a specific repo? Pick one:
```

List repos that are present locally.

#### Choice: Deep Dive into Repo

For each repo, provide a three-part guided tour. Generate the content dynamically by exploring the actual repo:

**Part 1: Structure**

Navigate to the repo and show key directories:

```markdown
## {repo.name} Structure

Use Glob to discover the directory structure.
Show the top-level layout with brief descriptions.

Key files to know:
- [Discovered entry points, config files, etc.]
```

After: "Continue to patterns, or ask questions?"

**Part 2: Patterns**

Read the repo's `CLAUDE.md` and `docs/standards/` if they exist. Show key patterns:

```markdown
## {repo.name} Patterns

[Summarize architecture patterns found in CLAUDE.md and standards docs]
[Show how the repo implements key patterns]
```

After: "Continue to workflow, or ask questions?"

**Part 3: Workflow**

Show how to work in this repo, sourced from the repo's `CLAUDE.md`:

```markdown
## {repo.name} Workflow

### Setup
[Commands from CLAUDE.md]

### Making Changes
[Workflow steps from CLAUDE.md or standards docs]

### Key Commands
[Build, test, lint commands from CLAUDE.md]
```

After: "That's the {repo.name} tour! What would you like to do next?"

#### Choice: Ask Me Anything

Route questions through the pattern-identifier skill:

```markdown
Ask me anything about the codebase, architecture, or how we do things.

I'll check our knowledge base first, then the codebase if needed.
```

When answering, use the pattern-identifier skill to search knowledge and provide sources.

After each answer, add onboarding-specific suggestions:

```markdown
---

Since you're onboarding, you might also want to explore:
- [Contextual suggestion based on what they asked]
- [Another relevant topic]
```

## Navigation

At any point, the user can:
- Ask a question (routes to pattern-identifier)
- Say "menu" to return to the main menu
- Say "skip" to skip ahead in a deep dive
- Say "exit" to end the onboarding session

## Important Notes

1. **Use AskUserQuestion** for all menus and choices
2. **Use lots of ASCII diagrams** - they help visual learners
3. **Keep explanations concise** - link to deeper knowledge rather than dumping text
4. **Be interactive** - check in after each section, don't monologue
5. **Leverage pattern-identifier** for Q&A mode - don't reinvent the wheel
6. **Remember the user's role** - tailor suggestions throughout the session
7. **Everything is data-driven** - never hardcode repo names, URLs, or architecture descriptions
