# Requirements Document

## Introduction

Hybrid AI opponent for a voice-bluffing card game: deterministic math baseline + LLM orchestrator (Gemini 2.5 Flash) + deterministic fallback. Produces claim-judgment decisions (accept / challenge) and own-play decisions (which cards + what to claim + in-character dialogue). All requirements derived from the authoritative `design.md`.

## Glossary

- **Brain**: The orchestrator module (`src/lib/ai/brain.ts`) that stitches math → LLM → fallback into a single async call
- **Math_Layer**: The deterministic math module (`src/lib/ai/math.ts`) computing card-availability probabilities and persona-weighted fallback decisions
- **LLM_Layer**: The Gemini 2.5 Flash wrapper (`src/lib/ai/llm.ts`) handling prompt assembly, SDK call, timeout, schema validation, and retry-once
- **Fallback**: Deterministic decision path triggered when the LLM times out, returns invalid JSON, or encounters a network error
- **DecisionContext**: Input type for judging a player's claim — includes persona, hand, round history, voice metadata, and the claim being judged
- **OwnPlayContext**: Input type for the AI making its own claim — includes persona, hand, round history, and game state
- **AiDecision**: Output of `aiDecideOnClaim` — action (accept/challenge), innerThought, source telemetry, latency, mathProb
- **AiPlay**: Output of `aiDecideOwnPlay` — cards to play, claim details, truthState, dialogue, source telemetry, latency
- **Persona**: One of Novice, Reader, Misdirector, Silent — each with distinct weight/threshold/bluff-bias tables
- **Math_Probability**: The output of `claimMathProbability` — P(claim is a lie) ∈ [0.15, 0.95] based on card availability
- **Voice_Lie_Score**: The `VoiceMeta.lieScore` value (0..1) from the STT heuristic, consumed as grounding input
- **PERSONA_WEIGHTS**: Per-persona `{ math, voice }` weight pair that sums to 1.0, used in fallback judgment
- **PERSONA_THRESHOLDS**: Per-persona challenge threshold — combined score ≥ threshold triggers challenge in fallback
- **PERSONA_BLUFF_BIAS**: Per-persona probability of bluffing when honest play is available, used in fallback own-play

## Requirements

### Requirement 1: AI Type Definitions

**User Story:** As a developer, I want well-defined TypeScript types for all AI decision inputs and outputs, so that the brain, math, and LLM layers have a stable contract.

#### Acceptance Criteria

1. THE Types module SHALL export `DecisionContext`, `OwnPlayContext`, `AiDecision`, `AiPlay`, `LLMJudgmentOutput`, and `LLMOwnPlayOutput` interfaces matching the shapes defined in design.md §2. *(design §2)*
2. THE Types module SHALL export error classes `LLMTimeoutError`, `LLMInvalidJSONError`, and `LLMNetworkError`, each extending `Error`. *(design §2)*
3. THE Types module SHALL import `Persona`, `Rank`, `Card`, `PublicClaim`, `VoiceMeta`, and `JokerType` from `src/lib/game/types.ts` — never duplicate them. *(design §2)*

### Requirement 2: Persona Weight Tables

**User Story:** As a game designer, I want locked persona weight/threshold/bluff-bias tables, so that each persona has distinct decision-making characteristics.

#### Acceptance Criteria

1. THE Math_Layer SHALL export `PERSONA_WEIGHTS` where for every Persona, `weights.math + weights.voice === 1.0`. *(design §3.1, invariant 1)*
2. THE Math_Layer SHALL export `PERSONA_THRESHOLDS` with values: Novice 0.70, Reader 0.55, Misdirector 0.50, Silent 0.45. *(design §3.1)*
3. THE Math_Layer SHALL export `PERSONA_BLUFF_BIAS` with values: Novice 0.10, Reader 0.35, Misdirector 0.60, Silent 0.55. *(design §3.1)*

### Requirement 3: Math Probability Computation

**User Story:** As the AI brain, I want a deterministic math probability for any claim, so that LLM decisions are grounded in card-counting reality.

#### Acceptance Criteria

