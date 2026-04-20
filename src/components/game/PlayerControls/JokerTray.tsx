'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Always-visible bottom-bar tray of the player's held jokers. Click a held
 * slot → onActivate(joker) dispatches UseJoker (already wired in GameSession).
 *
 * Visual contract (for implementer):
 * - Render each slot as a small card showing joker name/icon
 * - Dim slots whose state !== 'held' (consumed slots stay visible for autopsy)
 * - Glow slots whose type appears in `activeEffects` (currently firing)
 * - Ignore clicks on consumed / actively-firing slots
 * - On a held-slot click: fire onActivate(slot.joker)
 *
 * Props are frozen — the agent MUST NOT add new props or modify this interface
 * without returning NEEDS_SCOPE_EXPANSION to the orchestrator.
 */

import type { JokerType, ActiveJokerEffect, JokerSlot } from '@/lib/game/types';

export interface JokerTrayProps {
  /** Player's held + consumed joker slots. Spec: joker-system §4. */
  jokerSlots: JokerSlot[];
  /** Effects currently active on the round. Used to glow firing slots. */
  activeEffects: ActiveJokerEffect[];
  /** Callback fired when a held slot is clicked. Wired to dispatch UseJoker. */
  onActivate: (joker: JokerType) => void;
}

export function JokerTray(_props: JokerTrayProps) {
  // STUB: returns null. Agent-fill will render slot cards + handle clicks.
  return null;
}
