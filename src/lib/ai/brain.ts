// Brain orchestrator — design.md §5.
// Public API called by the game server's API-route layer.
// Stitches: deterministic math (math.ts) → LLM (llm.ts) → deterministic fallback (math.ts).
// Returns fully-populated AiDecision / AiPlay objects with telemetry (source, latencyMs).

import type { DecisionContext, OwnPlayContext, AiDecision, AiPlay, AiSource } from './types';
import { LLMTimeoutError, LLMInvalidJSONError } from './types';
import {
  claimMathProbability,
  aiDecideOnClaimFallback,
  aiDecideOwnPlayFallback,
} from './math';
import { callLLMJudgment, callLLMOwnPlay } from './llm';

// ---------------------------------------------------------------------------
// Timing budget (design §1, §5 — hard timing contract)
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Private helper — map caught errors to AiSource telemetry tags
// ---------------------------------------------------------------------------

function errorToSource(err: unknown): AiSource {
  if (err instanceof LLMTimeoutError)     return 'fallback-timeout';
  if (err instanceof LLMInvalidJSONError) return 'fallback-invalid-json';
  return 'fallback-network-error';
}

// ---------------------------------------------------------------------------
// aiDecideOnClaim — design §5
// The AI judges a claim just made by the player.
// ---------------------------------------------------------------------------

export async function aiDecideOnClaim(ctx: DecisionContext): Promise<AiDecision> {
  const t0 = performance.now();
  const mathProb = claimMathProbability(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const llm = await callLLMJudgment(ctx, mathProb, controller.signal);
    return {
      action:       llm.action,
      innerThought: llm.innerThought,
      llmReasoning: llm.innerThought,
      source:       'llm',
      latencyMs:    performance.now() - t0,
      mathProb,
    };
  } catch (err) {
    const fb = aiDecideOnClaimFallback(ctx);
    return {
      action:       fb.action,
      innerThought: fb.innerThought,
      // llmReasoning intentionally omitted on fallback paths (undefined)
      source:       errorToSource(err),
      latencyMs:    performance.now() - t0,
      mathProb:     fb.mathProb,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// aiDecideOwnPlay — mirrors aiDecideOnClaim (design §5)
// The AI chooses which cards to play and what to claim.
// ---------------------------------------------------------------------------

export async function aiDecideOwnPlay(ctx: OwnPlayContext): Promise<AiPlay> {
  const t0 = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const llm = await callLLMOwnPlay(ctx, controller.signal);
    const handById = new Map(ctx.myHand.map(c => [c.id, c]));
    // Validator in llm.ts already ensured all IDs are present in ctx.myHand
    const cardsToPlay = llm.cardsToPlay.map(id => handById.get(id)!);
    return {
      cardsToPlay,
      claim:        { count: llm.claimCount, rank: ctx.targetRank },
      truthState:   llm.truthState,
      claimText:    llm.claimText,
      innerThought: llm.innerThought,
      llmReasoning: llm.innerThought,
      source:       'llm',
      latencyMs:    performance.now() - t0,
    };
  } catch (err) {
    const fb = aiDecideOwnPlayFallback(ctx);
    return {
      cardsToPlay:  fb.cardsToPlay,
      claim:        fb.claim,
      truthState:   fb.truthState,
      claimText:    fb.claimText,
      innerThought: fb.innerThought,
      // llmReasoning intentionally omitted on fallback paths (undefined)
      source:       errorToSource(err),
      latencyMs:    performance.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}
