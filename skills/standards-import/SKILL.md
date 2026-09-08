---
name: standards-import
description: >
  Build or import coding-standard nodes (languages/*, frameworks/*, general/*) into the
  knowledge base and validate them against the actual codebase. Use when the user asks to
  "import standards from another project", "document our C#/React/whatever conventions",
  "bootstrap the knowledge base from the code", or "check the standards against the code and
  list deviations". Produces adapted nodes with every disagreement marked, then puts each
  disagreement to the user as a decision (fix the code, or fix the standard).
---

# Standards Import

Turn "how we actually write code" into knowledge-base nodes, optionally starting from another
project's nodes, and surface every place where the standard and the code disagree so the team can
decide which one moves.

## Inputs

Establish these before starting. Ask only for what cannot be inferred.

| Input | How to get it |
|-------|---------------|
| Target KB | The `Team knowledge path:` marker in the session context. Nodes go under `<team-knowledge-path>/knowledge/`. If no marker is present, ask (or point the user at `/lore:init`). |
| Scope | Which nodes: e.g. `languages/csharp`, `frameworks/react`, `general/code-comments`. From the user's request; propose additions after the survey. |
| Source (optional) | Another project's KB directory to import from, e.g. `../other-project/lore/knowledge/languages/csharp/`. Read every `.md` there in full. |
| Node conventions | The target KB's `README.md`: frontmatter shape (`title`, `description`, inline `tags`), wikilink form, and how it validates (`make validate` in a witan-household). |

## Workflow

### 1. Read the source nodes (if importing)

Read each source node completely. Note every claim it makes about the source codebase (package
versions, file paths, counts, project names, ticket links). Each of those is a fact to re-verify or
replace, never to copy. Strip the source project's name, ticket links and internal paths; the
target KB must not name the source organisation.

### 2. Survey the codebase for evidence

Do not write from memory of what "good C#" or "good React" is. Measure. For each rule in the source
node (or each rule you would expect a node of that kind to have), find the count on both sides:

- **Greps for the mechanical rules** (namespace style, null-check form, naming prefixes, suffixes,
  braces, trailing commas, collection literals, logging calls, blocking waits, cancellation,
  transaction use, custom exceptions, catch shapes).
  `references/csharp-survey.sh` is a ready battery for C#/.NET; write an equivalent for other stacks.
- **An Explore agent for the structural conventions** (component authoring, lifecycle usage, state
  management, service shapes, routing). Ask it for file:line evidence and short verbatim snippets,
  counts per variant where the code is inconsistent, and no editorialising.
- **Read three or four representative files end to end** so the snippets you quote are real.

Record every measurement; the numbers go into the nodes and the decisions.

### 3. Write the nodes

Write each node as the **target standard for this codebase**, grounded in what the survey found:

- Quote real code from this repository, with the real project and file names.
- State stack facts that are simply true (framework version, compiler settings, what exists and
  what does not).
- Where the code is consistent, the node states the rule and cites the count.
- Where the imported standard and the code disagree, or the code is split, write the rule the
  evidence supports and add an **`> **Open:**`** callout right there describing the disagreement,
  the counts, and a proposed resolution. Do not silently pick one.
- Cross-link only to nodes that exist or that you are creating in this run. Dangling wikilinks
  fail validation.
- Replace `_starter.md` placeholders in a category once it has a real node.

Typical set for one language: `code-style`, `error-handling`, `review-checklist`. For a UI
framework: `patterns`, `<template-syntax>` (e.g. `razor-syntax`, `jsx-conventions`),
`review-checklist`, plus `state-and-realtime` or similar when the client has non-trivial state.
If the survey shows a strong house convention with no node (a comment style, a testing harness,
a commit-message style), write it or propose it.

### 4. Validate

Run the KB's validation (`make validate` from a witan-household root). Fix frontmatter, links and
orphans before going on.

### 5. Put the decisions to the user

Collect every `Open` callout into one list. Present them with `AskUserQuestion`, up to four
questions per call, each with options of the shape:

- **Standard follows the code** (Recommended when the code is consistent and reasonable)
- **Code follows the standard** (creates work: say roughly how much, e.g. "~75 call sites")
- **Defer**: leave the Open marker in the node

Group related items into one question where the answer is likely the same. Include the counts in
the option descriptions so the user can judge the cost. Also present the assumptions you made
(what you deleted, moved, or linked) and the list of further nodes worth writing, as their own
questions.

### 6. Apply the decisions

- *Standard follows the code*: rewrite the rule as the code's behaviour and delete the `Open` callout.
- *Code follows the standard*: keep the rule, delete the callout, and record the gap as an issue
  or a `learnings/` node (ask which). Link the issue from the node. Do not start the code
  migration inside this workflow.
- *Defer*: leave the callout in place.

Re-run validation. Then ship the KB change the way this KB ships changes: dispatch the
**knowledge-updater** agent (branch, commit, PR) when the KB is its own repo with a protected
main; commit on a branch and open a PR yourself when the KB lives inline in a code repo.

## Output to the user

A short report: which nodes were created, the decisions taken and what each changed, the deferred
items, and the recommended next nodes. Link the node files.

## References

- `references/csharp-survey.sh`: grep battery for C# / ASP.NET Core / EF Core / Blazor codebases.
  Run it from the solution root; every line prints a count or a sample you can paste into a node.
