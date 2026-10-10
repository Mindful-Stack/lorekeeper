---
id: kb/ADR-0001
title: "ADR-0001: Payments react to OrderPlaced events, never to synchronous calls"
description: "The payments service creates a payment only when it consumes an OrderPlaced event, because a synchronous call from orders would couple their availability."
tags: [adr, payments, events]
status: accepted
date: 2026-09-10
decided_by: [Alex Doe]
consulted: [Sam Roe]
confidence: high
reversibility: one-way
blast_radius: cross-service
sensitivity: [billing]
scope: ["backend:src/Payments/**", "backend:src/Orders/**"]
supersedes: []
superseded_by:
depends_on: []
related: []
implements: []
rfc:
---

# ADR-0001: Payments react to OrderPlaced events, never to synchronous calls

## Status
Proposed 2026-09-05.
Accepted 2026-09-10 by Alex Doe.

## Context
Orders and payments are separate bounded contexts. An order must be placed even when the payment
provider is slow, and a payment must never be taken for an order that was not placed.

## Facts relied on
- F1 Orders publish `OrderPlaced` after the order is committed — source: `src/Orders/OrderService.cs`
- F2 The payment provider supports webhooks v1 only — source: provider API documentation

## Considered options
- **Event-driven** — orders stay available when payments is down.
- **Synchronous call from orders** — the caller learns the payment outcome immediately.

## Decision
The payments service creates a payment only when it consumes an `OrderPlaced` event, because a
synchronous call would make placing an order depend on the payments service being up.

- **R1** The orders service MUST NOT call the payments service synchronously.
- **R2** A payment MUST be created only from a consumed `OrderPlaced` event.

## Consequences
- The checkout page cannot show the payment outcome in the same request; it polls instead.

## Assumptions and invalidation triggers
- *Assumes the message broker delivers at least once.* Trigger: moving to a broker without
  at-least-once delivery ⇒ supersede.

## Later observations
<!-- append-only, accepted records only; newest last -->

## See also
- [[domain/payments-context]]
