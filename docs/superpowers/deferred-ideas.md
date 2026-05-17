# Lorekeeper — deferred ideas

Feature ideas worth doing but not yet scheduled. Distinct from `known-issues.md` (which doesn't exist here; this is for net-new capabilities, not bugs). Items here have a brief sketch and a "trigger to revisit" so future-us knows when to pick them up.

For ideas that are scheduled or in flight, look in `docs/superpowers/specs/`.

---

## `lore` CLI fast-search subcommands (beyond grep)

**Sketch.** `lore/_tools/cli.js` already ships `build-index`, `validate`, `check-orphans`, `doctor`. Add three more subcommands that replace the agent's reliance on grep for KB queries:

- `lore search <query>` — checks the pre-built `_index.json` (title / description / tags) first, falls back to full-text only if no index hits. Returns ranked file paths + snippet.
- `lore graph <node>` — outgoing AND incoming wikilinks via a pre-built backlink index (currently impossible with grep alone).
- `lore tagged <tag1> <tag2> ...` — set intersection of nodes carrying all listed tags. Single-pass index lookup vs O(n²) grep.
- `lore related <node>` — nodes sharing tags, or linked-via-N-hops in the wikilink graph.
- `lore tags` — all tags + node counts. Cheap, also useful for `/lore:doctor` hygiene checks.

Agent-side: `/lore:explore` and the `knowledge-question-answerer` agent prefer the CLI subcommands when present, fall back to grep otherwise. Same query, faster signal, fewer tokens per turn (CLI returns ranked snippets so the agent doesn't have to `Read` every match).

**Why deferred.** Real value (10-100× speedup for index-hit queries; capabilities grep can't do at all), but the existing grep flow works. Cultivation features (`/lore:iterate-domain` etc.) are more pressing for the current use case (just-started DDD on Grantigo).

**Trigger to revisit.** When KB grows past ~50 nodes and agent turns start eating noticeable time/tokens on grep-based exploration. Or when a cultivation command needs the backlink graph (e.g., `/lore:iterate-domain` checking "every Entity mentioned in the bounded-context doc has a defining node linked to it" — that wants an incoming-wikilink index).

**Dependencies.** None blocking. Self-contained Node work in `lore/_tools/cli.js` (lives in the witan-household template, so this is a witan-household-template-side change, not a Lorekeeper-plugin change).
