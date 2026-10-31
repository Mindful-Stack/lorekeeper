# Behaviour docs

A behaviour doc states the rules a capability must keep: what must be true now, and why it
matters, organised by capability and edited in the same PR as the change that alters the
behaviour. An ADR records **why** a hard-to-reverse choice was made and is locked once accepted;
a behaviour doc records **what must stay true** and is living. They connect as **ADR → rule →
code**: a rule that follows from a decision names it in a `Source:` line and need not restate
it, and the review checks a diff against both.

Ask two questions: *is this a decision?* → an ADR; *must this stay true?* → a rule.

## Where they live

The same two homes as ADRs, resolved the same way:

| The capability… | Home | Doc id |
|---|---|---|
| is implemented in one repo | `docs/behaviour/<capability>.md` in that repo | `<repo>/<prefix>` |
| spans repos, or is a contract between repos | `behaviour/<capability>.md` in the team knowledge base (under `knowledge/`) | `kb/<prefix>` |

Other teams' knowledge bases contribute no behaviour docs.

Every `.md` file in a behaviour home is a doc, except `_`-prefixed files and `README.md`.
Subdirectories are not read. In review, a file with no frontmatter at all (it does not start
with `---`) is a note, not a doc, unless the diff touches it and the patch does not show it was
a note before; `check` still reports it. A doc
that cannot be read (a dangling symlink, no permission) makes `select`, `verdict`, `check` and
`index` exit 2.

The dirs are configurable beside the `adr` block, in `household.json` or
`.lorekeeper/config.json`:

```json
{
  "behaviour": { "localDir": "docs/behaviour", "sharedDir": "behaviour" },
  "repos": [{ "name": "backend", "behaviourDir": "spec/behaviour" }]
}
```

`repos[].behaviourDir` overrides `behaviour.localDir` for one repo. `adr-lint homes` reports the
resolved dirs as `localHomes[].behaviourDir` and `sharedBehaviourHome`.

## The document

```markdown
---
title: "Device status"
description: "Who can read a device's status, and how fresh it is."
tags: [behaviour, devices]
prefix: device
scope: ["src/Devices/**", "src/Api/Status/**"]
related: [backend/ADR-0003]
---

# Device status

## Purpose
Two or three plain sentences a non-engineer understands.

## Rules

**Reading status**

### device.R1 Status is current
A status read SHALL return the latest report the device sent.
- Example: WHEN a device reports offline THEN the next read shows offline.
- Source: kb/ADR-0001.R2

### device.R2 Project scoped
A status read SHALL list only the devices of the requested project.
- Example: WHEN project A is read THEN no device of project B appears.
- Source: backend/ADR-0003

## Known deviations
- device.R2: archived devices of other projects still appear (#41).

## Not yet decided
- none
```

- **Frontmatter.** `title`, `description`, `tags`, `prefix` and `scope` are required. Values are
  inline, lists as `[a, b]`. The filename and title name the capability. `prefix` is one value
  matching `^[a-z][a-z0-9-]*$`, unique in its home, and never `adr`. `scope` holds the globs a
  diff must touch for the doc to be selected (in the shared home, `<repo>:<glob>`). A broad scope
  has a cost: every diff it matches selects the doc, so every rule in it is read and judged on
  that PR and the doc must be attested; `src/**` puts the doc on nearly every PR. Prefer the
  directories the capability lives in. `related` (optional) holds qualified ADR ids, whole
  records only.
- **Rules.** Every rule is a `### <prefix>.R<n> <name>` heading under `## Rules`; `n` starts at
  1 with no leading zero. A group is a bold label line between rules, never a heading. A rule is
  one observable guarantee in SHALL or MUST sentences, plus a `- Example:` line. It never
  explains how the code works.
- **`Source:`** (optional) is a plain list item inside the rule: `- Source: <id>` or
  `- Source: <id>, <id>`. Each id is a qualified record (`backend/ADR-0003`) or one of its rules
  (`kb/ADR-0001.R2`). A bold `**Source:**`, a missing list marker or a lowercase `source:` is not
  read (the check warns). No `Source:` means the doc itself decides the rule: the PR that adds or
  changes it is the decision. Where a rule and its source differ, the ADR wins and the rule is
  fixed. Review selects every record a selected doc's rules name here (see *In review*).
