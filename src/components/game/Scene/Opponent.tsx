'use client';

import { OpponentHand } from './OpponentHand';
import { PersonaPortrait } from './PersonaPortrait';
import { PERSONA_ACCENT_COLORS } from '../../../lib/persona/accentColors';
import type { Persona } from '../../../lib/game/types';

interface OpponentProps {
  /** Number of face-down cards in the opponent's hand. */
  handSize: number;
  /**
   * Persona display name. §10.5: opponent name now lives in TopBar CaseLabel —
   * retained on props for tests / future use.
   */
  displayName: string;
  /**
   * Which persona to render. Drives the PersonaPortrait PNG lookup and the
   * fallback silhouette's eye-glow accent. Defaults to 'Reader' so demos
   * keep rendering something sensible when the prop is omitted.
   */
  persona?: Persona;
}

/**
 * Composes the opponent area: persona portrait (PNG with silhouette fallback) +
 * hand of card backs. z-index 4 places the opponent BEHIND the table (z 5) so
 * the table edge naturally occludes the lower torso. The hand is z-index 6
 * (above the table).
 */
export function Opponent({ handSize, displayName, persona = 'Reader' }: OpponentProps) {
  // §10.5: opponent name now lives in TopBar CaseLabel — retained on props for tests.
  void displayName;
  return (
    <div
      className="opponent-area"
      style={{
        position: 'absolute',
        top: '18%',            // was 14% — pulled down so the character meets the table edge
        left: '50%',
        transform: 'translateX(-50%)',
        width: '720px',        // was 620px — expanded so the larger portrait has room
        height: '360px',       // was 280px — taller to accommodate the larger portrait
        zIndex: 4,
      }}
    >
      <PersonaPortrait
        persona={persona}
        personaAccent={PERSONA_ACCENT_COLORS[persona]}
      />
      <OpponentHand handSize={handSize} />
    </div>
  );
}
