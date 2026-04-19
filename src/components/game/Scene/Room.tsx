'use client';

/**
 * Backdrop: wall gradient + wood-paneling seams (::before) + hanging bulb with
 * light pool (::after). Matches `.room` in variant-d-across-table.html.
 */
export function Room() {
  return (
    <>
      {/* Main room backdrop — wall gradient + amber bulb pool */}
      <div
        className="room"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background: `
            radial-gradient(ellipse 55% 45% at 50% 12%, rgba(253,162,0,0.22) 0%, transparent 60%),
            linear-gradient(180deg, var(--wall) 0%, var(--wall-lit) 30%, var(--wall) 65%, #0a0604 100%)
          `,
          zIndex: 0,
        }}
      >
        {/* Wood paneling seams */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `repeating-linear-gradient(
              90deg,
              transparent 0px, transparent 120px,
              rgba(0,0,0,0.15) 121px, rgba(0,0,0,0.15) 123px,
              transparent 124px, transparent 244px,
              rgba(0,0,0,0.08) 245px, rgba(0,0,0,0.08) 247px
            )`,
            pointerEvents: 'none',
          }}
        />
        {/* Hanging bulb stem + light pool */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '4px',
            height: '70px',
            background: 'linear-gradient(180deg, #2a1a0f 0%, #1a0f08 100%)',
            boxShadow:
              '0 62px 0 0 var(--amber), 0 62px 50px 14px rgba(253,162,0,0.6)',
            zIndex: 2,
          }}
        />
      </div>
    </>
  );
}