1. WHEN `claimMathProbability` is called with any valid DecisionContext, THE Math_Layer SHALL return a value in the range [0.15, 0.95]. *(design §3.2, invariant 2)*
2. WHEN `remainingSupport < claim.count`, THE Math_Layer SHALL return 0.95 (impossible claim given public info). *(design §3.2, invariant 3)*
3. WHEN `remainingSupport >= 3 * claim.count`, THE Math_Layer SHALL return 0.15 (abundant support). *(design §3.2, invariant 3)*
4. WHEN `remainingSupport` is in the mid-range, THE Math_Layer SHALL return a value between 0.15 and 0.70 that decreases monotonically as `remainingSupport` increases. *(design §3.2, invariant 3)*
5. WHEN computing `alreadyClaimed`, THE Math_Layer SHALL include the current claim being judged from `roundHistory`, because the caller appends the claim to `roundHistory` BEFORE calling the judge. *(design §3.2, §6, invariant 12)*

### Requirement 4: Fallback Judgment

**User Story:** As the AI brain, I want a deterministic fallback for judging claims, so that the AI always responds even when the LLM fails.

#### Acceptance Criteria

1. WHEN `aiDecideOnClaimFallback` is called, THE Math_Layer SHALL compute a combined score as `PERSONA_WEIGHTS[persona].math * mathProb + PERSONA_WEIGHTS[persona].voice * voiceLie` and return `'challenge'` if the combined score ≥ `PERSONA_THRESHOLDS[persona]`, otherwise `'accept'`. *(design §3.3)*
2. WHEN `ctx.claim.voiceMeta` is undefined, THE Math_Layer SHALL use a neutral lie-score of 0.5. *(design §3.3, invariant 10)*
3. WHEN `aiDecideOnClaimFallback` is called with identical inputs, THE Math_Layer SHALL return the same action every time (deterministic). *(invariant 4)*
4. THE Math_Layer SHALL include a persona-flavoured `innerThought` string in the fallback response so the autopsy UI is never blank. *(design §3.3)*

### Requirement 5: Fallback Own-Play

**User Story:** As the AI brain, I want a deterministic fallback for making claims, so that the AI always plays even when the LLM fails.

#### Acceptance Criteria

1. WHEN the AI hand contains target-rank cards AND `Math.random() > PERSONA_BLUFF_BIAS[persona]`, THE Math_Layer SHALL play honestly (1–2 target cards, truthState `'honest'`). *(design §3.4 branch 1)*
2. WHEN the AI hand contains at least one target and at least one non-target AND the bluff-bias coin-flip favours bluffing, THE Math_Layer SHALL play a mixed lie (one target + one non-target, claim 2, truthState `'lying'`). *(design §3.4 branch 2)*
3. WHEN the AI hand contains only target-rank cards, THE Math_Layer SHALL play honestly regardless of bluff-bias. *(design §3.4 branch 3)*
4. WHEN the AI hand contains zero target-rank cards, THE Math_Layer SHALL play a forced lie (1 non-target card, claim 1, truthState `'lying'`). *(design §3.4 branch 4)*
5. THE Math_Layer SHALL accept an optional `rng` parameter (default `Math.random`) so tests can inject a deterministic stub. *(design §3.4 purity exception)*
6. WHEN `aiDecideOwnPlayFallback` returns, THE Math_Layer SHALL ensure `cardsToPlay` is a subset of `ctx.myHand` (by identity), `cardsToPlay.length === claim.count`, and `truthState === 'honest'` if and only if every card in `cardsToPlay` has `rank === targetRank`. *(invariant 6)*
7. THE Math_Layer SHALL include a persona-flavoured `claimText` string from per-persona dialogue template banks. *(design §3.4)*

### Requirement 6: LLM Prompt Assembly

**User Story:** As the LLM layer, I want pure prompt-assembly functions, so that prompts are deterministic and testable without calling the LLM.

#### Acceptance Criteria

1. THE LLM_Layer SHALL export `buildJudgmentPrompt(ctx, mathProb)` that interpolates all placeholders from the steering-file judgment template (persona, personaDescription, targetRank, handDescription, pileSize, publicClaims, playerHandSize, opponentJokers, strikesMe, strikesPlayer, mathProb, voiceLie). *(design §4.3)*
2. THE LLM_Layer SHALL export `buildOwnPlayPrompt(ctx)` that interpolates all placeholders from the steering-file own-play template. *(design §4.3)*
3. THE LLM_Layer SHALL import `PERSONA_DESCRIPTIONS` from `src/lib/ai/constants.ts` for the `{{personaDescription}}` placeholder. *(design §4.3)*

