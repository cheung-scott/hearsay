// Deterministic math layer for the AI opponent — design.md §3.
// No external dependencies. Pure functions; rng is injected for test determinism.

import type { DecisionContext, OwnPlayContext } from './types';
import type { Persona, Rank, Card } from '../game/types';
import { templateHonest, templateLie, buildFallbackThought } from './constants';

// ---------------------------------------------------------------------------
// §3.1 — Persona numeric tables (LOCKED — do not adjust)
// ---------------------------------------------------------------------------

export const PERSONA_WEIGHTS: Record<Persona, { math: number; voice: number }> = {
  Novice:      { math: 0.7, voice: 0.3 },
  Reader:      { math: 0.4, voice: 0.6 },
  Misdirector: { math: 0.5, voice: 0.5 },
  Silent:      { math: 0.3, voice: 0.7 },
};

export const PERSONA_THRESHOLDS: Record<Persona, number> = {
  Novice: 0.70, Reader: 0.55, Misdirector: 0.50, Silent: 0.45,
};

export const PERSONA_BLUFF_BIAS: Record<Persona, number> = {
  Novice: 0.10, Reader: 0.35, Misdirector: 0.60, Silent: 0.55,
};

// ---------------------------------------------------------------------------
// §3.2 — claimMathProbability
// ---------------------------------------------------------------------------

function countInHand(hand: Card[], rank: Rank): number {
  return hand.reduce((n, c) => n + (c.rank === rank ? 1 : 0), 0);
}

/**
 * Returns P(opponent's claim is a lie) ∈ [0.15, 0.95].
 *
 * INVARIANT (design §6): roundHistory INCLUDES the just-made claim — caller
 * appends before calling. Do NOT filter it out; alreadyClaimed must count it.
 */
export function claimMathProbability(ctx: DecisionContext): number {
  const target = ctx.claim.claimedRank;
  const outsideOwnHand = 5 - countInHand(ctx.myHand, target);
  const alreadyClaimed = ctx.roundHistory
    .filter(c => c.claimedRank === target)
    .reduce((s, c) => s + c.count, 0);
  const remainingSupport = outsideOwnHand - alreadyClaimed;

  if (remainingSupport < ctx.claim.count) return 0.95;
  if (remainingSupport >= 3 * ctx.claim.count) return 0.15;
  return Math.max(0.15, Math.min(0.7, 1 - remainingSupport / (3 * ctx.claim.count)));
}

// ---------------------------------------------------------------------------
// §3.3 — aiDecideOnClaimFallback
// ---------------------------------------------------------------------------

export function aiDecideOnClaimFallback(ctx: DecisionContext): {
  action: 'accept' | 'challenge';
  innerThought: string;
  mathProb: number;
} {
  const mathProb = claimMathProbability(ctx);
  const voiceLie = ctx.claim.voiceMeta?.lieScore ?? 0.5; // neutral when missing (invariant 10)
  const w = PERSONA_WEIGHTS[ctx.persona];
  const threshold = PERSONA_THRESHOLDS[ctx.persona];

  const combined = w.math * mathProb + w.voice * voiceLie;
  const action: 'accept' | 'challenge' = combined >= threshold ? 'challenge' : 'accept';
  const innerThought = buildFallbackThought(ctx.persona, action, mathProb, voiceLie);
  return { action, innerThought, mathProb };
}

// ---------------------------------------------------------------------------
// §3.4 — aiDecideOwnPlayFallback (four branches — order is NON-NEGOTIABLE)
// ---------------------------------------------------------------------------

export function aiDecideOwnPlayFallback(
  ctx: OwnPlayContext,
  // rng is injected so tests can stub it for deterministic branch coverage
  rng: () => number = Math.random,
): {
  cardsToPlay: Card[];
  claim: { count: 1 | 2; rank: Rank };
  truthState: 'honest' | 'lying';
  claimText: string;
  innerThought: string;
} {
  const targets = ctx.myHand.filter(c => c.rank === ctx.targetRank);
  const nonTargets = ctx.myHand.filter(c => c.rank !== ctx.targetRank);
  const bluffBias = PERSONA_BLUFF_BIAS[ctx.persona];

  // Branch 1: targets available + passes bluff-bias coin-flip → honest
  if (targets.length >= 1 && rng() > bluffBias) {
    const count = Math.min(targets.length, 2) as 1 | 2;
    return {
      cardsToPlay: targets.slice(0, count),
      claim: { count, rank: ctx.targetRank },
      truthState: 'honest' as const,
      claimText: templateHonest(ctx.persona, count, ctx.targetRank, rng),
      innerThought: `I have ${count} ${ctx.targetRank}(s). Playing clean.`,
    };
  }

  // Branch 2: mixed hand → bluff (1 target + 1 non-target, claim 2, lying)
  if (targets.length >= 1 && nonTargets.length >= 1) {
    return {
      cardsToPlay: [targets[0], nonTargets[0]],
      claim: { count: 2 as const, rank: ctx.targetRank },
      truthState: 'lying' as const,
      claimText: templateLie(ctx.persona, 2, ctx.targetRank, rng),
      innerThought: `Only ${targets.length} real, padding with a ${nonTargets[0].rank}.`,
    };
  }

  // Branch 3: all-target hand → honest (no non-targets to mix with, can't bluff up)
  if (targets.length >= 1) {
    const count = Math.min(targets.length, 2) as 1 | 2;
    return {
      cardsToPlay: targets.slice(0, count),
      claim: { count, rank: ctx.targetRank },
      truthState: 'honest' as const,
      claimText: templateHonest(ctx.persona, count, ctx.targetRank, rng),
      innerThought: `All ${ctx.targetRank}s. Nothing to hide.`,
    };
  }

  // Branch 4: zero targets → forced lie (1 non-target card, claim 1)
  return {
    cardsToPlay: [ctx.myHand[0]],
    claim: { count: 1 as const, rank: ctx.targetRank },
    truthState: 'lying' as const,
    claimText: templateLie(ctx.persona, 1, ctx.targetRank, rng),
    innerThought: `No ${ctx.targetRank}s. Bluffing a single.`,
  };
}
