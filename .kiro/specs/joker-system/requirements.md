# Requirements Document

## Introduction

Cross-cutting joker meta-system for Hearsay — the Balatro-inspired run-modifier layer that gives round winners a meaningful choice between three random jokers. This document captures the functional requirements for 5 joker definitions, draw-pile and offer mechanics, slot lifecycle, FSM event additions, cross-spec handoff contracts (probe-phase, ai-opponent, ui-gameplay, voice-tell-taxonomy), error handling, and client-view projection extensions. All requirements are derived from the authoritative `design.md` (iter-3, 2026-04-19).

## Glossary

- **Joker**: A typed effect descriptor held in a player-owned slot, activated at a specific trigger moment, applied via a dedicated effect handler, then consumed or expired per its duration class
- **JokerSlot**: A player-owned container holding at most one joker, with `state: 'held' | 'consumed'`
- **Draw Pile**: Session-scoped deck of remaining unoffered jokers, seeded at 15 (5 types × 3 copies)
- **Discard Pile**: Consumed + unpicked jokers tracked on `Session.discardedJokers`
- **Offer**: A between-round presentation of up to 3 distinct joker types drawn uniformly-without-replacement from the draw pile
- **Active Joker Effect**: An entry in `Round.activeJokerEffects` currently influencing the pipeline
- **Trigger Moment**: The FSM state or transition edge at which a joker can be activated
- **Duration Class**: How long an effect lives once activated: `next_claim` / `next_challenge` / `one_shot_on_use` / `session`
- **ProbeRequest**: The typed handoff payload joker-system produces for probe-phase to consume (Stage Whisper)
- **VoiceTellPreset**: The voice-tell preset identifier consumed for Earful autopsy projection
- **Auto-consume**: A joker that fires automatically on a trigger event without requiring a separate `UseJoker` event (Second Wind)

## Requirements

### Requirement 1: Joker Catalog — Static Definitions

**User Story:** As a game designer, I want all 5 joker types to have canonical static definitions, so that trigger windows, durations, costs, and flavor text are centralized and testable.

#### Acceptance Criteria

1. THE system SHALL define a `JOKER_CATALOG: Record<JokerType, Joker>` containing exactly 5 entries: `poker_face`, `stage_whisper`, `earful`, `cold_read`, `second_wind`. *(design §5)*
2. EACH catalog entry SHALL include: `type`, `name`, `flavor` (≤80 chars), `triggers`, `duration`, `cost`, `visibleOnActivate`, and `accentVar`. *(design §4, §5)*
3. ALL v1 jokers SHALL have `visibleOnActivate: true` and `cost: { kind: 'none' }`. *(design §5 visibility rationale)*
4. THE catalog flavor strings SHALL match the canonical one-liners in `steering/product.md` character-for-character. *(design §5 naming+flavor lock, invariant I13)*

### Requirement 2: Joker Data Types

**User Story:** As a developer, I want well-typed joker interfaces, so that the compiler enforces correct usage across the codebase.

#### Acceptance Criteria

1. THE system SHALL extend the pre-landed `JokerSlot` interface in `src/lib/jokers/types.ts` to include `state: 'held' | 'consumed'`, `acquiredRoundIdx: number`, and optional `consumedRoundIdx?: number`. *(design §4)*
2. THE system SHALL define `Joker`, `JokerTrigger`, `JokerDuration`, `JokerCost`, and `ProbeRequest` interfaces in `src/lib/jokers/types.ts`. *(design §4)*
3. THE `ProbeRequest` interface SHALL have the LOCKED shape: `{ whisperId: string; targetAiId: 'ai'; roundIdx: number; triggeredAtTurn: number; now: number; mathProb?: number }` — byte-for-byte aligned with probe-phase §4. *(design §7.2)*
4. THE system SHALL NOT re-declare types already pre-landed in `src/lib/game/types.ts` (`JokerType`, `ActiveJokerEffect`, `GameEvent` variants, `Session` fields, `Round` fields, `PlayerState.jokerSlots?`, `Claim.voicePreset?`, `ClientSession.autopsy?`). Tasks SHALL import and extend, not re-declare. *(pre-land commit 29f6a34)*

