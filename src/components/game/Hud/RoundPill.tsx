'use client';

interface RoundPillProps {
  roundNumber: 1 | 2 | 3;
}

/**
 * Center HUD label: `ROUND N · BEST OF 3`. Matches `.round-pill` in
 * variant-d-across-table.html.
 */
export function RoundPill({ roundNumber }: RoundPillProps) {
  const padded = String(roundNumber).padStart(2, '0');

  return (
    <div
      className="round-pill"
      style={{
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: 'var(--bone-dim)',
        letterSpacing: '4px',
        textAlign: 'center',
      }}
    >
      ROUND <b style={{ color: 'var(--amber)' }}>{padded}</b> · BEST OF 3
    </div>
  );
}
