# The ADR findings document

A reviewer, human-prompted or automated, checks a diff against the architecture decision records
**and behaviour docs** that bind it and reports what it found as one JSON document. `adr-lint verdict` then checks the
document deterministically and turns it into an exit code. Any model can be the reviewer: the
plugin's `architect` agent writes this document during `/lore:review`, and a CI job can have an
outside model write it. Both use the same shape.

Everything below runs on plain `node scripts/adr-lint.js` (Node 22 or later), with no plugin
runtime.

## The schema

`schemas/adr-findings.v1.schema.json`, in the strict structured-output subset: every object
closes `additionalProperties` and lists every property as required, so an optional value is
`["string", "null"]`. A model API that takes an output schema can use the file as is.

The major version is in the file name. A breaking change adds a `v2` file, and `verdict` accepts
both until v1 is retired. Pin the schema through the plugin tag you check out.

Version 3.4.0 added `behaviour-rule` to v1's `class` enum. Adding a class is not a breaking
change: a reviewer on the older file never emits it. Update your prompt before adding behaviour
docs, though: a pre-3.4.0 prompt attests a selected doc without checking its rules, and that is
a silent pass, not an exit 2.

```json
{"coverage": {"checked": ["kb/ADR-0001"], "notReviewed": []},
 "findings": [{"class": "contradiction", "ids": ["kb/ADR-0001.R1"],
               "where": "src/x.cs:10-20", "summary": "…"}]}
```

## Running it

- Run from inside the household (`household.json` is found by walking up from the cwd) or from a
  repo with `.lorekeeper/config.json`. The knowledge base and the sibling repos must be checked
  out.
- Diff paths are repo-relative. Pass `--repo <name>` when the cwd is not inside the repo.
- `$LORE` is the plugin checkout, as an absolute path, pinned to a tag.

## What the reviewer reads: `select --json`

```
node scripts/adr-lint.js select --json --diff <patch> [--repo <name>] [--pr-body <file>]
```

prints `{ repo, candidates: [...] }`. Each candidate:

