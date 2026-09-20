---
title: MediatR handlers must live in the Application assembly
description: Handlers placed outside the Application assembly are never registered because DI scans only that assembly.
tags: [dotnet, mediatr, gotcha]
confidence: verified
---

# MediatR handlers must live in the Application assembly

DI registers handlers with `AddMediatR(typeof(ApplicationAssemblyMarker))`. A handler in another project compiles but is never resolved.
