---
title: "Device status events"
description: "What a device status event tells the services that consume it."
tags: [behaviour, device, events]
prefix: events
scope: ["backend:src/Application/Devices/Events/**"]
related: []
---

# Device status events

## Purpose
Other services react to device status changes. They need to know which project a device
belongs to without calling back.

## Rules

### events.R1 Status events carry the project
Every device status event SHALL carry the device's project id.
- Example: WHEN device D of project A changes status THEN the event names project A.

## Not yet decided
- none
