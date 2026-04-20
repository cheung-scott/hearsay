// Pure effect helpers for the simplest-3 jokers: Cold Read, Poker Face, Second Wind.
// Spec: joker-system §5, §7.4.1 (Poker Face), §7.4.2 (Cold Read), §5 Second Wind.
//
// All exports are pure — no I/O, no time, no randomness. The reducer in
// src/lib/game/fsm.ts inlines Second Wind via advanceSlot; this helper
// exports the equivalent logic for API-route-layer use + unit testing.
//
// Earful (§7.4.3) — Task 14.
// Stage Whisper (§7.2) — Task 15.

import type { Round, JokerSlot, Claim, Session } from '../game/types';
import type { ProbeRequest } from '../probe/types';

// ---------------------------------------------------------------------------
// applyPokerFace
// ---------------------------------------------------------------------------

/**
 * Suppress the voice lie-score to the deterministic neutral midpoint (0.5).
 * Called by the API route immediately before building
 * `DecisionContext.claim.voiceMeta.lieScore` when `Round.activeJokerEffects`
 * contains `{type:'poker_face'}`.
 *
 * Spec: joker-system §7.4.1, Req 10.1, 10.2.
 * Invariant I6: pure + deterministic — ignores input, always returns 0.5.
 */
export function applyPokerFace(_lieScore: number): number {
  return 0.5;
}

// ---------------------------------------------------------------------------
// applyColdRead
// ---------------------------------------------------------------------------

/**
 * Signal to `toClientView` that the last AI claim's `voiceMeta.lieScore`
 * should be retained in the PublicClaim projection (normally stripped).
 *
 * Returns `true` iff `cold_read` is present in `round.activeJokerEffects`.
 * Spec: joker-system §7.4.2, Req 13.1, 13.2, 13.3.
 */
export function applyColdRead(round: Round): boolean {
  return round.activeJokerEffects.some((e) => e.type === 'cold_read');
}

// ---------------------------------------------------------------------------
// applySecondWind
// ---------------------------------------------------------------------------

/**
 * Check for a held `second_wind` slot and, if present, consume it and signal
 * strike cancellation.
 *
 * Returns `{ shouldCancel: true, updatedSlots }` when a held `second_wind`
 * was found and consumed; `{ shouldCancel: false, updatedSlots: playerSlots }`
 * (identity) otherwise.
 *
 * Design note: The FSM reducer (`revealComplete`) inlines the same logic using
 * `advanceSlot(slots, 'second_wind', currentRoundIdx)` — that path is the
 * authoritative production consumer and sets `consumedRoundIdx` correctly.
 * This helper is exported for API-route-layer use and unit tests (Task 11)
 * where a `roundIdx` is not meaningful. Rather than accepting a `roundIdx`
 * param (not in the Task 10 signature), the slot update is done inline:
 * `consumedRoundIdx` is left `undefined` here — the reducer is responsible
 * for setting it with the correct value via `advanceSlot`.
 *
 * Spec: joker-system §5 (Second Wind), Req 14.1.
 */
export function applySecondWind(playerSlots: JokerSlot[]): {
  shouldCancel: boolean;
  updatedSlots: JokerSlot[];
} {
  const hasHeld = playerSlots.some(
    (s) => s.joker === 'second_wind' && s.state === 'held',
  );

  if (!hasHeld) {
    return { shouldCancel: false, updatedSlots: playerSlots };
  }

  let consumed = false;
  const updatedSlots = playerSlots.map((s) => {
    if (!consumed && s.joker === 'second_wind' && s.state === 'held') {
      consumed = true;
      return { ...s, state: 'consumed' as const };
    }
    return s;
  });

  return { shouldCancel: true, updatedSlots };
}

// ---------------------------------------------------------------------------
// applyEarful
// ---------------------------------------------------------------------------

/**
 * When the player WINS a challenge while holding Earful, consume the first
 * held `earful` slot and return the autopsy data derived from the challenged
 * claim's voicePreset.
 *
 * Returns `{ autopsy, updatedSlots }` when a held earful was found and
 * consumed; `null` otherwise.
 *
 * Design note: The production path in `fsm.ts revealComplete` already inlines
 * the autopsy logic. This helper is a standalone pure function for
 * unit tests (I7) and API-route-layer use.
 *
 * Spec: joker-system §7.4.3, Reqs 12.1–12.5.
 * Invariant I7: pure + deterministic.
 */
export function applyEarful(
  playerSlots: JokerSlot[],
  claim: Claim,
  roundIdx: number,
  turnIdx: number,
): { autopsy: NonNullable<Session['autopsy']>; updatedSlots: JokerSlot[] } | null {
  const heldIdx = playerSlots.findIndex(
    (s) => s.joker === 'earful' && s.state === 'held',
  );

  if (heldIdx === -1) {
    return null;
  }

  const updatedSlots = playerSlots.map((s, i) => {
    if (i === heldIdx) {
      return { ...s, state: 'consumed' as const };
    }
    return s;
  });

  const autopsy: NonNullable<Session['autopsy']> = {
    preset: claim.voicePreset ?? 'unknown',
    roundIdx,
    turnIdx,
  };

  return { autopsy, updatedSlots };
}

// ---------------------------------------------------------------------------
// produceProbeRequest
// ---------------------------------------------------------------------------

/**
 * Build a LOCKED-shape `ProbeRequest` from round state when Stage Whisper fires.
 *
 * `whisperIdGen` is injected so the function stays pure (no internal
 * randomness). `now` is injected instead of reading `Date.now()`.
 * `mathProb` is conditionally spread — the field is ABSENT (not
 * `undefined`-valued) when not provided.
 *
 * Spec: joker-system §7.2, Reqs 11.1–11.4.
 * Invariant I3: locked shape — byte-for-byte aligned with probe-phase §4.
 */
export function produceProbeRequest(
  round: Round,
  whisperIdGen: () => string,
  now: number,
  mathProb?: number,
): ProbeRequest {
  return {
    whisperId: whisperIdGen(),
    targetAiId: 'ai' as const,
    // Round.roundNumber is 1-based (1|2|3); Session.currentRoundIdx is 0-based.
    roundIdx: round.roundNumber - 1,
    triggeredAtTurn: round.claimHistory.length,
    now,
    ...(mathProb !== undefined ? { mathProb } : {}),
  };
}
