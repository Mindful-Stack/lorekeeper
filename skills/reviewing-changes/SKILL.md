---
name: reviewing-changes
description: Review code changes, PRs, commits, or diffs using team standards. Use when the user asks to review code, check a PR, look at changes, review a commit, review their work, or provide code feedback.
---

# Code Review

Review code changes using team standards and knowledge base.

## Required: the ADR check runs on every review

Every review — any target, local or CI, however small the diff — runs the ADR pipeline and
prints its result. This is not advice to weigh: the ADR check is a merge gate, and the gate is
`adr-lint verdict`'s **exit code**, not your judgment. Reading the patch and the ADR files
yourself, and writing a correct review from them, does **not** replace any step below; a review
without the verdict's line is an incomplete review, whatever else it says.

You MUST complete each of these items, in order (as tasks, if you track tasks):

1. **Patch** — get the diff into a file (Step 3).
2. **Select** — run `node <plugin-root>/scripts/adr-lint.js select --json …` (Step 4).
3. **Architect check** — dispatch the **architect** agent in `check` mode with the select JSON;
   it ends with an `adr-findings` block (Step 4).
4. **Verdict** — feed that block, verbatim, to `node <plugin-root>/scripts/adr-lint.js verdict`
   (Step 5).
5. **ADR check line** — the review's output opens with
   `**ADR check:** <blocking> blocking (verdict exit <code>)`, the count copied from the
   verdict's JSON (Step 7).

If a step cannot run, do not skip to a hand-written review: print
`**ADR check:** could not run (<which step and why>)` as Steps 4 and 5 define, and carry on with
the rest of the review.

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
  `repo <name>` (the repo the patch belongs to), `findings-out <file>`

## Knowledge Paths

The SessionStart hook injects one or more `Knowledge path:` markers into the session context, listed in **priority order from lowest to highest** (when the same relative path exists in multiple KBs, the higher-priority file replaces the lower-priority one entirely — no section-level or paragraph-level merging).

When `<knowledge-path>` appears below, it refers to **any** of the configured knowledge paths. The dispatched knowledge-reader agent handles multi-KB iteration internally — you just hand it the task context.

If no `Knowledge path:` marker is present in the session context, tell the user:
"No knowledge base configured — run `/lore:init` to set one up, or see the SessionStart message
for other options, then restart Claude Code."

## Procedure

Follow the steps in order. Steps 3–5 and 7 implement the required ADR check above.

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
| "review my changes" / "review my work" | `git diff <default ref>...HEAD` |
| "review my latest commit" / "review last commit" | `git show HEAD` |
| "review my staged changes" | `git diff --staged` |
| "review {file}" | `git diff <default ref>...HEAD -- {file}` |
| "review the last N commits" | `git diff HEAD~N...HEAD` |
| "review <file>.patch" / `patch <file>` | use that file as the patch |

**Default ref:** `origin/HEAD` when it is set, else `main`.

When auto-detecting (no explicit target): try `gh pr diff` first, fall back to `git diff <default ref>...HEAD`.

### Step 3: Get the Diff and the PR Description

Fetch everything **before** dispatching any agent. The architect has only Glob, Grep and Read,
so it must be handed files.

**Run directory:** every review run gets its own fresh directory,
`<scratch>/lore-review-<YYYYMMDD-HHMMSS>/` — never a fixed name. Create it as part of saving the
first file below, in one command, rather than as a separate empty-directory step:

```bash
mkdir -p <dir> && gh pr diff [<number>] > <dir>/patch     # or git diff / git show, per Step 2
gh pr view [<number>] --json body -q .body > <dir>/body.md   # PR targets only
```

For `patch <file>`, use that file and the `body <file>` given, if any — they stand in for
`<dir>/patch` and `<dir>/body.md` everywhere below. A fresh directory per run is what makes the
findings file safe to take for granted later: `<dir>/findings.md` (Step 5) has never been read
before, so the Write tool cannot collide with a previous run's leftovers.

Read the saved patch so you have the changed-file list and can summarise what the change does.

### Step 4: Select, then Load Review Context

`<plugin-root>` is the plugin's root directory: two levels above this skill's own base directory,
the path shown when the skill loads. `$CLAUDE_PLUGIN_ROOT` is not set in Bash, so write that
absolute path out literally in every command below (`skills/recording-decisions/SKILL.md` names
the same convention). Run each `adr-lint` call as a command of its own, with no `; echo $?` or
`&&` chain: the tool result already reports the exit code, and permission rules approve a bare
`node …` call where they may stop a chain.

**Select (deterministic).** Run, using the patch path and (if there is one) the PR-description
path from Step 3 — for `patch <file> body <file>` these are exactly the given files — and the
repo name from `repo <name>`, else omit `--repo` and let it infer from `origin`:

