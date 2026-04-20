'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Overlay shown after a player-won challenge while Earful joker is active.
 * Reveals which VoiceTellPreset the AI was using for that turn — teaches the
 * voice-tell taxonomy through play.
 *
 * Visual contract (for implementer):
 * - Autopsy card overlay (~3-5s display), dismissible on click or auto-fade
 * - Large preset name + a short "here's what that sounds like" caption
 * - Optionally play a 1s clip at the preset's cadence (SKIP for Day-5 MVP —
 *   wire later if capacity allows)
 * - Auto-clears when session.autopsy is undefined (cleared by ChallengeCalled
 *   or RoundSettled reducers)
 *
 * Props are frozen.
 */

import type { VoiceTellPreset } from '@/lib/game/types';

export interface AutopsyOverlayProps {
  /** The preset-reveal payload. */
  autopsy: { preset: VoiceTellPreset; roundIdx: number; turnIdx: number };
  /** Optional manual dismiss. Most calls rely on auto-clear via server reducer. */
  onDismiss?: () => void;
}

export function AutopsyOverlay(_props: AutopsyOverlayProps) {
  // STUB: returns null. Agent-fill will render the preset-reveal card.
  return null;
}
