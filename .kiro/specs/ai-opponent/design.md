---
inclusion: fileMatch
fileMatchPattern: "src/lib/ai/**/*.ts|src/lib/ai/brain.ts|src/lib/ai/llm.ts|src/lib/ai/math.ts"
---

# ai-opponent — Design

## Provenance

Authored by Claude Code as a TypeScript-level codification of `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md` §7 (AI opponent reasoning), iter-5 locked 2026-04-16, with prompt contracts sourced from `.kiro/steering/llm-prompt-conventions.md`. Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via seeded prompt. Tasks will be executed by Claude Code with Sonnet 4.6 implementation subagents + Opus 4.7 review subagent per spec.

Hybrid AI opponent: deterministic math baseline + LLM orchestrator (Gemini 2.5 Flash) + deterministic fallback. Produces both claim-judgment decisions (accept / challenge) and own-play decisions (which cards + what to claim + in-character dialogue).

**Scope of this spec:**
- Deterministic math layer (`claimMathProbability`, persona weight/threshold/bluff-bias tables)
- LLM orchestrator (prompt assembly, Gemini Flash call, 2 s timeout via AbortController, JSON schema validation, retry-once)
- Deterministic fallback functions (`aiDecideOnClaimFallback`, `aiDecideOwnPlayFallback`)
- Brain entry points (`aiDecideOnClaim`, `aiDecideOwnPlay`) that stitch math → LLM → fallback
- Result types consumed by the `game-engine` FSM's caller layer (API route)

**NOT in this spec** (handled elsewhere):
- Voice tells, TTS settings, STT heuristic (`voice-tell-taxonomy` spec — consumed as `VoiceMeta.lieScore` input)
- Claim parsing, deck generation (`deck-and-claims` spec — consumed)
- FSM state transitions (`game-engine` spec — this spec returns decisions; the caller feeds them in as `ClaimMade` / `ClaimAccepted` / `ChallengeCalled` events)
- Persona voice bindings + persona-specific tuning overrides (`ai-personas` spec, Day 5 — may override constants defined here)
- Stage Whisper probe LLM flow (`probe-phase` spec — separate prompt template, separate brain entry point)
- Joker effects that read AI reasoning (`joker-system` spec — e.g. Earful reveals `llmReasoning`, Cold Read adjusts weights)

## Canonical source

See [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) §7 (AI opponent reasoning), plus `.kiro/steering/llm-prompt-conventions.md` (prompt contracts, Gemini model selection, temperature choices, PERSONA_DESCRIPTIONS). This design.md is the authoritative TypeScript-level codification; the architecture file is the authoritative prose rationale. If they diverge, flag it — do not silently resolve.

**Day-4 slice (ROADMAP):** Gemini Flash orchestrator + Reader persona end-to-end + 2 s timeout → deterministic fallback. The remaining three personas (Novice, Misdirector, Silent) land via the `ai-personas` spec on Day 5; however the fallback math tables for all four personas are required **now** because the fallback must work for any persona when triggered.

---

## 1. Decision pipeline

```
                    ┌────────────────────────────────────┐
                    │ aiDecideOnClaim(ctx: DecisionContext)│
                    │ aiDecideOwnPlay(ctx: OwnPlayContext) │
                    └────────────────┬───────────────────┘
                                     │
                     ┌───────────────┴────────────────┐
                     ▼                                ▼
           Step 1: DETERMINISTIC MATH        Step 1: persona bluff-bias
           claimMathProbability(ctx)         PERSONA_BLUFF_BIAS[persona]
           < 1 ms, ALWAYS runs               < 1 ms, ALWAYS runs
                     │                                │
                     ▼                                ▼
           Step 2: LLM ORCHESTRATOR          Step 2: LLM ORCHESTRATOR
           callLLMJudgment(ctx, mathProb)    callLLMOwnPlay(ctx, bluffBias)
           Gemini 2.5 Flash                  Gemini 2.5 Flash
           2 s AbortController timeout       2 s AbortController timeout
           JSON-mode via responseJsonSchema  JSON-mode via responseJsonSchema
                     │                                │
                     ├─ success ──► return JSON       ├─ success ──► return JSON
                     │                                │
                     ▼ (timeout / invalid JSON /      ▼ (same)
                        network error — retry once
                        then fall through)
           Step 3: DETERMINISTIC FALLBACK    Step 3: DETERMINISTIC FALLBACK
           aiDecideOnClaimFallback(ctx)      aiDecideOwnPlayFallback(ctx)
           combines math + voice lie-score   persona bluff-bias vs hand
           via persona weights/thresholds    composition
```

