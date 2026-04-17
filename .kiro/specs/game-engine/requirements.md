# Requirements Document

## Introduction

Pure-TypeScript finite state machine for a best-of-3 voice-bluffing card game (1 human vs 1 AI). This document captures the functional requirements for session/round transitions, hand/pile bookkeeping, strike accounting, round-end and session-end detection, joker-effect slots, timeout handling, and client-view isolation. All requirements are derived from the authoritative `design.md`.

## Glossary

- **FSM**: The pure-TypeScript finite state machine implemented in `src/lib/game/fsm.ts`
- **Reducer**: The `reduce(session, event)` pure function that computes the next session state
- **Session**: Top-level game state object tracking two players, rounds, and overall status
- **Round**: A sub-game within a session; players alternate turns claiming cards against a target rank
- **Claim**: A player's assertion of playing 1–2 cards of the target rank, face-down onto the pile
- **Pile**: The face-down stack of cards played during a round
- **Strike**: A penalty point (0–3) awarded to the losing side of a challenge resolution
- **Active_Player**: The player whose turn it is to make a claim
- **Target_Rank**: The randomly chosen rank (Queen/King/Ace/Jack) that all claims in a round must reference
- **Challenge**: The opponent's decision to call "Liar!" and reveal the last claim's actual cards
- **Joker_Effect**: A modifier applied to a round via `activeJokerEffects`, with an expiry trigger
- **Client_Session**: The wire-safe projection of Session that strips server-only fields
- **InvalidTransitionError**: The error thrown when an event is illegal for the current state

## Requirements

### Requirement 1: Session Setup

**User Story:** As a game server, I want to initialize a session from the setup state, so that both players start with a valid deal and a fresh round.

#### Acceptance Criteria

1. WHEN a `SetupComplete` event is received while Session status is `setup`, THE Reducer SHALL transition Session status to `round_active` and append a fresh Round with status `claim_phase`. *(design §1.3 row 1)*
2. WHEN a `SetupComplete` event is processed, THE Reducer SHALL ensure each player has exactly 5 cards, `Session.deck` contains the 10 undealt cards from `initialDeal.remainingDeck`, the pile is empty, both players' `takenCards` are empty, and the target rank is one of Queen, King, Ace, or Jack. *(invariant 2, design §2 Session.deck, design §3.1 RoundDeal)*
3. WHEN a `SetupComplete` event is processed, THE Reducer SHALL ensure the Session contains exactly 3 music track entries (calm, tense, critical). *(design §1.3 row 1)*

### Requirement 2: Deck Integrity

**User Story:** As a game designer, I want the deck to always contain exactly 20 uniquely-identified cards of the correct rank distribution, so that card-counting and probability math are sound.

#### Acceptance Criteria

1. THE FSM SHALL operate on a deck of exactly 20 cards: 5 Queens, 5 Kings, 5 Aces, and 5 Jacks. *(invariant 1)*
2. THE FSM SHALL ensure every Card in the deck has a unique `id` string. *(invariant 1)*

### Requirement 3: Claim Submission

**User Story:** As a player, I want to play 1–2 cards face-down and voice a claim, so that the game advances through the claim phase.

#### Acceptance Criteria

1. WHEN a `ClaimMade` event is received while Round status is `claim_phase`, THE Reducer SHALL transition Round status to `response_phase`. *(design §1.3 row 2)*
2. WHEN a `ClaimMade` event is processed, THE Reducer SHALL validate that `claim.count` is 1 or 2. *(design §1.3 row 2)*
3. WHEN a `ClaimMade` event is processed, THE Reducer SHALL validate that `claim.actualCardIds.length` equals `claim.count` and every ID exists in the active player's hand before removal. *(invariant 3)*
4. WHEN a valid `ClaimMade` event is processed, THE Reducer SHALL remove the claimed cards from the active player's hand and append them to the round's pile. *(design §1.3 row 2)*
5. WHEN a valid `ClaimMade` event is processed, THE Reducer SHALL append the claim to `Round.claimHistory`. *(design §1.3 row 2)*

