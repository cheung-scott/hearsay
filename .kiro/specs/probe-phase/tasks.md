# probe-phase — Tasks

## Task 0: Cross-spec reconciliation (BLOCKING)
- [ ] 0. Cross-spec reconciliation checkpoint
  - [ ] 0.1 Confirm `ProbeRequest` shape in `src/lib/game/types.ts` (pre-landed commit `29f6a34`) matches joker-system §7.2 byte-for-byte: `{ whisperId: string; targetAiId: 'ai'; roundIdx: number; triggeredAtTurn: number; now: number; mathProb?: number }`. Annotate as aligned.
  - [ ] 0.2 Confirm `ActiveProbe` (10 fields incl. `rawLlmReasoning`), `RevealedProbe` (5 fields), `ProbeFilterSource` (3-member union), and `GameEvent` variants (`ProbeStart`, `ProbeExpired` owned here; `ProbeComplete` consumed from joker-system) are pre-landed in `src/lib/game/types.ts`.
  - [ ] 0.3 Confirm `toClientView.ts` already destructures out `activeProbe` from `Round` (pre-landed strip). Annotate that the probe-phase worktree will populate `ClientRound.currentProbe` from filtered fields.
  - [ ] 0.4 Confirm `fsm.ts` has stub reducer cases for `ProbeStart`, `ProbeComplete`, `ProbeExpired` throwing `InvalidTransitionError` with "pending probe-phase worktree" marker.
  - [ ] 0.5 Check ai-opponent §11 Q6 `heuristicLayer` status. If NOT approved by Scott, annotate that filter lane 1 (`llm-heuristic-layer`) will accept the field when present but will not be exercised until ai-opponent is extended. Do NOT touch `src/lib/ai/`.
  - [ ] 0.6 If ANY mismatch found in 0.1–0.4, escalate to Scott before proceeding. Do NOT silently resolve.

_Requirements: 1.2, 1.3, 1.4, 1.5, 2.2, 9.1, 9.2, 10.1_

---

## Task 1: Probe types (`src/lib/probe/types.ts`)
- [ ] 1. Define probe-phase types in `src/lib/probe/types.ts`
  - [ ] 1.1 Create `src/lib/probe/types.ts`. Import `Persona`, `Rank`, `Session` from `src/lib/game/types.ts`. Import `ActiveProbe`, `RevealedProbe`, `ProbeFilterSource` from `src/lib/game/types.ts` and re-export them for local convenience.
  - [ ] 1.2 Define `ProbeRequest` interface matching the LOCKED shape (requirement 1.2). Add JSDoc noting joker-system §7.2 reconciliation.
  - [ ] 1.3 Define `ProbeResponse` interface: `{ whisperId: string; revealedReasoning: string; decayMs: number; filterSource: ProbeFilterSource }`.
  - [ ] 1.4 Define `ProbeFilter` function type signature: `(rawLlmReasoning: string | undefined, persona: Persona, mathProb: number) => { revealedReasoning: string; filterSource: ProbeFilterSource }`.
  - [ ] 1.5 Export all types. Do NOT re-declare `ActiveProbe`, `RevealedProbe`, or `ProbeFilterSource` — they are pre-landed in `src/lib/game/types.ts`.

_Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
_Files: `src/lib/probe/types.ts`_

---