### Requirement 3: Draw Pile Initialization

**User Story:** As the game engine, I want the joker draw pile seeded at session start, so that offers can be drawn from a known pool.

#### Acceptance Criteria

1. WHEN a `SetupComplete` event is processed with `initialJokerDrawPile` provided, THE reducer SHALL set `Session.jokerDrawPile` to the provided array. *(design §7.1.3)*
2. WHEN a `SetupComplete` event is processed WITHOUT `initialJokerDrawPile`, THE reducer SHALL default-seed via `seedDrawPile()` returning 5 types × 3 copies = 15 jokers. *(design §7.1.3, invariant I9)*
3. THE `seedDrawPile()` helper SHALL return a stable, ordered array of 15 jokers (3× each type in canonical order). *(design §7.1.3)*
4. THE reducer SHALL initialize `Session.discardedJokers` to `[]` on `SetupComplete`. *(design §6.2)*

### Requirement 4: Offer Mechanics — JokerOffered Event

**User Story:** As a round winner, I want to be presented with 3 distinct joker types to choose from, so that I have a meaningful strategic decision.

#### Acceptance Criteria

1. WHEN a `JokerOffered` event is received while Session status is `joker_offer`, THE reducer SHALL set `Session.currentOffer` to `{ offered: event.offered, offeredToWinner: <round winner> }` and update `Session.jokerDrawPile` to `event.newDrawPile`. *(design §6.5)*
2. THE caller SHALL ensure `offered` contains only DISTINCT joker types (dedup-by-type BEFORE sampling from the pile). No two of the same joker type in one offer. *(design §6.2, §6.4)*
3. THE `offered` array length SHALL be 1..3 (shrinks on pile exhaustion tail). *(design §7.1.1)*
4. THE system SHALL provide a `pickOffer(drawPile, rng)` helper that deduplicates by type before sampling and returns `{ offered, remaining }`. *(design §7.1.8)*

### Requirement 5: Offer Mechanics — JokerOfferEmpty Event

**User Story:** As the game engine, I want to handle an empty draw pile gracefully, so that the game continues without a joker offer.

#### Acceptance Criteria

1. WHEN a `JokerOfferEmpty` event is received while Session status is `joker_offer` and `jokerDrawPile` is empty, THE reducer SHALL transition directly to the next round via the caller-provided `nextRoundDeal` without setting `currentOffer`. *(design §6.2 tail, invariant I10)*
2. THE `JokerOfferEmpty` event SHALL be DISTINCT from `JokerOfferSkippedSessionOver` (which means session is over, not pile empty). *(design §7.1.1)*

### Requirement 6: Joker Pick — JokerPicked Extension

**User Story:** As a round winner, I want my picked joker to be stored in my slots and the unpicked ones discarded, so that the joker economy is tracked.

#### Acceptance Criteria

1. WHEN a `JokerPicked` event is processed, THE reducer SHALL push a new `JokerSlot { joker, state: 'held', acquiredRoundIdx }` to the winner's `jokerSlots` array. *(design §6.5)*
2. WHEN a `JokerPicked` event is processed, THE reducer SHALL push the 2 un-picked offered jokers from `Session.currentOffer.offered` into `Session.discardedJokers`. *(design §6.5, invariant I8)*
3. WHEN a `JokerPicked` event is processed, THE reducer SHALL clear `Session.currentOffer` to `undefined`. *(design §6.5)*
4. WHEN a `JokerPicked` event carries a joker NOT in `Session.currentOffer.offered`, THE reducer SHALL throw `InvalidTransitionError('joker_offer(joker_not_offered)', 'JokerPicked')`. *(design §8)*
5. WHEN a `JokerPicked` event is received and `Session.currentOffer` is `undefined`, THE reducer SHALL throw `InvalidTransitionError('joker_offer(no_current_offer)', 'JokerPicked')`. *(design §8)*
6. THE reducer SHALL also mirror the picked joker into the legacy `jokers: JokerType[]` array for backward compatibility during migration. *(design §7.1.5)*

### Requirement 7: Slot Cap Enforcement

**User Story:** As a game designer, I want a 3-slot maximum per player, so that future session-length changes don't break the economy.

