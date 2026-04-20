'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Modal overlay shown when phase === 'joker-offer' (between rounds, round
 * winner picks 1-of-N). Click one → onPick(joker) dispatches PickJoker.
 *
 * Visual contract (for implementer):
 * - Modal / overlay with dark backdrop (no dismiss-without-picking; the spec
 *   requires a pick to advance the FSM)
 * - Render `offer.offered[]` as 3 (or fewer on exhaustion tail) joker cards
 * - Each card: joker name, flavour text, click handler
 * - Highlight on hover; firm CTA on click
 *
 * Props are frozen — the agent MUST NOT add new props without returning
 * NEEDS_SCOPE_EXPANSION.
 */

import type { JokerType, JokerOffer } from '@/lib/game/types';

export interface JokerPickerProps {
  /** The current offer shown to the round winner. Spec: joker-system §6.2. */
  offer: JokerOffer;
  /** Callback fired when the winner picks. Wired to dispatch PickJoker. */
  onPick: (joker: JokerType) => void;
}

export function JokerPicker(_props: JokerPickerProps) {
  // STUB: returns null. Agent-fill will render the 1-of-3 modal.
  return null;
}
