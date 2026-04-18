// Game-engine spec §3.4 — pure reducer helpers.
//
// This file will grow as tasks land: Task 2 adds the four end-check + joker
// helpers below; Task 4 onward will add the `reduce()` dispatch + per-event
// transitions. All helpers here are pure — no I/O, no `Date.now()`, no
// `Math.random()`. Caller owns randomness and time.

import type {
  ActiveJokerEffect,
  Card,
  Claim,
  GameEvent,
  JokerType,
  PlayerState,
  Rank,
  Round,
  Session,
} from './types';
import { InvalidTransitionError } from './types';

/**
 * Determine session winner if the session should end, else `null`.
 *
 * Priority (spec §1.4 rules 3 + 7):
 *   1. `strikes === 3` → opponent wins (checked before rounds-won)
 *   2. `roundsWon === 2` → that player wins
 *
 * Invariants 10 + 11 flow through this helper.
 */
export function checkSessionEnd(session: Session): 'player' | 'ai' | null {
  if (session.player.strikes >= 3) return 'ai';
  if (session.ai.strikes >= 3) return 'player';
  if (session.player.roundsWon >= 2) return 'player';
  if (session.ai.roundsWon >= 2) return 'ai';
  return null;
}

/**
 * Round-end check invoked ONLY from the `ClaimAccepted` transition
 * (spec §3.4, tasks.md task 2.5 clarification).
 *
 * The caught-on-final-card branches are resolved in `RevealComplete` (see
 * invariants 6 + 7) — this helper does not see them. By the time a caller
 * reaches here, the last claim was already accepted. The only remaining
 * question is whether the play emptied the active player's hand: if yes,
 * active wins the round; otherwise the round continues.
 *
 * The `round` arg is kept in the signature for future-proofing (e.g. if a
 * joker effect later changes the end-of-round predicate) but is not read.
 */
export function checkRoundEnd(
  _round: Round,
  activePlayer: 'player' | 'ai',
  activePlayerHandSize: number,
): { ended: true; winner: 'player' | 'ai' } | { ended: false } {
  if (activePlayerHandSize === 0) {
    return { ended: true, winner: activePlayer };
  }
  return { ended: false };
}

/**
 * Push a joker effect onto the round with `next_claim` expiry. Effects
 * with `session` or `next_challenge` expiry are owned by the joker-system
 * spec — this FSM only fills the slot for `next_claim` here.
 *
 * Returns a new `Round`; never mutates the input.
 */
export function applyJokerEffect(round: Round, joker: JokerType): Round {
  const effect: ActiveJokerEffect = {
    type: joker,
    expiresAfter: 'next_claim',
  };
  return {
    ...round,
    activeJokerEffects: [...round.activeJokerEffects, effect],
  };
}

/**
 * Remove effects whose `expiresAfter` matches the trigger. Non-matching
 * effects (including `session`-lived ones) are preserved.
 *
 * Returns a new `Round`; never mutates the input.
 */
export function expireJokerEffects(
  round: Round,
  trigger: 'next_claim' | 'next_challenge',
): Round {
  return {
    ...round,
    activeJokerEffects: round.activeJokerEffects.filter(
      (e) => e.expiresAfter !== trigger,
    ),
  };
}

// ---------------------------------------------------------------------------
// Transition helpers (private — not exported)
// ---------------------------------------------------------------------------

const VALID_TARGET_RANKS: Rank[] = ['Queen', 'King', 'Ace', 'Jack'];

/** spec §1.3 row 1 */
function setupComplete(
  session: Session,
  event: Extract<GameEvent, { type: 'SetupComplete' }>,
): Session {
  if (session.status !== 'setup') {
    throw new InvalidTransitionError(session.status, event.type);
  }

  const { initialDeal, musicTracks } = event;

  if (
    initialDeal.playerHand.length !== 5 ||
    initialDeal.aiHand.length !== 5 ||
    initialDeal.remainingDeck.length !== 10 ||
    !VALID_TARGET_RANKS.includes(initialDeal.targetRank) ||
    musicTracks.length !== 3
  ) {
    throw new InvalidTransitionError('setup(invalid initialDeal)', event.type);
  }

  const newRound: Round = {
    roundNumber: 1,
    targetRank: initialDeal.targetRank,
    activePlayer: initialDeal.activePlayer,
    pile: [],
    claimHistory: [],
    status: 'claim_phase',
    activeJokerEffects: [],
    tensionLevel: 0,
  };

  return {
    ...session,
    status: 'round_active',
    deck: initialDeal.remainingDeck,
    player: { ...session.player, hand: initialDeal.playerHand },
    ai: { ...session.ai, hand: initialDeal.aiHand },
    rounds: [...session.rounds, newRound],
    currentRoundIdx: 0,
    musicTracks,
  };
}

