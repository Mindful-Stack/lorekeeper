# Reeve planning skills for Lorekeeper — implementation plan (Reeve milestone one, plan D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `reeve` CLI on the path reports itself as the planner and the user is signed in, Lorekeeper gains two planning skills (`planning-initiative`, `refining-epic`), brainstorming reads the story's context bundle first, and recording-decisions links a drafted record to its required decision; absent the planner, every skill behaves exactly as today.

**Architecture:** Markdown skills only (this plugin's convention), plus one small Node script `scripts/reeve-detect.js` that answers "is the planner present and am I signed in" deterministically (`reeve --version` must print `reeve-planner …`; `reeve auth status --json` must be `ok`), used by every hook so detection is one tested piece of code. Every `reeve` call uses `--json`, branches on the exit status (0 ok, 2 refused, 1 failure) and passes `--idempotency-key` on creates. Skills never write a spec; they write into the planner (briefs, required decisions, epics, stories with criteria) and link records.

**Tech Stack:** Claude Code plugin markdown (`skills/*/SKILL.md`, `actions/`, `reference/`), Node 22 script with `node --test`, Babashka scenario tests (`bb test/run-tests.clj`) with a fake `reeve` under `test/fixtures/reeve-bin/`.

## Governing decisions

The accepted records live in the Reeve planner's knowledge base (`~/Source/reeve/lore/knowledge/adrs/`, prefix `kb`); this repository has no ADR home, and `adr-lint select` cannot run across repositories, so the records were read directly (2026-10-26). Rules quoted verbatim. No invalidation trigger fires.

- **kb/ADR-0005 — Lorekeeper optionally drives Reeve through the reeve CLI when it is present; Reeve never depends on Lorekeeper** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0005.R1 — "Skills MUST detect the planner by `reeve --version` reporting `reeve-planner` and by a successful login; absent either, every skill MUST behave as before; no manifest change MAY be required."
  - kb/ADR-0005.R2 — "The runner's CLI MUST be renamed so it never answers to `reeve`."
  - kb/ADR-0005.R3 — "Every `reeve` command used by a skill MUST support `--json` and MUST exit with a distinct status for success, refusal and failure; create commands MUST accept a caller-supplied idempotency key and MUST NOT deduplicate on titles."
  - kb/ADR-0005.R4 — "Initiative and epic planning MUST be separate skills that produce no spec; the brainstorming skill's hard gate and checklist MUST NOT be weakened; recording-decisions MUST link a drafted record to its required decision when the planner is present."
  - kb/ADR-0005.R5 — "Reeve MUST NOT require Lorekeeper for any planning function; an MCP server, if ever added, MUST wrap the same commands."
- **kb/ADR-0004 — Decision records stay in git; the planner tracks required decisions …** (accepted 2026-10-26)
  - kb/ADR-0004.R3 — "Setting or changing a reference MUST reset the check result and trigger an immediate check of that required decision; no item keys MAY be written into records."
  - kb/ADR-0004.R5 — "Broad product reasoning MUST live in the initiative brief; a hard-to-reverse non-architectural choice MUST be a decision record, and Lorekeeper's record triage MUST draft process, tooling and product records rather than decline them; no separate RFC artifact MAY be introduced."
- **kb/ADR-0002 — Work is initiative, epic and story …** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0002.R1 — "A story MUST be sized so that one person or one agent session can finish it; it MAY link to any number of pull requests; the planner MUST NOT introduce a fourth hierarchy level."
  - kb/ADR-0002.R6 — "The vocabulary initiative, epic, story and decision MUST be used across API, database, CLI and UI."
- **kb/ADR-0003 — Readiness is computed …** (accepted 2026-10-26; scope includes `lorekeeper:skills/**`)
  - kb/ADR-0003.R1 — "The planner MUST NOT persist a readiness value; every readiness answer MUST be derived from current facts and MUST include the failing reasons; no named maturity level other than ready MAY be exposed on stories."

How the rules shape this plan: detection is exactly R1's two checks and nothing else (no manifest key, no env var requirement); every command in a skill carries `--json`, branches on exit 0/2/1 and passes `--idempotency-key` (R3; the CLI already does this per plan A); the two new skills write to the planner and never produce a spec (R4); the brainstorming hard gate and checklist keep every existing step — the only change is a new first step that reads context when the planner is present (R4); recording-decisions links at the apply step, when the record's path and id are final, with `reeve decision link` (R4, kb/ADR-0004 R3), and its triage drafts process/tooling/product records instead of sending them to an RFC or meeting notes (kb/ADR-0004 R5); readiness is only ever read from the planner, never inferred or stored by a skill (kb/ADR-0003 R1).

Design choices this plan makes (reversible):

- **One detector script.** `node <plugin-root>/scripts/reeve-detect.js` prints JSON `{ "present": bool, "signed_in": bool, "url": string|null, "email": string|null, "reason": string }` and exits 0 always; it runs `reeve --version` (must start with `reeve-planner`) and `reeve auth status --json` (must be `{"outcome":"ok",...}`), each with a 10 s timeout, honouring `REEVE_BIN` (tests) over `PATH`. Skills call it once and branch on `present && signed_in`.
- **Required decisions carry the Lorekeeper id-to-be.** When brainstorming or a planning skill drafts a record for a required decision, the decision's title is the record's title and the link is made at apply time, when the file path exists on a branch with a PR: `reeve decision link <id> --record <kb/ADR-NNNN> --repo <name> --path <path> --pr <url> --household <dir>`. Before apply, the planner shows the decision as "no record"; after link, "proposed, PR open"; after acceptance and the next check, satisfied. Nothing is written into records (kb/ADR-0004 R3).
- **Placement lives in refining-epic.** Untriaged stories (`reeve story ls --untriaged --json`) are offered homes during epic refinement; no separate triage skill.
- **Codex twins.** `lore-planning-initiative` and `lore-refining-epic` SKILL.md files mirror the Claude skills with the Codex wording, as every other skill pair does.

## File structure

- `scripts/reeve-detect.js`, `scripts/__tests__/reeve-detect.test.js`
- `skills/planning-initiative/SKILL.md`, `skills/planning-initiative/reference/brief-template.md`
- `skills/refining-epic/SKILL.md`
- `skills/lore-planning-initiative/SKILL.md`, `skills/lore-refining-epic/SKILL.md`
- `references/reeve-cli.md` (the command contract every skill quotes: commands, flags, exit codes, idempotency keys, JSON shapes)
- Modify: `skills/brainstorming/SKILL.md` (new first step 0), `skills/recording-decisions/actions/record.md` (step 3 triage, step 6 link), `skills/recording-decisions/SKILL.md` (one line in "Where a change lands"), `hooks/load-standards-reminder.sh` (router rows), `README.md` (skills table), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (version 3.2.0), `test/scenarios.edn`, `test/README.md`, `test/fixtures/reeve-bin/reeve` (a fake planner CLI script), `docs/agent/backlog.md` if it lists this work.

## Task order

1 detector + CLI reference → 2 planning-initiative → 3 refining-epic → 4 brainstorming step 0 → 5 recording-decisions triage + link → 6 router, README, Codex twins, version, scenarios.

---

## Global constraints (copy into every implementer brief)

- No skill writes a spec or a plan on the planner's behalf; planning skills write to the planner through `reeve` and print what they wrote.
- Every `reeve` call in a skill: `--json`; exit 0 → proceed, 2 → show the refusal reasons and stop that step, 1 → show the error and stop; creates pass `--idempotency-key <stable id>` derived from the session and the item (so a retry gets the same item). Never deduplicate on titles.
- Absent the planner (detector says `present: false` or `signed_in: false`), every skill behaves exactly as on `origin/main` today; the diff of those skills must be additive and guarded.
- Paths inside skills are written as `<plugin-root>/…`, absolute in every Bash command.
- Vocabulary: initiative, epic, story, decision; "discovery complete"; "ready" / "blocked with reasons".
- Tests: a Node test for the script; a Babashka scenario per skill with the fake `reeve`; the mutation check from docs/writing-skills-guide.md (delete the skill text, the scenario must fail).
- Commits: `feat(skills): …`, `test: …`, `docs: …`; a heredoc body naming the plan task; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: The detector script and the CLI reference

**Files:**
- Create: `scripts/reeve-detect.js`, `scripts/__tests__/reeve-detect.test.js`, `references/reeve-cli.md`, `test/fixtures/reeve-bin/reeve`

- [ ] **Step 1: Failing test**

```js
// scripts/__tests__/reeve-detect.test.js — node --test
const { test } = require('node:test'); const assert = require('node:assert'); const { execFileSync } = require('node:child_process'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const script = path.join(__dirname, '..', 'reeve-detect.js');
function fake(dir, version, status) {   // writes an executable `reeve` into dir
  const p = path.join(dir, 'reeve');
  fs.writeFileSync(p, `#!/bin/sh\ncase "$1" in --version) echo "${version}";; auth) echo '${status}';; *) exit 1;; esac\n`); fs.chmodSync(p, 0o755); return p;
}
test('planner present and signed in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  const bin = fake(dir, 'reeve-planner 0.1.0', '{"outcome":"ok","value":{"email":"dan@example.com","url":"http://127.0.0.1:7474"}}');
  const out = JSON.parse(execFileSync('node', [script], { env: { ...process.env, REEVE_BIN: bin } }));
  assert.deepStrictEqual(out, { present: true, signed_in: true, url: 'http://127.0.0.1:7474', email: 'dan@example.com', reason: '' });
});
test('the runner answering to reeve is not the planner', () => { /* version "reeve 0.9.0" → present:false, reason mentions reeve-planner */ });
test('present but signed out', () => { /* auth status → {"outcome":"error","code":"unauthenticated",...} → present:true, signed_in:false */ });
test('missing binary', () => { /* REEVE_BIN pointing at a non-existent path → present:false; exit code 0 */ });
test('a hanging binary times out', () => { /* fake sleeps 15s → present:false, reason "timed out"; runs under 11s */ });
```

What these distinguish: a detector that accepts the renamed runner (kb/ADR-0005 R1/R2), one that reports signed-in from `--version` alone, and one that hangs a session.

- [ ] **Step 2: Script**

`reeve-detect.js`: resolve the binary (`REEVE_BIN` or `reeve` on PATH via `execFileSync('sh', ['-c', 'command -v reeve'])`), run `--version` and `auth status --json` with `timeout: 10_000`, parse, print one JSON line, always exit 0. No dependencies.

- [ ] **Step 3: The fake planner for scenarios**

`test/fixtures/reeve-bin/reeve`: a POSIX shell script that answers `--version` (`reeve-planner 0.1.0-fake`), `auth status --json` (ok), `story context <key> --json` (a fixed bundle with an initiative brief, an epic brief, one required decision `{"id": 7, "title": "Queue or cron", "check": {"kind":"no_record"}}`, two criteria, no blockers, one comment), `story ls --untriaged --json` (two stories), `initiative ls|show|create|edit --json`, `epic ls|create|edit --json`, `story create --json`, `decision require|link --json`, each echoing an `{"outcome":"ok","value":…}` envelope and appending the full argv line to `$REEVE_FAKE_LOG` so scenarios can assert what was called (including `--idempotency-key` and `--json`); unknown commands exit 1 with an error envelope. Documented in `test/README.md`: `PATH="$PWD/test/fixtures/reeve-bin:$PATH" REEVE_FAKE_LOG=/tmp/reeve.log bb test/run-tests.clj --filter reeve`.

- [ ] **Step 4: The CLI reference**

`references/reeve-cli.md`: the contract skills quote — detection (the script), the envelope and exit codes, idempotency keys (`<skill>:<session-or-item>:<n>`), and the exact commands used: `reeve story context <key> --json`; `reeve story ls --untriaged --json`; `reeve story ls --epic <KEY> --json`; `reeve initiative show <KEY> --json`; `reeve initiative edit <KEY> --brief-file <path> --version <n> --json`; `reeve initiative discovery <KEY> --complete --version <n> --json`; `reeve epic create --initiative <KEY> --title … --idempotency-key … --json`; `reeve epic edit <KEY> --brief-file … --version <n> --json`; `reeve epic discovery <KEY> --complete --version <n> --json`; `reeve story create --epic <KEY> --title … --kind story --criterion … --idempotency-key … --json`; `reeve story edit <KEY> --epic <KEY> --version <n> --json`; `reeve decision require --on <KEY> --title … --decider <email> [--due YYYY-MM-DD] --idempotency-key … --json`; `reeve decision link <id> --record <id> --repo <name> --path <path> --pr <url> --household <dir> --json`. Each with the response field the skill reads (`value.key`, `value.version`, `value.id`). (Verify every flag against `reeve <cmd> --help` in ~/Source/reeve at implementation time and correct the reference; the reference is the one place skills copy from.)

```bash
git add scripts references test
git commit -m "feat(skills): reeve planner detector, cli reference and fake planner for scenarios" -m "Task 1 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `planning-initiative`

