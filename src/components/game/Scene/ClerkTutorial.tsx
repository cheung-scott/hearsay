'use client';

/**
 * Day-5 Wave-5 SCAFFOLD STUB — filled in by tutorial agent.
 *
 * Live annotated walkthrough that fires on the FIRST session a new player ever
 * plays (localStorage flag `hearsay-tutorial-seen`). Uses Clerk voice + sprite +
 * SVG arrows + speech-bubble overlays + pre-gen MP3s at
 * `public/sfx/tutorial/step-{1..7}.mp3`.
 *
 * Visual contract (for implementer):
 * - Clerk sprite (small) in a screen corner with speech-bubble
 * - SVG arrow pointing at a target element (selected by ref or data-testid)
 * - "Got it →" button + Skip All button
 * - Audio playback via useAudioPlayer — advance on audio-end OR manual click
 * - localStorage flag set on complete/skip so returning players don't see it
 *
 * Triggers:
 *   Step 1: on mount, pre-deal
 *   Step 2-4: after SetupComplete, sequential pre-gameplay
 *   Step 5: after first AI claim (round.claimHistory.length === 1 && last.by === 'ai')
 *   Step 6: after player wins round 1 (sessionWinner remains undefined here)
 *   Step 7: on session_over win OR skip-all
 *
 * Props are FROZEN.
 */

import type { ClientSession } from '@/lib/game/types';

export interface ClerkTutorialProps {
  /** Current client session — tutorial observes state transitions. */
  session: ClientSession | null;
  /** Optional callback when tutorial completes or is skipped. */
  onComplete?: () => void;
}

export function ClerkTutorial(_props: ClerkTutorialProps) {
  // STUB: returns null until agent-fill implements the overlay.
  return null;
}