### Requirement 4: Truth Derivation

**User Story:** As the game engine, I want to derive whether a claim is honest or lying, so that challenge resolution is deterministic.

#### Acceptance Criteria

1. THE Reducer SHALL set `claim.truthState` to `honest` if and only if every card in `claim.actualCardIds` has a rank equal to `claim.claimedRank`. *(invariant 5)*
2. WHEN the active player's hand contains zero cards of the target rank, THE Reducer SHALL accept a lying claim without error. *(invariant 8)*

### Requirement 5: Response Phase

**User Story:** As the responding player, I want to accept or challenge the last claim, so that the round progresses.

#### Acceptance Criteria

1. WHEN a `ClaimAccepted` event is received while Round status is `response_phase`, THE Reducer SHALL check for round-end conditions before swapping the active player and transitioning Round status to `claim_phase`. *(design §1.3 row 3)*
2. WHEN a `ChallengeCalled` event is received while Round status is `response_phase`, THE Reducer SHALL transition Round status to `resolving`. *(design §1.3 row 4)*

### Requirement 6: Challenge Resolution

**User Story:** As the game engine, I want to resolve challenges by revealing cards and distributing strikes, so that bluffing has consequences.

#### Acceptance Criteria

1. WHEN a `RevealComplete` event is received while Round status is `resolving`, THE Reducer SHALL increment the strike counter of exactly one player by 1. *(invariant 9, design §1.4 rule 1)*
2. WHEN a challenge is resolved and the challenger was correct (claim was a lie), THE Reducer SHALL apply the strike to the claimant and append `Round.pile` contents to the claimant's `takenCards` array, then set `Round.pile = []`. *(design §1.3 row 5, §2 PlayerState.takenCards)*
3. WHEN a challenge is resolved and the challenger was wrong (claim was honest), THE Reducer SHALL apply the strike to the challenger and append `Round.pile` contents to the challenger's `takenCards` array, then set `Round.pile = []`. *(design §1.3 row 5)*
4. WHEN a `RevealComplete` event is processed, THE Reducer SHALL move pile cards to the losing player's `takenCards` array, NOT back into any player's hand and NOT to a global discard. *(design §1.3 row 5, §2 PlayerState.takenCards)*
5. WHEN a challenge resolution does not trigger session-end or round-end, THE Reducer SHALL swap the active player and transition Round status to `claim_phase`. *(design §1.3 row 5)*

### Requirement 7: Card Conservation

**User Story:** As a game designer, I want total card count to remain constant throughout the session, so that the game state is always internally consistent.

#### Acceptance Criteria

1. THE FSM SHALL maintain the invariant that `Session.deck.length + player.hand.length + ai.hand.length + Round.pile.length + player.takenCards.length + ai.takenCards.length` equals 20 after every reducer call. All 20 cards accounted for across the six pools. *(invariant 4, design §2 Session.deck + PlayerState.takenCards)*

### Requirement 8: Strike Accumulation

**User Story:** As a game designer, I want strikes to accumulate across rounds without resetting, so that reckless play carries session-level consequences.

#### Acceptance Criteria

1. THE FSM SHALL preserve each player's strike count across round boundaries without resetting. *(design §1.4 rule 2)*
2. WHEN a new round begins after a `JokerPicked` event, THE Reducer SHALL carry forward both players' existing strike counts unchanged. *(design §1.4 rule 2)*

### Requirement 9: Session Loss via Strikes

**User Story:** As a game designer, I want a player who accumulates 3 strikes to immediately lose the session, so that the penalty system has teeth.

#### Acceptance Criteria

