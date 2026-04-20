// Tool #7 — dumpTranscript. Design §5.6, invariant I8.
//
// Narrative format must NOT emit a raw card ID (regex /[QKAJ][a-z]+-\d/),
// but DOES emit `truthState` on every claim line. Server-derived, post-round
// public fields only. No actualCardIds ever.

import { storeGet, type Claim, type Session } from '../appBridge';
import {
  DumpTranscriptInput,
  err,
  ok,
  type ToolResult,
} from '../schemas';

export interface TranscriptEntry {
  roundNumber: number;
  targetRank: string;
  by: 'player' | 'ai';
  count: number;
  claimedRank: string;
  truthState: Claim['truthState'];
  claimText?: string;
  timestamp: number;
}

export async function dumpTranscript(rawInput: unknown): Promise<ToolResult> {
  const parsed = DumpTranscriptInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      'INVALID_INPUT',
      'Invalid input for dumpTranscript',
      parsed.error.issues,
    );
  }
  const { sessionId, format } = parsed.data;

  let session: Session | null;
  try {
    session = await storeGet(sessionId);
  } catch (e) {
    return err('KV_ERROR', `KV read failed: ${String(e)}`);
  }
  if (session == null) {
    return err('SESSION_NOT_FOUND', `No session '${sessionId}'`);
  }

  const entries: TranscriptEntry[] = [];
  for (const round of session.rounds) {
    for (const c of round.claimHistory) {
      const entry: TranscriptEntry = {
        roundNumber: round.roundNumber,
        targetRank: round.targetRank,
        by: c.by,
        count: c.count,
        claimedRank: c.claimedRank,
        truthState: c.truthState,
        timestamp: c.timestamp,
      };
      if (c.claimText !== undefined) {
        entry.claimText = c.claimText;
      }
      entries.push(entry);
    }
  }

  if (format === 'json') {
    return ok(entries);
  }

  return ok(renderNarrative(session, entries));
}

function renderNarrative(
  session: Session,
  entries: TranscriptEntry[],
): string {
  const lines: string[] = [];
  lines.push(`Session ${session.id} — status: ${session.status}`);

  let currentRound = -1;
  for (const e of entries) {
    if (e.roundNumber !== currentRound) {
      currentRound = e.roundNumber;
      lines.push('');
      lines.push(`Round ${e.roundNumber} · target ${e.targetRank}s`);
    }
    const speaker = e.by === 'ai' ? 'AI' : 'Player';
    const text = e.claimText ? ` — "${e.claimText}"` : '';
    const rankWord = pluralizeRank(e.claimedRank, e.count);
    lines.push(
      `  ${speaker}: ${e.count} ${rankWord}${text} [${e.truthState}]`,
    );
  }

  for (const round of session.rounds) {
    if (round.winner) {
      lines.push('');
      lines.push(
        `Round ${round.roundNumber} outcome: ${round.winner} won the pile.`,
      );
    }
  }

  if (session.sessionWinner) {
    lines.push('');
    lines.push(`Session winner: ${session.sessionWinner}.`);
  }

  return lines.join('\n');
}

// Produce a safe rank word — the narrative uses "Queens", "Kings" etc., which
// never matches the card-ID regex `/[QKAJ][a-z]+-\d/` because we never append
// a `-N` suffix here. Keeping this as a pure helper makes the I8 invariant
// easy to audit.
function pluralizeRank(rank: string, count: number): string {
  if (count === 1) return rank;
  return `${rank}s`;
}
