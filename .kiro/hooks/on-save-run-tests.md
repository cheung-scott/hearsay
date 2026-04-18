---
name: on-save-run-tests
description: Re-run Vitest against the saved file's co-located test suite on every save under src/lib/. Catches regressions in the pure-logic layer (deck/claims/fsm/voice) within the same save-to-feedback loop used throughout Days 1-3.
trigger: FileSave
pattern: src/lib/**/*.{ts,tsx}
enabled: true
---

# on-save-run-tests

## Intent

Days 1-3 of Hearsay's build are dominated by pure-logic modules — `deck.ts`, `claims.ts`, `fsm.ts`, `presets.ts`, `heuristic.ts`, `stt.ts`. Each has a co-located `*.test.ts` with invariant-level assertions (169 tests at time of writing, spanning all 16 game-engine + 13 voice-tell-taxonomy design invariants). The cost of *not* running tests on save is that a refactor silently breaks a downstream invariant — e.g. a card-conservation bug in the FSM reducer that only surfaces three tasks later.

This hook closes that loop by re-running the affected test file the instant the source file changes, so every save either stays green or immediately tells us what broke.

## Agent instructions

When this hook fires, Kiro's agent should:

1. Identify the saved file's path relative to `src/lib/`.
2. Resolve the co-located test file (e.g. `src/lib/game/fsm.ts` → `src/lib/game/fsm.test.ts`).
3. If the co-located test file exists, run `pnpm vitest run <test-path>`.
4. If it does not exist, skip silently — some files (types.ts, index barrels) have no tests by design.
5. On failure, surface the failing assertion inline. Do not auto-fix — the author should see the regression.

## Non-goals

- Does not run the full suite. Use `pnpm vitest` manually before commits for that.
- Does not run integration or E2E tests (there are none at this layer by design).
- Does not trigger on `src/app/**` saves — route files are exercised via manual browser smoke tests, not unit tests.

## Provenance

Planned in architecture §9 (Kiro artifacts catalog) and project memory `project_elevenhacks_hearsay.md`. Authored Day 3 of the build window (2026-04-18).
