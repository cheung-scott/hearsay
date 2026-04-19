'use client';

interface RoundsWonGavelsProps {
  /** Number of rounds the player has won (gold-filled slots). */
  roundsWon: number;
  /** Number of rounds the player has lost (red-X slots). */
  roundsLost: number;
  /** The current round number (1-based). Used to color the pending slot. */
  currentRound: number;
}

/**
 * Three mini-gavel slots below the strike counter (per DESIGN-DECISIONS.md §10.3).
 * Slot state (left to right):
 *   - i < roundsWon       → gold-filled (player won)
 *   - i < roundsWon + roundsLost → red-X (player lost)
 *   - else                → empty/dim (not yet played)
 *
 * No variant-d HTML reference — invented to follow §10.3 palette.
 */
export function RoundsWonGavels({ roundsWon, roundsLost, currentRound: _currentRound }: RoundsWonGavelsProps) {
  return (
    <div
      className="rounds-won-gavels"
      style={{
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        marginTop: '6px',
      }}
    >
      {[0, 1, 2].map(i => {
        const won = i < roundsWon;
        const lost = !won && i < roundsWon + roundsLost;

        return (
          <div
            key={i}
            className={won ? 'gavel-slot gavel-won' : lost ? 'gavel-slot gavel-lost' : 'gavel-slot gavel-empty'}
            title={won ? 'Round won' : lost ? 'Round lost' : 'Pending'}
            style={{
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: won
                ? '2px solid var(--amber)'
                : lost
                  ? '2px solid var(--coral)'
                  : '2px solid #2a3b2f',
              background: won
                ? 'rgba(253,162,0,0.15)'
                : lost
                  ? 'rgba(253,95,85,0.15)'
                  : '#1a1f1a',
              borderRadius: '3px',
              boxShadow: won
                ? '0 0 8px rgba(253,162,0,0.4)'
                : lost
                  ? '0 0 8px rgba(253,95,85,0.3)'
                  : 'none',
              fontSize: '12px',
              lineHeight: 1,
            }}
          >
            {won && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                {/* Simple gavel silhouette */}
                <rect x="2" y="6" width="7" height="3" rx="1" fill="var(--amber)" />
                <rect x="9" y="7" width="4" height="1.5" rx="0.5" fill="var(--amber-dim)" />
                <rect x="1" y="5" width="4" height="5" rx="1" fill="var(--amber-hi)" />
              </svg>
            )}
            {lost && (
              <span
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: '9px',
                  color: 'var(--coral)',
                  lineHeight: 1,
                }}
              >
                ✕
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
