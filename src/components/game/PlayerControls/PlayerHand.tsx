'use client';

import type { Card as CardType } from '../../../lib/game/types';
import { Card, HAND_CARD_TRANSFORMS } from './Card';
import { useIsMobile } from '../../../hooks/useIsMobile';

interface PlayerHandProps {
  /** The player's current hand of cards. */
  hand: CardType[];
  /** Set of selected card ids. */
  selectedIds: Set<string>;
  /** Called when a card is tapped. Only fires when `interactive` is true. */
  onToggle: (id: string) => void;
  /** When false, cards are rendered but clicks are ignored (non-recording phases). */
  interactive: boolean;
}

/**
 * The player's hand, tilted forward with a fan spread. Matches `.your-hand` in
 * variant-d-across-table.html. Only calls `onToggle` when `interactive` is true.
 * On mobile viewports the cards shrink to 66×96 and overlap tightens so the
 * whole 5-card fan fits within a ~360px wide container.
 */
export function PlayerHand({ hand, selectedIds, onToggle, interactive }: PlayerHandProps) {
  const isMobile = useIsMobile();
  const size = isMobile ? 'mobile' : 'desktop';
  const overlap = isMobile ? '-12px' : '-16px';
  return (
    <div
      className="your-hand"
      style={{
        position: 'absolute',
        bottom: isMobile ? '-10px' : '-20px',
        left: '50%',
        transform: 'translateX(-50%) rotateX(-22deg)',
        transformOrigin: 'center bottom',
        zIndex: 11,
        display: 'flex',
      }}
    >
      {hand.map((card, i) => (
        <div
          key={card.id}
          style={{
            marginLeft: i === 0 ? undefined : overlap,
            transform: HAND_CARD_TRANSFORMS[Math.min(i, HAND_CARD_TRANSFORMS.length - 1)],
          }}
        >
          <Card
            rank={card.rank}
            selected={selectedIds.has(card.id)}
            onClick={interactive ? () => onToggle(card.id) : undefined}
            size={size}
          />
        </div>
      ))}
    </div>
  );
}