**Hard timing contract:**
- Step 1 + Step 3 together must complete in < 5 ms on the Vercel runtime (measured with `performance.now`).
- Step 2 is aborted at 2000 ms wall-time; the whole brain call must therefore resolve in ≤ 2000 ms + fallback cost (< 5 ms) ≈ 2005 ms worst case.
- Retry-once only fires on JSON-schema-invalid responses, not on timeout. Timeout triggers fallback immediately.

---

## 2. Types (authoritative)

All AI-opponent types live in `src/lib/ai/types.ts`. Game-engine types (`Persona`, `Rank`, `Card`, `Claim`, `PublicClaim`, `VoiceMeta`, `JokerType`) are re-used from `src/lib/game/types.ts` — NOT duplicated.

```ts
import type {
  Persona, Rank, Card, PublicClaim, VoiceMeta, JokerType
} from '../game/types';

/** Input to aiDecideOnClaim — the AI is judging a claim just made by the player. */
export interface DecisionContext {
  persona: Persona;
  targetRank: Rank;
  myHand: Card[];                  // AI's own hand (hidden from player)
  myJokers: JokerType[];
  opponentJokers: JokerType[];
  opponentHandSize: number;
  roundHistory: PublicClaim[];     // all claims this round, oldest first
  claim: PublicClaim & {           // the claim being judged (by: 'player')
    voiceMeta?: VoiceMeta;         // voice tells from STT heuristic
  };
  pileSize: number;
  strikesMe: number;               // 0..3
  strikesPlayer: number;           // 0..3
}

/** Input to aiDecideOwnPlay — the AI is about to make its own claim. */
export interface OwnPlayContext {
  persona: Persona;
  targetRank: Rank;
  myHand: Card[];
  myJokers: JokerType[];
  opponentJokers: JokerType[];
  opponentHandSize: number;
  roundHistory: PublicClaim[];
  pileSize: number;
  strikesMe: number;
  strikesPlayer: number;
}

/** Output of aiDecideOnClaim — consumed by caller to fire ClaimAccepted or ChallengeCalled on the FSM. */
export interface AiDecision {
  action: 'accept' | 'challenge';
  /** For autopsy UI / Earful joker. Populated whether from LLM or fallback. */
  innerThought: string;
  /** Populated only on LLM path (undefined on fallback). Used for post-round autopsy panel. */
  llmReasoning?: string;
  /** Telemetry — which leg of the pipeline produced this decision. */
  source: 'llm' | 'fallback-timeout' | 'fallback-invalid-json' | 'fallback-network-error';
  /** Pipeline latency (ms). Includes math + LLM + any retry. */
  latencyMs: number;
  /** Deterministic math probability surfaced for DEBUG_LLM logs and autopsy UI. */
  mathProb: number;
}

/** Output of aiDecideOwnPlay — consumed by caller to fire ClaimMade on the FSM. */
export interface AiPlay {
  cardsToPlay: Card[];             // length 1 or 2, all drawn from ctx.myHand
  claim: {
    count: 1 | 2;
    rank: Rank;                    // must === ctx.targetRank (round target)
  };
  truthState: 'honest' | 'lying';  // derived from cardsToPlay vs claimedRank
  claimText: string;               // dialogue line for TTS (LLM-generated or templated fallback)
  innerThought: string;
  llmReasoning?: string;
  source: 'llm' | 'fallback-timeout' | 'fallback-invalid-json' | 'fallback-network-error';
  latencyMs: number;
}

/** Raw LLM JSON output for judging — validated against this schema. */
export interface LLMJudgmentOutput {
  action: 'accept' | 'challenge';
  innerThought: string;            // 1 sentence
}

/** Raw LLM JSON output for own-play — validated against this schema. */
export interface LLMOwnPlayOutput {
  cardsToPlay: string[];           // card IDs, length 1 or 2, must be subset of ctx.myHand IDs
  claimCount: 1 | 2;               // must === cardsToPlay.length
  claimText: string;               // short spoken line
  truthState: 'honest' | 'lying';  // must agree with cardsToPlay ranks vs targetRank
  innerThought: string;
}

/** Errors thrown by the LLM layer — caught by brain.ts to trigger fallback. */
export class LLMTimeoutError extends Error {
  constructor() { super('LLM call aborted at 2000ms timeout'); }
}
export class LLMInvalidJSONError extends Error {
  constructor(public raw: string, public reason: string) { super(`LLM returned invalid JSON: ${reason}`); }
}
export class LLMNetworkError extends Error {
  constructor(public cause: unknown) { super(`LLM network error: ${String(cause)}`); }
}
```

