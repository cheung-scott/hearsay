'use client';

import { Silhouette } from './Silhouette';
import { OpponentHand } from './OpponentHand';

interface OpponentProps {
  /** Number of face-down cards in the opponent's hand. */
  handSize: number;
  /** Display name shown beneath the silhouette (e.g. "THE PROSECUTOR"). */
  displayName: string;
}

/**
 * Composes the opponent area: silhouette body + hand of card backs + label.
 * z-index 4 places the opponent BEHIND the table (z 5) so the table edge
 * naturally occludes the lower torso. The hand is z-index 6 (above the table).
 */
export function Opponent({ handSize, displayName }: OpponentProps) {
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
      <div
        className="opponent-label"
        style={{
          position: 'absolute',
          top: '280px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '11px',
          letterSpacing: '3px',
          color: 'var(--amber)',
          textShadow: '0 0 12px rgba(253,162,0,0.6)',
          whiteSpace: 'nowrap',
          zIndex: 12,
        }}
      >
        {displayName}
      </div>
    </div>
  );
}
