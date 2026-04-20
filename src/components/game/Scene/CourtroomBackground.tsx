'use client';

/**
 * CourtroomBackground — iter-6 §10.6 courtroom re-skin.
 *
 * Layers (bottom to top within z: 0):
 *   1. Ambient radial gradient — warm amber centre, dark edges
 *   2. Wall paneling — repeating vertical seams
 *   3. Judge's bench silhouette — upper 35%, dark wood, clipped bottom edge
 *   4. Bench wood-grain stripe overlay
 *   5. Two column silhouettes — left/right edges full height
 *   6. Pendant lamps (×2) with chain + glow + flicker animation
 *   7. Scales of justice emblem — top-center, inline SVG
 *
 * All layers:
 *   - position: absolute
 *   - pointer-events: none
 *   - zIndex: 0 (or children thereof)  ← stays BELOW all Scene children
 *
 * Pure CSS + inline SVG — no image assets.
 */
export function CourtroomBackground() {
  return (
    <div
      data-testid="courtroom-background"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {/* ── Layer 1: Ambient radial gradient backdrop ───────────────── */}
      <div
        data-testid="courtroom-ambient"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(
              ellipse 70% 55% at 50% 0%,
              rgba(253,162,0,0.08) 0%,
              rgba(42,22,8,0.35) 50%,
              #0a0605 100%
            )
          `,
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 2: Vertical wall-paneling seams ───────────────────── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `repeating-linear-gradient(
            90deg,
            transparent 0px, transparent 48px,
            #0f0905 49px, #0f0905 50px,
            transparent 51px, transparent 96px,
            rgba(15,9,5,0.5) 97px, rgba(15,9,5,0.5) 98px
          )`,
          pointerEvents: 'none',
        }}
      />

      {/* ── Layer 3: Judge's bench — upper 35% ──────────────────────── */}
      <div
        data-testid="courtroom-bench"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '35%',
          background: `linear-gradient(
            180deg,
            var(--bench-wood) 0%,
            var(--bench-wood-hi) 40%,
            var(--bench-wood) 70%,
            #1a0c06 100%
          )`,
          /* Angled bottom edge — tapers slightly inward for depth */
          clipPath: 'polygon(0 0, 100% 0, 100% 85%, 52% 100%, 48% 100%, 0 85%)',
          pointerEvents: 'none',
        }}
      >
        {/* Layer 4: Wood-grain horizontal stripe overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `repeating-linear-gradient(
              180deg,
              transparent 0px, transparent 11px,
              rgba(0,0,0,0.18) 12px, rgba(0,0,0,0.18) 13px,
              transparent 14px, transparent 25px,
              rgba(255,255,255,0.025) 26px, rgba(255,255,255,0.025) 27px
            )`,
            pointerEvents: 'none',
          }}
        />
        {/* Bench front-edge highlight */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: `linear-gradient(90deg,
              transparent 0%,
              rgba(212,168,74,0.3) 20%,
              rgba(212,168,74,0.5) 50%,
              rgba(212,168,74,0.3) 80%,
              transparent 100%
            )`,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Layer 5a: Left column silhouette ────────────────────────── */}
      <div
        data-testid="courtroom-column-left"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '52px',
          height: '100%',
          background: `var(--column-dark)`,
          pointerEvents: 'none',
        }}
      >
        {/* Column capital (square top block) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '-8px',
            width: '68px',
            height: '28px',
            background: 'var(--column-dark)',
            pointerEvents: 'none',
          }}
        />
        {/* Column base */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '-8px',
            width: '68px',
            height: '20px',
            background: 'var(--column-dark)',
            pointerEvents: 'none',
          }}
        />
        {/* Subtle highlight line on right edge */}
        <div
          style={{
            position: 'absolute',
            top: '28px',
            right: 0,
            width: '2px',
            bottom: '20px',
            background: 'rgba(212,168,74,0.08)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Layer 5b: Right column silhouette ───────────────────────── */}
      <div
        data-testid="courtroom-column-right"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '52px',
          height: '100%',
          background: `var(--column-dark)`,
          pointerEvents: 'none',
        }}
      >
        {/* Column capital */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: '-8px',
            width: '68px',
            height: '28px',
            background: 'var(--column-dark)',
            pointerEvents: 'none',
          }}
        />
        {/* Column base */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: '-8px',
            width: '68px',
            height: '20px',
            background: 'var(--column-dark)',
            pointerEvents: 'none',
          }}
        />
        {/* Subtle highlight line on left edge */}
        <div
          style={{
            position: 'absolute',
            top: '28px',
            left: 0,
            width: '2px',
            bottom: '20px',
            background: 'rgba(212,168,74,0.08)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Layer 6a: Left pendant lamp ──────────────────────────────── */}
      <PendantLamp side="left" />

      {/* ── Layer 6b: Right pendant lamp ─────────────────────────────── */}
      <PendantLamp side="right" />

      {/* ── Layer 7: Scales of justice emblem ───────────────────────── */}
      <div
        data-testid="courtroom-scales"
        style={{
          position: 'absolute',
          top: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0.45,
          pointerEvents: 'none',
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Vertical pole */}
          <line x1="20" y1="2" x2="20" y2="36" stroke="var(--gold)" strokeWidth="2" />
          {/* Horizontal balance bar */}
          <line x1="6" y1="10" x2="34" y2="10" stroke="var(--gold)" strokeWidth="2" />
          {/* Top ornament */}
          <rect x="17" y="0" width="6" height="4" fill="var(--gold)" />
          {/* Left hanging chain */}
          <line x1="6" y1="10" x2="6" y2="22" stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="2 2" />
          {/* Right hanging chain */}
          <line x1="34" y1="10" x2="34" y2="22" stroke="var(--gold)" strokeWidth="1.5" strokeDasharray="2 2" />
          {/* Left pan */}
          <path d="M2 22 Q6 28 10 22" stroke="var(--gold)" strokeWidth="1.5" fill="none" />
          {/* Right pan */}
          <path d="M30 22 Q34 28 38 22" stroke="var(--gold)" strokeWidth="1.5" fill="none" />
          {/* Base */}
          <line x1="14" y1="36" x2="26" y2="36" stroke="var(--gold)" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

// ─── Pendant Lamp sub-component ──────────────────────────────────────────────

interface PendantLampProps {
  side: 'left' | 'right';
}

function PendantLamp({ side }: PendantLampProps) {
  const isLeft = side === 'left';
  return (
    <div
      data-testid={`courtroom-lamp-${side}`}
      style={{
        position: 'absolute',
        top: 0,
        ...(isLeft ? { left: '22%' } : { right: '22%' }),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Chain stem from ceiling */}
      <div
        style={{
          width: '2px',
          height: '44px',
          background: 'linear-gradient(180deg, #1a0f08 0%, #2a1608 100%)',
          opacity: 0.85,
          flexShrink: 0,
        }}
      />
      {/* Lamp globe */}
      <div
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 35%, var(--amber-hi) 0%, var(--amber-dim) 60%, #3a1e0c 100%)',
          boxShadow: `
            0 0 12px var(--lamp-glow),
            0 0 28px var(--lamp-glow),
            0 0 6px rgba(255,199,96,0.8)
          `,
          animation: 'lamp-flicker 4s ease-in-out infinite',
          animationDelay: isLeft ? '0s' : '1.3s',
          flexShrink: 0,
        }}
      />
      {/* Light pool below lamp */}
      <div
        style={{
          width: '60px',
          height: '24px',
          marginTop: '-6px',
          background: 'radial-gradient(ellipse 50% 100% at 50% 0%, rgba(253,162,0,0.18) 0%, transparent 100%)',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      />
    </div>
  );
}
