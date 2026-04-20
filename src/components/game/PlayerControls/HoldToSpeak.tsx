'use client';

import type { GamePhase } from '../../../hooks/useGameSession';
import { Waveform } from './Waveform';

/** Mirrors the `HoldState` type from `useHoldToSpeak.ts` (not exported). */
export type HoldState = 'idle' | 'requesting' | 'recording' | 'stopped';

interface HoldToSpeakProps {
  phase: GamePhase;
  onStart: () => void;
  onStop: () => void;
  waveformData: Uint8Array | null;
  state: HoldState;
}

/**
 * Press-and-hold mic button. Active only during `phase === 'recording'`.
 * Shows `HOLD TO SPEAK` when idle/stopped, `RELEASE` while recording.
 * Mouse + touch both supported for hold UX.
 */
export function HoldToSpeak({ phase, onStart, onStop, waveformData, state }: HoldToSpeakProps) {
  if (phase !== 'recording') return null;

  const isRecording = state === 'recording';
  const label = isRecording ? 'RELEASE' : 'HOLD TO SPEAK';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '30%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      {/* Waveform display */}
      <div
        style={{
          background: 'rgba(26,33,48,0.85)',
          border: '2px solid var(--amber-dim)',
          padding: '4px',
        }}
      >
        <Waveform data={waveformData} />
      </div>

      {/* Hold-to-speak button */}
      <button
        data-testid="hold-to-speak"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '11px',
          letterSpacing: '2px',
          background: isRecording
            ? 'rgba(253,162,0,0.2)'
            : 'rgba(13,31,23,0.92)',
          color: isRecording ? 'var(--amber-hi)' : 'var(--amber)',
          border: isRecording
            ? '3px solid var(--amber-hi)'
            : '3px solid var(--amber)',
          padding: '14px 26px',
          cursor: 'pointer',
          boxShadow: isRecording
            ? '0 0 18px rgba(255,199,96,0.5), 4px 4px 0 0 var(--shadow)'
            : '4px 4px 0 0 var(--shadow)',
          textTransform: 'uppercase',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
        onMouseDown={onStart}
        onMouseUp={onStop}
        onMouseLeave={onStop}
        onTouchStart={e => { e.preventDefault(); onStart(); }}
        onTouchEnd={e => { e.preventDefault(); onStop(); }}
      >
        {/* Mic icon — unicode fallback */}
        <span style={{ fontSize: '16px' }}>🎙</span>
        {label}
        {/* Pulse ring when recording */}
        {isRecording && (
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--amber-hi)',
              boxShadow: '0 0 10px var(--amber-hi)',
              animation: 'breathe 1s ease-in-out infinite',
            }}
          />
        )}
      </button>
    </div>
  );
}
