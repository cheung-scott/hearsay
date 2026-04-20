// Tool #5 — replayRound. Design §5.4. Read-only.

import { storeGet, type PublicClaim, type Session } from '../appBridge';
import {
  ReplayRoundInput,
  err,
  ok,
  type ToolResult,
} from '../schemas';

export interface ReplayRoundEntry {
  claim: PublicClaim;
  timestamp: number;
}

export async function replayRound(rawInput: unknown): Promise<ToolResult> {
  const parsed = ReplayRoundInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      'INVALID_INPUT',
      'Invalid input for replayRound',
      parsed.error.issues,
    );
  }
  const { sessionId, roundIndex } = parsed.data;

  let session: Session | null;
  try {
    session = await storeGet(sessionId);
  } catch (e) {
    return err('KV_ERROR', `KV read failed: ${String(e)}`);
  }
  if (session == null) {
    return err('SESSION_NOT_FOUND', `No session '${sessionId}'`);
  }

  if (roundIndex >= session.rounds.length) {
    return err(
      'ROUND_NOT_FOUND',
      `roundIndex ${roundIndex} out of range (0..${session.rounds.length - 1})`,
    );
  }

  const round = session.rounds[roundIndex]!;
  const entries: ReplayRoundEntry[] = round.claimHistory.map((c) => ({
    claim: {
      by: c.by,
      count: c.count,
      claimedRank: c.claimedRank,
      ...(c.claimText !== undefined ? { claimText: c.claimText } : {}),
      timestamp: c.timestamp,
    },
    timestamp: c.timestamp,
  }));

  return ok(entries);
}
