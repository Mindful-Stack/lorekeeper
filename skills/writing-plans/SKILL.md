---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---
<!-- Adapted from superpowers (MIT license, Copyright Jesse Vincent 2025) -->

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run on a dedicated feature branch, typically prepared during brainstorming.

**Save plans to:** `docs/agent/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

## Load Knowledge

Before exploring the codebase, dispatch the **knowledge-reader** agent with the task context and hint:
"Prioritise coding standards, framework patterns, and implementation gotchas."
Reference the reader's output when defining task steps — plans should follow loaded standards.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Code In A Plan Is A Draft, Not A Dictation

The previous section demands complete code. This one bounds it, because complete
code has a specific failure mode: **plan code gets less scrutiny than
hand-written code, because it arrives pre-approved.** An implementer reads it as
a decision already made and transcribes it. A defect written here therefore
survives longer than the same defect written anywhere else.

Two real examples, both shipped in plans and caught only by an implementer who
happened to run them:

- A test step that ran `chmod g+w` on a directory the plan itself had created at
  mode `0770`. Group-writable already — a no-op. The test asserted a mode change
  would be noticed and **could never have failed**.
- A step asserting `export { thing } from './mod.js'` would keep the
  re-exporting module's own internal caller working. False in ES modules: a pure
  re-export creates no local binding. The compiler rejected it immediately.

Both were one execution away from being caught, and neither was.

So: **where a step's code makes a behavioural claim, state the property the step
must achieve, alongside the code.** The code is the starting point; the property
is the requirement.

| Instead of only | Also state the property |
|---|---|
| `chmod g+w <dir>` | "the mode must actually change — pick a bit the fixture does not already have" |
| `export { x } from './y.js'` | "`cli.ts`'s own internal caller must still resolve `x`; typecheck proves it" |
| `expect(ctx.identity).toBe('daemon')` | "must exercise real detection — assert the identity the process genuinely has, not one the test supplied" |

A property survives a wrong snippet. A snippet alone does not survive itself.

## Test Steps Name What They Distinguish

For every test step, write one line saying **what failure this test would catch**
— what would have to be broken for it to go red.

A test whose "expected: FAIL" is satisfied by a typo, a missing import, or a
value the test itself just supplied is not a test. Specifying test *code* invites
copying; specifying what the test must *distinguish* invites thought. The
"Run it to make sure it fails" step means fails **for the stated reason**, and
the plan should say what that reason is.

Watch particularly for assertions on values the test passed in one line earlier
— an override spread into a context and then asserted on. These pass whether or
not the code under test exists at all.

## Shared Test Infrastructure Is Its Own Risk

When one task builds a fixture, harness, or factory that later tasks assert
against, say so explicitly and treat it as the highest-stakes task in the plan.
Everything downstream inherits its defects, and a fixture that is healthy *for
the wrong reason* makes every later check pass while the real thing is broken.

For such a task the plan must state:

- **What the fixture must genuinely reproduce** — the properties later tasks
  depend on, named individually.
- **What the environment cannot supply**, and what the fixture does about it.
  A single-uid test process cannot demonstrate a cross-uid property; a fixture
  that fakes one converts an inference into an apparent fact. Require the
  limitation be recorded in the fixture's own data so later tasks can degrade
  honestly rather than believing they proved something.
- **Which properties must not collapse.** If production keeps two things
  distinct, a fixture that merges them silently voids every check that
  discriminates between them — and those checks keep passing on a host where the
  two were wrongly identical.

## Environment Assumptions Are Requirements

Defects that pass locally and fail elsewhere rarely have a test surface. Before
finishing, walk the plan against this list and pin anything it depends on:

- **umask** — file and directory modes created by tests and by the code
- **git config** — `init.defaultBranch`, ambient `user.name`/`user.email`
- **uid 0** — under root, `access(2)` grants nearly everything, so every
  "cannot write / cannot read" assertion silently inverts
- **available uids/gids** — anything asserting two identities differ
- **locale, timezone, filesystem case-sensitivity, path length**
- **service-manager and library semantics** — quote the man page or official
  documentation in the step, and cite it. Do not write a claim about `systemd`,
  SQLite, or git behaviour from memory; this is where confident, wrong
  assertions get embedded and then trusted.

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- …and the property that code must achieve, wherever the code makes a claim
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Would-it-fail scan:** Run "Test Steps Name What They Distinguish" over every
test in the plan, mechanically. Flag any test that asserts a value the test
itself supplied, or performs a state change the fixture has already made (a
`chmod` to a mode it already holds, a write of a value already present). Both
defects in "Code In A Plan Is A Draft" shipped past checks 1-3.

**5. Spec-conflict scan:** Where the plan resolves a spec ambiguity or
contradiction, does the spec still say the old thing? If so, fix the **spec**,
not just the plan — otherwise the next reader reconciles a conflict that no
longer exists, and the two documents drift. One source of truth per fact.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

**When the plan is high-stakes** — it builds shared test infrastructure, crosses a
security boundary, or you wrote systems behaviour into a step — dispatch a fresh
reviewer with `./plan-document-reviewer-prompt.md` as well. Checks 4 and 5 ask you
to find defects in code you just wrote and already believe; a second context is
the only reliable check on that.

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `docs/agent/plans/<filename>.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use executing-plans
- Batch execution with checkpoints for review
