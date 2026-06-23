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

- **v1** — the implicit pre-versioning era. A manifest with **no**
  `schema_version` is *defined as* v1 (the starting version label). This
  absence-means-v1 rule is the only inference allowed; it is not a reader
  fallback.
- **v2** — the current `meta_repo` schema, now the first explicitly-stamped
  version.

Important: "v1" is a *version label*, not a guarantee about field shape. A
manifest can be unversioned yet already carry `meta_repo` (created after the
`workspace`→`meta_repo` rename but before version stamping). The migrator must
therefore be **shape-aware**, not assume the old key is present — see §4.

### 2. Single source of truth

`scripts/manifest-schema.json` → `{ "current": 2 }`.

- The bash SessionStart hook reads `current` via its existing inline `node -e`.
- The JS modules `require()` it.

No duplicated constant to drift.

Implementation notes:

- Pass paths into `node -e` via **env vars or argv**, never interpolated into the
  JS source — matching how the hook already passes the household.json path.
- **Failure behavior:** if `node` is unavailable or `manifest-schema.json` is
  unreadable, the hook **skips the schema-gate nag and preserves existing
  resolution behavior**. The gate must never break SessionStart.

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

**Composition with existing nags.** The schema comparison runs **whenever a
`household.json` is found**, independently of whether knowledge bases resolve
successfully (the hook can find the manifest but still fail to resolve KBs when
directories are missing). The schema warning is **appended to** the user-visible
message alongside any stale-KB / missing-KB nags, not gated behind the
"knowledge bases loaded" path.

### 4. Migration registry — `scripts/migrate-manifest.js`

A pure-JS, unit-tested module (mirrors the existing `init-detect.js` /
`cultivate-detect.js` precedent — the deterministic-transform case the
zero-runtime principle explicitly allows). Structure:

- An **ordered list** of migration steps, each `from N → N+1`.
- `migrate(manifest)` applies every step from the manifest's current version up to
  `current`, in order — a v1 workspace reaches v3 by chaining 1→2→3.
- **Idempotent**: re-running on an already-current manifest is a no-op.
- Modes: `--dry-run` (print the field diff without writing) and apply.
- Resolves the manifest's starting version with the absence-means-v1 rule from §1.

The v1→v2 step must be **shape-aware and conflict-safe** — absence of
`schema_version` does *not* imply the `workspace` key is present (a manifest may
already carry `meta_repo`). The transform branches on actual field shape:

| `workspace` | `meta_repo` | Action |
|---|---|---|
| present | absent | rename `workspace` → `meta_repo`, stamp `schema_version: 2` |
| absent | present | already correct shape — just stamp `schema_version: 2` |
| present | present, **same value** | delete `workspace`, stamp `schema_version: 2` |
| present | present, **different values** | **stop and report a conflict** — do not write |

A conflict (last row) is surfaced to the user with both values so they can resolve
it by hand; the migrator makes no guess. This is migration logic, not runtime
reading, so it does not violate the "no reader fallback" principle.

### 5. `/lore:migrate` command (the only manifest writer)

`commands/migrate.md` orchestrates:

1. Read the workspace `schema_version` (default 1). If already `current` →
   "Schema up to date (v2). Nothing to migrate." and stop.
2. **Dirty-state preflight (manifest):** if `household.json` has uncommitted
   changes, **stop** before applying — ask the user to commit or stash first.
   "Review `git diff` before committing" does not protect against clobbering
   uncommitted edits.
3. Run `migrate-manifest.js --dry-run` → show the exact field diff + the version
   bump. If the migrator reports a **conflict** (§4 last row), stop and surface it.
4. Confirm with the user. On yes, apply: rewrite `household.json` with the
   shape-aware transform and `schema_version` bumped.
5. **Tooling refresh offer** (opt-in second step — phrased as an optional refresh,
   not a staleness claim):
   `This migration can also refresh template-managed tooling (scripts/ and Makefile) from the current witan-household template. This overwrites those paths. Refresh? [y/N]`
   On yes:
   - **Dirty-state preflight (tooling):** if `scripts/` or `Makefile` have
     uncommitted changes, stop or require a second explicit confirmation before
     overwriting — git only protects committed state.
   - Shallow-clone the template to a temp dir; copy `scripts/` + `Makefile` with
     mode preservation (`cp -a` semantics).
   - **Report changed files** afterward via a bounded
     `git diff --name-status -- scripts Makefile` so the user sees exactly what
     happened, then reviews `git diff` before committing.
   - Clean up the temp clone on success **and** on failure.
   Best-effort, clearly bounded, never silent.

`/lore:migrate` is the **only** command that writes `household.json`.

### 6. Template + init stamp new workspaces

The template's `household.json` ships with `"schema_version": <current>`. But
`/lore:init` must **not rely on the template alone** — after copying the scaffold
it explicitly sets `schema_version` from `scripts/manifest-schema.json` (the
plugin's own source of truth). Otherwise a future plugin scaffolding from a stale
template would immediately produce a drift nag on a brand-new workspace.

### 7. Readers stay clean

`cultivate-detect.js` and `/lore:onboard` keep reading `meta_repo` with no
fallback. The gate catches stale workspaces; once migrated they read correctly.
Accepted cost: an un-migrated workspace mis-filters its meta-repo until the user
acts on the nag — acceptable under "nag, don't block."

## Testing

- `scripts/__tests__/migrate-manifest.test.js`:
  - Idempotency: applying to an already-v2 manifest is a no-op.
  - Chained 1→3 (once a third version exists; structure must support it).
  - Missing `schema_version` is treated as v1.
  - Already-current → no changes, reports nothing to do.
  - **Shape-aware v1→v2 cases** (the §4 table):
    - no version + `workspace` only → rename + stamp v2.
    - no version + `meta_repo` only → stamp v2, no rename.
    - both keys, same value → drop `workspace`, stamp v2.
    - both keys, different values → reports a conflict, writes nothing.
  - **Registry integrity:** migration steps are contiguous (`from`/`to` form an
    unbroken chain) and the final step's `to` equals `manifest-schema.current`.
- Hook test (`scripts/__tests__/load-standards-hook.test.js`):
  - Drift nag fires when workspace `<` current.
  - Reverse nag fires when workspace `>` current.
  - Silent when equal.
  - Schema nag composes with a missing-KB nag (both appear) when household.json is
    found but KBs don't resolve.
  - Hook degrades gracefully (no crash, existing resolution intact) when
    `manifest-schema.json` is unreadable.

## Release

- New command + hook change + template change ⇒ **MINOR** bump: `1.1.0 → 1.2.0`.
- Keep the three plugin manifests in sync (`.claude-plugin/plugin.json`,
  `package.json`, witan marketplace listing) — the marketplace bump is a
  companion PR in `Mindful-Stack/witan`.
- The template change (`schema_version` in `household.json`) is a separate PR to
  `Mindful-Stack/witan-household`.

### Housekeeping (part of the same PR)

- Add `/lore:migrate` to the user-facing command lists: `commands/help.md`, the
  README command table, and any scenario expectations that enumerate commands.
- Update `CLAUDE.md`'s "the only executable code is the hook and
  `init-detect.js`" wording to also list `migrate-manifest.js` (and note
  `cultivate-detect.js` if currently omitted).

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