---

## 3. Deterministic math layer (`src/lib/ai/math.ts`)

### 3.1 Persona tables (LOCKED — architecture §7.3)

```ts
export const PERSONA_WEIGHTS: Record<Persona, { math: number; voice: number }> = {
  Novice:      { math: 0.7, voice: 0.3 },   // poor reader — leans on hand-math
  Reader:      { math: 0.4, voice: 0.6 },
  Misdirector: { math: 0.5, voice: 0.5 },   // balanced — wins via own voice inversion
  Silent:      { math: 0.3, voice: 0.7 },   // strong reader
};

export const PERSONA_THRESHOLDS: Record<Persona, number> = {
  Novice: 0.70, Reader: 0.55, Misdirector: 0.50, Silent: 0.45,
};

export const PERSONA_BLUFF_BIAS: Record<Persona, number> = {
  Novice: 0.10, Reader: 0.35, Misdirector: 0.60, Silent: 0.55,
};
```

**Invariant:** `weights.math + weights.voice === 1.0` for every persona. Enforced by test.

### 3.2 Math probability function (LOCKED)

```ts
/**
 * Given the claim being judged and the judge's private hand, compute
 * P(opponent's claim is a lie) ∈ [0.15, 0.95] based purely on card availability.
 *
 * No wild-card logic — rank-clean math.
 */
export function claimMathProbability(ctx: DecisionContext): number {
  const target = ctx.claim.claimedRank;
  const outsideOwnHand = 5 - countInHand(ctx.myHand, target);
  const alreadyClaimed = ctx.roundHistory
    .filter(c => c.claimedRank === target)
    .reduce((s, c) => s + c.count, 0);
  const remainingSupport = outsideOwnHand - alreadyClaimed;

  if (remainingSupport < ctx.claim.count) return 0.95;     // impossible given public info
  if (remainingSupport >= 3 * ctx.claim.count) return 0.15; // abundant support
  return Math.max(0.15, Math.min(0.7, 1 - remainingSupport / (3 * ctx.claim.count)));
}

function countInHand(hand: Card[], rank: Rank): number {
  return hand.reduce((n, c) => n + (c.rank === rank ? 1 : 0), 0);
}
```

**Notes:**
- The `outsideOwnHand = 5 - countInHand(...)` is correct for a 20-card deck with 5 of each rank (game-engine invariant 1). If the deck config changes, this formula changes — keep in sync.
- `alreadyClaimed` includes the current claim-being-judged, because it is appended to `roundHistory` BEFORE the judge is called (see caller contract in §6).

### 3.3 Fallback — judging a claim

