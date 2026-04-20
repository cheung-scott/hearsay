'use client';

/**
 * ProbeReveal — non-modal overlay shown when the current round has an active
 * probe (Stage Whisper joker consumed). Renders the server-filtered reasoning
 * snippet with a live countdown bar.
 *
 * Design contract:
 * - Overlay only (gameplay visible underneath — not a modal)
 * - Positioned top-center, ~340px wide
 * - "STAGE WHISPER — OVERHEARD" label in Press Start 2P / amber
 * - Revealed reasoning in italic bone/white
 * - Filter-source pill (heuristic → amber, regex-scrub → gray, fallback → coral)
 * - Horizontal countdown bar shrinking from 100% → 0% over decayMs
 * - useEffect + setInterval (100ms tick) for local remainingMs state
 * - Interval cleaned up on unmount (no leak)
 * - No dismiss button — auto-clears via server ProbeExpired event
 * - aria-live="polite" for screen-reader accessibility
 *
 * Props are frozen — see ProbeRevealProps below.
 */

import { useEffect, useState } from 'react';
import type { RevealedProbe } from '@/lib/game/types';

export interface ProbeRevealProps {
  /** The filtered probe reveal for the current round. */
  probe: RevealedProbe;
}

// ---------------------------------------------------------------------------
// Filter-source pill config
// ---------------------------------------------------------------------------

interface PillConfig {
  label: string;
  color: string;
}

function getPillConfig(filterSource: RevealedProbe['filterSource']): PillConfig {
  switch (filterSource) {
    case 'llm-heuristic-layer':
      return { label: 'HEURISTIC', color: 'var(--amber, #fda200)' };
    case 'regex-scrub':
      return { label: 'SANITIZED', color: '#9ca3af' /* gray */ };
    case 'fallback-static':
      return { label: 'INTUITION', color: 'var(--coral, #fd5f55)' };
    default: {
      const _exhaustive: never = filterSource;
      throw new Error('Unknown filterSource: ' + _exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProbeReveal({ probe }: ProbeRevealProps) {
  const totalMs = probe.decayMs > 0 ? probe.decayMs : 1;

  const [remainingMs, setRemainingMs] = useState<number>(() =>
    Math.max(0, probe.expiresAt - Date.now()),
  );

  useEffect(() => {
    // Kick off a 100ms tick to track remaining time
    const id = setInterval(() => {
      const r = Math.max(0, probe.expiresAt - Date.now());
      setRemainingMs(r);
    }, 100);

    return () => {
      clearInterval(id);
    };
  }, [probe.expiresAt]);

  const progressPct = Math.min(100, (remainingMs / totalMs) * 100);
  const pill = getPillConfig(probe.filterSource);

  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'absolute',
        top: '96px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '340px',
        zIndex: 20,
        background: 'var(--navy, #1a2130)',
        border: '2px solid var(--amber, #fda200)',
        boxShadow: '4px 4px 0 0 var(--shadow, #050302), 0 0 28px rgba(253,162,0,0.35)',
        padding: '12px 16px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* ── Header row: label + pill ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        {/* "STAGE WHISPER — OVERHEARD" label */}
        <span
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '7px',
            letterSpacing: '1px',
            color: 'var(--amber, #fda200)',
            lineHeight: 1.4,
          }}
        >
          STAGE WHISPER — OVERHEARD
        </span>

        {/* Filter-source pill */}
        <span
          data-filter-source={probe.filterSource}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '6px',
            letterSpacing: '0.5px',
            color: pill.color,
            border: `1px solid ${pill.color}`,
            padding: '2px 5px',
            whiteSpace: 'nowrap',
            opacity: 0.85,
          }}
        >
          {pill.label}
        </span>
      </div>

      {/* ── Revealed reasoning text ───────────────────────────────────── */}
      <p
        style={{
          margin: 0,
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '10px',
          lineHeight: 1.7,
          color: 'var(--bone, #f4ecd8)',
          fontStyle: 'italic',
          wordBreak: 'break-word',
        }}
      >
        {probe.revealedReasoning}
      </p>

      {/* ── Countdown bar ────────────────────────────────────────────── */}
      <div
        aria-label="time remaining"
        style={{
          width: '100%',
          height: '3px',
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: '100%',
            background: 'var(--amber, #fda200)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  );
}
