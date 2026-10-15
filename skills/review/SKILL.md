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
- `patch <file>` - Review a saved patch (CI). Optional: `body <file>` (the PR description),
  `repo <name>` (the repo the patch belongs to), `base <ref>`, `findings-out <file>`

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers into the session context, listed in **priority order from lowest to highest** (when the same relative path exists in multiple KBs, the higher-priority file replaces the lower-priority one entirely — no section-level or paragraph-level merging).

When `<knowledge-path>` appears below, it refers to **any** of the configured knowledge paths. The dispatched knowledge-reader agent handles multi-KB iteration internally — you just hand it the task context.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

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
| "review <file>.patch" / `patch <file>` | use that file as the patch |

When auto-detecting (no explicit target): try `gh pr diff` first, fall back to `git diff main...HEAD`.

### Step 3: Get the Diff, the PR Description and the Base

Fetch everything **before** dispatching any agent. The architect has only Glob, Grep and Read,
so it must be handed files. Save into your scratchpad directory (or `/tmp`):

```bash
gh pr diff [<number>] > <scratch>/lore-review.patch          # or git diff / git show, per Step 2
gh pr view [<number>] --json body -q .body > <scratch>/lore-review-body.md   # PR targets only
```

For `patch <file>`, use that file and the `body <file>` given, if any.

Read the saved patch so you have the changed-file list and can summarise what the change does.

**Base ref:** the `base <ref>` argument (CI passes it, since `actions/checkout` sets no
`origin/HEAD` and CI runs allow no `gh` here), else the PR's base branch (`gh pr view --json
baseRefName`, as `origin/<name>`), else the default branch (`origin/HEAD`). Without git or a known base,
skip the snapshots below and say so in the summary.

**Base snapshots:** take them only when HEAD is the reviewed change's head commit (CI, or
local `changes`/`commit` targets). For a `gh pr diff` of a PR that is not checked out, skip
them. Use separate commands, never a `$(…)` substitution (permission rules do not
auto-approve those):

```bash
git merge-base <base> HEAD                      # once; call the result <mb>
git ls-tree --name-only <mb> -- <path>          # per changed file: empty output = absent on base
git show <mb>:<path> > <scratch>/lore-review-base/<path>   # only when ls-tree printed the path
```

Create directories with the Write tool, or with `mkdir -p` as its own command. Do at most 40
files, which is up to 40 `git show` calls. Write `<scratch>/lore-review-base/MANIFEST.tsv`:
first the line `# base <mb> head worktree`, then `<path>\t<state>` for **every** changed file.
State is `present`, `absent`, `skipped` (past the cap) or `unavailable` (a git command
failed). If the merge base itself fails, write no snapshots and say so in the summary.

### Step 4: Select, then Load Review Context

**Select (deterministic).** Run, with the repo name from `repo <name>`, else omit `--repo` and
let it infer from `origin`:

```bash
node <plugin-root>/scripts/adr-lint.js select --json --diff <scratch>/lore-review.patch \
  [--repo <name>] [--pr-body <scratch>/lore-review-body.md]
```

`<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}`, written out as an absolute path. Do not redirect the
output to a file. Pass the JSON it prints to the architect inline: a redirect is a file write,
which non-interactive runs may refuse. Exit 2 means it
could not tell the repo. Interactive: ask. Non-interactive: report "ADR check could not run:
<stderr>", print `**ADR check:** could not run (select exit 2)`, and never write `findings-out`.

Then dispatch two agents in parallel (both Task calls in one message):

- the **knowledge-reader** agent with the changed files/areas and hint:
  "Be thorough — include all standards, learnings, and review checklists that apply to these changes.
  Don't filter by relevance ranking, but scope to what was changed."
- the **architect** agent in `check` mode with: the patch path, the select JSON (inline), the base
  snapshot directory (if any), the PR description path (if any), the changed-file list, and a
  one-paragraph summary of the diff. It cites changed lines from the patch and ends with an
  `adr-findings` block.

Include both outputs in your review context.

