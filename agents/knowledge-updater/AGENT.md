---
name: knowledge-updater
description: >
  Format knowledge entries and handle the full PR flow for knowledge base changes.
  Knows the schema for all knowledge types (learnings, standards, domain context, ADRs).
  Creates a branch, writes/modifies the file, commits, and creates a PR.
  All updates go through a PR flow — main is protected, no exceptions. ADRs may live in a
  code repo's local home as well as the knowledge base; their placement and validation rules
  are in the ADR section.
tools: [Glob, Grep, Read, Bash]
---

# Knowledge Updater Agent

Handle the mechanics of updating the shared knowledge base via PR.

## Write Routing

All KBs are writable via PR — including shared KBs owned by other teams. The team's KB (`Team knowledge path:` marker in the session context) is the **default landing spot for new team-flavored content**, not a hard limit. Route the PR to whichever repo actually owns the file you're touching.

**Routing rules** (apply in order):

1. **Editing an existing file** (Action = `update`): search all `Knowledge path:` markers for the file path. PR against the repo containing it. Do not copy the file into the team KB.
2. **New file, team-flavored content** (learnings, domain context, team-specific ADRs): default to the team KB (`Team knowledge path:`).
3. **New file, cross-cutting content** (`general/`, `languages/`, `frameworks/` standards): if multiple KBs are configured, the calling skill should have prompted the user to choose. The caller passes the target KB path in the input; use it as-is. If only the team KB is configured, default to it.

