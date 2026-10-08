---
description: Migrate this workspace's household.json to the schema version the current plugin expects, then optionally refresh template-managed tooling.
---

# Migrate Command

Bring the current witan-household workspace up to the `household.json` schema the
installed plugin expects. This is the **only** command that writes `household.json`.

## Usage

```
/lore:migrate
```

## Implementation

### Step 1: Locate the workspace

Find `household.json` by walking up from CWD (bounded, like the SessionStart hook).
The workspace root is the directory containing it. If none is found, tell the user:
"No witan-household workspace here (no household.json). Run /lore:init first." and stop.

### Step 2: Dry-run to see what would change

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dry-run --dir=<workspace-root>
```

- Exit 0 with "Already at schema vN. Nothing to migrate." → report it and **skip to
  Step 6 (ADR backfill)** (offer tooling refresh anyway — tooling can be stale even when
  the schema is current).
- Exit 4 with "Workspace schema vN is newer than this plugin ..." → the workspace was
  written by a newer Lorekeeper than the one installed. Do **not** migrate or write.
  Surface the message and tell the user to update the plugin
  (`/plugin update lore@witan`), then stop.
- Exit 3 (CONFLICT) → show the conflict message verbatim. Do **not** write anything.
  Explain that both `workspace` and `meta_repo` are set to different values and the
  user must pick one by hand, then stop.
- Exit 0 with a "Would migrate ..." diff → show the diff and continue.

### Step 3: Dirty-state preflight (manifest)

```bash
git -C <workspace-root> status --porcelain -- household.json
```

If the output is non-empty, `household.json` has uncommitted changes. Stop and ask
the user to commit or stash first — "review git diff before committing" does not
protect uncommitted edits from being overwritten.

### Step 4: Confirm and apply

Show the dry-run diff and ask the user to confirm. On yes:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/migrate-manifest.js --dir=<workspace-root>
```

Report the applied diff. Remind the user to review `git diff household.json` before
committing.

### Step 5: Offer to commit the manifest change

Offer (do not force):

```bash
git -C <workspace-root> add household.json
git -C <workspace-root> commit -m "chore: migrate household.json to schema v<N>"
```

### Step 6: Optional ADR backfill

Records written before the ADR-centred format lack `id` and the classification keys. The
validator treats them as grandfathered (warnings, not errors), so this step is optional. It
adds the missing keys without changing anything else, which is the *schema backfill* edit a
locked record allows.

1. **Find the homes:** the team KB's shared home (`<team-knowledge-path>/adrs`) and the local
   home of every repo present on disk (`<repo>/docs/adr`, or the manifest's `adrDir` /
   `adr.localDir`). Skip homes that do not exist.
2. **Dry-run each home:**
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js backfill --dry-run <home-dir>
   ```
   If no home prints a `would add` line, say "ADR records already carry the new keys." and go
   to Step 7.
3. **Show the combined list and ask** whether to apply it. On no, go to Step 7.
4. **Per repo that has changes:** check `git -C <repo> status --porcelain -- <home-dir>` is
   empty (stop for that repo if not), create a branch `chore/adr-backfill` from the repo's
   default branch, run the same command without `--dry-run`, then verify:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/adr-lint.js check --base <default-branch> <home-dir>
   ```
   Expected: exit 0 with `warning:` lines only. Any error means stop and report it, never
   commit.
5. **List legacy proposals in the shared home** (`status: proposed` on the default branch, which the old `accept` rule allowed). They are warnings now, but a human must accept or reject each one: say which, and point at `/lore:adr accept NNNN`. Accepting one requires classifying it in the same change.
6. **Offer to commit and open a PR** per repo (`chore: backfill ADR ids and classification
   keys`). Never commit to the default branch; the KB's main is protected. Filling in the
   classification values is a human review step for each record: say so, and that the values
   can be filled once, in one PR per record, while the record is still unclassified.

### Step 7: Optional tooling refresh

Ask, phrased as an optional refresh (not a staleness claim):

> "This migration can also refresh template-managed tooling (`scripts/` and
> `Makefile`) from the current witan-household template. This overwrites those
> paths. Refresh? [y/N]"

If yes:

1. **Dirty-state preflight (tooling):**
   ```bash
   git -C <workspace-root> status --porcelain -- scripts Makefile
   ```
   If non-empty, warn that `scripts/`/`Makefile` have uncommitted changes and require
   a second explicit confirmation before overwriting (git only protects committed state).

2. **Fetch + copy** (mode-preserving; temp clone cleaned up on success and failure):
   ```bash
   TMPL=$(mktemp -d)
   trap 'rm -rf "$TMPL"' EXIT
   git clone --depth=1 https://github.com/Mindful-Stack/witan-household.git "$TMPL"
   cp -a "$TMPL/scripts/." <workspace-root>/scripts/
   cp -a "$TMPL/Makefile" <workspace-root>/Makefile
   rm -rf "$TMPL"; trap - EXIT
   ```

3. **Report what changed** (bounded):
   ```bash
   git -C <workspace-root> diff --name-status -- scripts Makefile
   ```
   List the changed files and tell the user to review `git diff` before committing.
   Do not commit the tooling refresh automatically.

### Step 8: Exit cleanly

End with a one-line summary: the schema version before → after, whether tooling
was refreshed, and whether ADR records were backfilled (and in which repos). If a
conflict stopped the run, say so and name the offending fields.

## Notes

- `/lore:migrate` is the only command that writes `household.json`.
- The migration is shape-aware: a workspace already on `meta_repo` is just stamped
  with `schema_version`; a workspace with both keys set to different values is
  reported as a conflict rather than guessed.
- The ADR backfill never renames `deciders` to `decided_by`; the old key stays and is read.
