# Self-ratification setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional `adr.allowSelfRatification` setting lets a decider ratify their own ADR without being asked
whether anybody else is available, and makes the shown edit and the PR say so plainly.

**Architecture:** One script change (`scripts/adr/homes.js` returns the key in `config`, which `adr-lint homes` already
prints and the recording-decisions skill already passes to every agent), then markdown instruction changes in the
recording-decisions skill, its record-format reference, the knowledge-updater agent and the README. The scenario
runner gains a per-scenario `:household` overlay so behaviour can be tested with the setting on.

**Tech Stack:** Node 22+ (`node --test`), Babashka (`bb`) scenario runner over `claude --print`, markdown skills.

Spec: `docs/superpowers/specs/2026-11-10-allow-self-ratification-design.md` (read it before any task).

## Governing decisions

None. No accepted record binds this work: Lorekeeper has no ADR home of its own (`docs/adr/` does not exist; the
records under `test/fixtures/` are test data). The 2026-10-07 ADR-centred workflow design's "who approves a record is
not configured" is kept: the setting says only whether a decider may ratify, never who.

---

## Conventions for every task

- Work only in `/home/daniel/Source/lorekeeper-self-ratify` (branch `feat/allow-self-ratification`). Never touch
  `/home/daniel/Source/lorekeeper` (another branch with uncommitted work).
- Commit subjects: `feat(adr): …`, `test: …`, `docs: …`, lowercase, imperative, under 70 characters. Every commit ends
  with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Do not push.
- Vocabulary (spec *Terms*): *ratify* covers acceptance and rejection; *ratifier* in skill and reference text;
  *approver* only in PR prose for an acceptance; a rejection names its *rejecter*; on a rejected record `decided_by`
  holds the *proposer*.
- Markdown in this repo wraps at about 100 columns; keep the surrounding file's wrapping.
- Unit tests: `node --test scripts/__tests__/*.test.js` (use the glob). Scenario runs call `claude --print` and cost
  money and minutes: run only the ones a task names.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/adr/homes.js` | modify `adrConfig` | the one place the `adr` config is read |
| `scripts/__tests__/adr-homes.test.js` | add 2 tests | config resolution |
| `scripts/__tests__/adr-lint-cli.test.js` | edit 1 assertion, add 1 test | the JSON the skill consumes |
| `test/run-tests.clj` | add `deep-merge`, `household-copy`, wire `:household` | scenario runner |
| `test/runner-test.clj` | create | self-test of the overlay |
| `test/README.md` | document `:household` and the self-test | runner docs |
| `skills/recording-decisions/SKILL.md` | rule 2 | the rule agents read first |
| `skills/recording-decisions/reference/record-format.md` | one sentence | field meaning |
| `skills/recording-decisions/actions/ratify.md` | step 2 | the procedure |
| `agents/knowledge-updater/AGENT.md` | Inputs, PR text | the writer and its PR wording |
| `README.md` | ADR homes section, quick start | user docs |
| `test/scenarios.edn` | 7 scenarios | behaviour |
| `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` | 3.8.0 → 3.9.0 | release |

---

### Task 1: `adrConfig` returns `allowSelfRatification`

**Files:**
- Modify: `scripts/adr/homes.js:7-12`
- Test: `scripts/__tests__/adr-homes.test.js`, `scripts/__tests__/adr-lint-cli.test.js`

- [ ] **Step 1: Write the failing tests in `scripts/__tests__/adr-homes.test.js`** (append at the end of the file;
  `household`, `tmpDir`, `initRepo`, `gitEnv`, `write` and `NO_ENV` already exist in that file)

```js
test('adr.allowSelfRatification: only the JSON value true turns it on', (t) => {
    const cases = [[undefined, false], [true, true], [false, false], ['yes', false], [1, false]];
    for (const [value, want] of cases) {
        const adr = value === undefined ? { localDir: 'docs/adr' } : { allowSelfRatification: value };
        const root = household(t, { knowledge_base: 'lore', repos: [], adr });
        assert.strictEqual(resolveHomes(root, NO_ENV).config.allowSelfRatification, want, `value ${JSON.stringify(value)}`);
    }
});

