# CLAUDE.md

Guidance for Claude Code when editing this knowledge base.

## Structure

```
knowledge/
├── general/        # Cross-repo standards
├── languages/      # Language-specific
├── frameworks/     # Framework-specific
├── domain/         # Bounded contexts
└── learnings/      # Tribal knowledge
```

## Commands

```bash
make validate       # Run all validators
make build-index    # Rebuild _index.json
make check-index    # CI verification
make test           # JS tests for tooling
```

## Editing rules

- Every node needs YAML frontmatter (`title`, `description`, `tags`).
- Files prefixed with `_` (e.g., `_starter.md`) are entry points and may be orphaned.
- Use `[[path/to/node]]` for cross-references.
- Run `make build-index` after adding/renaming/removing files.
