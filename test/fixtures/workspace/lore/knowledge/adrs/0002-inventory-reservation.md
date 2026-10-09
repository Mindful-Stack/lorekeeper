---
id: kb/ADR-0002
title: "ADR-0002: Inventory is reserved when an order is placed"
description: "Inventory reserves stock on OrderPlaced and releases it on cancellation, because reserving at payment time oversells popular items."
tags: [adr, inventory, events]
status: proposed
date: 2026-10-01
decided_by: []
consulted: []
confidence: medium
reversibility: one-way
blast_radius: cross-service
sensitivity: []
scope: ["backend:src/Inventory/**"]
supersedes: []
superseded_by:
depends_on: [kb/ADR-0001]
related: []
implements: []
rfc:
aliases: []
---

# ADR-0002: Inventory is reserved when an order is placed

## Status
Proposed 2026-10-01.

## Context
Stock is decremented when payment completes today. During sales, several orders pay for the last
item at once.

## Facts relied on
- F1 Stock is decremented in the payment-completed handler — source: `src/Inventory/StockHandler.cs`

## Considered options
- **Reserve on OrderPlaced** — no overselling.
- **Decrement on payment** — no stock held by abandoned orders.

## Decision
The inventory service reserves stock when it consumes `OrderPlaced` and releases it on
cancellation, because reserving at payment time oversells popular items.

- **R1** Stock MUST be reserved from the `OrderPlaced` handler.

## Consequences
- Abandoned orders hold stock until they are cancelled.

## Assumptions and invalidation triggers
- *Assumes abandoned orders are cancelled within an hour.* Trigger: abandoned orders held longer
  than a day ⇒ supersede.

## Later observations
<!-- append-only, accepted records only; newest last -->

## See also
- [[adrs/0001-payment-events]]
