---
name: pattern-identifier
description: >
  THE skill for answering questions about team standards, patterns, and conventions.
  Uses the knowledge-question-answerer agent to check docs BEFORE codebase exploration.

  TRIGGERS ON:
  - Style questions: "Do we use X?", "How do we format Y?"
  - Pattern questions: "What's our pattern for X?", "How do we handle Y?"
  - Implementation questions: "How would I add X?", "Where should Y go?"
  - Validation questions: "Is this right?", "Should I do it this way?"
  - Architecture questions: "Where does X belong?", "How do services communicate?"
  - Any question about conventions, standards, or "how we do things"

  BIAS: When uncertain whether to trigger, trigger anyway.
  Better to check the knowledge base and find nothing than miss documented standards.
---

# Pattern Identifier

Answer questions about team standards by consulting the knowledge base first,
then the codebase if needed.

## When This Skill Activates

- "How do we handle X?"
- "What's our pattern for Y?"
- "Do we use X or Y?"
- "How would I add a new X?"
- "Where should this logic go?"
- "Is this the right approach?"
- "Should I do it this way?"
- "What's the convention for X?"
- "How do we format X?"
- "Where does X belong?"
- Any question about code style, patterns, architecture, error handling, testing, naming, or implementation approach

**When in doubt, trigger this skill.** Checking the knowledge base is cheap; missing documented standards is costly.

## Principle: Docs First, Codebase Second

The knowledge base is the **source of truth**. The codebase shows how things are done in practice, which may or may not align with standards.

1. Always check docs first
2. Only consult codebase if docs are incomplete
3. When codebase differs from docs, prefer docs
4. Surface gaps so they can be documented

## Step 1: Launch knowledge-question-answerer

Use the Task tool to launch the knowledge-question-answerer agent:

```
Task tool:
  subagent_type: knowledge-question-answerer
  prompt: "Search the knowledge base to answer: [user's question]"
```

Wait for the agent to return its structured response.

## Step 2: Evaluate Confidence

Based on the agent's response, take one of three paths:

### Path A: fully-documented

The knowledge base has a clear answer.

**Action:** Present the answer to the user with sources. Done.

```markdown
**[Answer from knowledge-question-answerer]**

Sources:
- `file:lines` - description
```

### Path B: partially-documented

The knowledge base has related content but not a complete answer.

**Action:** Continue to Step 3 for codebase examples.

### Path C: undocumented

The knowledge base has nothing relevant.

**Action:** Continue to Step 3 for codebase examples.

## Step 3: Codebase Fallback

Use the Task tool to launch an Explore agent:

```
Task tool:
  subagent_type: Explore
  prompt: |
    Find examples in the codebase of: [topic from question]

    Search for:
    - How this pattern is currently implemented
    - How many occurrences exist
    - File locations and line numbers
    - Any variations in approach

    Return a summary of what you find, not full file contents.
  thoroughness: medium
```

## Step 4: Combine and Respond

Format the response based on what was found:

### If partially-documented:

```markdown
**From documentation:**
[Knowledge-question-answerer answer]

**From codebase:**
[Explore findings - "Found X examples of Y pattern in Z locations"]
[Note any differences between docs and practice]

**Recommendation:**
[Combined guidance - prefer documented standard, note if codebase deviates]

Sources:
- `knowledge/file:lines` - description
- `src/file:lines` - codebase example
```

### If undocumented:

```markdown
**From documentation:**
No documented standard found for this.

**From codebase:**
[Explore findings - "Found X examples of Y pattern in Z locations"]

**Recommendation:**
Based on current codebase practice: [guidance derived from examples]

Note: This pattern is not yet documented in the knowledge base.
```

## Step 5: Suggest Update (if gap found)

If the confidence was `partially-documented` or `undocumented`, add an update suggestion:

```markdown
---

**Knowledge gap detected**

[Description of what's missing from the knowledge base]

Based on codebase evidence:
- Found [N] examples of [pattern] in [locations]
- [Brief summary of the pattern observed]

Suggested documentation:
> [1-2 sentence summary of what should be added]

Use `/lore:update [suggested description]` to propose adding this to the knowledge base.

If the developer has context about the gap that could be captured as tribal knowledge
(a gotcha, edge case, or non-obvious behaviour), also suggest:
`/lore:learn [brief description of the learning]`
```

## Example Interaction

**User:** "How do we handle one-line if statements?"

**Step 1:** Launch knowledge-question-answerer with question

**Step 2:** Agent returns `partially-documented` - found code-style.md mentions if statements but not one-line specifically

**Step 3:** Launch Explore agent to find codebase examples

**Step 4:** Combine response:

```markdown
**From documentation:**
`languages/csharp/code-style.md:45-52` covers if statement formatting but doesn't
explicitly address one-line cases.

**From codebase:**
Found 47 one-line if statements across the codebase:
- Most use braces even for single statements (38/47)
- Some use expression-bodied style (9/47)
- Located primarily in `src/Domain/` and `src/Application/`

**Recommendation:**
Based on the predominant pattern, use braces even for one-line if statements.
This aligns with the general code clarity principles in `general/code-clarity-principles.md`.

---

**Knowledge gap detected**

No explicit guidance on one-line if statement formatting.

Based on codebase evidence:
- Found 47 examples, 81% use braces for single statements
- Pattern is consistent across Domain and Application layers

Suggested documentation:
> One-line if statements should use braces for consistency and readability.

Use `/lore:update Add one-line if statement guidance to csharp code-style` to propose adding this.
```
