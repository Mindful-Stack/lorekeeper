---
description: Show available commands, verify setup, and provide onboarding help for the lorekeeper plugin.
---

# Lorekeeper Help

Display plugin status, available commands, and setup instructions.

## Usage

```
/lore:help
```

## Implementation

When this command is invoked, perform these steps:

### Step 1: Check Knowledge Base Status

Look for "Knowledge path:" in the session context. The SessionStart hook resolves the path from the `KNOWLEDGE_BASE_PATH` environment variable.

If the session context contains "Knowledge path:", the knowledge base is configured.
If the session context says "KNOWLEDGE_BASE_PATH is NOT set", it is not configured.

### Step 2: Display Status

**If the knowledge base is configured:**
```
## Lorekeeper Status

Knowledge base found. Path shown in session context.
```

**If NOT configured:**
```
## Lorekeeper Status

Knowledge base NOT configured.

### Setup Instructions

Set the `KNOWLEDGE_BASE_PATH` environment variable to the absolute path of your
knowledge base repo clone:

```bash
# Windows (PowerShell) - add to your profile
$env:KNOWLEDGE_BASE_PATH = "C:/Users/you/Source/your-project/shared-knowledge"

# Windows (System Environment Variables)
# Settings > System > About > Advanced system settings > Environment Variables
# Add: KNOWLEDGE_BASE_PATH = C:/Users/you/Source/your-project/shared-knowledge

# macOS/Linux - add to ~/.bashrc or ~/.zshrc
export KNOWLEDGE_BASE_PATH="/home/you/source/your-project/shared-knowledge"
```

Then restart Claude Code for the change to take effect.

The path should point to the root of the knowledge base repository clone:
```
your-knowledge-repo/
├── knowledge/
│   ├── adrs/
│   ├── domain/
│   ├── frameworks/
│   ├── general/
│   ├── languages/
│   └── learnings/
└── ...
```
```

### Step 3: Show Available Commands

Always display available commands:

```
## Available Commands

| Command | Description |
|---------|-------------|
| `/lore:cultivate` | Cultivate a bounded-context domain — with arg: bootstrap/refine/audit; without arg: discover candidates + audit existing |
| `/lore:doctor` | Run full workspace + KB diagnostic |
| `/lore:explore [query]` | Browse and search knowledge nodes |
| `/lore:help` | This help message |
| `/lore:init` | Adopt witan in this directory (detects greenfield / existing repo / poly-repo and dispatches) |
| `/lore:learn [description]` | Capture a learning (gotcha, edge case, non-obvious behaviour) |
| `/lore:onboard` | Interactive onboarding walkthrough for new team members |
| `/lore:prime <topic>` | Load knowledge into context (keywords or paths) |
| `/lore:review` | Review PR/code using team standards |
| `/lore:update` | Propose updates to the knowledge base |

## Knowledge Categories

| Category | Directory | Description |
|----------|-----------|-------------|
| General | `general/` | Cross-repo standards |
| Languages | `languages/` | Language-specific rules |
| Frameworks | `frameworks/` | Framework-specific patterns |
| Domain | `domain/` | Business domain contexts |
| Learnings | `learnings/` | Team-captured gotchas, edge cases, and tribal knowledge |
| ADRs | `adrs/` | Architecture Decision Records (exported from Confluence) |

## Available Skills (Auto-Triggered)

| Skill | Triggers When |
|-------|---------------|
| `pattern-identifier` | Questions about standards, patterns, conventions ("how do we...", "should I...") |
| `brainstorming` | Creative work — features, components, new functionality |
| `writing-plans` | Multi-step tasks with spec/requirements |
| `executing-plans` | Executing a written implementation plan |
| `test-driven-development` | Implementing any feature or bugfix (default for all work) |
| `systematic-debugging` | Bug, test failure, or unexpected behaviour |
| `verification-before-completion` | Claiming work is complete or fixed |
| `subagent-driven-development` | Independent tasks from a plan (same session) |
| `dispatching-parallel-agents` | Multiple independent problems (e.g., unrelated test failures) |
| `knowledge-update` | Outdated or missing knowledge detected |
| `review` | User asks to review PR, code, or changes |

## Quick Start

1. **New to the team?** → `/lore:onboard`
2. **Need domain context?** → `/lore:prime <your-domain>`
3. **Looking for something?** → `/lore:explore <topic>`
4. **Review your work?** → `/lore:review`
```
