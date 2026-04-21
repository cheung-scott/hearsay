'use client';

interface OpponentHandProps {
  /** Number of face-down card backs to render. */
  handSize: number;
  /** Render size — desktop keeps the original layout, mobile shrinks the cards + top offset. */
  size?: 'desktop' | 'mobile';
}

/** nth-child rotation table matching variant-d CSS exactly. Index 0-based. */
const CARD_TRANSFORMS = [
  'rotate(-14deg) translateY(5px)',
  'rotate(-7deg) translateY(2px)',
  'rotate(0deg)',
  'rotate(7deg) translateY(2px)',
  'rotate(14deg) translateY(5px)',
];

/**
 * Opponent's face-down hand, rendered as `handSize` card backs fanned above
 * the table edge (z-index 6 > table z-index 5). Matches `.opponent-hand` /
 * `.opp-card` from variant-d-across-table.html.
 */
export function OpponentHand({ handSize, size = 'desktop' }: OpponentHandProps) {
  const cards = Array.from({ length: handSize });
  const isMobile = size === 'mobile';
  const cardW = isMobile ? 28 : 42;
  const cardH = isMobile ? 40 : 60;
  const overlap = isMobile ? -10 : -14;

  return (
    <div
      className="opponent-hand"
      style={{
        position: 'absolute',
        top: isMobile ? '150px' : '210px',
        left: '50%',
        transform: 'translateX(-50%) rotateX(16deg)',
        transformOrigin: 'center bottom',
        display: 'flex',
        zIndex: 6,
      }}
    >
      {cards.map((_, i) => (
        <div
          key={i}
          className="opp-card"
          style={{
            width: `${cardW}px`,
            height: `${cardH}px`,
            background: `
              repeating-linear-gradient(45deg, var(--navy) 0px, var(--navy) 3px, #0f1420 3px, #0f1420 6px),
              var(--navy)
            `,
            border: '2px solid var(--amber-dim)',
            borderRadius: '3px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.7)',
            marginLeft: i === 0 ? undefined : `${overlap}px`,
            transform: CARD_TRANSFORMS[Math.min(i, CARD_TRANSFORMS.length - 1)],
          }}
        />
      ))}
    </div>
  );
}
