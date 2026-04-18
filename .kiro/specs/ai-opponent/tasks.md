# Implementation Plan: AI Opponent (Hybrid Math + LLM + Fallback)

## Overview

Hybrid AI opponent: deterministic math baseline + Gemini 2.5 Flash LLM orchestrator + deterministic fallback. Implementation follows dependency order: types → constants → math/fallback → LLM wrapper → brain orchestrator → integration tests. Tests-first where feasible; all LLM tests mock the Gemini SDK.

## Tasks

- [x] 1. Define AI type definitions
  - [x] 1.1 Create all AI types and error classes in `src/lib/ai/types.ts`
    - Import `Persona`, `Rank`, `Card`, `PublicClaim`, `VoiceMeta`, `JokerType` from `src/lib/game/types.ts`
    - Define `DecisionContext` interface (persona, targetRank, myHand, myJokers, opponentJokers, opponentHandSize, roundHistory, claim with optional voiceMeta, pileSize, strikesMe, strikesPlayer)
    - Define `OwnPlayContext` interface (persona, targetRank, myHand, myJokers, opponentJokers, opponentHandSize, roundHistory, pileSize, strikesMe, strikesPlayer)
    - Define `AiDecision` interface (action, innerThought, llmReasoning?, source, latencyMs, mathProb)
    - Define `AiPlay` interface (cardsToPlay, claim, truthState, claimText, innerThought, llmReasoning?, source, latencyMs)
    - Define `LLMJudgmentOutput` interface (action, innerThought)
    - Define `LLMOwnPlayOutput` interface (cardsToPlay string[], claimCount, claimText, truthState, innerThought)
    - Define `LLMTimeoutError`, `LLMInvalidJSONError` (with `raw` and `reason` fields), `LLMNetworkError` (with `cause` field) — all extending `Error`
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Create constants module
  - [x] 2.1 Create `src/lib/ai/constants.ts`
    - Export `PERSONA_DESCRIPTIONS: Record<Persona, string>` matching the four strings from `llm-prompt-conventions.md`
    - Export `templateHonest(persona, count, rank): string` and `templateLie(persona, count, rank): string` — fallback dialogue banks with ≥4 variants per persona for TTS variety
    - Export `buildFallbackThought(persona, action, mathProb, voiceLie): string` — four small persona-flavoured templates
    - _Requirements: 12.1, 12.2_

