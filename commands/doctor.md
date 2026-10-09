---
description: Full workspace + KB diagnostic. Reports manifest issues, sibling presence, KB frontmatter, broken wikilinks, orphans, and the health of every ADR home.
---

# Doctor Command

Run a full diagnostic against the current witan-household workspace and its knowledge base.

## Usage

```
/lore:doctor
```

## Implementation

### Step 1: Locate the workspace

The SessionStart hook sets one or more `Knowledge path:` markers in the session context, plus a `Team knowledge path:` marker (the team's writable KB). Step 2 and Step 3 below derive their paths from `household.json`; the `Team knowledge path:` marker is used only to flag a shared KB that duplicates the team KB. The workspace root is the parent directory of `<knowledge-path>` (i.e. `<knowledge-path>/..`).

If no knowledge path is set, tell the user: "No knowledge base configured. Run /lore:init or set KNOWLEDGE_BASE_PATH."

### Step 2: Invoke the doctor tool

```bash
node <workspace-root>/lore/_tools/cli.js doctor --dir <workspace-root>/lore/knowledge
```

Capture stdout and stderr. The tool exits 0 if all checks pass, 1 if any errors were found.

### Step 3: Validate shared knowledge bases (multi-KB households)

Read `household.json` from the household root (walk up from CWD if needed). If it declares a `shared_knowledge_bases` array, check each entry with native tools:

1. **Manifest cross-check** — the entry matches a `repos[].name`. If not: error, suggest adding the repo entry (with a `url` so `make setup` clones it) or removing the name from `shared_knowledge_bases`.
2. **Presence** — `<household-root>/<name>/` exists. If not: error, suggest `make setup`.
3. **Shape** — `<household-root>/<name>/knowledge/` exists. If not: error — the directory is not a knowledge base; the SessionStart hook will skip it.
4. **Retrievability** — every `.md` under `<household-root>/<name>/knowledge/` declares `title`,
   `description` and `tags`. Grep `^(title|description|tags):` and compare the per-file counts
   against the file list. A node missing any of the three is invisible to frontmatter search:
   warning, naming the files.
5. **Tag health** — collect tags with `grep -rh '^tags:'` and report how many are used exactly
   once. Singletons cannot cluster anything, so a high proportion means tag search is weak:
   informational, not an error.

Also warn if an entry duplicates `knowledge_base` (the team KB must not be listed as shared — it would be read twice).

Skip this step entirely when `household.json` is absent or has no `shared_knowledge_bases` — single-KB setups stay silent.

### Step 4: Check schema version (read-only)

Compare the workspace's `household.json` `schema_version` (absent ⇒ 1) against the
plugin's current schema:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dry-run --dir=<workspace-root>
```

- "Already at schema vN. Nothing to migrate." (exit 0) → report the schema is current.
- "Would migrate vA -> vB:" (exit 0) → report drift as a warning and suggest `/lore:migrate`.
- "Workspace schema vN is newer than this plugin ..." (exit 4) → report as a warning:
  the workspace was written by a newer Lorekeeper than the one installed. Suggest
  `/plugin update lore@witan` (NOT `/lore:migrate` — there is nothing to migrate).
- Exit 3 (CONFLICT) → report the conflicting fields as an error and suggest
  `/lore:migrate` (which will surface the same conflict for the user to resolve).

This step never writes — it only reports. `/lore:migrate` is the writer.

### Step 5: Check the ADR homes (read-only)

Architecture decision records live in each code repo's local home (`docs/adr/` unless configured)
and in the team KB's shared home. Resolve them:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js homes
```

For the local homes and the shared home with `exists: true` (not `otherKbs`: other teams' KBs are
theirs to check), run the validator without a base (doctor diffs nothing):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js check <home flags> <home-dir>
```

`<home flags>` are `--home shared` for the shared home, and `--home local --repo <repo>` (the
home's `repo`) for a local home, plus `--single-home` when `homes` reports it as `coinciding`.
Spelt out, the check never has to re-resolve the homes from inside a KB that sits outside the
code repo.

Report per home: the number of records, errors and warnings, grouped by rule. Then:

- **Errors** (exit 1) — print each `path: rule: message` line. A `relations` error is one of: a
  relation whose id (`kb/ADR-0004`, `api/ADR-0002`) resolves nowhere or is not a qualified id (a
  renumbered or deleted record, or a typo); a supersession that is not symmetric (`superseded_by`
  set on one record while its successor does not list it in `supersedes`); or a flip left undone
  (an accepted record whose predecessor in the same home is not yet `superseded` by it, or a
  `superseded_by` without `status: superseded`).
- **Warnings on records from before the ADR-centred format** (`id`, `reversibility` or the other
  classification keys missing) — one summary line per home, suggesting `/lore:migrate` for the
  backfill. Do not list every record.
- **Open proposals** (`proposed-shared` warnings in the shared home) — list each by its
  qualified id (`kb/ADR-NNNN`, from its home and number): each needs
  `/lore:adr accept <id> by <name>` or `/lore:adr reject <id> by <name>`. Call one a *legacy*
  proposal only when it is also unclassified (no `reversibility`): the KB checkout may simply be
  on a branch carrying a fresh one.
- **Repos not checked out** (`present: false`) — name them: their local records could not be
  checked, and references into them show up as warnings, not errors.
- A home that does not exist yet is not a problem: say "no records yet".

Name records by qualified id everywhere in this report (`kb/ADR-0002`, `api/ADR-0001`): a bare
`ADR-0002` is ambiguous when two homes both have one.

If `homes` reports no local home and no shared home (no household, no git repo), skip this step.

### Step 6: Render the output

Display the tool's output verbatim. If there are errors (exit code 1):

- For broken-wikilink errors: offer to run `/lore:update` to propose adding the missing node.
- For frontmatter errors: print the file:line and suggest the fix.
- For missing sibling errors: print `make setup` as the suggested fix.
- For a node missing `title`/`description`/`tags`: print the file and the missing field — the node is invisible to frontmatter search until it has all three.

### Step 7: Exit cleanly

End the response with a one-line summary: "X errors, Y warnings. <suggested next step or 'All clear.'>"
Count the ADR findings from Step 5 in the totals.

## Notes

- /lore:doctor never modifies files. It's read-only. This includes schema drift and ADR backfills: doctor reports them but never applies them — `/lore:migrate` is the writer.
- The diagnostic tool lives in the witan-household template under `lore/_tools/`. If the user's workspace was created before the tooling was added, `cli.js doctor` won't exist; in that case, suggest they adopt the current witan-household template, which ships it.
