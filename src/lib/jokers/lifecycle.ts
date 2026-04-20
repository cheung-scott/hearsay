// Pure lifecycle helpers for the joker-system reducer.
// Spec: joker-system §6.2 (draw-pile + offer), §7.1.3 / §7.1.8 (helpers).
//
// All exports are pure — no randomness, no time, no I/O. Caller injects
// the RNG and time via event payloads (game-engine §3.2 discipline).

import type { JokerType, Round, JokerSlot } from '../game/types';
import { InvalidTransitionError } from '../game/types';
import { JOKER_CATALOG } from './catalog';

// ---------------------------------------------------------------------------
// Canonical joker order (spec §7.1.3)
// ---------------------------------------------------------------------------

const CANONICAL_ORDER: JokerType[] = [
  'poker_face',
  'stage_whisper',
  'earful',
  'cold_read',
  'second_wind',
];

// ---------------------------------------------------------------------------
// seedDrawPile
// ---------------------------------------------------------------------------

/**
 * Returns a stable ordered array of 15 jokers: 3 copies of each of the 5
 * types repeated in canonical order (blocks of 3 per type).
 * Spec: joker-system §7.1.3, Req 3.2.
 *
 * Returns a new array each call — no shared reference.
 */
export function seedDrawPile(): JokerType[] {
  const pile: JokerType[] = [];
  for (const type of CANONICAL_ORDER) {
    pile.push(type, type, type);
  }
  return pile;
}

// ---------------------------------------------------------------------------
// pickOffer
// ---------------------------------------------------------------------------

/**
 * Pick up to 3 DISTINCT joker types from the draw pile uniformly-without-
 * replacement (Fisher-Yates over the distinct-type list).
 * Spec: joker-system §6.2, §7.1.8, Req 3.3, 4.2.
 *
 * Algorithm:
 *   1. Deduplicate draw pile to get distinct types still present.
 *   2. Fisher-Yates shuffle the distinct array using injected `rng`.
 *   3. Slice up to 3 as `offered`.
 *   4. `remaining` = drawPile with ALL copies of offered types removed.
 *
 * Pure — does not mutate `drawPile`.
 */
export function pickOffer(
  drawPile: JokerType[],
  rng: () => number,
): { offered: JokerType[]; remaining: JokerType[] } {
  if (drawPile.length === 0) {
    return { offered: [], remaining: [] };
  }

  // Step 1: distinct types still present
  const distinct: JokerType[] = [...new Set(drawPile)];

  // Step 2: Fisher-Yates in-place shuffle of `distinct`
  // Iterates from the last element down, swapping each with a random earlier
  // (or same) index. `rng()` returns a value in [0, 1); multiplying by the
  // remaining range and flooring gives a uniform integer index.
  for (let i = distinct.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = distinct[i];
    distinct[i] = distinct[j];
    distinct[j] = tmp;
  }

  // Step 3: offer up to 3
  const offered = distinct.slice(0, Math.min(3, distinct.length));

  // Step 4: remaining = drawPile minus ALL copies of offered types
  const offeredSet = new Set(offered);
  const remaining = drawPile.filter((t) => !offeredSet.has(t));

  return { offered, remaining };
}

// ---------------------------------------------------------------------------
// canActivate
// ---------------------------------------------------------------------------

/**
 * Validate whether a joker can be activated in the current game state.
 * Checks trigger window AND no-stacking invariant (I1, I11).
 * Spec: joker-system §7.1, Req 4.4, 7.1, 8.2.
 *
 * Trigger kind → (roundStatus, activePlayer, by) mapping:
 *   - `self_claim_phase`       — claim_phase, activePlayer === by
 *   - `pre_ai_claim`           — claim_phase, activePlayer === 'ai', by === 'player'
 *   - `opponent_claim_resolved`— response_phase, activePlayer !== by
 *   - `on_my_strike`           — NEVER via UseJoker (auto-fires in RevealComplete)
 */
export function canActivate(
  joker: JokerType,
  roundStatus: Round['status'],
  activePlayer: 'player' | 'ai',
  by: 'player' | 'ai',
  jokerTriggeredThisRound: JokerType[],
): boolean {
  // I11 — stacking disallowed
  if (jokerTriggeredThisRound.includes(joker)) {
    return false;
  }

  const triggers = JOKER_CATALOG[joker].triggers;

  for (const trigger of triggers) {
    switch (trigger.kind) {
      case 'self_claim_phase':
        // Activator is the active player about to claim
        if (roundStatus === 'claim_phase' && activePlayer === by) {
          return true;
        }
        break;

      case 'pre_ai_claim':
        // Player triggers before AI claims (AI is the active player)
        if (
          roundStatus === 'claim_phase' &&
          activePlayer === 'ai' &&
          by === 'player'
        ) {
          return true;
        }
        break;

      case 'opponent_claim_resolved':
        // Activator is about to respond to the OPPOSITE player's claim
        if (roundStatus === 'response_phase' && activePlayer !== by) {
          return true;
        }
        break;

      case 'on_my_strike':
        // NEVER valid for UseJoker — auto-fires inside RevealComplete
        break;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// advanceSlot
// ---------------------------------------------------------------------------

/**
 * Transition the FIRST `held` slot matching `jokerType` to `consumed`,
 * setting `consumedRoundIdx`.
 * Spec: joker-system §7.1, Req 8.3.
 *
 * Throws `InvalidTransitionError` if no `held` slot for the given type exists.
 * Pure — returns a new array; does not mutate `slots`.
 */
export function advanceSlot(
  slots: JokerSlot[],
  jokerType: JokerType,
  roundIdx: number,
): JokerSlot[] {
  const idx = slots.findIndex(
    (s) => s.joker === jokerType && s.state === 'held',
  );

  if (idx === -1) {
    throw new InvalidTransitionError(
      'round_active(joker_not_held)',
      'UseJoker',
    );
  }

  return slots.map((slot, i) =>
    i === idx
      ? { ...slot, state: 'consumed' as const, consumedRoundIdx: roundIdx }
      : slot,
  );
}
