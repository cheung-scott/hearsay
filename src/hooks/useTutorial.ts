/**
 * Day-5 Wave-5 SCAFFOLD STUB — filled in by tutorial agent.
 *
 * Tracks the 7-step Clerk tutorial state machine. Observes ClientSession
 * transitions + advances step accordingly. Reads/writes localStorage flag
 * `hearsay-tutorial-seen` so returning players skip.
 *
 * Return shape is FROZEN — agents must not rename fields.
 */

import type { ClientSession } from '@/lib/game/types';

export type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TutorialState {
  /** 0 = inactive (already seen or skipped); 1-7 = current step. */
  step: TutorialStep;
  /** True while tutorial overlay should render. */
  active: boolean;
  /** Advance to the next step (user clicked "Got it →" or audio ended). */
  advance: () => void;
  /** Skip entire tutorial (set localStorage flag). */
  skip: () => void;
}

export function useTutorial(_session: ClientSession | null): TutorialState {
  // STUB: agent-fill will implement localStorage check + step machine + session-state observers.
  return {
    step: 0,
    active: false,
    advance: () => {},
    skip: () => {},
  };
}