#### Acceptance Criteria

1. EACH player SHALL have a maximum of 3 joker slots. *(design §6.1)*
2. IF a `JokerPicked` event would exceed the 3-slot cap (all 3 slots hold `state: 'held'` jokers), THE reducer SHALL throw `InvalidTransitionError('joker_offer(slot_cap_exceeded)', 'JokerPicked')`. *(design §6.1)*

### Requirement 8: Joker Activation — UseJoker Event

**User Story:** As a player, I want to activate a held joker during its trigger window, so that I can use its effect at the right moment.

#### Acceptance Criteria

1. WHEN a `UseJoker` event is received, THE reducer SHALL validate that the player holds the specified joker in `jokerSlots` with `state: 'held'`. If not, throw `InvalidTransitionError('round_active(joker_not_held)', 'UseJoker')`. *(design §8 row 1, invariant I1)*
2. WHEN a `UseJoker` event is received, THE reducer SHALL validate that the current FSM state matches the joker's trigger window. If not, throw `InvalidTransitionError('round_active(joker_trigger_mismatch)', 'UseJoker')`. *(design §8 row 2, invariant I1)*
3. WHEN a `UseJoker` event is received for a joker type already in `Round.jokerTriggeredThisRound`, THE reducer SHALL throw (stacking disallowed in v1). *(design §8 row 3, invariant I11)*
4. WHEN a valid `UseJoker` event is processed, THE reducer SHALL transition the joker slot to `state: 'consumed'`, push the joker type to `Round.jokerTriggeredThisRound`, and push an appropriate `ActiveJokerEffect` to `Round.activeJokerEffects`. *(design §6.3, invariant I2)*
5. THE `UseJoker` event SHALL NOT be used for `second_wind` — Second Wind auto-consumes on strike events. *(design §5 Second Wind row)*

### Requirement 9: Joker Effect Expiry

**User Story:** As the game engine, I want joker effects to expire at the correct moment, so that effects don't persist beyond their intended scope.

#### Acceptance Criteria

1. EFFECTS with duration `next_claim` SHALL be removed from `Round.activeJokerEffects` on the next `ChallengeCalled` OR `ClaimAccepted` event, whichever comes first POST-AI-judgment. *(design §6.3)*
2. EFFECTS with duration `next_challenge` SHALL be removed from `Round.activeJokerEffects` on the next `ChallengeCalled` OR `ClaimAccepted` event. *(design §6.3)*
3. EFFECTS with duration `one_shot_on_use` SHALL be pushed, handler fires, and removed in the same reducer tick. *(design §6.3)*
4. ON round boundary (`JokerPicked`), `Round.activeJokerEffects` SHALL be cleared (new Round starts fresh). `Player.jokerSlots` entries (both `held` and `consumed`) SHALL persist across rounds. *(design §6.4)*

### Requirement 10: Poker Face Effect

**User Story:** As a player, I want to mask my voice tell for one claim, so that the AI judges me on math alone.

#### Acceptance Criteria

1. WHEN Poker Face is activated via `UseJoker` during `self_claim_phase` (before the player speaks), THE reducer SHALL push `{ type: 'poker_face', expiresAfter: 'next_claim' }` to `Round.activeJokerEffects`. *(design §5, §7.4.1)*
2. WHEN Poker Face is active, THE API route layer SHALL override `DecisionContext.claim.voiceMeta.lieScore` to exactly `0.5` (deterministic, not scaled). The raw `lieScore` on the stored `Claim` SHALL remain untouched. *(design §7.4.1, invariant I6)*
3. THE Poker Face effect SHALL expire on `ChallengeCalled` OR `ClaimAccepted` (POST-AI-judgment), NOT on `ClaimMade` — guaranteeing the AI reads `DecisionContext` before the mask lifts. *(design §6.3, §7.4.1)*

### Requirement 11: Stage Whisper Effect

**User Story:** As a player, I want to probe the AI before it claims, so that I gain insight into its reasoning.

#### Acceptance Criteria

