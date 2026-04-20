// Tool #3 — inspectAIDecision. Design §5.2, invariant I7. Dev-only.

import {
  claimMathProbability,
  storeGet,
  type Claim,
  type DecisionContext,
  type PublicClaim,
  type Session,
} from '../appBridge';
import {
  InspectAIDecisionInput,
  err,
  ok,
  type DebugPermissions,
  type ToolResult,
} from '../schemas';

export type InspectAIDecisionResult = Claim & { mathProb?: number };

export function makeInspectAIDecision(permissions: DebugPermissions) {
  return async function inspectAIDecision(
    rawInput: unknown,
  ): Promise<ToolResult> {
    if (!permissions.allowInspectAIDecision) {
      return err(
        'PERMISSION_DENIED',
        'inspectAIDecision requires HEARSAY_DEBUG=1',
      );
    }

    const parsed = InspectAIDecisionInput.safeParse(rawInput);
    if (!parsed.success) {
      return err(
        'INVALID_INPUT',
        'Invalid input for inspectAIDecision',
        parsed.error.issues,
      );
    }
    const { sessionId, turnIndex } = parsed.data;

    let session: Session | null;
    try {
      session = await storeGet(sessionId);
    } catch (e) {
      return err('KV_ERROR', `KV read failed: ${String(e)}`);
    }
    if (session == null) {
      return err('SESSION_NOT_FOUND', `No session '${sessionId}'`);
    }

    const flattened: Array<{ claim: Claim; roundIdx: number; turnInRound: number }> =
      [];
    session.rounds.forEach((r, roundIdx) => {
      r.claimHistory.forEach((c, turnInRound) => {
        flattened.push({ claim: c, roundIdx, turnInRound });
      });
    });

    if (turnIndex < 0 || turnIndex >= flattened.length) {
      return err(
        'TURN_NOT_FOUND',
        `turnIndex ${turnIndex} out of range (0..${flattened.length - 1})`,
      );
    }

    const { claim, roundIdx, turnInRound } = flattened[turnIndex]!;
    const mathProb = tryDeriveMathProb(session, claim, roundIdx, turnInRound);
    const result: InspectAIDecisionResult = { ...claim };
    if (mathProb !== null) {
      result.mathProb = mathProb;
    }
    return ok(result);
  };
}

// Re-run claimMathProbability for this turn. Design §5 tool 3 implementation
// note: mathProb is NOT persisted on Claim (it lives on AiDecision only), so
// we re-derive from context; if re-derivation fails for any reason, omit
// rather than fake.
//
// CAVEAT — the DecisionContext is built from the CURRENT session state
// (hand, strikes, pile), not the state at claim time. For post-mortem
// inspection on a completed session this is the best signal available
// without a full event replay; callers should read `mathProb` as "what
// this AI would compute looking at this claim from today's board", not
// "what this AI actually saw when deciding". A full-replay reconstruction
// is out of scope for Day-5 and would duplicate reducer logic.
function tryDeriveMathProb(
  session: Session,
  claim: Claim,
  roundIdx: number,
  turnInRound: number,
): number | null {
  if (claim.by !== 'ai') return null;
  try {
    const round = session.rounds[roundIdx];
    if (!round) return null;
    const history: PublicClaim[] = round.claimHistory
      .slice(0, turnInRound + 1)
      .map((c) => ({
        by: c.by,
        count: c.count,
        claimedRank: c.claimedRank,
        claimText: c.claimText,
        timestamp: c.timestamp,
      }));
    const ctx: DecisionContext = {
      persona: session.ai.personaIfAi ?? 'Novice',
      targetRank: round.targetRank,
      myHand: session.ai.hand,
      myJokers: session.ai.jokers,
      opponentJokers: session.player.jokers,
      opponentHandSize: session.player.hand.length,
      roundHistory: history,
      claim: history[history.length - 1]!,
      pileSize: round.pile.length,
      strikesMe: session.ai.strikes,
      strikesPlayer: session.player.strikes,
    };
    const p = claimMathProbability(ctx);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}