## Task 2: Reasoning filter (`src/lib/probe/filter.ts`)
- [ ] 2. Implement the 3-lane reasoning filter
  - [ ] 2.1 Create `src/lib/probe/filter.ts`. Implement `probeFilter` matching the `ProbeFilter` type signature.
  - [ ] 2.2 Implement lane 1 (`llm-heuristic-layer`): if input contains a structured `heuristicLayer` field (passed as part of the raw reasoning string or via a future structured input), extract it, apply `NUMERIC_PATTERNS` scrub + `PERSONA_IDENTIFIERS` scrub, return with `filterSource: 'llm-heuristic-layer'`. For v1, this lane activates when the raw reasoning string is prefixed with `[heuristic:]` or similar structured marker — design the extraction to be forward-compatible with ai-opponent Q6.
  - [ ] 2.3 Implement lane 2 (`regex-scrub`): apply `NUMERIC_PATTERNS` (4 regexes per design §5.2), `PERSONA_IDENTIFIERS` (2 regexes), `DEBUG_ARTIFACTS` (4 regexes) in order. Collapse whitespace, truncate to first sentence, hard-cap at 120 chars. If result is empty or < 8 chars, fall through to lane 3.
  - [ ] 2.4 Implement lane 3 (`fallback-static`): `staticFallback(mathProb)` returning one of 3 pre-authored templates per design §5.3. Also handles `rawLlmReasoning === undefined`.
  - [ ] 2.5 Ensure the filter is pure (no I/O, no `Math.random()`, no `Date.now()`), never throws, and always returns non-empty output ≤ 120 chars with no digits or persona literals.

_Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_
_Files: `src/lib/probe/filter.ts`_

---

## Task 3: Filter tests (`src/lib/probe/filter.test.ts`)
- [ ] 3. Write filter invariant tests (I1–I7)
  - [ ] 3.1 Create `src/lib/probe/filter.test.ts`.
  - [ ] 3.2 **I1 — Non-empty output:** For every combination of (persona ∈ 4, mathProb ∈ {0.1, 0.5, 0.9}, llmReasoning ∈ {undefined, "", "The probability is 0.34", "As the Reader persona, I think..."}), assert `revealedReasoning.length >= 1`.
  - [ ] 3.3 **I2 — No probability numbers leak:** Fuzz 50+ prose strings containing digits/decimals/percents. Assert output matches `/^[^0-9%]*$/`. Seed with known-bad LLM outputs.
  - [ ] 3.4 **I3 — No persona identifier leaks:** For every canonical persona literal ∈ {Novice, Reader, Misdirector, Silent}, assert output does not contain the string (case-insensitive). Seed with LLM outputs naming personas directly.
  - [ ] 3.5 **I4 — Length cap:** For every filter-able input, assert `output.length <= 120`.
  - [ ] 3.6 **I5 — Purity:** Assert `probeFilter(x, p, m)` deep-equals `probeFilter(x, p, m)` across two invocations.
  - [ ] 3.7 **I6 — Never throws:** Given malformed inputs (empty string, very long string, unicode-only, control characters), assert filter never throws.
  - [ ] 3.8 **I7 — Missing llmReasoning:** Assert `probeFilter(undefined, persona, mathProb)` returns `filterSource: 'fallback-static'` with non-empty output.

_Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
_Files: `src/lib/probe/filter.test.ts`_

---

## Checkpoint A: `pnpm vitest run src/lib/probe/filter.test.ts`

---

## Task 4: Reveal helpers (`src/lib/probe/reveal.ts`)
- [ ] 4. Implement `buildActiveProbe` and phase helpers
  - [ ] 4.1 Create `src/lib/probe/reveal.ts`. Import `ActiveProbe`, `RevealedProbe` from `src/lib/game/types.ts`, `ProbeRequest`, `ProbeResponse` from `./types`, and `probeFilter` from `./filter`.
  - [ ] 4.2 Implement `buildActiveProbe(request: ProbeRequest, rawLlmReasoning: string | undefined, persona: Persona, now: number): ActiveProbe`. Calls `probeFilter`, sets `decayMs = 4000`, computes `expiresAt = now + decayMs`, populates all 10 fields.
  - [ ] 4.3 Implement `toRevealedProbe(probe: ActiveProbe): RevealedProbe` — projects the 5 client-safe fields, stripping `rawLlmReasoning`, `targetAiId`, `roundIdx`, `triggeredAtTurn`, `startedAt`.
  - [ ] 4.4 Implement `toProbeResponse(probe: ActiveProbe): ProbeResponse` — projects `whisperId`, `revealedReasoning`, `decayMs`, `filterSource`.
  - [ ] 4.5 All helpers are pure functions.

