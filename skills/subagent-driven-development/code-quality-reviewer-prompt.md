# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable)

**Only dispatch after spec compliance review passes.**

**Model and effort:** mid-tier floor, `high` effort. This is the stage where
defects are actually caught — see SKILL.md → Reasoning Effort. Never leave either
unset; an omitted model silently inherits the controller's own.

**Fill in the risk block yourself.** A review finds what it is pointed at, and a
generic "review this diff" reliably misses defects that look correct in
isolation. See SKILL.md → Constructing Reviewer Prompts.

```
Task tool (review):
  model: [mid-tier or above]
  effort: high
  prompt: |
  Perform a code quality review using the in-repo review skill.

  WHAT_WAS_IMPLEMENTED: [path to .agent/sdd/task-N-report.md]
  PLAN_OR_REQUIREMENTS: [path to .agent/sdd/task-N-brief.md]
  DIFF: [path to .agent/sdd/review-N.diff]
  BASE_SHA: [the BASE recorded before dispatching the implementer — never HEAD~1]
  HEAD_SHA: [current commit]
  DESCRIPTION: [task summary]

  ## Specific Risk In This Task

  [Name it concretely. What does this task build that later work depends on, and
   what would going wrong look like? e.g. "Task 1 builds the fixture every later
   task asserts against — look for a fixture that is healthy for the wrong
   reason, and for tests that assert values the test itself supplied."
   If this task carries no distinct risk, say so rather than leaving it blank.]

  ## Binding Constraints

  [Copy verbatim from the plan's global constraints — exact values, formats, and
   stated relationships this project demands. Not process rules; those are in the
   review skill already.]

  ## Also Check

  - Does each file have one clear responsibility with a well-defined interface?
  - Are units decomposed so they can be understood and tested independently?
  - Is the implementation following the file structure from the plan?
  - Did this change create files that are already large, or significantly grow
    existing ones?

  ## Scope

  Review the change in the diff above, not the pre-existing codebase around it.

  Scope bounds what you look at; it does not bound what you may conclude. If
  something inside this change is a defect, report it at the severity you judge
  it to be. Nothing here caps a severity or exempts a finding.

  Verification means reading the code. Do not re-run the full test suite the
  implementer already ran on these commits — run a test yourself only to check a
  specific claim that a test passes or fails for a stated reason.
```

**Code reviewer returns:** Strengths, Issues (Critical/Important/Minor), Assessment

**Any Critical finding gets adversarially verified before you act on it** — see
SKILL.md → Adversarial Verification.