```bash
node <plugin-root>/scripts/adr-lint.js select --json --diff <patch path> \
  [--repo <name>] [--pr-body <pr-description path>]
```

Do not redirect the output to a file. Pass the JSON it prints to the architect inline: a redirect
is a file write, which non-interactive runs may refuse.

**Select exit:** non-zero means something went wrong; read its stderr. If it says it cannot tell
the repo (`cannot tell which repo this is`) or that the repo is not in the household
(`is not in household.json`), and you can ask: ask the user which repo and retry with
`--repo <name>`. Otherwise — including a non-interactive run, where asking is not possible — it is
a failed step: report "ADR check could not run: <stderr>", print `**ADR check:** could not run
(select exit <n>)`, and never write `findings-out`.

Then dispatch two agents in parallel (both Task calls in one message):

- the **knowledge-reader** agent with the changed files/areas and hint:
  "Be thorough — include all standards, learnings, and review checklists that apply to these changes.
  Don't filter by relevance ranking, but scope to what was changed."
- the **architect** agent in `check` mode with: the patch path, the select JSON (inline), the PR
  description path (if any), the changed-file list, and a one-paragraph summary of the diff. It cites changed lines from the patch and ends with an
  `adr-findings` block — unless it had no patch to read, in which case it ends with none.

Include both outputs in your review context.

Also check for repo-specific knowledge:
- Use Glob for `docs/standards/*.md`
- If found, Read those files
- Also Read `CLAUDE.md` if it exists

### Step 5: ADR Verdict

If the architect returned no `adr-findings` block (it had no patch to read), skip the verdict:
write no findings file, and report `**ADR check:** could not run (architect had no patch to
check)`.

Otherwise, take the architect's `adr-findings` block **verbatim** — fences included;
`adr-lint verdict` reads the fenced block itself, not bare JSON — and write it, with the Write
tool, into one file: `findings-out <file>` when the target gave one, else `<dir>/findings.md`
(the run directory from Step 3, never read before this run, so the Write tool has nothing stale
to refuse). Do not edit, re-classify or drop entries. **Write it only
when every step succeeded:** select exited 0 and the architect returned a valid block — the same
condition that already gates this step. Writing the one file CI also consumes is the point:
`findings-out` needs no separate gate beyond this one, and CI fails closed on the missing file,
never on an empty findings list that hides a failed step.

Run the verdict on that file:

```bash
node <plugin-root>/scripts/adr-lint.js verdict --findings <findings file>
```

If the Write is refused (some sandboxes disallow it), fall back to piping the block inline for
this run only (`verdict --findings - <<'ADR_FINDINGS' ... ADR_FINDINGS`), and say in the summary
that `findings-out` could not be written — CI will fail closed on the missing file.

Exit 0: nothing blocks. Exit 1: blocking findings remain. Exit 2: the verdict could not run —
causes include a missing or invalid `adr-findings` block, more than one block, or an unknown
finding class. Report its stderr,
print `**ADR check:** could not run (verdict exit 2: <stderr>)`, and count it as one blocking
finding: the check failed closed.

The summary line's count comes from the verdict's `blocking` field. Never count it yourself.

Use the verdict's `severity` for every ADR finding. Do not re-rate them.

### Step 6: Review Against Knowledge

Go through each changed file. Check against ALL loaded knowledge.

Fold the ADR findings in at the verdict's severities, each citing its ids exactly as the verdict
JSON gives them — a rule id such as `<repo>/ADR-NNNN.R1` stays whole, not split into a record and
a rule — so CI logs and readers can search for them:
- contradiction → conform, or replace the record (`/lore:adr replace <id>: <new decision>`);
- uncovered choice → record it (`/lore:adr <the decision>`) in this PR;
- fired trigger → note the change on the record; the decision goes back to its deciders;
- stale fact → include the observation the architect drafted;
- dangling citation → fix the id in the PR description or code.

When there is a PR description, Read it: if it has no `## Decisions` heading (one inside an HTML
comment or a code block does not count), report one Minor finding pointing at
`<plugin-root>/references/pr-decisions.md`. A target with no PR description skips this check.

**Categorize findings:**
- **Critical** - Security vulnerabilities, data loss risks, ADR findings the verdict marks critical; must fix before merge
- **Important** - Should fix, significant impact on maintainability/correctness
- **Minor** - Nice to fix, style/conventions, optional

### Step 7: Output in Standard Format

Use severity level indicators and be specific. The ADR check line comes first, filled from the
verdict's JSON (Step 5) — or the `could not run (…)` form when a step failed:

```markdown
## Code Review Results

**ADR check:** <blocking> blocking (verdict exit <code>)
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
