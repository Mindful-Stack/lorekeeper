# Codex runtime adaptation

Lorekeeper's canonical workflows live in `commands/` and `agents/` because the
same repository remains a Claude Code plugin. Apply these rules when following
one of those files in Codex.

## Resolve knowledge paths

If the conversation already contains `Knowledge path:` and `Team knowledge
path:` markers, use them. Otherwise resolve the paths before continuing:

1. Read `.lorekeeper/config.json` in the current working directory. Its
   `knowledgeBasePath` wins; resolve a relative value against the working
   directory. An invalid explicit path is an error and must not fall through.
2. Otherwise use `KNOWLEDGE_BASE_PATH`. An invalid explicit path is an error and
   must not fall through.
3. Otherwise walk up from the working directory, at most six parents, looking
   for `household.json`. Resolve `shared_knowledge_bases` in listed order, then
   `knowledge_base` (default `lore`) relative to that household root. Retain
   entries that contain `knowledge/`; the final entry is the writable team KB.
4. Otherwise try `./lore`, `./docs/lore`, `./docs/shared-knowledge`,
   `./shared-knowledge`, and `./knowledge`. Accept a candidate containing either
   `knowledge/` or `knowledge.config.json`.

Treat each resolved `knowledge/` directory as a `Knowledge path:`, ordered from
lowest to highest priority. Treat the final path as `Team knowledge path:`.
Higher-priority files replace lower-priority files at the same relative path.

## Translate Claude-specific instructions

- A path beginning `${CLAUDE_PLUGIN_ROOT}` means the Lorekeeper plugin root.
  From a Codex wrapper skill, that root is two directories above its `SKILL.md`.
- A `/lore:name` invocation means the `$lore-name` skill or an equivalent
  natural-language request in Codex.
- `AskUserQuestion` means ask the user directly before the consequential step.
- A `Task tool` or named Lorekeeper agent means delegate to the corresponding
  `lore-*` skill when subagents are available; otherwise perform the procedure
  inline.
- `Glob`, `Grep`, `Read`, `Write`, and `Bash` mean the equivalent available
  filesystem and shell tools.
- Instructions to restart or reload Claude Code mean start a new Codex session.
- Claude-only plugin update instructions should be replaced with
  `codex plugin marketplace upgrade lorekeeper` followed by
  `codex plugin add lore@lorekeeper`.

Do not run Claude's SessionStart hook from Codex. Resolve paths on demand using
the rules above. This keeps the core workflow usable on Codex surfaces where
plugin hooks are unavailable or disabled.
