---
name: stack
description: Use when opening 2+ dependent PRs, when the user mentions a PR stack, stacked PRs, merge order, or a coordinated change across repos, when a PR body contains a "## Stack" section, or after a stack PR merges (advance/status). Covers single-repo stacks (native gh stack) and cross-repo stacks (checklist convention).
---

# PR Stack Coordination

A stack is an ordered sequence of PRs. Pick the mode first:

- **Single repo** (whole sequence in one repo) → native GitHub stack via the `gh stack` CLI. GitHub renders a stack map in the PR header, merges atomically (merging a PR lands every unmerged PR *below* it), auto-retargets after partial merges, and enforces branch protection against the final target. The native stack is both the visibility and the gate — **no checklist needed**.
- **Cross-repo** (sequence spans repos — GitHub stacks cannot) → the stack-checklist convention (format under *Cross-repo stacks* below), with native stacks as an enhancement inside same-repo segments.

A rollout that touches many repos once each — a plugin change plus every consumer, a convention plus every knowledge base — is **one PR per repo**, so every segment is a single PR and the native half of this skill never engages. That is the ordinary shape of a cross-repo stack, not a degraded one: the checklist alone carries it, and there is no reason to install `gh-stack` for it.

Prerequisite, **only once a segment holds 2+ PRs in one repo**: `gh extension list | grep -q gh-stack || gh extension install github/gh-stack`. Docs: https://github.github.com/gh-stack/ — the CLI reference there is the source for the exit codes, `link` semantics, and merge behavior cited below; consult it (or `gh stack --help`) when behavior differs.

## Knowledge base first

Before applying the conventions below, check whether the team's knowledge base already defines a stacking or git-workflow convention. `Grep` the frontmatter (`^(title|description|tags):`) under `<knowledge-path>/general/workflow/` for `stack`, `stacked`, or `git-workflow` (`<knowledge-path>` is any `Knowledge path:` marker in the session context). Where such a node exists it is authoritative — read it and follow it over this file. Use the format in this file when no such node exists or it is unreadable, so a stale or missing knowledge base never leaves a stack without a format. If the two ever diverge, the knowledge base wins and this skill should be corrected via the knowledge-update skill.

## Single-repo stacks

Building new work, from the trunk:
1. `gh stack init <first-branch>` once — **pass the branch name**: bare `gh stack init` prompts for one, so in an agent or CI Bash run (no TTY) it exits 5 with `interactive input required; provide branch names as arguments`. Several names lay out the whole stack up front (`gh stack init auth-layer api-routes ui-components`), and existing branches are adopted rather than recreated.
2. Then per layer: make changes, `gh stack add --all -m "<message>"` (creates a branch at HEAD on top of the stack). On the first layer the branch `init` created is still empty, so `add` commits *there* and says so instead of creating a branch — a plain `git commit` on it is equivalent.
3. `gh stack submit --auto --open` — pushes all branches and creates/updates the PRs and the stack on GitHub. An agent or CI Bash run has no TTY, so `submit` skips the interactive editor and behaves as `--auto`, which **defaults new PRs to draft**; passing `--auto --open` makes that explicit and lands them **ready for review** (per `gh stack submit --help`, `--open` = "Mark new and existing PRs as ready for review"). In an interactive terminal the editor already defaults to ready, so `--open` there is harmless. Degrade: if a future CLI rejects `--open`, submit without it and flip with `gh pr ready <n>`.

Adopting PRs/branches created outside gh-stack (by hand, or by an agent without the extension):
- Branches must chain: each based on its predecessor, each PR targeting the predecessor's branch (first targets main). Retarget existing PRs with `gh pr edit <n> --base <branch>` if needed, then register bottom first: `gh stack link --open <pr-or-branch>...` (`link` touches no local tracking state). Pass `--open` so the stack lands **ready for review** rather than draft — per `gh stack link --help`, `--open` marks *both* newly-created and existing PRs ready. Scope: `link` only *creates* PRs for bare-branch args (and those default to draft); for a `<pr>`-number/URL arg it adopts the existing PR, and `--open` flips that PR from draft to ready if it was one. Draft PRs silently sit unreviewed, so ready is what we want; flip any straggler with `gh pr ready <n>`. Verify each PR's `baseRefName` afterwards.

