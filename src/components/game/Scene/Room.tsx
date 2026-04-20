'use client';

import { CourtroomBackground } from './CourtroomBackground';

/**
 * Backdrop: courtroom re-skin (iter-6 §10.6) layered under all scene children.
 *
 * Composition:
 *   1. Base wall gradient (--wall tones, matches variant-d aesthetic)
 *   2. CourtroomBackground — judge bench, columns, pendant lamps, scales, paneling
 *   3. Centre hanging bulb (original variant-d amber bulb — now supplemented by
 *      pendant lamps from CourtroomBackground)
 *
 * z-index discipline: Room sits at z:0; Scene children (Opponent, RoundTable, etc.)
 * render ON TOP with their own z-indices (4–12). Overlays sit at z:30+.
 */
export function Room() {
  return (
    <>
      {/* Base wall gradient — warm amber pool + dark floor */}
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
        {/* Courtroom re-skin motifs — bench, columns, lamps, scales */}
        <CourtroomBackground />

        {/* Centre hanging bulb stem + amber glow (original variant-d) */}
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
            pointerEvents: 'none',
          }}
        />
      </div>
    </>
  );
}
