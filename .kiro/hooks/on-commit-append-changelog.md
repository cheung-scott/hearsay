---
name: on-commit-append-changelog
description: After each spec-driven task completes, append a line to CHANGELOG.md linking the task ID to its commit SHA and a one-line summary. Preserves the spec → task → commit audit trail that makes the 9-spec narrative inspectable.
trigger: PostTaskExecution
pattern: .kiro/specs/**/tasks.md
enabled: true
---

# on-commit-append-changelog

## Intent

Kiro's spec-driven model gives us `requirements.md → design.md → tasks.md`. The missing fourth link is **task → shipped commit**. Without an explicit trace, a reader inspecting `.kiro/specs/game-engine/tasks.md` sees `- [x] 4.1 SetupComplete transition` but has no way to find *which commit* delivered it, or to diff the actual implementation against the task's stated requirements.

This hook closes that gap by appending a line to `CHANGELOG.md` on every Post Task Execution event, giving every completed task a permanent, linkable record.

## Output format

Each entry:

```
- [<spec>/<task-id>] <task title> — <commit-sha-short> (<YYYY-MM-DD>)
  Requirements: <req-ids from tasks.md>
```

Example after task 4.1 completes:

```
- [game-engine/4.1] SetupComplete transition — a1b2c3d (2026-04-18)
  Requirements: 1.1, 1.2, 1.3, 15.1, 15.2, 20.1, 20.2
```

## Agent instructions

When this hook fires:

1. Read the task ID and title from the task block that just flipped to `[x]`.
2. Extract the `_Requirements: ...` line from the same block.
3. Resolve `HEAD` commit SHA (short form) and today's date.
4. Append the formatted line to `CHANGELOG.md` under a `## Unreleased` section, creating the section if missing.
5. Do not stage or commit `CHANGELOG.md` separately — the user's next commit picks it up.

## Why this matters for judging

The hackathon's Implementation pillar rewards *visible* use of Kiro's spec-driven model. A populated `CHANGELOG.md` with spec-task-commit backlinks turns an abstract methodology claim into an auditable artifact a judge can grep in ten seconds.

## Non-goals

- Does not rewrite or compact older entries.
- Does not handle optional-task skips — those stay silently unchecked in tasks.md with no CHANGELOG line.
- Does not gate commits (not a `Pre Tool Use` hook).

## Provenance

Planned in architecture §9 (Kiro artifacts catalog) and project memory `project_elevenhacks_hearsay.md`. Authored Day 3 of the build window (2026-04-18).