1. WHEN a player's strike count reaches 3 after a challenge resolution, THE Reducer SHALL immediately set Session status to `session_over` with `sessionWinner` set to the opponent. *(invariant 10, design §1.4 rule 3)*
2. THE Reducer SHALL evaluate the 3-strike session-loss check AFTER incrementing the strike AND BEFORE evaluating the hand-empty round-end check. *(design §1.4 rule 3)*
3. THE FSM SHALL ensure no single challenge resolution increments both players' strike counts. *(invariant 9, design §1.4 rule 8)*

### Requirement 10: Round Win via Empty Hand

**User Story:** As a player, I want to win a round by emptying my hand through accepted or honest claims, so that skillful play is rewarded.

#### Acceptance Criteria

1. WHEN the active player's hand is empty AND the last claim was accepted or truthful, THE Reducer SHALL transition Round status to `round_over` with `round.winner` set to the active player. *(design §1.4 rule 4)*
2. WHEN the active player lied on their final card and is correctly challenged, THE Reducer SHALL end the round IMMEDIATELY with the opponent as winner and increment the active player's strike by 1. The round does NOT continue with an empty-handed player. *(invariant 6, design §1.4 rule 5)*
3. WHEN the active player played their final card honestly and is wrongly challenged, THE Reducer SHALL end the round IMMEDIATELY with the active player as winner and increment the challenger's strike by 1. *(invariant 7, design §1.4 rule 6)*

### Requirement 11: Session Win via Rounds Won

**User Story:** As a game designer, I want the first player to win 2 rounds to win the session, so that the best-of-3 format is enforced.

#### Acceptance Criteria

1. WHEN a `RoundSettled` event is processed and a player's `roundsWon` reaches 2, THE Reducer SHALL set Session status to `session_over` with `sessionWinner` set to that player. *(invariant 11, design §1.4 rule 7)*
2. THE FSM SHALL determine the session winner as the FIRST condition met: `roundsWon === 2` OR opponent reaches 3 strikes. *(design §1.4 rule 7)*

### Requirement 12: Round Settlement and Joker Offer

**User Story:** As a round winner, I want to be offered a joker pick between rounds, so that I gain a strategic advantage.

#### Acceptance Criteria

1. WHEN a `RoundSettled` event is received while Round status is `round_over` and the session is not over, THE Reducer SHALL transition Session status to `joker_offer`. *(design §1.3 row 6)*
2. WHEN a `RoundSettled` event is received and the session should end, THE Reducer SHALL transition Session status to `session_over`. *(design §1.3 row 6)*
3. WHEN a `JokerPicked` event is received while Session status is `joker_offer`, THE Reducer SHALL append the joker to the round winner's `jokers` array, create a new Round, increment `currentRoundIdx`, and transition Session status to `round_active`. *(design §1.3 row 7)*
4. WHEN a `JokerOfferSkippedSessionOver` event is received while Session status is `joker_offer`, THE Reducer SHALL transition Session status to `session_over`. *(design §1.3 row 8)*

### Requirement 13: Timeout Handling

**User Story:** As the game server, I want timeouts to auto-resolve stalled turns, so that the game never deadlocks.

#### Acceptance Criteria

1. WHEN a `Timeout` event with `kind: 'active_player'` is received during `claim_phase`, THE Reducer SHALL auto-generate a `ClaimMade` using the event's `cardIdToPlay` field (chosen by the caller; the reducer does NOT roll randomness) with `count=1` and `claimedRank = round.targetRank`. *(design §3.1 event union, §3.3)*
2. WHEN a `Timeout` event with `kind: 'active_player'` auto-generates a claim, THE Reducer SHALL set `truthState` to `honest` if the card identified by `cardIdToPlay` has rank equal to `targetRank`, otherwise `lying`. *(design §3.3)*
3. WHEN a `Timeout` event with `kind: 'responder'` is received during `response_phase`, THE Reducer SHALL treat it as a `ClaimAccepted` event. *(design §3.3)*
4. THE Reducer SHALL NEVER call `Math.random()` to select the timeout card — the caller is the sole source of randomness. *(design §3.2 purity contract, invariant 14)*