1. WHEN Stage Whisper is activated via `UseJoker` during `pre_ai_claim` (AI is about to make a claim), THE reducer SHALL consume the joker (`one_shot_on_use`) and produce a `ProbeRequest`. *(design §5, §7.2)*
2. THE `ProbeRequest` SHALL have the LOCKED shape: `{ whisperId, targetAiId: 'ai', roundIdx, triggeredAtTurn, now, mathProb? }`. *(design §7.2)*
3. STAGE Whisper SHALL delegate in-flight probe state to probe-phase's `Round.activeProbe` — NOT `Round.pendingJokerActivation`. *(design §7.1.2)*
4. THE probe SHALL be a pseudo-state per game-engine §1.1 — NO `Round.status: 'probing'` value SHALL be introduced anywhere. *(design §7.1.2)*
5. WHEN a `ProbeComplete` event is received, THE reducer SHALL clear the pending probe state and proceed to the AI's `claim_phase`. *(design §7.1.1)*
6. WHEN a `ProbeComplete` event is received with no pending probe, THE reducer SHALL throw `InvalidTransitionError('round_active(no_pending_probe)', 'ProbeComplete')`. *(design §8 row 8)*

### Requirement 12: Earful Effect — Preset Reveal

**User Story:** As a player, I want to learn which voice-tell preset the AI used when I win a challenge, so that I can improve my reading over time.

#### Acceptance Criteria

1. WHEN the player WINS a challenge (`RevealComplete { challengeWasCorrect: true }`) while `earful` is in `player.jokerSlots` with `state: 'held'`, THE reducer SHALL consume the Earful slot (`state: 'consumed'`) and project `Session.autopsy` with the AI's `VoiceTellPreset` for that turn's claim. *(design §7.4.3, invariant I7)*
2. THE `Session.autopsy` SHALL have shape `{ preset: VoiceTellPreset; roundIdx: number; turnIdx: number }`. *(design §7.4.3)*
3. IF `Claim.voicePreset` is undefined (AI used fallback path), THE reducer SHALL set `autopsy.preset` to `'unknown'`. *(design §8 row 10)*
4. THE `autopsy` SHALL be cleared on next `ChallengeCalled` or `RoundSettled`. *(design §7.4.3)*
5. EARFUL SHALL NOT modify AI TTS length, prompt templates, or `ai-opponent` internals. NO `PromptModifier`, `EXTENDED_TEMPLATES`, or `OwnPlayContext.promptModifiers` anywhere. *(Earful pivot lock 2026-04-19)*

### Requirement 13: Cold Read Effect

**User Story:** As a player, I want to see the AI's lie-score for one claim, so that I can make a more informed accept/challenge decision.

#### Acceptance Criteria

1. WHEN Cold Read is activated via `UseJoker` during `opponent_claim_resolved`, THE reducer SHALL push `{ type: 'cold_read', expiresAfter: 'next_challenge' }` to `Round.activeJokerEffects`. *(design §5, §7.4.2)*
2. WHEN Cold Read is active, `toClientView` SHALL retain `voiceMeta.lieScore` in the PublicClaim projection for the AI's claim (normally stripped). *(design §7.4.2, invariant I5)*
3. COLD Read SHALL NOT alter AI decisioning — it is a player-side read enhancement only. *(design §7.4.2)*
4. THE Cold Read effect SHALL expire on `next_challenge` — after the next `ChallengeCalled` or `ClaimAccepted`. *(design §5)*
5. COLD Read SHALL gate the lie-score HUD in ui-gameplay per ui-gameplay §10.2 LOCK (not default-on). *(design §5)*

### Requirement 14: Second Wind Effect — Auto-Consume

**User Story:** As a player, I want one cancelled strike, so that I get a second chance after a bad call.

#### Acceptance Criteria

1. WHEN the `RevealComplete` reducer would increment the player's strike AND `second_wind` is in `player.jokerSlots` with `state: 'held'`, THE reducer SHALL auto-consume the Second Wind joker and cancel the strike. *(design §5, invariant I4b)*
2. SECOND Wind SHALL NOT require a separate `UseJoker` event — it auto-fires inside the `RevealComplete` reducer. *(design §5)*
3. SECOND Wind SHALL NOT restore prior strikes (no over-heal). *(design §5)*
4. WHEN `strikes` is already 0 and no strike is being applied, Second Wind SHALL remain `held` (inert, no error). *(design §8 row 4, invariant I4)*
5. THERE SHALL be NO `strike_pending` Round.status value. *(locked constraint)*

