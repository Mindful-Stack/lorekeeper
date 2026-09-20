---
name: standards-curate
description: >
  Curate coding-standard nodes (languages/*, frameworks/*, general/*): author them from the code,
  import them from another project, audit the ones already written, and reconcile a rule with the
  code when the two disagree. Use when the user asks to "document our C#/React/whatever
  conventions", "import standards from another project", "bootstrap the knowledge base from the
  code", or "check the standards against the code and list deviations". Measures every rule before
  stating it, compares it against the standards already in force, and puts every disagreement to
  the user as a decision rather than resolving it silently.
---

# Standards Curation

Turn "how we actually write code" into knowledge-base nodes, and surface every place where the
standard and the code disagree so the team decides which one moves.

The failure this skill exists to prevent is a standard that misstates the codebase. A rule nobody
follows, or a count that is wrong, is worse than no node at all: it gets quoted in review and it
teaches new contributors something false. Everything below serves that.

## Step 0 — Pick the mode, and the scope

Three modes. Decide from the user's words; ask if genuinely ambiguous. Reconciling the rule with
the code is not a fourth mode — it runs through all three, and it is the part that must never
happen silently.

| Mode | The user asked for | Ends with |
|------|--------------------|-----------|
| **Audit** | "check the standards against the code", "are our docs still true?", "list deviations" | A report. **No files written, no PR.** |
| **Import** | "import the standards from `<project>`", "bring over their C# nodes" | Drafted nodes, decisions, one PR per KB touched |
| **Author** | "document our conventions", "bootstrap the KB from the code" | Drafted nodes, decisions, one PR per KB touched |

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

From those three sources, work out the **effective existing standard** for the scope: repo-local
`docs/standards/` outranks the KB, and among the KBs the highest-priority marker that has the file
wins outright. Write that effective rule set down — rule by rule — before you measure anything.
Step 5 compares every observed convention against this list, so a rule missing from it is a rule
that will never be checked.

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
- **Check every observed convention against the effective existing standard from Step 2** —
  including the conventions the code follows perfectly. Consistent code is not evidence that
  nothing is in force; it is only evidence that the code agrees with itself. Agreement between the
  code and the effective standard is the one case that needs no marker.
- Where the code is consistent *and* nothing already in force says otherwise, state the rule and
  cite the count.
- Where the code is split, where an imported standard disagrees with it, or where the effective
  existing standard requires something the code does not do, write the rule the evidence supports
  **and mark the disagreement**:

  ```markdown
  > **Open:** the code is split — 26 `[]` against 53 `new List<T>()`. The imported standard requires
  > `[]`. Proposed: `[]` for new code, migrate on touch.
  ```

  A rule with **zero** implementations is a disagreement, not an absent convention. If a standard
  in force requires a cancellation token on every async entry point and no method takes one, the
  count is `0 of 148` and the decision goes to the user. Never drop or weaken a rule already in
  force because the code does not implement it, and never let internally consistent code suppress
  the finding.
- Never resolve one of these silently.
- Cross-link only to nodes that exist or that this run is creating. A dangling wikilink fails
  validation.
- Include the date the counts were taken, so a later reader knows how stale they are.

A language usually wants `code-style`, `error-handling`, `review-checklist`. A UI framework wants
`patterns`, a template-syntax node, `review-checklist`, and a state node when the client has
non-trivial state.

## Step 6 — Put the decisions to the user

Collect every `Open` marker into one list and ask with `AskUserQuestion`, up to four questions per
call. Each disagreement gets three options:

- **Standard follows the code** — recommended when the code is consistent and defensible. When
  this means changing a rule already in force, name the node and the KB it lives in: that edit is
  visible to every repo the KB serves, so the user is choosing for all of them, not just this one.
- **Code follows the standard** — say roughly how much work, in call sites.
- **Defer** — the marker stays in the node.

Group related items into one question when the answer is likely the same, and put the counts in the
option text so the user can weigh the cost. Ask separately about any assumption you made (something
deleted, moved, or relinked) and about nodes worth writing beyond the agreed scope.

**In audit mode, stop here.** Report the deviations, each with its counts and the file that claims
otherwise — including every rule in force that the code does not follow, the `0 of n` ones
included — and stop.

## Step 7 — Apply the decisions to the drafts

- **Standard follows the code** — restate the rule as the code's behaviour and delete the marker.
  If the rule it replaces lives in an existing node, that node is now part of the change set too:
  edit it in the KB that owns it, and let Step 8 group it with that repository's PR.
- **Code follows the standard** — the node must now state the **target** rule, not what the code
  does today. Say plainly that the code does not yet comply, note roughly how many call sites, and
  link the issue that tracks it. Getting this backwards publishes current behaviour as the standard
  while filing work to eliminate it. Raise the issue, or ask the user to, before finishing.
- **Defer** — leave the marker exactly as it is, and mention it in the PR body so it is visible.

## Step 8 — Hand off, one PR per repository

Validate the drafts against the KB's own rules first (frontmatter present and inline, wikilinks
resolve, no orphans).

**Group the changes by the KB that owns them.** Step 2 recorded an owner per file: an existing node
is updated where it already lives, a new one goes where Step 2 agreed it belongs. Each KB is its own
git repository, so a batch spanning two of them cannot be branched, committed or merged together —
`knowledge-updater` creates one branch and one PR in one repository per dispatch.

Dispatch the **knowledge-updater** agent **once per owning KB**, each with its own batch:

- `changes` — one `{ action, file_path, content }` entry per node *in that KB*, `file_path` under
  that KB's marker, `action` `update` for a file that already exists and `create` otherwise.
- `pr_title` — e.g. `standards: csharp — import and ground against the code`.
- `pr_body` — what was created, the decisions taken, and every deferred `Open` marker by name.
  When the run produced more than one PR, say so in each body and name the other repositories, so a
  reviewer knows they are looking at part of a decision rather than all of it.

Dispatch the groups in parallel when there is more than one, and show the user every URL returned.
Do not try to make them land atomically: they are separate repositories and separate merges. If one
node's decision only makes sense once another KB's PR is in, say that in both bodies.

## Output to the user

Which nodes were created or changed, the decisions and what each one changed, what stayed open,
what was measured and found wrong, and the PR link for each repository touched. Keep it short enough to read.
