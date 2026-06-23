# Durable workspace-schema versioning + migration

**Date:** 2026-06-24
**Status:** Approved design — ready for implementation plan
**Repos touched:** `lorekeeper` (plugin), `witan-household` (template)

## Problem

A witan-household workspace consumes Lorekeeper through two channels with very
different update characteristics:

- **The plugin** auto-updates (marketplace `/plugin update`, devcontainer
  rebuild). It rolls forward on its own.
- **The workspace** is inert. It was copy-scaffolded from the
  `Mindful-Stack/witan-household` *template* at creation time and has no git
  link back to it. Template improvements and — critically — `household.json`
  **schema changes** never reach it.

There is currently **no coordination** between the two. When the plugin changes
its contract with the manifest, every existing workspace silently drifts out of
compatibility with no signal and no fix path except hand-editing.

This already happened: the `workspace` → `meta_repo` field rename (lorekeeper
commit d57ac36). The only transition cushion was Reeve's serde alias accepting
both keys, and that is being deliberately retired across all three Witan tools.
Lorekeeper's JS readers (`cultivate-detect.js`, `/lore:onboard`) now read
`meta_repo` with no fallback. A workspace still on the old key (e.g. the live
`Grantigo/grantigo-workspace`) silently mis-filters its meta-repo.

## Goals

1. Make schema drift **visible** to the user instead of silent.
2. Provide a **one-command fix** so bringing a workspace up to date is not manual
   editing.