/** spec §1.3 row 3 — ClaimAccepted */
function claimAccepted(
  session: Session,
  event: Extract<GameEvent, { type: 'ClaimAccepted' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (!currentRound || currentRound.status !== 'response_phase') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  const activeKey = currentRound.activePlayer;
  const activeHandSize = session[activeKey].hand.length;
  const roundEndResult = checkRoundEnd(currentRound, activeKey, activeHandSize);

  if (roundEndResult.ended) {
    const newRound: Round = {
      ...currentRound,
      status: 'round_over',
      winner: roundEndResult.winner,
    };
    return {
      ...session,
      rounds: session.rounds.map((r, i) =>
        i === session.currentRoundIdx ? newRound : r,
      ),
    };
  }

  // Swap active player and continue
  const nextActive: 'player' | 'ai' = activeKey === 'player' ? 'ai' : 'player';
  const newRound: Round = {
    ...currentRound,
    activePlayer: nextActive,
    status: 'claim_phase',
  };
  return {
    ...session,
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? newRound : r,
    ),
  };
}

/** spec §1.3 row 4 — ChallengeCalled */
function challengeCalled(
  session: Session,
  event: Extract<GameEvent, { type: 'ChallengeCalled' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (!currentRound || currentRound.status !== 'response_phase') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  const newRound: Round = { ...currentRound, status: 'resolving' };
  return {
    ...session,
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? newRound : r,
    ),
  };
}

/** spec §1.3 row 5 + §1.4 rules 1-8 — RevealComplete */
function revealComplete(
  session: Session,
  event: Extract<GameEvent, { type: 'RevealComplete' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (!currentRound || currentRound.status !== 'resolving') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  const { challengeWasCorrect } = event;
  const lastClaim = currentRound.claimHistory[currentRound.claimHistory.length - 1];
  if (!lastClaim) {
    throw new InvalidTransitionError('resolving(no claim history)', event.type);
  }

  // Step 1: determine who takes the strike
  // challengeWasCorrect=true → claimant was caught lying → claimant loses
  // challengeWasCorrect=false → challenger was wrong → challenger (non-claimant) loses
  const claimantKey = lastClaim.by; // 'player' | 'ai'
  const opponentKey: 'player' | 'ai' = claimantKey === 'player' ? 'ai' : 'player';
  const loserKey: 'player' | 'ai' = challengeWasCorrect ? claimantKey : opponentKey;
  const winnerKey: 'player' | 'ai' = loserKey === 'player' ? 'ai' : 'player';

  // Step 2: pile → loser's takenCards; clear pile
  const loserAfterPile = {
    ...session[loserKey],
    strikes: session[loserKey].strikes + 1,
    takenCards: [...session[loserKey].takenCards, ...currentRound.pile],
  };

  // Build intermediate session with strike+pile applied
  const sessionWithStrike: Session = {
    ...session,
    [loserKey]: loserAfterPile,
  };

  const activeKey = currentRound.activePlayer;

  // Step 3: session-end check (strikes===3) — FIRST
  if (loserAfterPile.strikes >= 3) {
    const finalRound: Round = {
      ...currentRound,
      pile: [],
      status: 'round_over',
      winner: winnerKey,
    };
    return {
      ...sessionWithStrike,
      status: 'session_over',
      sessionWinner: winnerKey,
      rounds: session.rounds.map((r, i) =>
        i === session.currentRoundIdx ? finalRound : r,
      ),
    };
  }

  // Step 4: caught-on-final-card-lie → opponent wins round
  if (sessionWithStrike[activeKey].hand.length === 0 && challengeWasCorrect === true) {
    const opponentOfActive: 'player' | 'ai' = activeKey === 'player' ? 'ai' : 'player';
    const finalRound: Round = {
      ...currentRound,
      pile: [],
      status: 'round_over',
      winner: opponentOfActive,
    };
    return {
      ...sessionWithStrike,
      rounds: session.rounds.map((r, i) =>
        i === session.currentRoundIdx ? finalRound : r,
      ),
    };
  }

  // Step 5: honest-final-wrongly-challenged → active wins round
  if (sessionWithStrike[activeKey].hand.length === 0 && challengeWasCorrect === false) {
    const finalRound: Round = {
      ...currentRound,
      pile: [],
      status: 'round_over',
      winner: activeKey,
    };
    return {
      ...sessionWithStrike,
      rounds: session.rounds.map((r, i) =>
        i === session.currentRoundIdx ? finalRound : r,
      ),
    };
  }

  // Step 6: swap active player, back to claim_phase
  const nextActive: 'player' | 'ai' = activeKey === 'player' ? 'ai' : 'player';
  const continuedRound: Round = {
    ...currentRound,
    pile: [],
    activePlayer: nextActive,
    status: 'claim_phase',
  };
  return {
    ...sessionWithStrike,
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? continuedRound : r,
    ),
  };
}