_Requirements: 11.1, 11.2, 1.3, 1.4_
_Files: `src/lib/probe/reveal.ts`_

---

## Task 5: Reveal tests (`src/lib/probe/reveal.test.ts`)
- [ ] 5. Write reveal helper + FSM guard tests (I8, I9, I11, I12)
  - [ ] 5.1 Create `src/lib/probe/reveal.test.ts`.
  - [ ] 5.2 Test `buildActiveProbe` produces all 10 fields, `expiresAt === startedAt + 4000`, `rawLlmReasoning` is preserved server-side.
  - [ ] 5.3 Test `toRevealedProbe` strips `rawLlmReasoning` and produces exactly 5 fields.
  - [ ] 5.4 **I8 — Entry guard tests:** Construct sessions in invalid states (claim_phase, no stage_whisper effect, last claim by player, empty claimHistory) and assert the guard logic rejects each. (Guard logic tested here as pure validation; route-level 400s tested in Task 9.)
  - [ ] 5.5 **I9 — Concurrent probe rejected:** With `round.activeProbe` already set, assert a second probe attempt is rejected.
  - [ ] 5.6 **I11 — ProbeComplete and ProbeExpired both clear activeProbe:** Assert both events clear `round.activeProbe` and that `round.status` is never changed.
  - [ ] 5.7 **I12 — One probe per Stage Whisper:** Two Stage Whispers in jokers → first fires → second rejected while first active → complete first → second can fire.

_Requirements: 4.1, 4.6, 5.1, 5.2, 7.1, 7.2, 7.3, 7.4_
_Files: `src/lib/probe/reveal.test.ts`_

---

## Checkpoint B: `pnpm vitest run src/lib/probe/`

---

## Task 6: FSM reducer additions (`src/lib/game/fsm.ts`)
- [ ] 6. Replace stub reducer cases with probe-phase logic
  - [ ] 6.1 In `src/lib/game/fsm.ts`, replace the `ProbeStart` stub: set `round.activeProbe = event.probe`. Do NOT mutate `round.status`. Validate `session.status === 'round_active'` and `round.status === 'response_phase'`.
  - [ ] 6.2 Replace the `ProbeComplete` stub (consumed from joker-system): validate `round.activeProbe !== undefined` and `round.activeProbe.whisperId === event.whisperId`, then clear `round.activeProbe = undefined`. Throw `InvalidTransitionError` on mismatch or missing probe.
  - [ ] 6.3 Replace the `ProbeExpired` stub: same validation and clearing logic as `ProbeComplete`.
  - [ ] 6.4 Add guard: while `round.activeProbe !== undefined`, reject any `ClaimAccepted` / `ChallengeCalled` events with `InvalidTransitionError` containing `'probe_active'`.

_Requirements: 7.1, 7.2, 7.3, 7.4, 4.3, 4.6, 2.1_
_Files: `src/lib/game/fsm.ts`_

---

## Task 7: Extend `toClientView.ts` — populate `ClientRound.currentProbe`
- [ ] 7. Populate `ClientRound.currentProbe` from filtered `Round.activeProbe`
  - [ ] 7.1 In `src/lib/game/toClientView.ts`, update `toClientRound` to: when `round.activeProbe` is defined, project it into `ClientRound.currentProbe` using the 5 `RevealedProbe` fields (`whisperId`, `revealedReasoning`, `filterSource`, `decayMs`, `expiresAt`). Strip `rawLlmReasoning` and all other server-only fields.
  - [ ] 7.2 Verify that `JSON.stringify()` of the resulting `ClientSession` never contains `rawLlmReasoning` content. (Covered by test in Task 9.)