### Requirement 14: Reducer Purity

**User Story:** As a developer, I want the reducer to be a pure function with no side effects, so that it is deterministic and trivially testable.

#### Acceptance Criteria

1. THE Reducer SHALL return a new Session object and never mutate the input Session. *(design §3.2)*
2. THE Reducer SHALL not call `Date.now()`, `Math.random()`, `fetch`, or any I/O function. *(design §3.2, invariant 14)*
3. WHEN the Reducer is called twice with identical inputs, THE Reducer SHALL return structurally-equal outputs. *(invariant 14)*
4. THE Reducer SHALL accept all randomness and timestamps via the event payload or the input Session. *(design §3.2)*

### Requirement 15: Invalid Transition Rejection

**User Story:** As a developer, I want the reducer to throw on illegal state/event combinations, so that bugs surface immediately rather than producing corrupt state.

#### Acceptance Criteria

1. WHEN an event is received that is not valid for the current Session or Round status, THE Reducer SHALL throw an `InvalidTransitionError` containing the current state and the event type. *(invariant 15)*
2. THE Reducer SHALL never silently ignore an invalid event. *(design §3.2)*

### Requirement 16: Client View Isolation

**User Story:** As a game server, I want to produce a client-safe projection of the session, so that server-only secrets never leak to the browser.

#### Acceptance Criteria

1. WHEN `toClientView` is called, THE FSM SHALL produce a `ClientSession` that contains zero `actualCardIds` fields anywhere in the output. *(invariant 12)*
2. WHEN `toClientView` is called, THE FSM SHALL replace the opponent's `hand` array with a `handSize` number. *(invariant 12)*
3. WHEN `toClientView` is called, THE FSM SHALL strip `llmReasoning` from opponent claims. *(design §3.4)*
4. WHEN `toClientView` is called, THE FSM SHALL map `Round[]` to `ClientRound[]` with `claimHistory: PublicClaim[]` and `pileSize` instead of `pile`. *(design §3.4)*
5. WHEN `toClientView` is called with viewer `'player'`, THE FSM SHALL include the player's own hand and hide the AI's hand, and vice versa for viewer `'ai'`. *(design §3.4)*

### Requirement 17: Session End Check Helper

**User Story:** As the reducer, I want a helper that determines if the session should end, so that end-condition logic is centralized and testable.

#### Acceptance Criteria

1. WHEN a player has `strikes === 3`, THE `checkSessionEnd` helper SHALL return the opponent as winner. *(design §3.4)*
2. WHEN a player has `roundsWon === 2`, THE `checkSessionEnd` helper SHALL return that player as winner. *(design §3.4)*
3. WHEN both a strike-3 loss and a rounds-won-2 win could apply, THE `checkSessionEnd` helper SHALL prioritize the strike-3 loss. *(design §3.4)*
4. WHEN neither end condition is met, THE `checkSessionEnd` helper SHALL return null. *(design §3.4)*

### Requirement 18: Round End Check Helper

**User Story:** As the reducer, I want a helper that determines if a round should end, so that hand-empty detection is centralized.

#### Acceptance Criteria

1. WHEN the active player's hand size is 0 AND the last claim in the round was accepted or truthful, THE `checkRoundEnd` helper SHALL return true. *(design §3.4)*
2. NOTE: the caught-on-final-card-lie case is handled directly in the `RevealComplete` transition (see Req 10.2) — it does NOT flow through `checkRoundEnd`. `checkRoundEnd` only evaluates hand-empty after an accepted or truthful claim. *(design §3.4, design §1.4 rule 5)*

### Requirement 19: Joker Effect Slot Management

**User Story:** As the game engine, I want to apply and expire joker effects on rounds, so that joker modifiers integrate cleanly with the FSM.

#### Acceptance Criteria

