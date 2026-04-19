import type { Persona } from '../game/types';

/**
 * Display-layer mapping from internal Persona code symbols to courtroom names
 * (DESIGN-DECISIONS.md §9). Internal types in ../game/types are NOT renamed —
 * this constant is used only when rendering player-facing strings.
 */
export const PERSONA_DISPLAY_NAMES: Record<Persona, string> = {
  Novice: 'The Defendant',
  Reader: 'The Prosecutor',
  Misdirector: 'The Attorney',
  Silent: 'The Judge',
};