```ts
export function aiDecideOnClaimFallback(ctx: DecisionContext): {
  action: 'accept' | 'challenge';
  innerThought: string;
  mathProb: number;
} {
  const mathProb = claimMathProbability(ctx);
  const voiceLie = ctx.claim.voiceMeta?.lieScore ?? 0.5; // neutral if voice missing
  const w = PERSONA_WEIGHTS[ctx.persona];
  const threshold = PERSONA_THRESHOLDS[ctx.persona];

  const combined = w.math * mathProb + w.voice * voiceLie;
  const action: 'accept' | 'challenge' = combined >= threshold ? 'challenge' : 'accept';
  const innerThought = buildFallbackThought(ctx.persona, action, mathProb, voiceLie);
  return { action, innerThought, mathProb };
}
```

`buildFallbackThought` returns a persona-flavoured string — four small templates, one per persona, chosen so autopsy UI isn't blank on fallback. Templates live alongside `PERSONA_DESCRIPTIONS` reference from the steering file.

### 3.4 Fallback — own play (LOCKED — architecture §7.3)

```ts
export function aiDecideOwnPlayFallback(ctx: OwnPlayContext): {
  cardsToPlay: Card[];
  claim: { count: 1 | 2; rank: Rank };
  truthState: 'honest' | 'lying';
  claimText: string;
  innerThought: string;
} {
  const targets = ctx.myHand.filter(c => c.rank === ctx.targetRank);
  const nonTargets = ctx.myHand.filter(c => c.rank !== ctx.targetRank);
  const bluffBias = PERSONA_BLUFF_BIAS[ctx.persona];

  // Branch 1: targets available, roll against bluff-bias — play honest
  if (targets.length >= 1 && Math.random() > bluffBias) {
    const count = Math.min(targets.length, 2) as 1 | 2;
    return {
      cardsToPlay: targets.slice(0, count),
      claim: { count, rank: ctx.targetRank },
      truthState: 'honest',
      claimText: templateHonest(ctx.persona, count, ctx.targetRank),
      innerThought: `I have ${count} ${ctx.targetRank}(s). Playing clean.`,
    };
  }

  // Branch 2: mixed hand, bluff by mixing one target + one non-target, claim 2
  if (targets.length >= 1 && nonTargets.length >= 1) {
    return {
      cardsToPlay: [targets[0], nonTargets[0]],
      claim: { count: 2, rank: ctx.targetRank },
      truthState: 'lying',
      claimText: templateLie(ctx.persona, 2, ctx.targetRank),
      innerThought: `Only ${targets.length} real, padding with a ${nonTargets[0].rank}.`,
    };
  }

  // Branch 3: all-target hand — can't bluff up, play honest
  if (targets.length >= 1) {
    const count = Math.min(targets.length, 2) as 1 | 2;
    return {
      cardsToPlay: targets.slice(0, count),
      claim: { count, rank: ctx.targetRank },
      truthState: 'honest',
      claimText: templateHonest(ctx.persona, count, ctx.targetRank),
      innerThought: `All ${ctx.targetRank}s. Nothing to hide.`,
    };
  }

  // Branch 4: forced lie — no targets in hand, claim 1
  return {
    cardsToPlay: [ctx.myHand[0]],
    claim: { count: 1, rank: ctx.targetRank },
    truthState: 'lying',
    claimText: templateLie(ctx.persona, 1, ctx.targetRank),
    innerThought: `No ${ctx.targetRank}s. Bluffing a single.`,
  };
}
```

**Fallback purity exception:** `Math.random()` is used in Branch 1 as the bluff-bias coin-flip. The fallback is NOT pure by the FSM-reducer standard, but it is the only site in the brain that uses randomness. The LLM orchestrator layer is pure given a fixed LLM response. This is acceptable because:
- Fallbacks live outside the FSM reducer (caller layer).
- For determinism in tests, inject a seeded RNG via an optional second parameter `rng = Math.random` so tests can pass a deterministic stub.

`templateHonest` / `templateLie` are small per-persona dialogue banks (~4 lines each × 4 personas) so TTS playback has variety even on fallback. `ai-personas` spec (Day 5) may expand these.

---

