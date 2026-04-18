# Implementation Plan: Game Engine FSM

## Overview

Pure-TypeScript finite state machine for a best-of-3 voice-bluffing card game. Implementation follows dependency order: types → pure helpers → reducer transitions → integration wiring. All code is pure (no I/O, no side effects). Testing via Vitest with co-located test files.

## Tasks

- [x] 1. Define all type definitions and interfaces
  - [x] 1.1 Create core types and interfaces in `src/lib/game/types.ts`
    - Define `Rank`, `Persona`, `TruthState`, `JokerType` type aliases
    - Define `Card`, `VoiceSettings`, `VoiceMeta`, `Claim`, `PublicClaim` interfaces
    - Define `Round`, `PlayerState`, `Session` interfaces — **PlayerState MUST include `takenCards: Card[]`** (cards this player took after losing a challenge)
    - Define `ClientSession`, `ClientRound` interfaces. **Note:** opponent's `takenCards` remains visible in ClientSession (public info — you saw them take the pile); only `hand` is replaced with `handSize`.
    - Define `RoundDeal` auxiliary interface: `{ playerHand: Card[]; aiHand: Card[]; remainingDeck: Card[]; targetRank: Rank; activePlayer: 'player' | 'ai' }`. Caller's invariant: playerHand(5) + aiHand(5) + remainingDeck(10) === all 20 unique Cards.
    - Define `GameEvent` discriminated union with all event types:
      - `SetupComplete { now; initialDeal: RoundDeal; musicTracks }`
      - `ClaimMade { claim; now }`
      - `ClaimAccepted { now }` / `ChallengeCalled { now }`
      - `RevealComplete { challengeWasCorrect; now }`
      - `RoundSettled { now }`
      - `JokerPicked { joker; nextRoundDeal: RoundDeal; now }` — **caller provides reshuffled 5/5 deal**
      - `JokerOfferSkippedSessionOver { now }`
      - `Timeout { kind: 'active_player'; cardIdToPlay: string; now }` — **caller provides card choice, reducer stays pure**
      - `Timeout { kind: 'responder'; now }`
    - Define `InvalidTransitionError` custom error class with `currentState` and `eventType` fields
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 14.4, 15.1, 20.1, 21.1, 21.4_

  - [ ]* 1.2 Write type-level tests in `src/lib/game/types.test.ts`
    - **Invariant 1: Deck size** — assert a fresh deck factory produces exactly 20 cards: 5 Queen + 5 King + 5 Ace + 5 Jack, all IDs unique
    - _Requirements: 2.1, 2.2_

