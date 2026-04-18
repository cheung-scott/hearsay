// Game-engine spec §3.4 — pure reducer helpers.
//
// This file will grow as tasks land: Task 2 adds the four end-check + joker
// helpers below; Task 4 onward will add the `reduce()` dispatch + per-event
// transitions. All helpers here are pure — no I/O, no `Date.now()`, no
// `Math.random()`. Caller owns randomness and time.

import type {
  ActiveJokerEffect,
  JokerType,
  Round,
  Session,
} from './types';

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