### Requirement 7: LLM SDK Call and Timeout

**User Story:** As the LLM layer, I want a Gemini Flash call with a 2-second AbortController timeout, so that the AI never blocks gameplay.

#### Acceptance Criteria

1. WHEN `callLLMJudgment` or `callLLMOwnPlay` is called, THE LLM_Layer SHALL use Gemini 2.5 Flash (via `@google/genai`) with `responseMimeType: 'application/json'` and the appropriate `responseJsonSchema` passed inside `config`. *(design §4.1, §4.2)*
2. WHEN the LLM call exceeds 2000ms, THE LLM_Layer SHALL abort via `AbortController` and throw `LLMTimeoutError`. *(design §4.4, invariant 7)*
3. THE LLM_Layer SHALL use temperature 0.7 for judgment calls and 0.8 for own-play calls. *(steering file)*
4. WHEN `GEMINI_API_KEY` is not set, THE LLM_Layer SHALL throw synchronously at module load time. *(design §4.1, invariant 13)*

### Requirement 8: LLM Response Validation

**User Story:** As the LLM layer, I want strict validation of LLM JSON responses, so that invalid outputs never reach the brain.

#### Acceptance Criteria

1. WHEN the LLM returns unparseable JSON, THE LLM_Layer SHALL throw `LLMInvalidJSONError` with reason `'parse-failed'`. *(design §4.4)*
2. WHEN the LLM own-play response contains a `cardsToPlay` ID not present in `ctx.myHand`, THE LLM_Layer SHALL throw `LLMInvalidJSONError` with reason `'card-id-not-in-hand'`. *(design §4.4, invariant 9)*
3. WHEN the LLM own-play response has `cardsToPlay.length !== claimCount`, THE LLM_Layer SHALL throw `LLMInvalidJSONError` with reason `'count-mismatch'`. *(design §4.4)*
4. WHEN the LLM own-play response has a `truthState` that disagrees with the actual card ranks vs `targetRank`, THE LLM_Layer SHALL throw `LLMInvalidJSONError` with reason `'truth-state-mismatch'`. *(design §4.4)*

### Requirement 9: LLM Retry-Once

**User Story:** As the LLM layer, I want a single retry on schema-invalid responses (not on timeout), so that transient LLM formatting errors don't trigger fallback unnecessarily.

#### Acceptance Criteria

1. WHEN the LLM returns an `LLMInvalidJSONError`, THE LLM_Layer SHALL retry exactly once with the same prompt and the SAME `AbortSignal` instance (by reference — not a freshly created signal). *(design §4.5, invariant 8)*
2. WHEN the LLM times out, THE LLM_Layer SHALL NOT retry — timeout triggers immediate fallback. *(design §4.5)*
3. WHEN both the initial call and the retry produce invalid JSON, THE LLM_Layer SHALL propagate the error to the Brain for fallback. *(design §4.5)*
4. THE LLM_Layer SHALL invoke the Gemini SDK's `generateContent` method at MOST twice per `callLLMJudgment` / `callLLMOwnPlay` call (one original invocation plus at most one retry). A test SHALL assert exactly this invocation count on the invalid-JSON-twice path. *(design §4.5, invariant 8)*

### Requirement 10: Brain Orchestration — Judging

**User Story:** As the game server, I want a single async call to get the AI's judgment on a player's claim, so that the caller doesn't manage the math→LLM→fallback pipeline.

#### Acceptance Criteria

