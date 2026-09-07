---
title: Backend Architecture
description: CQRS with MediatR command and query handlers in the Application layer, authorised via IAuthorizedQuery and IAuthorizedCommand.
tags: [dotnet, cqrs, mediatr, architecture, handlers]
---

# Backend Architecture

The backend follows **CQRS** using **MediatR**. Every use case is a command or query record plus one handler
in the Application layer (`src/Application/<Area>/Commands|Queries/<Name>/`).

- Queries implement `IAuthorizedQuery<TScope>`; commands implement `IAuthorizedCommand<TScope>`.
- Handlers depend on repository interfaces (`IBaseDeviceRepository`, `IPaymentRepository`), never on DbContext.
- DTOs are `record` types named `<Thing>Dto`, living next to their query.
- Unit tests mock repositories with NSubstitute and follow `<Handler>Tests` naming.
