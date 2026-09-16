---
name: standards-import
description: >
  Write, import, or audit coding-standard nodes (languages/*, frameworks/*, general/*) against
  what the codebase actually does. Use when the user asks to "import standards from another
  project", "document our C#/React/whatever conventions", "bootstrap the knowledge base from the
  code", or "check the standards against the code and list deviations". Measures every rule
  before stating it, marks each disagreement between rule and code, and puts the disagreements to
  the user as decisions rather than resolving them silently.
---

# Standards Import

Turn "how we actually write code" into knowledge-base nodes, and surface every place where the
standard and the code disagree so the team decides which one moves.

The failure this skill exists to prevent is a standard that misstates the codebase. A rule nobody
follows, or a count that is wrong, is worse than no node at all: it gets quoted in review and it
teaches new contributors something false. Everything below serves that.

## Step 0 — Pick the mode, and the scope

Three modes. Decide from the user's words; ask if genuinely ambiguous.

| Mode | The user asked for | Ends with |
|------|--------------------|-----------|
| **Audit** | "check the standards against the code", "are our docs still true?", "list deviations" | A report. **No files written, no PR.** |
| **Import** | "import the standards from `<project>`", "bring over their C# nodes" | Drafted nodes, decisions, one PR |
| **Author** | "document our conventions", "bootstrap the KB from the code" | Drafted nodes, decisions, one PR |

**Audit mode stops at Step 6.** Do not drift from an audit into writing nodes. If the audit shows
work worth doing, say so and let the user ask for it.

Fix the scope now: which nodes, by path. `languages/csharp`, `frameworks/react`,
`general/code-comments`. Do not create nodes outside the agreed scope. If the survey turns up a
strong convention with no node, *propose* it in Step 6 and let the user choose.

## Step 1 — Resolve the paths

The SessionStart hook injects `Knowledge path:` markers (read sources, priority order lowest to
highest) and one `Team knowledge path:` marker (the default write target).

**Each marker already points at the `knowledge/` directory.** Categories sit directly beneath it:

```
<knowledge-path>/languages/csharp/code-style.md
<knowledge-path>/frameworks/react/patterns.md
```

Never append `knowledge/` to a marker. The KB repo root, where `README.md` and the validation
tooling live, is the marker's parent directory.

If no `Team knowledge path:` marker is present, the hook has already told the user the KB is not
configured. Say so and stop.

## Step 2 — Load what already exists

Before measuring anything, read the standards already in force, so this run extends them instead
of contradicting them:

1. Every `Knowledge path:` marker, for nodes at or near the scope paths. Remember which KB each
   file came from; a higher-priority KB replaces a lower one **whole-file**, never section by
   section.
2. The repo's own `docs/standards/` if it exists. Repo-local standards outrank the KB.
3. The target KB's `README.md`, for the node conventions: frontmatter fields, inline `tags`,
   wikilink form, and how the KB validates.

Note which scope files already exist and which KB owns each. An existing file is **updated in its
owning KB**, never copied into the team KB. For a genuinely new cross-cutting node
(`general/`, `languages/`, `frameworks/`) when more than one KB is configured, ask the user which
KB it belongs in and carry that answer to Step 8.

## Step 3 — Read the source nodes (import mode only)

Read each source node in full. Every claim it makes about *its* codebase — versions, paths, counts,
file names, ticket links, "we always X" — is a claim to re-verify here or drop. Never carry one
across. Strip the source project's name, internal URLs and ticket references: the target KB must not
name another organisation.

## Step 4 — Measure, before you write a single rule

Use `Grep`, `Glob` and `Read`. That is enough, and it is what this plugin does everywhere else.

**Do not ship a survey script, and do not trust an unvalidated pattern.** Search tools disagree:
the same bracket expression can match under one `grep` implementation and match nothing under
another, and a malformed pattern can fail while the surrounding pipeline still reports a tidy
number. A count you did not sanity-check is a guess wearing a number.

For every pattern, before the number goes anywhere:

1. **Prove it matches.** Run it and read a handful of hits. Are they the construct you meant?
2. **Prove it misses.** Find a file you know contains the construct and confirm the pattern finds
   it. A zero is a claim too, and usually a broken pattern.
3. **Know the population.** Fix one file-selection rule (which extensions, which directories
   excluded — build output, vendored code, generated migrations) and use the same one for the
   numerator and the denominator. "45 of 52" means nothing if the two halves searched different
   trees.
4. **Know what the number counts.** Matching lines are not occurrences; two calls on one line
   count once. Comments and string literals count as code. Say which you mean.

Reach for a subagent when the convention is structural rather than textual — component authoring,
lifecycle use, state management, service shapes, routing. Ask it for `file:line` evidence, short
verbatim snippets, counts per variant where the code is inconsistent, and no opinions.

Then **read three or four representative files end to end**, so every snippet you quote is real
code from this repository rather than a plausible reconstruction.

What is worth measuring, for most stacks:

- **Naming** — casing per construct, field prefixes, interface and async suffixes, constants.
- **File and type organisation** — namespace or module style, one-type-per-file, member order.
- **Formatting** — brace style, line length, how collections and long calls wrap, trailing commas.
- **Language level** — which modern features are actually adopted, and which are still absent.
- **Null and error handling** — the guard style, what is thrown versus returned, the boundary
  where failures become responses, how logging is done.
- **Async and resources** — suffixes, cancellation, disposal, blocking calls that should not exist.
- **Comments and docs** — the ratio of inline comments to formal doc blocks tells you the house
  style faster than anything else.
- **Tests** — framework, layout, naming, assertion style, what a change is expected to bring.

Record every measurement. The numbers go into the nodes *and* into the decisions in Step 6.

## Step 5 — Draft the nodes

Draft in working memory or a scratch file. **Do not write into the knowledge base** — Step 8 hands
finished content to the `knowledge-updater` agent, which owns the branch and the writes. Writing
early leaves the KB dirty and breaks the agent's checkout.

Each node states the target standard for *this* codebase:

- Quote real code from this repository, with real file and type names.
- State stack facts that are simply true: versions, compiler settings, what exists and what does not.
- Where the code is consistent, state the rule and cite the count.
- Where the code is split, or the imported standard disagrees with it, write the rule the evidence
  supports **and mark the disagreement**:

  ```markdown
  > **Open:** the code is split — 26 `[]` against 53 `new List<T>()`. The imported standard requires
  > `[]`. Proposed: `[]` for new code, migrate on touch.
  ```

  Never resolve one of these silently.
- Cross-link only to nodes that exist or that this run is creating. A dangling wikilink fails
  validation.
- Include the date the counts were taken, so a later reader knows how stale they are.

A language usually wants `code-style`, `error-handling`, `review-checklist`. A UI framework wants
`patterns`, a template-syntax node, `review-checklist`, and a state node when the client has
non-trivial state.

## Step 6 — Put the decisions to the user

Collect every `Open` marker into one list and ask with `AskUserQuestion`, up to four questions per
call. Each disagreement gets three options:

- **Standard follows the code** — recommended when the code is consistent and defensible.
- **Code follows the standard** — say roughly how much work, in call sites.
- **Defer** — the marker stays in the node.

Group related items into one question when the answer is likely the same, and put the counts in the
option text so the user can weigh the cost. Ask separately about any assumption you made (something
deleted, moved, or relinked) and about nodes worth writing beyond the agreed scope.

**In audit mode, stop here.** Report the deviations, each with its counts and the file that claims
otherwise, and stop.

## Step 7 — Apply the decisions to the drafts

- **Standard follows the code** — restate the rule as the code's behaviour and delete the marker.
- **Code follows the standard** — the node must now state the **target** rule, not what the code
  does today. Say plainly that the code does not yet comply, note roughly how many call sites, and
  link the issue that tracks it. Getting this backwards publishes current behaviour as the standard
  while filing work to eliminate it. Raise the issue, or ask the user to, before finishing.
- **Defer** — leave the marker exactly as it is, and mention it in the PR body so it is visible.

## Step 8 — Hand off

Validate the drafts against the KB's own rules first (frontmatter present and inline, wikilinks
resolve, no orphans).

Then dispatch the **knowledge-updater** agent with the batch shape:

- `changes` — one `{ action, file_path, content }` entry per node, `file_path` under the owning
  KB's marker, `action` `update` for a file that already exists and `create` otherwise.
- `pr_title` — e.g. `standards: csharp — import and ground against the code`.
- `pr_body` — what was created, the decisions taken, and every deferred `Open` marker by name.

The agent creates one branch and one PR for the whole batch. Show the user the URL it returns.

## Output to the user

Which nodes were created or changed, the decisions and what each one changed, what stayed open,
what was measured and found wrong, and the PR link. Keep it short enough to read.
