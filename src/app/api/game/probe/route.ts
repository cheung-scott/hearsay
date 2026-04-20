// POST /api/game/probe — Stage Whisper probe lifecycle (probe-phase spec §3).
//
// Dedicated route so the FSM event firehose in /api/turn stays single-purpose.
// Accepts:
//   { sessionId }                         → initiate probe
//   { sessionId, action: 'complete', whisperId }
//                                         → dismiss probe early
//
// On initiation: reads the last AI claim, runs the reasoning filter, fires
// ProbeStart on the FSM, returns the updated ClientSession. The client's
// decay timer is cosmetic — the server is authoritative (ProbeExpired is
// a caller-side timer that may fire if the client misses it, wired from the
// session-store layer in a separate task).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { randomUUID } from 'node:crypto';

import { reduce } from '@/lib/game/fsm';
import { toClientView } from '@/lib/game/toClientView';
import { InvalidTransitionError } from '@/lib/game/types';
import type { Session } from '@/lib/game/types';
import {
  buildActiveProbe,
  checkProbeEntry,
  checkProbeComplete,
} from '@/lib/probe/reveal';
import type { ProbeRequest } from '@/lib/probe/types';
import * as store from '@/lib/session/store';

interface ProbeInitBody {
  sessionId: string;
  action?: 'initiate';
}

interface ProbeCompleteBody {
  sessionId: string;
  action: 'complete';
  whisperId: string;
}

type ProbeBody = ProbeInitBody | ProbeCompleteBody;

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function guardFailureToResponse(
  code:
    | 'PROBE_REJECTED_INVALID_PHASE'
    | 'PROBE_REJECTED_NO_JOKER'
    | 'PROBE_REJECTED_NO_CLAIM'
    | 'PROBE_ACTIVE'
    | 'PROBE_NOT_FOUND',
): Response {
  const MESSAGES: Record<string, string> = {
    PROBE_REJECTED_INVALID_PHASE:
      'Probe can only be initiated during response_phase with no probe already active.',
    PROBE_REJECTED_NO_JOKER:
      'No Stage Whisper effect is active on this round.',
    PROBE_REJECTED_NO_CLAIM:
      'Probe requires the most recent claim to be from the AI.',
    PROBE_ACTIVE: 'A probe is already active on this round.',
    PROBE_NOT_FOUND:
      'No active probe matches the supplied whisperId.',
  };
  const STATUS: Record<string, number> = {
    PROBE_REJECTED_INVALID_PHASE: 400,
    PROBE_REJECTED_NO_JOKER: 400,
    PROBE_REJECTED_NO_CLAIM: 400,
    PROBE_ACTIVE: 409,
    PROBE_NOT_FOUND: 404,
  };
  return errorResponse(code, MESSAGES[code] ?? 'Probe rejected.', STATUS[code] ?? 400);
}

export async function POST(req: Request): Promise<Response> {
  let body: ProbeBody;
  try {
    body = (await req.json()) as ProbeBody;
  } catch {
    return errorResponse(
      'INVALID_JSON',
      'Request body must be valid JSON.',
      400,
    );
  }

  if (!body.sessionId) {
    return errorResponse(
      'MISSING_SESSION_ID',
      'sessionId is required in request body.',
      400,
    );
  }

  let session: Session | null = await store.get(body.sessionId);
  if (!session) {
    return errorResponse(
      'SESSION_NOT_FOUND',
      `No session with id ${body.sessionId}.`,
      404,
    );
  }

  try {
    // -------------------------------------------------------------------
    // Completion path.
    // -------------------------------------------------------------------
    if (body.action === 'complete') {
      const { whisperId } = body;
      if (!whisperId) {
        return errorResponse(
          'MISSING_WHISPER_ID',
          'whisperId is required for action=complete.',
          400,
        );
      }
      const fail = checkProbeComplete(session, whisperId);
      if (fail !== null) return guardFailureToResponse(fail);

      session = reduce(session, {
        type: 'ProbeComplete',
        whisperId,
        now: Date.now(),
      });
      await store.set(body.sessionId, session);
      return Response.json({ session: toClientView(session, 'player') });
    }

    // -------------------------------------------------------------------
    // Initiation path.
    // -------------------------------------------------------------------
    const fail = checkProbeEntry(session);
    if (fail !== null) return guardFailureToResponse(fail);

    const round = session.rounds[session.currentRoundIdx]!;
    const lastClaim = round.claimHistory[round.claimHistory.length - 1]!;
    const persona = session.ai.personaIfAi ?? 'Reader';

    const now = Date.now();
    // `mathProb` is intentionally absent: per spec §7.3 it must be server-
    // authoritative (read from `AiDecision.mathProb` at consumption time).
    // Since `AiDecision` is not persisted on `Claim`, v1 omits it and the
    // filter's static-fallback lane degrades to the neutral template
    // ("*Hard to say.*"). Joker-system will inject mathProb server-side
    // when `consumeStageWhisper` is wired (spec §7.2) — NOT via client body.
    const probeRequest: ProbeRequest = {
      whisperId: randomUUID(),
      targetAiId: 'ai',
      roundIdx: session.currentRoundIdx,
      triggeredAtTurn: round.claimHistory.length,
      now,
    };

    const probe = buildActiveProbe(
      probeRequest,
      lastClaim.llmReasoning,
      persona,
      now,
    );

    session = reduce(session, { type: 'ProbeStart', probe, now });
    await store.set(body.sessionId, session);

    return Response.json({
      session: toClientView(session, 'player'),
      probe: {
        whisperId: probe.whisperId,
        revealedReasoning: probe.revealedReasoning,
        decayMs: probe.decayMs,
        filterSource: probe.filterSource,
      },
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return errorResponse('INVALID_TRANSITION', err.message, 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse('PROBE_FAILED', message, 500);
  }
}
