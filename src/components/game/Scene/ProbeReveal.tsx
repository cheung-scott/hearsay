'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Overlay rendered when the current round has an active probe (Stage Whisper
 * joker was consumed). Shows the server-filtered revealed reasoning snippet
 * with a countdown timer derived from decayMs.
 *
 * Visual contract (for implementer):
 * - Overlay (not a modal — gameplay continues underneath)
 * - Show `probe.revealedReasoning` prominently
 * - Countdown bar / ring derived from `probe.decayMs` (server-authoritative)
 * - Auto-dismisses when the round's activeProbe is cleared (no manual dismiss
 *   event from client; server-side ProbeExpired fires on decay)
 * - Small filterSource label ("heuristic", "scrub", "fallback") for transparency
 *
 * Props are frozen.
 */

import type { RevealedProbe } from '@/lib/game/types';

export interface ProbeRevealProps {
  /** The filtered probe reveal for the current round. */
  probe: RevealedProbe;
}

export function ProbeReveal(_props: ProbeRevealProps) {
  // STUB: returns null. Agent-fill will render the reveal + countdown.
  return null;
}
