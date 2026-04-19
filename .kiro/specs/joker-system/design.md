---
inclusion: fileMatch
fileMatchPattern: "src/lib/jokers/**/*.ts|src/components/game/Jokers/**/*.tsx"
---

# joker-system — Design

## Provenance

Authored by Claude Code on 2026-04-19 as the TypeScript-level codification of the Balatro-inspired joker meta-system described in `.kiro/steering/product.md` "Session-Jokers (5 in MVP)" + `ARCHITECTURE-DRAFT.md` §1.1 (run / modifier structure) + Day-4 ui-gameplay retro (§10.2 Cold Read gating lock, §10.6 joker_offer flow deferral). Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via seeded prompt (see §12). Tasks will be executed by Claude Code with Sonnet 4.6 implementation subagents + Opus 4.7 review subagent per the established spec-driven flow.

Iter-1 review (2026-04-19) applied: 10 findings fixed (4 critical, 6 high) + Earful mechanic pivoted to preset-reveal (Option A, per user decision 2026-04-19) replacing the TTS-length extension draft. ProbeRequest shape reconciled with probe-phase §4 per orchestrator decision.

Iter-2 review (2026-04-19) found 1 PARTIAL (I3 regression) + 2 doc-hygiene; iter-3 fixes applied same day. ProbeRequest byte-for-byte aligned with probe-phase §4.

This is a **cross-cutting spec.** It does not own a single isolated subsystem; it extends the locked `game-engine` FSM (new events + new sub-states), extends the `ai-opponent` brain's context (new inputs the LLM/fallback may consult), and creates the hand-off surface consumed by `probe-phase` (Stage Whisper). The most important section is §7.1 — it enumerates every proposed shared-state addition so the orchestrator can serialize worktree merges.

**Scope of this spec:**
- 5 joker definitions (name, flavor, trigger, effect, duration, cost, visibility)
- Joker data types (`Joker`, `JokerSlot`, `JokerEffect`, `JokerDrawPile`, `ProbeRequest`)
- Draw-pile + offer mechanics (between-round 1-of-3 offer)
- Active vs held slot semantics + cap
- Consume / expire lifecycle across round + session scope
- FSM additions — new events, new sub-states, new Session/Round/Player fields
- Cross-spec handoffs — probe-phase (Stage Whisper), ai-opponent (Cold Read / Poker Face reads), ui-gameplay (UI phase gate extension)
- Testing invariants for joker activation, consumption, cap enforcement, and scope expiry

**NOT in this spec** (owned elsewhere):
- Stage Whisper LLM probe flow + probe TTS orchestration → `probe-phase` spec (consumes `ProbeRequest` defined here)
- Strike counter rendering + caught-lie screen-shake → `ui-gameplay` § elimination-beat + Day-5 UI juice
- Joker UI rendering (slot component, tooltip, between-round picker modal) → `ui-gameplay` Day-5 phase (this spec owns the data contract + phase gate, `ui-gameplay` Day-5 owns the presentation)
- AI persona-specific weighting of `opponentJokers` awareness (whether `Misdirector` reacts differently than `Reader` when opponent holds Cold Read) → `ai-personas` spec Day-5
- Deterministic offer-randomization details (weighted vs uniform, duplicates allowed?) — §6.4 picks uniform-without-replacement as the v1 default; revisit post-hackathon
- Visual accent mapping to portrait shots — §5 defines an accent-color column; the actual CSS tokens live in `ui-gameplay` `game-theme.css`

## Canonical sources

Read in this order when extending or auditing this spec:

1. `.kiro/steering/product.md` "Session-Jokers (5 in MVP)" — canonical one-line descriptions. Any flavor change must update both this file and the steering file in the same commit.
2. `.kiro/specs/game-engine/design.md` §1.1 (states incl. `joker_offer`), §1.3 (transition table), §1.4 rule 9 (inter-round reshuffle + `JokerPicked`), §2 (types: `JokerType`, `Round.activeJokerEffects`, `PlayerState.jokers`), §3.4 (`applyJokerEffect` / `expireJokerEffects` helpers already shipped).
3. `.kiro/specs/ai-opponent/design.md` §2 (`DecisionContext.myJokers` / `opponentJokers` already plumbed), §3-5 (Cold Read touches fallback weights; Poker Face suppresses `voiceMeta.lieScore` input).
4. `.kiro/specs/ui-gameplay/design.md` §3.3 phase-gate table (must extend for `joker_offer` phase), §10.2 (Cold Read gating LOCKED 2026-04-19).
5. `.kiro/steering/structure.md` — proposed `src/lib/jokers/` subtree justified in §10.
6. `src/lib/game/types.ts` + `src/lib/game/fsm.ts` — existing `JokerType` union, `ActiveJokerEffect`, `applyJokerEffect`, `expireJokerEffects` helpers. §7.1 of this design extends these.

---

## 1. Overview

### 1.1 Purpose

Jokers are the **Balatro run-modifier layer** of Hearsay. They give the winner of each round a meaningful choice between three random jokers, which persist across the session and bend core mechanics (voice reads, AI decisioning, strike accounting, probing).

Mechanically, a joker is a **typed effect descriptor** held in a player-owned slot, activated at a specific trigger moment, applied via a dedicated effect handler, then consumed or expired per its duration class. Jokers do NOT mutate the FSM reducer's core transition rules — they mutate the **context** passed into those transitions (AI input weighting, voice-lie visibility, strike cancellation, probe insertion).

### 1.2 Design goals

- **Additive, not invasive.** Core FSM transitions stay rule-for-rule identical; jokers hook via well-defined data on `Round.activeJokerEffects` and new `PlayerState.jokerSlots`.
- **Server-authoritative.** Joker pile + opponent's jokers visible to opponent (public info — you saw them pick it), but the *timing* of activation is private until activated. Matches the UI fairness model in `ui-gameplay` spec.
- **Deterministic under test.** All randomness (which 3 jokers to offer, which card Stage Whisper reveals) is injected via caller-provided event payloads — just like `RoundDeal` in game-engine §1.4 rule 9.
- **Cross-spec interfaces are typed.** Stage Whisper produces a `ProbeRequest` with stable shape so `probe-phase` can be built in parallel without blocking.

### 1.3 In-scope / out-of-scope

In: 5 joker definitions, data types, lifecycle machine, FSM event additions, Stage Whisper handoff interface, offer-pile mechanics, invariants.

Out: UI rendering of joker icons/modals (ui-gameplay Day-5), LLM prompt fragments that describe jokers to the model (ai-opponent Day-5 tuning), mirror/persistence of joker picks to `localStorage` (ephemeral per session by design).

---

## 2. Key concepts

| Concept | Meaning |
|---|---|
| **Joker** | A typed effect descriptor with flavor + trigger metadata. Static definitions live in `catalog.ts`. One of the 5 `JokerType` literals already in `game/types.ts`. |
| **JokerSlot** | A player-owned container holding at most one joker. Player has 3 slots (§6.1); AI also has 3 (symmetric, though v1 AI has no decision logic for usage — see §11 Q3). |
| **Held joker** | In a slot, dormant. Not yet activated. Visible to opponent (they saw you pick it after round N). |
| **Active joker effect** | In `Round.activeJokerEffects`, currently influencing the pipeline. Lives on the Round (not Player) because most effects are single-round scope. |
| **Trigger moment** | The FSM state (or transition edge) at which a joker *can* be activated. E.g., Poker Face = `claim_phase` while active player is self; Cold Read = `response_phase` when opponent just claimed. |
| **Draw pile** | Session-scoped deck of remaining unoffered jokers. Starts with 5× base jokers × 3 copies each (15 total — v1 uniform-uniform); shrinks by 3 after each offer (`JokerPicked` also discards the 2 un-picked). |
| **Discard pile** | Consumed + unpicked jokers, tracked on `Session.discardedJokers` for autopsy / debug MCP inspection. |
| **Duration class** | How long an effect lives once activated: `next_claim` / `next_challenge` / `session` / `one_shot_on_use`. |
| **Scope** | Whether the effect modifies a Round-level pipeline (most) or the Session-level strike counter (Second Wind only). |
| **Hand-off interface** | The typed payload one spec produces for another to consume. `ProbeRequest` is joker-system → probe-phase. |

---

## 3. Architecture

### 3.1 Lifecycle state machine — is it a separate FSM or FSM sub-states?

**Decision:** Sub-states of the main FSM, NOT a separate machine.

