'use client';

import type { Rank } from '../../../lib/game/types';

interface TargetTagProps {
  rank: Rank;
}

/**
 * `CALL · {rank}` HUD tag. Matches `.target-tag` in variant-d-across-table.html.
 * Note: variant-d HTML reads "TARGET · QUEEN" but spec §10.1 locked the text to
 * `CALL · {rank}` — spec lock takes precedence over the preview label.
 */
export function TargetTag({ rank }: TargetTagProps) {
  return (
    <div
      className="target-tag"
      style={{
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        padding: '10px 16px',
        border: '3px solid var(--amber)',
        background: 'rgba(26,33,48,0.92)',
        color: 'var(--amber)',
        letterSpacing: '3px',
        boxShadow: '4px 4px 0 0 var(--shadow)',
      }}
    >
      CALL ·{' '}
      <b style={{ color: 'var(--bone)' }}>{rank.toUpperCase()}</b>
    </div>
  );
}
