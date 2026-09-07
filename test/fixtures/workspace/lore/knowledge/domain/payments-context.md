---
title: Payments
description: Bounded context that creates and settles payments once an order is placed or a checkout completes.
tags: [domain, ddd, payments]
---

# Payments

## Purpose
Owns the lifecycle of a Payment: created, authorised, captured, refunded.

## Key Entities
- **Payment** — one attempt to collect money for an order.
- **PaymentMethod** — card, invoice, or wallet.

## Events
- Consumes `OrderPlaced` and `CheckoutCompleted` — either event triggers creation of a Payment.
- Publishes `PaymentCaptured` and `PaymentFailed`.

## Ubiquitous Language
Capture, authorise, settle, refund.
