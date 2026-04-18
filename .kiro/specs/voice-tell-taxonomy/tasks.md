# Implementation Plan: Voice Tell Taxonomy

## Overview

Voice presets + STT lie-score heuristic for Hearsay. Implementation follows dependency order: types → VOICE_PRESETS constant → PERSONA_VOICE_IDS constant → computeLieScore + FILLER_REGEX → invariant tests → property-based tests. All production code is pure (no I/O). Testing via Vitest with co-located test files.

## Tasks

- [x] 1. Extend type definitions for voice layer
  - [x] 1.1 Add/verify voice types in `src/lib/game/types.ts`
    - Verify `Persona`, `TruthState`, `VoiceSettings`, `VoiceMeta` exports exist (already stubbed by game-engine spec — shipped in commit `0ef7d5e`)
    - `LieScoreInput` interface may live EITHER in `src/lib/game/types.ts` OR co-located with `computeLieScore` in `src/lib/voice/heuristic.ts`. Current shipped location: `heuristic.ts` (valid per Req 1.5 + design §3 code block). No movement required unless another consumer module emerges.
    - Ensure `VoiceMeta.lieScore` is typed as `number`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
    - _Files: `src/lib/game/types.ts` (+ optionally `src/lib/voice/heuristic.ts` for LieScoreInput co-location)_

- [x] 2. Implement VOICE_PRESETS constant
  - [x] 2.1 Create/verify `VOICE_PRESETS` in `src/lib/voice/presets.ts`
    - Export `VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>>` with all 8 locked values from design §2
    - Include `// DO NOT reorder` comment block on Misdirector entry
    - Include `// TUNED:` comment convention note for Day-2 adjustments
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 5.1, 6.1, 6.2_
    - _Files: `src/lib/voice/presets.ts`_

  - [x] 2.2 Create/verify `PERSONA_VOICE_IDS` in `src/lib/voice/presets.ts`
    - Export `PERSONA_VOICE_IDS: Record<Persona, string>` mapping each Persona to an ElevenLabs voice ID.
    - **Shipped ahead of plan (Day 2 voice-design block):** All 4 personas cast from the ElevenLabs preset library — Novice → Rachel (21m00Tcm4TlvDq8ikWAM), Reader → George (JBFqnCBsd6RMkjVDRZzb, carried over from `/api/ping-voice`), Misdirector → Arnold (VR6AewLTigWG4xSOukaG), Silent → Adam (pNInz6obpgDQGcFmaJgB). Casting rationale inline as comments in `presets.ts`. Subject to A/B replacement during Day-2 tuning (annotate any swap with `// TUNED: YYYY-MM-DD <reason>`).
    - _Requirements: 15.1, 15.2_
    - _Files: `src/lib/voice/presets.ts`_

- [x] 3. Write VOICE_PRESETS invariant tests
  - [x] 3.1 Write shape completeness tests in `src/lib/voice/presets.test.ts`
    - **Invariant 1:** All 4 personas present, each with `honest` and `lying` keys
    - **Invariant 1:** All 4 VoiceSettings fields present on every object
    - **Invariant 1:** stability/similarity_boost/style ∈ [0,1], speed ∈ [0.8, 1.2]
    - _Requirements: 2.1, 2.2, 2.3_
    - _Files: `src/lib/voice/presets.test.ts`_

  - [x] 3.2 Write Misdirector inversion tests in `src/lib/voice/presets.test.ts`
    - **Invariant 2 (LOCKED):** `Misdirector.honest.stability < Misdirector.lying.stability`
    - **Invariant 2 (LOCKED):** `Misdirector.honest.style > Misdirector.lying.style`
    - _Requirements: 3.1, 3.2_
    - _Files: `src/lib/voice/presets.test.ts`_

  - [x] 3.3 Write Novice audibility tests in `src/lib/voice/presets.test.ts`
    - **Invariant 3:** `Novice.lying.stability <= 0.25`
    - **Invariant 3:** `Novice.lying.style >= 0.55`
    - _Requirements: 4.1, 4.2_
    - _Files: `src/lib/voice/presets.test.ts`_

  - [x] 3.4 Write Silent subtlety + Reader ordering tests in `src/lib/voice/presets.test.ts`
    - **Invariant 4:** `|Silent.honest.stability − Silent.lying.stability| < 0.25`
    - **Invariant 5:** Novice delta > Reader delta > Silent delta
    - _Requirements: 5.1, 6.1, 6.2_
    - _Files: `src/lib/voice/presets.test.ts`_

  - [x] 3.5 Write preset reference stability test in `src/lib/voice/presets.test.ts`
    - **Invariant 6:** Two dynamic imports return the same object reference
    - _Requirements: 7.1_
    - _Files: `src/lib/voice/presets.test.ts`_

  - [x] 3.6 Write PERSONA_VOICE_IDS shape test in `src/lib/voice/presets.test.ts`
    - Every Persona has a defined, non-empty string entry
    - _Requirements: 15.1, 15.2_
    - _Files: `src/lib/voice/presets.test.ts`_

