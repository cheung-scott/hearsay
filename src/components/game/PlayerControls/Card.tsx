'use client';

import type { Rank } from '../../../lib/game/types';

interface CardProps {
  /** The rank to display. If omitted the card renders face-down. */
  rank?: Rank;
  /** When true, renders only the card back (navy + diagonal hatching). */
  faceDown?: boolean;
  /** Amber border-glow selection state. */
  selected?: boolean;
  onClick?: () => void;
}

/** nth-child fan transforms applied via index prop in PlayerHand. Exported so
 * `PlayerHand` can apply them from outside. */
export const HAND_CARD_TRANSFORMS = [
  'rotate(-9deg) translateY(14px)',
  'rotate(-3deg) translateY(2px)',
  'rotate(3deg) translateY(-2px)',
  'rotate(9deg) translateY(14px)',
  // 5th card (if present) — extra right lean matching 5-card fan logic
  'rotate(9deg) translateY(14px)',
];

/**
 * Shared card component. Face-up: bone background + rank letters in TL/center/BR.
 * Face-down: navy + diagonal hatching, no rank. Selected: amber border glow.
 * Hover lifts `translateY(-18px)` via CSS transition 0.2s ease.
 */
export function Card({ rank, faceDown = false, selected = false, onClick }: CardProps) {
  const isFaceDown = faceDown || !rank;

  return (
    <div
      className={selected ? 'card selected' : 'card'}
      onClick={onClick}
      style={{
        width: '104px',
        height: '150px',
        background: isFaceDown
          ? undefined
          : 'var(--bone)',
        backgroundImage: isFaceDown
          ? 'repeating-linear-gradient(45deg, var(--navy) 0px, var(--navy) 3px, #0f1420 3px, #0f1420 6px)'
          : undefined,
        backgroundColor: isFaceDown ? 'var(--navy)' : undefined,
        border: selected
          ? '3px solid var(--amber-hi)'
          : isFaceDown
            ? '3px solid var(--amber-dim)'
            : '3px solid var(--navy)',
        borderRadius: '6px',
        boxShadow: selected
          ? '0 10px 24px rgba(0,0,0,0.85), 0 0 16px rgba(255,199,96,0.55)'
          : '0 10px 24px rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        padding: '10px',
        color: 'var(--navy)',
        position: 'relative',
        transition: 'transform 0.2s ease',
        cursor: onClick ? 'pointer' : undefined,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-18px)';
        (e.currentTarget as HTMLDivElement).style.zIndex = '10';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = '';
        (e.currentTarget as HTMLDivElement).style.zIndex = '';
      }}
    >
      {!isFaceDown && rank && (
        <>
          <div
            className="card-rank-tl"
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            {rank[0]}
          </div>
          <div
            className="card-rank-mid"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '40px',
            }}
          >
            {rank[0]}
          </div>
          <div
            className="card-rank-br"
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '18px',
              lineHeight: 1,
              textAlign: 'right',
              transform: 'rotate(180deg)',
            }}
          >
            {rank[0]}
          </div>
        </>
      )}
    </div>
  );
}
