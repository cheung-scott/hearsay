'use client';

import { OpponentHand } from './OpponentHand';
import { PersonaPortrait } from './PersonaPortrait';
import { PERSONA_ACCENT_COLORS } from '../../../lib/persona/accentColors';
import type { Persona } from '../../../lib/game/types';
import { useIsMobile } from '../../../hooks/useIsMobile';

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
 *
 * Mobile (< 640px): area narrows to 90vw and shrinks the portrait / hand
 * proportionally so nothing overflows a 375px viewport.
 */
export function Opponent({ handSize, displayName, persona = 'Reader' }: OpponentProps) {
  // §10.5: opponent name now lives in TopBar CaseLabel — retained on props for tests.
  void displayName;
  const isMobile = useIsMobile();

  return (
    <div
      className="opponent-area"
      style={{
        position: 'absolute',
        top: isMobile ? '15%' : '18%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: isMobile ? 'min(90vw, 360px)' : '720px',
        height: isMobile ? '280px' : '360px',
        zIndex: 4,
      }}
    >
      <PersonaPortrait
        persona={persona}
        personaAccent={PERSONA_ACCENT_COLORS[persona]}
        size={isMobile ? 'mobile' : 'desktop'}
      />
      <OpponentHand handSize={handSize} size={isMobile ? 'mobile' : 'desktop'} />
    </div>
  );
}
