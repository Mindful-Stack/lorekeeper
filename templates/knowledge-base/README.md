# Knowledge Base

A knowledge base consumed by the [lorekeeper](https://github.com/your-org/lorekeeper) Claude Code plugin.

## Structure

- `general/` — cross-repo standards
- `languages/` — language-specific rules
- `frameworks/` — framework-specific patterns
- `domain/` — bounded contexts and integrations
- `learnings/` — captured gotchas and tribal knowledge

## Maintenance

```bash
make validate      # Lint frontmatter, links, orphans
make build-index   # Rebuild _index.json (run after editing)
make check-index   # CI: verify _index.json is up to date
make test          # Run tooling tests
```

## Format

Every node has YAML frontmatter:

```markdown
---
title: Node Title
description: Brief description for agent discovery
tags: [tag1, tag2]
---
```

Use `[[wikilinks]]` to cross-reference other nodes.