1. WHEN `applyJokerEffect` is called with a joker that has `next_claim` expiry, THE FSM SHALL push the effect onto `Round.activeJokerEffects`. *(design §3.4)*
2. WHEN `expireJokerEffects` is called with a trigger, THE FSM SHALL remove all effects from `Round.activeJokerEffects` whose `expiresAfter` matches the trigger. *(design §3.4)*
3. THE `applyJokerEffect` and `expireJokerEffects` functions SHALL return new Round objects without mutating the input. *(design §3.2 purity contract)*

### Requirement 21: Inter-Round Reshuffle and Redeal

**User Story:** As a game designer, I want each round to start with a fresh 5-card hand for each player, so that best-of-3 rounds remain fully playable regardless of round-1 residue.

#### Acceptance Criteria

1. WHEN a `JokerPicked` event is processed, THE Reducer SHALL consume the `nextRoundDeal` payload from the event — containing fresh 5-card `playerHand`, 5-card `aiHand`, 10-card `remainingDeck`, new `targetRank`, and `activePlayer` — and install all three card pools (`player.hand`, `ai.hand`, `Session.deck`) on a newly-appended `Round`. *(design §1.3 row 7, §1.4 rule 9)*
2. WHEN `JokerPicked` is processed, THE Reducer SHALL reset both players' `takenCards` arrays to `[]` and the new round's `pile` to `[]`. `Session.deck` is replaced with `nextRoundDeal.remainingDeck` (length === 10). *(design §1.4 rule 9, invariant 16)*
3. WHEN `JokerPicked` is processed, THE Reducer SHALL carry forward `strikes`, `roundsWon`, and `jokers` unchanged on both `PlayerState` objects. *(design §1.4 rule 9, invariant 16)*
4. THE Reducer SHALL NEVER call `shuffleDeck()` or otherwise re-shuffle inside the reducer — the caller computes `nextRoundDeal` prior to firing `JokerPicked`. *(design §3.2 purity contract)*
5. WHEN `JokerPicked` is processed, THE Reducer SHALL increment `Session.currentRoundIdx` and transition `Session.status` from `joker_offer` to `round_active`. *(design §1.3 row 7)*

### Requirement 20: State Machine Completeness

**User Story:** As a developer, I want every valid state/event pair to be handled, so that the FSM has no undefined transitions.

#### Acceptance Criteria

1. THE Reducer SHALL handle all 9 transitions defined in the transition table: `SetupComplete`, `ClaimMade`, `ClaimAccepted`, `ChallengeCalled`, `RevealComplete`, `RoundSettled`, `JokerPicked`, `JokerOfferSkippedSessionOver`, and `Timeout`. *(design §1.3)*
2. WHEN Session status is `session_over`, THE Reducer SHALL throw `InvalidTransitionError` for any event. *(design §1.1 — terminal state)*

---

## Invariant Cross-Reference

Every design.md §4 invariant maps to at least one numbered acceptance criterion:

| Invariant | Requirement(s) |
|---|---|
| 1 — Deck size | 2.1, 2.2 |
| 2 — Deal | 1.2 |
| 3 — Claim validation | 3.2, 3.3 |
| 4 — Card conservation | 7.1 |
| 5 — Truth derivation | 4.1 |
| 6 — Caught-on-final-card-lie → round ends opponent-wins | 10.2 |
| 7 — Honest-final-wrongly-challenged → round ends active-wins | 10.3 |
| 8 — Forced-lie | 4.2 |
| 9 — Simultaneous strike-3 impossible | 6.1, 9.3 |
| 10 — Session loss trigger | 9.1 |
| 11 — Best-of-3 win trigger | 11.1 |
| 12 — toClientView isolation | 16.1, 16.2 |
| 13 — Misdirector preset invariant | Out of scope (voice-tell-taxonomy spec) |
| 14 — Reducer purity | 14.2, 14.3 |
| 15 — Invalid transitions throw | 15.1 |
| 16 — Inter-round reshuffle+redeal | 21.1, 21.2, 21.3, 21.5 |
