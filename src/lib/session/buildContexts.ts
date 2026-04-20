// Context builders for the ai-opponent brain entry points.
// Called by /api/turn before invoking aiDecideOnClaim / aiDecideOwnPlay.
// Spec: ui-gameplay design §10.1, ai-opponent design §5-6.

import type { Session, Round, Claim, PublicClaim, VoiceMeta } from '../game/types';
import type { DecisionContext, OwnPlayContext } from '../ai/types';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Strip server-only fields from a Claim, leaving only PublicClaim fields. */
function toPublicClaim(c: Claim): PublicClaim {
  const pub: PublicClaim = {
    by: c.by,
    count: c.count,
    claimedRank: c.claimedRank,
    timestamp: c.timestamp,
  };
  if (c.claimText !== undefined) {
    pub.claimText = c.claimText;
  }
  return pub;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DecisionContext for aiDecideOnClaim.
 *
 * Call AFTER the player's claim has been appended to round.claimHistory by
 * the FSM — the last entry in claimHistory is the claim being judged.
 * The claim field includes voiceMeta if present on the server-side Claim.
 */
export function buildDecisionContext(session: Session, round: Round): DecisionContext {
  const lastClaim = round.claimHistory[round.claimHistory.length - 1];
  if (!lastClaim) {
    throw new Error('buildDecisionContext: round.claimHistory is empty — call after ClaimMade');
  }

  const publicHistory: PublicClaim[] = round.claimHistory.map(toPublicClaim);
  // Build base PublicClaim without voiceMeta, then overlay the full server-side
  // VoiceMeta independently of PublicClaim's narrow client shape (§7.4.2).
  const { voiceMeta: _publicVoiceMeta, ...publicBase } = toPublicClaim(lastClaim);
  const publicLastClaim: Omit<PublicClaim, 'voiceMeta'> & { voiceMeta?: VoiceMeta } = {
    ...publicBase,
    ...(lastClaim.voiceMeta !== undefined ? { voiceMeta: lastClaim.voiceMeta } : {}),
  };

  return {
    persona: session.ai.personaIfAi ?? 'Reader',
    targetRank: round.targetRank,
    myHand: session.ai.hand,
    myJokers: session.ai.jokers,
    opponentJokers: session.player.jokers,
    opponentHandSize: session.player.hand.length,
    roundHistory: publicHistory,
    claim: publicLastClaim,
    pileSize: round.pile.length,
    strikesMe: session.ai.strikes,
    strikesPlayer: session.player.strikes,
  };
}

/**
 * Build an OwnPlayContext for aiDecideOwnPlay.
 *
 * Call when round.activePlayer === 'ai' AND round.status === 'claim_phase'.
 */
export function buildOwnPlayContext(session: Session, round: Round): OwnPlayContext {
  return {
    persona: session.ai.personaIfAi ?? 'Reader',
    targetRank: round.targetRank,
    myHand: session.ai.hand,
    myJokers: session.ai.jokers,
    opponentJokers: session.player.jokers,
    opponentHandSize: session.player.hand.length,
    roundHistory: round.claimHistory.map(toPublicClaim),
    pileSize: round.pile.length,
    strikesMe: session.ai.strikes,
    strikesPlayer: session.player.strikes,
  };
}
