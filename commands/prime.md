---
description: Load domain knowledge before working on a business area. Discovers available domains dynamically from the knowledge index.
---

# Prime Command

Load knowledge files into conversation context. Supports domain keywords for quick access and exact paths for any file in the knowledge base.

## Usage

If no arguments provided, show this help:

```
Load knowledge into your conversation context.

USAGE:
  /lore:prime <keyword>           Load by domain keyword
  /lore:prime <keyword> <keyword> Load multiple domains
  /lore:prime <path/to/file>      Load by exact path (contains /)
  /lore:prime domains             List all available domains

DOMAIN KEYWORDS:
  Discovered dynamically from the knowledge index.
  Run `/lore:prime domains` to see what's available.

PATH EXAMPLES:
  /lore:prime domain/my-context
  /lore:prime frameworks/react/hooks-conventions
  /lore:prime general/pr-guidelines

EXAMPLES:
  /lore:prime auth
  /lore:prime notifications api-design
  /lore:prime domain/my-context

DISCOVER:
  /lore:explore                    Browse and search the knowledge base
```

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers into the session context, listed in **priority order from lowest to highest** (when the same relative path exists in multiple KBs, the higher-priority file replaces the lower-priority one entirely — no section-level or paragraph-level merging). It also injects a `Team knowledge path:` marker — the team's writable KB.

When `<knowledge-path>` appears below, it refers to **any** of the configured knowledge paths:
- Reading `_index.json`: read each path's `_index.json` and merge results (dedup by node path; later KB wins on conflict).
- Resolving a `domain/...` argument: search all paths' domain nodes for matches.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## Domain Discovery

The prime command does NOT use a hardcoded domain list. Instead it discovers domains dynamically.

### For `domains` argument:
Read `<knowledge-path>/_index.json`, filter nodes where `category` is `domain`, list them with titles and descriptions.

### For keyword arguments (no `/` in argument):
1. Read `<knowledge-path>/_index.json`
2. For each argument, search domain nodes by:
   - Exact filename match (e.g., argument `auth` matches node path `domain/auth-user-management`)
   - Title contains keyword (case-insensitive)
   - Tags contain keyword
   - Keywords array contains keyword
3. If exactly one match, load it
4. If multiple matches, show them and ask user to pick
5. If no domain match, fall back to grep search across all knowledge files

## Steps

### 1. Check for Arguments

If no arguments provided, display the help text above and stop.

### 2. Handle `domains` Option

If argument is `domains`, use the Read tool to load `<knowledge-path>/_index.json` and filter nodes where `category` is `domain`. List available domain files with their titles.

### 3. Load Files

For each argument provided:

**If argument is a keyword (no `/`) -> dispatch knowledge-reader:**
1. Read `<knowledge-path>/_index.json`
2. Search domain nodes using the matching rules from Domain Discovery above
3. If exactly one match: dispatch **knowledge-reader** agent with:
   "Load all knowledge for the {domain-name} domain. Include domain context, relevant standards, and learnings."
4. If multiple matches: list them and ask the user to pick
5. If no match found: dispatch **knowledge-reader** with:
   "Find any knowledge relevant to: {keyword}"

**If argument contains `/` -> dispatch knowledge-reader with path hint:**
Dispatch **knowledge-reader** agent with:
"Load knowledge from {path}. Include related learnings."

### 4. Output Format

The knowledge-reader agent returns a structured summary. Present it to the user as-is — the reader's output format (Context Summary, Standards & Patterns, Gotchas & Learnings, Sources) is designed for consumption.

If the reader returns no results, display:
```
No knowledge found for "{argument}". Use `/lore:explore` to browse available files.
```
