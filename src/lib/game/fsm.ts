// Game-engine spec §3.4 — pure reducer helpers.
//
// This file will grow as tasks land: Task 2 adds the four end-check + joker
// helpers below; Task 4 onward will add the `reduce()` dispatch + per-event
// transitions. All helpers here are pure — no I/O, no `Date.now()`, no
// `Math.random()`. Caller owns randomness and time.

import type {
  ActiveJokerEffect,
  ActiveProbe,
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
import { seedDrawPile, canActivate, advanceSlot } from '../jokers/lifecycle';
import { JOKER_CATALOG } from '../jokers/catalog';

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
 *
 * @pending consumer — exported + tested, but not yet called by `reduce()`.
 *   Consumed by the `joker-system` spec (forthcoming). Keep the API shape
 *   stable; do not inline into a caller until that spec lands.
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
 *
 * @pending consumer — exported + tested, but not yet called by `reduce()`.
 *   Consumed by the `joker-system` spec (forthcoming).
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
    jokerTriggeredThisRound: [],
  };

  return {
    ...session,
    status: 'round_active',
    deck: initialDeal.remainingDeck,
    player: { ...session.player, hand: initialDeal.playerHand, jokerSlots: [] },
    ai: { ...session.ai, hand: initialDeal.aiHand, jokerSlots: [] },
    rounds: [...session.rounds, newRound],
    currentRoundIdx: 0,
    musicTracks,
    jokerDrawPile: event.initialJokerDrawPile ?? seedDrawPile(),
    discardedJokers: [],
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
  if (currentRound.activeProbe !== undefined) {
    throw new InvalidTransitionError(
      `round_active(probe_active)`,
      event.type,
    );
  }

  const activeKey = currentRound.activePlayer;
  const activeHandSize = session[activeKey].hand.length;
  const roundEndResult = checkRoundEnd(currentRound, activeKey, activeHandSize);

  // Req 9.1, 9.2 — expire next_claim and next_challenge effects on ClaimAccepted boundary
  let expiredRound = expireJokerEffects(currentRound, 'next_claim');
  expiredRound = expireJokerEffects(expiredRound, 'next_challenge');

  if (roundEndResult.ended) {
    const newRound: Round = {
      ...expiredRound,
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
    ...expiredRound,
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
  if (currentRound.activeProbe !== undefined) {
    throw new InvalidTransitionError(
      `round_active(probe_active)`,
      event.type,
    );
  }

  // Req 9.1, 9.2 — expire next_claim and next_challenge effects on ChallengeCalled boundary
  let expiredRound = expireJokerEffects(currentRound, 'next_claim');
  expiredRound = expireJokerEffects(expiredRound, 'next_challenge');

  const newRound: Round = {
    ...expiredRound,
    status: 'resolving',
  };

  // §7.4.3 — clear autopsy on next ChallengeCalled
  const { autopsy: _autopsy, ...sessionWithoutAutopsy } = session;
  return {
    ...sessionWithoutAutopsy,
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

  // Step 1: determine who takes the strike.
  // challengeWasCorrect=true → claimant was caught lying → claimant (= activePlayer) loses.
  // challengeWasCorrect=false → challenger was wrong → challenger (non-activePlayer) loses.
  const claimantKey = lastClaim.by; // 'player' | 'ai'
  const opponentKey: 'player' | 'ai' = claimantKey === 'player' ? 'ai' : 'player';
  const challengerKey: 'player' | 'ai' = opponentKey; // challenger is always the non-claimant
  const loserKey: 'player' | 'ai' = challengeWasCorrect ? claimantKey : opponentKey;
  const winnerKey: 'player' | 'ai' = loserKey === 'player' ? 'ai' : 'player';

  // Step 1b: Second Wind auto-consume (Req 14.1, 14.2, 14.4).
  // If loserKey holds a 'held' second_wind, consume it and cancel the incoming strike.
  let secondWindConsumed = false;
  let playerSlotsAfterSW = session.player.jokerSlots ?? [];
  let aiSlotsAfterSW = session.ai.jokerSlots ?? [];
  const loserSlots = session[loserKey].jokerSlots ?? [];
  const hasHeldSecondWind = loserSlots.some(
    (s) => s.joker === 'second_wind' && s.state === 'held',
  );
  if (hasHeldSecondWind) {
    const advancedSlots = advanceSlot(loserSlots, 'second_wind', session.currentRoundIdx);
    if (loserKey === 'player') {
      playerSlotsAfterSW = advancedSlots;
    } else {
      aiSlotsAfterSW = advancedSlots;
    }
    secondWindConsumed = true;
  }

  // Step 1c: Earful auto-consume (Req 12.1, 12.3).
  // Fires when the PLAYER is the challenger and wins (challengeWasCorrect=true means
  // claimant lied → challenger won). AI jokers never activate in v1.
  let earfulConsumed = false;
  let autopsy: Session['autopsy'] = session.autopsy;
  if (challengeWasCorrect && challengerKey === 'player') {
    // Player holds earful and just won the challenge — consume + set autopsy.
    const challSlotsNow = playerSlotsAfterSW; // may already reflect SW consume (different joker)
    const hasHeldEarful = challSlotsNow.some(
      (s) => s.joker === 'earful' && s.state === 'held',
    );
    if (hasHeldEarful) {
      playerSlotsAfterSW = advanceSlot(challSlotsNow, 'earful', session.currentRoundIdx);
      const claimIdx = currentRound.claimHistory.length - 1;
      autopsy = {
        preset: lastClaim.voicePreset ?? 'unknown',
        roundIdx: session.currentRoundIdx,
        turnIdx: claimIdx,
      };
      earfulConsumed = true;
    }
  }

  // Step 1d: accumulate jokerTriggeredThisRound
  const prevTriggered = currentRound.jokerTriggeredThisRound ?? [];
  const newTriggered: JokerType[] = [
    ...prevTriggered,
    ...(secondWindConsumed ? (['second_wind'] as JokerType[]) : []),
    ...(earfulConsumed ? (['earful'] as JokerType[]) : []),
  ];

  // Step 2: pile → loser's takenCards; apply strike (cancelled if Second Wind fired).
  const loserAfterPile = {
    ...session[loserKey],
    strikes: secondWindConsumed
      ? session[loserKey].strikes
      : session[loserKey].strikes + 1,
    takenCards: [...session[loserKey].takenCards, ...currentRound.pile],
    jokerSlots: loserKey === 'player' ? playerSlotsAfterSW : aiSlotsAfterSW,
  };

  // Winner gets updated slots (Earful may have been consumed from the winner's slots).
  const winnerAfterSlots = {
    ...session[winnerKey],
    jokerSlots: winnerKey === 'player' ? playerSlotsAfterSW : aiSlotsAfterSW,
  };

  // Build intermediate session with strike+pile+slots applied.
  const sessionWithStrike: Session = {
    ...session,
    [loserKey]: loserAfterPile,
    [winnerKey]: winnerAfterSlots,
    ...(autopsy !== session.autopsy ? { autopsy } : {}),
  };

  const activeKey = currentRound.activePlayer;

  // Step 3: session-end check (strikes===3) — FIRST
  if (loserAfterPile.strikes >= 3) {
    const finalRound: Round = {
      ...currentRound,
      pile: [],
      status: 'round_over',
      winner: winnerKey,
      jokerTriggeredThisRound: newTriggered,
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
      jokerTriggeredThisRound: newTriggered,
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
      jokerTriggeredThisRound: newTriggered,
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
    jokerTriggeredThisRound: newTriggered,
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

  // §7.4.3 / Req 12.4 — clear autopsy on RoundSettled (same as ChallengeCalled)
  const { autopsy: _droppedAutopsy, ...sessionWithoutAutopsy } = session;

  // Increment roundsWon for the round winner
  const updatedSession: Session = {
    ...sessionWithoutAutopsy,
    [winner]: {
      ...sessionWithoutAutopsy[winner],
      roundsWon: sessionWithoutAutopsy[winner].roundsWon + 1,
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

  // Validate currentOffer exists
  if (!session.currentOffer) {
    throw new InvalidTransitionError('joker_offer(no_current_offer)', event.type);
  }

  const { joker, nextRoundDeal } = event;

  // Validate joker is in offer
  if (!session.currentOffer.offered.includes(joker)) {
    throw new InvalidTransitionError('joker_offer(joker_not_offered)', event.type);
  }

  // Validate slot cap — winner may not hold more than 3 jokers simultaneously
  const winnerHeldCount =
    session[winnerKey].jokerSlots?.filter((s) => s.state === 'held').length ?? 0;
  if (winnerHeldCount >= 3) {
    throw new InvalidTransitionError('joker_offer(slot_cap_exceeded)', event.type);
  }

  // Build new JokerSlot — acquiredRoundIdx is the NEXT round (current + 1)
  const newSlot = {
    joker,
    acquiredAt: event.now,
    state: 'held' as const,
    acquiredRoundIdx: session.currentRoundIdx + 1,
  };

  // Compute newly-discarded jokers (all offered except the picked one)
  const newlyDiscarded = session.currentOffer.offered.filter((t) => t !== joker);

  // Append joker to winner's jokers array + slots
  const updatedWinner: PlayerState = {
    ...session[winnerKey],
    jokers: [...session[winnerKey].jokers, joker],
    jokerSlots: [...(session[winnerKey].jokerSlots ?? []), newSlot],
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
    jokerTriggeredThisRound: [],
  };

  // Drop currentOffer from returned session (clear after pick)
  const { currentOffer: _dropped, ...sessionWithoutOffer } = session;

  return {
    ...sessionWithoutOffer,
    status: 'round_active',
    deck: nextRoundDeal.remainingDeck,
    player: winnerKey === 'player' ? updatedWinner : updatedLoser,
    ai: winnerKey === 'ai' ? updatedWinner : updatedLoser,
    rounds: [...session.rounds, newRound],
    currentRoundIdx: session.currentRoundIdx + 1,
    discardedJokers: [...(session.discardedJokers ?? []), ...newlyDiscarded],
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

/** joker-system spec §7.1.1 — JokerOffered */
function jokerOffered(
  session: Session,
  event: Extract<GameEvent, { type: 'JokerOffered' }>,
): Session {
  if (session.status !== 'joker_offer') {
    throw new InvalidTransitionError(session.status, event.type);
  }
  const currentRound = session.rounds[session.currentRoundIdx];
  const winnerKey = currentRound?.winner;
  if (!winnerKey) {
    throw new InvalidTransitionError('joker_offer(no round winner)', event.type);
  }
  // Set currentOffer and replace jokerDrawPile with caller-computed updated pile.
  return {
    ...session,
    currentOffer: {
      offered: [...event.offered],
      offeredToWinner: winnerKey,
    },
    jokerDrawPile: [...event.newDrawPile],
  };
}

/** joker-system spec §7.1.1 — JokerOfferEmpty (pile exhausted at offer time) */
function jokerOfferEmpty(
  session: Session,
  event: Extract<GameEvent, { type: 'JokerOfferEmpty' }>,
): Session {
  if (session.status !== 'joker_offer') {
    throw new InvalidTransitionError(session.status, event.type);
  }
  if (!session.jokerDrawPile || session.jokerDrawPile.length !== 0) {
    throw new InvalidTransitionError('joker_offer(pile_not_empty)', event.type);
  }
  // Transition directly to next round — same round-creation pattern as
  // JokerPicked's post-conditions, but without any joker being added.
  const { nextRoundDeal } = event;
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
    jokerTriggeredThisRound: [],
  };
  return {
    ...session,
    status: 'round_active',
    deck: nextRoundDeal.remainingDeck,
    player: {
      ...session.player,
      hand: nextRoundDeal.playerHand,
      takenCards: [],
    },
    ai: {
      ...session.ai,
      hand: nextRoundDeal.aiHand,
      takenCards: [],
    },
    rounds: [...session.rounds, newRound],
    currentRoundIdx: session.currentRoundIdx + 1,
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

/** joker-system spec §7.1 — UseJoker (Req 8.1-8.5) */
function useJoker(
  session: Session,
  event: Extract<GameEvent, { type: 'UseJoker' }>,
): Session {
  if (session.status !== 'round_active') {
    throw new InvalidTransitionError(session.status, event.type);
  }
  // Req 8.5 — second_wind auto-consumes in RevealComplete, never via UseJoker.
  if (event.joker === 'second_wind') {
    throw new InvalidTransitionError('round_active(second_wind_auto_only)', event.type);
  }
  const currentRound = session.rounds[session.currentRoundIdx];
  if (!currentRound) {
    throw new InvalidTransitionError('round_active(no current round)', event.type);
  }
  const activator = session[event.by];
  const heldMatch = (activator.jokerSlots ?? []).some(
    (s) => s.joker === event.joker && s.state === 'held',
  );
  if (!heldMatch) {
    throw new InvalidTransitionError('round_active(joker_not_held)', event.type);
  }
  const triggered = currentRound.jokerTriggeredThisRound ?? [];
  // canActivate checks trigger-window AND stacking (jokerTriggeredThisRound).
  const ok = canActivate(
    event.joker,
    currentRound.status,
    currentRound.activePlayer,
    event.by,
    triggered,
  );
  if (!ok) {
    // Distinguish stacking vs trigger-window mismatch for clearer error messages.
    if (triggered.includes(event.joker)) {
      throw new InvalidTransitionError(
        'round_active(joker_already_triggered_this_round)',
        event.type,
      );
    }
    throw new InvalidTransitionError('round_active(joker_trigger_mismatch)', event.type);
  }
  // Consume slot.
  const updatedSlots = advanceSlot(activator.jokerSlots ?? [], event.joker, session.currentRoundIdx);
  // Determine effect duration from catalog and push ActiveJokerEffect.
  // `one_shot_on_use` (Stage Whisper, Earful) — effect is instantaneous; do NOT
  // push to activeJokerEffects (fires and completes in same tick).
  // All other durations persist until their expiry trigger.
  const duration = JOKER_CATALOG[event.joker].duration;
  const effectExpiresAfter: ActiveJokerEffect['expiresAfter'] | null =
    duration === 'one_shot_on_use' ? null :
    duration === 'next_claim' ? 'next_claim' :
    duration === 'next_challenge' ? 'next_challenge' :
    'session';
  const updatedRound: Round = {
    ...currentRound,
    jokerTriggeredThisRound: [...triggered, event.joker],
    activeJokerEffects: effectExpiresAfter
      ? [...currentRound.activeJokerEffects, { type: event.joker, expiresAfter: effectExpiresAfter }]
      : currentRound.activeJokerEffects,
  };
  return {
    ...session,
    [event.by]: { ...activator, jokerSlots: updatedSlots },
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? updatedRound : r,
    ),
  };
}

// ---------------------------------------------------------------------------
// Probe reducer slices (probe-phase spec §7.1)
// ---------------------------------------------------------------------------
// Cross-spec reconciliation 2026-04-19 (orchestrator audit C1): joker-system
// had declared its own `probeComplete` handler, but ownership belongs to
// probe-phase per spec (`ProbeStart` + `ProbeExpired` owned by probe-phase;
// `ProbeComplete` declared by joker-system but CONSUMED by probe-phase's
// `probeEnd` handler below). The joker-system duplicate was removed at
// merge time to avoid a 3-way conflict on the reducer switch.

/** Shared guard + activeProbe writer. `nextProbe` of undefined clears the slot. */
function writeActiveProbe(
  session: Session,
  eventType: string,
  nextProbe: ActiveProbe | undefined,
): Session {
  const currentRound = session.rounds[session.currentRoundIdx];
  if (!currentRound) {
    throw new InvalidTransitionError(
      `round_active(no_round)`,
      eventType,
    );
  }
  // `activeProbe` is declared `?: ActiveProbe` on Round, so assigning
  // `undefined` is equivalent to omitting the key for downstream
  // `round.activeProbe === undefined` checks and JSON serialization.
  const newRound: Round = { ...currentRound, activeProbe: nextProbe };
  return {
    ...session,
    rounds: session.rounds.map((r, i) =>
      i === session.currentRoundIdx ? newRound : r,
    ),
  };
}

/** probe-phase §7.1 — ProbeStart sets Round.activeProbe without touching Round.status. */
function probeStart(
  session: Session,
  event: Extract<GameEvent, { type: 'ProbeStart' }>,
): Session {
  if (session.status !== 'round_active') {
    throw new InvalidTransitionError(session.status, event.type);
  }
  const currentRound = session.rounds[session.currentRoundIdx];
  if (!currentRound || currentRound.status !== 'response_phase') {
    throw new InvalidTransitionError(
      `round_active(round.status=${currentRound?.status ?? 'none'})`,
      event.type,
    );
  }
  if (currentRound.activeProbe !== undefined) {
    throw new InvalidTransitionError(
      `round_active(probe_already_active)`,
      event.type,
    );
  }
  return writeActiveProbe(session, event.type, event.probe);
}

/** probe-phase §7.1 — ProbeComplete / ProbeExpired both clear activeProbe. */
function probeEnd(
  session: Session,
  event:
    | Extract<GameEvent, { type: 'ProbeComplete' }>
    | Extract<GameEvent, { type: 'ProbeExpired' }>,
): Session {
  // Cross-spec reconciliation 2026-04-19: require session.status === 'round_active'
  // per joker-system §9 expectations; error token `probe_id_mismatch` chosen
  // over probe-phase's original `whisperId_mismatch` because the token is
  // joker-system test canonical + semantically identical.
  if (session.status !== 'round_active') {
    throw new InvalidTransitionError(session.status, event.type);
  }
  const currentRound = session.rounds[session.currentRoundIdx];
  if (!currentRound || currentRound.activeProbe === undefined) {
    throw new InvalidTransitionError(
      `round_active(no_pending_probe)`,
      event.type,
    );
  }
  if (currentRound.activeProbe.whisperId !== event.whisperId) {
    throw new InvalidTransitionError(
      `round_active(probe_id_mismatch)`,
      event.type,
    );
  }
  return writeActiveProbe(session, event.type, undefined);
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
    // -----------------------------------------------------------------------
    // Day-5 pre-land stubs (orchestrator, 2026-04-19).
    // These case branches exist so the GameEvent union is exhaustively
    // covered at compile time. Each throws until the corresponding worktree
    // lands its reducer slice. No existing test fires these events — the
    // 391-test baseline is unaffected by these stubs.
    // -----------------------------------------------------------------------
    case 'JokerOffered':
      return jokerOffered(session, event);
    case 'JokerOfferEmpty':
      return jokerOfferEmpty(session, event);
    case 'UseJoker':
      return useJoker(session, event);
    case 'ProbeStart':
      return probeStart(session, event);
    case 'ProbeComplete':
    case 'ProbeExpired':
      // ProbeComplete + ProbeExpired both clear Round.activeProbe.
      // Ownership: ProbeStart + ProbeExpired owned by probe-phase; ProbeComplete
      // declared by joker-system but consumed by probe-phase's probeEnd handler
      // (cross-spec reconciliation 2026-04-19).
      return probeEnd(session, event);
  }
}