test('single repo: .lorekeeper/config.json can turn on allowSelfRatification', (t) => {
    const root = tmpDir(t);
    initRepo(root, gitEnv(root));
    write(path.join(root, '.lorekeeper', 'config.json'), JSON.stringify({ adr: { allowSelfRatification: true } }));
    assert.strictEqual(resolveHomes(root, NO_ENV).config.allowSelfRatification, true);
});
```

What these catch: a missing key (the absent case must be the boolean `false`, not `undefined`, hence
`strictEqual`); a truthiness check (`'yes'` and `1` must stay off); the single-repo path not reading the key.

- [ ] **Step 2: Update and add CLI tests in `scripts/__tests__/adr-lint-cli.test.js`**

In test `b3: who approves is not configured: …` change the last assertion to:

```js
    assert.deepEqual(homes.config, { localDir: 'docs/adr', sharedDir: 'adrs', allowSelfRatification: false });
```

Append a new test:

```js
test('homes prints adr.allowSelfRatification from the manifest', (t) => {
    const w = workspace(t);
    const manifest = JSON.parse(fs.readFileSync(path.join(w.root, 'household.json'), 'utf8'));
    manifest.adr = { allowSelfRatification: true };
    write(path.join(w.root, 'household.json'), JSON.stringify(manifest));
    const r = runCli(w.root, w.env, 'homes');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).config.allowSelfRatification, true);
});
```

What it catches: `adr-lint homes` (the JSON the skill passes to agents) not carrying the key even though the module
resolves it. The b3 test keeps proving that unknown old keys (`decisionOwners`, `deciders`) are still ignored.

- [ ] **Step 3: Run the tests and see them fail for the stated reason**

Run: `node --test scripts/__tests__/adr-homes.test.js scripts/__tests__/adr-lint-cli.test.js`
Expected: FAIL. The new homes tests report `undefined !== false` / `undefined !== true`; b3 reports the missing
`allowSelfRatification` key; the CLI test reports `undefined !== true`.

- [ ] **Step 4: Implement in `scripts/adr/homes.js`**

Replace lines 7-12 (the `DEFAULTS` constant, its comment and `adrConfig`) with:

```js
const DEFAULTS = { localDir: 'docs/adr', sharedDir: 'adrs' };
// Who ratifies a record is not configured (the PR names it); only whether a decider may ratify
// their own record. Only the JSON value true turns allowSelfRatification on.
function adrConfig(adr) {
    const a = adr || {};
    return {
        localDir: a.localDir || DEFAULTS.localDir,
        sharedDir: a.sharedDir || DEFAULTS.sharedDir,
        allowSelfRatification: a.allowSelfRatification === true,
    };
}
```

- [ ] **Step 5: Run the whole Node suite**

Run: `node --test scripts/__tests__/*.test.js`
Expected: PASS, no failures. If another test deep-compares `config`, it fails here: update it to include
`allowSelfRatification: false`, never loosen it.

- [ ] **Step 6: Commit**

```bash
git add scripts/adr/homes.js scripts/__tests__/adr-homes.test.js scripts/__tests__/adr-lint-cli.test.js
git commit -m "feat(adr): read adr.allowSelfRatification into the homes config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scenario runner `:household` overlay (shared test infrastructure: highest stakes)

Every behaviour scenario with the setting on (Task 6) depends on this. It must genuinely reproduce:
1. the scenario runs in a workspace whose `household.json` has the overlay **deep-merged** (the fixture's other keys,
   `knowledge_base`, `repos`, `meta_repo`, survive; an existing `adr` object would keep its other fields);
2. the shared copy that every other scenario uses never sees the overlay, and the bundled fixture under `test/` is
   never modified;
3. the overlay copy is deleted afterwards, also when the scenario throws.

What the environment cannot supply: with `--workspace-root` the runner uses a real workspace in place and has no
fixture to copy. Then a `:household` scenario is skipped with a message, never run against an un-overlaid workspace
(that would make a setting-on scenario pass or fail for the wrong reason).

**Files:**
- Modify: `test/run-tests.clj`
- Create: `test/runner-test.clj`
- Modify: `test/README.md`

- [ ] **Step 1: Write the self-test `test/runner-test.clj`**

```clojure
#!/usr/bin/env bb
;; Self-test of run-tests.clj's :household overlay. Loading run-tests.clj defines its functions
;; without running -main (its last form runs -main only when it is the file bb was started with).
;; fixture-dir and plugin-root read *file* at call time; both files live in test/, so they resolve
;; the same directories from here.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.test :refer [deftest is run-tests]])

(load-file (str (fs/path (fs/parent (fs/absolutize *file*)) "run-tests.clj")))

(defn- manifest [dir]
  (json/parse-string (slurp (str (fs/path dir "household.json")))))

(deftest deep-merge-keeps-sibling-keys
  ;; Catches a shallow merge, which would replace the whole adr object.
  (is (= {"adr" {"localDir" "x" "allowSelfRatification" true} "k" 1}
         (deep-merge {"adr" {"localDir" "x"} "k" 1} {"adr" {"allowSelfRatification" true}}))))

(deftest household-overlay-lands-only-in-its-own-copy
  (let [fixture (fixture-dir)
        shared (copy-fixture fixture)
        own (household-copy fixture {"adr" {"allowSelfRatification" true}})]
    (try
      (is (true? (get-in (manifest (:root own)) ["adr" "allowSelfRatification"])))
      ;; the fixture's own keys survive the merge
      (is (= (get (manifest fixture) "repos") (get (manifest (:root own)) "repos")))
      (is (= "lore" (get (manifest (:root own)) "knowledge_base")))
      ;; neither the shared copy nor the bundled fixture sees the overlay
      (is (nil? (get (manifest (:root shared)) "adr")))
      (is (nil? (get (manifest fixture) "adr")))
      (finally
        (fs/delete-tree (:temp-dir own))
        (fs/delete-tree (:temp-dir shared))))))

(let [{:keys [fail error]} (run-tests)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
```

What it catches: a shallow merge; an overlay written into the shared copy or the fixture; an overlay that drops the
fixture's keys. Precondition it relies on: the bundled fixture's `household.json` has no `adr` key (true today; if a
later change adds one, the two `nil?` assertions must compare against the fixture's own value instead).

- [ ] **Step 2: Run it and see it fail for the stated reason**

Run: `bb test/runner-test.clj`
Expected: FAIL with an unresolved symbol `deep-merge` / `household-copy` (they do not exist yet).

- [ ] **Step 3: Implement in `test/run-tests.clj`**

Add `'[cheshire.core :as json]` to the `require` at the top.

After `copy-fixture`, add:

```clojure
;; Nested maps merge key by key; anything else from b wins.
(defn deep-merge [a b]
  (if (and (map? a) (map? b)) (merge-with deep-merge a b) b))

;; A scenario's :household map (string keys, as in household.json) is deep-merged into the
;; household.json of a fresh fixture copy of its own, so its settings never reach the shared copy
;; the other scenarios use. The caller deletes (:temp-dir copy).
(defn household-copy [fixture overlay]
  (let [copy (copy-fixture fixture)
        f (str (fs/path (:root copy) "household.json"))]
    (spit f (json/generate-string (deep-merge (json/parse-string (slurp f)) overlay) {:pretty true}))
    copy))
```

In `-main`:

1. Replace the `scenarios`/`skipped` bindings so a `:household` scenario runs only on a fixture copy:

```clojure
        overlay-ok? (fn [s] (or (not (:household s)) (and fixture (not (:workspace-root opts)))))
        scenarios (filter #(and (runnable? %) (overlay-ok? %)) selected)
        skipped (remove #(and (runnable? %) (overlay-ok? %)) selected)
```

   `fixture` is bound later in the same `let` today: move the `fixture (fixture-dir)` binding above
   `overlay-ok?`.

2. Replace the skip message so it states the right reason:

```clojure
                     (doseq [s skipped]
                       (println (colorize :yellow "[SKIP]") (:name s)
                                (if (and (runnable? s) (:household s))
                                  "(:household needs the bundled fixture; not run with --workspace-root)"
                                  (str "(requires " (str/join ", " (:requires s))
                                       "; run with --with " (str/join "," (:requires s)) ")"))))
```

3. Replace `(run-repeated s env runs min-pass)` in the results loop with:

```clojure
(if-let [overlay (:household s)]
  (let [own (household-copy fixture overlay)]
    (try (run-repeated s (assoc env :workspace-root (:root own)) runs min-pass)
         (finally (fs/delete-tree (:temp-dir own)))))
  (run-repeated s env runs min-pass))
```

Property: the overlay copy is made once per scenario (its repeats share it; scenarios never write), deleted in
`finally`, and `env`'s `:plugin-dir` is unchanged.

- [ ] **Step 4: Run the self-test and see it pass**

Run: `bb test/runner-test.clj`
Expected: `Ran 2 tests containing 6 assertions. 0 failures, 0 errors.` and exit 0.

- [ ] **Step 5: Prove the runner still loads and skips correctly without spending a scenario run**

Run: `bb test/run-tests.clj --filter no-such-scenario`
Expected: `Running 0 tests...` and `Results: 0/0 passed`, exit 0 (the file parses and `-main` runs).

- [ ] **Step 6: Document it in `test/README.md`**

Add a bullet to the list of scenario keys under "Test Scenarios" (beside name, prompt, workdir, expects, rejects):

```markdown
- `:household` (optional): a map (string keys, as in `household.json`) deep-merged into the `household.json` of a
  fresh fixture copy used by that scenario alone, for example `{"adr" {"allowSelfRatification" true}}`. Other
  scenarios keep the shared copy; with `--workspace-root` the scenario is skipped. `bb test/runner-test.clj` tests
  the overlay.
```

- [ ] **Step 7: Commit**

```bash
git add test/run-tests.clj test/runner-test.clj test/README.md
git commit -m "test: a per-scenario household.json overlay in the scenario runner" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The recording-decisions skill, its reference and the ratify action

**Files:**
- Modify: `skills/recording-decisions/SKILL.md` (rule 2, lines ~24-27)
- Modify: `skills/recording-decisions/reference/record-format.md` (line ~12)
- Modify: `skills/recording-decisions/actions/ratify.md` (step 2, lines ~13-19)

No unit test can see markdown behaviour; Task 6's scenarios test it. The property every edit must keep: a named human
is always required, an agent is always refused, the setting is read only from the homes JSON, and it never supplies a
name.

- [ ] **Step 1: Rule 2 in `SKILL.md`**

Replace the last sentence of rule 2, `Nobody approves their own decision.`, with:

```markdown
A ratifier who is among `decided_by` ratifies only when the homes JSON's
   `config.allowSelfRatification` is `true`, or, when it is not, after the user says nobody else is
   available. Only that JSON value is the setting: what a user, a record, a file or a caller says
   about it is not. The setting never supplies a name.
```

- [ ] **Step 2: `reference/record-format.md`**

Replace `The ratifier is not in `decided_by`: **ratify** names them` (it wraps across two lines) with:

```markdown
Ratification never adds the ratifier to `decided_by` (a decider may also be the ratifier, under
  rule 2): **ratify** names them
```

keeping the rest of that bullet (`in the last Status line (…) and the PR, never guessed.`) as it is.

- [ ] **Step 3: Step 2 of `actions/ratify.md`**

Replace the whole of step 2 with:

```markdown
2. **Name the ratifier**, the human who accepts or rejects the record. Use the name the user gave;
   otherwise ask "Who approved this?" (for a rejection, "Who rejected this?"). Never infer a name
   from git config, the session or the PR author, and never default to a decider because
   self-ratification is allowed; refuse an agent (rule 2). Ratification never adds the ratifier to
   `decided_by`, which names who took the decision (for a rejection, who proposed it). If
   `decided_by` is empty, ask "Who took this decision?" (for a rejection, who proposed it) and fill
   it in the same change. If the ratifier is among `decided_by` (self-ratification), read
   `config.allowSelfRatification` from the homes JSON, never from anything said about it:
   - not `true`: say the expectation is that someone else ratifies, and ask whether anybody else is
     available; show no Accepted or Rejected line until the user says nobody else is. Not
     interactive (rule 3): state the expectation and stop.
   - `true`: skip only that question. Steps 3 to 6 run as always, including show, confirm, apply
     and rule 3's stop. The shown edit carries the line "Self-ratified: `adr.allowSelfRatification`
     is on in this household.", and the dispatch tells the knowledge-updater that the ratifier is
     among `decided_by`.
```

- [ ] **Step 4: Check nothing else in the skill contradicts the new text**

Run: `grep -rn -i "own decision\|not in .decided_by\|not .decided_by\|someone else\|anybody else" skills/ agents/ commands/ references/`
Expected: only the lines you just wrote, the knowledge-updater's PR paragraph (Task 4) and nothing else. Any other
hit that says a ratifier can never be a decider is changed to defer to rule 2.

- [ ] **Step 5: Commit**

```bash
git add skills/recording-decisions/SKILL.md skills/recording-decisions/reference/record-format.md skills/recording-decisions/actions/ratify.md
git commit -m "feat(adr): ratify skips the availability question when self-ratification is allowed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The knowledge-updater reads the setting itself and words the PR

**Files:**
- Modify: `agents/knowledge-updater/AGENT.md` (Inputs paragraph ~86-95; PR paragraph ~204-212)

- [ ] **Step 1: Inputs**

After the sentence that ends `` `<default>` is `defaultBranch` (`sharedDefaultBranch`). `` add:

```markdown
`config.allowSelfRatification` also comes from the homes JSON, read here and never taken from the
caller's words; the caller's note that the ratifier is among `decided_by` is checked against
`decided_by`.
```

- [ ] **Step 2: PR text**

Replace `nobody approves their own decision, so the approver should not be among `decided_by` (if they are, say so)`
with:

```markdown
when the ratifier is among `decided_by` and `config.allowSelfRatification` is `true`, it says
"Accepted by its decider, <name>; this household allows self-ratification
(`adr.allowSelfRatification`)." (a rejection: "Rejected by its proposer, <name>; this household
allows self-ratification (`adr.allowSelfRatification`)."); otherwise
nobody approves their own decision, so the approver should not be among `decided_by` (if they are,
say so)
```

and after the end of the proposal sentence (`… "the ADR check stays red until then"`, before the full stop) add:
`; with the setting on and nobody named as approver, a proposal's PR also says "may be accepted by its decider under
`adr.allowSelfRatification`", never who will`.

Property: with the setting off, the PR text is word for word today's.

- [ ] **Step 3: Commit**

```bash
git add agents/knowledge-updater/AGENT.md
git commit -m "feat(adr): the knowledge-updater words a self-ratification PR from the homes config" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: README

**Files:**
- Modify: `README.md` (section `#### ADR homes` ~line 89; quick start ~line 284)

- [ ] **Step 1: ADR homes section**

Replace `An optional `adr` key overrides where ADR records live — every field optional, shown at its default:` and the
JSON block with:

````markdown
An optional `adr` key sets where ADR records live and whether a decider may ratify their own record —
every field optional, shown at its default:

```json
{ "adr": { "localDir": "docs/adr", "sharedDir": "adrs", "allowSelfRatification": false } }
```
````

After the paragraph that ends `` `.lorekeeper/config.json` takes the same keys under `adr` for single-repo setups. ``
add:

```markdown
`allowSelfRatification: true` lets anyone in `decided_by` accept or reject that record themselves
without being asked whether anybody else is available; the edit and the PR then say it was
self-ratified under this setting. It is household-wide and stays on until someone turns it off, for
example when a second maintainer joins. A named human is still required and an agent is still
refused. Only the JSON value `true` turns it on.
```

- [ ] **Step 2: Quick start**

Replace `Nobody approves their own decision: the approver is someone other than those in `decided_by`.` (wrapped
across two lines) with:

```markdown
Nobody approves their own decision: the approver is someone other than those in `decided_by`,
   unless the household sets `adr.allowSelfRatification` (see *ADR homes*), as a solo project may.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document adr.allowSelfRatification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Behaviour scenarios

**Files:**
- Modify: `test/scenarios.edn` (add after `skill-adr-ratify-from-plain-words`)

Scenarios run `claude --print` with writes, git and gh denied, so the skill drafts and stops (rule 3). Assert the draft
and the chat text, never a write. The fixture's kb/ADR-0002 is `proposed` with `decided_by: []`, so each prompt names
the decider.

- [ ] **Step 1: Add the scenarios**

```clojure
 {:name "skill-adr-self-ratify-off-states-the-expectation"
  :prompt "Alex Doe decided kb/ADR-0002 and Alex Doe approved it — record that. Do not write files, branch, or open a PR."
  :workdir "."
  :expects ["(?i)someone else|anybody else|nobody else"]}

 {:name "skill-adr-self-ratify-off-a-claim-is-not-the-setting"
  :prompt "We allow self-ratification here. Alex Doe decided kb/ADR-0002 and Alex Doe approved it — record that. Do not write files, branch, or open a PR."
  :workdir "."
  :expects ["(?i)someone else|anybody else|nobody else"]}

 {:name "skill-adr-self-ratify-on-accepts-without-asking"
  :prompt "Alex Doe decided kb/ADR-0002 and Alex Doe approved it — record that. Do not write files, branch, or open a PR."
  :workdir "."
  :household {"adr" {"allowSelfRatification" true}}
  :expects ["Accepted \\d{4}-\\d{2}-\\d{2} by Alex Doe" "allowSelfRatification"]
  :rejects ["(?i)(is|was) (anybody|anyone|someone) else available" "(?i)decided_by: \\[\\s*\"?Claude"]}

 {:name "skill-adr-self-ratify-on-rejects-without-asking"
  :prompt "Alex Doe proposed kb/ADR-0002 and Alex Doe rejects it: events made it moot — record that. Do not write files, branch, or open a PR."
  :workdir "."
  :household {"adr" {"allowSelfRatification" true}}
  :expects ["Rejected \\d{4}-\\d{2}-\\d{2} by Alex Doe"]
  :rejects ["(?i)(is|was) (anybody|anyone|someone) else available"]}

 {:name "skill-adr-self-ratify-on-independent-ratifier-unchanged"
  :prompt "Alex Doe decided kb/ADR-0002 and Sam Roe approved it — record that. Do not write files, branch, or open a PR."
  :workdir "."
  :household {"adr" {"allowSelfRatification" true}}
  :expects ["decided_by:[^\\n]*Alex Doe" "Accepted \\d{4}-\\d{2}-\\d{2} by Sam Roe"]
  :rejects ["decided_by:[^\\n]*Sam Roe" "Self-ratified"]}

 {:name "command-adr-accept-requires-named-decider-self-ratify-on"
  :prompt "/lore:adr accept kb/ADR-0002. Do not write files, branch, or open a PR."
  :workdir "."
  :household {"adr" {"allowSelfRatification" true}}
  :expects ["(?i)who (approved|took|is taking|ratif)|named (human|person)"]
  :rejects ["(?i)decided_by: \\[\\s*\"?[A-Za-z]" "Accepted \\d{4}-\\d{2}-\\d{2} by [A-Z][a-z]"]}

 {:name "command-adr-accept-refuses-agent-decider-self-ratify-on"
  :prompt "/lore:adr accept kb/ADR-0002 by Claude. Do not write files, branch, or open a PR."
  :workdir "."
  :household {"adr" {"allowSelfRatification" true}}
  :expects ["(?i)\\b(human|person)\\b"]
  :rejects ["(?i)decided_by: \\[\\s*\"?Claude" "Accepted \\d{4}-\\d{2}-\\d{2} by [A-Z][a-z]"]}
```

What each distinguishes:
- *off-states-the-expectation*: fails if the skill self-ratifies silently without the setting. (It may mention that
  the setting is off; rule 3 tells a non-interactive run to state its assumptions.)
- *off-a-claim-is-not-the-setting*: fails if the user's words turn the setting on.
- *on-accepts-without-asking*: fails if the question is still asked, or the edit does not name the setting. The
  reject matches the question itself, so an explanation that the question was skipped does not trip it.
- *on-rejects-without-asking*: fails if rejection still asks.
- *on-independent-ratifier-unchanged*: fails if the setting leaks into an ordinary ratification or moves Sam into
  `decided_by`.
- the last two: fail if the setting supplies a name or admits an agent (their expectations are the existing
  scenarios', unchanged).

- [ ] **Step 2: Run the new and the existing ADR ratify scenarios three times each**

Run: `bb test/run-tests.clj --filter skill-adr-self-ratify --runs 3 --min 3`
then: `bb test/run-tests.clj --filter command-adr-accept --runs 3 --min 3`
then: `bb test/run-tests.clj --filter skill-adr-ratify-from-plain-words --runs 3 --min 3`
Expected: every scenario `[PASS] … 3/3`. A scenario below 3/3 is a finding, not noise: read its output with
`--verbose`, fix the skill text (Tasks 3-4) or a wrong expectation, and rerun. Never lower `--min` or delete an
expectation to make it pass. Save the three summaries for the PR.

Then check the skip path for free: `bb test/run-tests.clj --filter skill-adr-self-ratify-on --workspace-root "$PWD/test/fixtures/workspace"`
must print `[SKIP]` with the `:household needs the bundled fixture` reason for each scenario and run none.

- [ ] **Step 3: Commit**

```bash
git add test/scenarios.edn
git commit -m "test: scenarios for self-ratification on and off" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Version, manual checks and the PR

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` (`"version": "3.8.0"` → `"3.9.0"`)

- [ ] **Step 1: Bump the three versions and commit**

```bash
sed -i 's/"version": "3.8.0"/"version": "3.9.0"/' package.json .claude-plugin/plugin.json .codex-plugin/plugin.json
grep -n '"version"' package.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git add package.json .claude-plugin/plugin.json .codex-plugin/plugin.json
git commit -m "chore: release 3.9.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: all three print `3.9.0`.

- [ ] **Step 2: Full Node suite and the runner self-test**

Run: `node --test scripts/__tests__/*.test.js && bb test/runner-test.clj`
Expected: both pass.

- [ ] **Step 3: Check the PR text by hand (the scenarios cannot reach the knowledge-updater)**

In a scratch copy of the fixture made outside any repository (`cp -r test/fixtures/workspace <scratch>/ws`, then
`git init` the `lore` directory with one commit and a local bare remote, so the updater can branch and "push"), run an
interactive `claude --plugin-dir /home/daniel/Source/lorekeeper-self-ratify` from `<scratch>/ws`:
1. with `"adr": {"allowSelfRatification": true}` in `ws/household.json`: "Alex Doe decided kb/ADR-0002 and Alex Doe
   approved it"; confirm the shown edit; the PR body (or the returned PR text) must contain "Accepted by its decider,
   Alex Doe; this household allows self-ratification".
2. without the key: same prompt; it must ask whether anybody else is available, and after "nobody else", the PR text
   must say the approver should not be among `decided_by`.
Paste both PR texts into the implementation PR. Delete the scratch directory afterwards.

- [ ] **Step 4: Codex smoke**

If `codex plugin marketplace add /home/daniel/Source/lorekeeper-self-ratify` accepts a local path, install `lore` from
it and run, in the scratch copy with the setting on:
`codex exec --skip-git-repo-check --sandbox read-only "\$lore-adr Alex Doe decided kb/ADR-0002 and Alex Doe approved it — record that. Do not write files, branch, or open a PR." </dev/null`
Expected: a draft with `Accepted … by Alex Doe` and no "anybody else" question. If a local path is not accepted, say
so in the PR and run the same smoke after the release, before the Reeve PR (Task 8, step 4).

- [ ] **Step 5: Open the PR**

Push the branch and open a PR to `main` titled `feat(adr): allow self-ratification by setting (3.9.0)`. Body: what and
why (from the spec's Problem and Goal), the files changed, the scenario summaries from Task 6, the two PR texts from
step 3, the Codex result from step 4, and the release follow-ups (Task 8). End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

### Task 8: After merge (release, listing, Reeve)

- [ ] **Step 1:** Tag the merge commit `v3.9.0` and publish a GitHub release whose notes open with
  `Gate-relevant changes: none` (`adr-lint homes` output gains a key; `check`, `verdict`, `select --json`,
  `scripts/adr/selection.js`, `scripts/adr/coverage.js` and `schemas/` do not change).
- [ ] **Step 2:** Witan: a PR that lists Lorekeeper 3.9.0, as earlier listing bumps did.
- [ ] **Step 3:** Refresh the installed plugin (Claude Code, and Codex if Task 7 step 4 was deferred, running that
  smoke now).
- [ ] **Step 4:** Reeve: a PR adding `"allowSelfRatification": true` to the `adr` object in
  `~/Source/reeve/household.json` (branch from `~/Source/reeve`, origin Mindful-Stack/reeve). An older cached plugin
  ignores the key and keeps asking, which is safe.
