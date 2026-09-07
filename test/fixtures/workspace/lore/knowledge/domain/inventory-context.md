---
title: Inventory
description: Bounded context tracking stock levels per warehouse and reserving stock for orders.
tags: [domain, ddd, inventory]
---

# Inventory

## Purpose
Tracks stock per SKU and warehouse. Reserves stock on `OrderPlaced`, releases it on `PaymentFailed`.

## Key Entities
- **StockItem**, **Reservation**, **Warehouse**.
