// probe-phase types (spec §4).
//
// Server-side probe request + response shapes and the ProbeFilter signature.
// Round-slot shapes (ActiveProbe / RevealedProbe / ProbeFilterSource) live in
// `src/lib/game/types.ts` (pre-landed commit 29f6a34); re-exported here for
// caller convenience.

import type {
  ActiveProbe,
  Persona,
  ProbeFilterSource,
  RevealedProbe,
  Session,
} from '../game/types';

export type { ActiveProbe, ProbeFilterSource, RevealedProbe };

/**
 * Input into probe-phase, produced by joker-system when Stage Whisper is
 * consumed. LOCKED shape — reconciled with joker-system §7.2 per orchestrator
 * 2026-04-19. Any deviation must be escalated to the orchestrator.
 */
export interface ProbeRequest {
  /** uuid v4 — ties request to response across the stack for autopsy tracing. */
  whisperId: string;
  /** Which AI is being probed. 1v1 MVP → always `'ai'`; enum-shaped for forward-compat. */
  targetAiId: 'ai';
  /** Matches `Session.currentRoundIdx` at request time. */
  roundIdx: number;
  /** `round.claimHistory.length` at request time — identifies the just-made AI claim. */
  triggeredAtTurn: number;
  /** ms since epoch — caller owns all time (game-engine §3.2). */
  now: number;
  /**
   * `AiDecision.mathProb` at consumption time — feeds the static-fallback
   * filter lane (§5.3). Optional because fallback paths may not have it.
   */
  mathProb?: number;
}

/** Server-projected response. Crosses the wire. */
export interface ProbeResponse {
  whisperId: string;
  revealedReasoning: string;
  decayMs: number;
  filterSource: ProbeFilterSource;
}

/**
 * Pure filter signature. No I/O, no randomness, no `Date.now()`.
 * See §5 for the 3-lane pipeline spec; see §9 invariants I1-I7.
 */
export type ProbeFilter = (
  rawLlmReasoning: string | undefined,
  persona: Persona,
  mathProb: number,
) => { revealedReasoning: string; filterSource: ProbeFilterSource };

/** Re-export for convenience on the route layer. */
export type { Persona, Session };
