---
title: Device
description: Bounded context for field devices assigned to projects, their status, and last-seen heartbeat.
tags: [domain, ddd, device]
---

# Device

## Purpose
A Device belongs to a Project and reports a heartbeat. Status is derived from the last heartbeat age.

## Key Entities
- **Device** — id, project id, status (Online, Offline, Unknown), last seen.
- **Project** — owns devices; authorisation scope for device queries.
