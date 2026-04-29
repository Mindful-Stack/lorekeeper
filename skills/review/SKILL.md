---
name: review
description: Review code changes, PRs, commits, or diffs using team standards. Use when the user asks to review code, check a PR, look at changes, review a commit, review their work, or provide code feedback.
---

# Code Review

Review code changes using team standards and knowledge base.

## When This Skill Activates

- "Review my PR"
- "Review my changes"
- "Review my latest commit"
- "Can you check this code?"
- "Code review please"
- "Look at my diff"
- "Review the changes I made"
- "What do you think of these changes?"
- "Check my work"
- "Review this before I push"

## Targets

When invoked via `/lore:review [target]`:

- (none) - Auto-detect: try PR first, then local changes
- `pr` - Review current PR
- `pr <number>` - Review specific PR by number
- `changes` - Review uncommitted changes vs main
- `commit` - Review latest commit
- `staged` - Review staged changes
- `last <N>` - Review last N commits

## Knowledge Path

The knowledge base path is provided by the SessionStart hook. Look for "Knowledge path:" in the
session context — that is the absolute path to the knowledge directory.

All file references below use `<knowledge-path>` as a placeholder. Replace it with the actual
path from the session context when using Read, Glob, or Grep tools.

If the session says KNOWLEDGE_BASE_PATH is not set, tell the user:
"Set the KNOWLEDGE_BASE_PATH environment variable to the path of your knowledge base
repo clone and restart Claude Code."

## How to Review

### Step 1: Detect Project Context

Detect the language and framework of the current project:

1. Use Glob for `*.csproj` or `*.sln` → .NET / C# detected
2. Use Glob for `package.json` → Read it:
   - `react` or `react-dom` in dependencies → React detected
   - `svelte` or `@sveltejs/kit` in dependencies → Svelte detected
   - `typescript` in devDependencies → TypeScript detected
3. Use Glob for `docs/standards/*.md` → repo-specific knowledge exists

### Step 2: Determine What to Review

| User Says | Git Command |
|-----------|-------------|
| "review my PR" / "review the PR" | `gh pr diff` |
| "review PR 123" | `gh pr diff 123` |
| "review my changes" / "review my work" | `git diff main...HEAD` |
| "review my latest commit" / "review last commit" | `git show HEAD` |
| "review my staged changes" | `git diff --staged` |
| "review {file}" | `git diff main...HEAD -- {file}` |
| "review the last N commits" | `git diff HEAD~N...HEAD` |

When auto-detecting (no explicit target): try `gh pr diff` first, fall back to `git diff main...HEAD`.

### Step 3: Load Review Context

Dispatch the **knowledge-reader** agent with the changed files/areas and hint:
"Be thorough — include all standards, learnings, and review checklists that apply to these changes.
Don't filter by relevance ranking, but scope to what was changed."

Include the reader's output in your review context.

Also check for repo-specific knowledge:
- Use Glob for `docs/standards/*.md`
- If found, Read those files
- Also Read `CLAUDE.md` if it exists

### Step 4: Get the Diff

```bash
# For PR (try first if user mentions "PR")
gh pr diff 2>/dev/null

# For local changes (fallback)
git diff main...HEAD

# For latest commit
git show HEAD

# For staged changes
git diff --staged
```

### Step 5: Review Against Knowledge

Go through each changed file. Check against ALL loaded knowledge.

**Categorize findings:**
- **Critical** - Security vulnerabilities, data loss risks, must fix before merge
- **Important** - Should fix, significant impact on maintainability/correctness
- **Minor** - Nice to fix, style/conventions, optional

### Step 6: Output in Standard Format

Use severity level indicators and be specific:

```markdown
## Code Review Results

**Summary:** Reviewed X files, found Y issues (Z critical, W important, V minor)

### Critical Issues
- **[file:line]** Description of the issue
  - Why it's a problem
  - How to fix it

### Important Issues
- **[file:line]** Description
  - Suggestion

### Minor Issues
- **[file:line]** Description
```

## Layer Priority

When knowledge conflicts, later layers override:
1. General (lowest)
2. Language
3. Framework
4. Domain
5. Repo-specific (highest)

## Critical Rules

1. **Problems only** - No summaries without issues, no filler
2. **Be specific** - Always include file:line references
3. **Use severity levels** - Critical/Important/Minor
4. **Repo standards win** - Check for `docs/standards/` overrides
5. **Actionable feedback** - Always explain how to fix
