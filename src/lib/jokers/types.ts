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
  /** Lifecycle state of this joker slot. Spec: joker-system §4. */
  state: 'held' | 'consumed';
  /** 0-based round index when joker was acquired. Spec: joker-system §4. */
  acquiredRoundIdx: number;
  /** 0-based round index when joker was consumed; undefined while held. Spec: joker-system §4. */
  consumedRoundIdx?: number;
}

/**
 * A between-round offer shown to the round winner. Drawn uniformly-without-
 * replacement over DISTINCT types still present in `Session.jokerDrawPile`
 * (spec §6.2 — dedup-by-type rule). The 2 un-picked jokers in `offered` move
 * to `Session.discardedJokers` on `JokerPicked`.
 *
 * Spec: joker-system §4 + §6.2 + §7.1.1 (length 1..3 on exhaustion tail).
 */
export interface JokerOffer {
  /** Length 1..3 per spec §7.1.1. No duplicate types within one offer. */
  offered: JokerType[];
  offeredToWinner: 'player' | 'ai';
}

/**
 * The game-phase windows in which a joker may be activated. Spec: joker-system §4.
 */
export type JokerTrigger =
  | { kind: 'self_claim_phase' }
  | { kind: 'pre_ai_claim' }
  | { kind: 'opponent_claim_resolved' }
  | { kind: 'on_my_strike' };

/**
 * How long a joker's effect persists after activation. Spec: joker-system §4.
 */
export type JokerDuration =
  | 'next_claim'
  | 'next_challenge'
  | 'one_shot_on_use'
  | 'session';

/**
 * The cost a player pays to activate a joker. Spec: joker-system §4.
 */
export type JokerCost =
  | { kind: 'none' }
  | { kind: 'reveal_own_card'; count: 1 }
  | { kind: 'strike_penalty'; amount: 1 };

/**
 * Full definition of a joker card — static catalog shape. Spec: joker-system §4.
 */
export interface Joker {
  /** Matches a key in the `JOKER_CATALOG`. */
  type: JokerType;
  /** Display name, Title Case. */
  name: string;
  /** One-line flavour text, ≤80 chars. Spec: §4. */
  flavor: string;
  /** Ordered list of phases in which this joker can fire. */
  triggers: JokerTrigger[];
  /** How long the effect lasts once activated. */
  duration: JokerDuration;
  /** Activation cost. */
  cost: JokerCost;
  /** Whether the card face is shown to both players on activation. */
  visibleOnActivate: boolean;
  /** CSS custom property name for theming, e.g. `--joker-poker-face`. Spec: §4. */
  accentVar: string;
}

/**
 * Payload sent to the probe endpoint when Stage Whisper fires.
 * Shape is LOCKED — byte-for-byte aligned with probe-phase §4.
 * Spec: joker-system §7.2.
 */
export interface ProbeRequest {
  whisperId: string;
  targetAiId: 'ai';
  roundIdx: number;
  triggeredAtTurn: number;
  now: number;
  mathProb?: number;
}
