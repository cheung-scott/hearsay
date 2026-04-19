// Joker-related type definitions.
//
// This file is the canonical home for joker types that aren't directly
// part of the core FSM state. The `joker-system` spec (§7.1) names this
// file as the owner for JokerSlot, JokerOffer, JokerEffect, JokerDrawPile.
//
// PRE-LAND (Day-5 orchestrator, 2026-04-19) scope:
//   Only JokerSlot + JokerOffer are defined here — they're needed by
//   `src/lib/game/types.ts` (PlayerState.jokerSlots + Session.currentOffer).
//   JokerEffect + JokerDrawPile + JOKER_CATALOG land in the joker-system
//   worktree alongside the reducer handler implementations.
//
// All other joker logic (applyJokerEffect, expireJokerEffects, offer
// generation, catalog, lifecycle) stays in `src/lib/game/fsm.ts` or
// `src/lib/jokers/*` worktree files — NOT here.

import type { JokerType } from '../game/types';

/**
 * A single joker held by a player. Authoritative per-player joker state
 * lives in `PlayerState.jokerSlots[]` (additive; the legacy `jokers: JokerType[]`
 * stays as a derived alias until the joker-system worktree deprecates it).
 *
 * Spec: joker-system §4 + §7.1.7.
 */
export interface JokerSlot {
  joker: JokerType;
  /** ms since epoch, from the `JokerPicked.now` event that placed this slot. */
  acquiredAt: number;
}

/**
 * A between-round offer shown to the round winner. Drawn uniformly-without-
 * replacement over DISTINCT types still present in `Session.jokerDrawPile`
 * (spec §6.2 — dedup-by-type rule). The 2 un-picked jokers in `offered` move
 * to `Session.discardedJokers` on `JokerPicked`.
 *
 * Spec: joker-system §4 + §6.2.
 */
export interface JokerOffer {
  offeredToWinner: 'player' | 'ai';
  /** Length 1..3. Shrinks on pile exhaustion tail. No duplicate types within one offer. */
  offered: JokerType[];
  offeredAt: number;
}
