'use client';

/**
 * Day-5 Wave-5 playtest fix — outcome + STT-readback banners.
 *
 * Two ephemeral banners to give the player visual feedback:
 *   1. <YouPlayedBanner> — "YOU PLAYED: 3 QUEENS" right after the player's
 *      structured claim is registered. Confirms that STT / selection was
 *      heard correctly. Visible during the AI's response turn.
 *   2. <ChallengeOutcomeBanner> — "LIAR CAUGHT" / "STRIKE TO YOU" / "ACCEPTED"
 *      after a response resolves. Auto-dismisses after 2.2s.
 *
 * Purely presentational — parents control visibility + timing.
 */

import React from 'react';
import type { PlayerSpeechParse } from '@/hooks/useGameSession';

// ---------------------------------------------------------------------------
// YouPlayedBanner — STT readback shown after player makes a claim.
// ---------------------------------------------------------------------------

export interface YouPlayedBannerProps {
  /** The structured claim text (e.g. "3 Queens"). Null/empty → hidden. */
  text: string | null;
  /** Parent controls whether to render (e.g. only during certain phases). */
  visible: boolean;
}

export function YouPlayedBanner({ text, visible }: YouPlayedBannerProps) {
  if (!visible || !text) return null;
  return (
    <div
      data-testid="you-played-banner"
      style={{
        position: 'fixed',
        bottom: '12%',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '92vw',
        zIndex: 28,
        background: 'rgba(13,31,23,0.88)',
        border: '2px solid var(--amber, #fda200)',
        color: 'var(--bone, #e8dcc8)',
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '9px',
        letterSpacing: '2px',
        padding: '8px 14px',
        boxShadow: '4px 4px 0 0 var(--shadow, rgba(0,0,0,0.5))',
        pointerEvents: 'none',
        textTransform: 'uppercase',
        userSelect: 'none',
        whiteSpace: 'normal',
        textAlign: 'center',
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: 'var(--amber-hi, #ffc760)', marginRight: '8px' }}>
        YOU CALLED ·
      </span>
      <span style={{ color: 'var(--bone, #e8dcc8)' }}>{text}</span>
    </div>
  );
}

export interface SpeechParseBannerProps {
  parse?: PlayerSpeechParse;
  visible: boolean;
}

function formatParsedClaim(parsed: PlayerSpeechParse['parsed']): string {
  if (!parsed) return 'NOT RECOGNIZED';
  const rank = parsed.count === 2 ? `${parsed.rank}s` : parsed.rank;
  return `${parsed.count} ${rank}`;
}

function formatExpectedClaim(expected: PlayerSpeechParse['expected']): string {
  const rank = expected.count === 2 ? `${expected.rank}s` : expected.rank;
  return `${expected.count} ${rank}`;
}

export function SpeechParseBanner({ parse, visible }: SpeechParseBannerProps) {
  if (!visible || !parse) return null;
  const transcript = parse.transcript.trim() || '(no speech recognized)';
  const accent = parse.valid ? 'var(--amber-hi, #ffc760)' : 'var(--coral, #fd5f55)';

  return (
    <div
      data-testid="speech-parse-banner"
      data-valid={parse.valid ? 'true' : 'false'}
      style={{
        position: 'fixed',
        bottom: '19%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(520px, 92vw)',
        zIndex: 29,
        background: 'rgba(10,16,8,0.92)',
        border: `2px solid ${accent}`,
        color: 'var(--bone, #e8dcc8)',
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '8px',
        letterSpacing: '1px',
        lineHeight: 1.6,
        padding: '10px 12px',
        boxShadow: '4px 4px 0 0 var(--shadow, rgba(0,0,0,0.5))',
        pointerEvents: 'none',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}
    >
      <div style={{ color: accent, marginBottom: '5px' }}>
        SPEECH PARSE {parse.valid ? 'OK' : 'FAILED'}
      </div>
      <div>
        <span style={{ color: 'var(--bone-dim, #a09070)' }}>HEARD: </span>
        <span>{transcript}</span>
      </div>
      <div>
        <span style={{ color: 'var(--bone-dim, #a09070)' }}>PARSED: </span>
        <span>{formatParsedClaim(parse.parsed)}</span>
        <span style={{ color: 'var(--bone-dim, #a09070)' }}> / EXPECTED: </span>
        <span>{formatExpectedClaim(parse.expected)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChallengeOutcomeBanner — reveals Liar/Truth/Accepted result.
// ---------------------------------------------------------------------------

export type ChallengeOutcome =
  /** Player called LIAR and was right — AI gets a strike. */
  | 'caught-lie'
  /** Player called LIAR and was wrong — player gets a strike. */
  | 'false-accusation'
  /** Player accepted — claim goes through, no reveal. */
  | 'accepted'
  /** AI called LIAR on the player and caught them. */
  | 'player-caught'
  /** AI called LIAR on the player but player was honest — AI strike. */
  | 'ai-wrong-call';

const OUTCOME_COPY: Record<ChallengeOutcome, { label: string; sub: string; accent: string }> = {
  'caught-lie':       { label: 'LIAR CAUGHT',   sub: 'Strike to the defendant',  accent: 'var(--amber-hi, #ffc760)' },
  'false-accusation': { label: 'FALSE ACCUSATION', sub: 'Strike to you',         accent: 'var(--coral, #fd5f55)' },
  'accepted':         { label: 'ACCEPTED',      sub: 'Claim stands',             accent: 'var(--bone, #e8dcc8)' },
  'player-caught':    { label: 'YOU GOT CAUGHT',sub: 'Strike to you',            accent: 'var(--coral, #fd5f55)' },
  'ai-wrong-call':    { label: 'YOU TOLD TRUTH',sub: 'Strike to the defendant', accent: 'var(--amber-hi, #ffc760)' },
};

export interface ChallengeOutcomeBannerProps {
  /** When null, nothing renders. */
  outcome: ChallengeOutcome | null;
}

export function ChallengeOutcomeBanner({ outcome }: ChallengeOutcomeBannerProps) {
  if (!outcome) return null;
  const copy = OUTCOME_COPY[outcome];
  return (
    <>
      <style>{`
        @keyframes outcomeBannerIn {
          0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          60%  { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `}</style>
      <div
        data-testid="challenge-outcome-banner"
        data-outcome={outcome}
        style={{
          position: 'fixed',
          top: '42%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxWidth: '92vw',
          zIndex: 40,
          background: 'rgba(10,16,8,0.92)',
          border: `3px solid ${copy.accent}`,
          color: copy.accent,
          fontFamily: '"Press Start 2P", monospace',
          padding: '20px 28px',
          boxShadow: '6px 6px 0 0 var(--shadow, rgba(0,0,0,0.6)), 0 0 24px rgba(0,0,0,0.4)',
          textAlign: 'center',
          pointerEvents: 'none',
          userSelect: 'none',
          animation: 'outcomeBannerIn 420ms cubic-bezier(0.2, 0.9, 0.2, 1)',
        }}
      >
        <div
          style={{
            fontSize: '18px',
            letterSpacing: '4px',
            marginBottom: '10px',
            textTransform: 'uppercase',
          }}
        >
          {copy.label}
        </div>
        <div
          style={{
            fontSize: '8px',
            letterSpacing: '2px',
            color: 'var(--bone-dim, #a09070)',
            textTransform: 'uppercase',
          }}
        >
          {copy.sub}
        </div>
      </div>
    </>
  );
}