| Field | Meaning |
|---|---|
| `id` | qualified record id, such as `kb/ADR-0001`, or behaviour doc id, such as `kb/contract` |
| `kind` | `adr` or `behaviour`. A `missing` id is `adr` when it has the `<home>/ADR-NNNN` shape, else `behaviour` |
| `home` | `local` (the repo's own records) or `shared` (the team knowledge base); `null` when `missing` |
| `status` | the record's status (`proposed`, `accepted`, `rejected`, `superseded`), `-` for a behaviour doc, or `missing` for an id the PR cites, or a selected doc's rule names in `Source:`, that resolves nowhere. A `Source:` record whose home is not on disk (a sibling not checked out; outside a household, another repo) is not selected at all |
| `file` | the record's path relative to the cwd; `null` when `missing` |
| `reasons` | `scope` (the diff touches the record's scope), `cited` (the PR description cites it), `touched` (a behaviour doc whose own file the diff edits), `source` (a record a selected behaviour doc's rule names in `Source:`), or several. A PR cites a record only when its id appears under a `## Decisions` heading in the PR body; anywhere else it is not a citation, and ids inside HTML comments never are. A behaviour rule id under `## Decisions` (`kb/contract.R3`) cites its doc; a bare doc id does not, and neither does a rule id inside a URL or a longer path (`https://…/kb/contract.R3`, `docs/kb/contract.R3`) |
| `title`, `description`, `scope` | from the record's or doc's front matter |
| `record` | the full markdown of the record or doc, so the reviewer needs no file access |

A `missing` candidate has empty `title`, `description`, `scope` and `record`.

`select` exits 2 when it cannot tell what a behaviour doc binds (see *`verdict`*, exit 2, which
fails the same way). The TSV output
(without `--json`) is unchanged: `id`, `status`, `path`, `reasons`; a behaviour doc's status is
`-`.

Give the select JSON to the model however the job likes, inline or as a file; the schema
constrains only the output.

## Findings

| Field | Content |
|---|---|
| `class` | `contradiction`, `trigger`, `stale-fact`, `uncovered`, `dangling` or `behaviour-rule` |
| `ids` | names one record: the record itself, its rules (`<id>.R<n>`) or its facts (`<id>.F<n>`). `[]` for `uncovered`; for `dangling`, the `missing` candidate's id (for a cited behaviour rule, the doc id `kb/contract`, not `kb/contract.R3`, or `verdict` adds a second one); for `behaviour-rule`, one doc: the rules broken, at least one, optionally with the doc id. A behaviour rule is the candidate's `id` plus `.R<n>` (`backend/device.R2`). A doc-local id (`device.R2`, as the heading shows it) is rewritten to the qualified one when exactly one selected doc has that prefix, and exits 2 otherwise |
| `where` | `path:line-range` of the change; line ranges refer to the patched (new) file. Required for every class except `dangling`, where it is `null`. Always write the key |
| `summary` | one line. A `trigger` names the trigger and what in the change fires it. An `uncovered` choice says what reversing it later would take. A `behaviour-rule` names the rule and what in the change breaks it |

A `contradiction` on a record that has numbered rules cites one of them. Rules and facts are read
from the record's `## Decision` and `## Facts relied on` sections, ignoring fenced examples.

### Severity

`verdict` assigns severity from the class; the reviewer never rates a finding.

| Class | Severity | Blocks |
|---|---|---|
| `contradiction` | critical | yes |
| `trigger` | critical | yes |
| `uncovered` | critical | yes |
| `behaviour-rule` | critical | yes |
| `dangling` | important | no |
| `stale-fact` | minor | no |

A `behaviour-rule` finding is a diff that breaks a rule of a selected behaviour doc, judged in
the form the diff leaves the doc: a rule the PR adds or edits binds as edited, a rule it removes
no longer binds, and editing one rule never exempts the others. When the rule's `Source:` record
is contradicted by the same change, both findings are reported: the `behaviour-rule` and the
record's `contradiction`. A shared-home rule changes in its
own KB PR, which merges first; until then the rule on the KB's default branch binds. Rules are
read from `### <prefix>.R<n> <name>` headings under the doc's `## Rules`, ignoring fenced
examples. The format is in `references/behaviour-docs.md`.

## `verdict`

```
node scripts/adr-lint.js verdict --findings <file|-> --diff <patch|-> [--repo <name>] [--pr-body <file|->]
```

`verdict` re-runs the same selection as `select` from the diff, the repo and the PR description,
then checks the document against it. Only one of `--findings`, `--diff` and `--pr-body` may be
`-` (stdin). `--findings` accepts the bare JSON document, or a markdown report holding exactly
one fenced `adr-findings` block.

It adds a `dangling` finding itself for every selected `missing` id the reviewer did not report,
whether the PR cited it or a selected doc's `Source:` named it.
A selected `missing` id listed in `coverage.checked` is accepted.

| Exit | Meaning |
|---|---|
| 0 | no blocking findings |
| 1 | at least one blocking finding |
| 2 | could not judge |

Exit 2 means the check failed closed. Causes:

- `--findings` or `--diff` is missing, or an input cannot be read; more than one input is `-`.
- The repo cannot be determined (pass `--repo`), or is not in `household.json`.
- Selection cannot tell what a behaviour doc binds. `select` fails the same way:
  - a selected behaviour doc shares its id with any other behaviour doc (`behaviour docs <a> and
    <b> both have id <id>; give one a different prefix (adr-lint check)`);
  - a behaviour doc that the diff touches, or whose scope matches it, has no usable `prefix`:
    missing, a list, not `^[a-z][a-z0-9-]*$`, or `adr` (`<file> has no usable prefix; fix it
    (adr-lint check) before review`);
  - the patch deletes a doc, or renames or moves it to a path that is not a doc in the same
    home (`behaviour doc <path> is deleted by the diff …` / `is moved by the diff to …`). This is
    read from the patch, not the working tree. A rename to another doc name in the same home is
    not gone, and is recognised only from git's `rename from` / `rename to` lines (`git diff`
    and `gh pr diff` emit them by default); a delete plus an add, as a `--no-renames` patch
    writes a rename, exits 2. A copy is not a move. A file the patch shows did not start with
    `---` (a note) is not a doc;
  - a doc in a home being selected from starts with `---` (after any byte-order mark) but its
    frontmatter is unclosed, has an error on `scope` or `prefix`, or has an unparseable line; or
    a doc the diff touches has no frontmatter, unless the patch shows it did not start with
    `---` before (`<file>: <error>; review cannot tell what it
    binds …`, naming `behaviour.localDir` / `repos[].behaviourDir` for a dir that is not a
    behaviour home). A file with no frontmatter that the diff does not touch is not a doc;
  - a selected doc has no `## Rules` section as parsed (`<file> has no ## Rules section; review
    cannot read its rules …`);
  - an entry in a behaviour home cannot be read, such as a dangling symlink.
- The findings are not valid JSON; there is no `adr-findings` block, more than one, or one that
  is not terminated; there is no `findings` array.
- A finding has an unknown `class`, ids that are not strings, an empty `summary`, a non-string
  `where`, or no `where` when its class needs one.
- `coverage` is missing or malformed (`checked` and `notReviewed` must be arrays of strings).
- A `checked` id is a rule id (`checked takes record and doc ids, not rule ids`), or resolves to
  no record or behaviour doc (other than a selected `missing` id).