_Requirements: 6.1, 6.2, 2.3_
_Files: `src/lib/game/toClientView.ts`_

---

## Checkpoint C: `pnpm vitest run`

---

## Task 8: API route (`src/app/api/game/probe/route.ts`)
- [ ] 8. Implement `POST /api/game/probe` route
  - [ ] 8.1 Create `src/app/api/game/probe/route.ts`. Accept JSON body `{ sessionId: string; action?: 'complete' }`.
  - [ ] 8.2 On initiation (no `action` or `action !== 'complete'`): load session from store, validate all 6 entry conditions (requirement 4.1), read last AI claim's `llmReasoning`, call `buildActiveProbe`, fire `ProbeStart` event on FSM, return updated `ClientSession` with `currentProbe`.
  - [ ] 8.3 On completion (`action: 'complete'`): validate `round.activeProbe !== undefined`, fire `ProbeComplete` event, return updated `ClientSession` without `currentProbe`.
  - [ ] 8.4 Return appropriate HTTP error codes per requirement 8.2: `400` for invalid phase / no joker / no claim, `409` for active probe, `404` for unknown whisperId.

_Requirements: 8.1, 8.2, 8.3, 4.1, 4.2, 4.4_
_Files: `src/app/api/game/probe/route.ts`_

---

## Task 9: API route tests + toClientView I10 (`src/app/api/game/probe/route.test.ts`)
- [ ] 9. Write route integration tests including I10
  - [ ] 9.1 Create `src/app/api/game/probe/route.test.ts`.
  - [ ] 9.2 Test successful probe initiation: mock session in `response_phase` with `stage_whisper` active and AI claim with `llmReasoning`. Assert response contains `currentProbe` with non-empty `revealedReasoning`.
  - [ ] 9.3 Test probe completion: mock session with `activeProbe` set. Assert response has no `currentProbe`.
  - [ ] 9.4 Test all error paths: no joker (400), wrong phase (400), no AI claim (400), concurrent probe (409).
  - [ ] 9.5 **I10 — toClientView strips rawLlmReasoning:** Given a session with `round.activeProbe.rawLlmReasoning = "SECRET MATH: 0.42 from Silent persona"`, assert `toClientView(session).rounds[0].currentProbe` has no `rawLlmReasoning` property and `JSON.stringify()` of the result does not contain "SECRET", "0.42", or "Silent".

_Requirements: 6.1, 6.2, 8.1, 8.2, 8.3, 4.1, 5.1_
_Files: `src/app/api/game/probe/route.test.ts`_

---

## Checkpoint D: `pnpm vitest run`

---

## Task 10: Full integration pass
- [ ] 10. Full-suite vitest + integration verification
  - [ ] 10.1 Run `pnpm vitest run` — all existing tests + all new probe-phase tests must pass.
  - [ ] 10.2 Verify no regressions in `src/lib/game/fsm.test.ts` (existing game-engine tests should still pass with the new reducer cases).
  - [ ] 10.3 Verify `toClientView.test.ts` existing tests still pass (the `activeProbe` destructure was pre-landed; new projection logic is additive).

_Requirements: all_
_Files: all probe-phase files + `src/lib/game/fsm.ts`, `src/lib/game/toClientView.ts`_

---

## Task 11 (optional): Type-level assertions (`src/lib/probe/types.test.ts`)
- [ ]* 11. Type-level exhaustiveness tests
  - [ ]* 11.1 Create `src/lib/probe/types.test.ts`. Assert `ProbeFilterSource` exhaustive switch coverage. Assert `ProbeRequest` shape matches the LOCKED interface via a compile-time type equality check.
  - [ ]* 11.2 Assert `ActiveProbe` has exactly 10 fields and `RevealedProbe` has exactly 5 fields via `keyof` type tests.

_Requirements: 1.2, 1.3, 1.4, 1.5_
_Files: `src/lib/probe/types.test.ts`_
