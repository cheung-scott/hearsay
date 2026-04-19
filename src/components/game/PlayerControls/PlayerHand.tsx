'use client';

import type { Card as CardType } from '../../../lib/game/types';
import { Card, HAND_CARD_TRANSFORMS } from './Card';

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
 */
export function PlayerHand({ hand, selectedIds, onToggle, interactive }: PlayerHandProps) {
  return (
    <div
      className="your-hand"
      style={{
        position: 'absolute',
        bottom: '-20px',
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
            marginLeft: i === 0 ? undefined : '-16px',
            transform: HAND_CARD_TRANSFORMS[Math.min(i, HAND_CARD_TRANSFORMS.length - 1)],
          }}
        >
          <Card
            rank={card.rank}
            selected={selectedIds.has(card.id)}
            onClick={interactive ? () => onToggle(card.id) : undefined}
          />
        </div>
      ))}
    </div>
  );
}
