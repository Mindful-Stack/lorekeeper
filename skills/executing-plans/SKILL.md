---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---
<!-- Adapted from superpowers (MIT license, Copyright Jesse Vincent 2025) -->

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

Before starting, create a feature branch from main. Never start implementation on main/master without explicit user consent.

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
   - If the task involves a different domain/tech than previously loaded, dispatch **knowledge-reader** with implementation hints
   - After completing the task, dispatch **plan-compliance-reviewer** to verify implementation matches the plan
3. Run verifications as specified
4. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified:
1. Run the full test suite to ensure nothing is broken
2. Summarise what was implemented
3. Present the result to the developer

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **writing-plans** - Creates the plan this skill executes

**Used during execution:**
- **knowledge-reader** agent - Loads relevant knowledge per task
- **plan-compliance-reviewer** agent - Verifies each task matches the plan
- **verification-before-completion** - Use before claiming completion