/** spec §1.3 row 7 — RoundSettled */
function roundSettled(
  session: Session,
  event: Extract<GameEvent, { type: 'RoundSettled' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (!currentRound || currentRound.status !== 'round_over') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  const winner = currentRound.winner;
  if (!winner) {
    throw new InvalidTransitionError('round_over(no winner set)', event.type);
  }

  // Increment roundsWon for the round winner
  const updatedSession: Session = {
    ...session,
    [winner]: {
      ...session[winner],
      roundsWon: session[winner].roundsWon + 1,
    },
  };

  const sessionWinner = checkSessionEnd(updatedSession);
  if (sessionWinner !== null) {
    return {
      ...updatedSession,
      status: 'session_over',
      sessionWinner,
    };
  }

  return {
    ...updatedSession,
    status: 'joker_offer',
  };
}

/** spec §1.3 rows 8 + §1.4 rule 9 — JokerPicked */
function jokerPicked(
  session: Session,
  event: Extract<GameEvent, { type: 'JokerPicked' }>,
): Session {
  if (session.status !== 'joker_offer') {
    throw new InvalidTransitionError(session.status, event.type);
  }

  const currentRound = session.rounds[session.currentRoundIdx];
  const winnerKey = currentRound?.winner;
  if (!winnerKey) {
    throw new InvalidTransitionError('joker_offer(no round winner)', event.type);
  }

  const { joker, nextRoundDeal } = event;

  // Append joker to winner's jokers array
  const updatedWinner: PlayerState = {
    ...session[winnerKey],
    jokers: [...session[winnerKey].jokers, joker],
    hand: winnerKey === 'player' ? nextRoundDeal.playerHand : nextRoundDeal.aiHand,
    takenCards: [], // §1.4 rule 9: inter-round reshuffle clears takenCards
  };

  const loserKey: 'player' | 'ai' = winnerKey === 'player' ? 'ai' : 'player';
  const updatedLoser: PlayerState = {
    ...session[loserKey],
    hand: loserKey === 'player' ? nextRoundDeal.playerHand : nextRoundDeal.aiHand,
    takenCards: [], // §1.4 rule 9
  };

  const newRoundNumber = (session.currentRoundIdx + 2) as 1 | 2 | 3;
  const newRound: Round = {
    roundNumber: newRoundNumber,
    targetRank: nextRoundDeal.targetRank,
    activePlayer: nextRoundDeal.activePlayer,
    pile: [],
    claimHistory: [],
    status: 'claim_phase',
    activeJokerEffects: [],
    tensionLevel: 0,
  };

  return {
    ...session,
    status: 'round_active',
    deck: nextRoundDeal.remainingDeck,
    player: winnerKey === 'player' ? updatedWinner : updatedLoser,
    ai: winnerKey === 'ai' ? updatedWinner : updatedLoser,
    rounds: [...session.rounds, newRound],
    currentRoundIdx: session.currentRoundIdx + 1,
  };
}

/** spec §1.3 row 9 — JokerOfferSkippedSessionOver */
function jokerOfferSkippedSessionOver(
  session: Session,
  event: Extract<GameEvent, { type: 'JokerOfferSkippedSessionOver' }>,
): Session {
  if (session.status !== 'joker_offer') {
    throw new InvalidTransitionError(session.status, event.type);
  }

  const sessionWinner = checkSessionEnd(session);
  return {
    ...session,
    status: 'session_over',
    ...(sessionWinner !== null ? { sessionWinner } : {}),
  };
}

/** spec §1.3 row 2 */
function claimMade(
  session: Session,
  event: Extract<GameEvent, { type: 'ClaimMade' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (!currentRound || currentRound.status !== 'claim_phase') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  const { claim } = event;
  const activeKey = currentRound.activePlayer; // 'player' | 'ai'
  const activeState = session[activeKey];

  // Invariant 3 — count consistency (incl. no duplicate IDs within a 2-card claim,
  // else Invariant 4 card-conservation breaks: pile gains 2 copies but hand loses 1)
  if (
    (claim.count !== 1 && claim.count !== 2) ||
    claim.actualCardIds.length !== claim.count ||
    new Set(claim.actualCardIds).size !== claim.count
  ) {
    throw new InvalidTransitionError(
      'round_active(invalid claim count)',
      event.type,
    );
  }

  // Invariant 3 — every ID must exist in active player's current hand
  const handMap = new Map<string, Card>(activeState.hand.map((c) => [c.id, c]));
  for (const id of claim.actualCardIds) {
    if (!handMap.has(id)) {
      throw new InvalidTransitionError(
        'round_active(card not in hand)',
        event.type,
      );
    }
  }

  // Invariant 5 — derive truthState server-side (overwrite whatever caller sent)
  const playedCards = claim.actualCardIds.map((id) => handMap.get(id)!);
  const truthState: Claim['truthState'] = playedCards.every(
    (c) => c.rank === claim.claimedRank,
  )
    ? 'honest'
    : 'lying';

  const derivedClaim: Claim = { ...claim, truthState };

  // Remove played cards from hand; append to pile
  const playedSet = new Set(claim.actualCardIds);
  const newHand = activeState.hand.filter((c) => !playedSet.has(c.id));
  const newPile = [...currentRound.pile, ...playedCards];

  const newRound: Round = {
    ...currentRound,
    pile: newPile,
    claimHistory: [...currentRound.claimHistory, derivedClaim],
    status: 'response_phase',
  };

  const updatedActiveState = { ...activeState, hand: newHand };

  return {
    ...session,
    [activeKey]: updatedActiveState,
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? newRound : r,
    ),
  };
}

/** spec §1.3 Timeout row + §3.3 */
function timeout(
  session: Session,
  event: Extract<GameEvent, { type: 'Timeout' }>,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];

  if (event.kind === 'active_player') {
    if (!currentRound || currentRound.status !== 'claim_phase') {
      throw new InvalidTransitionError(
        `round_active(round.status=${currentRound?.status ?? 'none'})`,
        event.type,
      );
    }

    const activeKey = currentRound.activePlayer;
    const activeHand = session[activeKey].hand;
    const card = activeHand.find((c) => c.id === event.cardIdToPlay);
    if (!card) {
      throw new InvalidTransitionError(
        'round_active(timeout card not in hand)',
        event.type,
      );
    }

    const syntheticClaim: Claim = {
      by: activeKey,
      count: 1,
      claimedRank: currentRound.targetRank,
      actualCardIds: [event.cardIdToPlay],
      truthState: card.rank === currentRound.targetRank ? 'honest' : 'lying',
      timestamp: event.now,
    };

    return claimMade(session, {
      type: 'ClaimMade',
      claim: syntheticClaim,
      now: event.now,
    });
  }

  // kind === 'responder'
  if (!currentRound || currentRound.status !== 'response_phase') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }

  return claimAccepted(session, { type: 'ClaimAccepted', now: event.now });
}

// ---------------------------------------------------------------------------
// Public reducer — spec §3.2
// ---------------------------------------------------------------------------

/**
 * Pure FSM reducer. Dispatches on `event.type` and delegates to the
 * appropriate transition helper. Throws `InvalidTransitionError` for any
 * event fired in `session_over` (terminal guard, §1.3 last row) or for
 * events not yet implemented in this task iteration.
 */
export function reduce(session: Session, event: GameEvent): Session {
  // Terminal guard — §1.3 last row
  if (session.status === 'session_over') {
    throw new InvalidTransitionError(session.status, event.type);
  }

  switch (event.type) {
    case 'SetupComplete':
      return setupComplete(session, event);
    case 'ClaimMade':
      return claimMade(session, event);
    case 'ClaimAccepted':
      return claimAccepted(session, event);
    case 'ChallengeCalled':
      return challengeCalled(session, event);
    case 'RevealComplete':
      return revealComplete(session, event);
    case 'RoundSettled':
      return roundSettled(session, event);
    case 'JokerPicked':
      return jokerPicked(session, event);
    case 'JokerOfferSkippedSessionOver':
      return jokerOfferSkippedSessionOver(session, event);
    case 'Timeout':
      return timeout(session, event);
  }
}
