---
inclusion: fileMatch
fileMatchPattern: "src/lib/probe/**/*.ts|src/app/api/game/probe/**/*.ts"
authored: 2026-04-19
authored_by: Claude Code (Opus 4.7, spec-drafter role)
status: draft (v1 — reconciled with joker-system 2026-04-19; iter-1 review applied)
---

# probe-phase — Design

## Provenance

Authored 2026-04-19 by Claude Code as a TypeScript-level codification of the Stage Whisper mechanic described in `.kiro/steering/product.md` ("Session-Jokers" table) and `ARCHITECTURE-DRAFT.md` §9 spec 9. Builds on the locked `game-engine/design.md` FSM contract, the locked `ai-opponent/design.md` `AiDecision.llmReasoning` shape, and the `ui-gameplay/design.md` phase-gate table.

**Parallel-drafted alongside `joker-system/design.md`.** The ProbeRequest interface has been reconciled with joker-system's Stage Whisper output (see §7.2). No implementation code until reconciled.

Iter-1 review (2026-04-19) applied: 9 findings fixed (4 critical, 4 high, 1 medium). Contract reconciled with joker-system §7.2.

Iter-2 review (2026-04-19) found 6 propagation-drift findings (1 crit, 3 high, 2 med); iter-3 fixes applied the same day to close convergence.

**Scope of this spec:**
- FSM pseudo-state `probe-reveal` (not stored in `Round.status`; derived from `round.activeProbe !== undefined`; persisted slot additions here)
- `ProbeRequest` / `ProbeResponse` / `ProbeFilter` type contracts
- Reasoning filter — rules for safely exposing a subset of `llmReasoning` to the client
- Probe lifecycle: entry (joker consumed), reveal, auto-advance, exit
- New ClientView field for the revealed reasoning snippet
- New API route `POST /api/game/probe` (justified in §3)
- Cross-spec integration seams with `joker-system`, `ai-opponent`, `ui-gameplay`

**NOT in this spec** (handled elsewhere):
- Stage Whisper joker offer / grant / consumption accounting — `joker-system` spec
- `AiDecision.llmReasoning` authoring / prompt — `ai-opponent` spec (consumed as input)
- FSM reducer base transitions — `game-engine` spec (this spec proposes an additive sub-state)
- Probe-reveal UI component implementation — `ui-gameplay` / `joker-system` UI slice, Day 5
- Persona voice tells during probe (if we pipe the revealed snippet through TTS) — out of scope for v1; text-only reveal

## Canonical source

- `.kiro/steering/product.md` "Session-Jokers" table — Stage Whisper is defined as "Unlocks probing: speak 1 free-form probe before next AI claim; AI answers via LLM + TTS with voice tells active". **Note the divergence:** the steering entry describes a *spoken probe → AI answers* loop; this spec's v1 implements the *simpler subset* — probe reveals a filtered snippet of the AI's already-computed `llmReasoning`. If Scott wants the full spoken-probe round-trip, see §11 Open Question 1.
- `ARCHITECTURE-DRAFT.md` §9 spec 9 — probe-phase is cited as a separate spec; LLM probe + TTS with tells is the north-star.
- `ai-opponent/design.md` §2 — `AiDecision.llmReasoning?: string` is populated only on the LLM-success path; undefined on fallback paths.
- `game-engine/design.md` §1.1 — `probe_phase` is already called out as a pseudo-state inserted before an AI `claim_phase` when `stage_whisper` is in `activeJokerEffects`.
- `ui-gameplay/design.md` §3.3 — phase-gate table enumerates the `GameSessionState.phase` derivation rules.

---

## 1. Overview

**Purpose.** Give the player one mid-round "peek behind the AI curtain" via the Stage Whisper joker. The peek reveals a tightly-filtered subset of the AI's internal deliberation (`llmReasoning`) so the player can make a more informed accept/challenge decision — *without* revealing hand-math probability numbers or persona-identifying phrases that would flatten the bluffing mystery.

**Why subset, not full dump:** revealing the entire `llmReasoning` string would:
1. Leak the persona (Reader vs Silent read very differently in prose), which long-term trains the player to spot persona by reasoning style and defeats the point of hidden opponents.
2. Leak the hand-math probability as a decimal (`"claimMathProbability: 0.34"`), which collapses the "is it a bluff?" tension to a solved-math question.
3. Remove the heuristic/emotional register that's the mechanic's signature — we want players to catch vibes, not read debug dumps.

So: a **reasoning filter** (§5) is the novel contribution. It converts a verbose internal chain into a single short sentence of "vibe" — e.g. "The claim felt too casual" — while stripping math and persona leaks.

**In scope:**
- Types: `ProbeRequest`, `ProbeResponse`, `ProbeFilter`, `ActiveProbe` (session slot)
- FSM additive fields: `activeProbe` round slot, 2 new owned events (`ProbeStart`, `ProbeExpired`); `ProbeComplete` owned by joker-system
- Filter: deterministic pipeline (regex + structured-field projection + fallback) with testable invariants
- Client reveal via dedicated ClientView field `currentProbe?: RevealedProbe`
- API route `POST /api/game/probe`

**Out of scope (v1):**
- Spoken probe question → LLM answer flow (north-star from steering; tracked as §11 Q1)
- TTS playback of the revealed snippet (v1 is text-only; voice-wrapped reveal is §11 Q4)
- Multiple concurrent probes (strict one-at-a-time; §11 Q2)
- Probe during multi-AI turn handling (N/A for 1v1 MVP, documented for future; §11 Q3)
- Decay / fade-out animation (UI concern, not a state contract)

---

## 2. Key concepts

