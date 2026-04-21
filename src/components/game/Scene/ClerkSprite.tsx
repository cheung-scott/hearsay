'use client';

/**
 * Pixel-art courtroom clerk sprite. If `/images/personas/clerk.png` exists,
 * it renders that. Otherwise falls back to the chunky inline SVG rectangles
 * painted with theme tokens (felt robe, bone face, amber-hi trim, gold
 * jabot). The ClerkTutorial still looks for `clerk-sprite` testid and the
 * 'CLERK' label — both are preserved regardless of which branch renders.
 *
 * Sized via the `size` prop (default 32×40 — matches the prior placeholder
 * so the speech-bubble header row layout is unchanged).
 */

import React, { useState } from 'react';

export interface ClerkSpriteProps {
  /** Square width of the bounding box, in px. Height = size * 1.25. */
  size?: number;
  /** Render the "CLERK" caption under the portrait. Default true. */
  showLabel?: boolean;
}

export function ClerkSprite({ size = 32, showLabel = true }: ClerkSpriteProps) {
  const h = Math.round(size * 1.25);
  const [pngFailed, setPngFailed] = useState(false);

  // Prefer the real PNG if present. onError swaps to the inline-SVG fallback
  // below so the tutorial renders in every environment.
  if (!pngFailed) {
    return (
      <div
        data-testid="clerk-sprite"
        aria-label="CLERK"
        style={{
          width: `${size}px`,
          height: `${h}px`,
          flexShrink: 0,
          background: 'var(--felt, #1a2e1a)',
          border: '2px solid var(--amber-hi, #f5c842)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: '1px',
          padding: '2px 0 1px',
          boxShadow: '2px 2px 0 0 var(--shadow, rgba(0,0,0,0.5))',
          imageRendering: 'pixelated',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/personas/clerk.png"
          alt=""
          onError={() => setPngFailed(true)}
          draggable={false}
          style={{
            width: '100%',
            height: showLabel ? `calc(100% - 8px)` : '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
        {showLabel && (
          <span
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '4px',
              color: 'var(--amber-hi, #f5c842)',
              letterSpacing: '0.5px',
              lineHeight: 1,
            }}
          >
            CLERK
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="clerk-sprite"
      aria-label="CLERK"
      style={{
        width: `${size}px`,
        height: `${h}px`,
        flexShrink: 0,
        background: 'var(--felt, #1a2e1a)',
        border: '2px solid var(--amber-hi, #f5c842)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '1px',
        padding: '2px 0 1px',
        boxShadow: '2px 2px 0 0 var(--shadow, rgba(0,0,0,0.5))',
        imageRendering: 'pixelated',
      }}
    >
      <svg
        width={size - 6}
        height={h - (showLabel ? 14 : 4)}
        viewBox="0 0 16 20"
        style={{
          shapeRendering: 'crispEdges',
          imageRendering: 'pixelated',
        }}
        aria-hidden="true"
      >
        {/* Barrister wig — 3-row chunky stack (sides curl out) */}
        <rect x="5" y="1" width="6" height="2" fill="var(--bone, #e8dcc8)" />
        <rect x="4" y="3" width="8" height="2" fill="var(--bone, #e8dcc8)" />
        <rect x="3" y="5" width="10" height="2" fill="var(--bone, #e8dcc8)" />
        {/* Wig shadow line — adds depth against the face */}
        <rect x="3" y="7" width="10" height="1" fill="var(--bone-dim, #a09070)" opacity="0.6" />
        {/* Face — bone-dim skin */}
        <rect x="5" y="7" width="6" height="3" fill="var(--bone-dim, #a09070)" />
        {/* Eyes — two tiny dark pixels */}
        <rect x="6" y="8" width="1" height="1" fill="var(--wall, #1a1209)" />
        <rect x="9" y="8" width="1" height="1" fill="var(--wall, #1a1209)" />
        {/* Mouth — single dark pixel */}
        <rect x="7" y="9" width="2" height="1" fill="var(--wall, #1a1209)" />
        {/* White jabot (collar band) — amber-hi trim */}
        <rect x="6" y="10" width="4" height="2" fill="var(--bone, #e8dcc8)" />
        <rect x="7" y="11" width="2" height="1" fill="var(--amber-hi, #f5c842)" />
        {/* Black robe — felt with amber-hi shoulder trim */}
        <rect x="3" y="12" width="10" height="6" fill="var(--felt, #1a2e1a)" stroke="var(--amber-hi, #f5c842)" strokeWidth="0.4" />
        {/* Shoulder epaulets — amber-hi accents */}
        <rect x="3" y="12" width="2" height="1" fill="var(--amber-hi, #f5c842)" />
        <rect x="11" y="12" width="2" height="1" fill="var(--amber-hi, #f5c842)" />
        {/* Sash down the middle — subtle bone stripe */}
        <rect x="7" y="13" width="2" height="4" fill="var(--bone-dim, #a09070)" opacity="0.4" />
        {/* Bottom trim */}
        <rect x="3" y="18" width="10" height="1" fill="var(--amber-dim, #c8a030)" />
      </svg>
      {showLabel && (
        <span
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '4px',
            color: 'var(--amber-hi, #f5c842)',
            letterSpacing: '0.5px',
            lineHeight: 1,
          }}
        >
          CLERK
        </span>
      )}
    </div>
  );
}