- A selected record or doc that is not `missing` is neither in `checked` nor named by a
  finding. Only a `contradiction`, `trigger`, `stale-fact` or `behaviour-rule` finding counts as
  having checked its record or doc; `uncovered` and `dangling` findings do not.
- A `contradiction`, `trigger` or `stale-fact` has ids spanning zero or several records, names a
  record that resolves nowhere, names a rule or fact the record does not have, or (for a
  contradiction on a record with numbered rules) cites no rule.
- A `behaviour-rule` names something other than one behaviour doc, a rule the doc does not
  have, or no rule; an ADR class (`contradiction`, `trigger`, `stale-fact`) names a behaviour
  doc.
- A finding names a doc-local rule id (`device.R2`) and no selected doc, or several, have that
  prefix (`write the qualified id, e.g. backend/device.R2`, naming the candidates).
- Anything else unexpected, such as an unreadable record file.

Ids are resolved through the selected candidates' files first, then the catalogue of every home.
Whether an id is a record or a behaviour doc comes from the same order, then from its shape
(`<home>/<prefix>` with a lowercase prefix is a doc).

### Output

`verdict` prints JSON to stdout: `blocking` (count), `counts` (`critical`, `important`, `minor`),
`findings` (each finding plus `severity` and `blocking`, including the dangling ones it added),
and `coverage` with `checked`, `extra` (checked ids that were not selected) and `notReviewed`.

### `coverage.checked` is an attestation

`verdict` cannot prove the reviewer read the records and behaviour docs. What it guarantees is
that an empty `findings` list means every selected record or behaviour doc was attested, and
that no finding can block on a record, doc, rule or fact that does not exist.
`coverage.notReviewed` is reported in the output and never fails the check.

## The contract for an external reviewer

```
node "$LORE/scripts/adr-lint.js" select --json --diff <diff> --repo <name> --pr-body <body>   # what to review (records inlined)
# reviewer: any model; output must match $LORE/schemas/adr-findings.v1.schema.json, e.g.
#   codex exec --output-schema "$LORE/schemas/adr-findings.v1.schema.json" -o findings.json "<prompt>" </dev/null
node "$LORE/scripts/adr-lint.js" verdict --findings findings.json --diff <diff> --repo <name> --pr-body <body>
# exit 0 pass · 1 blocking findings · 2 could not judge
```

`codex exec` blocks on stdin unless it is redirected from `/dev/null`.

## A starter prompt (non-normative)

Teams own their production prompt. This one only shows what the reviewer is being asked to do;
adapt it freely.

```text
You are reviewing a change against the architecture decision records and behaviour docs that
bind it.

Inputs: the diff at <diff>, and the output of `adr-lint select --json` (each candidate carries
its full record).

1. Read every candidate's `record` in full, of kind `adr` and of kind `behaviour`.
2. Compare the diff with each numbered rule, each fact relied on, each invalidation trigger, and
   each rule of each behaviour doc in the form the diff leaves it: a rule the diff adds or edits
   is judged as edited, a rule it removes no longer binds, and editing one rule never exempts
   the others.
3. Report only what you can locate in the diff, with `where` as path:line-range. Do not infer
   problems from code the diff does not touch.
4. For a trigger, the summary names the trigger and what in the change fires it. For a choice no
   record covers, the summary says what reversing it later would take.
5. Report a behaviour rule the diff breaks as `behaviour-rule`, only for a candidate of kind
   `behaviour`. Cite the rule as the candidate's `id` plus `.R<n>` (`backend/device.R2`), never
   the `device.R2` its heading shows. A *Known deviations* entry as it stands on the base branch
   exempts code, new or existing, that shows exactly the behaviour it describes; a break wider
   than that behaviour is a finding, and an entry the diff adds or edits exempts nothing new in
   that diff. A
   break the base code already had (visible in the removed lines or in code the diff does not
   change) is not a finding, even when the diff moves or reformats it; a new or wider break is.
   That exemption needs evidence in the patch (the removed lines, or unchanged context showing
   the same behaviour); without it, the break is new.
6. A broken behaviour rule is always a `behaviour-rule`, and a contradicted record is always a
   `contradiction`. When a rule's `Source:` record is contradicted by the same change, report
   both.
7. A product policy recorded as a rule in a behaviour doc (who sees what, who may do what) is
   not an `uncovered` architectural choice.
8. List every candidate whose status is not `missing` in `coverage.checked`, behaviour docs
   included, whether or not you report on them: record and doc ids, never rule ids. List only
   candidates you read; a record a `Source:` line names that is not a candidate is not listed.
   List areas you could not assess in `coverage.notReviewed`.

Answer with one JSON document matching the schema, and nothing else.
```
