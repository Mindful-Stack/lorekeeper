---
name: recording-decisions
description: Architecture decision records (ADRs) from plain words. Use when a hard-to-reverse choice surfaces (framework, storage, auth, API contract, integration, hosting, data model); when a named person approved or rejected a proposed decision record; when a fact an accepted record relies on no longer holds; when a decision is replaced, superseded, deprecated or dropped; when asked which decisions bind a change, path or area; or to list or discover ADRs. Not for PR approvals, reversible conventions, or routine implementation choices.
---

# Recording Decisions

An architecture decision record captures one hard-to-reverse decision, the forces behind it, and
the consequences accepted by making it. It is written **before** the code that depends on it. The
user just says what they decided or what changed; this skill picks the action.

For example:

- "We'll use PostgreSQL for orders" (or a choice surfacing mid-design) → **record** a proposal.
- "Alex Doe approved kb/ADR-0004" → **ratify** it, naming Alex Doe.
- "billing-api/ADR-0002: invoices now exceed the 10k/day in F2" → **note a change** on the record.
- "What decisions apply to src/Billing?" → **what binds** the change.

## The rule

**Show the edit, confirm, then write. Never ratify on your own: a ratification needs a named
human**, never an agent. Accepted records are locked: what changed goes in an observation or a
replacing record, never an edit of the old body.

## How

Read `${CLAUDE_PLUGIN_ROOT}/commands/adr.md` and follow it: it holds the format, the actions and
the PR flow. `/lore:adr <plain words>` is the same thing as an explicit shortcut. For a decision
surfacing mid-brainstorm, draft the record and link it from the spec: the spec describes the
design, the record defends the decision.

**Not for** conventions reversible in an afternoon (a line in a standard or a learning) or routine
implementation choices (the PR description is enough).

## Red flags

| Rationalisation | Reality |
|-----------------|---------|
| "I'll write the ADR after it works" | Then it records a fait accompli, not a decision. Draft it now as proposed. |
| "This is obvious, nobody would choose otherwise" | Obvious decisions are re-litigated most. Name the alternative and the reason. |
| "It's in the design doc" | Design docs are point-in-time; the record is the durable, replaceable artefact. |
| "I'll just fix the accepted record" | Accepted records are locked. Note the change, or replace the record. |
| "I'll accept it so we can start" | Only a named human accepts. Ask who approved it; an agent never does. |