Also check for repo-specific knowledge:
- Use Glob for `docs/standards/*.md`
- If found, Read those files
- Also Read `CLAUDE.md` if it exists

### Step 5: ADR Verdict

Take the architect's `adr-findings` block verbatim (do not edit, re-classify or drop entries) and
pipe it to the verdict:

```bash
node <plugin-root>/scripts/adr-lint.js verdict --findings - \
  [--pr-body <scratch>/lore-review-body.md] [--base <base>] <<'ADR_FINDINGS'
<the block's JSON>
ADR_FINDINGS
```

Pass `--base` only when reviewing local changes with no PR (it reads `ADR-Exempt` commit
trailers). Exit 0: nothing blocks. Exit 1: blocking findings remain. Exit 2: the block was missing
or invalid. Say so, and count it as one blocking finding: the check failed closed.

With `findings-out <file>`, also write the block's JSON to that file (CI runs the verdict itself
from it). Use the Write tool. **Write it only when every step succeeded:** select exited 0 and
the architect returned a valid block. On any earlier failure, write nothing and say why. CI then
fails closed on the missing file, never on an empty findings list that hides a failed step. If
the write itself is refused, say so plainly.

The summary line's counts come from the verdict's `blocking` and `exempted` fields. Never count
them yourself.

Use the verdict's `severity` for every ADR finding. Do not re-rate them. Exempted findings
stay in the report as Important with their exemption reason.

### Step 6: Review Against Knowledge

Go through each changed file. Check against ALL loaded knowledge.

Fold the ADR findings in at the verdict's severities, each citing the record by id and section:
- contradiction → conform, or replace the record (`/lore:adr replace <id>: <new decision>`);
- uncovered choice → record it (`/lore:adr <the decision>`) in this PR, or exempt it;
- fired trigger → note the change on the record; the decision goes back to its deciders;
- stale fact → include the observation the architect drafted;
- dangling citation → fix the id in the PR description or code.

A PR whose description has no `## Decisions` section (verdict `decisionsSection: false`) gets one
Minor finding pointing at `<plugin-root>/references/pr-decisions.md`.

**Categorize findings:**
- **Critical** - Security vulnerabilities, data loss risks, unexempted ADR findings the verdict marks critical; must fix before merge
- **Important** - Should fix, significant impact on maintainability/correctness
- **Minor** - Nice to fix, style/conventions, optional

### Step 7: Output in Standard Format

Use severity level indicators and be specific:

```markdown
## Code Review Results

**Summary:** Reviewed X files, found Y issues (Z critical, W important, V minor)
**ADR check:** <blocking> blocking, <exempted> exempted (verdict exit <code>)
<one line per exemption: `ADR-Exempt (<source>): <target or "whole PR"> — <reason>` + `(unused)` when it matched nothing; one line per invalid exemption>

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

### Step 7b: Posting to the PR (when asked)

If the user wants the review left **on the PR** (not just printed in chat):

- Post it as **one review** — a single summary/approval body plus an inline comment per
  code-specific finding. Don't fire findings as separate top-level comments, and don't dump them
  all into the summary body; the summary is only for the PR-wide overview.
- Anchor each inline comment to a line **that is part of the diff** — a comment on an unchanged line
  is silently dropped. If a finding is about code the PR didn't touch, put it in the summary body or
  as a file-level comment instead.

Work out the exact call (`gh` / the GitHub MCP tools) from context — the two things that matter are
batching into one review and the diff-line constraint, not the endpoint shape.

## Layer Priority

When knowledge conflicts, later layers override:
1. General (lowest)
2. Language
3. Framework
4. Domain
5. Repo-specific (highest)

## Critical Rules

1. **Problems only** - no summaries without issues, except the ADR check line
2. **Be specific** - Always include file:line references
3. **Use severity levels** - Critical/Important/Minor
4. **Repo standards win** - Check for `docs/standards/` overrides
5. **Actionable feedback** - Always explain how to fix
6. **Inline over top-level** - When posting to a PR, anchor each finding to its file:line; reserve top-level comments for PR-wide remarks
7. **ADR check line always printed** - Even with no findings; it is how CI logs and humans see the gate.
