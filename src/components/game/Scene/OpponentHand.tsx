'use client';

interface OpponentHandProps {
  /** Number of face-down card backs to render. */
  handSize: number;
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
export function OpponentHand({ handSize }: OpponentHandProps) {
  const cards = Array.from({ length: handSize });

  return (
    <div
      className="opponent-hand"
      style={{
        position: 'absolute',
        top: '210px',           // was 132px — scaled down the portrait height to keep
                                // the hand fanned around the character's chest level
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
            width: '42px',
            height: '60px',
            background: `
              repeating-linear-gradient(45deg, var(--navy) 0px, var(--navy) 3px, #0f1420 3px, #0f1420 6px),
              var(--navy)
            `,
            border: '2px solid var(--amber-dim)',
            borderRadius: '3px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.7)',
            marginLeft: i === 0 ? undefined : '-14px',
            transform: CARD_TRANSFORMS[Math.min(i, CARD_TRANSFORMS.length - 1)],
          }}
        />
      ))}
    </div>
  );
}