- [x] 4. Checkpoint — run presets tests
  - Run `pnpm vitest run src/lib/voice/presets.test.ts` and verify all pass. Ask user if questions arise.

- [x] 5. Implement computeLieScore and FILLER_REGEX
  - [x] 5.1 Create/verify `FILLER_REGEX` in `src/lib/voice/heuristic.ts`
    - Export `FILLER_REGEX = /\b(uh|um|er|like|so|you know|kinda|i mean)\b/gi`
    - Word-boundary anchored, global, case-insensitive
    - _Requirements: 13.1, 13.2, 13.3_
    - _Files: `src/lib/voice/heuristic.ts`_

  - [x] 5.2 Create/verify `computeLieScore` in `src/lib/voice/heuristic.ts`
    - Export `LieScoreInput` interface (or import from types if moved there)
    - Compute clamped components: `lat = min(latencyMs/2000, 1)`, `fil = min(fillerCount/3, 1)`, `pau = min(pauseCount/3, 1)`, `rat = (wpm < 120 || wpm > 220) ? 1 : 0`
    - Return the weighted sum using the 40/30/20/10 allocation. **Preferred form: `(4*lat + 3*fil + 2*pau + 1*rat) / 10`** — integer weights divided once at the end, avoids IEEE-754 drift where `0.4+0.3+0.2+0.1 === 0.9999999999999999`. The literal `0.40*lat + 0.30*fil + 0.20*pau + 0.10*rat` form is mathematically equivalent but WILL fail Req 9.1 (saturation → exactly 1.0). Either form is valid per Req 16.2.
    - Add inline comment explaining the FP-avoidance choice for future readers
    - Pure function — no I/O, no state
    - _Requirements: 8.1, 8.2, 9.1, 9.2, 10.1, 11.1, 11.2, 12.1, 16.1, 16.2_
    - _Files: `src/lib/voice/heuristic.ts`_

- [x] 6. Write computeLieScore invariant tests
  - [x] 6.1 Write range + boundary tests in `src/lib/voice/heuristic.test.ts`
    - **Invariant 7:** Zero input → 0.0; saturated input → 1.0; above-saturation still clamps to 1.0; no NaN for finite input
    - **Invariant 8:** Exact boundary values verified
    - _Requirements: 8.1, 8.2, 9.1, 9.2_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [x] 6.2 Write weight allocation tests in `src/lib/voice/heuristic.test.ts`
    - **Invariant 9:** Latency alone at saturation → 0.40; fillers alone → 0.30; pauses alone → 0.20; rate alone → 0.10
    - _Requirements: 10.1, 16.1_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [x] 6.3 Write rate binary behavior tests in `src/lib/voice/heuristic.test.ts`
    - **Invariant 10:** Rate in [120, 220] → contributes 0; rate outside → contributes exactly 0.10
    - Test boundary values: 119, 120, 220, 221
    - _Requirements: 11.1, 11.2_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [x] 6.4 Write monotonicity tests in `src/lib/voice/heuristic.test.ts`
    - **Invariant 11:** Increasing latencyMs / fillerCount / pauseCount (within clamp range) never decreases output
    - _Requirements: 12.1_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [x] 6.5 Write FILLER_REGEX tests in `src/lib/voice/heuristic.test.ts`
    - **Invariant 12:** Matches all 8 filler words/phrases; case-insensitive; does NOT match substrings (umbrella, soft, likewise, other, sokind)
    - Test multi-filler transcript counting
    - _Requirements: 13.1, 13.2, 13.3_
    - _Files: `src/lib/voice/heuristic.test.ts`_