3. Keep the plugin's manifest readers **clean** — no accreted backward-compat
   fallbacks (per the maintainer's explicit preference: aliasing lowers the
   quality of the plugin's context).

## Non-goals

- **Reader-level backward compatibility.** Readers assume the current schema. The
  version gate is the single chokepoint that catches stale workspaces; we do not
  add `?? workspace`-style fallbacks anywhere.
- **Reeve coordination.** `schema_version` is additive; Reeve's parser ignores
  unknown fields, so it is unaffected. If a future schema change touches a field
  Reeve depends on, that cross-tool coordination is a separate concern.
- **Splitting `scripts/` into its own submodule.** Noted as a future
  consideration; explicitly out of scope here.

## Decisions (locked during brainstorming)

| Question | Decision |
|---|---|
| Where does the manifest **write** live, given `/lore:doctor` is read-only? | New **`/lore:migrate`** command. Doctor only *detects* and reports. |
| Migration **scope**? | Manifest schema is the deterministic core; **tooling re-sync is an opt-in second step**. |
| Gate **strictness** when workspace < plugin? | **Nag, don't block.** Hook surfaces it every session; commands still run. |
| Version **numbering**? | Monotonic **integer**, decoupled from plugin semver. |

## Design

### 1. The `schema_version` field

`household.json` gains one top-level field: `"schema_version": <integer>`.

- **v1** — the implicit pre-versioning era (the `workspace`-key schema). A
  manifest with **no** `schema_version` is *defined as* v1. This absence-means-v1
  rule is the only inference allowed; it is not a reader fallback.
- **v2** — the current `meta_repo` schema, now the first explicitly-stamped
  version.

### 2. Single source of truth

`scripts/manifest-schema.json` → `{ "current": 2 }`.

- The bash SessionStart hook reads `current` via its existing inline `node -e`.
- The JS modules `require()` it.

No duplicated constant to drift.

### 3. The hook gate — detect + nag (never blocks)

After the `household.json` walk-up resolves the manifest, the hook reads
`schema_version` (default 1 when absent) and compares to `current`:

- **workspace < current** → user-visible `systemMessage`:
  `⚠️  Workspace schema 1 < plugin schema 2. Run /lore:migrate. Some commands may misbehave until you do.`
- **workspace > current** → reverse nag:
  `Workspace schema is newer than this plugin — run /plugin update lorekeeper@witan.`
- **equal** → silent.

This is a `systemMessage` (user-visible, hidden from the model) — consistent with
the hook's convention that warnings go to the user, markers go to the model. No
new model-facing marker is added. Commands keep running.

### 4. Migration registry — `scripts/migrate-manifest.js`

A pure-JS, unit-tested module (mirrors the existing `init-detect.js` /
`cultivate-detect.js` precedent — the deterministic-transform case the
zero-runtime principle explicitly allows). Structure:

- An **ordered list** of migration steps, each `from N → N+1`, e.g.:

  ```js
  { from: 1, to: 2, describe: 'rename `workspace` → `meta_repo`',
    transform: (m) => { m.meta_repo = m.workspace; delete m.workspace; return m; } }
  ```

- `migrate(manifest)` applies every step from the manifest's current version up to
  `current`, in order — a v1 workspace reaches v3 by chaining 1→2→3.
- **Idempotent**: re-running on an already-current manifest is a no-op.
- Modes: `--dry-run` (print the field diff without writing) and apply.
- Resolves the manifest's starting version with the absence-means-v1 rule from §1.

### 5. `/lore:migrate` command (the only manifest writer)

`commands/migrate.md` orchestrates:

1. Read the workspace `schema_version` (default 1). If already `current` →
   "Schema up to date (v2). Nothing to migrate." and stop.
2. Run `migrate-manifest.js --dry-run` → show the exact field diff + the version
   bump.
3. Confirm with the user. On yes, apply: rewrite `household.json` with fields
   renamed and `schema_version` bumped.
4. **Tooling-sync offer** (opt-in second step):
   `Your scripts/ / Makefile look older than the template. Re-sync from Mindful-Stack/witan-household? [y/N]`
   On yes: shallow-clone the template to a temp dir, copy `scripts/` + `Makefile`
   over, and list what changed. **git is the safety net** — the user reviews
   `git diff` before committing. Best-effort, clearly bounded, never silent.

`/lore:migrate` is the **only** command that writes `household.json`.

### 6. Template + init stamp new workspaces

Both the template's `household.json` and `/lore:init`'s scaffold write
`"schema_version": <current>`, so freshly-created workspaces are never drifted.

### 7. Readers stay clean

`cultivate-detect.js` and `/lore:onboard` keep reading `meta_repo` with no
fallback. The gate catches stale workspaces; once migrated they read correctly.
Accepted cost: an un-migrated workspace mis-filters its meta-repo until the user
acts on the nag — acceptable under "nag, don't block."

## Testing

- `scripts/__tests__/migrate-manifest.test.js`:
  - 1→2 renames `workspace` → `meta_repo`.
  - Idempotency: applying to an already-v2 manifest is a no-op.
  - Chained 1→3 (once a third version exists; structure must support it).
  - Missing `schema_version` is treated as v1.
  - Already-current → no changes, reports nothing to do.
- Hook test (`scripts/__tests__/load-standards-hook.test.js`):
  - Drift nag fires when workspace `<` current.
  - Reverse nag fires when workspace `>` current.
  - Silent when equal.

## Release

- New command + hook change + template change ⇒ **MINOR** bump: `1.1.0 → 1.2.0`.
- Keep the three plugin manifests in sync (`.claude-plugin/plugin.json`,
  `package.json`, witan marketplace listing) — the marketplace bump is a
  companion PR in `Mindful-Stack/witan`.
- The template change (`schema_version` in `household.json`) is a separate PR to
  `Mindful-Stack/witan-household`.

## Validation on grantigo (the live test)

1. Update the plugin to 1.2.0 (host + container).
2. Open a session in `grantigo`: its manifest has no `schema_version` → reads as
   v1 → hook nags.
3. Run `/lore:migrate`: renames `workspace` → `meta_repo`, stamps
   `schema_version: 2`, then offers to sync grantigo's 18-May tooling (pulling in
   `repo-rename` + setup selection modes — closing the loop on the original
   "how do updates reach grantigo" question).
4. Verify `/lore:cultivate` filters the meta-repo correctly afterward, and the
   next session's hook is silent.