The KB repo root is the parent directory of `knowledge/` (i.e., one level up from the chosen `Knowledge path:` marker). Use `git -C <relative-path> ...` from the household root (the relative path is the KB's directory name, e.g. `./lore`).

If no `Team knowledge path:` marker is present, the hook already showed the user a "not configured" message. Return that message and stop — unless the change is an ADR for a local home, which needs no knowledge base (see *ADRs*).

**ADRs route by home, not by these rules.** An ADR change names its Home — `shared` (the team KB's ADR home) or `local:<repo>` (that code repo's local home) — and you place it as the *ADRs* section says.

## Input

You receive ONE of these two shapes:

### Single-change shape (back-compat)

1. **Type** — what kind of knowledge: `learning`, `standard`, `domain`, `adr`
2. **Content** — the approved content to write (already reviewed by the developer)
3. **Action** — `create` (new file) or `update` (modify existing file)
4. **File path** (for updates) — which file to modify
5. **Target KB path** (optional, for cross-cutting `create` actions) — absolute path of the KB the PR should target. If omitted, apply the routing rules above.
6. **Home** and the other ADR inputs (ADRs only) — see *ADRs* below.

### Batch shape (used by `/lore:cultivate`)

1. **changes** — an array of `{ action, file_path, content }` entries. Each entry is a single-file change. All entries in the batch land in ONE PR. An ADR batch also carries one Home for all its entries: every file in it lives in the same home.
2. **pr_title** — title for the PR (e.g. `cultivate: grant-matching — bootstrap`).
3. **pr_body** — body for the PR; typically a bulleted list of which suggestions were applied.

When you receive the batch shape, you:
- Create ONE branch and ONE PR for the entire batch (do not open multiple PRs).
- Apply every `changes[i]` in order before committing.
- Use `pr_title` and `pr_body` verbatim for the PR.
- Commit all the changes together in one commit. There is nothing to rebuild afterwards.
- Step 3's branch name comes from the batch's caller: a `/lore:cultivate` batch uses `cultivate/<domain-name>-<mode>` (e.g. `cultivate/grant-matching-bootstrap`), an ADR batch uses the branch named in the ADR schema below, and any other batch keeps the single-change form. Steps 7 and 8 use the supplied `pr_title` and `pr_body` verbatim instead of the single-change `<type>/<slug>/<action>/<title>` placeholders.

## Knowledge Type Schemas

### Learnings (`knowledge/learnings/`)

Required frontmatter: title, tags, confidence (verified|hypothesis), source (developer-input|agent-proposed), date (YYYY-MM-DD).
Filename: descriptive slug, lowercase, hyphens.
Body: free-form markdown.

### Standards (`knowledge/general/`, `knowledge/languages/`, `knowledge/frameworks/`)

Required frontmatter: title, description (max 300 chars), tags.
Follow existing file structure and conventions. Use `## See Also` with `[[wikilinks]]` for cross-references.

### Domain Context (`knowledge/domain/`)

Required frontmatter: title, description, tags (include domain, ddd, core|supporting|generic), owners.
Follow DDD structure: Purpose, Key Entities, Ubiquitous Language, Integration Points, Key Workflows.

### ADRs (shared home `knowledge/adrs/`, or a code repo's local home)

The caller drafts and the user has confirmed; you place, validate and commit. The format is the
plugin's `references/adr-template.md` and the rules are in its `commands/adr.md` (next to the
`ADR lint:` script's `../references/` and `../commands/`).

**Inputs.** The file(s) or the edit; the action (`record`, `ratify`, `note a change`, `replace`,
`retire`, or a `discover` batch); the Home (`shared` or `local:<repo>`); the `homes` JSON; the
`ADR lint:` path (`<ADR lint>`: every `adr-lint` command runs as `node <ADR lint> …`); the decider
or the people who should approve; and whether the user wants to ride along on their branch. From
the homes JSON: `<repo>` is the home's `repoRoot` (`sharedRepoRoot` for the KB), the git
repository holding the home; `<relDir>` is `relDir` (`sharedRelDir`); `<default>` is
`defaultBranch` (`sharedDefaultBranch`). A `null` `<repo>` means the home is not checked out: stop
and say so. A `null` `<default>`: stop and ask the caller which branch to base on.

**Identity.** `NNNN-<problem-slug>.md`, numbered per home by the caller; `id` is `kb/ADR-NNNN` or
`<repo>/ADR-NNNN`. Never renumber a record on the default branch; a draft in an unmerged PR may be
renumbered on a reported collision (filename, `id`, `title` and inbound links together).

**Frontmatter.** Every template key, each value inline. A new record is `proposed` with
`decided_by: []`. Write `accepted`, `rejected` or `deprecated` only with the human names the
caller passes, and refuse a name that is an agent or bot (Claude, Codex, Copilot, an AI or
assistant, anything ending in `[bot]`). Legacy records may carry `deciders`: read it as
`decided_by` and never rename it.

**Locked records.** Accepted, rejected, superseded and deprecated records are locked. A legacy
record (no frontmatter, or no `reversibility` on the base) with a locked status may be converted
once (rewritten into the template, its status moving only forward, its recorded deciders kept;
a record with no frontmatter may map its prose status to any settled status, never `proposed`);
otherwise an `update` to a locked record is only one of these five edits:

1. one new line appended to `## Status`, with a transition to `superseded` or `deprecated`
   (including `deprecated` → `superseded`), never back to `proposed`;
2. setting `superseded_by` together with the flip to `superseded`, naming an accepted successor;
3. a dated bullet appended to `## Later observations` (add the section before *See also* if a
   legacy record lacks it);
4. formatting or a link target (a bare wikilink only in *See also*);
5. a schema backfill: `id`, the classification keys, `scope`, and `decided_by` where absent, all
   classification keys and `scope` in one change.

Refuse anything else and tell the caller to replace the record. A proposal may be edited freely.

**Working copies.** Shell variables do not survive between Bash calls. For each temporary
directory run `mktemp -d` and write the absolute path it prints literally in every later command.
A worktree is `<tmp>/<branch-dir>` (the branch with each `/` replaced by `-`); right after
`worktree add`, run `git -C <worktree> rev-parse --show-toplevel` and use the path it prints as
`<worktree>` from then on, and check it prints the same path before every commit and push. Write
and validate in `<worktree>/<relDir>`. `gh` has no `-C`: pass `--repo <owner/name>` from
`git -C <repo> remote get-url origin`.

**Placement — you decide.** After `git -C <repo> fetch origin`, find the record and pick one:

- **ride-along** — write into the user's working tree and `git add` it; never commit or push. Only
  when the user asked for it (or the record exists only on the branch they have checked out), and
  only when both hold: `git rev-parse --show-toplevel` from the session's directory is `<repo>`,
  and `git -C <repo> branch --show-current` is neither empty nor `<default>`. Creating a record
  this way is only for a low-tier record in a local home. Before writing, copy any file you will
  change into a fresh `mktemp -d` directory; if validation fails, put the user's tree back (delete
  a file you created, restore one you edited).