**Rationale:**
- The `joker_offer` state already exists in game-engine §1.1 as a `Session.status` value. This spec extends it with internal phases (`offered → picking → picked`) but does not elevate it to a parallel machine.
- Joker *activation* during `claim_phase` / `response_phase` is purely a data mutation on `Round.activeJokerEffects` — no new state node needed. The `game-engine` already ships `applyJokerEffect` + `expireJokerEffects` helpers that we consume.
- The only new sub-state is `joker_applying` — a brief transient inside `response_phase` or `claim_phase` when a joker is activated. It's modeled as a Round-level flag (`Round.pendingJokerActivation`) for non-probe async effects, not a full Session.status value, to avoid cascading changes to `ClientSession.status` wire format. Stage Whisper's async in-flight state is owned by `Round.activeProbe` (probe-phase §4.1), not `pendingJokerActivation`.

**Alternative considered:** Parallel joker FSM with independent lifecycle. Rejected — forces a second reducer, duplicates event plumbing, and breaks the "one reducer, one truth" invariant in `structure.md`.

### 3.2 Where each joker lives

```
catalog.ts              (static)        5 Joker descriptors — name, flavor, trigger, duration, cost, visibility
            │
            ▼
offer.ts                (pure)          offerJokers(winner, drawPile) → { offered[3], newDrawPile }
            │
            ▼
lifecycle.ts            (pure)          acceptJoker → slots; useJoker → activeJokerEffects; expireJoker → drop
            │
            ▼
effects.ts              (pure)          applyPokerFace / applyColdRead / applySecondWind (context mutators)
            │                           produceProbeRequest (Stage Whisper handoff)
            ▼
fsm.ts extensions       (caller plugs)  DrawJoker / UseJoker / JokerExpired handlers; calls lifecycle helpers
```

### 3.3 Activation flow (example — Cold Read during opponent's claim)

```
round_active / response_phase
           │
           │  (player UI) user clicks Cold Read in joker slot row
           ▼
UseJoker { jokerType: 'cold_read', by: 'player', roundId }
           │
           │  reducer: validate (player holds cold_read, trigger matches response_phase + opponent-just-claimed)
           ▼
Round.activeJokerEffects.push({ type: 'cold_read', expiresAfter: 'next_challenge' })
Player.jokerSlots.find(cold_read).state = 'consumed'
           │
           ▼
response_phase (unchanged status — player still picks Accept / Liar!)
           │
           │  ui-gameplay: now that 'cold_read' is in activeJokerEffects,
           │               <LieScoreMini/> renders with opponent's voiceMeta.lieScore
           ▼
ChallengeCalled OR ClaimAccepted → expireJokerEffects(round, 'next_challenge')
           │
           ▼
'cold_read' effect removed from Round.activeJokerEffects
```

### 3.4 Server vs client visibility