### Requirement 15: toClientView Projection Extensions

**User Story:** As the game server, I want joker-related state projected correctly to clients, so that players see the right information at the right time.

#### Acceptance Criteria

1. `toClientView` SHALL strip `Session.jokerDrawPile` entirely (server-only). *(design §3.4, §7.1.9)*
2. `toClientView` SHALL project `Session.discardedJokers` ONLY when `Session.status !== 'round_active'` (post-round visibility only). *(design §7.1.9, invariant I12)*
3. `toClientView` SHALL project `Session.currentOffer` ONLY when `viewer === currentOffer.offeredToWinner` — strip otherwise. *(design §7.1.9, invariant I12)*
4. `toClientView` SHALL project `jokerSlots` fully in both `self` and `opponent` views (public info — they saw the pick). *(design §3.4, invariant I12)*
5. `toClientView` SHALL project `ClientSession.autopsy` only on the player's own view (not opponent's). *(design §3.4, invariant I12)*

### Requirement 16: Error Handling

**User Story:** As a developer, I want all invalid joker operations to throw descriptive errors, so that bugs surface immediately.

#### Acceptance Criteria

1. ALL invalid joker operations SHALL throw `InvalidTransitionError` with descriptive state/event messages — never silent no-ops (except Second Wind inertness at 0 strikes per Req 14.4). *(design §8)*
2. `UseJoker` for a joker not held SHALL throw with `joker_not_held`. *(design §8 row 1)*
3. `UseJoker` outside trigger window SHALL throw with `joker_trigger_mismatch`. *(design §8 row 2)*
4. `UseJoker` for same type twice in a round SHALL throw referencing `jokerTriggeredThisRound`. *(design §8 row 3)*
5. `JokerPicked` with joker not in offer SHALL throw with `joker_not_offered`. *(design §8 row 5)*
6. `JokerPicked` when no current offer SHALL throw with `no_current_offer`. *(design §8 row 6)*
7. `ProbeComplete` with no pending probe SHALL throw with `no_pending_probe`. *(design §8 row 8)*

---

## Invariant Cross-Reference

Every design.md §9 invariant maps to at least one numbered acceptance criterion:

| Invariant | Requirement(s) |
|---|---|
| I1 — Joker cannot be used outside trigger window | 8.1, 8.2 |
| I2 — Consumed joker removed from slots state | 8.4 |
| I3 — Stage Whisper triggers exactly one probe entry | 11.1, 11.5, 11.6 |
| I4 — Second Wind no-op when strikes are 0 | 14.4 |
| I4b — Second Wind auto-consumes on incoming strike | 14.1, 14.2 |
| I5 — Cold Read reveals lie-score only on specific claim | 13.2, 13.4 |
| I6 — Poker Face suppression is deterministic and exact | 10.2 |
| I7 — Earful autopsy projected on ChallengeWon while held | 12.1, 12.2 |
| I8 — Offer mechanics: pick 3, discard unpicked 2 | 6.1, 6.2, 6.3 |
| I9 — Draw pile seeded with 5 × 3 = 15 on setup | 3.2, 3.3 |
| I10 — Exhausted pile → JokerOfferEmpty transitions directly | 5.1 |
| I11 — Stacking same joker type in one round disallowed | 8.3 |
| I12 — toClientView projection of joker fields | 15.1, 15.2, 15.3, 15.4, 15.5 |
| I13 — Catalog flavor strings match steering/product.md | 1.4 |

---

## Design questions for Scott

- **Q11 (from design §11):** Autopsy overlay visual treatment — full preset card vs icon-only? ui-gameplay Day-5 owns the call; joker-system only owns the `ClientSession.autopsy` data contract.
- **Q12 (from design §11):** Second Wind player agency post-hackathon option — consider a brief (≤2s) "Cancel strike?" confirm window before auto-consume fires, restoring agency without blocking the FSM on user input. Current v1: auto-consume with no player choice.