- [ ] 3. Implement deterministic math layer and fallback functions
  - [ ] 3.1 Create `src/lib/ai/math.ts` — persona tables and `claimMathProbability`
    - Export `PERSONA_WEIGHTS: Record<Persona, { math: number; voice: number }>` — Novice {0.7, 0.3}, Reader {0.4, 0.6}, Misdirector {0.5, 0.5}, Silent {0.3, 0.7}
    - Export `PERSONA_THRESHOLDS: Record<Persona, number>` — Novice 0.70, Reader 0.55, Misdirector 0.50, Silent 0.45
    - Export `PERSONA_BLUFF_BIAS: Record<Persona, number>` — Novice 0.10, Reader 0.35, Misdirector 0.60, Silent 0.55
    - Implement `claimMathProbability(ctx: DecisionContext): number` — compute `outsideOwnHand = 5 - countInHand(myHand, target)`, `alreadyClaimed` from roundHistory (INCLUDES current claim), `remainingSupport = outsideOwnHand - alreadyClaimed`; return 0.95 if impossible, 0.15 if abundant, else clamped mid-range
    - Implement private `countInHand(hand, rank): number`
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 3.2 Implement fallback functions in `src/lib/ai/math.ts`
    - Implement `aiDecideOnClaimFallback(ctx: DecisionContext)` — compute combined score from persona weights × (mathProb, voiceLie), compare to threshold, return action + innerThought + mathProb. Use neutral 0.5 when voiceMeta is undefined.
    - Implement `aiDecideOwnPlayFallback(ctx: OwnPlayContext, rng = Math.random)` — four branches: (1) targets available + rng > bluffBias → honest, (2) mixed hand + bluff → lying 2 cards, (3) all-target → honest, (4) zero-target → forced lie 1 card. Accept injectable `rng` for test determinism.
    - Import `templateHonest`, `templateLie`, `buildFallbackThought` from `constants.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [ ] 4. Write math layer tests
  - [ ] 4.1 Write tests in `src/lib/ai/math.test.ts`
    - **Invariant 1:** For every Persona, `PERSONA_WEIGHTS[p].math + PERSONA_WEIGHTS[p].voice === 1.0`
    - **Invariant 2:** `claimMathProbability` output ∈ [0.15, 0.95] for various (myHand, claim.count, claimedRank, roundHistory) combos
    - **Invariant 3 — impossible:** `remainingSupport < claim.count` → returns 0.95
    - **Invariant 3 — abundant:** `remainingSupport >= 3 * claim.count` → returns 0.15
    - **Invariant 3 — mid-range monotonic:** increasing `remainingSupport` → decreasing probability (between 0.15 and 0.70)
    - **Invariant 4:** `aiDecideOnClaimFallback` with identical inputs → identical action (deterministic)
    - **Invariant 5:** All 4 branches of `aiDecideOwnPlayFallback` reachable via constructed hands + injected rng: (a) targets + rng > bias → honest, (b) mixed + rng ≤ bias → lying 2, (c) all-target → honest, (d) zero-target → lying 1
    - **Invariant 6:** `cardsToPlay ⊆ ctx.myHand` (by identity), `cardsToPlay.length === claim.count`, `truthState === 'honest'` iff every card rank === targetRank
    - **Invariant 10:** Fallback behaves identically whether `ctx.claim.voiceMeta` is `undefined` or `{ lieScore: 0.5, ... }`
    - **Invariant 12:** Given `roundHistory` containing the just-made claim, `claimMathProbability` returns the correct probability (regression test for §6 caller contract — `alreadyClaimed` includes current claim)
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.6_

- [ ] 5. Checkpoint: run all tests
  - Run `pnpm vitest run src/lib/ai/math.test.ts` and verify all pass

- [ ] 6. Implement LLM layer
  - [ ] 6.1 Create `src/lib/ai/llm.ts` — SDK setup, schemas, prompt assembly
    - Import `{ GoogleGenAI, Type }` from `@google/genai` — the unified Google Gen AI SDK per steering file. **NOT** the legacy `@google/generative-ai` package (different npm package, different class name `GoogleGenerativeAI`, different schema field `responseSchema`).
    - Initialize `const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })` — throw synchronously at module load if the env var is unset
    - Define `JUDGMENT_SCHEMA` and `OWN_PLAY_SCHEMA` using `Type.OBJECT` / `Type.STRING` / `Type.ARRAY` / `Type.INTEGER`. These objects will be passed via `config.responseJsonSchema` (NOT `responseSchema`).
    - Implement `buildJudgmentPrompt(ctx, mathProb): string` — interpolate all steering-file placeholders
    - Implement `buildOwnPlayPrompt(ctx): string` — interpolate all steering-file placeholders
    - Import `PERSONA_DESCRIPTIONS` from `constants.ts`
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.3, 7.4_

  - [ ] 6.2 Implement LLM call functions in `src/lib/ai/llm.ts`
    - Implement `callLLMJudgment(ctx, mathProb, signal): Promise<LLMJudgmentOutput>` — call `ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseJsonSchema: JUDGMENT_SCHEMA, temperature: 0.7, abortSignal: signal } })`, parse `response.text` as JSON, validate against schema, retry once on `LLMInvalidJSONError` **passing the SAME `signal` instance**, throw typed errors
    - Implement `callLLMOwnPlay(ctx, signal): Promise<LLMOwnPlayOutput>` — same call-shape with `OWN_PLAY_SCHEMA`, temperature 0.8, plus validation (card IDs in hand, count match, truthState consistency)
    - Translate SDK abort-rejection into `LLMTimeoutError`; wrap other network/SDK errors in `LLMNetworkError`
    - The SDK's `generateContent` MUST be invoked at MOST twice per public call (one original + at most one retry)
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

- [ ] 7. Write LLM layer tests
  - [ ] 7.1 Write tests in `src/lib/ai/llm.test.ts` (all tests mock `@google/genai` via `vi.mock`; no real API calls)
    - **Invariant 7:** Mock SDK `generateContent` that never resolves + AbortSignal that fires at 2000 ms → `callLLMJudgment` throws `LLMTimeoutError`
    - **Invariant 8 (count):** Mock SDK returns unparseable string twice → spy-assert `generateContent` was called EXACTLY 2 times, then `callLLMJudgment` throws `LLMInvalidJSONError` *(requirement 9.4)*
    - **Invariant 8 (same-signal on retry):** Spy on `generateContent`; mock first call returns invalid JSON, second call returns valid JSON. Assert `call[0].args.config.abortSignal === call[1].args.config.abortSignal` (reference equality). An implementation creating a fresh `AbortController` on retry fails this test. *(requirement 9.1, design §4.5)*
    - **Invariant 9:** Mock SDK returns valid JSON with `cardsToPlay` containing an ID NOT in `ctx.myHand` → throws `LLMInvalidJSONError` with reason `'card-id-not-in-hand'`
    - **Invariant 13:** Import `llm.ts` with `GEMINI_API_KEY` unset (via `vi.stubEnv`) → throws synchronously
    - Test `buildJudgmentPrompt` contains all expected interpolated values (persona, mathProb, voiceLie, hand description, etc.)
    - Test `buildOwnPlayPrompt` contains all expected interpolated values
    - Test retry-once success: first call invalid JSON, second call valid → returns valid result (1 retry)
    - Test timeout does NOT retry — throws `LLMTimeoutError` immediately, exactly 1 SDK invocation recorded
    - Test own-play additional validators: count-mismatch → `LLMInvalidJSONError` reason `'count-mismatch'`; truth-state-mismatch → reason `'truth-state-mismatch'`
    - _Requirements: 6.1, 6.2, 7.2, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

  - [ ] 7.2 Write drift-check test in `src/lib/ai/constants.test.ts`
    - Read `.kiro/steering/llm-prompt-conventions.md` at test time via `fs.readFileSync` (resolved relative to `process.cwd()` — Vitest runs from repo root)
    - Regex-extract each persona's description string from the steering file's `const PERSONA_DESCRIPTIONS: Record<Persona, string>` block (match single-line string literals per persona key)
    - Assert each extracted string equals (`===`) the corresponding entry in the runtime `PERSONA_DESCRIPTIONS` imported from `constants.ts`, for all four personas
    - Test fails with a clear message if the steering file and runtime constants drift — CI must block on this
    - _Requirements: 12.1, 12.3_

- [ ] 8. Checkpoint: run all tests
  - Run `pnpm vitest run src/lib/ai/` and verify all pass

- [ ] 9. Implement brain orchestrator
  - [ ] 9.1 Create `src/lib/ai/brain.ts` — `aiDecideOnClaim` and `aiDecideOwnPlay`
    - Implement `aiDecideOnClaim(ctx: DecisionContext): Promise<AiDecision>` — compute mathProb, create AbortController with 2000ms timeout, try LLM call, catch → fallback, always report latencyMs and source
    - Implement `aiDecideOwnPlay(ctx: OwnPlayContext): Promise<AiPlay>` — mirror pattern: try LLM call, catch → fallback
    - Implement `errorToSource(err): AiDecision['source']` — map error types to source strings
    - Set `llmReasoning` only on LLM path; `undefined` on fallback
    - Always `clearTimeout` in both success and error paths
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3_

- [ ] 10. Write brain orchestrator tests
  - [ ] 10.1 Write tests in `src/lib/ai/brain.test.ts` (mock LLM layer, real math layer)
    - **LLM success path (brain):** End-to-end — mock LLM success → `aiDecideOnClaim` returns `source: 'llm'` with correct action and `llmReasoning` populated. (Does NOT re-test invariant 3 — that's math-layer territory, covered in `math.test.ts`.)
    - **Invariant 7 (via brain):** Mock LLM that never resolves → `aiDecideOnClaim` resolves within 2100ms with `source: 'fallback-timeout'`
    - **Invariant 8 (via brain):** Mock LLM returns invalid JSON twice → `aiDecideOnClaim` returns `source: 'fallback-invalid-json'`
    - **Invariant 11:** `AiDecision.latencyMs > 0` on every path; LLM-path `latencyMs < 2000`; fallback-timeout-path `latencyMs >= 2000 && < 2100`
    - **Invariant 12 (via brain):** Construct DecisionContext where `roundHistory` includes the just-made claim → `aiDecideOnClaim` returns correct mathProb reflecting the included claim
    - Test `aiDecideOwnPlay` LLM success path returns `source: 'llm'` with valid AiPlay
    - Test `aiDecideOwnPlay` fallback path returns valid AiPlay with `source` matching error type
    - Test `llmReasoning` is `undefined` on all fallback paths
    - Test `errorToSource` maps `LLMTimeoutError` → `'fallback-timeout'`, `LLMInvalidJSONError` → `'fallback-invalid-json'`, other → `'fallback-network-error'`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3_

- [ ] 11. Checkpoint: run all tests
  - Run `pnpm vitest run src/lib/ai/` and verify all pass

- [ ] 12. Final review and invariant coverage audit
  - [ ] 12.1 Verify all 13 invariants + requirement 12.3 drift-check are covered across test files
    - Invariant 1 (Persona weights sum to 1.0): `math.test.ts`
    - Invariant 2 (Math probability bounds): `math.test.ts`
    - Invariant 3 (Math probability key cases): `math.test.ts` *(math-layer only; `brain.test.ts`'s LLM-success bullet is not an invariant-3 test)*
    - Invariant 4 (Fallback judgment deterministic): `math.test.ts`
    - Invariant 5 (Fallback own-play branches): `math.test.ts`
    - Invariant 6 (Fallback own-play card conservation): `math.test.ts`
    - Invariant 7 (LLM timeout triggers fallback): `llm.test.ts`, `brain.test.ts`
    - Invariant 8 (LLM invalid JSON retries once then falls back, exactly 2 SDK invocations, same AbortSignal on retry): `llm.test.ts`, `brain.test.ts`
    - Invariant 9 (LLM own-play validates card IDs): `llm.test.ts`
    - Invariant 10 (Voice lie-score absence = neutral 0.5): `math.test.ts`
    - Invariant 11 (Brain latency reported correctly): `brain.test.ts`
    - Invariant 12 (`alreadyClaimed` includes current claim): `math.test.ts`, `brain.test.ts`
    - Invariant 13 (Gemini API key missing throws at module load): `llm.test.ts`
    - Requirement 12.3 (PERSONA_DESCRIPTIONS steering-file drift check): `constants.test.ts`
  - [ ] 12.2 Run full test suite
    - Run `pnpm vitest run src/lib/ai/` — all tests green

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All LLM tests mock the Gemini SDK — no real API calls in CI
- The `aiDecideOwnPlayFallback` uses `Math.random()` — the only impure site in the brain. Tests inject a deterministic `rng` stub via the optional second parameter.
- File layout per design.md §7:
  - `src/lib/ai/types.ts` — all type definitions
  - `src/lib/ai/constants.ts` — PERSONA_DESCRIPTIONS, fallback dialogue template banks
  - `src/lib/ai/math.ts` — persona tables, claimMathProbability, fallback functions
  - `src/lib/ai/llm.ts` — Gemini SDK wrapper, prompt assembly, schema validation, retry-once
  - `src/lib/ai/brain.ts` — aiDecideOnClaim, aiDecideOwnPlay orchestration
  - `src/lib/ai/math.test.ts` — invariants 1, 2, 3, 4, 5, 6, 10, 12
  - `src/lib/ai/llm.test.ts` — invariants 7, 8, 9, 13
  - `src/lib/ai/brain.test.ts` — invariants 7, 8, 11, 12 (+ LLM success path — not a §8 invariant)
  - `src/lib/ai/constants.test.ts` — requirement 12.3 (PERSONA_DESCRIPTIONS steering-file drift check)