- [ ] 2. Implement pure helper functions
  - [ ] 2.1 Implement `checkSessionEnd` in `src/lib/game/fsm.ts`
    - Return opponent as winner when `strikes === 3`
    - Return player as winner when `roundsWon === 2`
    - Prioritize strike-3 loss over rounds-won-2 win when both apply
    - Return `null` when neither condition met
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ] 2.2 Implement `checkRoundEnd` in `src/lib/game/fsm.ts`
    - Return `true` when active player hand is empty AND last claim was accepted or truthful
    - Return `false` when hand is empty but last claim was a caught lie
    - _Requirements: 18.1, 18.2_

  - [ ] 2.3 Implement `applyJokerEffect` and `expireJokerEffects` in `src/lib/game/fsm.ts`
    - `applyJokerEffect`: push effect onto `Round.activeJokerEffects` for `next_claim` expiry
    - `expireJokerEffects`: filter out effects whose `expiresAfter` matches the trigger
    - Both return new `Round` objects — never mutate input
    - _Requirements: 19.1, 19.2, 19.3_

  - [ ]* 2.4 Write unit tests for `checkSessionEnd` in `src/lib/game/fsm.test.ts`
    - **Invariant 10: Session loss trigger** — `strikes === 3` → returns opponent as winner
    - **Invariant 11: Best-of-3 win trigger** — `roundsWon === 2` → returns that player as winner
    - Test priority: strike-3 checked before rounds-won-2
    - Test null return when neither condition met
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ]* 2.5 Write unit tests for `checkRoundEnd` in `src/lib/game/fsm.test.ts`
    - `checkRoundEnd` is ONLY invoked from the `ClaimAccepted` path per Req 18.2; it does NOT handle caught-on-final-card (that's in `RevealComplete`, tested in Task 5.4).
    - Test hand-non-empty + accepted → returns `false`
    - Test hand-empty + last claim was accepted or truthful → returns `true` with `winner = activePlayer`
    - Invariants 6 and 7 are covered by Task 5.4 (RevealComplete tests), NOT here.
    - _Requirements: 18.1, 18.2_

  - [ ]* 2.6 Write unit tests for joker effect helpers in `src/lib/game/fsm.test.ts`
    - Test `applyJokerEffect` pushes effect onto `activeJokerEffects`
    - Test `expireJokerEffects` removes matching effects, preserves non-matching
    - Test both return new objects (input not mutated)
    - _Requirements: 19.1, 19.2, 19.3_

- [ ] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement reducer: setup and claim transitions
  - [ ] 4.1 Implement `reduce` function scaffold and `SetupComplete` transition in `src/lib/game/fsm.ts`
    - Create `reduce(session: Session, event: GameEvent): Session` with event-type dispatch
    - `SetupComplete`: transition `setup` → `round_active`, append fresh `Round` with `claim_phase`
    - Install `Session.deck = event.initialDeal.remainingDeck` (length === 10). Install hands from `initialDeal.playerHand` / `initialDeal.aiHand`. Both `takenCards` start as [].
    - Validate 5 cards per player, `Session.deck.length === 10`, empty pile, both takenCards empty, valid target rank, 3 music tracks
    - Throw `InvalidTransitionError` for any event when `session_over`
    - _Requirements: 1.1, 1.2, 1.3, 15.1, 15.2, 20.1, 20.2_

  - [ ] 4.2 Implement `ClaimMade` transition in `src/lib/game/fsm.ts`
    - Validate `claim.count ∈ {1, 2}` and `actualCardIds.length === claim.count`
    - Validate every card ID exists in active player's hand
    - Derive `truthState`: `honest` iff all actual cards match `claimedRank`
    - Remove cards from hand, append to pile, append claim to `claimHistory`
    - Transition `claim_phase` → `response_phase`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2_

  - [ ]* 4.3 Write tests for `SetupComplete` and `ClaimMade` in `src/lib/game/fsm.test.ts`
    - **Invariant 2: Deal** — after `SetupComplete`, 5 cards each, `Session.deck.length === 10`, empty pile, both takenCards empty, valid target rank
    - **Invariant 3: Claim validation** — `actualCardIds.length === count`, IDs exist in hand
    - **Invariant 5: Truth derivation** — `honest` iff all actual cards match claimed rank
    - **Invariant 8: Forced-lie** — hand with zero target rank cards → lying claim accepted without error
    - **Invariant 15: Invalid transitions** — `ClaimMade` during `response_phase` throws `InvalidTransitionError`
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 15.1_

- [ ] 5. Implement reducer: response and resolution transitions
  - [ ] 5.1 Implement `ClaimAccepted` transition in `src/lib/game/fsm.ts`
    - Check round-end conditions via `checkRoundEnd` before swapping active player
    - If round ends: set `round.status = 'round_over'`, `round.winner = activePlayer`
    - Otherwise: swap `activePlayer`, transition to `claim_phase`
    - _Requirements: 5.1, 10.1_

  - [ ] 5.2 Implement `ChallengeCalled` transition in `src/lib/game/fsm.ts`
    - Transition `response_phase` → `resolving`
    - _Requirements: 5.2_

  - [ ] 5.3 Implement `RevealComplete` transition in `src/lib/game/fsm.ts`
    - Increment strike on exactly one player: claimant if `challengeWasCorrect`, challenger otherwise
    - **Move `Round.pile` contents to the losing player's `takenCards` array (append); set `Round.pile = []`**
    - Check session-end (3 strikes) FIRST — if yes, set `session_over` with correct winner (opponent of 3-striker)
    - Else check caught-on-final-card-lie: active's hand now 0 AND `challengeWasCorrect === true` → `round_over`, `round.winner = opponent`, done (do NOT swap)
    - Else check honest-final-wrongly-challenged: active's hand now 0 AND `challengeWasCorrect === false` → `round_over`, `round.winner = active`, done (do NOT swap)
    - Else swap active player, transition to `claim_phase`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_

  - [ ]* 5.4 Write tests for response and resolution transitions in `src/lib/game/fsm.test.ts`
    - **Invariant 4: Card conservation (expanded)** — total = `Session.deck + hand_p + hand_ai + round.pile + p.takenCards + ai.takenCards === 20` after every reducer call through a full accept/challenge cycle (all 20 cards across 6 pools)
    - **Invariant 6: Caught-on-final-card-lie → round ends opponent-wins** — lie on final card + correctly challenged → `round.status === 'round_over'`, `round.winner === opponent`, active.strikes +1, active.takenCards contains the former pile, Round.pile === []
    - **Invariant 7: Honest-final-wrongly-challenged → round ends active-wins** — honest final card + wrongly challenged → `round.status === 'round_over'`, `round.winner === active`, challenger.strikes +1, challenger.takenCards contains the former pile, Round.pile === []
    - **Invariant 9: Simultaneous strike-3 impossible** — single resolution increments exactly one player's strikes
    - **Invariant 10: Session loss trigger** — `strikes` reaches 3 in same tick → `session_over`, correct winner
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_

- [ ] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement reducer: round settlement, joker, and session-end transitions
  - [ ] 7.1 Implement `RoundSettled` transition in `src/lib/game/fsm.ts`
    - Increment `roundsWon` for the round winner
    - Check session-end via `checkSessionEnd`
    - If session ends: transition to `session_over`
    - Otherwise: transition to `joker_offer`
    - _Requirements: 11.1, 11.2, 12.1, 12.2_

  - [ ] 7.2 Implement `JokerPicked` and `JokerOfferSkippedSessionOver` transitions in `src/lib/game/fsm.ts`
    - `JokerPicked`: append joker to winner's `jokers` array. **Consume `event.nextRoundDeal` (caller-provided, already-reshuffled 5/5 hands + 10-card remainingDeck + new targetRank + activePlayer)** — install fresh hands on both PlayerStates AND install `Session.deck = nextRoundDeal.remainingDeck`. Reset `player.takenCards = []` and `ai.takenCards = []`. Append new `Round` with `pile: []`, `claimHistory: []`, `status: 'claim_phase'`, `targetRank` from deal, `activePlayer` from deal, `activeJokerEffects: []`, `tensionLevel: 0`. Increment `currentRoundIdx`. Transition to `round_active`. **Never call Math.random() or shuffleDeck() — caller owns randomness.**
    - `JokerOfferSkippedSessionOver`: transition to `session_over`
    - Carry forward both players' `strikes`, `roundsWon`, `jokers`, and `personaIfAi` unchanged into next round
    - _Requirements: 8.1, 8.2, 12.3, 12.4, 21.1, 21.2, 21.3, 21.4, 21.5_

  - [ ]* 7.3 Write tests for round settlement and joker transitions in `src/lib/game/fsm.test.ts`
    - **Invariant 11: Best-of-3 win trigger** — `roundsWon === 2` after `RoundSettled` → `session_over`
    - **Invariant 16: Inter-round reshuffle+redeal** — after `JokerPicked`: both hands length === 5; `Session.deck.length === 10`; both `takenCards === []`; new Round's `pile === []`; fresh `targetRank` set; `currentRoundIdx` incremented; strikes/roundsWon/jokers carried forward unchanged
    - Test `JokerPicked` uses `event.nextRoundDeal` values (not random); passing identical event twice yields identical Session
    - Test `JokerOfferSkippedSessionOver` → `session_over`
    - _Requirements: 8.1, 8.2, 11.1, 11.2, 12.1, 12.2, 12.3, 12.4, 21.1, 21.2, 21.3, 21.5_

- [ ] 8. Implement reducer: timeout handling
  - [ ] 8.1 Implement `Timeout` event handling in `src/lib/game/fsm.ts`
    - `active_player` timeout during `claim_phase`: **consume `event.cardIdToPlay` (caller-provided)**, auto-generate `ClaimMade` with `count=1`, `claimedRank = round.targetRank`, `actualCardIds = [cardIdToPlay]`. Derive truthState: `honest` iff the card with `id === cardIdToPlay` in hand has `rank === targetRank`. **Reducer never rolls randomness.**
    - `responder` timeout during `response_phase`: treat as `ClaimAccepted`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 8.2 Write tests for timeout handling in `src/lib/game/fsm.test.ts`
    - Test active-player timeout consumes `event.cardIdToPlay` and generates valid 1-card claim
    - Test timeout truthState is `honest` when `cardIdToPlay` rank matches target, `lying` otherwise
    - Test purity — same Timeout event twice yields identical Session
    - Test responder timeout behaves as `ClaimAccepted`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [ ] 9. Implement `toClientView` projection
  - [ ] 9.1 Implement `toClientView` in `src/lib/game/toClientView.ts`
    - Strip `actualCardIds` from all claims in all rounds
    - Strip `llmReasoning` from opponent's claims (keep for own claims — supports Earful autopsy UI)
    - Replace opponent's `hand` with `handSize`
    - **Keep opponent's `takenCards` visible** — that's public info (you watched them lose the challenge and take the pile)
    - Map `Round[]` → `ClientRound[]` with `PublicClaim[]` and `pileSize`
    - Include viewer's own hand, hide opponent's hand
    - Map current music track URL based on tension level
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ]* 9.2 Write tests for `toClientView` in `src/lib/game/fsm.test.ts`
    - **Invariant 12: toClientView isolation** — serialized output contains zero `actualCardIds` fields; opponent `hand` absent, `handSize` present
    - Test `llmReasoning` stripped from opponent claims but preserved for own claims
    - Test `PublicClaim` shape (only `by`, `count`, `claimedRank`, `claimText`, `timestamp`)
    - Test viewer symmetry: player view hides AI hand, AI view hides player hand
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Reducer purity and invalid-transition coverage
  - [ ]* 11.1 Write reducer purity tests in `src/lib/game/fsm.test.ts`
    - **Invariant 14: Reducer purity** — call `reduce` twice with identical inputs → structurally-equal outputs; no dependency on `Date.now()` / `Math.random()`
    - Test input session is not mutated after `reduce` call (deep-equal check on original)
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 11.2 Write invalid-transition tests in `src/lib/game/fsm.test.ts`
    - **Invariant 15: Invalid transitions throw** — `ClaimAccepted` during `claim_phase` throws `InvalidTransitionError`
    - Test every event type throws when `Session.status === 'session_over'`
    - Test `SetupComplete` throws when `Session.status !== 'setup'`
    - Test `ClaimMade` throws when `Round.status !== 'claim_phase'`
    - _Requirements: 15.1, 15.2, 20.1, 20.2_

