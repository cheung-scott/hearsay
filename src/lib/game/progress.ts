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

const DEFAULT_PROGRESS: GauntletProgress = { defeated: [] };

/** Validate that a parsed value has the expected GauntletProgress shape. */
function isValidProgress(value: unknown): value is GauntletProgress {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.defeated)) return false;
  const validPersonas: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];
  return (obj.defeated as unknown[]).every(
    (p) => typeof p === 'string' && validPersonas.includes(p as Persona),
  );
}

/** Read gauntlet progress from localStorage. Returns default if unavailable or corrupted. */
export function loadProgress(): GauntletProgress {
  try {
    // localStorage is unavailable in SSR (typeof localStorage will throw
    // a ReferenceError in some environments, or be undefined in others).
    if (typeof localStorage === 'undefined') return { defeated: [] };
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    if (!raw) return { defeated: [] };
    const parsed: unknown = JSON.parse(raw);
    if (isValidProgress(parsed)) return parsed;
    return { defeated: [] };
  } catch {
    // JSON.parse failure, localStorage access denied, or SSR ReferenceError.
    return { defeated: [] };
  }
}

/** Write gauntlet progress to localStorage. Silently swallows write failures. */
export function saveProgress(progress: GauntletProgress): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Quota exceeded, private browsing, or SSR — fail silently.
  }
}

/** Clear gauntlet progress (e.g. "Start Over" button). */
export function clearProgress(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LOCALSTORAGE_KEY);
  } catch {
    // Fail silently.
  }
}

/**
 * Returns the NEXT persona the player should face, or null if the gauntlet
 * is complete (i.e. all 4 defeated).
 */
export function nextPersona(progress: GauntletProgress): Persona | null {
  return GAUNTLET_ORDER.find((p) => !progress.defeated.includes(p)) ?? null;
}

/** Case number the player is on (1..N). Clamped to GAUNTLET_LENGTH when complete. */
export function currentCaseNumber(progress: GauntletProgress): number {
  return Math.min(progress.defeated.length + 1, GAUNTLET_LENGTH);
}

/** Has the player beaten all 4 opponents? */
export function isGauntletComplete(progress: GauntletProgress): boolean {
  return progress.defeated.length >= GAUNTLET_LENGTH;
}

/** Internal — exported for agent/test visibility. */
export const __PROGRESS_INTERNAL = {
  LOCALSTORAGE_KEY,
};

/** Exported for test teardown convenience. */
export { DEFAULT_PROGRESS };