Day-to-day: `gh stack view` for status; after a partial merge or trunk movement, `gh stack sync` (in a checkout that tracks the stack — run `gh stack checkout <pr>` first if it doesn't; `sync` without tracking exits 2); `gh stack modify` to reorder/fold (clean tree required).

Vocabulary, to avoid inverting order: merge order = GitHub stack bottom→top; merging a PR also lands everything below it. (When a native segment appears inside a cross-repo checklist, the orientation rule in the cross-repo section pins the mapping.)

Degrade (`gh stack` exits 9 — Stacked PRs not enabled for the repo; the feature is in preview, so expect this): keep the base-chained branches and PRs (GitHub still retargets a PR to main when its merged base branch is deleted) and fall back to the cross-repo conventions below — checklist at the bottom of each body as the gate.

## Cross-repo stacks

Terms: the **sequence** (full merge order) splits into **segments** (maximal same-repo runs — 2+ PRs become native stacks per the section above) joined at **joints** (cross-repo edges, where only the convention orders things).

**Topology — chain vs fan-out.** A *chain* is strictly linear: each PR depends on the one before it, so merge order is total and "top to bottom" is literal. A *fan-out* is one **root** PR (a template, a shared convention, a base-layer change) plus N **leaf** PRs that each adopt the root independently but are otherwise self-contained — the leaves depend on the root, not on each other. Most template-→-consumers or base-→-teams rollouts are fan-outs. Order the checklist root-first, but say in it that the leaves are parallel: their order *among themselves* is advisory, so don't block one leaf on another or report a leaf as "merged ahead of its predecessor" when its only real predecessor is the root.

**A joint need not be a code dependency.** A PR can be inert until a *companion* PR in a different repo lands — e.g. a version or manifest bump in a separate repo that a release mechanism compares against, without which the first PR's change never reaches installs. That companion is a joint even though neither PR imports the other: list it in the checklist and order it so the dependent PR isn't merged into a no-op.

### create
1. Establish the sequence — from the plan, or ask. Each entry: repo, branch or existing PR, one-line description.
2. Set up each 2+ PR segment as a native stack (see single-repo section; soft-degrade per repo).
3. Write the shared `## Stack` checklist at the bottom of every PR body — the same list in each, every entry a full `owner/repo#N` ref in merge order, with only that body's *own* entry marked `← this PR`:

   ```markdown
   ## Stack (merge top to bottom)
   _These move together: <one line on the shared change or dependency>._
   - [x] owner/repo#123 — what it does
   - [ ] owner/repo#456 — what it does ← this PR
   - [ ] other-owner/other-repo#78 — what it does
   ```

   GitHub renders every reference with its live state, cross-repo included, so the badges stay current without maintenance — only the ordering is static text, and the ordering never changes. **The checklist is the gate:** merge strictly top to bottom (for a fan-out, root first, then the leaves in any order), and read the Stack section before merging, since each reference's badge shows whether its predecessors have landed. Each PR must be **independently deployable against the currently merged state of the others** — that is what makes a partially-merged stack safe.

   The checklist is also **context for reviewers**. Each PR is reviewed in isolation, so without it a reviewer of one PR can't see the siblings and will re-raise cross-repo concerns ("is the downstream consumer updated yet?", "does this leave the other repos inconsistent?") — often the *same* concern on several PRs. The `_These move together_` line, plus the sibling refs, answers that up front so per-PR review doesn't re-litigate the coordination.

   **A PR can't cite its own number before it exists**, so create the PRs first — capturing each number from `gh pr create`'s output — then write or patch each body's checklist with the real refs, marking that body's own entry `← this PR`. Authoring the body with a `#?` placeholder and filling it in via `gh pr edit` right after creation is the normal two-pass; don't try to number a body before its PR is open.

   **The list grows as you add PRs.** A cross-repo sequence is usually built one PR at a time, and each new PR must appear in *every* body — not just its own. So each addition means backfilling the checklist into the bodies already opened. Simplest and least error-prone: open all the PRs first, then write the now-complete list into every body in one pass. The characteristic failure of incremental creation is early PRs left carrying a shorter list — or no `## Stack` section at all — than the ones opened later.

4. **Verify before calling it done.** Pull every body (`gh pr view <N> -R <owner/repo> --json body`) and confirm they carry the *identical* checklist — same entries, same order, differing only in which line is marked `← this PR`. A body with a shorter list, a stale `#?`, or a missing section is the standard drift of incremental creation; this one cheap pass catches all three.

**Orientation rule — one absolute, both vocabularies:** the **first checklist entry merges first**. Inside a native segment, that first-listed PR is the GitHub stack's *bottom* (the one targeting main); each later entry sits one layer higher. So "merged ahead of an unmerged predecessor" always means: merged while an **earlier checklist entry** was still open.

### advance
Trigger: a stack PR merged, or the user asks to advance/sync.
1. Read the `## Stack` section from any live PR and resolve each entry's live state. Parse `owner/repo#N` into `gh pr view <N> -R <owner/repo> --json state,mergedAt` — gh selectors don't accept the `owner/repo#N` form directly.
2. Live PR state is the authority for merged-ness. Regenerate any body section that is missing, mis-ordered, or has stale ticks — each body keeps its *own* `← this PR` marker; bodies already in sync need no write. If two bodies genuinely disagree on ordering, reconcile with the user before writing anything.
3. Bring native segments current: `gh stack checkout <pr>` then `gh stack sync` per affected repo (skip uncloned repos and say so).
4. Report the front: the next mergeable PR(s) and what each is waiting on.

### status
Given any PR of a sequence (or "where is the stack?"), render the entries in merge order with live state (merged / open / closed, CI via `gh pr checks`; `gh stack view` inside native segments). Flag anomalies: an entry closed without merging (sequence broken — re-plan it), a checklist out of sync with reality, an entry merged ahead of an unmerged predecessor **in a chain** (report it — the fix is usually merging the predecessor promptly). In a fan-out, leaves merging in any order once the root has landed is normal, not an anomaly — only a leaf merged before the root is.

## Rules

- The `## Stack` section in PR bodies is the durable source of truth for cross-repo order — parse it; don't reconstruct from memory. Single-repo native stacks need no checklist; GitHub is the source of truth there.
- Merging follows sequence order: total in a chain; root-before-leaves in a fan-out (leaves are parallel). If a step became unnecessary, update every checklist first, then close its PR.
- Everything runs with the developer's local `gh` auth. Do not create org secrets, CI workflows, or polling for this — the checklist already solves the coordination problem, and automation would add secrets and workflows to maintain for no gain.
- Soft-degrade over hard failure: feature gates, missing extension, single-PR segments, uncloned repos → the checklist convention alone still carries the coordination; state what was skipped.
