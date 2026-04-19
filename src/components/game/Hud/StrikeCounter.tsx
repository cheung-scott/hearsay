'use client';

interface StrikeCounterProps {
  /** Number of strikes lit (0–3). */
  strikes: number;
}

/**
 * Three Balatro-style chunky blocks. Lit blocks (index < strikes) show a candle
 * flame via `flicker` animation and an "X" glyph. Matches `.strikes` / `.strike`
 * / `.strike.lit` in variant-d-across-table.html.
 */
export function StrikeCounter({ strikes }: StrikeCounterProps) {
  return (
    <div
      className="strikes"
      style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
      }}
    >
      <span
        className="strikes-label"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '9px',
          color: 'var(--bone-dim)',
          letterSpacing: '3px',
          marginRight: '6px',
        }}
      >
        STRIKES
      </span>
      {[0, 1, 2].map(i => {
        const lit = i < strikes;
        return (
          <div
            key={i}
            className={lit ? 'strike lit' : 'strike'}
            style={{
              position: 'relative',
              width: '36px',
              height: '44px',
              background: lit
                ? 'linear-gradient(180deg, var(--coral) 0%, var(--blood) 100%)'
                : '#1a1f1a',
              border: lit ? '3px solid var(--coral)' : '3px solid #2a3b2f',
              boxShadow: lit
                ? '0 0 18px rgba(253,95,85,0.8), 3px 3px 0 0 var(--shadow), inset 0 -4px 0 rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.2)'
                : '3px 3px 0 0 var(--shadow), inset 0 -4px 0 rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '16px',
              color: lit ? 'var(--bone)' : 'transparent',
              textShadow: lit ? '0 2px 0 rgba(0,0,0,0.5)' : undefined,
            }}
          >
            {/* Candle flame — only on lit strikes */}
            {lit && (
              <div
                style={{
                  position: 'absolute',
                  top: '-8px',
                  left: '50%',
                  width: '4px',
                  height: '10px',
                  background: 'var(--amber-hi)',
                  transform: 'translateX(-50%)',
                  borderRadius: '50% 50% 40% 40%',
                  boxShadow: '0 0 8px var(--amber-hi), 0 0 14px var(--amber)',
                  animation: 'flicker 1.2s ease-in-out infinite alternate',
                }}
              />
            )}
            {lit && 'X'}
          </div>
        );
      })}
    </div>
  );
}