## 4. LLM layer (`src/lib/ai/llm.ts`)

Wraps the Gemini 2.5 Flash SDK call. Owns: prompt assembly, `AbortController` timeout, JSON schema enforcement, retry-once on schema-invalid response, structured-error throwing.

### 4.1 Model + SDK

```ts
import { GoogleGenAI, Type } from '@google/genai';

const MODEL_ID = 'gemini-2.5-flash';      // per llm-prompt-conventions.md
const TIMEOUT_MS = 2000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
```

The `@google/genai` package is the current unified Google Gen AI SDK (steering file authority). It replaces the legacy `@google/generative-ai` — they have different import paths and different top-level class names (`GoogleGenAI` vs `GoogleGenerativeAI`). Do not mix.

**Env contract:** `GEMINI_API_KEY` is required. Absence throws at module-load time so failures are loud, not silent-fallback. `.env.local` must include it; Vercel env must include it for prod.

### 4.2 Response schemas (Gemini `responseJsonSchema`)

```ts
const JUDGMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action:       { type: Type.STRING, enum: ['accept', 'challenge'] },
    innerThought: { type: Type.STRING },
  },
  required: ['action', 'innerThought'],
};

const OWN_PLAY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cardsToPlay: { type: Type.ARRAY, items: { type: Type.STRING } },
    claimCount:  { type: Type.INTEGER, enum: [1, 2] },
    claimText:   { type: Type.STRING },
    truthState:  { type: Type.STRING, enum: ['honest', 'lying'] },
    innerThought:{ type: Type.STRING },
  },
  required: ['cardsToPlay', 'claimCount', 'claimText', 'truthState', 'innerThought'],
};
```

### 4.3 Prompt assembly (pure functions)

```ts
export function buildJudgmentPrompt(ctx: DecisionContext, mathProb: number): string { ... }
export function buildOwnPlayPrompt(ctx: OwnPlayContext): string { ... }
```

Both assemble the steering-file templates (§ "Prompt template — judging opponent's claim" / "Prompt template — own play") with context interpolation. No string concatenation with raw user input; all fields are game-engine types so no injection surface.

**Interpolation map (judging):**
| Placeholder | Source |
|---|---|
| `{{persona}}` | `ctx.persona` |
| `{{personaDescription}}` | `PERSONA_DESCRIPTIONS[ctx.persona]` (imported from llm-prompt-conventions constants) |
| `{{targetRank}}` | `ctx.targetRank` |
| `{{handDescription}}` | `formatHand(ctx.myHand)` e.g. `"2 Queen, 1 King, 2 Jack"` |
| `{{pileSize}}` | `ctx.pileSize` |
| `{{publicClaims}}` | `formatHistory(ctx.roundHistory)` — one line per claim, oldest first |
| `{{playerHandSize}}` | `ctx.opponentHandSize` |
| `{{opponentJokers}}` | `ctx.opponentJokers.join(', ') \|\| 'none'` |
| `{{strikesMe}}` / `{{strikesPlayer}}` | direct |
| `{{mathProb}}` | `mathProb.toFixed(2)` |
| `{{voiceLie}}` | `(ctx.claim.voiceMeta?.lieScore ?? 0.5).toFixed(2)` |

### 4.4 Call signatures

```ts
export async function callLLMJudgment(
  ctx: DecisionContext,
  mathProb: number,
  signal: AbortSignal
): Promise<LLMJudgmentOutput>;

export async function callLLMOwnPlay(
  ctx: OwnPlayContext,
  signal: AbortSignal
): Promise<LLMOwnPlayOutput>;
```

