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

  // Invariant 3 — count consistency
  if (
    (claim.count !== 1 && claim.count !== 2) ||
    claim.actualCardIds.length !== claim.count
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
    // Tasks 5-8 will fill these in; stub all remaining events.
    case 'ClaimAccepted':
    case 'ChallengeCalled':
    case 'RevealComplete':
    case 'RoundSettled':
    case 'JokerPicked':
    case 'JokerOfferSkippedSessionOver':
    case 'Timeout':
      throw new InvalidTransitionError(session.status, event.type);
  }
}
