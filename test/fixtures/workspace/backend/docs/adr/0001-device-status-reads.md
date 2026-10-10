---
id: backend/ADR-0001
title: "ADR-0001: Device status is read from the device repository, not cached"
description: "The backend reads device status from IBaseDeviceRepository on every query because status changes within seconds and a stale status misleads operators."
tags: [adr, device, cqrs]
status: accepted
date: 2026-09-15
decided_by: [Sam Roe]
consulted: []
confidence: medium
reversibility: two-way
blast_radius: service
sensitivity: []
scope: ["src/Application/Devices/**"]
supersedes: []
superseded_by:
depends_on: []
related: []
implements: []
rfc:
---

# ADR-0001: Device status is read from the device repository, not cached

## Status
Proposed 2026-09-12.
Accepted 2026-09-15 by Sam Roe.

## Context
Device status queries back the operator dashboard. A device reports a new status every few
seconds, and operators act on what the dashboard shows.

## Facts relied on
- F1 Devices report status at least every 10 seconds — source: `src/Domain/Devices/Device.cs`

## Considered options
- **Read through on every query** — the dashboard never shows a stale status.
- **Cache status for 30 seconds** — fewer repository reads under load.

## Decision
The backend reads device status from `IBaseDeviceRepository` on every query, because a status
older than one report interval misleads operators.

- **R1** Device status queries MUST NOT read from an in-process or distributed cache.

## Consequences
- Every dashboard refresh costs one repository read per device, so very large projects load more
  slowly.

## Assumptions and invalidation triggers
- *Assumes dashboards show at most 500 devices at once.* Trigger: a project with more than 500
  devices ⇒ supersede.

## Later observations
<!-- append-only, accepted records only; newest last -->

## See also
- The device bounded context in the knowledge base.