**Files:**
- Create: `skills/planning-initiative/SKILL.md`, `skills/planning-initiative/reference/brief-template.md`
- Test: `test/scenarios.edn` (scenario `skill-planning-initiative`)

The skill (frontmatter `name: planning-initiative`, description: "Plan an initiative in the Reeve planner: run discovery with the architect's survey plus research, update the brief, create required decisions with a decider, propose epics. Use when the user names an initiative key (GRA-12) or says 'plan this initiative', 'discovery for …', 'what do we need to decide before …'. Only when the Reeve planner is present and signed in; otherwise say so and stop."). Steps:

0. **Detect.** `node <plugin-root>/scripts/reeve-detect.js`; if not `present && signed_in`, say "the Reeve planner is not available in this session (reason)" and stop; this skill has no fallback (it exists only for the planner).
1. **Read.** `reeve initiative show <KEY> --json` (brief, horizon, owner, discovery mark, version) and `reeve decision ls --on <KEY> --json`; dispatch in parallel the **architect** in `survey` mode on the repositories the initiative touches and the **knowledge-reader** with the initiative's title; research what the team does not know yet (web or docs) when the user asks.
2. **Discovery conversation**, one question at a time, following `reference/brief-template.md` headings (Vision, Capabilities, Known knowns, Open questions — the team's convention, not fields): what the outcome is, who it is for, what we already know, what is open.
3. **Write the brief**: compose the Markdown, show it, on confirmation `reeve initiative edit <KEY> --brief-file <tmpfile> --version <n> --json`; a 409 (`code: conflict`) re-reads and retries once with the new version after showing the diff.
4. **Required decisions**: for each open question that is a consequential choice blocking work (not a clarification — kb/ADR-0004 R2 wording), ask who decides and by when, then `reeve decision require --on <KEY> --title … --decider … [--due …] --idempotency-key planning-initiative:<KEY>:<slug> --json`; for each, offer to draft the record now through **recording-decisions** ("draft only; do not apply"), noting the decision id so the link happens at apply (Task 5).
5. **Propose epics**: 2–5 epics sized as deliverable slices, each with a one-line brief; on confirmation `reeve epic create --initiative <KEY> --title … --idempotency-key planning-initiative:<KEY>:epic:<slug> --json`, then `reeve epic edit <EPIC> --brief-file … --version 1 --json`.
6. **Discovery mark**: ask whether discovery is complete; if yes `reeve initiative discovery <KEY> --complete --version <n> --json`; never mark it on the user's behalf.
7. **Report**: the keys written, the open decisions with deciders, and the next step ("refine an epic with refining-epic").

The skill produces no spec file (kb/ADR-0005 R4). Scenario `skill-planning-initiative`: prompt "Plan initiative GRA-12 in Reeve; the outcome is faster mentor matching; decisions: queue vs cron, decider dan@example.com; propose two epics", workdir the fixture, expects: the fake log contains `initiative show GRA-12 --json`, `initiative edit GRA-12 --brief-file`, `decision require --on GRA-12`, `--decider dan@example.com`, `--idempotency-key`, two `epic create --initiative GRA-12`, and the transcript contains no `docs/agent/specs` path. Mutation check: with the SKILL.md body emptied, the scenario fails (the fake log lacks `initiative edit`).

```bash
git add skills/planning-initiative test/scenarios.edn
git commit -m "feat(skills): planning-initiative drives discovery, briefs, required decisions and epics in reeve" -m "Task 2 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `refining-epic`

**Files:**
- Create: `skills/refining-epic/SKILL.md`
- Test: `test/scenarios.edn` (scenario `skill-refining-epic`)

Description: "Refine an epic in the Reeve planner: epic-level discovery, required decisions, then stories sized for one person or one agent session with acceptance criteria, and a home for untriaged stories. Use when the user names an epic key or says 'refine this epic', 'break this down', 'write the stories for …'. Only when the planner is present and signed in." Steps: 0 detect (as Task 2); 1 read `epic show`, its initiative's brief, `decision ls --on <EPIC>`, `story ls --epic <EPIC> --json` and `story ls --untriaged --json`; architect `survey` on the touched repositories and knowledge-reader; 2 discovery conversation for the epic (what done looks like, the boundaries, what is unknown); 3 brief via `epic edit --brief-file`; 4 required decisions as in Task 2 (idempotency prefix `refining-epic:<EPIC>:`); 5 **stories**: propose stories each finishable by one person or one agent session (kb/ADR-0002 R1), each with 2–6 acceptance criteria written as observable outcomes; on confirmation `reeve story create --epic <EPIC> --title … --kind story|bug|chore --criterion … (repeated) --idempotency-key refining-epic:<EPIC>:story:<slug> --json`; 6 **placement**: for each untriaged story, propose this epic or another from `epic ls --json` (or "leave untriaged") and on confirmation `reeve story edit <KEY> --epic <EPIC> --version <n> --json`; 7 **readiness check**: `reeve story ls --epic <EPIC> --json` and list each story's `readiness.ready` and reasons as the planner reports them (never computed by the skill); offer the discovery mark via `epic discovery --complete --version <n>` when the user says discovery is done; 8 report. No spec, no plan file. Scenario `skill-refining-epic`: prompt "Refine epic GRA-20 in Reeve into three stories with criteria and place the untriaged ones", expects the fake log to contain `epic show GRA-20`, three `story create --epic GRA-20` each with at least two `--criterion` and an `--idempotency-key`, `story ls --untriaged --json`, at least one `story edit … --epic`, and the transcript shows "ready"/"blocked" wording taken from the fake's readiness field. Mutation check as in Task 2.

```bash
git add skills/refining-epic test/scenarios.edn
git commit -m "feat(skills): refining-epic writes stories with criteria and places untriaged work in reeve" -m "Task 3 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: brainstorming reads the story context first

**Files:**
- Modify: `skills/brainstorming/SKILL.md`
- Test: `test/scenarios.edn` (scenario `skill-brainstorming-with-reeve-context`, and the existing brainstorming scenarios must still pass without the fake on PATH)

Change: a new checklist item **0. Planner context (only when present)** before step 1: run the detector; when `present && signed_in` and the request names a story key (`<PREFIX>-<n>`) or the user says which story this is for, run `reeve story context <KEY> --json`, and treat the bundle (initiative brief, epic brief, required decisions with check results, criteria, blockers, comments) as project context for step 1: every required decision that is not satisfied is listed under the architect's binding decisions as "open required decision #id — title (status)", and the design must either wait for it or make it explicit that it is being decided now (then step 5 drafts the record and Task 5 links it). Also in step 6, the spec's `## Decisions` section gains a line `Required decisions in the planner: #7 Queue or cron (no record)` per open decision. Every other step is unchanged, verbatim; the HARD-GATE is unchanged (kb/ADR-0005 R4). The Process Flow graph gains one node "Read planner context (if present)" before "Explore project context". Scenario: prompt "/lore:brainstorming add a retry policy for story GRA-31", expects the fake log to contain `story context GRA-31 --json`, the transcript to mention "Queue or cron" (the fake bundle's decision) before any design section, and the existing clarifying-question behaviour. Without the fake on PATH, the existing scenario `skill-brainstorming-*` (whatever its name is on origin/main) passes unchanged — run it to prove the guard.

```bash
git add skills/brainstorming test/scenarios.edn
git commit -m "feat(skills): brainstorming reads the reeve story context when the planner is present" -m "Task 4 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md. The hard gate and every existing step are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: recording-decisions triages product records and links them to required decisions

**Files:**
- Modify: `skills/recording-decisions/actions/record.md` (steps 3 and 6), `skills/recording-decisions/SKILL.md` ("Where a change lands": one sentence)
- Test: `test/scenarios.edn` (scenario `skill-adr-links-required-decision`; and the existing `command-adr-new-triages-and-interviews` must still pass)

Step 3 today sends "a decision with no code behind it (a tool, a process)" to "an RFC or meeting notes". Change (kb/ADR-0004 R5): "a decision with no code behind it (a tool, a process, a product choice) is still a record when it is hard to reverse: draft it with the same format; its `scope` names the documents or repositories it governs". Step 6 gains, after apply and only when the detector says the planner is present and signed in: "If this record answers a required decision in the planner (the user named a decision id, or brainstorming/planning passed one), run `reeve decision link <id> --record <qualified id> --repo <repo name as configured in the planner> --path <path of the record file in that repo> --pr <PR url> --household <household dir> --json`; show the planner's answer (`check.kind`, expected `proposed_pr_open` while the PR is open); a refusal (exit 2) is shown and does not undo the apply." Nothing is written into the record (kb/ADR-0004 R3). The interview (step 2) gains one optional question when the planner is present: "Does this answer a required decision in the planner? (id, or none)". Scenario: prompt "/lore:adr Use a queue for mentor matching — this answers required decision 7 in Reeve, decided by dan@example.com, repo portal", expects the fake log to contain `decision link 7 --record` and `--pr`, and the transcript to show "proposed, PR open" from the fake's answer; the existing triage scenario passes with the fake absent.

```bash
git add skills/recording-decisions test/scenarios.edn
git commit -m "feat(skills): recording-decisions drafts product records and links them to reeve required decisions" -m "Task 5 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Router, README, Codex twins, version, docs

**Files:**
- Create: `skills/lore-planning-initiative/SKILL.md`, `skills/lore-refining-epic/SKILL.md`
- Modify: `hooks/load-standards-reminder.sh` (two router rows: "PLANNING AN INITIATIVE in the Reeve planner → planning-initiative; REFINING AN EPIC / writing stories with criteria → refining-epic; both only when `reeve` is present"), `README.md` (two skill rows + a "Reeve planner" paragraph: optional, detected on the path, nothing to configure), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (3.2.0), `test/README.md` (the fake planner section), `docs/agent/backlog.md` (tick the item if present)

Run the whole suite: `node --test scripts/__tests__/*.test.js` and `PATH="$PWD/test/fixtures/reeve-bin:$PATH" REEVE_FAKE_LOG=$(mktemp) bb test/run-tests.clj --filter reeve`, then `bb test/run-tests.clj` without the fake to prove every existing scenario is unchanged.

```bash
git add skills hooks README.md .claude-plugin .codex-plugin package.json test docs
git commit -m "feat(skills): reeve planning skills in the router, readme and codex twins (3.2.0)" -m "Task 6 of docs/superpowers/plans/2026-10-26-reeve-planning-skills.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Environment assumptions pinned

- **Scenario runner**: `claude --print --plugin-dir <checkout>` inherits the shell's `PATH`, so the fake planner is injected by prefixing `PATH`; `REEVE_FAKE_LOG` must be writable; without `bb` (Babashka) the scenarios cannot run — the Node test still can.
- **The real CLI's flags** come from plans A–C in `~/Source/reeve` (`reeve <cmd> --help`); Task 1's reference is corrected against them before the skills quote it.
- **Detection timeout**: `child_process.execFileSync` with `timeout` kills the child with SIGTERM; the detector catches the error and reports `present: false`.

## Self-review notes

- Spec coverage ("Lorekeeper integration"): direction and detection → Task 1; the two skills with the architect survey, research, brief, required decisions with a decider, epics / stories with criteria → Tasks 2–3; brainstorming's first step → Task 4; recording-decisions' link step and triage change → Task 5; the placement proposal against `story ls --untriaged` → Task 3 step 6; `story context` as the bundle → Task 4. Not in this plan: an MCP server (kb/ADR-0005 R5 permits one later).
- Would-it-fail: each scenario asserts fake-log lines that only the skill's commands produce, and the mutation check deletes the skill text; the detector tests include the renamed runner and a hang.
- Spec-conflict: the spec calls the untriaged placement "the triage skill"; this plan places it inside refining-epic and says so (kb/ADR-0005 R4 names only two planning skills).
- Governing decisions: no task weakens the brainstorming gate; no skill produces a spec; every command carries `--json` and an idempotency key; no manifest change.
