'use client';

/**
 * Day-5 Wave-5 — Gauntlet case label for the TopBar.
 *
 * Displays "CASE X OF N — THE {PERSONA}" during the gauntlet, or
 * "CASE DISMISSED" when all opponents are defeated.
 *
 * Props are FROZEN.
 */

import { PERSONA_DISPLAY_NAMES } from '@/lib/persona/displayNames';
import type { Persona } from '@/lib/game/types';

export interface CaseLabelProps {
  /** 1-based case number. 0 or negative = hidden. */
  caseNumber: number;
  /** Total cases in the gauntlet (4 for v1). */
  totalCases: number;
  /** Current AI persona (the defendant you're facing). */
  persona: Persona | null;
}

const baseLabelStyle: React.CSSProperties = {
  fontFamily: '"Press Start 2P", monospace',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--amber-hi, #ffd966)',
  userSelect: 'none',
  lineHeight: 1.5,
};

export function CaseLabel({ caseNumber, totalCases, persona }: CaseLabelProps) {
  // Hidden when caseNumber is invalid or persona is unknown.
  if (caseNumber <= 0 || persona === null) return null;

  // "CASE DISMISSED" final-win variant: caseNumber > totalCases means all opponents beaten.
  if (caseNumber > totalCases) {
    return (
      <div
        data-testid="case-label-dismissed"
        style={{
          ...baseLabelStyle,
          fontSize: '20px',
          textAlign: 'center',
        }}
      >
        CASE DISMISSED
      </div>
    );
  }

  const displayName = PERSONA_DISPLAY_NAMES[persona].toUpperCase();

  return (
    <div
      data-testid="case-label"
      style={{
        ...baseLabelStyle,
        fontSize: '8px',
      }}
    >
      {`CASE ${caseNumber} OF ${totalCases} — ${displayName}`}
    </div>
  );
}
