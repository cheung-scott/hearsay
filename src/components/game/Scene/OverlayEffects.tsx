'use client';

/**
 * CRT scanlines + vignette overlay. Sits at the top of the z-stack so it
 * appears above every other scene element. No props — purely cosmetic.
 */
export function OverlayEffects() {
  return (
    <div
      className="overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {/* Scanlines (~13% opacity) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.13) 3px, rgba(0,0,0,0.13) 3px)',
        }}
      />
      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 110% 110% at 50% 50%, transparent 50%, rgba(0,0,0,0.75) 100%)',
        }}
      />
    </div>
  );
}