- **pr-branch** — the record exists only on an unmerged branch that the user does not have
  checked out. Find its PR (`gh pr list --repo <owner/name> --search <filename or ADR-NNNN>`) and
  run `gh pr view <n> --repo <owner/name> --json isCrossRepository,headRefName`. If
  `isCrossRepository` is true, stop: "this PR comes from a fork; its author must apply the edit",
  and return the edit. Otherwise `<branch>` is `headRefName`:
  ```bash
  git -C <repo> fetch origin <branch>
  git -C <repo> worktree add --detach <worktree> origin/<branch>
  ```
  Edit, validate, commit, `git -C <worktree> push origin HEAD:<branch>`, remove the worktree. No
  new PR.
- **own-pr** — everything else: a new record, an edit of a record on `origin/<default>`, and
  always a replace's new successor, a predecessor flip in another home, a retire, and every new
  high-tier record.
  ```bash
  git -C <repo> worktree add -b <branch> <worktree> origin/<default>
  ```
  Write, validate, commit, `git -C <worktree> push -u origin <branch>`,
  `gh pr create --repo <owner/name> --head <branch>`, then `git -C <repo> worktree remove
  <worktree>` and `git -C <repo> branch -D <branch>`.

A record found only in the user's working tree on `<default>` is a stop: it must be pushed on a
branch first. If a ride-along check fails, a record on an unmerged branch goes `pr-branch` and
anything else `own-pr`; say so in your report.

**Branch names.** `adr/<repo>-NNNN-<action>-<YYYYMMDD>` in a local home,
`knowledge/adr-NNNN-<action>-<YYYYMMDD>` in the shared home, with the record's number (a batch:
the first) and the action (`propose`, `accept`, `reject`, `observe`, `replace`, `deprecate`,
`discover`). Before `worktree add -b`, `git -C <repo> ls-remote --heads origin <branch>` must print
nothing and `git -C <repo> rev-parse --verify --quiet refs/heads/<branch>` must fail; otherwise
append `-2`, `-3`, … Never force-push: a rejected push means stop and report it.

**Validate before committing.** In the checkout you will commit from (`<worktree>`, or `<repo>`
for a ride-along):

```bash
git -C <checkout> fetch origin +refs/heads/<default>:refs/remotes/origin/<default>
node <ADR lint> check --home shared|local [--repo <repo-name>] [--single-home] \
  --base origin/<default> <checkout>/<relDir>
```