**Behavior contract:**
- Call shape: `await ai.models.generateContent({ model: MODEL_ID, contents: prompt, config: { responseMimeType: 'application/json', responseJsonSchema: <schema>, temperature, abortSignal: signal } })`.
- Temperature per steering: judging `0.7`, own-play `0.8`.
- `responseMimeType: 'application/json'` + `responseJsonSchema` enforced at SDK level (NOT `responseSchema` — that field name belongs to the legacy `@google/generative-ai` SDK and will silently no-op under `@google/genai`).
- `config.abortSignal` receives the AbortSignal. When the signal aborts, the SDK rejects the promise — catch and re-throw as `LLMTimeoutError`.
- Parse response JSON. If `JSON.parse` throws → `LLMInvalidJSONError(raw, 'parse-failed')`.
- Validate against TS type (zod or hand-rolled — hand-rolled to keep bundle small). If validation fails → `LLMInvalidJSONError(raw, <reason>)`.
- For own-play, additionally validate:
  - Every `cardsToPlay` ID exists in `ctx.myHand` → else `LLMInvalidJSONError(raw, 'card-id-not-in-hand')`.
  - `cardsToPlay.length === claimCount` → else `LLMInvalidJSONError(raw, 'count-mismatch')`.
  - `truthState` agrees with card ranks vs `targetRank` → else `LLMInvalidJSONError(raw, 'truth-state-mismatch')`.
- Network / SDK errors → wrap in `LLMNetworkError(cause)`.

### 4.5 Retry-once

Retry is attempted ONLY on `LLMInvalidJSONError`, ONCE, with the same prompt (no prompt mutation — the SDK re-sample itself supplies variance). If the retry also throws, propagate up to `brain.ts` which will fall back.

Retries consume the 2 s wall-time budget shared with the first attempt — i.e. the `AbortSignal` is the same signal. If the first attempt took 1800 ms, the retry gets 200 ms. This is intentional; fallback is preferable to a slow over-budget success.

---

## 5. Brain orchestrator (`src/lib/ai/brain.ts`)

Thin layer that stitches math → LLM → fallback. This is the module `game-engine`'s API-route layer calls.

```ts
export async function aiDecideOnClaim(ctx: DecisionContext): Promise<AiDecision> {
  const t0 = performance.now();
  const mathProb = claimMathProbability(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const llm = await callLLMJudgment(ctx, mathProb, controller.signal);
    clearTimeout(timer);
    return {
      action: llm.action,
      innerThought: llm.innerThought,
      llmReasoning: llm.innerThought,
      source: 'llm',
      latencyMs: performance.now() - t0,
      mathProb,
    };
  } catch (err) {
    clearTimeout(timer);
    const fb = aiDecideOnClaimFallback(ctx);
    return {
      action: fb.action,
      innerThought: fb.innerThought,
      source: errorToSource(err),
      latencyMs: performance.now() - t0,
      mathProb,
    };
  }
}

export async function aiDecideOwnPlay(ctx: OwnPlayContext): Promise<AiPlay> { /* mirror pattern */ }

function errorToSource(err: unknown): AiDecision['source'] {
  if (err instanceof LLMTimeoutError)    return 'fallback-timeout';
  if (err instanceof LLMInvalidJSONError) return 'fallback-invalid-json';
  return 'fallback-network-error';
}
```

`llmReasoning` is set ONLY on the LLM-path. On fallback paths it stays `undefined`, which autopsy UI renders as "(deterministic fallback — no LLM reasoning available)".

### 5.1 Caller contract (API-route layer)

The `game-engine` FSM does not import `ai/brain.ts`. The caller (API route `/api/turn` or similar) does:

1. Compute `DecisionContext` from current `Session` via a projection helper (projection lives in the API-route layer, not here — see §6).
2. `await aiDecideOnClaim(ctx)` → receive `AiDecision`.
3. If `action === 'challenge'` → fire `ChallengeCalled` event on FSM.
4. If `action === 'accept'` → fire `ClaimAccepted` event on FSM.
5. Persist `innerThought` + `llmReasoning` onto the last `Claim.llmReasoning` (for autopsy).

For own-play the caller fires `ClaimMade { claim: { by: 'ai', count, claimedRank, actualCardIds, truthState, claimText, llmReasoning, ttsSettings, timestamp } }` — the actual `ttsSettings` field is populated by `voice-tell-taxonomy` preset lookup, not here.

---

