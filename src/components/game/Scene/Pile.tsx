'use client';

import type { Rank } from '../../../lib/game/types';

interface PileProps {
  /** Number of cards currently in the pile. */
  pileSize: number;
  /**
   * When provided, appended to the pile label as ` · CALL · {rank}`.
   * Not included in phase 1 default — check variant-d HTML: label is `PILE · N`.
   */
  callRank?: Rank;
}

/** Per-card tilt transforms matching variant-d `.pile-card:nth-child(n)`. */
const PILE_CARD_TRANSFORMS = [
  'rotate(-8deg) translate(-5px, -2px)',
  'rotate(3deg)',
  'rotate(-1deg) translate(5px, 3px)',
];

/**
 * Pile of face-down cards on felt. Cards tilt with the table (`rotateX(60deg)`);
 * the `PILE · N` label stays flat in screen space (outside that rotation).
 * Renders up to 3 visible card stacks regardless of actual pile size.
 */
export function Pile({ pileSize, callRank }: PileProps) {
  const visibleCards = Math.min(pileSize, 3);
  const label = callRank ? `PILE · ${pileSize} · CALL · ${callRank.toUpperCase()}` : `PILE · ${pileSize}`;

  return (
    <div
      className="pile-area"
      style={{
        position: 'absolute',
        bottom: '32%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 7,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
      }}
    >
      <div
        className="pile-cards-tilted"
        style={{
          position: 'relative',
          width: '80px',
          height: '110px',
          transform: 'rotateX(60deg)',
          transformOrigin: 'center center',
        }}
      >
        {Array.from({ length: visibleCards }).map((_, i) => (
          <div
            key={i}
            className="pile-card"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--bone)',
              border: '2px solid var(--navy)',
              borderRadius: '3px',
              boxShadow: '2px 4px 10px rgba(0,0,0,0.8)',
              transform: PILE_CARD_TRANSFORMS[i] ?? 'rotate(0deg)',
            }}
          />
        ))}
      </div>
      <div
        className="pile-label"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '9px',
          color: 'var(--bone-dim)',
          letterSpacing: '2px',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  );
}