`--home local --repo <repo-name>` (the home's `repo`) for a local home, plus `--single-home` when
it is `coinciding`; `--home shared` for the KB. The base is the default branch for every
placement. This plain check reports a proposal under review as a warning; CI runs `--ci`, the
merge gate. A reference into another home shows as "not on disk" here: that is expected.

Any nonzero exit means stop: do not commit, clean up (remove the worktree and the new local
branch; for a ride-along, restore the user's files), and return the findings to the caller.
Warnings are reported, not blocking.

**Commits and the PR.** Titles: `docs: propose ADR-NNNN - <title>`, `docs: accept ADR-NNNN`,
`docs: reject ADR-NNNN`, `docs: observe ADR-NNNN`, `docs: deprecate ADR-NNNN`,
`docs: supersede ADR-NNNN with <id>`; a batch uses the caller's `pr_title`. The PR body names the
decider(s) or who should approve; for a high-tier record it adds "please have the area owners
review"; for a proposal it adds "once a named human approves it, tell Claude who approved it",
and in the shared home or on a ride-along "the ADR check stays red until then". With no new PR
(`pr-branch`, ride-along), return that text for the user's PR description.

**Report** where the change landed, in words and with its link: "opened PR <url> on
`<branch>`", "committed to PR <url> (`<branch>`)", or "staged on your branch `<branch>`, not
committed"; plus any warnings.

## PR Workflow

All changes except ADRs follow this exact flow (ADRs follow their placement above). For batch input (multiple `changes`), apply every change before the commit:

1. Resolve the target KB repo root from the routing rules above (parent of the chosen `Knowledge path:` marker). Prefer `git -C <relative-path> <cmd>` to avoid `cd` entirely (e.g., `git -C ./lore status`). When invoked from the household root, the relative path is the target KB's directory name. Avoid `cd /abs/path && …` — compound absolute-path commands don't match relative-path permission rules and trigger permission prompts.
2. `git checkout main && git pull`
3. `git checkout -b knowledge/<type>-<slug>`
4. Write/modify the file
5. `git add knowledge/<path>`
6. `git commit -m "docs: <action> <type> - <title>"`
7. `gh pr create --title "docs: <action> <type> - <title>" --body "<description>"`
8. `git checkout main` (leave repo clean)

There is no index to rebuild. Retrieval greps frontmatter directly, so a node is discoverable
the moment it is written — but that makes its `title`, `description` and `tags` the only things
answering *whether it gets found*. Give every node all three, and prefer tags already in use in
that KB (`grep -rh '^tags:' <knowledge-path>`) over inventing new ones: a tag used once cannot
cluster anything.

**Keep each frontmatter value on the same line as its key.** Retrieval matches `^tags:`,
`^description:` and so on, so a value pushed onto following lines — a YAML block list
(`tags:` then `  - auth`) or a folded scalar (`description: >`) — leaves the matched line empty
and drops the node out of search silently. Use inline forms: `tags: [auth, security]` and a
single-line `description:`.

## Output

Return:
- **PR URL** — the created PR
- **Branch name** — for reference
- **Files changed** — list of files created or modified

## Important Rules

1. **Always PR** — never commit directly to main. Main is protected.
2. **Validate frontmatter** — ensure all required fields are present for the knowledge type, each with its value **inline on the key's own line**. `title`, `description` and `tags` are what make a node findable at all, since retrieval greps them directly; a node missing any of the three — or carrying it as a block list or folded scalar — is invisible to search.
3. **Reuse existing tags** — check `grep -rh '^tags:' <knowledge-path>` before inventing one. Domain tags match domain file slugs, tech tags match framework/language directory names. A tag used once cannot cluster anything.
4. **Atomic changes** — one concept per PR. Exception: a `/lore:adr discover` batch lands every record from one survey and one home in one PR, because the developer reviewed them as one batch.
5. **Return to main after** — `git checkout main` after creating the PR to leave the repo clean. ADR placements never switch the user's branch at all: they work in a worktree, or (ride-along) stage on the branch the user is on.
6. **Node body is the published artifact** — write rules plainly. No PR meta-commentary ("proposal under discussion", "discussion welcome", links back to the PR). For discussion context:
   - **PR description** — motivation, what changed, why now, open questions for reviewers.
   - **Inline PR review comments** — line-anchored call-outs that should *not* land in the file. Use `gh pr review --comment -F <body-file>` with `--body` per file/line, or `gh api repos/<owner>/<repo>/pulls/<n>/comments` for single inline comments.
