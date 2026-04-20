// reveal.ts — probe-phase glue (spec §6, §7.1, §11).
//
// Pure functions that sit between the API route / FSM layer and the filter.
// No I/O, no Date.now, no Math.random — callers inject `now`.

import type { Persona } from '../game/types';
import type {
  ActiveProbe,
  ProbeRequest,
  ProbeResponse,
  RevealedProbe,
} from './types';
import { probeFilter } from './filter';

/** Default reveal duration — §6 "~3s read + 1s grace". */
export const DEFAULT_DECAY_MS = 4000;

/**
 * Construct the server-side `ActiveProbe` slot from a `ProbeRequest`, the
 * just-made AI claim's `llmReasoning`, its persona, and a `now` timestamp.
 * Runs the filter — caller wires the resulting ActiveProbe into the
 * `ProbeStart` event.
 */
export function buildActiveProbe(
  request: ProbeRequest,
  rawLlmReasoning: string | undefined,
  persona: Persona,
  now: number,
  decayMs: number = DEFAULT_DECAY_MS,
): ActiveProbe {
  const { revealedReasoning, filterSource } = probeFilter(
    rawLlmReasoning,
    persona,
    request.mathProb ?? 0.5,
  );

  return {
    whisperId: request.whisperId,
    targetAiId: request.targetAiId,
    roundIdx: request.roundIdx,
    triggeredAtTurn: request.triggeredAtTurn,
    revealedReasoning,
    filterSource,
    startedAt: now,
    decayMs,
    expiresAt: now + decayMs,
    rawLlmReasoning: rawLlmReasoning ?? '',
  };
}

/** Client-safe projection — the 5 `RevealedProbe` fields only. Strips `rawLlmReasoning`. */
export function toRevealedProbe(probe: ActiveProbe): RevealedProbe {
  return {
    whisperId: probe.whisperId,
    revealedReasoning: probe.revealedReasoning,
    filterSource: probe.filterSource,
    decayMs: probe.decayMs,
    expiresAt: probe.expiresAt,
  };
}

/** Shape the wire-facing `ProbeResponse`. */
export function toProbeResponse(probe: ActiveProbe): ProbeResponse {
  return {
    whisperId: probe.whisperId,
    revealedReasoning: probe.revealedReasoning,
    decayMs: probe.decayMs,
    filterSource: probe.filterSource,
  };
}

// ---------------------------------------------------------------------------
// Entry-guard helpers (API route consumes these; kept pure for unit testing).
// ---------------------------------------------------------------------------

import type { Session } from '../game/types';

export type ProbeGuardFailure =
  | 'PROBE_REJECTED_INVALID_PHASE'
  | 'PROBE_REJECTED_NO_JOKER'
  | 'PROBE_REJECTED_NO_CLAIM'
  | 'PROBE_ACTIVE';

/**
 * Validate every §6 entry condition. Returns `null` on success or an error
 * code string the caller maps to an HTTP response.
 */
export function checkProbeEntry(session: Session): ProbeGuardFailure | null {
  // Order mirrors spec §4.1: (a) session → (b) round → (c) joker →
  // (d) claim → (e) claim-by-AI → (f) no-active-probe. Order matters because
  // each condition maps to a distinct error code; the "double probe without
  // a joker" scenario must surface as PROBE_REJECTED_NO_JOKER, not PROBE_ACTIVE.
  if (session.status !== 'round_active') return 'PROBE_REJECTED_INVALID_PHASE';

  const round = session.rounds[session.currentRoundIdx];
  if (!round) return 'PROBE_REJECTED_INVALID_PHASE';
  if (round.status !== 'response_phase') return 'PROBE_REJECTED_INVALID_PHASE';

  const hasStageWhisper = round.activeJokerEffects.some(
    (e) => e.type === 'stage_whisper',
  );
  if (!hasStageWhisper) return 'PROBE_REJECTED_NO_JOKER';

  if (round.claimHistory.length === 0) return 'PROBE_REJECTED_NO_CLAIM';
  const last = round.claimHistory[round.claimHistory.length - 1];
  if (!last || last.by !== 'ai') return 'PROBE_REJECTED_NO_CLAIM';

  if (round.activeProbe !== undefined) return 'PROBE_ACTIVE';

  return null;
}

export type ProbeCompleteGuardFailure = 'PROBE_REJECTED_INVALID_PHASE' | 'PROBE_NOT_FOUND';

/**
 * Validate completion: `round.activeProbe` must be set; optional `whisperId`
 * check lets the route match request-by-id (mismatch → 404).
 */
export function checkProbeComplete(
  session: Session,
  expectedWhisperId?: string,
): ProbeCompleteGuardFailure | null {
  const round = session.rounds[session.currentRoundIdx];
  if (!round || round.activeProbe === undefined) {
    return 'PROBE_REJECTED_INVALID_PHASE';
  }
  if (
    expectedWhisperId !== undefined &&
    round.activeProbe.whisperId !== expectedWhisperId
  ) {
    return 'PROBE_NOT_FOUND';
  }
  return null;
}
