---
description: Review current PR or local changes using team standards. Supports PRs, local changes, commits, and staged changes.
---

# Review Command

Invoke the `lore:reviewing-changes` skill with the Skill tool and follow it exactly as presented
to you. This file only routes the command; the procedure, including the required ADR check, is in
that skill.

Pass through any arguments the user provided (e.g., `pr`, `pr 123`, `changes`, `commit`, `staged`, `last 3`, `patch <file> body <file> repo <name>`).
