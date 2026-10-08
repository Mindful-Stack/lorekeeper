---
id: <home>/ADR-NNNN
title: "ADR-NNNN: <short title — may state the decision>"
description: "<the decision in one sentence, with its strongest because>"
tags: [adr, <topic>]
status: proposed            # proposed | accepted | rejected | deprecated | superseded
date: YYYY-MM-DD
decided_by: []              # named humans; required once accepted
consulted: []
confidence: medium          # high | medium | low
reversibility: one-way      # one-way | two-way
blast_radius: service       # local | service (local home); cross-service | customer (shared home)
sensitivity: []             # any of: security, privacy, billing, legal, contract
scope: []                   # local: ["src/Billing/**"]; shared: ["billing-api:src/**"]
supersedes: []
superseded_by:
depends_on: []
related: []
implements: []              # reserved: behaviour-spec rule ids
rfc:                        # optional URL
aliases: []
---

# ADR-NNNN: <short title>

## Status
Proposed YYYY-MM-DD.

## Context
<Value-neutral facts a proponent of the losing option would accept.>

## Facts relied on
- F1 <checkable statement> — source: <where an agent can verify it>

## Considered options
- **<A>** — one honest advantage.
- **<B>** — one honest advantage.

## Decision
<One falsifiable sentence, active voice, named actor, strongest because.>

- **R1** <MUST / MUST NOT rule a reviewer can hold code against>

## Consequences
- <Complete claims with reasons; at least one real negative.>

## Assumptions and invalidation triggers
- *Assumes <X>.* Trigger: <concrete event> ⇒ supersede.

## Later observations
<!-- append-only, accepted records only; newest last -->

## See also
- Related records by qualified id, and the RFC.
