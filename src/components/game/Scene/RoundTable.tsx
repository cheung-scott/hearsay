'use client';

/**
 * 2.5D round wooden table. The `.table-wrap` positions the ellipse in the
 * viewport; `.round-table` applies `rotateX(60deg)` to create the perspective
 * tilt. Matches variant-d-across-table.html exactly (60deg per HTML, not
 * 58deg from DESIGN-DECISIONS — HTML is authoritative).
 */
export function RoundTable() {
  return (
    <div
      className="table-wrap"
      style={{
        position: 'absolute',
        bottom: '12%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '130%',
        height: '74%',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        className="round-table"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'linear-gradient(180deg, var(--wood-hi) 0%, var(--wood-lit) 28%, var(--wood) 60%, var(--wood-rim) 100%)',
          transform: 'rotateX(60deg)',
          transformOrigin: 'center bottom',
          boxShadow:
            '0 40px 80px rgba(0,0,0,0.85), inset 0 -40px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Wood-grain rim rings */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            backgroundImage:
              'repeating-radial-gradient(circle at 50% 100%, transparent 0px, transparent 24px, rgba(0,0,0,0.22) 25px, rgba(0,0,0,0.22) 26px)',
            pointerEvents: 'none',
          }}
        />
        {/* Felt inset */}
        <div
          style={{
            position: 'absolute',
            inset: '56px',
            borderRadius: '50%',
            background: `
              radial-gradient(ellipse 48% 38% at 50% 32%, rgba(253,162,0,0.24) 0%, transparent 75%),
              radial-gradient(ellipse 80% 80% at 50% 50%, var(--felt) 0%, var(--felt-dark) 65%, var(--felt-far) 100%)
            `,
            boxShadow: 'inset 0 0 80px rgba(0,0,0,0.7)',
          }}
        />
      </div>
    </div>
  );
}