## 6. Context construction (caller responsibility — documented for clarity)

The caller (API-route layer) builds `DecisionContext` from `Session` as follows — this is documented here because the shape must stay stable across specs:

```ts
function buildDecisionContext(session: Session, justMadeClaim: Claim): DecisionContext {
  const round = session.rounds[session.currentRoundIdx];
  const player = session.player;
  const ai = session.ai;
  return {
    persona: ai.personaIfAi ?? 'Reader',
    targetRank: round.targetRank,
    myHand: ai.hand,
    myJokers: ai.jokers,
    opponentJokers: player.jokers,
    opponentHandSize: player.hand.length,
    roundHistory: round.claimHistory.map(toPublicClaim), // INCLUDES justMadeClaim
    claim: { ...toPublicClaim(justMadeClaim), voiceMeta: justMadeClaim.voiceMeta },
    pileSize: round.pile.length,
    strikesMe: ai.strikes,
    strikesPlayer: player.strikes,
  };
}
```

**Key invariant:** `roundHistory` MUST include the just-made claim — `claimMathProbability` relies on this to include the current claim's count in `alreadyClaimed`. If it's excluded, `alreadyClaimed` undercounts by `claim.count` and `remainingSupport` is over-estimated (bug → AI under-challenges). This is tested.

---

## 7. File layout

```
src/lib/ai/
  types.ts           — DecisionContext, OwnPlayContext, AiDecision, AiPlay, LLM*Output, LLM*Error
  constants.ts       — PERSONA_DESCRIPTIONS (mirrors llm-prompt-conventions.md), template banks for fallback claimText
  constants.test.ts  — requirement 12.3: PERSONA_DESCRIPTIONS steering-file drift check
  math.ts            — PERSONA_WEIGHTS, PERSONA_THRESHOLDS, PERSONA_BLUFF_BIAS,
                       claimMathProbability, aiDecideOnClaimFallback, aiDecideOwnPlayFallback
  math.test.ts       — invariants 1, 2, 3, 4, 5, 6, 10, 12
  llm.ts             — @google/genai wrapper, prompt assembly, schema validation, retry-once
  llm.test.ts        — invariants 7, 8, 9, 13 (mocks @google/genai)
  brain.ts           — aiDecideOnClaim, aiDecideOwnPlay (math→LLM→fallback orchestration)
  brain.test.ts      — invariants 7, 8, 11, 12 + LLM success path (end-to-end with mocked LLM)
```

Total: 5 source files + 4 test files = 9 files. Sized for a single Day-4 implementation session.

---

## 8. Invariants (Vitest tests — MANDATORY)

All must be covered across `src/lib/ai/*.test.ts`:

1. **Persona weights sum to 1.0:** for every `Persona`, `PERSONA_WEIGHTS[p].math + PERSONA_WEIGHTS[p].voice === 1.0`.
2. **Math probability bounds:** `claimMathProbability` output ∈ `[0.15, 0.95]` for every combination of (myHand, claim.count ∈ {1,2}, claim.claimedRank, roundHistory).
3. **Math probability key cases:**
   - `remainingSupport < claim.count` → `0.95` (impossible claim).
   - `remainingSupport >= 3 * claim.count` → `0.15` (abundant support).
   - Mid-range cases produce values between `0.15` and `0.7` that decrease monotonically with increasing `remainingSupport`.
4. **Fallback judgment is deterministic** (given fixed inputs incl. mocked `Math.random` not used in judgment path): same `DecisionContext` → same `AiDecision.action` every call.
5. **Fallback own-play branches:** all 4 branches of `aiDecideOwnPlayFallback` reachable via constructed hands:
   - hand with targets + bluff-bias < rng → honest
   - hand with mixed ranks + bluff-bias > rng → lying (2 cards, one target one non-target)
   - all-target hand → honest
   - zero-target hand → lying (1 card)
