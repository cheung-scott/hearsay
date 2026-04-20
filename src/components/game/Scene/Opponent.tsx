'use client';

import { Silhouette } from './Silhouette';
import { OpponentHand } from './OpponentHand';

interface OpponentProps {
  /** Number of face-down cards in the opponent's hand. */
  handSize: number;
  /**
   * Persona display name. §10.5: opponent name now lives in TopBar CaseLabel —
   * retained on props for tests / future use.
   */
  displayName: string;
}

/**
 * Composes the opponent area: silhouette body + hand of card backs.
 * z-index 4 places the opponent BEHIND the table (z 5) so the table edge
 * naturally occludes the lower torso. The hand is z-index 6 (above the table).
 */
export function Opponent({ handSize, displayName }: OpponentProps) {
  // §10.5: opponent name now lives in TopBar CaseLabel — retained on props for tests.
  void displayName;
  return (
    <div
      className="opponent-area"
      style={{
        position: 'absolute',
        top: '14%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '620px',
        height: '280px',
        zIndex: 4,
      }}
    >
      <Silhouette />
      <OpponentHand handSize={handSize} />
    </div>
  );
}