- [x] 7. Checkpoint — run heuristic tests
  - Run `pnpm vitest run src/lib/voice/heuristic.test.ts` and verify all pass. Ask user if questions arise.

- [ ]* 8. Property-based tests for computeLieScore (ALL OPTIONAL — revisit if a bug surfaces)
  - The 55 example-based invariant tests in §3 + §6 cover the full failure surface of this pure 4-input function. Property-based tests would add random-input coverage but are not required for Day-2 scope. Re-prioritise this group only if a runtime bug suggests the example tests missed a case.
  - **Prerequisite:** `pnpm add -D fast-check` — property-based testing library not currently in devDeps. Add before attempting any of 8.1–8.4.
  - [ ]* 8.1 PBT: lie score range property in `src/lib/voice/heuristic.test.ts`
    - **Property 2:** For any random non-negative finite LieScoreInput, output ∈ [0, 1] and not NaN
    - Minimum 100 iterations via fast-check
    - Tag: `Feature: voice-tell-taxonomy, Property 2: Lie score range`
    - _Requirements: 8.1, 8.2_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [ ]* 8.2 PBT: monotonicity property in `src/lib/voice/heuristic.test.ts`
    - **Property 4:** For any random base LieScoreInput + random increase to one field, score does not decrease
    - Minimum 100 iterations via fast-check
    - Tag: `Feature: voice-tell-taxonomy, Property 4: Monotonicity`
    - _Requirements: 12.1_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [ ]* 8.3 PBT: weight-allocation property in `src/lib/voice/heuristic.test.ts`
    - **Property 5:** For any random LieScoreInput, output equals the weighted sum within floating-point tolerance. Compute the reference via the integer-weight form `(4*lat + 3*fil + 2*pau + 1*rat) / 10` and assert `toBeCloseTo(expected, 10)` — do NOT use strict equality against the literal `0.40*lat + ...` form (see Req 16.2 on IEEE-754 drift).
    - Minimum 100 iterations via fast-check
    - Tag: `Feature: voice-tell-taxonomy, Property 5: Weight allocation`
    - _Requirements: 16.1, 16.2_
    - _Files: `src/lib/voice/heuristic.test.ts`_

  - [ ]* 8.4 PBT: rate binary behavior property in `src/lib/voice/heuristic.test.ts`
    - **Property 3:** For any random speechRateWpm, rate component is exactly 0 when in [120,220] and exactly 0.10 when outside
    - Minimum 100 iterations via fast-check
    - Tag: `Feature: voice-tell-taxonomy, Property 3: Rate binary behavior`
    - _Requirements: 11.1, 11.2_
    - _Files: `src/lib/voice/heuristic.test.ts`_

- [x] 9. Checkpoint — run all voice tests
  - Run `pnpm vitest run src/lib/voice/` and verify all pass (presets + heuristic, including PBTs). Ask user if questions arise.

- [ ] 10. Document neutral-score caller contract
  - [ ] 10.1 Add code comment in claim route for skip-voice lieScore = 0.5
    - **Invariant 13 (caller contract):** When player skips voice, API route sets `voiceMeta.lieScore = 0.5`
    - Add `// INVARIANT 13: skip-voice → lieScore = 0.5 (voice-tell-taxonomy spec §3.3)` comment at the assignment site
    - This is NOT a unit test — it's a code-review checkpoint per design §4 invariant 13
    - _Requirements: 14.1_
    - _Files: `src/app/api/game/claim/route.ts` (when it exists)_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All 13 design invariants are covered:
  - Invariant 1 (Shape completeness): Tasks 3.1
  - Invariant 2 (Misdirector inversion — LOCKED): Task 3.2
  - Invariant 3 (Novice audibility): Task 3.3
  - Invariant 4 (Silent subtlety): Task 3.4
  - Invariant 5 (Reader ordering): Task 3.4
  - Invariant 6 (Preset reference stability): Task 3.5
  - Invariant 7 (computeLieScore range): Tasks 6.1, 8.1
  - Invariant 8 (Boundary values): Task 6.1
  - Invariant 9 (Latency dominance): Task 6.2
  - Invariant 10 (Rate binary behavior): Tasks 6.3, 8.4
  - Invariant 11 (Monotonicity): Tasks 6.4, 8.2
  - Invariant 12 (Filler regex correctness): Task 6.5
  - Invariant 13 (Skip-voice default — caller contract): Task 10.1
