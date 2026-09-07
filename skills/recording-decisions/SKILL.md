---
name: recording-decisions
description: Use when a hard-to-reverse choice surfaces during design, planning, implementation, or review — a framework, storage, auth, API-contract, integration, hosting, or data-model choice — when a decision keeps getting re-debated, or when the user asks to record, list, accept, supersede, or discover architecture decision records (ADRs).
---

# Recording Decisions

An architecture decision record captures one hard-to-reverse decision, the forces behind it, and
the consequences accepted by making it. The record is written **before** the code that depends on
it, not reconstructed afterwards from archaeology.

## When to use

- A design or plan commits to a framework, datastore, auth scheme, API contract, integration
  pattern, hosting model, or data model.
- A review finds code that contradicts an accepted record, or makes a choice no record covers.
- The same question gets re-argued in a second conversation.
- The user asks for an ADR, or to list, accept, supersede, or discover them.

**Not for** local conventions reversible in an afternoon (one line in a standard or a learning) or
routine implementation choices (the PR description is enough).

## The rule

```
Hard-to-reverse decision reached → draft the record (status: proposed) → then build.
First code depends on it            → /lore:adr accept NNNN.
Changed your mind after acceptance  → /lore:adr supersede NNNN, never edit the old body.
```

## How

Read `${CLAUDE_PLUGIN_ROOT}/commands/adr.md` and follow it exactly — it holds the format, the
triage tiers, the interview, and the PR flow. For a decision surfacing mid-brainstorm, draft the
record and link it from the spec; the spec describes the design, the record defends the decision.

## Red flags

| Rationalisation | Reality |
|-----------------|---------|
| "I'll write the ADR after it works" | Then it records a fait accompli, not a decision. Draft it now as proposed; it takes ten minutes. |
| "This is obvious, nobody would choose otherwise" | Obvious decisions are the ones re-litigated most. Name the alternative and the reason. |
| "It's in the design doc" | Design docs are point-in-time and never updated; the record is the durable, supersedable artefact. |
| "I'll just fix the accepted record" | Accepted records are immutable. Supersede it so the history stays honest. |
