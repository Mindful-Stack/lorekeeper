---
name: delivering-stories
description: Use when work starts on a Reeve planner story named by its key ("start GRA-596"), when a pull request naming a story key becomes ready for review or merges, or when a story's acceptance criteria were checked ("GRA-596 passed QA"). Moves the story at that moment. Not for planning or refining work.
---

# Delivering stories

Announce: "Using the delivering-stories skill." Open the final report with the same sentence, since
a non-interactive session shows only that.

A story moves when its work happens, by its owner or the agent working for them (kb/ADR-0028).
`<plugin-root>` is the plugin's root directory, two levels above this skill's base directory (the
path shown when the skill loads); write it out as an absolute path. Read
`<plugin-root>/references/reeve-cli.md`, *Detection and the binary* and *Moving stories*, first:
they hold the contract, and this skill does not repeat it.

1. Run `node <plugin-root>/scripts/reeve-detect.js`. Unless it prints `"present":true` and
   `"signed_in":true`, stop and say nothing about the planner.
2. Find the moment and the stories:
   - work starts: the key the user named;
   - a pull request is ready for review or merged: the keys in its description's `## Stories`.
     Use the description the user gave, else `gh pr view <n> --json body,isDraft,state,baseRefName`.
     A draft is not ready; merged means `MERGED` into the default branch. A missing or empty
     section: ask which stories it completes and write the section (`gh pr edit`) once confirmed;
   - criteria checked: the key the user named, and whether the check passed.
3. For each story, `reeve story context <KEY> --json`, then the move *Moving stories* gives for that
   moment, with its rules on stories further along, someone else's story, refusals and conflicts.
4. Report one line per story: its key and from → to, or why it did not move, and for a refusal the
   reasons in the reference's wording and the override a person could run.
