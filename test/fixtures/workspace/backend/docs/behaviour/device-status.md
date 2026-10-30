---
title: "Device status"
description: "Which devices a status read returns, and how fresh their status is."
tags: [behaviour, device]
prefix: device
scope: ["src/Application/Devices/**"]
related: [backend/ADR-0001]
---

# Device status

## Purpose
Operators read device status to decide whether to send someone on site. A wrong or stale status
sends people to the wrong place.

## Rules

**Reading status**

### device.R1 Status is read fresh
A status read SHALL return the status the device last reported, never a cached copy.
- Example: WHEN a device reports offline THEN the next read shows offline.
- Source: backend/ADR-0001.R1

### device.R2 Project scoped
A status read for a project SHALL return only that project's devices.
- Example: WHEN project A is read THEN no device of project B appears.

### device.R3 Offline is shown
A device that has not reported for five minutes SHALL be shown as offline.
- Example: WHEN a device last reported six minutes ago THEN it reads as offline.

## Known deviations
- device.R3: devices are shown online until their next report (DEV-1).

## Not yet decided
- none