- **Known deviations** (optional): `- <rule id>[, <rule id>…]: <what the code does instead>
  (<ticket>)`, unindented, with unqualified rule ids. It records an intended rule the code does
  not meet yet. In review an entry as it stands on the base branch exempts code, new or
  existing, that shows exactly the behaviour it describes; a break wider than that behaviour, or
  any other break of the same rule, is still a finding. An entry the diff adds or edits exempts
  nothing new in that diff. The `(<ticket>)` is a convention; `check` does not enforce it.
- **Not yet decided** is required; it may say "none". It tells agents where not to invent an
  answer.
- Sections are `## ` headings at the start of a line, named exactly as above (`## Rules`,
  `## Known deviations`, `## Not yet decided`). Everything inside fenced code is ignored,
  so a fenced example never counts as a rule, a source or a section.
- Keep evidence (file and line, test names) out of the doc: it rots and duplicates the code.

## What `adr-lint check` enforces

```
node scripts/adr-lint.js check [--home local|shared] [--repo <name>] <behaviour-dir>
```

`check` treats a dir as a behaviour home when it is a resolved behaviour home, or, with
`--home`, when its path ends in that kind's configured behaviour dir (`docs/behaviour` local,
`behaviour` shared) and it is not a resolved ADR home. Every other dir is checked as an ADR
home. A dir configured as both an ADR home and a behaviour home is a usage error (exit 2), and so
is a dir checked as an ADR home that holds no records but a `.md` with a `prefix:` key: it looks
like a behaviour home `check` does not recognise, so configure its dir or pass `--home`. For a
local home the prefix is `--repo`, else the household entry, else the git repo's name (outside
git, the name of the dir holding the behaviour dir).
`--base`, `--ci`, `--strict` and `--single-home` are accepted and change nothing, so CI can run
one `check` line per home with the same flags (`--ci` still needs `--base`).

Each problem prints as `<file>: <rule>: [warning: ]<message>`. Exit 1 when any is an error;
warnings alone exit 0.

| Level | Rule | When |
|---|---|---|
| error | `schema` | the frontmatter is missing or unclosed (no other check runs on that doc), or has an unparseable line, a duplicate key, or a block value |
| error | `schema` | `title`, `description`, `tags`, `prefix` or `scope` is missing or empty |
| error | `schema` | `tags`, `scope` or `related` is not an inline list |
| error | `prefix` | `prefix` is a list ("prefix must be a single value") |
| error | `prefix` | `prefix` does not match `^[a-z][a-z0-9-]*$`, or is `adr` |
| error | `prefix` | another doc in the home has the same `prefix` |
| error | `sections` | no `## Rules` section (naming a heading that differs only in case, such as `## rules`) |
| error | `sections` | no `## Not yet decided` section (likewise) |
| error | `rules` | a `###` heading under `## Rules` is not `<prefix>.R<n> <name>` with this doc's prefix (not reported when the prefix is missing or a list) |
| error | `rules` | a rule id appears twice |
| error | `relations` | a `Source:` is not `<home>/ADR-NNNN[.R<n>]`, or a `related` entry is not `<home>/ADR-NNNN` |
| error | `relations` | the record does not exist. A ref into the home's own ADR dir (the dir beside the behaviour dir, same prefix) that is not there is an error even when that dir is absent; in a household, an unknown home prefix is an error |
| error | `relations` | a `Source:` names a rule the record does not have (checked only when the record has numbered rules) |
| error | `scope` | a shared-home entry is not `<repo>:<glob>` |
| error | `scope` | a local-home entry is prefixed (`<repo>:…`) |
| warning | `rules` | `## Rules` holds no rule headings |
| warning | `rules` | a line under `## Rules` looks like a `Source:` line but is not read (bold, no list marker, other case, or before the first rule) |
| warning | `rules` | a `### <prefix>.R<n>` line under `## Rules` is inside fenced code, so it is not read as a rule |
| warning | `rules` | a `####` (or deeper) heading under `## Rules`: a group is a bold label line |
| warning | `rules` | a rule has no SHALL or MUST |
| warning | `rules` | a rule has no `- Example:` line |
| warning | `relations` | a ref's home is not on disk (a known sibling not checked out; outside a household, any other home), so it was not checked |
| warning | `relations` | a ref names a superseded record; update the rule to its successor |
| warning | `deviations` | a *Known deviations* id is not a rule in this doc |
| warning | `scope` | a glob matches no tracked file in the repo it is relative to (only when that repo is its own git checkout) |

## Ids

- A doc is `<home>/<prefix>`: `backend/device` in a repo's home, `kb/contract` in the team KB.
  A prefix is lowercase and never `adr`, so a doc id never looks like an ADR id.
