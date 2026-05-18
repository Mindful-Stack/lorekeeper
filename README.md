# Lorekeeper — Claude Code Plugin

A Claude Code plugin that provides intelligent access to a team's knowledge base.

## Features

- **Domain Knowledge**: Load business domain context into conversation
- **PR Review**: Structured code review using team standards
- **Knowledge Search**: Fast search across all knowledge nodes
- **Pattern Identification**: Answer "how do we do X?" using docs-first approach
- **Update Proposals**: Suggest knowledge base improvements

## Setup

### 1. Install the Plugin

Lorekeeper is distributed via the [Witan marketplace](https://github.com/Mindful-Stack/witan). Inside Claude Code:

```text
/plugin marketplace add Mindful-Stack/witan
/plugin install lorekeeper@witan
```

### 2. Point at a Knowledge Base

The simplest setup is the **witan-household** workspace pattern — a meta-repo that bundles your code repos, devcontainer, and knowledge base together. Lorekeeper auto-discovers the `lore/` directory inside such a workspace via sibling-fallback; no env vars or config files needed.

```text
# Option A — start from the template repo (no Reeve required)
gh repo create my-workspace --template Mindful-Stack/witan-household
gh repo clone my-workspace
cd my-workspace
# Open Claude Code here; /lore:help reports "Knowledge base found"

# Option B — via Reeve (if you use it)
reeve household new my-workspace
```

Either gives you a workspace with `lore/knowledge/` populated from the starter template; Claude Code launched from the workspace root finds the KB automatically.

If you'd rather wire it up manually, Lorekeeper resolves the knowledge base path in this order:

1. **`.lorekeeper/config.json`** in the project root — `{ "knowledgeBasePath": "/abs/or/rel/path" }`. Best for per-project setups with custom paths.
2. **`KNOWLEDGE_BASE_PATH`** environment variable — best for a single global default that applies anywhere.
3. **Sibling-dir fallback** in CWD, first match wins:
   - `./lore` (canonical — witan-household)
   - `./docs/lore`
   - `./docs/shared-knowledge`, `./shared-knowledge`, `./knowledge` (legacy, kept for back-compat)

   Each candidate must contain either a `knowledge/` subdirectory or a `knowledge.config.json` to be recognised.

Setting the env var globally:

**Windows (System Environment Variables) — recommended:**
1. Settings > System > About > Advanced system settings > Environment Variables
2. Add: `KNOWLEDGE_BASE_PATH` = `C:/Users/you/source/my-workspace/lore` (or wherever your KB lives)

**Windows (PowerShell profile):**
```powershell
$env:KNOWLEDGE_BASE_PATH = "C:/Users/you/source/my-workspace/lore"
```

**macOS/Linux:**
```bash
export KNOWLEDGE_BASE_PATH="/home/you/source/my-workspace/lore"
```

**Optional:** Set `KNOWLEDGE_MAX_AGE_DAYS` to control the staleness warning threshold (default: 7 days).

### 3. Verify Setup

Restart Claude Code (env vars are read at startup), then:

```text
/lore:help
```

This shows plugin status and available commands. You should see "Knowledge base found" in the output.

## Commands

| Command | Description |
|---------|-------------|
| `/lore:help` | Show status and help |
| `/lore:init` | Detect workspace state and scaffold or retrofit accordingly |
| `/lore:cultivate` | Cultivate a bounded-context domain. With a name: bootstrap/refine/audit. Without: discover candidate domains in the codebase + audit existing ones |
| `/lore:doctor` | Run a full workspace + KB diagnostic (manifest validity, sibling presence, KB hygiene) |
| `/lore:onboard` | Interactive onboarding for new team members |
| `/lore:explore` | Browse and search knowledge |
| `/lore:prime` | Load knowledge into context |
| `/lore:review` | Review a PR or local changes |
| `/lore:update` | Propose knowledge updates |

### Init

Adopt witan in the current directory. The command detects state and dispatches:

```bash
/lore:init                # Detect CWD state, scaffold or retrofit accordingly
/lore:init <name>         # Override workspace name (otherwise inferred from CWD basename)
```

Scenarios it handles:

- **Greenfield** (empty dir): fresh witan-household scaffold.
- **Single-repo retrofit** (existing git repo): adds workspace files in place; existing code untouched.
- **Docs migration** (existing repo with `docs/`/`knowledge/`/`wiki/`): offers rename to `lore/knowledge/` or env-var override.
- **Poly-repo retrofit** (parent of multiple git repos): wraps them in a meta-repo.
- **Already-a-workspace**: refuses; suggests `/lore:help`.
- **Refused** (running in `$HOME` or `$HOME/Source`): suggests creating a dedicated dir first.

The bundled standalone-KB template flow (`/lore:init <path>` that scaffolds a separate repo) is gone — the witan-household pattern covers both standalone-Lorekeeper and Lorekeeper-with-Reeve use cases.

### Onboard

Interactive walkthrough for developers joining the team:

```bash
/lore:onboard              # Interactive - asks role, shows menu
/lore:onboard backend      # Skip role question, backend focus
/lore:onboard frontend     # Skip role question, frontend focus
/lore:onboard fullstack    # Skip role question, fullstack focus
```

Features:
- Detects which repos you have locally
- Shows which starter repos to clone for your role
- System architecture overview
- Deep dives into each repo (structure, patterns, workflow)
- Q&A mode using the knowledge base

### Prime

Load knowledge into conversation context:

```bash
/lore:prime                              # Show help and available domains
/lore:prime domains                      # List all domains
/lore:prime payments                         # Load a domain context
/lore:prime inventory user-management            # Load multiple domains
/lore:prime domain/payments-context          # Load by exact path
/lore:prime frameworks/react/hooks-conventions  # Load any knowledge file
```

### Review

Review code changes using team standards:

```bash
/lore:review                # Auto-detect PR or local changes
/lore:review pr             # Review current PR
/lore:review pr 123         # Review specific PR
/lore:review changes        # Review local changes vs main
/lore:review staged         # Review staged changes
```

### Explore

Browse and search knowledge files:

```bash
/lore:explore                              # List all knowledge nodes
/lore:explore domain                       # List domain knowledge
/lore:explore payments                         # Search for "payments"
```

### Update Knowledge

Propose updates to the knowledge base:

```bash
/lore:update Add password-reset flow to user-management context
```

### Cultivate

Cultivate a single bounded-context domain node:

```bash
/lore:cultivate <domain>      # work on a specific domain (e.g. /lore:cultivate grant-matching)
/lore:cultivate               # discover candidate domains + audit existing ones
```

**With a name argument**, the command detects the domain's current state and dispatches:

- **Bootstrap** (no doc exists): scans the codebase for entity + language candidates, walks you through DDD-shape Q&A, drafts a complete node, opens a PR.
- **Refine** (doc exists, missing canonical sections or has gaps): identifies missing sections + drift, walks you through per-suggestion [Apply]/[Skip] prompts, batches approved changes into one PR.
- **Audit** (mature doc): same loop as refine, focused on drift detection (terms in code not in doc, recent file activity without KB updates, dead wikilinks).

All three modes scan the manifest repos (excluding the workspace meta-repo and the knowledge-base entry). One invocation = at most one PR; cancelling at any prompt = no PR.

**Without an argument**, the command surveys the household: it scans `manifest.repos` for candidate bounded contexts and audits existing `domain/*.md` nodes for gaps or drift. It renders a sectioned report (new candidates + existing-domain findings), lets you prioritize 0-3 items via interactive prompts, then chains into a full `/lore:cultivate <name>` flow for each picked item (one PR per chained run, capped at 3 per session).

### Doctor

Run a full diagnostic against your workspace and KB:

```bash
/lore:doctor
```

Checks include: manifest parses + workspace pointer resolves + KB pointer resolves + sibling presence on host + KB index freshness + frontmatter validity + broken wikilinks + orphan files.

Exits non-zero if errors are found; surfaces each with a file:line reference and suggested fix.

## Skills (Auto-Invoked)

These skills trigger automatically when relevant:

| Skill | Triggers On |
|-------|-------------|
| `knowledge-discovery` | Working in repos that need domain/technical context |
| `pattern-identifier` | Questions about standards ("How do we...", "Should I...", "What's our pattern for...") |
| `review` | "Review my PR", "Check this code" |
| `knowledge-update` | "Document this", finding knowledge gaps |

### Pattern Identifier Flow

The `pattern-identifier` skill answers questions about team standards using a **docs-first, codebase-second** approach:

```
User Question ("How do we handle one-line if statements?")
                      |
                      v
         +-------------------------+
         |   pattern-identifier    |
         |        skill            |
         +-----------+-------------+
                     v
         +-------------------------+
         |   knowledge-searcher    |  <-- Subagent (keeps context clean)
         |        agent            |
         |                         |
         |  - Search _index.json   |
         |  - Grep for keywords    |
         |  - Read matching docs   |
         +-----------+-------------+
                     v
              +-----------+
              | Confidence|
              +-----+-----+
                    |
      +-------------+-------------+
      v             v             v
 fully-documented  partial     undocumented
      |             |             |
      v             +------+------+
 Return answer             v
                 +-------------------------+
                 |    Explore agent        |  <-- Codebase fallback
                 |                         |
                 |  - Find real examples   |
                 |  - Count occurrences    |
                 |  - Note locations       |
                 +-----------+-------------+
                             v
                 +-------------------------+
                 |   Combined Response     |
                 |                         |
                 |  - Docs + codebase      |
                 |  - Sources with lines   |
                 |  - Update suggestion    |
                 +-------------------------+
```

**Confidence levels:**

| Level | Meaning | Action |
|-------|---------|--------|
| `fully-documented` | Explicit answer in knowledge base | Return answer with sources |
| `partially-documented` | Related content but not complete | Add codebase examples, suggest update |
| `undocumented` | Nothing relevant in docs | Answer from codebase, strong update suggestion |

**Principle:** The knowledge base is the source of truth. Codebase shows practice, which may deviate from standards.

## Agents

Subagents run in isolation to keep the main conversation context clean:

| Agent | Purpose |
|-------|---------  |
| `knowledge-searcher` | Searches knowledge base, returns structured answers with sources and confidence |

The `knowledge-searcher` agent:
- Searches `_index.json` for tag/title/description matches
- Greps knowledge files for keywords
- Reads top 3-5 matching files
- Returns structured output: Answer, Sources (with line numbers), Confidence, Gap description

## Knowledge Structure

```
knowledge/
├── _index.json    # Pre-built index (generated by build-index)
├── general/       # Cross-repo standards
├── domain/        # DDD bounded contexts
├── frameworks/    # Framework-specific patterns
└── languages/     # Language-specific guidelines
```

Note: The `knowledge/` directory lives in your knowledge-base directory (typically `lore/` inside a witan-household workspace, or a standalone KB repo), not in this plugin repo. This plugin provides the commands, skills, agents, and hooks that interact with that knowledge.

## Architecture

The plugin uses **zero runtime scripts** (except the SessionStart hook). All commands and skills use Claude's native tools:

- **Path resolution**: SessionStart hook resolves the KB path from `.lorekeeper/config.json` → `KNOWLEDGE_BASE_PATH` → sibling-dir fallback (`lore/`, `docs/lore/`, `shared-knowledge/`, ...)
- **SessionStart hook**: Validates path, checks staleness, injects resolved path into session
- **Listing**: Read `_index.json` (pre-built at development time)
- **Search**: Grep tool with regex patterns
- **Context detection**: Glob + Read for `*.csproj`, `package.json`, etc.
- **File loading**: Read tool directly

### How Path Resolution Works

```
RESOLUTION ORDER         HOOK (bash)                    SKILLS/COMMANDS (markdown)
.lorekeeper/config.json  load-standards-reminder.sh  -> systemMessage includes:
KNOWLEDGE_BASE_PATH       - validate path exists          "Knowledge path: /path/to/knowledge/"
sibling-dir fallback      - check staleness via git    -> Skills say: "Read <knowledge-path>/domain/foo.md"
                          - output resolved path          Claude resolves at runtime
```

In a witan-household workspace, sibling-dir fallback finds `./lore/` automatically — no env var or config file needed.

### Build Script

The knowledge-base owns its own index tooling. Inside the knowledge repo:

```bash
make build-index               # via Makefile
# or
npm run build-index            # via package.json scripts
# or
node src/cli.js build-index    # directly
```

Run this after adding, removing, or renaming knowledge files. The output (`knowledge/_index.json`) lives in and is committed to the knowledge-base repo.

## Plugin Structure

```
lorekeeper/
├── package.json       # Plugin manifest
├── README.md
├── agents/            # Subagent definitions
├── commands/          # Slash command definitions
├── hooks/             # Lifecycle hooks (SessionStart, etc.)
├── scripts/           # Build scripts (index generation)
├── skills/            # Auto-invoked skill definitions
└── test/              # Tests
```

## Troubleshooting

### Plugin says "No knowledge base configured"

The hook checked all three resolution paths and found nothing. Pick one:

1. **Use the witan-household pattern** — `cd` into a workspace meta-repo whose `lore/` subdirectory has a `knowledge/` folder inside. Restart Claude Code. (Easiest if you're starting fresh — see Setup section above.)
2. **Set `KNOWLEDGE_BASE_PATH`** — point at your knowledge-base root. Restart Claude Code (env vars are read at startup).
3. **Write `.lorekeeper/config.json`** — `{ "knowledgeBasePath": "/path/to/kb" }` in the project root.

Then run `/lore:help` to verify.

### Plugin says path doesn't exist

1. Check the path in your `KNOWLEDGE_BASE_PATH` variable (or `.lorekeeper/config.json`) is correct.
2. Ensure it points to the root of the knowledge-base directory (the one that *contains* `knowledge/`), not `knowledge/` itself.
3. Use forward slashes in the path, even on Windows: `C:/Users/...` not `C:\Users\...`

### Knowledge base is stale warning

The plugin warns when the knowledge repo hasn't been updated in 7+ days (configurable via `KNOWLEDGE_MAX_AGE_DAYS`):

```bash
cd $KNOWLEDGE_BASE_PATH
git pull
```

### Commands not recognized

1. Ensure you started Claude with `--plugin-dir` pointing to this repo
2. Restart Claude Code after making changes to plugin files
