// brain.test.ts — end-to-end tests of the brain orchestrator with mocked LLM
// and real math layer. Covers design §8 invariants 7, 8, 11, 12 + LLM success
// path for both aiDecideOnClaim and aiDecideOwnPlay.

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock ./llm BEFORE importing brain.ts. Factory is hoisted by vi.mock, so spies
// must be attached to globalThis to survive hoisting (mirrors llm.test.ts pattern).
vi.mock('./llm', () => {
  const callLLMJudgment = vi.fn();
  const callLLMOwnPlay = vi.fn();
  (globalThis as Record<string, unknown>).__callLLMJudgmentSpy = callLLMJudgment;
  (globalThis as Record<string, unknown>).__callLLMOwnPlaySpy = callLLMOwnPlay;
  return { callLLMJudgment, callLLMOwnPlay };
});

// Set GEMINI_API_KEY so brain.ts's transitive import of llm.ts doesn't choke at
// module load. The mock replaces llm.ts's exports, but set it anyway for safety.
process.env.GEMINI_API_KEY = 'test-key';

import { aiDecideOnClaim, aiDecideOwnPlay } from './brain';
import { LLMTimeoutError, LLMInvalidJSONError, LLMNetworkError } from './types';
import type { DecisionContext, OwnPlayContext } from './types';
import type { Card, PublicClaim, Rank } from '../game/types';

const callLLMJudgmentSpy = (globalThis as Record<string, unknown>)
  .__callLLMJudgmentSpy as ReturnType<typeof vi.fn>;
const callLLMOwnPlaySpy = (globalThis as Record<string, unknown>)
  .__callLLMOwnPlaySpy as ReturnType<typeof vi.fn>;

beforeEach(() => {
  callLLMJudgmentSpy.mockReset();
  callLLMOwnPlaySpy.mockReset();
});

// ---------------------------------------------------------------------------
// Fixture helpers — mirror math.test.ts pattern
// Defaults: persona Reader, targetRank Queen, myHand 2Q+1K+1A+1J (5 cards),
// roundHistory [], claim {by:'player', count:1, claimedRank:'Queen', timestamp:0}
// ---------------------------------------------------------------------------

function makeCard(rank: Rank, id: string): Card {
  return { id, rank };
}

function makeDecisionCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  // Typed as DecisionContext['claim'] (PublicClaim & { voiceMeta?: VoiceMeta })
  // so test fixtures flow through the intersection without needing to construct
  // a full VoiceMeta. voiceMeta is omitted here; tests that exercise voice-lie
  // logic populate the full VoiceMeta shape inline (see math.test.ts invariant 10).
  const defaultClaim: DecisionContext['claim'] = {
    by: 'player',
    count: 1,
    claimedRank: 'Queen',
    timestamp: 0,
  };
  return {
    persona: 'Reader',
    targetRank: 'Queen',
    myHand: [
      makeCard('Queen', 'Q-0'),
      makeCard('Queen', 'Q-1'),
      makeCard('King', 'K-0'),
      makeCard('Ace', 'A-0'),
      makeCard('Jack', 'J-0'),
    ],
    myJokers: [],
    opponentJokers: [],
    opponentHandSize: 5,
    roundHistory: [],
    claim: defaultClaim,
    pileSize: 0,
    strikesMe: 0,
    strikesPlayer: 0,
    ...overrides,
  };
}

