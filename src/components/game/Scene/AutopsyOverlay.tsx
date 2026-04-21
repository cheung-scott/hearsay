'use client';

/**
 * Day-5 Wave-2 — Earful preset-reveal card.
 *
 * Overlay shown after a player-won challenge while Earful joker is active.
 * Reveals which VoiceTellPreset the AI was using for that turn — teaches the
 * voice-tell taxonomy through play (joker-system spec §7.4.3).
 *
 * Auto-clears when session.autopsy is cleared by the server (ChallengeCalled
 * or RoundSettled reducers). No client dispatch needed.
 *
 * Props are frozen.
 */

import { useEffect, useRef, useState } from 'react';
import type { VoiceTellPreset } from '@/lib/game/types';

export interface AutopsyOverlayProps {
  /** The preset-reveal payload. */
  autopsy: { preset: VoiceTellPreset; roundIdx: number; turnIdx: number };
  /** Optional manual dismiss. Most calls rely on auto-clear via server reducer. */
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Preset caption data
// ---------------------------------------------------------------------------

type PresetInfo = { label: string; caption: string };

const PRESET_INFO: Record<string, PresetInfo> = {
  CONFIDENT: {
    label: 'CONFIDENT',
    caption: 'measured, over-articulated \u2014 the salesman',
  },
  HESITANT: {
    label: 'HESITANT',
    caption: 'breathy pauses, filler words \u2014 buying time',
  },
  RAMBLE: {
    label: 'RAMBLE',
    caption: 'too many words, evading commitment',
  },
  CLIPPED: {
    label: 'CLIPPED',
    caption: 'terse, minimal affect \u2014 stonewalling',
  },
  PROBE: {
    label: 'PROBE',
    caption: 'leading questions, shifting blame',
  },
};

function getPresetInfo(preset: VoiceTellPreset): PresetInfo & { known: boolean } {
  const key = preset?.toUpperCase?.() ?? '';
  if (Object.prototype.hasOwnProperty.call(PRESET_INFO, key)) {
    return { ...PRESET_INFO[key], known: true };
  }
  return { label: '[unknown preset]', caption: '', known: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AutopsyOverlay({ autopsy, onDismiss }: AutopsyOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const dismissedRef = useRef(false);
  const dismissTimerRef = useRef<number | null>(null);

  // Fade-in on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Clear pending dismiss timer on unmount (AO-3)
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, []);

  function handleDismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    dismissTimerRef.current = window.setTimeout(() => {
      onDismiss?.();
    }, 200);
  }

  // Escape-key dismiss (AO-2)
  useEffect(() => {
    if (!onDismiss) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleDismiss();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDismiss]);

  const { label, caption, known } = getPresetInfo(autopsy.preset);

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '14%',
    zIndex: 20,
    // Container does NOT block gameplay inputs
    pointerEvents: 'none',
    opacity: leaving ? 0 : visible ? 1 : 0,
    transition: leaving
      ? 'opacity 200ms ease-out'
      : 'opacity 300ms ease-in',
  };

  const cardStyle: React.CSSProperties = {
    // Re-enable pointer events only on the card itself
    pointerEvents: 'auto',
    width: 'min(360px, 92vw)',
    minHeight: 200,
    background: 'linear-gradient(160deg, #1a1006 0%, #0d0a04 100%)',
    border: '2px solid var(--amber-hi, #ffc760)',
    boxShadow:
      '4px 4px 0 0 var(--shadow, #050302), 0 0 24px rgba(253,162,0,0.4)',
    borderRadius: 4,
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    cursor: onDismiss ? 'pointer' : 'default',
    userSelect: 'none',
  };

  const headerStyle: React.CSSProperties = {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: 10,
    color: 'var(--amber-hi)',
    letterSpacing: '0.15em',
    margin: 0,
  };

  const labelSmallStyle: React.CSSProperties = {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: 8,
    color: 'var(--bone-dim)',
    letterSpacing: '0.1em',
    margin: 0,
  };

  const presetNameStyle: React.CSSProperties = {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: known ? 28 : 16,
    color: known ? 'var(--amber-hi)' : 'var(--bone-dim)',
    letterSpacing: '0.05em',
    lineHeight: 1.1,
    margin: 0,
    filter: known ? 'drop-shadow(0 0 8px var(--amber-hi))' : 'none',
  };

  const captionStyle: React.CSSProperties = {
    fontFamily: 'VT323, monospace',
    fontSize: 18,
    color: known ? 'var(--bone-dim)' : 'var(--bone-dim)',
    letterSpacing: '0.04em',
    margin: 0,
    opacity: 0.85,
  };

  const dividerStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--amber-dim)',
    opacity: 0.4,
  };

  const hintStyle: React.CSSProperties = {
    fontFamily: 'VT323, monospace',
    fontSize: 14,
    color: 'var(--amber-dim)',
    textAlign: 'center' as const,
    margin: 0,
    opacity: 0.7,
  };

  return (
    <div
      style={containerStyle}
      // data-testid for test selectors
      data-testid="autopsy-overlay-container"
    >
      <div
        style={cardStyle}
        onClick={handleDismiss}
        data-testid="autopsy-overlay-card"
      >
        <p style={headerStyle}>AUTOPSY</p>

        <div style={dividerStyle} />

        <p style={labelSmallStyle}>AI WAS USING:</p>

        <p
          style={presetNameStyle}
          data-testid="autopsy-preset-name"
        >
          {label}
        </p>

        {caption ? (
          <p style={captionStyle} data-testid="autopsy-preset-caption">
            {caption}
          </p>
        ) : null}

        {onDismiss && (
          <>
            <div style={dividerStyle} />
            <p style={hintStyle}>[ click to dismiss ]</p>
          </>
        )}
      </div>
    </div>
  );
}
