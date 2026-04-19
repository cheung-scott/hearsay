// Tension-music-system spec §4.1, §4.2, §6.2.
//
// Pure FSM → TensionLevel derivation + duck/gain constants. No I/O.
//
// `TensionLevel` is locked to 3 values to match the existing
// `MusicTrack['level']` union in `src/lib/game/types.ts`.

import type { Session } from '@/lib/game/types';

export type TensionLevel = 'calm' | 'tense' | 'critical';

/** Steering §1.5 lock — 400ms linear ramp for both duck + restore + cross-fade. */
export const DUCK_FADE_MS = 400;

/** 20% of base volume during input/output ducks. */
export const DUCK_GAIN = 0.2;

/** Base music volume (1.0 = full). */
export const BASE_GAIN = 1.0;

/** Cross-fade window when tension level changes. */
export const CROSSFADE_MS = 800;

/**
 * Pure mapping. Recompute every render — no persisted field on Session.
 *
 * - session_over → critical (the stinger lands over a high-stakes bed)
 * - status !== round_active → calm (setup, joker_offer breather)
 * - max strikes >= 2 → critical (one strike from elimination)
 * - max strikes === 1 → tense
 * - else → calm
 */
export function deriveTensionLevel(session: Session): TensionLevel {
  if (session.status === 'session_over') return 'critical';
  if (session.status !== 'round_active') return 'calm';

  const maxStrikes = Math.max(session.player.strikes, session.ai.strikes);
  if (maxStrikes >= 2) return 'critical';
  if (maxStrikes === 1) return 'tense';
  return 'calm';
}