function makeOwnPlayCtx(overrides: Partial<OwnPlayContext> = {}): OwnPlayContext {
  return {
    persona: 'Reader',
    targetRank: 'Queen',
    myHand: [
      makeCard('Queen', 'Q-0'),
      makeCard('Queen', 'Q-1'),
      makeCard('King', 'K-0'),
      makeCard('Ace', 'A-0'),
      makeCard('Jack', 'J-0'),
    ],
    myJokers: [],
    opponentJokers: [],
    opponentHandSize: 5,
    roundHistory: [],
    pileSize: 0,
    strikesMe: 0,
    strikesPlayer: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. LLM success — aiDecideOnClaim
// ---------------------------------------------------------------------------

describe('aiDecideOnClaim — LLM success path', () => {
  it('returns source llm with correct action, innerThought, llmReasoning, mathProb, latencyMs', async () => {
    callLLMJudgmentSpy.mockResolvedValueOnce({
      action: 'accept',
      innerThought: 'looks fine',
      voiceline: 'Accepted. Proceed.',
    });

    const ctx = makeDecisionCtx();
    const result = await aiDecideOnClaim(ctx);

    expect(result.source).toBe('llm');
    expect(result.action).toBe('accept');
    expect(result.innerThought).toBe('looks fine');
    // llmReasoning is set to llm.innerThought on the LLM path
    expect(result.llmReasoning).toBe('looks fine');
    // mathProb is computed from the real math layer
    expect(typeof result.mathProb).toBe('number');
    expect(result.mathProb).toBeGreaterThanOrEqual(0.15);
    expect(result.mathProb).toBeLessThanOrEqual(0.95);
    // latency is measured with performance.now()
    expect(result.latencyMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. LLM success — aiDecideOwnPlay
// ---------------------------------------------------------------------------

describe('aiDecideOwnPlay — LLM success path', () => {
  it('returns source llm with cards resolved to Card objects from myHand', async () => {
    callLLMOwnPlaySpy.mockResolvedValueOnce({
      cardsToPlay: ['Q-0'],
      claimCount: 1,
      claimText: 'One Queen.',
      truthState: 'honest',
      innerThought: 'playing clean',
    });

    const ctx = makeOwnPlayCtx();
    const result = await aiDecideOwnPlay(ctx);

    expect(result.source).toBe('llm');
    // cardsToPlay must be Card objects, not strings
    expect(Array.isArray(result.cardsToPlay)).toBe(true);
    expect(result.cardsToPlay).toHaveLength(1);
    expect(result.cardsToPlay[0].id).toBe('Q-0');
    expect(result.cardsToPlay[0].rank).toBe('Queen');
    // claim shape
    expect(result.claim).toEqual({ count: 1, rank: 'Queen' });
    expect(result.truthState).toBe('honest');
    expect(result.claimText).toBe('One Queen.');
    expect(result.llmReasoning).toBe('playing clean');
    expect(result.latencyMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Invariant 7 via brain — timeout → fallback-timeout
// ---------------------------------------------------------------------------

describe('invariant 7 (via brain): LLM timeout → fallback-timeout', () => {
  it('returns source fallback-timeout when callLLMJudgment rejects with LLMTimeoutError', async () => {
    callLLMJudgmentSpy.mockRejectedValueOnce(new LLMTimeoutError());

    const ctx = makeDecisionCtx();
    const result = await aiDecideOnClaim(ctx);

    expect(result.source).toBe('fallback-timeout');
    expect(result.action === 'accept' || result.action === 'challenge').toBe(true);
    // llmReasoning must be absent on fallback paths
    expect(result.llmReasoning).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThan(0);
    // innerThought is populated by the deterministic fallback
    expect(typeof result.innerThought).toBe('string');
    expect(result.innerThought.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Invariant 8 via brain — invalid JSON → fallback-invalid-json
// ---------------------------------------------------------------------------

describe('invariant 8 (via brain): LLM invalid JSON → fallback-invalid-json', () => {
  it('returns source fallback-invalid-json when callLLMJudgment rejects with LLMInvalidJSONError', async () => {
    callLLMJudgmentSpy.mockRejectedValueOnce(
      new LLMInvalidJSONError('raw-text', 'parse-failed'),
    );

    const ctx = makeDecisionCtx();
    const result = await aiDecideOnClaim(ctx);

    expect(result.source).toBe('fallback-invalid-json');
    expect(result.llmReasoning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. fallback-network-error source
// ---------------------------------------------------------------------------

describe('aiDecideOnClaim — network error → fallback-network-error', () => {
  it('returns source fallback-network-error when callLLMJudgment rejects with LLMNetworkError', async () => {
    callLLMJudgmentSpy.mockRejectedValueOnce(
      new LLMNetworkError(new Error('ECONNRESET')),
    );

    const ctx = makeDecisionCtx();
    const result = await aiDecideOnClaim(ctx);

    expect(result.source).toBe('fallback-network-error');
  });
});

// ---------------------------------------------------------------------------
// 6. aiDecideOwnPlay — timeout fallback
// ---------------------------------------------------------------------------

describe('aiDecideOwnPlay — fallback paths', () => {
  it('timeout: returns source fallback-timeout with valid AiPlay shape', async () => {
    callLLMOwnPlaySpy.mockRejectedValueOnce(new LLMTimeoutError());

    const ctx = makeOwnPlayCtx();
    const result = await aiDecideOwnPlay(ctx);

    expect(result.source).toBe('fallback-timeout');
    // cardsToPlay must be a subset of ctx.myHand
    const handIds = new Set(ctx.myHand.map(c => c.id));
    for (const card of result.cardsToPlay) {
      expect(handIds.has(card.id)).toBe(true);
    }
    // count must match cardsToPlay length
    expect(result.cardsToPlay).toHaveLength(result.claim.count);
    // truthState consistency
    const allTargets = result.cardsToPlay.every(c => c.rank === ctx.targetRank);
    if (result.truthState === 'honest') {
      expect(allTargets).toBe(true);
    } else {
      expect(allTargets).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // 7. aiDecideOwnPlay — invalid-json fallback
  // -------------------------------------------------------------------------

  it('invalid JSON: returns source fallback-invalid-json', async () => {
    callLLMOwnPlaySpy.mockRejectedValueOnce(
      new LLMInvalidJSONError('bad', 'parse-failed'),
    );

    const ctx = makeOwnPlayCtx();
    const result = await aiDecideOwnPlay(ctx);

    expect(result.source).toBe('fallback-invalid-json');
  });

  // -------------------------------------------------------------------------
  // 8. aiDecideOwnPlay — network-error fallback
  // -------------------------------------------------------------------------

  it('network error: returns source fallback-network-error', async () => {
    callLLMOwnPlaySpy.mockRejectedValueOnce(
      new LLMNetworkError(new Error('ECONNRESET')),
    );

    const ctx = makeOwnPlayCtx();
    const result = await aiDecideOwnPlay(ctx);

    expect(result.source).toBe('fallback-network-error');
  });
});

// ---------------------------------------------------------------------------
// 9. Invariant 11 — latencyMs always populated on every path
// ---------------------------------------------------------------------------

describe('invariant 11: latencyMs > 0 on every pipeline path', () => {
  it('latencyMs > 0 on LLM success, timeout, invalid-json, and network-error paths', async () => {
    // LLM success
    callLLMJudgmentSpy.mockResolvedValueOnce({ action: 'accept', innerThought: 'ok', voiceline: 'OK.' });
    const llmResult = await aiDecideOnClaim(makeDecisionCtx());
    expect(llmResult.latencyMs).toBeGreaterThan(0);
    // LLM path resolves immediately (mock) so latency should be well under 2000ms
    expect(llmResult.latencyMs).toBeLessThan(2000);

    // Timeout fallback
    callLLMJudgmentSpy.mockRejectedValueOnce(new LLMTimeoutError());
    const timeoutResult = await aiDecideOnClaim(makeDecisionCtx());
    expect(timeoutResult.latencyMs).toBeGreaterThan(0);

    // Invalid-json fallback
    callLLMJudgmentSpy.mockRejectedValueOnce(new LLMInvalidJSONError('x', 'y'));
    const jsonResult = await aiDecideOnClaim(makeDecisionCtx());
    expect(jsonResult.latencyMs).toBeGreaterThan(0);

    // Network-error fallback
    callLLMJudgmentSpy.mockRejectedValueOnce(new LLMNetworkError(new Error('net')));
    const netResult = await aiDecideOnClaim(makeDecisionCtx());
    expect(netResult.latencyMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Invariant 12 via brain — alreadyClaimed includes current claim
// ---------------------------------------------------------------------------

describe('invariant 12 (via brain): alreadyClaimed includes current claim', () => {
  it('mathProb === 0.95 when roundHistory contains the current claim and prior claims exhaust support', async () => {
    // Construction (see prompt § "Actually cleanest"):
    // myHand: 0 Queens → outsideOwnHand = 5 - 0 = 5
    // claim.count = 2 (max allowed)
    // roundHistory includes:
    //   - prior Queen claim of count 2 (alreadyClaimed contribution: 2)
    //   - current claim of count 2    (alreadyClaimed contribution: 2)
    // alreadyClaimed = 4, remainingSupport = 5 - 4 = 1
    // 1 < claim.count (2) → returns 0.95
    //
    // If BUG excludes current claim:
    //   alreadyClaimed = 2, remainingSupport = 3, 3 >= 3*2=6? no, 3 < 6.
    //   mid-range: max(0.15, min(0.7, 1 - 3/6)) = max(0.15, min(0.7, 0.5)) = 0.5
    //   So buggy mathProb ≈ 0.5, correct mathProb = 0.95 — clearly distinguishable.

    const hand = [
      makeCard('King', 'K-0'),
      makeCard('King', 'K-1'),
      makeCard('Ace', 'A-0'),
      makeCard('Jack', 'J-0'),
      makeCard('Jack', 'J-1'),
    ];
    const currentClaim: DecisionContext['claim'] = {
      by: 'player',
      count: 2,
      claimedRank: 'Queen',
      timestamp: 100,
    };
    const priorClaim: PublicClaim = {
      by: 'ai',
      count: 2,
      claimedRank: 'Queen',
      timestamp: 10,
    };

    // Force fallback so mathProb is propagated directly via fb.mathProb
    callLLMJudgmentSpy.mockRejectedValueOnce(new LLMNetworkError(new Error('forced')));

    const ctx = makeDecisionCtx({
      myHand: hand,
      claim: currentClaim,
      roundHistory: [priorClaim, currentClaim], // current claim included per §6 caller contract
    });

    const result = await aiDecideOnClaim(ctx);

    // Correct behaviour: remainingSupport=1 < count=2 → 0.95
    expect(result.mathProb).toBe(0.95);
  });
});

describe('aiDecideOnClaim - player bluff forgiveness', () => {
  it('softens Defendant challenge calls unless there is a severe voice tell', async () => {
    callLLMJudgmentSpy.mockResolvedValueOnce({
      action: 'challenge',
      innerThought: 'The math looks suspicious.',
      voiceline: 'You are lying.',
    });

    const currentClaim: DecisionContext['claim'] = {
      by: 'player',
      count: 2,
      claimedRank: 'Queen',
      timestamp: 100,
      voiceMeta: {
        latencyMs: 0,
        fillerCount: 0,
        pauseCount: 0,
        speechRateWpm: 120,
        lieScore: 0.5,
        parsed: { count: 2, rank: 'Queen' },
      },
    };
    const priorClaim: PublicClaim = {
      by: 'ai',
      count: 2,
      claimedRank: 'Queen',
      timestamp: 10,
    };

    const result = await aiDecideOnClaim(makeDecisionCtx({
      persona: 'Novice',
      myHand: [
        makeCard('King', 'K-0'),
        makeCard('King', 'K-1'),
        makeCard('Ace', 'A-0'),
        makeCard('Jack', 'J-0'),
        makeCard('Jack', 'J-1'),
      ],
      claim: currentClaim,
      roundHistory: [priorClaim, currentClaim],
    }));

    expect(result.mathProb).toBe(0.95);
    expect(result.source).toBe('llm');
    expect(result.action).toBe('accept');
    expect(result.innerThought).toContain('Not enough to risk calling liar.');
  });

  it('still lets the Defendant challenge when the player voice tell is severe', async () => {
    callLLMJudgmentSpy.mockResolvedValueOnce({
      action: 'challenge',
      innerThought: 'That sounded very shaky.',
      voiceline: 'You are lying.',
    });

    const claim: DecisionContext['claim'] = {
      by: 'player',
      count: 1,
      claimedRank: 'Queen',
      timestamp: 100,
      voiceMeta: {
        latencyMs: 0,
        fillerCount: 3,
        pauseCount: 2,
        speechRateWpm: 80,
        lieScore: 0.95,
        parsed: { count: 1, rank: 'Queen' },
      },
    };

    const result = await aiDecideOnClaim(makeDecisionCtx({
      persona: 'Novice',
      claim,
      roundHistory: [claim],
    }));

    expect(result.action).toBe('challenge');
    expect(result.voiceline).toBe('You are lying.');
  });
});
