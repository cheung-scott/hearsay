'use client';

/**
 * Day-5 Wave-5 — Persona portrait sprite loader.
 *
 * Loads `/images/personas/{persona.toLowerCase()}.png` (or 'clerk.png' for the
 * tutorial Clerk). If the PNG is missing, falls back to the old <Silhouette>
 * so the courtroom never renders blank while portraits are being generated.
 *
 * File convention (drop-in from Retro Diffusion / Midjourney export):
 *   public/images/personas/novice.png
 *   public/images/personas/reader.png
 *   public/images/personas/misdirector.png
 *   public/images/personas/silent.png
 *   public/images/personas/clerk.png      (tutorial only — optional)
 *
 * Target aspect ≈ 2:3 bust (head + torso). 256×384 or 512×768 works; the
 * component scales to fit the silhouette's 160×240 slot.
 */

import React, { useState } from 'react';
import type { Persona } from '../../../lib/game/types';
import { Silhouette } from './Silhouette';

export interface PersonaPortraitProps {
  /** Which persona's portrait to load. `null` → tutorial Clerk slot. */
  persona: Persona | 'clerk';
  /**
   * Accent color for the fallback silhouette's eye-glow. Usually sourced from
   * PERSONA_ACCENT_COLORS. Ignored once a real PNG is loaded.
   */
  personaAccent?: string;
  /**
   * Render size — 'desktop' (240×360) or 'mobile' (160×240). Defaults to
   * desktop so SSR / non-responsive callers keep the prior behaviour.
   */
  size?: 'desktop' | 'mobile';
}

/** Maps Persona/Clerk → filename stem. Stable lowercase convention. */
function fileStemFor(persona: Persona | 'clerk'): string {
  if (persona === 'clerk') return 'clerk';
  return persona.toLowerCase();
}

export function PersonaPortrait({ persona, personaAccent, size = 'desktop' }: PersonaPortraitProps) {
  const [failed, setFailed] = useState(false);
  const stem = fileStemFor(persona);
  const src = `/images/personas/${stem}.png`;

  // Fallback — old silhouette path. Pretty + zero-load when no PNG exists.
  if (failed) {
    return <Silhouette personaAccent={personaAccent} />;
  }

  const isMobile = size === 'mobile';

  return (
    <div
      data-testid={`persona-portrait-${stem}`}
      className="persona-portrait"
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        width: isMobile ? '160px' : '240px',
        height: isMobile ? '240px' : '360px',
        animation: 'breathe 4.5s ease-in-out infinite',
        filter: 'drop-shadow(0 18px 32px rgba(0,0,0,0.9))',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""   /* decorative — persona name is in TopBar CaseLabel */
        onError={() => setFailed(true)}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center top',
          imageRendering: 'pixelated',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