- A rule is `<prefix>.R<n>` inside the doc (`device.R2`, in headings and *Known deviations*).
  Everywhere else (PR descriptions, findings, plans) it is the doc id plus `.R<n>`
  (`backend/device.R2`), never the bare `device.R2`.
- Numbers only grow: a new rule takes a number above the highest the doc has ever had (its git
  history says what a removed id meant). When two PRs claim the same id, the later-merging one
  renumbers. This is a convention; `check` does not enforce it.
- A rule id under a PR's `## Decisions` heading (`kb/contract.R3`) cites its doc, the way an ADR
  id cites its record; a bare doc id, or a rule id inside a URL or a longer path, does not. The
  PR's rule edits go on the `- Rules: added …; changed …; removed …; deviation added …` line
  of that section (`references/pr-decisions.md`). A cited doc that resolves nowhere, including
  a shared-home doc not yet on the KB's default branch, is `missing`, and `verdict` adds a
  `dangling` finding (important, does not block).

## In review

`adr-lint select` returns, from both homes, each doc whose `scope` matches the diff and each doc
whose own file the diff touches, as a candidate with `kind: "behaviour"` and status `-`
(`reasons` `scope`, `touched`, or both). So a PR that only edits a doc still has that doc
selected, and its edit is reviewed. `select` also returns every record a selected doc's rules
name in `Source:` (the record, not the rule), with `reasons` `source`; the reviewer reads and
attests it like any selected record. One its available home does not have is `missing`; one
whose home is not on disk (a sibling not checked out) is not selected, as `check` only warns
about it.

`select` and `verdict` fail closed (exit 2, naming the path) when they cannot tell what a doc
binds:

- the patch deletes a doc, or renames or moves it to a path that is not a doc in the same home
  (`_…`, `README.md`, `.MD`, a subdirectory, another dir). This is read from the patch, not the
  working tree, so an off-branch review of a PR that adds a doc passes. A rename to another doc
  name in the same home selects the doc under its new path; it is recognised only from git's
  `rename from` / `rename to` lines, which `git diff` and `gh pr diff` emit by default, so a
  `--no-renames` patch (a delete plus an add) exits 2. A copy is not a move, and deleting or
  editing a file the patch shows did not start with `---` (a note) is not a doc change. Planned
  paths (`--paths`) are not checked;
- a doc in a home being selected from starts with `---` (after any byte-order mark) but its
  frontmatter is unclosed, has an error on `scope` or `prefix`, or has an unparseable line (it
  may be either); or a doc the diff touches has no frontmatter. The message names
  `behaviour.localDir` / `repos[].behaviourDir` for a dir that is not a behaviour home;
- a selected doc has no `## Rules` section as parsed (hidden by an unclosed fence, or a heading
  in another case), so its rules cannot be read;
- a doc the diff touches, or whose scope matches it, has no usable `prefix`.

Retiring a doc therefore needs the repository's admin bypass of the required check, as does
any other change the gate cannot judge.

The architect judges each rule in the form the diff leaves it: a rule the PR adds or edits binds
as edited, a rule the PR removes no longer binds, and editing one rule never exempts the others.
A rule the diff breaks is a `behaviour-rule` finding, which `adr-lint verdict` marks critical
and blocking. When the rule has a `Source:` and the diff also contradicts that record, both are
reported: the `behaviour-rule` on the rule and the `contradiction` on the record. A *Known
deviations* entry as it stands on the base branch exempts code, new or existing, that shows
exactly the behaviour it describes; a wider break is a finding, and an entry the diff adds or
edits exempts nothing new in that diff. A break the base code already had (visible in the removed lines or in code the
diff does not change) is not a finding, even when the diff moves or reformats it; a new or wider
break is, and without evidence in the patch the break is new.

To fix a broken rule, conform, or edit the rule in the same PR as the code (local home). For a
rule with a `Source:`, the record wins: conform, or replace the record (`/lore:adr replace …`);
editing the rule alone is not a fix. A shared-home rule changes in its own KB PR, which merges
first: until then, a code PR that breaks the rule as it stands on the KB's default branch is
blocked (the review reads the KB as checked out and assumes it is on that branch). The `stack`
skill (`skills/stack/SKILL.md`) shows the order of the two PRs. List the rule edits on the PR's
`- Rules:` line (`references/pr-decisions.md`). The only override is the repository's admin
bypass of the required check. The finding's fields, the checks on its ids and the exit codes are
in `references/adr-findings.md`.