| Concept | Meaning |
|---|---|
| **Probe** | A single client-initiated request to peek at the AI's current-turn reasoning. Consumes one `stage_whisper` joker-effect slot. |
| **Stage Whisper joker** | The enabling power-up owned by `joker-system`. When held, it grants the player one pending probe. Consumption happens on probe entry. |
| **`probe-reveal` phase** | A pseudo-state (not stored in `Round.status`) derived from `round.activeProbe !== undefined`. Inserted between `response_phase` (AI's claim just dropped) and the player's accept/challenge. During `probe-reveal`, the normal accept/challenge buttons are suppressed; the reveal UI is foregrounded. |
| **Probe budget** | Exactly 1 active probe per Stage Whisper joker. No stacking. If the player holds two Stage Whispers, the second one's probe is rejected while the first is active (queue option rejected — see §11 Q2). |
| **Reveal** | The server-filtered snippet of `llmReasoning` that crosses the wire to the client. Never contains the raw `llmReasoning` field. |
| **Decay** | Auto-advance after N seconds back to the pre-probe phase. Timer orchestration is caller-side (matches game-engine §3.3 Timeout convention — reducer stays pure). Default N = 4000ms (see §6). |
| **Filter** | The deterministic pipeline that converts the raw `llmReasoning` string into a safe `revealedReasoning` snippet. Owns all information-security rules (§5). |

---

## 3. Architecture

```
Player (client)                    joker-system             probe-phase            ai-opponent / FSM
-----------------                  --------------           ------------           ----------------------
                                                            (server)               (server)

1. user taps "Stage Whisper"
   button during response_phase
   of AI's claim
        │
        ▼
2. POST /api/game/probe
   { sessionId }
        │
        ├────────────────────►  validate joker budget:
        │                       does session hold a
        │                       stage_whisper effect
        │                       slot on this round?
        │                            │
        │                            ▼
        │                       yes → consume slot,
        │                       emit ProbeRequest ──►  receive ProbeRequest,
        │                                              assert FSM in response_phase,
        │                                              look up round.claimHistory[-1]
        │                                              (the just-made AI claim),
        │                                              read its llmReasoning
        │                                                      │
        │                                                      ▼
        │                                              run probeFilter(llmReasoning,
        │                                                              persona, mathProb)
        │                                                      │
        │                                                      ▼
        │                                              build RevealedProbe {
        │                                                whisperId,
        │                                                revealedReasoning,
        │                                                decayMs,
        │                                                expiresAt (server time)
        │                                              }
        │                                                      │
        │                                              fire ProbeStart event on FSM
        │                                              → round.activeProbe = <…>
        │                                              (probe-reveal pseudo-state now active)
        │                                                      │
        │                                                      ▼
        │                                              toClientView(session) projects
        │                                              activeProbe → currentProbe
        │                                              (opponent's raw llmReasoning
        │                                              stays server-only)
        │                                                      │
        │  ◄──────────────────────────────────────────  return ClientSession with
        │                                              currentProbe populated
        ▼
3. client renders probe reveal
   UI (typewriter of the
   revealed snippet, overlay
   on claim bubble)
   [normal accept/challenge
    buttons gated off by
    phase → 'probe-reveal']

4. timer fires at decayMs
   (client-side cosmetic) OR
   user action ends probe early

5. POST /api/game/probe
   { sessionId, action: 'complete' }
        │
        ├────────────────────►                         fire ProbeComplete event on FSM
        │                                              → round.activeProbe = null
        │                                              (probe-reveal pseudo-state cleared)
        │                                                      │
        │  ◄──────────────────────────────────────────  return ClientSession (currentProbe
        ▼                                              absent) — normal accept/challenge
6. client re-renders with                              buttons restored
   accept/challenge buttons
   restored
```

**Why a dedicated `/api/game/probe` route (not multiplexed through `/api/turn`):** the existing `/api/turn` in `ui-gameplay/design.md` §4 is the FSM event firehose (`PlayerClaim` / `PlayerRespond` / `AiAct`). Stapling probe onto it muddies the route's single responsibility and forces every caller to carry probe-awareness. A dedicated route keeps the probe lifecycle self-contained and means `joker-system` can own the button wiring without touching the turn pipeline. The tradeoff — one extra route file — is trivial. Structure.md also already lists `src/app/api/game/probe/route.ts`, so this aligns with the planned tree.

**Server-authoritative boundary (CRITICAL).** The raw `llmReasoning` field never crosses the wire. Only the filter's output does, and only inside `ClientSession.currentProbe.revealedReasoning`. `toClientView` must strip `activeProbe.revealedReasoning` into that path and drop any server-only slice. This mirrors the existing `actualCardIds` / `llmReasoning` stripping in `toClientView.ts`.

---

## 4. Data model

All probe types live in `src/lib/probe/types.ts`. Game-engine types (`Rank`, `Persona`, `Round`, etc.) are re-used via import — never duplicated.

```ts
import type { Persona, Rank, Session } from '../game/types';

/**
 * Input into probe-phase, produced by joker-system when Stage Whisper is
 * consumed. Caller stamps whisperId (uuid v4) so the reveal can be traced
 * across the stack for debugging / autopsy.
 *
 * LOCKED INTERFACE — reconciled with joker-system §7.2 per orchestrator
 * reconciliation 2026-04-19. See §7.2.
 */
export interface ProbeRequest {
  whisperId: string;                 // uuid v4 — ties request to response
  targetAiId: 'ai';                  // which AI is being probed. 1v1 MVP → always 'ai'. Enum-shaped for future multi-AI.
  roundIdx: number;                  // matches Session.currentRoundIdx (joker-system's name — use this, drop roundId)
  triggeredAtTurn: number;           // claimHistory.length at request time — lets filter know which claim to peek at
  now: number;                       // ms since epoch — determinism per game-engine §3.2
  mathProb?: number;                 // from AiDecision.mathProb at consumption time — feeds static-fallback lane (§5.3); optional because fallback path may not have it
}

/** The server's projected response. Crosses the wire. */
export interface ProbeResponse {
  whisperId: string;                 // echoes ProbeRequest.whisperId
  revealedReasoning: string;         // filtered snippet — ALWAYS non-empty (filter falls back if empty, §5)
  decayMs: number;                   // server-authoritative reveal duration; client renders timer from this
  filterSource: ProbeFilterSource;   // telemetry — which filter leg produced the snippet
}

/** Pipeline leg that produced the revealed snippet. */
export type ProbeFilterSource =
  | 'llm-heuristic-layer'            // structured LLM field (preferred — see §5.2)
  | 'regex-scrub'                    // sanitized full llmReasoning (fallback)
  | 'fallback-static';               // filter produced empty output → static template (last-resort)

/**
 * Server-side slot stored on Round.activeProbe while probing is active.
 * toClientView projects this (selectively) into ClientSession.currentProbe.
 *
 * The `rawLlmReasoning` field is SERVER-ONLY — never crossed via toClientView.
 * Carried here only so filter re-runs (if we ever allow them) don't have to
 * re-read from claimHistory; convenience, not contract.
 */
export interface ActiveProbe {
  whisperId: string;
  targetAiId: 'ai';
  roundIdx: number;
  triggeredAtTurn: number;
  revealedReasoning: string;         // filtered output
  filterSource: ProbeFilterSource;
  startedAt: number;                 // server timestamp (from event.now)
  decayMs: number;                   // resolved server-side; default 4000
  expiresAt: number;                 // startedAt + decayMs
  rawLlmReasoning: string;           // SERVER-ONLY — never in ClientSession
}

/** Client-visible projection of ActiveProbe. Omits rawLlmReasoning. */
export interface RevealedProbe {
  whisperId: string;
  revealedReasoning: string;
  filterSource: ProbeFilterSource;
  decayMs: number;
  expiresAt: number;
}

/** Filter function signature. Pure — no I/O, no randomness, no Date.now(). */
export type ProbeFilter = (
  rawLlmReasoning: string | undefined,   // matches Claim.llmReasoning?: string — undefined on AI fallback paths
  persona: Persona,
  mathProb: number,
) => { revealedReasoning: string; filterSource: ProbeFilterSource };
```

### 4.1 Additive FSM fields (owned here, declared in game-engine/types.ts on reconciliation)

**probe-phase does NOT add a new Round.status value.** Per game-engine §1.1, probe is a pseudo-state derived from `round.activeProbe !== undefined`. The `Round.activeProbe?: ActiveProbe` field is the ONLY persisted addition.

```ts
// Added to Round (game-engine/types.ts)
interface Round {
  // ... all existing fields ...
  // status enum is UNCHANGED — probe is a pseudo-state, not a stored status value
  activeProbe?: ActiveProbe;         // NEW — presence signals active probe; absence signals none
}

// Added to ClientRound (game-engine/types.ts)
interface ClientRound {
  // ... all existing fields ...
  currentProbe?: RevealedProbe;      // NEW — projected from Round.activeProbe, rawLlmReasoning stripped
}

// Added to GameEvent (game-engine/types.ts)
type GameEvent =
  | /* ... existing events ... */
  | { type: 'ProbeStart'; probe: ActiveProbe; now: number }
  // ProbeComplete event is owned by joker-system spec (§7.1.1); this spec only consumes it in the reveal-completion reducer.
  | { type: 'ProbeExpired'; whisperId: string; now: number }; // caller-fired on decay timer
```

**Note on three events vs one.** `ProbeStart` carries the full ActiveProbe (caller pre-computed filter output; reducer stays pure). `ProbeComplete` is the player's early-dismissal path. `ProbeExpired` is the caller's decay-timer path. Splitting them makes the telemetry distinction visible (autopsy UI can show "probe dismissed" vs "probe timed out") without reducer logic knowing the difference — both transitions look identical in `fsm.ts`. The split exists for observability, not behavior.

---

## 5. Reasoning filter — the novel contribution

The filter is the gatekeeper between server-only `llmReasoning` and client-visible `revealedReasoning`. It MUST be a pure, deterministic, testable function. Four design rules:

1. **Never leak a decimal probability.** If the raw string contains any number formatted as `N.NN` or `0.NN` or `NN%`, strip it. This catches `claimMathProbability: 0.34` and similar verbose math-talk.
2. **Never leak a persona-identifying phrase.** Known persona literals from `src/lib/game/types.ts` (`'Novice' | 'Reader' | 'Misdirector' | 'Silent'`) get stripped (case-insensitive). The player's guessing persona-by-prose-style is fun; having "As the Reader persona, I …" revealed is not. If a display-name table is introduced cross-spec in future, those names will be added to the strip list at that time (tracked as §11 Q8).
3. **Prefer the heuristic / emotional register.** If the LLM can tag its reasoning with a structured `heuristicLayer` field, use that directly. Else, run regex scrubbing on the full prose.
4. **Never emit empty.** If filtering removes everything, fall back to a static persona-agnostic template ("*Something feels off about this one.*" / "*The numbers look fine.*", chosen by a coarse signal — see §5.3).

### 5.1 Two-lane filter (preferred)

The cleanest filter is one that doesn't have to parse prose at all. That requires `ai-opponent` to emit a structured `heuristicLayer` field in addition to prose `innerThought`. **If `ai-opponent` can be extended (§11 Q6), this lane dominates.**

```ts
// Proposed ai-opponent addition (documented here for reconciliation):
interface LLMJudgmentOutput {
  action: 'accept' | 'challenge';
  innerThought: string;              // existing verbose reasoning
  heuristicLayer?: string;           // NEW — 1 sentence, vibes only, no numbers
}
```

If `heuristicLayer` is present on the raw reasoning, the filter applies the same `[0-9%]` numeric scrub (NUMERIC_PATTERNS from §5.2) before returning it, with `filterSource: 'llm-heuristic-layer'`. This ensures invariant I2 holds across all lanes even if the LLM bleeds digits into the heuristic field. **v1 goal: land this lane in sync with `ai-opponent` updates on Day 4.**

### 5.2 Regex-scrub lane (fallback when heuristicLayer absent)

If `heuristicLayer` is undefined (because `ai-opponent` hasn't been extended yet, or the LLM path didn't emit it), regex-scrub the `innerThought`:

```ts
const NUMERIC_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?%\b/g,             // "34%" / "0.5%"
  /\b0?\.\d{1,3}\b/g,                // "0.34" / ".34"
  /\b\d{2,3}\.\d+\b/g,               // "12.34" — any decimal ≥ 2 digits before point
  /\bprob(?:ability)?\s*:\s*[\d.]+/gi, // "prob: 0.34" / "probability: 0.5"
];

const PERSONA_IDENTIFIERS: RegExp[] = [
  /\b(?:Novice|Reader|Misdirector|Silent)\b/gi,        // canonical persona literals from src/lib/game/types.ts
  /\bpersona\b/gi,                                     // meta-reference
  // NOTE: display-name variants are NOT listed here — no canonical display-name table exists today.
  // If a display-name table is added cross-spec, extend this list. Tracked as §11 Q8.
];

const DEBUG_ARTIFACTS: RegExp[] = [
  /\bmathProb\b/gi,                 // bleed-through of debug identifiers
  /\blieScore\b/gi,
  /\bvoiceMeta\b/gi,
  /```[\s\S]*?```/g,                // code blocks — the LLM sometimes wraps math
];
```

Pipeline:
1. Strip numeric patterns (replace with empty string).
2. Strip persona identifiers (replace with empty string).
3. Strip debug-artifact tokens (replace with empty string).
4. Collapse runs of whitespace into single spaces; trim.
5. Truncate to first sentence (split on `/[.!?]\s/` → take `[0]`).
6. Hard cap at 120 characters (rejects long runs where regex missed something).

### 5.3 Static-fallback lane (last resort)

If regex-scrub yields empty or < 8 characters, emit a static template chosen by `mathProb` signal:

```ts
function staticFallback(mathProb: number): string {
  if (mathProb >= 0.7) return "*Something feels off about this one.*";
  if (mathProb <= 0.3) return "*The numbers look fine.*";
  return "*Hard to say.*";
}
```

`mathProb` is a number, not a string — it's fine to consume here because the OUTPUT is a pre-authored template; no digits leak. `filterSource: 'fallback-static'`. This also handles the `llmReasoning === undefined` case (AI decision was fallback-path, no LLM reasoning to filter — treat as empty).

### 5.4 Filter invariants (testable — see §9)

- Filter output never contains any character in `[0-9%]`.
- Filter output never contains any of the 4 canonical persona literals (`Novice`, `Reader`, `Misdirector`, `Silent`) — case-insensitive.
- Filter output is always non-empty (≥ 1 character).
- Filter output is ≤ 120 characters.
- Filter is pure — same input always produces same output.
- Filter never throws — malformed input routes to static fallback.

---

## 6. Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  response_phase                                                 │
│  (AI's claim just fired; normal accept/challenge buttons up)    │
│                                                                 │
│        │                                                        │
│        │ player holds stage_whisper joker AND taps probe button │
│        │ → POST /api/game/probe                                 │
│        │                                                        │
│        ▼                                                        │
│  [SERVER]                                                       │
│  1. validate round.activeJokerEffects has 'stage_whisper' slot  │
│  2. validate round.status === 'response_phase' (status unchanged │
│     throughout — pseudo-state)                                  │
│  3. read last claim from round.claimHistory                     │
│  4. call probeFilter(claim.llmReasoning, persona, mathProb)     │
│  5. consume joker-effect slot (mutate activeJokerEffects)       │
│  6. fire ProbeStart event → round.activeProbe = <ActiveProbe>   │
│     (probe-reveal pseudo-state now active)                      │
│  7. return ClientSession + ProbeResponse                        │
│                                                                 │
│        │                                                        │
│        ▼                                                        │
│  probe-reveal (pseudo-state: round.activeProbe !== undefined)   │
│  (accept/challenge buttons gated off; reveal UI foregrounded)   │
│                                                                 │
│        │                                                        │
│        ├── user dismisses early (ProbeComplete)                 │
│        │                                                        │
│        └── decay timer elapses (ProbeExpired)                   │
│                                                                 │
│            both paths:                                          │
│            → round.activeProbe = null                           │
│            (probe-reveal pseudo-state cleared; response_phase   │
│             resumes — round.status was never changed)           │
│            → ClientSession.currentProbe absent                  │
│            → accept/challenge buttons restored                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Entry conditions (ALL must hold, else probe request rejected with `400 PROBE_REJECTED`):**
- `session.status === 'round_active'`
- `round.status === 'response_phase'`
- `round.activeJokerEffects` contains at least one `{ type: 'stage_whisper' }` entry
- `round.claimHistory.length > 0` (there's something to probe)
- `round.claimHistory[-1].by === 'ai'` (don't probe your own claims; filter would return nonsense)
- `round.activeProbe === undefined` (no double-probe — §11 Q2)

**Duration.**
- Default `decayMs = 4000` (4 seconds). Source: typewriter reveal of ~100-char snippet at ~30ms/char ≈ 3s read; +1s grace.
- Server-authoritative — client timer is cosmetic. Server records `startedAt + decayMs = expiresAt`; if the client's `ProbeComplete` arrives after `expiresAt`, the FSM has already auto-transitioned back.

**Exit.**
- **Early dismiss:** player taps "continue" → client POSTs `ProbeComplete` → FSM transitions back to `response_phase`.
- **Timer expiry:** caller fires `ProbeExpired` when `Date.now() >= expiresAt`. Caller owns the timer (API-route layer / client polling / SSE), not the reducer.
- **What if user challenges during probe?** UI gates the accept/challenge buttons off during `probe-reveal`. The API route also rejects `PlayerRespond` events while `round.activeProbe !== undefined` with `400 INVALID_PHASE` — defense in depth. Player must wait out or dismiss the probe.
- **Stale probe (AI has already moved on):** impossible in 1v1 because `response_phase` → `probe-reveal` → `response_phase` is strictly sequential under the same AI claim. If ever extended to multi-AI: probe references `claimHistory[-1]` at entry, which is stable for the response_phase window.

**One probe per Stage Whisper consumption (strict).** The `stage_whisper` joker-effect slot is consumed at `ProbeStart`. If the player holds two Stage Whispers in their joker inventory (possible — accumulated across rounds), only one can fire at a time; the second slot remains until the first probe completes. No queueing UI: pressing the probe button again while `round.activeProbe` is set is a client-side no-op, and the API rejects with `409 PROBE_ACTIVE`.

---

## 7. Integration points

### 7.1 Shared-state additions (summary)

| Addition | Owner file | Owner spec (after reconciliation) |
|---|---|---|
| `Round.activeProbe?: ActiveProbe` (pseudo-state derivation; no new `Round.status` value) | `src/lib/game/types.ts` | `game-engine` (declared here, owned there) |
| `ClientRound.currentProbe?: RevealedProbe` | `src/lib/game/types.ts` | `game-engine` |
| `GameEvent` union: `ProbeStart`, `ProbeExpired` (+ `ProbeComplete` owned by joker-system §7.1.1) | `src/lib/game/types.ts` | `game-engine` / `joker-system` (see §4.1 note) |
| `mathProb` routing: passed via `ProbeRequest.mathProb` (read from `AiDecision.mathProb` at consumption time) — NOT persisted on `Claim` | n/a — no new type field | caller convention (probe-phase + joker-system) |
| `toClientView` projection rule: `activeProbe` → `currentProbe`, strip `rawLlmReasoning` | `src/lib/game/toClientView.ts` | `game-engine` |
| FSM reducer dispatch: 2 new cases owned (ProbeStart, ProbeExpired) + 1 reducer slice consumed (ProbeComplete, owned by joker-system) + 1 new activeProbe-presence guard | `src/lib/game/fsm.ts` | `game-engine` |
| `ProbeRequest`, `ProbeResponse`, `ProbeFilter`, `ActiveProbe`, `RevealedProbe`, `ProbeFilterSource` types | `src/lib/probe/types.ts` | `probe-phase` (this spec) |
| `probeFilter` function + filter-lane helpers | `src/lib/probe/filter.ts` | `probe-phase` |
| `buildActiveProbe(session, request, now)` helper | `src/lib/probe/reveal.ts` | `probe-phase` |
| `POST /api/game/probe` route | `src/app/api/game/probe/route.ts` | `probe-phase` (mirrors structure.md line 44) |

**Design principle:** all game-engine-ring additions are PURELY ADDITIVE — no existing field changes shape, no existing FSM event changes semantics. This minimizes reconciliation surface with in-flight `game-engine` work.

### 7.2 Interface with `joker-system` (LOCKED with joker-system §7.2 per orchestrator reconciliation 2026-04-19)

**Contract:** `joker-system` emits a `ProbeRequest` with the exact shape in §4 when the Stage Whisper joker is consumed. Specifically:

```ts
// joker-system is EXPECTED to export (mirror verbatim):
import type { ProbeRequest } from '../probe/types';
export function consumeStageWhisper(
  session: Session,
  now: number,
): { session: Session; probeRequest: ProbeRequest };
```

The probe spec does not own `joker-system`'s internals; it only needs a `ProbeRequest`-shaped object at its front door. This shape is now locked — any deviation must be escalated to the orchestrator.

**Coupling point:** the `stage_whisper` joker-effect slot on `round.activeJokerEffects`. Both specs write/read this slot — joker-system on pickup, probe-phase on consumption. Ordering:
1. Between-round joker pick installs `stage_whisper` into `session.player.jokers`.
2. Player plays Stage Whisper mid-round → joker-system moves the joker to `round.activeJokerEffects` (at player's choice of AI claim).
3. Probe fires → probe-phase consumes the effect slot.

If either spec drops step 2 or step 3's accounting, the joker budget breaks.

### 7.3 Interface with `ai-opponent`

**Read-only dependency on `Claim.llmReasoning`** (owned by `game-engine/types.ts`, populated by `ai-opponent/brain.ts`). The probe-phase server handler reads `round.claimHistory[-1].llmReasoning` directly — no new brain entry point required for v1.

**One proposed addition to ai-opponent (§11 Q6):**
1. `LLMJudgmentOutput.heuristicLayer?: string` — enables the zero-regex filter lane (§5.1). Pure win; 1 extra JSON field.

**`mathProb` handling:** `Claim.mathProb?: number` is NOT added to game-engine types. Instead, `mathProb` is passed via `ProbeRequest`, where the caller reads it from `AiDecision.mathProb` at consumption time (the AiDecision is available to the joker-system handler that builds the ProbeRequest). The probe-phase handler reads `probeRequest.mathProb` to feed the static-fallback lane (§5.3). See §7.1 shared-state table for the updated enumeration.

**No pre-computation required.** The filter runs at probe-request time, not at claim-time. This keeps the AI turn-latency budget untouched (filter is sub-millisecond regex work).

**Claim.llmReasoning absent on fallback paths.** When `AiDecision.source !== 'llm'`, `Claim.llmReasoning` is undefined. The filter handles this via the static-fallback lane (§5.3). Covered by invariant I7.

### 7.4 Interface with `ui-gameplay`

**Phase-gate table addition** (ui-gameplay/design.md §3.3):

| `GameSessionState.phase` | Derivation rule |
|---|---|
| `'probe-reveal'` (NEW) | `round.activeProbe !== undefined` |

Phase names follow ui-gameplay's kebab-case convention. The derivation is based solely on `round.activeProbe` presence (the ONLY persisted probe signal — no new `Round.status` value is added; probe is a pseudo-state per game-engine §1.1).

UI rendering: when `phase === 'probe-reveal'`, `<AcceptLiarButtons/>` is hidden and a new `<ProbeReveal/>` component is mounted (component *named* here for traceability; *designed and implemented* by `joker-system` UI slice on Day 5). `<ProbeReveal/>` reads `ClientRound.currentProbe.revealedReasoning` and renders it via the existing `useTypewriter` hook.

**derivePhase gate-table gap (Day 4 retro §79).** The retro already flagged that `useGameSession.derivePhase` has gaps in the gate-table coverage. The `'probe-reveal'` phase adds one more row but should be ADDED CLEANLY — i.e., without expanding the existing gap. Propose: when `derivePhase` is next refactored, use an `activeProbe` presence check before the `round.status` switch; this avoids a fallthrough bug.

---

## 8. Error handling

| Error | HTTP code | When |
|---|---|---|
| `PROBE_REJECTED_NO_JOKER` | 400 | `round.activeJokerEffects` lacks `stage_whisper` slot |
| `PROBE_REJECTED_INVALID_PHASE` | 400 | `round.status !== 'response_phase'` on entry, or `round.activeProbe === undefined` on complete |
| `PROBE_REJECTED_NO_CLAIM` | 400 | `round.claimHistory.length === 0` or last claim `by !== 'ai'` |
| `PROBE_ACTIVE` | 409 | `round.activeProbe` already set — second probe attempt while first active |
| `PROBE_NOT_FOUND` | 404 | ProbeComplete fired with unknown whisperId (shouldn't happen in normal flow; defense) |
| `PROBE_FILTER_FAILED` | NEVER | Filter is guaranteed non-throwing — static-fallback covers every branch. If this ever fires, it's a test bug. |

**Filter-fails-all-content scenarios (observed during dev):**
- LLM emitted a prose dump with *only* numbers and persona identifiers → regex strips everything → static-fallback fires. This is the intended behavior. `filterSource: 'fallback-static'` in telemetry.
- `llmReasoning === undefined` (AI decision was fallback-path) → regex-scrub on `undefined` → empty → static-fallback. Same behavior.

**Stale probe (AI has already moved on):** Not possible in 1v1 (see §6 Exit). Noted here for completeness.

**Probe used in invalid phase (e.g., during `claim_phase` before AI has even spoken):** rejected at the entry guard, `400 PROBE_REJECTED_INVALID_PHASE`.

---

## 9. Testing invariants (Vitest — MANDATORY)

Target 12 testable invariants (ranging from filter purity to FSM integration). All must live in `src/lib/probe/*.test.ts` or `src/app/api/game/probe/route.test.ts`:

**I1. Probe always reveals non-empty content.** For every combination of (persona, mathProb, llmReasoning) including `llmReasoning === undefined`, filter output is `string.length ≥ 1`. Regression guard for "filter can emit empty" bug.

**I2. No probability numbers leak.** Fuzz 50 random prose strings containing digits / decimals / percents; assert filter output matches `/^[^0-9%]*$/`. Seed with known-bad LLM outputs ("I think the probability is 0.34", "34% chance this is a bluff").

**I3. No persona identifier leaks.** For every canonical persona literal ∈ {Novice, Reader, Misdirector, Silent} (the full union from `src/lib/game/types.ts`), assert filter output does not contain the string (case-insensitive). Seed with LLM outputs that name personas directly. Display-name variants are not tested here — no canonical display-name table exists today (tracked as §11 Q8).

**I4. Filter length cap.** For every filter-able input, output `.length <= 120`.

**I5. Filter is pure.** `probeFilter(x, p, m) === probeFilter(x, p, m)` across two invocations (string equality, given strings are value types in JS — the test asserts deep equality on the `{ revealedReasoning, filterSource }` result).

**I6. Filter never throws.** Given malformed inputs (empty string, null-like, very long string, unicode-only, control characters), filter never throws. Always returns a result with `filterSource` set.

**I7. Filter handles missing llmReasoning.** `probeFilter(undefined, persona, mathProb)` returns `filterSource: 'fallback-static'` and a non-empty revealedReasoning. (Handles AI-fallback-path case. No `as any` cast needed — signature accepts `string | undefined`.)

**I8. FSM entry guard.** Probe request against a session in `claim_phase` throws `InvalidTransitionError` (or the API route returns 400); `round.activeJokerEffects` without `stage_whisper` returns 400; last claim `by === 'player'` returns 400. Each guard is a separate test case.

**I9. Concurrent probe rejected.** With `round.activeProbe` already set, a second ProbeStart attempt returns 409. Validate the FSM state is unchanged.

**I10. toClientView strips rawLlmReasoning.** Given a Session with `round.activeProbe.rawLlmReasoning = "SECRET MATH: 0.42 from Silent persona"`, `toClientView(session).rounds[0].currentProbe` has no `rawLlmReasoning` property and `JSON.stringify()` of the result does not contain "SECRET" / "0.42" / "Silent".

**I11. Probe complete / expire both clear activeProbe.** Both `ProbeComplete` (owned by joker-system §7.1.1, consumed here) and `ProbeExpired` events clear `round.activeProbe`; `ProbeStart` SETS it. `round.status` is never changed — probe is a pseudo-state per game-engine §1.1. Asymmetry: telemetry (`filterSource`) is preserved in history if we add a probe-log; v1 does not log.

**I12. Only one probe per Stage Whisper consumption.** Two Stage Whispers in jokers → first probe fires → second probe attempt while first active returns 409 → complete first → second probe can now fire.

**Target:** 12 invariants (stretch to 15 if time permits; 12 covers the critical information-security + FSM-integrity paths).

---

## 10. File layout

```
src/lib/probe/
  types.ts            — ProbeRequest, ProbeResponse, ProbeFilter, ActiveProbe, RevealedProbe, ProbeFilterSource
  types.test.ts       — type-level assertions (exhaustive enum coverage, discriminated union)
  filter.ts           — probeFilter + private lane helpers (llm-heuristic-layer, regex-scrub, static-fallback)
  filter.test.ts      — invariants I1-I7
  reveal.ts           — buildActiveProbe(session, request, now), phase entry/exit helpers (pure)
  reveal.test.ts      — invariants I8-I9, I11-I12

src/app/api/game/probe/
  route.ts            — POST handler; input validation, FSM event firing, toClientView response
  route.test.ts       — invariant I10; integration test with mocked session store
```

**Total: 7 files (4 src + 3 test).** Sized for a single implementation session if `game-engine/types.ts` additions are folded in by a reconciliation PR first.

**Justification for the 3-file split inside `src/lib/probe/`:**
- `types.ts` is type-only (no runtime code) — reusable across the stack without pulling in filter logic.
- `filter.ts` is the novel contribution — isolated so it can be fuzzed / property-tested aggressively.
- `reveal.ts` is the FSM-aware glue — imports `filter.ts` and `game/types.ts`. Separating this from `filter.ts` keeps the filter layer unit-testable without FSM mocks.

Mirrors the `src/lib/game/{fsm,types,toClientView}.ts` / `src/lib/ai/{brain,llm,math,types}.ts` pattern already established in the codebase.

---

## 11. Open questions (flag in requirements.md as `## Design questions for Scott`)

**Q1. Full spoken-probe round-trip (north-star) vs v1 snippet-reveal (this spec).** The steering entry says: *"speak 1 free-form probe before next AI claim; AI answers via LLM + TTS with voice tells active"*. This is a richer interaction — player asks "Did you mean that?", AI answers in-persona with voice tells. v1 scopes down to a *reasoning-snippet reveal* (zero additional LLM call, zero TTS). Do we ship v1 for Day-4 and escalate to the full spoken-probe version on Day 5? **Recommendation: yes — v1 validates the cross-spec integration; v2 layers on the LLM round-trip once the rails are laid.**

**Q2. Second concurrent probe: reject or queue?** Current spec rejects with 409 (`PROBE_ACTIVE`). Alternative: queue the second probe to fire automatically after the first completes. Queue adds state complexity and surprises the player (second reveal "pops" unexpectedly). **Recommendation: reject (v1).** Queue is a non-starter — players will tap the probe button twice out of habit; surprise reveal confuses UX.

**Q3. Probe during multi-AI turn.** Spec assumes 1v1. Future (never for hackathon) multi-AI would require `targetAiId` to disambiguate. Type is already enum-shaped (`'ai'`) for forward-compat. Documented, no action needed for MVP.

**Q4. Voice-wrapped reveal.** Should the revealedReasoning go through TTS + persona voice preset, so the player *hears* the AI's "inner thought" in the AI's voice? Adds immersion but also latency (TTS call = ~75ms+) and cost. **Recommendation: v1 text-only; revisit Day-5 polish pass alongside autopsy UI.**

**Q5. ProbeRequest interface — RESOLVED.** Reconciled with joker-system §7.2 per orchestrator 2026-04-19. The locked interface (§4):
```ts
{ whisperId: string; targetAiId: 'ai'; roundIdx: number; triggeredAtTurn: number; now: number; }
```
This shape is locked. Any deviation from this shape must be escalated to the orchestrator before implementation begins.

**Q6. `ai-opponent` addition of `LLMJudgmentOutput.heuristicLayer`.** §5.1 depends on this. Scott's call: (a) extend `ai-opponent` now (1-2 LLM prompt tweaks + 1 type field), (b) ship probe-phase with only regex-scrub + static-fallback lanes. **Recommendation:** (a) — heuristicLayer is a ~5-minute LLM prompt addition that dramatically improves reveal quality. Lanes 2 + 3 remain as defense-in-depth. Note: `mathProb` is already routed via `ProbeRequest.mathProb` (per §7.3 and §4) — no `Claim.mathProb` field is needed.

**Q8. Persona display-name table cross-spec addition.** The filter strips the 4 canonical persona literals (`Novice`, `Reader`, `Misdirector`, `Silent`) from `src/lib/game/types.ts`. If a display-name table (e.g. `Prosecutor`, `Attorney`, `Judge`, `Defendant`) is introduced in a future cross-spec addition, the `PERSONA_IDENTIFIERS` regex list in `filter.ts` must be updated. This is a FUTURE addition — no display-name table exists today; do not add speculative strings.

**Q7. Filter aggressiveness.** Current filter is conservative (strips numbers + personas + collapses to one sentence). Tradeoff: tight filter = sparse reveals → "is the joker even doing anything?" perception. Looser filter = richer reveals but info-security risk. **Recommendation:** ship conservative; loosen only after user-testing shows under-reveal. Filter is a pure function — easy to tune without spec changes.

---

## 12. Seed prompt for Kiro (canonical form, paste-ready)

Per `reference_kiro_spec_workflow.md` canonical template. Paste into Kiro Spec mode to generate `requirements.md` + `tasks.md`.

```
Generate requirements.md and tasks.md for the `probe-phase` spec.

Canonical sources already in repo:

- `.kiro/specs/probe-phase/design.md` — authoritative Stage Whisper mechanic, ProbeRequest LOCKED contract, 3-lane reasoning filter, 12 Vitest invariants (do NOT modify)
- `.kiro/specs/joker-system/design.md` §4 + §7.2 — ProbeRequest shape LOCKED byte-for-byte with this spec (orchestrator reconciliation 2026-04-19); `ProbeComplete` event OWNED by joker-system and CONSUMED here
- `.kiro/specs/ai-opponent/design.md` §2 — `AiDecision.llmReasoning?: string` is populated ONLY on LLM-success path (undefined on fallback paths); §11 Q6 proposes the optional `heuristicLayer` extension this spec requests
- `.kiro/specs/game-engine/design.md` §1.1 — probe is a PSEUDO-state (not persisted); §2 type contracts
- `.kiro/specs/ui-gameplay/design.md` §3.3 — phase-gate extension (`probe-reveal` kebab-case); overlay component owned by ui-gameplay Day-5
- `.kiro/steering/llm-prompt-conventions.md` — filter must NEVER mutate the LLM prompt (pure post-hoc transformation of stored `llmReasoning`)
- `.kiro/steering/product.md` — "Session-Jokers" Stage Whisper one-liner
- `.kiro/steering/structure.md` / tech.md — file paths + stack conventions
- Pre-land commit `29f6a34` on main adds to `src/lib/game/types.ts`: `Round.activeProbe?: ActiveProbe` (10-field LOCKED shape incl. `rawLlmReasoning`), `ClientRound.currentProbe?: RevealedProbe` (5-field client projection), `ProbeFilterSource = 'llm-heuristic-layer' | 'regex-scrub' | 'fallback-static'`, plus `GameEvent` variants `ProbeStart { probe, now }`, `ProbeExpired { whisperId, now }` (owned here) + `ProbeComplete` (consumed, owned by joker-system). Also pre-landed: stub reducer case-branches throwing "pending probe-phase worktree"; runtime strip of `activeProbe` from `toClientRound` in `toClientView.ts`. Tasks MUST import/extend, NOT re-declare.

requirements.md — EARS format. Derive acceptance criteria from design.md §3 (architecture + new API route justification), §4 (data model), §5 (reasoning filter — 3 lanes + information-security rules), §6 (lifecycle + timing), §7 (integration points), §8 (error handling), §9 (invariants I1-I12). Aim ~18-25 criteria. Every design.md invariant (I1-I12) must map to at least one numbered requirement. Locked items that must NOT appear as pending:

- **Probe is a pseudo-state** per game-engine §1.1 — NO `Round.status: 'probing'` value; phase-gate derivation is `round.activeProbe !== undefined` (kebab-case phase name `'probe-reveal'`)
- **`Round.activeProbe?: ActiveProbe`** is the ONLY persisted addition (pre-landed)
- **ProbeRequest shape LOCKED**: `{ whisperId, targetAiId: 'ai', roundIdx, triggeredAtTurn, now, mathProb? }` — byte-for-byte aligned with joker-system §7.2
- **`ProbeComplete` is OWNED by joker-system** (§7.1.1); probe-phase only CONSUMES it in the reveal-completion reducer slice. Probe-phase OWNS `ProbeStart` + `ProbeExpired`.
- **Filter invariants**: output is non-empty, ≤120 chars, scrubbed of digits (`[0-9%]`) and canonical persona literals (`Novice|Reader|Misdirector|Silent`) across ALL 3 lanes (including the heuristic-layer lane)
- **`rawLlmReasoning` NEVER crosses the wire** — `toClientView` runtime-strips it before projecting `Round.activeProbe → ClientRound.currentProbe` (pre-landed strip already in place)
- **Filter is pure** — no I/O, no `Math.random()`, no `Date.now()`; all time + randomness injected via events (game-engine §3.2)
- **NO mutation of the AI's LLM prompt** — filter runs post-hoc on stored `llmReasoning`, never during LLM call
- **Fallback path** (`llmReasoning === undefined` on AI deterministic-fallback branches) degrades to `fallback-static` lane cleanly

§11 open questions Q1-Q4, Q7 (architectural) + Q5 (joker-system reconciliation — RESOLVED 2026-04-19, annotate as such) + Q6 (ai-opponent `heuristicLayer` extension — STILL PENDING) + Q8 (display-name table future addition) MUST appear under `## Design questions for Scott` at bottom — do NOT resolve unilaterally, but annotate Q5 as RESOLVED.

tasks.md — 10-14 granular tasks, tests-first where feasible. Each task:

- Links to specific requirement numbers via `_Requirements: X.Y, X.Z_`
- Names exact files (per design.md §10 file layout — `src/lib/probe/{types.ts (extend pre-landed), filter.ts, filter.test.ts, reveal.ts, reveal.test.ts}` + `src/app/api/game/probe/route.ts` + `src/app/api/game/probe/route.test.ts`; reducer additions land INLINE in `src/lib/game/fsm.ts`)
- Ordered by dependency: **Task 0 Reconciliation (blocking)** — confirm ProbeRequest shape matches joker-system §7.2 (pre-landed byte-aligned; annotate), confirm ai-opponent §11 Q6 `heuristicLayer` status, escalate any mismatch to Scott → `probe/types.ts` (extend pre-landed `ActiveProbe` / `RevealedProbe` usage, add `ProbeRequest` + `ProbeResponse` + `ProbeFilter` signature types) → `filter.ts` (3 lanes: llm-heuristic-layer → regex-scrub → fallback-static; all 7 information-security invariants) + test → `reveal.ts` (`buildActiveProbe` helper + phase helpers) + test → `fsm.ts` reducer additions (`ProbeStart` sets `activeProbe`; `ProbeComplete` + `ProbeExpired` clear `activeProbe`; NO `round.status` mutation anywhere) → extend `toClientView.ts` (populate `ClientRound.currentProbe` from filtered `Round.activeProbe`; verify `rawLlmReasoning` strip already works) → `POST /api/game/probe` route + test → integration + full-suite vitest
- Checkpoints every 3-4 tasks for `pnpm vitest run`
- Optional-but-skippable tasks marked with `*` (truly-nice-to-haves only)
- Do NOT modify `src/lib/game/types.ts` field declarations — they're pre-landed in commit `29f6a34`; this spec populates them at runtime
- Do NOT touch `src/lib/ai/` unless Q6 `heuristicLayer` extension is approved (escalate first)

Do NOT write implementation code. Do NOT modify design.md. If design.md seems wrong or contradictory, flag at bottom of requirements.md under `## Design questions for Claude Code`.

Output both files in `.kiro/specs/probe-phase/`.
```

---

## 13. Architecture consistency note

This design.md is a parallel-draft v1. It makes three specific assumptions that need reconciliation:

1. **joker-system emits `ProbeRequest` shape in §4** (§11 Q5). Most likely divergence: field names.
2. **ai-opponent extends `LLMJudgmentOutput` with `heuristicLayer`** (§11 Q6). Recommended; fallback filter lanes work without it.
3. **game-engine accepts additive `Round.activeProbe?` field + 2 new events (`ProbeStart`, `ProbeExpired`)** (§7.1). `ProbeComplete` is owned by joker-system. No new `Round.status` value is added — probe is a pseudo-state derived from `activeProbe` presence. Additive-only; should be uncontroversial.

If any of these reconciliations fail, the filter + API-route layer is still independently useful (could be driven by a future spec). The novel contribution — the §5 filter with its information-security rules — is the core of this spec and is *not* coupled to the assumptions above.

If reconciliation reveals a cleaner joint than this v1 proposes (e.g. joker-system wants to own ActiveProbe, or ai-opponent wants to emit heuristicLayer as part of a larger structured-reasoning refactor), flag it — do not silently align. v1 is explicitly a starting point, not a contract.