1. WHEN `aiDecideOnClaim` is called, THE Brain SHALL first compute `claimMathProbability(ctx)`, then attempt the LLM call with a 2000ms AbortController timeout, and return the LLM result on success. *(design §5)*
2. WHEN the LLM call throws any error, THE Brain SHALL invoke `aiDecideOnClaimFallback(ctx)` and return the fallback result. *(design §5)*
3. THE Brain SHALL set `AiDecision.source` to `'llm'` on LLM success, `'fallback-timeout'` on `LLMTimeoutError`, `'fallback-invalid-json'` on `LLMInvalidJSONError`, and `'fallback-network-error'` on all other errors. *(design §5, invariant 7, invariant 8)*
4. THE Brain SHALL set `AiDecision.llmReasoning` only on the LLM path; on fallback paths it SHALL remain `undefined`. *(design §5)*
5. THE Brain SHALL measure and report `latencyMs` via `performance.now()` on every path. *(design §5, invariant 11)*

### Requirement 11: Brain Orchestration — Own Play

**User Story:** As the game server, I want a single async call to get the AI's own-play decision, so that the caller doesn't manage the pipeline.

#### Acceptance Criteria

1. WHEN `aiDecideOwnPlay` is called, THE Brain SHALL attempt the LLM call with a 2000ms AbortController timeout and return the LLM result on success. *(design §5)*
2. WHEN the LLM call throws any error, THE Brain SHALL invoke `aiDecideOwnPlayFallback(ctx)` and return the fallback result. *(design §5)*
3. THE Brain SHALL populate `AiPlay.source` and `AiPlay.latencyMs` following the same rules as `AiDecision`. *(design §5)*

### Requirement 12: Constants Module

**User Story:** As a developer, I want persona descriptions and fallback dialogue templates centralized in one module, so that prompt assembly and fallback functions share a single source of truth.

#### Acceptance Criteria

1. THE Constants module SHALL export `PERSONA_DESCRIPTIONS` matching the four persona description strings from `llm-prompt-conventions.md`. *(design §7, steering file)*
2. THE Constants module SHALL export fallback dialogue template banks (`templateHonest`, `templateLie`) with at least 4 variants per persona for TTS variety on fallback. *(design §3.4)*
3. A test SHALL read `.kiro/steering/llm-prompt-conventions.md` at test time, extract each `PERSONA_DESCRIPTIONS[persona]` string literal from that file, and assert it equals the corresponding runtime value in `src/lib/ai/constants.ts`. Drift between the steering file and the constants module MUST fail CI. *(design §7, steering file — drift guard)*

---

## Invariant Cross-Reference

Every design.md §8 invariant maps to at least one numbered acceptance criterion:

| Invariant | Description | Requirement(s) |
| --- | --- | --- |
| 1 — Persona weights sum to 1.0 | `PERSONA_WEIGHTS[p].math + PERSONA_WEIGHTS[p].voice === 1.0` for every Persona | 2.1 |
| 2 — Math probability bounds | `claimMathProbability` output ∈ [0.15, 0.95] | 3.1 |
| 3 — Math probability key cases | impossible → 0.95, abundant → 0.15, mid-range monotonic | 3.2, 3.3, 3.4 |
| 4 — Fallback judgment deterministic | Same DecisionContext → same action every call | 4.3 |
| 5 — Fallback own-play branches | All 4 branches reachable via constructed hands | 5.1, 5.2, 5.3, 5.4 |
| 6 — Fallback own-play card conservation | `cardsToPlay ⊆ myHand`, `length === count`, truthState consistent | 5.6 |
| 7 — LLM timeout triggers fallback | Mocked never-resolving SDK → resolves within 2100ms, source `'fallback-timeout'` | 7.2, 10.3 |
| 8 — LLM invalid JSON retries once then falls back | Two unparseable responses → source `'fallback-invalid-json'`, exactly 2 SDK invocations | 9.1, 9.3, 9.4, 10.3 |
| 9 — LLM own-play validates card IDs | Card ID not in hand → invalid JSON → retry → fallback | 8.2 |
| 10 — Voice lie-score absence = neutral 0.5 | Fallback identical whether `voiceMeta` is undefined or `{ lieScore: 0.5 }` | 4.2 |
| 11 — Brain latency reported correctly | `latencyMs > 0` always; LLM path < 2000ms; timeout path ≥ 2000 and < 2100ms | 10.5 |
| 12 — `alreadyClaimed` includes current claim | `roundHistory` includes just-made claim; math probability correct | 3.5 |
| 13 — Gemini API key missing throws at module load | Importing `llm.ts` with `GEMINI_API_KEY` unset throws synchronously | 7.4 |
