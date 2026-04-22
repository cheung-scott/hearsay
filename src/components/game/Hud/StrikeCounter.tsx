'use client';

import { useIsMobile } from '../../../hooks/useIsMobile';

interface StrikeCounterProps {
  /** Number of strikes lit (0–3). */
  strikes: number;
  label?: string;
  testId?: string;
}

/**
 * Three Balatro-style chunky blocks. Lit blocks (index < strikes) show a candle
 * flame via `flicker` animation and an "X" glyph. Matches `.strikes` / `.strike`
 * / `.strike.lit` in variant-d-across-table.html.
 *
 * Mobile: shrinks block size + hides the "STRIKES" label so 3 blocks + target
 * tag both fit across a 375px viewport.
 */
export function StrikeCounter({
  strikes,
  label = 'STRIKES',
  testId = 'strikes-row',
}: StrikeCounterProps) {
  const isMobile = useIsMobile();
  // Progressive intensification: at strikes >= 2 the smoke rises faster and
  // slightly larger to match the §1.5 strike-2 CSS dim already in GameSession.
  const smokeAccelerated = strikes >= 2;
  const blockW = isMobile ? 22 : 36;
  const blockH = isMobile ? 28 : 44;
  return (
    <div
      data-testid={testId}
      className="strikes"
      style={{
        display: 'flex',
        gap: isMobile ? '6px' : '10px',
        alignItems: 'center',
      }}
    >
      {/* Local keyframes — same inline <style> pattern as JokerTray.tsx's jokerPulse. */}
      <style>{`
        @keyframes smokeWisp {
          0%   { transform: translate(-50%, 0) scale(0.9); opacity: 0.5; }
          60%  { opacity: 0.28; }
          100% { transform: translate(-50%, -18px) scale(1.6); opacity: 0; }
        }
      `}</style>
      {label && (!isMobile || label !== 'STRIKES') && (
        <span
          className="strikes-label"
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: isMobile ? '6px' : '9px',
            color: 'var(--bone-dim)',
            letterSpacing: isMobile ? '1px' : '3px',
            marginRight: isMobile ? '2px' : '6px',
          }}
        >
          {label}
        </span>
      )}
      {[0, 1, 2].map(i => {
        const lit = i < strikes;
        return (
          <div
            key={i}
            className={lit ? 'strike lit' : 'strike'}
            style={{
              position: 'relative',
              width: `${blockW}px`,
              height: `${blockH}px`,
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
              fontSize: isMobile ? '10px' : '16px',
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
            {/* Smoke wisp — rises & fades above the flame. Only on lit strikes.
                Variant-D defaults: bone-dim color, 2s/1.4s, 0.5→0 opacity ramp. */}
            {lit && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '-22px',
                  left: '50%',
                  width: '6px',
                  height: '10px',
                  background: 'var(--bone-dim)',
                  transform: 'translateX(-50%)',
                  borderRadius: '50%',
                  filter: 'blur(2px)',
                  opacity: 0,
                  pointerEvents: 'none',
                  animation: `smokeWisp ${smokeAccelerated ? '1.4s' : '2s'} ease-out infinite`,
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
