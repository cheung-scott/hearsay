'use client';

/**
 * Day-5 Wave-5 SCAFFOLD STUB — filled in by gauntlet agent.
 *
 * Displays "CASE X / 4 — THE {PERSONA}" in the TopBar. Derives from localStorage
 * gauntlet progress + current session's opponent persona.
 *
 * Visual contract:
 * - Small all-caps Press Start 2P monospace
 * - Positioned in TopBar (gauntlet agent wires placement)
 * - Hidden if gauntlet is complete (final "CASE DISMISSED" screen takes over)
 *
 * Props are FROZEN.
 */

import type { Persona } from '@/lib/game/types';

export interface CaseLabelProps {
  /** 1-based case number. 0 or negative = hidden. */
  caseNumber: number;
  /** Total cases in the gauntlet (4 for v1). */
  totalCases: number;
  /** Current AI persona (the defendant you're facing). */
  persona: Persona | null;
}

export function CaseLabel(_props: CaseLabelProps) {
  // STUB: returns null.
  return null;
}
