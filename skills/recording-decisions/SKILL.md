---
name: recording-decisions
description: Use when a hard-to-reverse choice surfaces during design, planning, implementation, or review (a framework, storage, auth, API-contract, integration, hosting, or data-model choice); when someone says a decision or proposal was approved or rejected; when a fact a decision relies on changed; when a decision is replaced or no longer applies; when asked which decisions apply to a change or area; or when asked to list or discover architecture decision records (ADRs).
---

# Recording Decisions

An architecture decision record captures one hard-to-reverse decision, the forces behind it, and
the consequences accepted by making it. It is written **before** the code that depends on it. The
user just says what they decided or what changed; this skill picks the action.

## You say → it does

| You say | It does |
|---|---|
| "We'll use PostgreSQL for orders" (or a choice surfaces mid-design) | **record**: triage, a short interview, a proposed record, a PR |
| "Alex Doe approved kb/ADR-0004" / "Sam rejected 0003" | **ratify**: accepts or rejects the proposal, naming that person |
| "F2 in billing-api/ADR-0002 no longer holds: invoices hit 14k/day" | **note a change**: a dated observation on the record |
| "Replace 0002: sessions move to bearer tokens" | **replace**: a new record that supersedes the old one |
| "0005 no longer applies, Sam decided" | **retire**: marks it deprecated |
| "Which decisions apply if I change src/Payments?" | **what binds**: the accepted records and rules that apply |
| "List our decisions" / "find the decisions the code already made" | **list** / **discover** |

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