| Data | Server sees | Client's own view | Client's opponent view |
|---|---|---|---|
| `Session.jokerDrawPile` | ✅ | ❌ (only the 3 currently offered are shown) | ❌ |
| `Session.discardedJokers` | ✅ | ✅ (post-round only — gated: `toClientView` projects only when `Session.status !== 'round_active'`) | ❌ during play |
| Player's `jokerSlots` (held) | ✅ | ✅ | ✅ (public — they saw the pick) |
| Player's `jokerSlots` (consumed) | ✅ | ✅ | ✅ (once activated — the effect reveals which joker it was) |
| Active joker effects on current Round | ✅ | ✅ | ✅ (visible effects are by nature visible — Cold Read reveals lie-score, Stage Whisper triggers probe, etc.) |
| Which 3 jokers are currently `offered` | ✅ | ✅ (only to the round winner — they're picking) | ❌ |
| `ClientSession.autopsy` | ✅ (server + client projection) | ✅ (projected on ChallengeWon while Earful held) | ❌ (opponent does not see the autopsy — it's the player's learning moment) |

`toClientView` needs a minor extension: strip `jokerDrawPile` entirely (it's a deck the client shouldn't see), project `jokerSlots` fully (public info), project `activeJokerEffects` fully. See §7.1 for the diff.

---

## 4. Data model

All types live in `src/lib/jokers/types.ts`. Game types (`JokerType`, `ActiveJokerEffect`, `PlayerState`) are extended in-place in `src/lib/game/types.ts` — see §7.1 for the full diff.

```ts
import type { JokerType, Rank } from '../game/types';

/** Static catalog entry — descriptive metadata. */
export interface Joker {
  type: JokerType;
  /** Display name, Title Case. */
  name: string;
  /** One-line flavor description, courtroom/dramatic tone, ≤ 80 chars. */
  flavor: string;
  /** Trigger window — FSM state(s) where this joker can be activated. */
  triggers: JokerTrigger[];
  /** Duration — how the effect expires once activated. */
  duration: JokerDuration;
  /** Cost paid on activation — none, strike penalty, reveal own card, etc. */
  cost: JokerCost;
  /** If true, activation is announced to opponent. If false, stealth. */
  visibleOnActivate: boolean;
  /** Accent color token — maps to CSS var in ui-gameplay. */
  accentVar: string;
}

export type JokerTrigger =
  | { kind: 'self_claim_phase' }             // before I speak (Poker Face activation)
  | { kind: 'pre_ai_claim' }                 // probe slot before AI's claim_phase (Stage Whisper)
  | { kind: 'opponent_claim_resolved' }      // the AI just finished speaking (Earful preset-reveal, Cold Read read window)
  | { kind: 'on_my_strike' };                // I'm about to receive a strike (Second Wind auto-consume)

export type JokerDuration =
  | 'next_claim'                              // expires when next claim is resolved (accept or challenge)
  | 'next_challenge'                          // expires when next challenge is resolved
  | 'one_shot_on_use'                         // expires immediately after the effect fires (Second Wind)
  | 'session';                                // persists until end of session (no v1 joker uses this, reserved)

export type JokerCost =
  | { kind: 'none' }
  | { kind: 'reveal_own_card'; count: 1 }     // placeholder — no v1 joker uses this, reserved for balance tuning
  | { kind: 'strike_penalty'; amount: 1 };    // placeholder — no v1 joker uses this

/** A joker in a player's slot. */
export interface JokerSlot {
  joker: JokerType;
  state: 'held' | 'consumed';
  /** Round index (0-based) at which this joker was acquired. */
  acquiredRoundIdx: number;
  /** Round index at which this joker was consumed, if applicable. */
  consumedRoundIdx?: number;
}

/** An offer presented after a round (winner picks 1 of 3). */
export interface JokerOffer {
  offered: JokerType[];         // length 3
  offeredToWinner: 'player' | 'ai';
}

/** Handoff interface — joker-system produces, probe-phase consumes.
 *  LOCKED shape — reconciled with probe-phase §4 per orchestrator
 *  reconciliation 2026-04-19. Do not alter without updating probe-phase §4. */
export interface ProbeRequest {
  /** Stable unique id generated server-side — ties request to response. */
  whisperId: string;
  /** Which AI is being probed. v1 always 'ai'; enum-shaped for future multi-AI. */
  targetAiId: 'ai';
  /** Matches Session.currentRoundIdx (0-based). */
  roundIdx: number;
  /** claimHistory.length at request time — lets probe-phase know which claim to peek at. */
  triggeredAtTurn: number;
  /** ms since epoch — determinism per game-engine §3.2. Caller-provided. */
  now: number;
  /** From AiDecision.mathProb at consumption time — feeds probe-phase filter static-fallback lane.
   *  Optional because fallback path may not have it. */
  mathProb?: number;
}
```

### 4.1 Additions to existing types (`src/lib/game/types.ts`) — see §7.1 for full proposed diff.

```ts
// Round (extended)
interface Round {
  // ... existing fields ...
  activeJokerEffects: ActiveJokerEffect[];    // EXISTING
  jokerTriggeredThisRound: JokerType[];        // NEW — audit trail (per-round); prevents "trigger twice" bugs
  pendingJokerActivation?: {                   // NEW — transient while UseJoker is mid-reduce
    joker: JokerType;
    by: 'player' | 'ai';
  };
}

// PlayerState (extended)
interface PlayerState {
  // ... existing fields ...
  jokers: JokerType[];                         // EXISTING — to be DEPRECATED in favor of jokerSlots
  jokerSlots: JokerSlot[];                     // NEW — richer than jokers[]; jokers[] kept as a derived alias during migration
}

// Session (extended)
interface Session {
  // ... existing fields ...
  jokerDrawPile: JokerType[];                  // NEW — unoffered pool, server-only
  discardedJokers: JokerType[];                // NEW — unpicked + consumed, server-only (autopsy)
  currentOffer?: JokerOffer;                   // NEW — set during joker_offer state, cleared on JokerPicked
}
```

---

## 5. Joker catalog

| Name | Flavor (≤80 chars) | Trigger | Effect | Duration | Cost | Visible on activate? | Accent |
|---|---|---|---|---|---|---|---|
| **Poker Face** | "Wear the mask. Your tell stays hidden one claim." | `self_claim_phase` (before I speak) | Suppresses `voiceMeta.lieScore` → AI sees a neutral `0.5` for this claim only. Deterministic multiplier: `lieScore = 0.5` (not scaled, overwritten). | `next_claim` | `none` | ✅ announced — opponent sees "Mask raised" badge (fair-info) | `--joker-poker-face: #c9bfa3` (bone-dim) |
| **Stage Whisper** | "Slip a question past the bench before they speak." | `pre_ai_claim` (AI is about to make a claim) | Produces a `ProbeRequest` that enters `probe_phase` sub-state. Consumed by `probe-phase` spec — AI answers a free-form probe with full voice tells active (see §7.2). | `one_shot_on_use` | `none` | ✅ announced — the probe is observable to both (turn log shows it happened) | `--joker-stage-whisper: #55c6fd` (cyan) |
| **Earful** | "Make them monologue. Every word an exhibit." | `opponent_claim_resolved` (AI just claimed, before my Accept / Liar!) | On a challenge WON by the player while Earful is held, projects the AI's `VoiceTellPreset` used for that turn's claim into `ClientSession.autopsy`. Teaches the voice-tell taxonomy over time. Autopsy is revealed via an overlay component (owned by ui-gameplay Day-5 polish). Cleared on next `ChallengeCalled` or `RoundReset`. | `one_shot_on_use` | `none` | ✅ announced — "Voice tell exposed" flash on challenge win | `--joker-earful: #fda200` (amber) |
| **Cold Read** | "The court rules on evidence, not rhetoric." | `opponent_claim_resolved` (AI just claimed, before my Accept / Liar!) | Unlocks the lie-score UI (`<LieScoreMini/>` becomes visible) showing the `voiceMeta.lieScore` for the AI's claim. Per ui-gameplay §10.2 LOCK. Does NOT alter AI decisioning; this is a player-side read. | `next_challenge` | `none` | ✅ announced — the mini bar is visible, opponent can see we're reading | `--joker-cold-read: #e8e8e8` (bone) |
| **Second Wind** | "One cancelled verdict. Rise and continue." | `on_my_strike` (auto-fires inside `RevealComplete` reducer when player would take a strike) | **AUTO-CONSUMES** — no separate `UseJoker` event required. When the `RevealComplete` reducer would increment the player's strike, it checks first: if `second_wind` is held, consume it and cancel the strike. Does NOT restore prior strikes (no over-heal). Cap enforced: if `strikes` is already 0, joker is inert and stays held (no strike to cancel). Player has no timing agency — simplified for hackathon scope; see §11 Q12. | `one_shot_on_use` | `none` | ✅ announced — "Verdict overturned" flash | `--joker-second-wind: #fd5f55` (coral) |

**Naming + flavor lock:** These flavor strings are the canonical ones for v1. Changes require a PR touching both this file and `steering/product.md` in the same commit (consistency invariant; see review checklist in §8).

**Visibility rationale:** All v1 jokers are `visibleOnActivate: true`. Stealth activation was considered and rejected for v1 because:
- The AI's LLM orchestrator already receives `opponentJokers` in its `DecisionContext` — it knows what the player *could* do, so hiding *when* they did it gives a minor information edge that's hard to balance.
- Courtroom narrative favors overt "Objection sustained" moments over rogue-like stealth plays.
- Post-hackathon balance pass may introduce stealth variants; reserved space in `cost` + new `JokerCost` variant. See §11.

---

## 6. Lifecycle

### 6.1 Slot cap

Each player has **3 joker slots maximum**. On a best-of-3 session, the winner picks a joker between rounds 1→2 and 2→3, so the max a player can realistically accumulate is **2 jokers** in a single session (if they win both joker-offer windows). The 3-slot cap is permissive padding — no joker is ever *discarded* for slot-overflow reasons in v1 gameplay (since 2 < 3). Cap is enforced to guard against future changes (e.g., longer sessions, shop mechanic).

If a player attempts to `AcceptJoker` when all 3 slots hold `state: 'held'` jokers, the FSM throws `InvalidTransitionError('joker_offer(slot_cap_exceeded)', 'JokerPicked')`. Caller (UI) must prevent this state by disabling pick UI when cap is reached. Since v1 cap is never hit, this is defensive.

### 6.2 Draw-pile + offer mechanics

**Initialization:** On `SetupComplete`, `Session.jokerDrawPile` seeded with all 5 base `JokerType`s × 3 copies = **15 jokers**. Caller-provided via event payload (keeps FSM pure). v1 uniform distribution; post-hackathon balancing may weight.

**Offer:** When a round ends and `Session.status` transitions to `joker_offer`, caller fires a new event `JokerOffered { offered: [JokerType, JokerType, JokerType], newDrawPile: JokerType[] }` — the caller picks 3 uniformly-without-replacement **over DISTINCT TYPES still present in the pile** (deduplicating before selection so the player never sees two of the same joker type in one offer) and provides the reduced `newDrawPile`. Reducer validates offered length ≤ 3 and sets `Session.currentOffer`.

**Offer-draw deduplication pseudocode (caller-side, per §7.1.8 `pickOffer` helper):**
```ts
// distinct types still in pile (order-stable shuffle happens after)
const distinct = [...new Set(drawPile)];
const offered = shuffle(distinct, rng).slice(0, Math.min(3, distinct.length));
// newDrawPile removes all copies of the OFFERED types (not just 3 cards)
// then also removes the 2 un-picked types on JokerPicked (§6.5)
```
The underlying pile still contains 3 copies × 5 types = 15 jokers (v1 uniform). Deduplication ensures an offer of 3 always presents 3 DIFFERENT joker types.

**Pick:** `JokerPicked` event (already existing, extended per §7.1) carries the chosen joker + `nextRoundDeal` as before. Additionally, reducer now pushes the 2 un-picked offered jokers into `Session.discardedJokers`.

**Exhaustion:** If `jokerDrawPile.length < 3` at offer time, the offer shrinks to whatever remains. If 0 remain, the `JokerOffered` event is skipped entirely and `joker_offer` transitions directly to the next round via `JokerOfferSkippedSessionOver` (re-purposed semantics — see §7.1 note on event rename) OR a new `JokerOfferEmpty` event. **Decision:** new event `JokerOfferEmpty` — cleaner than overloading existing event. See §7.1.

### 6.3 Consume vs expire

| Duration | Behavior |
|---|---|
| `next_claim` | Pushed to `Round.activeJokerEffects` on `UseJoker`. Removed on next `ChallengeCalled` OR `ClaimAccepted` (whichever comes first **post-AI-judgment**) via `expireJokerEffects(round, 'next_claim')`. **Important:** expiry fires AFTER the AI has read `DecisionContext`, not before — ensures the AI sees the masked/modified context before the mask lifts. |
| `next_challenge` | Pushed to `Round.activeJokerEffects`. Removed on next `ChallengeCalled` or `ClaimAccepted` via `expireJokerEffects(round, 'next_challenge')`. |
| `one_shot_on_use` | Pushed, handler fires, removed in same reducer tick. Never observed in `activeJokerEffects` at tick boundary. |
| `session` | Reserved. Not used by any v1 joker. Would persist on `Session.player.jokerSlots` with a separate `session` sub-state. |

### 6.4 Persist vs expire at round boundary

On `JokerPicked` (inter-round reshuffle per game-engine §1.4 rule 9):
- `Round.activeJokerEffects` is cleared (new Round starts fresh) — already the case since the new Round is created from scratch.
- `Player.jokerSlots[state='held']` entries PERSIST across rounds.
- `Player.jokerSlots[state='consumed']` entries PERSIST as audit trail (don't delete — needed for autopsy).

On `session_over`:
- All slots frozen for session-end autopsy panel.

### 6.5 `joker_offer` phase internal mechanics

```
RoundSettled (§1.3 row 7 — existing game-engine event)
        │
        ▼
Session.status = 'joker_offer', Session.currentOffer = undefined
        │
        ▼ caller fires JokerOffered { offered[3], newDrawPile }   (NEW event)
        │
        ▼
Session.currentOffer = { offered[3], offeredToWinner: round.winner }
Session.jokerDrawPile = newDrawPile
        │
        │  (UI: winner picks)
        ▼
JokerPicked { joker, nextRoundDeal }   (EXISTING event, semantics extended)
        │
        ▼
Winner.jokerSlots.push({ joker, state: 'held', acquiredRoundIdx })
Session.discardedJokers.push(...Session.currentOffer.offered.filter(j => j !== joker))
Session.currentOffer = undefined
... rest of existing JokerPicked logic (reshuffle + new round) unchanged ...
```

Edge case: `jokerDrawPile` empty at `RoundSettled` → caller fires `JokerOfferEmpty` instead of `JokerOffered`; reducer transitions directly to next round without setting `currentOffer`. Winner's slots unchanged.

---

## 7. Integration points

### 7.1 Shared-state additions (CRITICAL — orchestrator uses this to serialize worktree merges)

This section enumerates **every** proposed addition to files outside `src/lib/jokers/`. No other spec modifies these fields; joker-system owns the full diff below.

#### 7.1.1 New FSM events (in `src/lib/game/types.ts` `GameEvent` union)

```ts
// NEW — fired by caller after RoundSettled puts session into joker_offer,
//       and drawPile has ≥1 joker remaining. Caller picks 3 uniformly
//       without replacement and provides the reduced pile.
| { type: 'JokerOffered';
    offered: JokerType[];           // length 1..3 (shrinks on pile exhaustion tail)
    newDrawPile: JokerType[];
    now: number }

// NEW — fired by caller when drawPile is empty at offer time.
//       Reducer transitions directly to next round (via caller-provided nextRoundDeal).
| { type: 'JokerOfferEmpty';
    nextRoundDeal: RoundDeal;
    now: number }

// NEW — fired by caller (API route) when player clicks to activate a held joker.
//       Reducer validates trigger + consumes + pushes to activeJokerEffects.
| { type: 'UseJoker';
    joker: JokerType;
    by: 'player' | 'ai';
    now: number }

// NEW — fired by caller to mark Stage Whisper's probe as complete.
//       probe-phase spec fires this after its LLM probe response returns.
//       Reducer clears any pending probe state and proceeds to the AI's claim_phase.
| { type: 'ProbeComplete';
    whisperId: string;
    now: number }

// The following two events are OWNED BY probe-phase spec §7.1 (listed here
// for completeness of the GameEvent union — do not re-declare in probe-phase):
// | { type: 'ProbeStart'; probe: ActiveProbe; now: number }
// | { type: 'ProbeExpired'; whisperId: string; now: number }
```

The existing event `JokerPicked` stays but its reducer gains: "push 2 un-picked offers to `discardedJokers`, clear `currentOffer`, push picked joker to `jokerSlots` not just `jokers[]`".

The existing event `JokerOfferSkippedSessionOver` retains its meaning (session is over — skip offer entirely). It is DISTINCT from new `JokerOfferEmpty` (pile empty — no offer, but session continues).

#### 7.1.2 New FSM sub-states / internal flags

- **`Round.pendingJokerActivation?: { joker: JokerType; by: 'player'|'ai' }`** — transient, used ONLY for non-probe async effects (e.g., Second Wind auto-consume timing). **Stage Whisper does NOT use `pendingJokerActivation`.** For Stage Whisper, the in-flight probe state is owned by probe-phase's `Round.activeProbe?: ActiveProbe` (see probe-phase §4.1). Cleared by the effect handler in the same tick for synchronous effects. `pendingJokerActivation` is retained as a general slot for future async effects that don't involve probe-phase.
- **`Session.status` values unchanged.** (`joker_offer` already exists.)
- **NO new `Round.status` values.** Joker activation happens *within* `claim_phase` or `response_phase`; the Round status does not change.
- **Pseudo-state `probe_phase`** (already documented in game-engine §1.1 as a pseudo-state) is formalized: entered iff `Round.activeJokerEffects` contains `{type:'stage_whisper'}` AND upcoming claimant is AI. Probe-phase spec owns the handler. **Per orchestrator reconciliation 2026-04-19, probe-phase spec aligns with game-engine §1.1 — no `Round.status: 'probing'` value is introduced anywhere.** The "pseudo-state, NO new Round.status values" invariant stated in §3.1 is correct and closed.

#### 7.1.3 New Session fields (in `src/lib/game/types.ts` `Session`)

```ts
interface Session {
  // ... existing ...
  jokerDrawPile: JokerType[];         // NEW — seeded by SetupComplete via caller-provided payload
  discardedJokers: JokerType[];       // NEW — accumulated over session
  currentOffer?: JokerOffer;          // NEW — set during joker_offer, cleared on JokerPicked / JokerOfferEmpty
}
```

Extension to `SetupComplete` event: `{ ..., initialJokerDrawPile?: JokerType[] }` — **optional**, caller provides when they want to seed a specific pile (e.g., in tests). When absent, the reducer default-seeds via a new `seedDrawPile(): JokerType[]` helper (returns 5 × 3 = 15 jokers, one copy per JokerType × 3). This keeps existing tests constructing `SetupComplete` events valid without modification. When caller-provided, length must be exactly 15 (5 types × 3 copies) for v1; reducer validates.

**`seedDrawPile()` helper** — defined in `src/lib/jokers/lifecycle.ts` (§10). Signature: `export function seedDrawPile(): JokerType[]`. Returns a stable, ordered array of 15 jokers (3× each type in canonical order: `poker_face`, `stage_whisper`, `earful`, `cold_read`, `second_wind`). Shuffling is caller-side responsibility.

#### 7.1.4 New Round fields

```ts
interface Round {
  // ... existing ...
  jokerTriggeredThisRound: JokerType[];    // NEW — append-only per round; prevents double-use within a round
  pendingJokerActivation?: {                // NEW (see 7.1.2)
    joker: JokerType;
    by: 'player' | 'ai';
  };
}
```

#### 7.1.5 New Player fields

```ts
interface PlayerState {
  // ... existing ...
  jokers: JokerType[];                     // EXISTING — kept for backwards-compat during migration; becomes a derived alias
  jokerSlots: JokerSlot[];                 // NEW — authoritative storage, richer than jokers[]
}
```

Migration: reducer populates BOTH `jokers[]` (as a flat list of `.joker` for each slot) and `jokerSlots[]` on `JokerPicked`. Once all consumers migrate to read `jokerSlots`, the `jokers[]` field can be removed in a follow-up refactor. The `ai-opponent` `DecisionContext.myJokers` / `opponentJokers` currently reads `jokers[]` — no change needed for v1.

#### 7.1.6 New types in `src/lib/game/types.ts`

```ts
// Imports for cross-file reference (actual type bodies live in src/lib/jokers/types.ts)
import type { JokerSlot, JokerOffer } from '../jokers/types';
export type { JokerSlot, JokerOffer };
```

Alternatively, move `JokerSlot` / `JokerOffer` definitions directly into `game/types.ts` and have `jokers/types.ts` import them. Recommendation: **keep them in `jokers/types.ts`** and re-export here, since they're joker-domain concepts. Tests must assert both modules export the same types (drift check).

#### 7.1.7 New enums / literal unions

None beyond what `JokerTrigger` / `JokerDuration` / `JokerCost` already express (new types in §4). The existing `JokerType` union (`poker_face | stage_whisper | earful | cold_read | second_wind`) is unchanged.

**New types for Earful autopsy (verified not present in shipped `types.ts` as of 2026-04-19):**

```ts
// src/lib/game/types.ts (or re-exported from jokers/types.ts)

/** Which voice-tell preset the AI used for a given claim's TTS synthesis.
 *  Source-of-truth definition lives in voice-tell-taxonomy spec.
 *  Until that spec exports a canonical union, use a string alias. */
export type VoiceTellPreset = string; // TODO: narrow to canonical union in voice-tell-taxonomy Day-5

// Added to Claim interface (additive, not breaking):
// voicePreset?: VoiceTellPreset;  — populated by TTS layer on AI claims; undefined for player claims + fallback paths

// Added to ClientSession interface:
// autopsy?: { preset: VoiceTellPreset; roundIdx: number; turnIdx: number }
//   — projected ONLY on RevealComplete(challengeWasCorrect: true) when earful is held by player
//   — cleared on RoundReset / ChallengeCalled
```

**No `PromptModifier` union. No `EXTENDED_TEMPLATES`. No `OwnPlayContext.promptModifiers`.** These are fully removed from the spec — the Earful pivot eliminates all `ai-opponent` internal changes.

#### 7.1.8 New helpers in `src/lib/game/fsm.ts`

The existing `applyJokerEffect` and `expireJokerEffects` helpers (see `fsm.ts` lines 73-103) are extended:
- `applyJokerEffect(round, joker)` — current signature uses hardcoded `expiresAfter: 'next_claim'`. Needs to accept an `expiresAfter` override OR dispatch by joker type using `JOKER_CATALOG[joker].duration`.
- `expireJokerEffects(round, trigger)` — unchanged.

New helpers added in `src/lib/jokers/lifecycle.ts` (not in game/fsm.ts):
- `seedDrawPile(): JokerType[]` — returns initial 15-joker pile (5 × 3).
- `pickOffer(drawPile: JokerType[], rng: () => number): { offered: JokerType[], remaining: JokerType[] }` — caller uses this when building the `JokerOffered` event payload.
- `produceProbeRequest(round: Round, whisperIdGen: () => string, now: number): ProbeRequest` — used by API route when Stage Whisper fires.

#### 7.1.9 toClientView projection extension

`src/lib/game/toClientView.ts` must be extended to:
- Strip `Session.jokerDrawPile` (server-only).
- **Conditionally project `Session.discardedJokers`:** include in client view ONLY when `Session.status !== 'round_active'` (i.e., post-round: `joker_offer`, `session_over`). During active play, strip it — the discarded pile is not public information mid-round. This resolves the internal contradiction between §7.1.9 ("public") and §3.4 ("❌ during play").
- Preserve `Session.currentOffer` BUT only when viewer === currentOffer.offeredToWinner — strip otherwise (the loser does not see the 3 offered to the winner until picked).
- Project `jokerSlots` fully in both `self` and `opponent` views (public info).
- Project `ClientSession.autopsy` only on the player's own view (not opponent's).

Concrete diff captured as invariant I12 in §9.

#### 7.1.10 Summary matrix (orchestrator serialization hint)

| Shared file | Change category | Blocks probe-phase? | Blocks ui-gameplay Day-5? |
|---|---|---|---|
| `src/lib/game/types.ts` | Session/Round/Player field additions; new events | Yes (needs `ProbeComplete`, `UseJoker`) | Yes (needs `jokerSlots`, `currentOffer`) |
| `src/lib/game/fsm.ts` | New event handlers; existing `applyJokerEffect` signature change | Yes (probe handoff via `UseJoker`) | No (UI reads state, does not reduce) |
| `src/lib/game/toClientView.ts` | Strip jokerDrawPile; conditional currentOffer | No | Yes (UI reads from client projection) |
| `src/lib/ai/types.ts` | No change | No | No |

**Merge order recommendation:** `game-engine` field additions (7.1.3-7.1.7) → joker-system `catalog.ts` + `types.ts` → joker-system `effects.ts` + `lifecycle.ts` → `fsm.ts` event handlers → `toClientView.ts` projection → probe-phase consumes `ProbeRequest` + `ProbeComplete` → ui-gameplay reads `jokerSlots` + renders.

### 7.2 Cross-spec interface — joker-system → probe-phase

**Handoff type:** `ProbeRequest` (defined §4).

**Produced by:** `src/lib/jokers/effects.ts` `applyStageWhisperEffect(round, whisperIdGen, now) → ProbeRequest`.

**Consumed by:** `probe-phase` spec (not yet written — drafted in parallel with this spec). Probe-phase owns:
- The LLM call for the probe response (uses a dedicated prompt template separate from `ai-opponent` judging prompts).
- The TTS synthesis with persona + truthState active (tells visible).
- Firing `ProbeComplete { whisperId, now }` back to the FSM when the probe audio finishes playing.

**Handoff contract locked (reconciled with probe-phase §4, orchestrator 2026-04-19):**
```ts
// joker-system produces:
export interface ProbeRequest {
  whisperId: string;            // uuid v4 — ties request to response
  targetAiId: 'ai';             // v1 single-opponent; enum-shaped for future multi-AI
  roundIdx: number;             // matches Session.currentRoundIdx
  triggeredAtTurn: number;      // claimHistory.length at request time
  now: number;                  // ms since epoch — determinism per game-engine §3.2
  mathProb?: number;            // optional — read from AiDecision.mathProb at consumption
}
```

`roundId` as a separate string id (original seed prompt) was dropped in favour of `roundIdx: number` (canonical `Session.currentRoundIdx`). `triggeredAtTurn` and `mathProb?` were added during probe-phase reconciliation to enable the filter's static-fallback lane without probe-phase needing to re-read `claimHistory` directly.

### 7.3 Cross-spec interface — joker-system → ui-gameplay

`ui-gameplay` §3.3 phase-gate table needs one row added:

| `GameSessionState.phase` | UI visible | Interactive |
|---|---|---|
| `joker_offer` | 3 offered cards (face-up, fanned), "Pick One" callout | click any of 3 → dispatches `PickJoker { joker }` |
| `joker_applying` | transient spinner (max 500ms) | — |

The `PickJoker` client-side event exists in `useGameSession` `GameEvent` union (ui-gameplay §3.1) as a Day-5 stub — this spec formalizes it to fire a POST `/api/turn` with `{ type: 'JokerPicked', joker, nextRoundDeal }`.

Additionally, `ui-gameplay`'s `<StrikeCounter/>` must re-render when `Session.player.strikes` decrements via Second Wind — today's impl already re-renders on prop change, so no work needed there, just documented.

### 7.4 Cross-spec interface — joker-system → ai-opponent

Two effect handlers read `ai-opponent` inputs and mutate them:

#### 7.4.1 Poker Face — suppresses `voiceMeta.lieScore`

When `Round.activeJokerEffects` contains `{type:'poker_face'}` AND the caller is building `DecisionContext` for an AI judgment of the current claim:
- Before calling `aiDecideOnClaim(ctx)`, the API route mutates `ctx.claim.voiceMeta.lieScore = 0.5` (neutral).
- The AI brain sees a neutral voice reading. Math-layer probability is unaffected (intentional — the joker only masks voice tells).
- Effect expires on `next_claim` — `applyJokerEffect(round, 'poker_face')` pushes with that duration; `expireJokerEffects` fires in the `ChallengeCalled` or `ClaimAccepted` reducer (whichever comes first **post-AI-judgment**). This ordering guarantees the AI reads `DecisionContext.claim.voiceMeta.lieScore === 0.5` BEFORE the effect is removed — the suppression is effective for the judgment it was activated to protect.

**Deterministic multiplier lock:** the suppressed value is exactly `0.5` (midpoint). Not a scaling factor, not a noise injection — a hard override. This is testable as invariant I6.

#### 7.4.2 Cold Read — reveals `voiceMeta.lieScore` to player UI

When `Round.activeJokerEffects` contains `{type:'cold_read'}`:
- `toClientView` retains `claimHistory[last].voiceMeta.lieScore` in the PublicClaim projection (normally stripped).
- `ui-gameplay`'s `<LieScoreMini/>` renders (gated per ui-gameplay §10.2 LOCK).
- Effect expires on `next_challenge` — `expireJokerEffects(round, 'next_challenge')` fires in `challengeCalled` + `claimAccepted` reducers.

**Important:** Cold Read does NOT alter AI weighting. It is a player-side read enhancement. The AI's own `DecisionContext` is unaffected. Autonomous — the player and the AI have symmetric information flow here; the joker just makes the signal visible to the player when normally it's server-only.

#### 7.4.3 Earful — preset-reveal autopsy on ChallengeWon

**Earful pivot (Option A, locked 2026-04-19):** Earful no longer extends AI TTS length. Instead, it teaches the voice-tell taxonomy through play.

**Effect:** When the player WINS a challenge (`RevealComplete { challengeWasCorrect: true }`) while `earful` is in `player.jokerSlots` with `state: 'held'`, the reducer:
1. Marks the Earful slot `state: 'consumed'`.
2. Projects `ClientSession.autopsy` with the AI's `VoiceTellPreset` for that turn's claim.

**New shared-state field:**
```ts
// Added to ClientSession (src/lib/game/types.ts)
interface ClientSession {
  // ... existing ...
  autopsy?: {
    preset: VoiceTellPreset;    // which preset the AI was using — the "tell" exposed
    roundIdx: number;
    turnIdx: number;            // claimHistory index of the exposed claim
  };
}
```

**`VoiceTellPreset`** is a new type addition to `src/lib/game/types.ts` (or `src/lib/jokers/types.ts` re-exported) — it does NOT currently exist in the shipped `types.ts` (verified 2026-04-19). It maps to the preset identifiers in the `voice-tell-taxonomy` spec. Until that spec exports it, use a placeholder `string` alias: `export type VoiceTellPreset = string;` with a TODO comment.

**`Claim.voicePreset?: VoiceTellPreset`** — this field is NOT currently present in the shipped `Claim` interface in `src/lib/game/types.ts` (verified 2026-04-19). It must be added as a minor additive change (see §7.1.1 shared-state additions). The AI's claim-path populates this when the TTS layer selects a preset; it is `undefined` for player claims and for AI fallback paths that bypass the preset system.

**Lifecycle:**
- `autopsy` is set on `RevealComplete` where `challengeWasCorrect: true` AND `earful` is held by the player.
- `autopsy` is cleared on `RoundReset` or `ChallengeCalled` (next round start / any new challenge).
- Reducer uses `one_shot_on_use` — effect fires and joker is consumed in the same tick as `RevealComplete`.

**`<AutopsyOverlay>` component** — a ui-gameplay Day-5 component that reads `ClientSession.autopsy` and renders the exposed preset card. joker-system owns only the data contract above; UI ownership: **ui-gameplay Day-5 polish slot**.

**No `PromptModifier` / `EXTENDED_TEMPLATES` / `OwnPlayContext.promptModifiers` changes.** Those proposals are fully removed. This joker makes zero changes to `ai-opponent`.

---

## 8. Error handling

| Scenario | Reducer behavior |
|---|---|
| `UseJoker` fired when player does NOT hold that joker in `jokerSlots` | Throw `InvalidTransitionError('round_active(joker_not_held)', 'UseJoker')` |
| `UseJoker` fired outside the joker's trigger window (e.g., Poker Face during `response_phase`) | Throw `InvalidTransitionError('round_active(joker_trigger_mismatch)', 'UseJoker')` |
| `UseJoker` for the same joker type fired twice in a round (attempt to stack) | Throw if `Round.jokerTriggeredThisRound.includes(joker)`. Stacking is intentionally disallowed v1. |
| Second Wind auto-consume when `strikes === 0` at `RevealComplete` (no strike to cancel) | Joker stays `held` — silent no-op. No error thrown; this is a valid (if wasteful) state. |
| `JokerPicked` with a joker NOT in `Session.currentOffer.offered` | Throw `InvalidTransitionError('joker_offer(joker_not_offered)', 'JokerPicked')` |
| `JokerPicked` when `currentOffer === undefined` (race condition — offer cleared before pick) | Throw `InvalidTransitionError('joker_offer(no_current_offer)', 'JokerPicked')` |
| `AcceptJoker` when all 3 slots hold `state: 'held'` jokers | Throw `InvalidTransitionError('joker_offer(slot_cap_exceeded)', 'JokerPicked')` — defensive; v1 slot cap > max acquirable. |
| `ProbeComplete` fired when no probe is pending | Throw `InvalidTransitionError('round_active(no_pending_probe)', 'ProbeComplete')` |
| Stage Whisper used, but probe-phase LLM times out (≥2s) | `probe-phase` spec falls back to a templated generic response and still fires `ProbeComplete`. Reducer does not see the failure. |
| Earful auto-consume fires on `RevealComplete(challengeWasCorrect: true)` but `Claim.voicePreset` is undefined (AI used fallback path) | `ClientSession.autopsy` is set with `preset: 'unknown'` (or omitted if `voicePreset` is absent). UI component `<AutopsyOverlay>` handles the `undefined` case gracefully. Reducer does not throw. |

All errors are `InvalidTransitionError` subclass throws — never silent no-ops.

---

## 9. Testing invariants (Vitest — target 10-12)

All invariants live in `src/lib/jokers/*.test.ts`, `src/lib/game/fsm.test.ts` (new cases for extended events), and `src/lib/game/toClientView.test.ts` (projection of joker fields).

**I1 — Joker cannot be used outside its trigger window.**
Given: `Round.status === 'response_phase'`, player holds `poker_face` (`self_claim_phase` trigger).
Action: fire `UseJoker { joker: 'poker_face', by: 'player' }`.
Expect: reducer throws `InvalidTransitionError` with message containing `joker_trigger_mismatch`.
Verifies: §8 row 2.

**I2 — Consumed joker is removed from player's slots state.**
Given: player has `jokerSlots = [{joker: 'cold_read', state: 'held'}]` and trigger window is open.
Action: `UseJoker { joker: 'cold_read', by: 'player' }`.
Expect: after reducer tick, `jokerSlots[0].state === 'consumed'` AND `Round.activeJokerEffects` contains `{type:'cold_read', expiresAfter:'next_challenge'}`.
Verifies: §6.3, §7.1.5.

**I3 — Stage Whisper triggers exactly one `probe_phase` entry.**
Given: player holds `stage_whisper`, AI is about to claim.
Action: `UseJoker { joker: 'stage_whisper', by: 'player' }`, then `ProbeComplete { whisperId }`.
Expect: After `UseJoker({joker: 'stage_whisper'})` is applied, probe-phase's `Round.activeProbe?.whisperId` is set to the produced whisper id (via probe-phase's `ProbeStart` event, which joker-system's reducer may dispatch internally or leave to the caller — see §7.4.2). After `ProbeComplete`, `Round.activeProbe === undefined`. Firing `ProbeComplete` a second time throws (§8 row 8).
NOTE: `Round.activeProbe` is owned by probe-phase §7.1. This invariant spans both specs; the joker-system side asserts only that `produceProbeRequest()` was called with correct inputs. The full activeProbe lifecycle is verified in probe-phase's test suite.
Verifies: §7.2 handoff.

**I4 — Second Wind no-op when strikes are already 0 (no over-heal / no error).**
Given: player has `strikes: 0`, holds `second_wind`. `RevealComplete { challengeWasCorrect: false }` fires (player challenged correctly — AI takes the strike, not the player). Second Wind does not auto-consume (it's not the player taking a strike).
Action: verify `second_wind` stays `held` after a round where the player does not take a strike.
Expect: `second_wind` remains `state: 'held'`. `strikes` unchanged. No error thrown.
Verifies: §8 auto-consume inertness (joker only fires on player-strike events).

**I4b — Second Wind auto-consumes on incoming strike (no separate trigger window).**
Given: player has `strikes: 2`, holds `second_wind`. `RevealComplete { challengeWasCorrect: true }` fires (player lied and was caught — would take a strike).
Action: reducer detects `second_wind` in `player.jokerSlots` with `state: 'held'` at the point of strike application.
Expect: `strikes` remains 2 (strike cancelled). `jokerSlots` entry for `second_wind` transitions to `state: 'consumed'`. No explicit `UseJoker` event needed — auto-consume is the mechanic.
**Second Wind reducer edge:** in the `RevealComplete` handler, BEFORE incrementing the strike on the player, check: if `second_wind` is in `player.jokerSlots` with `state: 'held'`, auto-consume it and skip the strike increment. This removes player agency over timing — a deliberate hackathon-scope simplification. Post-hackathon option tracked in §11 Q12.
Verifies: §5 Second Wind row, §6.3 `one_shot_on_use`, §7.1.2 auto-consume edge.

**I5 — Cold Read reveals lie-score only on the specific opponent claim.**
Given: Cold Read active for round. Two sequential opponent claims in the round.
Action: project via `toClientView` before first claim's resolution, then after.
Expect: first claim's `lieScore` is visible in `claimHistory[-1].voiceMeta`. After `ChallengeCalled` / `ClaimAccepted` (next_challenge expires), subsequent claim's `lieScore` is NOT visible (effect expired).
Verifies: §5 Cold Read row, §7.4.2.

**I6 — Poker Face suppression is deterministic and exact.**
Given: Poker Face active, player makes a claim.
Action: inspect the `DecisionContext` the API-route layer builds for `aiDecideOnClaim`.
Expect: `ctx.claim.voiceMeta.lieScore === 0.5` exactly. Not scaled, not jittered. The raw `voiceMeta.lieScore` on the stored `Claim` is untouched (preserved for autopsy).
Verifies: §7.4.1 deterministic multiplier lock.

**I7 — Earful autopsy projected on ChallengeWon while held.**
Given: player holds `earful` (`state: 'held'`), AI's last claim has `voicePreset: 'confident_honest'`, `RevealComplete { challengeWasCorrect: true }` fires (player wins challenge).
Action: reduce the event; project via `toClientView(session, 'player')`.
Expect: `clientSession.autopsy` is `{ preset: 'confident_honest', roundIdx: 0, turnIdx: 1 }`. Earful slot is `state: 'consumed'`. `toClientView(session, 'ai')` has no `autopsy` field.
Verifies: §7.4.3 preset-reveal contract.

**I8 — Offer mechanics — pick 3, discard unpicked 2.**
Given: `Session.currentOffer = { offered: ['poker_face', 'earful', 'cold_read'], offeredToWinner: 'player' }`.
Action: `JokerPicked { joker: 'poker_face', nextRoundDeal }`.
Expect: `Session.player.jokerSlots` has new entry `{joker:'poker_face', state:'held'}`. `Session.discardedJokers` contains `['earful', 'cold_read']`. `Session.currentOffer` is `undefined`.
Verifies: §6.2, §6.5.

**I9 — Draw pile seeded with 5 × 3 = 15 on setup.**
Given: `SetupComplete { initialJokerDrawPile: [15 entries with exactly 3 of each of 5 types] }`.
Action: reduce.
Expect: `Session.jokerDrawPile.length === 15`, composition matches seed.
Verifies: §6.2 init.

**I10 — Exhausted pile → `JokerOfferEmpty` transitions directly to next round.**
Given: `jokerDrawPile.length === 0`, `Session.status === 'joker_offer'`.
Action: `JokerOfferEmpty { nextRoundDeal }`.
Expect: `Session.status === 'round_active'`, new Round appended, `currentRoundIdx++`. Winner's `jokerSlots` unchanged.
Verifies: §6.2 tail.

**I11 — Stacking the same joker type in one round is disallowed.**
Given: player uses `cold_read`, effect expires (`next_challenge` triggered). Player somehow holds a second `cold_read` in another slot (possible with future shop; guarded for v1 defensively).
Action: `UseJoker { joker: 'cold_read' }` second time in same round.
Expect: throws `InvalidTransitionError` referencing `jokerTriggeredThisRound`.
Verifies: §8 row 3.

**I12 — `toClientView` projection of joker fields.**
Given: `Session` with `status: 'joker_offer'`, `jokerDrawPile: [...15]`, `discardedJokers: ['earful']`, `currentOffer: {offered:[...], offeredToWinner:'player'}`, `player.jokerSlots: [held, consumed]`, `ai.jokerSlots: [held]`.
Action: `toClientView(session, 'player')` then `toClientView(session, 'ai')`.
Expect:
- `player` view: NO `jokerDrawPile`; `discardedJokers` present (status is `joker_offer`, not `round_active`); `currentOffer` present (player is the winner); `self.jokerSlots` full; `opponent.jokerSlots` full (public). No `autopsy` (not applicable here).
- `ai` view (loser of that round): `currentOffer` is `undefined` (stripped — AI didn't win); `jokerDrawPile` absent; `discardedJokers` present (post-round status). No `autopsy`.
- **Second variant:** `Session.status === 'round_active'`: both views should have `discardedJokers` ABSENT (gated per §7.1.9 updated rule).
Verifies: §3.4, §7.1.9 (including discardedJokers gate on status !== round_active).

**(Optional) I13 — Catalog flavor strings match steering/product.md.**
Drift guard: test loads `steering/product.md`, extracts the 5 one-line descriptions, asserts each matches `JOKER_CATALOG[type].flavor` character-for-character. Prevents silent divergence when one file updates.

---

## 10. File layout

Proposed under `src/lib/jokers/`:

```
src/lib/jokers/
  types.ts           — Joker, JokerSlot, JokerOffer, JokerTrigger, JokerDuration, JokerCost, ProbeRequest
  catalog.ts         — JOKER_CATALOG: Record<JokerType, Joker> (all 5 definitions, frozen const)
  catalog.test.ts    — I13 drift guard; accentVar format; flavor length
  effects.ts         — applyPokerFace, applyColdRead, applyEarful, applySecondWind, applyStageWhisper → produceProbeRequest
  effects.test.ts    — I3, I4, I4b, I6, I7 effect-level assertions (unit-isolated from reducer)
  lifecycle.ts       — seedDrawPile, pickOffer, canActivate(joker, round, player), advanceSlot (held → consumed)
  lifecycle.test.ts  — I1, I2, I8, I9, I10, I11 lifecycle-level assertions
```

**File count:** 4 source + 3 test = 7 files. Within spec size budget. (Reducer event handlers are inlined directly in `src/lib/game/fsm.ts` — see revised layout below.)

**File-split justification (teaching note):**
- **`catalog.ts` separate from `types.ts`:** types are shape declarations, catalog is value data. Splitting lets tests import just types for stubs without pulling in the frozen-object catalog, which is cheaper in test-runtime. Also mirrors `ai-opponent`'s `constants.ts` / `types.ts` split.
- **`effects.ts` separate from `lifecycle.ts`:** effects are per-joker pure functions that mutate a Round/Session per the catalog. Lifecycle is the pipeline machinery (draw → offer → pick → hold → use → consume → expire). Keeping them separate means adding a 6th joker in v2 only touches `catalog.ts` + `effects.ts`, not the lifecycle engine.
- **`fsm.ts` in `src/lib/jokers/` — inlined or registered?** Decision: **inline event handlers directly in `src/lib/game/fsm.ts`** (import helpers from `jokers/lifecycle.ts` + `jokers/effects.ts`). Rationale: the reducer is a single dispatch table (see existing `fsm.ts` `switch(event.type)`); splitting handlers across files would fracture invariant-14 "reducer purity called twice returns identical output" test surface. `src/lib/jokers/fsm.ts` is therefore DROPPED from the list above; handlers go in `src/lib/game/fsm.ts` directly, importing from `jokers/*`.

**Revised file layout (final):**

```
src/lib/jokers/
  types.ts
  catalog.ts
  catalog.test.ts
  effects.ts
  effects.test.ts
  lifecycle.ts
  lifecycle.test.ts
```

7 files total. Reducer additions land directly in `src/lib/game/fsm.ts` (§7.1.1 events), importing helpers from `lifecycle.ts` / `effects.ts`.

---

## 11. Open questions

1. **Flavor — "Earful" vs "Monologue"?** Earful is colloquial (you get an earful). Monologue is courtroom-adjacent. Decision: keep Earful for v1 (shorter, more evocative); revisit at polish. *(Note: Earful now uses preset-reveal, not TTS-length extension — the flavor name still fits the "learning about their voice" concept.)*
2. **Stage Whisper probe scope — one probe or unlimited?** Current: `one_shot_on_use`, one probe per activation. Alternative: session-long, player can probe before every AI claim. Reject alternative — breaks TTS budget, makes each AI turn 2× slower. Lock v1 to single-shot.
3. **AI use of jokers?** v1: AI never picks jokers (only the winner picks; if AI wins, what happens?). **Decision:** AI wins → AI picks (deterministic — highest-weighted joker by persona; add `aiPickJoker(persona, offered): JokerType` to `ai-opponent` Day-5). For v1 Day-4 slice, AI wins → AI picks uniformly at random (caller-provided via event payload). Lock this. Document that AI's held jokers currently have no activation logic in v1 — they're informational to the player only. Follow-up: Day-5 `ai-personas` spec to add activation heuristics.
4. **Deterministic offer randomization.** v1: uniform-without-replacement from `drawPile`. Alternative: weighted by persona (Reader gets more Cold Reads — defensive; Novice gets more Second Winds — forgiving). Reject for v1; complicates testing. Pick up in balance pass.
5. **Cold Read scope — one claim or all claims this round?** Current: `next_challenge` (one claim). Product.md says "Next AI claim" — matches current. Lock.
6. **Poker Face math-layer interaction.** Current: Poker Face masks voice only, NOT math. Alternative: also mask AI's math probability (perfect bluff). Reject — math uses public info (hand composition visible via claims+takenCards), nothing to mask.
7. **Second Wind window — any strike, or only strike 3?** Current: any strike (fires on trigger `on_my_strike`). Alternative: only the killing strike-3 to preserve drama. Keep v1 flexible; balance pass can tighten.
8. **Visibility rework for stealth jokers.** All v1 jokers are `visibleOnActivate: true`. Post-hackathon: consider `visibleOnActivate: false` for a future "Silent Objection" joker. `JokerCost.reveal_own_card` variant reserves space.
9. **Slot cap 3 vs ∞.** v1 3-slot cap is defensive. Enforce in code but never triggered in v1 gameplay (max 2 acquirable). Test I-missing: if user runs `aiPickJoker` + `playerPickJoker` symmetrically across 3 rounds of a theoretical best-of-5, cap would hit. Not in v1 scope.
10. **Joker picks persist via `localStorage`?** `product.md` says "(jokers / streak)". Current spec: ephemeral server-side only; `session_over` wipes. Reconcile with product.md: `localStorage` holds meta-progression *across sessions* (e.g., "games won with Poker Face"); joker slots within a session stay server-side. Document in `ui-gameplay` Day-5.
11. **Autopsy overlay visual treatment — full preset card vs icon-only?** On a ChallengeWon + Earful trigger, the `<AutopsyOverlay>` (ui-gameplay Day-5) can render either (a) a full "voice tell card" showing the preset name + description, or (b) a small icon badge. Decision: **ui-gameplay Day-5 owns the call** — joker-system only owns the `ClientSession.autopsy` data contract.
12. **Second Wind player agency (post-hackathon option).** Second Wind now auto-consumes on incoming strike (no separate trigger window — see §9 I4b and §7.4). This removes player choice over timing. Post-hackathon: consider a brief (≤2s) "Cancel strike?" confirm window before auto-consume fires, restoring agency without blocking the FSM on user input.

---

## 12. Seed prompt for Kiro (canonical form, paste-ready)

Per `reference_kiro_spec_workflow.md` canonical template. Paste into Kiro Spec mode to generate `requirements.md` + `tasks.md`.

```
Generate requirements.md and tasks.md for the `joker-system` spec.

Canonical sources already in repo:

- `.kiro/specs/joker-system/design.md` — authoritative architecture, 5-joker catalog, cross-spec handoff contracts, 12-13 Vitest invariants (do NOT modify)
- `.kiro/specs/game-engine/design.md` §1-3 — FSM contract this spec extends additively (new events: JokerOffered, JokerOfferEmpty, UseJoker; ProbeComplete owned here, consumed by probe-phase)
- `.kiro/specs/ai-opponent/design.md` §2 (DecisionContext read by Cold Read / Poker Face) + §11 (locked — persona tables, prompt templates, fallback branches stay untouched)
- `.kiro/specs/ui-gameplay/design.md` §3.3 (phase-gate extension for `joker_offer` phase) + §10.2 (Cold Read gates lie-score HUD, LOCKED 2026-04-19)
- `.kiro/specs/probe-phase/design.md` §4 + §7.2 — ProbeRequest LOCKED byte-for-byte with this spec (orchestrator reconciliation 2026-04-19); Stage Whisper in-flight state delegates to probe-phase's `Round.activeProbe` (NOT `pendingJokerActivation`)
- `.kiro/specs/voice-tell-taxonomy/design.md` — `VoiceTellPreset` type consumed for Earful autopsy
- `.kiro/steering/product.md` — source-of-truth for joker one-liners ("Session-Jokers (5 in MVP)")
- `.kiro/steering/structure.md` / tech.md — `src/lib/jokers/` subtree path convention + stack
- Pre-land commit `29f6a34` on main adds to `src/lib/game/types.ts`: `Session.jokerDrawPile?`, `Session.discardedJokers?`, `Session.currentOffer?`, `Session.autopsy?`, `Round.jokerTriggeredThisRound?`, `Round.pendingJokerActivation?`, `PlayerState.jokerSlots?`, `Claim.voicePreset?`, `ClientSession.autopsy?`, plus `GameEvent` variants `JokerOffered { offered, newDrawPile, now }`, `JokerOfferEmpty { nextRoundDeal, now }`, `UseJoker { joker, by, now }`, `ProbeComplete { whisperId, now }`. Also pre-landed: `src/lib/jokers/types.ts` with `JokerSlot` + `JokerOffer`; stub reducer case-branches throwing "pending joker-system worktree"; projection gates in `toClientView.ts`. Tasks MUST import/extend, NOT re-declare.

requirements.md — EARS format. Derive acceptance criteria from design.md §3 (architecture), §4 (data model), §5 (5-joker catalog), §6 (lifecycle + offer mechanics), §7 (integration points — §7.1 is load-bearing), §8 (error handling), §9 (invariants I1-I13). Aim ~28-35 criteria. Every design.md invariant (I1-I13) must map to at least one numbered requirement. Locked items that must NOT appear as pending:

- 5 jokers locked: Poker Face, Stage Whisper, Earful, Cold Read, Second Wind
- **Earful = preset-reveal** via `ClientSession.autopsy` on `ChallengeWon` (Option A orchestrator lock 2026-04-19, per product.md) — NOT TTS-padding; NO `PromptModifier` / `EXTENDED_TEMPLATES` / `OwnPlayContext.promptModifiers` anywhere
- **Second Wind = AUTO-CONSUMES** on a would-strike event; NO `UseJoker({ joker: 'second_wind' })` path, NO `strike_pending` Round.status value
- **Poker Face** `next_claim` expiry fires on `ChallengeCalled` OR `ClaimAccepted` (POST-AI-judgment), NOT on `ClaimMade` — guarantees AI reads `DecisionContext` before the mask lifts
- **Cold Read** gates the lie-score HUD in ui-gameplay (ui-gameplay §10.2 LOCK, not default-on)
- **ProbeRequest shape LOCKED**: `{ whisperId, targetAiId: 'ai', roundIdx, triggeredAtTurn, now, mathProb? }` — byte-for-byte aligned with probe-phase §4
- **Probe is a pseudo-state** per game-engine §1.1 — NO `Round.status: 'probing'` anywhere; Stage Whisper delegates in-flight state to probe-phase's `Round.activeProbe`
- **Joker offer = uniform-without-replacement over DISTINCT TYPES** still present in pile — never two of the same joker type in one offer (dedup-by-type BEFORE sampling)
- **discardedJokers projection** gated on `Session.status !== 'round_active'` (only visible post-round)
- **SetupComplete.initialJokerDrawPile** is OPTIONAL (pre-landed); reducer default-seeds via `seedDrawPile()` helper when absent
- **Pile composition**: 5 types × 3 copies = 15 jokers (v1)

§11 open questions Q11 (autopsy overlay visual treatment — ui-gameplay Day-5 owns) and Q12 (Second Wind agency post-hackathon option) MUST appear under `## Design questions for Scott` at bottom — do NOT resolve unilaterally. Any other §11 items stay there too.

tasks.md — 14-18 granular tasks, tests-first where feasible. Each task:

- Links to specific requirement numbers via `_Requirements: X.Y, X.Z_`
- Names exact files (per design.md §10 REVISED file layout — `src/lib/jokers/{types.ts (extend pre-landed), catalog.ts, catalog.test.ts, effects.ts, effects.test.ts, lifecycle.ts, lifecycle.test.ts}` = 4 source + 3 test = 7 files; reducer additions land INLINE in `src/lib/game/fsm.ts`, NOT as a separate module)
- Ordered by dependency: `catalog.ts` + extended `jokers/types.ts` → `lifecycle.ts` (pure, no FSM coupling) + test → `fsm.ts` reducer additions (JokerOffered, JokerOfferEmpty, UseJoker, ProbeComplete handlers + applyJokerEffect signature extension + JokerPicked post-conditions [push to jokerSlots, push unpicked to discardedJokers, clear currentOffer] + Second Wind auto-consume edge in RevealComplete) → `effects.ts` simplest-3 first (Cold Read, Poker Face, Second Wind — no LLM plumbing) + test → extend `toClientView.ts` projections (gates for autopsy / discardedJokers / currentOffer / jokerSlots beyond pre-land baseline) → `effects.ts` Earful autopsy (blocks on voice-tell-taxonomy's `VoiceTellPreset` narrowing) → `effects.ts` Stage Whisper (blocks on probe-phase spec's `produceProbeRequest` helper) → integration + full-suite vitest
- Checkpoints every 3-4 tasks for `pnpm vitest run`
- Optional-but-skippable tasks marked with `*` (truly-nice-to-haves only)
- Cross-spec coordination tasks (Earful needs voice-tell-taxonomy preset narrowing; Stage Whisper needs probe-phase `produceProbeRequest`) MUST be flagged BLOCKING in task description — escalate to Scott if the dependency spec isn't merged yet
- Do NOT modify `src/lib/game/types.ts` field declarations — they're pre-landed in commit `29f6a34`; this spec populates them at runtime

Do NOT write implementation code. Do NOT modify design.md. If design.md seems wrong or contradictory, flag at bottom of requirements.md under `## Design questions for Claude Code`.

Output both files in `.kiro/specs/joker-system/`.
```

---

## Architecture consistency note

This spec extends the `game-engine` FSM by strictly additive means (new events, new fields). No existing event semantics are altered. The existing `JokerPicked` event gains additional post-conditions (populate `jokerSlots`, push unpicked to `discardedJokers`) but its trigger + core side-effects (inter-round reshuffle) are unchanged.

`ai-opponent` has **zero changes** for Earful (the TTS-extension approach was replaced by the preset-reveal autopsy approach). No changes to persona tables, prompt templates, math formula, or fallback branches — the locked items in `ai-opponent/design.md` §11 stay locked.

`ui-gameplay` gets one new phase (`joker_offer`) on the phase-gate table and one new client event (`PickJoker`). No existing component contracts are modified.

`probe-phase` (forthcoming) consumes `ProbeRequest` produced here and fires `ProbeComplete` back. The interface is defined in §7.2 and should not drift.

If any of the above consistency claims break during implementation, flag to Scott — do not silently resolve. The iter-5 architecture lock is the canonical authority.
