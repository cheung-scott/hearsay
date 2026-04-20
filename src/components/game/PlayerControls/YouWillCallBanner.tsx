'use client';

/**
 * Day-5 Wave-5 playtest fix — "YOU WILL CALL · TWO QUEENS" preview banner.
 *
 * Sits just above the HoldToSpeak button during `phase === 'recording'`.
 * Makes it unambiguous to first-time players that:
 *   1. The rank you call is LOCKED to the round's target rank (shown in HUD).
 *   2. The number of cards you pick determines "one" vs "two".
 *   3. The actual cards can be anything — the banner previews the CLAIM, not
 *      the cards.
 *
 * Dim prompt ("PICK 1 OR 2 CARDS") when nothing selected; bright amber
 * active state once the player has a valid selection.
 */

import React from 'react';
import type { Rank } from '../../../lib/game/types';

export interface YouWillCallBannerProps {
  /** Only rendered when true. Parent drives visibility from phase. */
  visible: boolean;
  /** Number of cards the player currently has selected. 0 → prompt state. */
  selectedCount: number;
  /** Round target rank, displayed uppercased. */
  targetRank: Rank;
}

function numberWord(n: number): string {
  switch (n) {
    case 1: return 'ONE';
    case 2: return 'TWO';
    default: return String(n);
  }
}

export function YouWillCallBanner({
  visible,
  selectedCount,
  targetRank,
}: YouWillCallBannerProps) {
  if (!visible) return null;

  const valid = selectedCount === 1 || selectedCount === 2;
  const tooMany = selectedCount > 2;

  // Dim / prompt state vs active / preview state.
  const accent = valid
    ? 'var(--amber-hi, #ffc760)'
    : tooMany
      ? 'var(--coral, #fd5f55)'
      : 'var(--bone-dim, #a09070)';

  const label = valid
    ? 'YOU WILL CALL'
    : tooMany
      ? 'TOO MANY CARDS'
      : 'PICK 1 OR 2 CARDS';

  const value = valid
    ? `${numberWord(selectedCount)} ${targetRank.toUpperCase()}${selectedCount > 1 ? 'S' : ''}`
    : tooMany
      ? 'KEEP 1 OR 2'
      : `CLAIM LOCKED TO ${targetRank.toUpperCase()}`;

  return (
    <div
      data-testid="you-will-call-banner"
      style={{
        position: 'absolute',
        bottom: '39%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 21,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 14px',
        background: 'rgba(10,16,8,0.78)',
        border: `2px solid ${accent}`,
        boxShadow: '3px 3px 0 0 var(--shadow, rgba(0,0,0,0.5))',
        fontFamily: '"Press Start 2P", monospace',
        userSelect: 'none',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          fontSize: '7px',
          letterSpacing: '2px',
          color: 'var(--bone-dim, #a09070)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '10px',
          letterSpacing: '2px',
          color: accent,
          textTransform: 'uppercase',
        }}
      >
        ·
      </span>
      <span
        style={{
          fontSize: '9px',
          letterSpacing: '2px',
          color: accent,
          textTransform: 'uppercase',
        }}
      >
        {value}
      </span>
    </div>
  );
}