- [ ] 12. Full integration: multi-round session walkthrough
  - [ ] 12.1 Wire all transitions together and verify full session flow in `src/lib/game/fsm.test.ts`
    - Test a complete 2-round session: setup → claims → accept/challenge → round settlement → joker pick (with fresh `nextRoundDeal`) → round 2 → session win
    - **Invariant 4: Card conservation (expanded)** — assert `Session.deck + hand_p + hand_ai + round.pile + p.takenCards + ai.takenCards === 20` at every intermediate state (all 6 pools)
    - **Invariant 9: Simultaneous strike-3 impossible** — verify across all resolutions
    - **Invariant 16: Inter-round reshuffle+redeal** — verify after JokerPicked: both hands length 5, `Session.deck.length === 10`, both takenCards empty, new round's pile empty, strikes carried forward
    - Verify `checkSessionEnd` and `checkRoundEnd` integrate correctly with reducer
    - _Requirements: 7.1, 8.1, 8.2, 9.1, 9.2, 9.3, 10.1, 11.1, 11.2, 20.1, 21.1, 21.2, 21.3, 21.5_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All 16 design invariants are covered:
  - Invariant 1 (Deck size): Task 1.2
  - Invariant 2 (Deal — 5/5, deck==10, empty pile, empty takenCards, valid target, 3 music tracks): Task 4.3
  - Invariant 3 (Claim validation): Task 4.3
  - Invariant 4 (Card conservation — deck+hand+pile+takenCards == 20 across 6 pools): Tasks 5.4, 12.1
  - Invariant 5 (Truth derivation): Task 4.3
  - Invariant 6 (Caught-on-final-card-lie → round ends opponent-wins): Task 5.4
  - Invariant 7 (Honest-final-wrongly-challenged → round ends active-wins): Task 5.4
  - Invariant 8 (Forced-lie): Task 4.3
  - Invariant 9 (Simultaneous strike-3 impossible): Tasks 5.4, 12.1
  - Invariant 10 (Session loss trigger): Tasks 2.4, 5.4
  - Invariant 11 (Best-of-3 win trigger): Tasks 2.4, 7.3
  - Invariant 12 (toClientView isolation — opponent hand hidden, opponent takenCards visible): Task 9.2
  - Invariant 13 (Misdirector preset): Out of scope (voice-tell-taxonomy spec)
  - Invariant 14 (Reducer purity — no Math.random, no Date.now; Timeout cardIdToPlay + JokerPicked nextRoundDeal caller-provided): Tasks 8.2, 11.1
  - Invariant 15 (Invalid transitions throw): Tasks 4.3, 11.2
  - Invariant 16 (Inter-round reshuffle+redeal — hands 5/5, deck==10, takenCards/pile cleared, strikes carried): Tasks 7.3, 12.1
