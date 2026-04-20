/**
 * Gauntlet progression — localStorage-backed (Option B).
 *
 * 4-opponent chain: Novice (Defendant) → Reader (Prosecutor) →
 * Misdirector (Attorney) → Silent (Judge). Beat all four = CASE DISMISSED.
 *
 * Day-5 Wave-5 SCAFFOLD STUB — logic filled in by gauntlet agent.
 * Interface is FROZEN — agents must NOT modify the shape without returning
 * NEEDS_SCOPE_EXPANSION.
 */

import type { Persona } from './types';

/** Ascending-difficulty order. Mapped from ai-personas spec §5. */
export const GAUNTLET_ORDER: readonly Persona[] = [
  'Novice',       // Defendant — obvious tells (tutorial opponent)
  'Reader',       // Prosecutor — balanced (Gus-Fring register)
  'Misdirector',  // Attorney — INVERTED tells (trap persona)
  'Silent',       // Judge — minimal tells (end boss)
] as const;

export const GAUNTLET_LENGTH = GAUNTLET_ORDER.length;

export interface GauntletProgress {
  /** Personas beaten so far, in the order they were defeated. */
  defeated: Persona[];
}

const LOCALSTORAGE_KEY = 'hearsay-progress';

/** Read gauntlet progress from localStorage. STUB — agent fills in persistence. */
export function loadProgress(): GauntletProgress {
  // STUB: agent-fill will implement localStorage.getItem + JSON.parse + validation.
  return { defeated: [] };
}

/** Write gauntlet progress to localStorage. STUB — agent fills in persistence. */
export function saveProgress(_progress: GauntletProgress): void {
  // STUB: agent-fill will implement localStorage.setItem + JSON.stringify.
}

/** Clear gauntlet progress (e.g. "Start Over" button). STUB. */
export function clearProgress(): void {
  // STUB: localStorage.removeItem(LOCALSTORAGE_KEY).
}

/**
 * Returns the NEXT persona the player should face, or null if the gauntlet
 * is complete (i.e. all 4 defeated). STUB — agent fills in.
 */
export function nextPersona(_progress: GauntletProgress): Persona | null {
  // STUB: agent returns GAUNTLET_ORDER.find(p => !progress.defeated.includes(p)) ?? null.
  return null;
}

/** Case number the player is on (1..N or N+1 if complete). STUB. */
export function currentCaseNumber(_progress: GauntletProgress): number {
  // STUB: progress.defeated.length + 1 (capped at GAUNTLET_LENGTH + 1 for complete-state).
  return 1;
}

/** Has the player beaten all 4 opponents? STUB. */
export function isGauntletComplete(_progress: GauntletProgress): boolean {
  // STUB: progress.defeated.length >= GAUNTLET_LENGTH.
  return false;
}

/** Internal — exported for agent/test visibility. */
export const __PROGRESS_INTERNAL = {
  LOCALSTORAGE_KEY,
};
