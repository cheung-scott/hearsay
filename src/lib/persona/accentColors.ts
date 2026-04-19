import type { Persona } from '../game/types';

/**
 * Per-persona accent color tokens — design.md §7.3 (ai-personas spec).
 * Used by ui-gameplay HUD for opponent-name pill borders/highlights, NOT text backgrounds
 * (Silent's near-black navy fails WCAG AA as text bg but is fine as a border token).
 *
 *   Novice      → #8ca880  muted olive     — nervous, organic, defensive
 *   Reader      → #b57c3a  amber/tobacco   — measured authority, Gus Fring warmth
 *   Misdirector → #6b4a9e  deep violet     — theatrical, courtroom-theatre
 *   Silent      → #1e2a3a  near-black navy — weight, finality, Act 4
 *
 * 6-hex only (no alpha) so these compose with Tailwind arbitrary-value syntax:
 * `ring-[var(--persona-accent)]`, `border-[#…]`, `bg-[#…]/20`.
 */
export const PERSONA_ACCENT_COLORS: Record<Persona, string> = {
  Novice:      '#8ca880',
  Reader:      '#b57c3a',
  Misdirector: '#6b4a9e',
  Silent:      '#1e2a3a',
};
