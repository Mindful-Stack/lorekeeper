# The record format

The template is `<plugin-root>/references/adr-template.md`: read it before drafting or
converting a legacy record, and keep its keys and section order. The file is
`<home>/NNNN-<problem-slug>.md`.

- `id` is `<prefix>/ADR-NNNN`; `title` is `"ADR-NNNN: …"`; `description` is the decision in one
  sentence with its strongest because (≤300 chars): listings show it, so it carries the decision.
- `tags` includes `adr`; prefer tags already in use (`grep -rh '^tags:'` the home).
- `status: proposed` on every draft. `decided_by` names the human(s) who took the decision, asked
  in the interview; a draft leaves it `[]` only until ratification fills it. The ratifier is not
  in `decided_by`: **ratify** names them in the last Status line (`Accepted YYYY-MM-DD by <name>.`)
  and the PR, never guessed. `consulted` lists the people asked.
- **Classification**: `reversibility` (`one-way` when undoing costs more than a day or breaks
  consumers, else `two-way`); `blast_radius` picks the home (`repo` affects only this repo,
  `shared` crosses repos or is visible to customers);
  `sensitivity` (any of `security`, `privacy`, `billing`, `legal`, `contract`, or `[]`).
- **High tier** = `one-way`, or `shared`, or any sensitivity. It needs at least two
  considered options, an invalidation trigger and a non-empty `scope`, and gets its own ADR-only
  PR, accepted before implementation. A low-tier record may ride along in the implementation PR.
- `scope`: globs for the governed code, relative to the repo root in a local record
  (`src/Billing/**`), prefixed with the repo in a shared one (`billing-api:src/Billing/**`).
- Relations hold qualified ids: `supersedes`, `superseded_by` (only when superseded),
  `depends_on`, `related`. Write them only on the record you are drafting; reverse links are
  computed. `implements` stays `[]`.
- Every value inline on its key's line: block scalars and block lists fail the validator.

Body: *Context* (facts a proponent of the losing option would accept); *Facts relied on* (`F1 …
— source: <path, URL or command>`); *Considered options* (two or more, each with one honest
advantage; three is a guideline, not a limit: every rejected option that has a revisit trigger
belongs on the record); *Decision* (one falsifiable sentence, named actor, strongest because, then rules `R1`,
`R2` … each a MUST or MUST NOT); *Consequences* (at least one real negative); *Assumptions and
invalidation triggers* (`*Assumes X.* Trigger: <event> ⇒ supersede.`); *Later observations*
(empty on a draft); *See also*. Aim for 300–900 words, one decision per record (decompose "store X
in Y" bundles), plain sentences, and never mention chat sessions or AI authorship.

Numbers are four digits, per home, never reused: `adr-lint next --base origin/<default> <home-dir>`
(drop `--base` when that ref does not exist). It also skips numbers that open pull requests in the
home's repository already claim, read with `gh`; when it cannot read them it says so on stderr
(`open pull requests not checked (<why>)`): pass that line on to the user, since the number may
collide with an open PR's record. The slug names the problem, never the answer.

## Self-check

Fix inline: one falsifiable Decision; every rule a MUST/MUST NOT; Context a losing proponent would
accept; every fact sourced; two or more real options (three is a guideline, not a limit); a real negative; a trigger; classification
matching the evidence; scope non-empty for high tier and in the home's syntax; every value inline;
no AI authorship.