6. **Fallback own-play card conservation:** `cardsToPlay` always a subset of `ctx.myHand` (by identity); `cardsToPlay.length === claim.count`; `truthState === 'honest'` iff every card in `cardsToPlay` has `rank === targetRank`.
7. **LLM timeout triggers fallback:** with a mocked SDK that never resolves, `aiDecideOnClaim` resolves within 2100 ms and returns `source: 'fallback-timeout'`.
8. **LLM invalid JSON retries once then falls back:** mock SDK returns unparseable string twice → brain returns `source: 'fallback-invalid-json'` with exactly 2 SDK invocations recorded.
9. **LLM own-play validates card IDs:** mock SDK returns valid JSON whose `cardsToPlay` contains an ID NOT in `ctx.myHand` → classified as invalid JSON, retries once, then falls back (source: `fallback-invalid-json`).
10. **Voice lie-score absence = neutral 0.5:** fallback behaves identically whether `ctx.claim.voiceMeta` is `undefined` or `{ lieScore: 0.5, ... }`.
11. **Brain latency reported correctly:** `AiDecision.latencyMs > 0` on every path; LLM-path `latencyMs` < 2000; fallback-timeout-path `latencyMs` ≥ 2000 and < 2100.
12. **`alreadyClaimed` includes current claim:** given `roundHistory` containing the just-made claim, `claimMathProbability` returns the correct probability (regression test — this was the call-site contract in §6).
13. **Gemini API key missing throws at module load:** importing `llm.ts` with `GEMINI_API_KEY` unset throws synchronously. (Tested via `vi.stubEnv` or separate test file.)

---

## 9. Out of scope

- Persona voice preset bindings (`ai-personas` spec — Day 5)
- Per-persona dialogue bank expansion beyond the minimal fallback templates (`ai-personas`)
- Stage Whisper probe LLM call + prompt (`probe-phase` spec)
- LLM prompt caching / response caching (not needed for hackathon scale; revisit post-submission if used again)
- Streaming LLM output (not needed — structured JSON only)
- Prosodic-feature voice analysis beyond `voiceMeta.lieScore` (`voice-tell-taxonomy` — already frozen)
- FSM event firing — caller layer does this, not the brain

## 10. Dependencies

This spec depends on (but does NOT implement):

| Dep | Owner spec | What this spec needs |
|---|---|---|
| `Persona`, `Rank`, `Card`, `PublicClaim`, `VoiceMeta`, `JokerType` types | `game-engine` (types.ts) | Re-exported into `DecisionContext` / `OwnPlayContext` |
| `VoiceMeta.lieScore` computation | `voice-tell-taxonomy` (STT heuristic) | Consumed as voice grounding in fallback + LLM prompt |
| `PERSONA_DESCRIPTIONS` constant | `.kiro/steering/llm-prompt-conventions.md` | Interpolated into LLM prompt templates; mirrored in `constants.ts` |
| Gemini Flash SDK (`@google/genai`) | npm dep (add on Day 4) | LLM call infrastructure |
| `GEMINI_API_KEY` env var | infra | LLM auth |

The `game-engine` FSM does NOT depend on this spec — decoupled via caller (API route) layer. Reverse is true: this spec depends only on `game-engine`'s types, not its reducer.

---

## 11. Architecture consistency note

This design.md is a faithful TS-level codification of `ARCHITECTURE-DRAFT.md` §7 + `llm-prompt-conventions.md` steering file. No architectural decisions are re-opened; the only additions are:
- `AiDecision.source` telemetry field (not in §7 but needed for autopsy UI + log analysis — matches §7 spirit of "LLM may be slow/wrong, fallback is first-class")
- `AiDecision.latencyMs` telemetry field (same rationale)
- Context-construction helper `buildDecisionContext` is documented in §6 as a **caller responsibility**, not owned here. Noted for clarity so the `alreadyClaimed`-includes-current-claim invariant can't be accidentally broken by a different caller shape later.

If `ARCHITECTURE-DRAFT.md` §7 is ever re-opened, the locked items are: (a) persona tables in §3.1, (b) math formula in §3.2, (c) four-branch fallback in §3.4. Everything else is implementation detail.
