---
name: cultivate
description: Cultivate a single bounded-context domain node — bootstrap a new one from a codebase scan, refine an existing one with missing canonical DDD sections, or audit a mature one for drift. Use when the user invokes /lore:cultivate <domain> or asks to flesh out a specific bounded context.
---

# Cultivate

Cultivate (bootstrap / refine / audit) a single bounded-context domain node. The command detects the domain's state and dispatches accordingly.

## Usage

```
/lore:cultivate <domain>     # required: the domain's slug (e.g. grant-matching)
```

Bare `/lore:cultivate` with no argument is reserved for a future whole-KB cultivation pass and currently refuses with usage instructions.

## Implementation

### Step 1: Validate argument

If the user invoked `/lore:cultivate` with no argument, print:

> `domain name required; usage: /lore:cultivate <domain>. (Future: whole-KB cultivation pass — see docs/superpowers/specs/2026-05-17-lore-cultivate-design.md "Future expansion".)`

Stop. Do not proceed.

### Step 2: Detect state

Use the Bash tool to run the detection script:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/cultivate-detect.js <domain>
```

Parse the JSON output. Two top-level shapes:

- `{ error: "...", message: "..." }` — bail with the message and suggest `/lore:doctor`.
- `{ mode: "bootstrap"|"refine"|"audit", context: {...} }` — proceed to per-mode dispatch.

The `context` object has: `domain_name`, `domain_file_path`, `exists`, `missing_sections` (only populated for refine), `code_repos` (array of sibling repo names to scan), `kb_root` (relative path to the lore knowledge dir), optional `warning`.

### Step 2b: Surface warning context (if present)

If `context.warning` is set (e.g. an existing file lacks the `domain` tag in frontmatter, so the detect script classified the situation as bootstrap-with-warning), surface the warning to the user via AskUserQuestion BEFORE proceeding to Step 3:

- [Continue anyway] → the bootstrap flow proceeds and will replace whatever's currently in the file.
- [Cancel] → exit; preserves the existing untagged file as-is.

If there's no warning, skip this step.

### Step 3: Dispatch per mode

#### Bootstrap mode

1. Confirm with the user via AskUserQuestion:
   > "No existing doc for `<domain_name>`. I'll scan the codebase (`<code_repos joined>`), then walk you through DDD-shape Q&A. Continue?"
   Options: [Yes, proceed] / [Cancel].

2. **Codebase scan** using Claude's native tools. For each repo in `code_repos`:
   - Use Glob to find source files: `**/*.{ts,tsx,js,jsx,rs,py,go,cs,java,kt,rb,php}` (cap at first 500 files per repo to bound token usage).
   - Use Grep for class/struct/type/interface declarations. Patterns:
     - TypeScript/JS: `^(export\s+)?(class|interface|type)\s+(\w+)`
     - Rust: `^(pub\s+)?(struct|enum|trait)\s+(\w+)`
     - Python: `^class\s+(\w+)`
     - Go: `^type\s+(\w+)\s+(struct|interface)`
     - Generic noun capture: `^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=`
   - Read each match's surrounding context (5-10 lines) to extract the identifier.

3. Aggregate into a frequency-ranked list. Group by category:
   - **Candidate Entities** (class/struct/interface/type declarations) — top 15.
   - **Candidate Ubiquitous-Language Terms** — frequent multi-word noun phrases in identifiers (e.g. `matchingScore`, `eligibilityCheck`).
   - **Recent activity** — files changed in the last 30 days (`git log --since=30.days.ago --name-only --pretty=format:` filtered to source files).

4. Present the aggregated list inline; then run the interview via AskUserQuestion with FOUR questions (one at a time):

   Q1: **Purpose** — free text. Prompt: "What's the purpose of the `<domain_name>` domain? One sentence."

   Q2: **Key Entities** — multiSelect from candidates. Prompt: "Which of these are Key Entities for this domain? (Selectable from the scan; user can also type additional entities in 'Other'.)" Options: top 15 candidates each as an option label.

   Q3: **Ubiquitous Language terms** — multiSelect. Prompt: "Which terms belong in the Ubiquitous Language?" Options: top 15 term candidates.

   Q4: **Integration points** — multiSelect from existing domain-tagged nodes in the KB + free-text. Prompt: "Which other domains does this one integrate with?" Options: list `<kb_root>/domain/*.md` filenames (excluding `<domain_name>` itself).

5. Draft the full node body following the structure:

   ```markdown
   ---
   title: <Domain Name (title-cased from domain_name slug)>
   description: <derived from Purpose answer>
   tags: [domain, <user-supplied or inferred>]
   ---

   # <Domain Name>

   ## Purpose

   <Purpose answer>

   ## Key Entities

   <bullet list, one per selected entity, with placeholder description>

   ## Ubiquitous Language

   <bullet list, one per term>

   ## Integration Points

   <bullet list, with wikilinks to selected domain nodes>

   ## Key Workflows

   > To fill in — list 2-3 typical user-or-system workflows that pass through this domain. The cultivate command did not auto-generate workflows; they require human input.
   ```

6. Show the draft to the user. Run AskUserQuestion: [Looks good — open PR] / [Let me edit it first] / [Cancel].

7. If [Looks good — open PR]: dispatch the `knowledge-updater` agent via the Task tool with:
   ```
   subagent_type: knowledge-updater
   prompt: |
     Batch shape:
     changes:
       - action: create
         file_path: <domain_file_path>
         content: |
           <draft>
     pr_title: "cultivate: <domain_name> — bootstrap"
     pr_body: |
       Bootstrap from /lore:cultivate session:
       - Purpose: <Purpose answer>
       - Key Entities: <list>
       - Ubiquitous Language: <list>
       - Integration Points: <list>
   ```

8. Report the PR URL the agent returns.

#### Refine mode

1. Confirm: "Refining `<domain_name>` — `missing_sections` are: <list>. I'll scan the codebase for terms/entities to add and walk you through each suggestion. Continue?" Options: [Yes] / [Cancel].

2. Read the existing `<domain_file_path>`.

3. Codebase scan (same as bootstrap step 2-3) — aggregate candidates.

4. Build a suggestion list. Each suggestion is one of:
   - `missing-section` — one per entry in `missing_sections`, with proposed section heading + stub content.
   - `add-term` — a term appearing frequently in code but not in the doc's Ubiquitous Language section.
   - `add-entity` — a class/struct in code matching the domain area but not in Key Entities.
   - `link-cross-ref` — an integration point that exists but has no wikilink to a partner-context node.
   - `fix-broken-wikilink` — wikilinks in the doc that don't resolve to existing nodes.

5. Walk suggestions one at a time via AskUserQuestion. For each:
   - Show the suggestion (kind + proposed text).
   - Options: [Apply] / [Skip] / [Show more context].
   - On [Show more context]: display the relevant code lines or sibling-node text inline, then re-ask.

6. Accumulate approved suggestions. Compute the final updated file content by applying each approved suggestion in order (insert new sections at the end if missing; insert new bullets under existing sections; replace broken wikilinks).

7. Dispatch `knowledge-updater` with:
   ```
   changes:
     - action: update
       file_path: <domain_file_path>
       content: <updated full file>
   pr_title: "cultivate: <domain_name> — refine"
   pr_body: |
     Refine pass from /lore:cultivate session. Applied N of M suggestions:
     - <bullet per approved suggestion>
   ```

8. Report PR URL.

#### Audit mode

Identical to refine mode in structure. The suggestion mix is drift-flavoured rather than gap-flavoured:
- Terms in code but not in the doc's Ubiquitous Language.
- Class/struct names in code not in Key Entities.
- Files in domain code areas (heuristic: code paths containing the domain slug) changed in the last 30 days without a corresponding KB update (last commit on the domain file is older than the latest commit on those code paths).
- Dead wikilinks.

Use the same per-suggestion AskUserQuestion loop, same `changes:` block as refine (with `action: update` and the post-application full-file content), same batch-PR dispatch. PR title: `cultivate: <domain_name> — audit`.

## Notes

- The codebase scan iterates `context.code_repos` (already excludes the workspace meta-repo and the knowledge_base entry per the detect script's filter). No need to re-filter in the command.
- One `/lore:cultivate` invocation = at most one PR. If the user cancels at any prompt, NO PR is opened.
- Bootstrap creates one new file; refine/audit update one existing file. The `knowledge-updater` agent handles the branch/commit/PR mechanics either way.
