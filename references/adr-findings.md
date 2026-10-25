# The ADR findings document

A reviewer, human-prompted or automated, checks a diff against the architecture decision records
that bind it and reports what it found as one JSON document. `adr-lint verdict` then checks the
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

```json
{"coverage": {"checked": ["kb/ADR-0001"], "notReviewed": []},
 "findings": [{"class": "contradiction", "ids": ["kb/ADR-0001.R1"],
               "where": "src/x.cs:10-20", "summary": "…"}]}
```

## What the reviewer reads: `select --json`

```
node scripts/adr-lint.js select --json --diff <patch> [--repo <name>] [--pr-body <file>]
```

prints `{ repo, candidates: [...] }`. Each candidate:

| Field | Meaning |
|---|---|
| `id` | qualified record id, such as `kb/ADR-0001` |
| `kind` | `adr` |
| `home` | `local` (the repo's own records) or `shared` (the team knowledge base); `null` when `missing` |
| `status` | the record's status (`proposed`, `accepted`, `rejected`, `superseded`), or `missing` for an id the PR cites that resolves nowhere |
| `file` | the record's path relative to the cwd; `null` when `missing` |
| `reasons` | `scope` (the diff touches the record's scope), `cited` (the PR description cites it), or both |
| `title`, `description`, `scope` | from the record's front matter |
| `record` | the full markdown of the record, so the reviewer needs no file access |

A `missing` candidate has empty `title`, `description`, `scope` and `record`.

## Findings

| Field | Content |
|---|---|
| `class` | `contradiction`, `trigger`, `stale-fact`, `uncovered` or `dangling` |
| `ids` | names one record: the record itself, its rules (`<id>.R<n>`) or its facts (`<id>.F<n>`). `[]` for `uncovered`; the cited id for `dangling` |
| `where` | `path:line-range` of the change. Required for every class except `dangling`, where it is `null`. Always write the key |
| `summary` | one line. A `trigger` names the trigger and what in the change fires it. An `uncovered` choice says what reversing it later would take |

A `contradiction` on a record that has numbered rules cites one of them. Rules and facts are read
from the record's `## Decision` and `## Facts relied on` sections, ignoring fenced examples.

### Severity

`verdict` assigns severity from the class; the reviewer never rates a finding.

| Class | Severity | Blocks |
|---|---|---|
| `contradiction` | critical | yes |
| `trigger` | critical | yes |
| `uncovered` | critical | yes |
| `dangling` | important | no |
| `stale-fact` | minor | no |

## `verdict`

```
node scripts/adr-lint.js verdict --findings <file|-> --diff <patch|-> [--repo <name>] [--pr-body <file|->]
```

`verdict` re-runs the same selection as `select` from the diff, the repo and the PR description,
then checks the document against it. Only one of `--findings`, `--diff` and `--pr-body` may be
`-` (stdin). `--findings` accepts the bare JSON document, or a markdown report holding exactly
one fenced `adr-findings` block.

It adds a `dangling` finding itself for every selected `missing` id the reviewer did not report.
A selected `missing` id listed in `coverage.checked` is accepted.

| Exit | Meaning |
|---|---|
| 0 | no blocking findings |
| 1 | at least one blocking finding |
| 2 | could not judge |

Exit 2 means the check failed closed. Causes:

- `--findings` or `--diff` is missing, or an input cannot be read; more than one input is `-`.
- The repo cannot be determined (pass `--repo`), or is not in `household.json`.
- The findings are not valid JSON; there is no `adr-findings` block, more than one, or one that
  is not terminated; there is no `findings` array.
- A finding has an unknown `class`, ids that are not strings, an empty `summary`, a non-string
  `where`, or no `where` when its class needs one.
- `coverage` is missing or malformed (`checked` and `notReviewed` must be arrays of strings).
- A `checked` id resolves to no record (other than a selected `missing` id).
- A selected record that is not `missing` is neither in `checked` nor named by a finding. A
  finding on a record counts as having checked it.
- A `contradiction`, `trigger` or `stale-fact` has ids spanning zero or several records, names a
  record that resolves nowhere, names a rule or fact the record does not have, or (for a
  contradiction on a record with numbered rules) cites no rule.
- Anything else unexpected, such as an unreadable record file.

Ids are resolved through the selected candidates' files first, then the catalogue of every home.

### `coverage.checked` is an attestation

`verdict` cannot prove the reviewer read the records. What it guarantees is that an empty
`findings` list means every selected record was attested, and that no finding can block on a
record, rule or fact that does not exist. `coverage.notReviewed` is reported in the output and
never fails the check.

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
You are reviewing a change against the architecture decision records that bind it.

Inputs: the diff at <diff>, and the output of `adr-lint select --json` (each candidate carries
its full record).

1. Read every candidate's `record` in full.
2. Compare the diff with each numbered rule, each fact relied on, and each invalidation trigger.
3. Report only what you can locate in the diff, with `where` as path:line-range. Do not infer
   problems from code the diff does not touch.
4. For a trigger, the summary names the trigger and what in the change fires it. For a choice no
   record covers, the summary says what reversing it later would take.
5. List every candidate whose status is not `missing` in `coverage.checked`. List areas you could
   not assess in `coverage.notReviewed`.

Answer with one JSON document matching the schema, and nothing else.
```
