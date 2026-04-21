'use client';

import type { Rank } from '../../../lib/game/types';
import { useIsMobile } from '../../../hooks/useIsMobile';

interface TargetTagProps {
  rank: Rank;
}

/**
 * `CALL · {rank}` HUD tag. Matches `.target-tag` in variant-d-across-table.html.
 * Note: variant-d HTML reads "TARGET · QUEEN" but spec §10.1 locked the text to
 * `CALL · {rank}` — spec lock takes precedence over the preview label.
 */
export function TargetTag({ rank }: TargetTagProps) {
  const isMobile = useIsMobile();
  return (
    <div
      data-testid="target-rank-tag"
      className="target-tag"
      style={{
        fontFamily: '"Press Start 2P", monospace',
        fontSize: isMobile ? '8px' : '10px',
        padding: isMobile ? '6px 10px' : '10px 16px',
        border: isMobile ? '2px solid var(--amber)' : '3px solid var(--amber)',
        background: 'rgba(26,33,48,0.92)',
        color: 'var(--amber)',
        letterSpacing: isMobile ? '2px' : '3px',
        boxShadow: isMobile ? '2px 2px 0 0 var(--shadow)' : '4px 4px 0 0 var(--shadow)',
      }}
    >
      CALL ·{' '}
      <b style={{ color: 'var(--bone)' }}>{rank.toUpperCase()}</b>
    </div>
  );
}
