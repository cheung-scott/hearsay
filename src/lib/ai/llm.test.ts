// llm.test.ts — covers design §8 invariants 7, 8, 9, 13 + prompt assembly + retry semantics.
// All tests mock @google/genai — no real API calls.

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock @google/genai BEFORE importing llm.ts. All tests use this mock.
// The factory is hoisted by vi.mock so we cannot reference a top-level variable
// declared in the same file. Instead, we hoist the spy inside the factory and
// export it via `__mocks__` so tests can retrieve it after import.
vi.mock('@google/genai', () => {
  const spy = vi.fn();
  // Must be a real function (not arrow) to be new-able.
  function GoogleGenAI() {
    return { models: { generateContent: spy } };
  }
  // Attach to globalThis so the test file can access it after module init.
  (globalThis as Record<string, unknown>).__generateContentSpy = spy;
  return {
    GoogleGenAI,
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      ARRAY: 'ARRAY',
      INTEGER: 'INTEGER',
    },
  };
});

// Set the env var BEFORE importing llm.ts (module-load check).
process.env.GEMINI_API_KEY = 'test-key';

import {
  buildJudgmentPrompt,
  buildOwnPlayPrompt,
  callLLMJudgment,
  callLLMOwnPlay,
} from './llm';
import { LLMTimeoutError, LLMInvalidJSONError } from './types';
import { PERSONA_DESCRIPTIONS } from './constants';
import { PERSONA_BLUFF_BIAS } from './math';
import type { Card, PublicClaim, Rank } from '../game/types';
import type { DecisionContext, OwnPlayContext } from './types';

// Retrieve the spy that was created inside the vi.mock factory.
const generateContentSpy = (globalThis as Record<string, unknown>)
  .__generateContentSpy as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCard(rank: Rank, id: string): Card {
  return { id, rank };
}

function makeDecisionCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  // Typed as DecisionContext['claim'] so the fixture is assignable to the
  // intersection (PublicClaim & { voiceMeta?: VoiceMeta }) without needing to
  // construct a full VoiceMeta — tests that exercise voice fields populate
  // the full VoiceMeta shape inline (see 'voiceLie from voiceMeta.lieScore').
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
// Mock return helpers
// ---------------------------------------------------------------------------

function mockReturnText(text: string) {
  generateContentSpy.mockResolvedValueOnce({ text });
}

function mockRejectsWith(err: unknown) {
  generateContentSpy.mockRejectedValueOnce(err);
}

beforeEach(() => {
  generateContentSpy.mockReset();
});

// ---------------------------------------------------------------------------
// A. Prompt assembly
// ---------------------------------------------------------------------------

describe('buildJudgmentPrompt — content checks', () => {
  it('contains ctx.persona', () => {
    const ctx = makeDecisionCtx({ persona: 'Reader' });
    const prompt = buildJudgmentPrompt(ctx, 0.72);
    expect(prompt).toContain('Reader');
  });

  it('contains PERSONA_DESCRIPTIONS[ctx.persona] substring', () => {
    const ctx = makeDecisionCtx({ persona: 'Reader' });
    const prompt = buildJudgmentPrompt(ctx, 0.72);
    expect(prompt).toContain(PERSONA_DESCRIPTIONS['Reader']);
  });

  it('contains targetRank', () => {
    const ctx = makeDecisionCtx({ targetRank: 'King' });
    const prompt = buildJudgmentPrompt(ctx, 0.50);
    expect(prompt).toContain('King');
  });

  it('contains mathProb.toFixed(2)', () => {
    const ctx = makeDecisionCtx();
    const prompt = buildJudgmentPrompt(ctx, 0.72);
    expect(prompt).toContain('0.72');
  });

  it('contains voiceLie from voiceMeta.lieScore.toFixed(2)', () => {
    const ctx = makeDecisionCtx({
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        timestamp: 0,
        voiceMeta: {
          lieScore: 0.83,
          latencyMs: 200,
          fillerCount: 1,
          pauseCount: 0,
          speechRateWpm: 130,
          parsed: null,
        },
      },
    });
    const prompt = buildJudgmentPrompt(ctx, 0.50);
    expect(prompt).toContain('0.83');
  });

  it('voiceLie defaults to "0.50" when voiceMeta is undefined', () => {
    const ctx = makeDecisionCtx({
      claim: { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 },
    });
    const prompt = buildJudgmentPrompt(ctx, 0.40);
    expect(prompt).toContain('0.50');
  });

  it('contains strikes info', () => {
    const ctx = makeDecisionCtx({ strikesMe: 2, strikesPlayer: 1 });
    const prompt = buildJudgmentPrompt(ctx, 0.50);
    expect(prompt).toContain('2');
    expect(prompt).toContain('1');
  });

  it('contains "none" when opponentJokers is empty', () => {
    const ctx = makeDecisionCtx({ opponentJokers: [] });
    const prompt = buildJudgmentPrompt(ctx, 0.50);
    expect(prompt).toContain('none');
  });
});

describe('buildOwnPlayPrompt — content checks', () => {
  it('contains persona bluffBias resolved to persona value', () => {
    const ctx = makeOwnPlayCtx({ persona: 'Reader' });
    const prompt = buildOwnPlayPrompt(ctx);
    // Reader bluff-bias is 0.35
    const expectedBias = PERSONA_BLUFF_BIAS['Reader'].toFixed(2);
    expect(prompt).toContain(expectedBias);
  });

  it('contains "(none)" when roundHistory is empty', () => {
    const ctx = makeOwnPlayCtx({ roundHistory: [] });
    const prompt = buildOwnPlayPrompt(ctx);
    expect(prompt).toContain('(none)');
  });

  it('contains persona description', () => {
    const ctx = makeOwnPlayCtx({ persona: 'Silent' });
    const prompt = buildOwnPlayPrompt(ctx);
    expect(prompt).toContain(PERSONA_DESCRIPTIONS['Silent']);
  });

  it('contains round history when present', () => {
    const history: PublicClaim[] = [
      { by: 'player', count: 2, claimedRank: 'King', timestamp: 1 },
    ];
    const ctx = makeOwnPlayCtx({ roundHistory: history });
    const prompt = buildOwnPlayPrompt(ctx);
    expect(prompt).toContain('King');
  });
});

// ---------------------------------------------------------------------------
// B. Invariant 7 — LLM timeout → LLMTimeoutError
// ---------------------------------------------------------------------------

describe('invariant 7: LLM timeout triggers LLMTimeoutError', () => {
  it('rejects with LLMTimeoutError when signal is aborted before resolution', async () => {
    const controller = new AbortController();
    generateContentSpy.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const p = callLLMJudgment(makeDecisionCtx(), 0.5, controller.signal);
    controller.abort();
    await expect(p).rejects.toBeInstanceOf(LLMTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// C. Invariant 8 — exactly 2 SDK invocations on invalid-JSON-twice
// ---------------------------------------------------------------------------

describe('invariant 8 (count): exactly 2 SDK invocations on invalid-JSON-twice', () => {
  it('throws LLMInvalidJSONError and invokes generateContent exactly 2 times', async () => {
    mockReturnText('not-json');
    mockReturnText('also-not-json');

    const signal = new AbortController().signal;
    await expect(callLLMJudgment(makeDecisionCtx(), 0.5, signal)).rejects.toBeInstanceOf(
      LLMInvalidJSONError,
    );
    expect(generateContentSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// D. Invariant 8 — same AbortSignal identity on retry
// ---------------------------------------------------------------------------

describe('invariant 8 (same-signal-on-retry): AbortSignal reference equality across attempts', () => {
  it('passes the same AbortSignal instance on both the initial call and the retry', async () => {
    mockReturnText('not-valid-json');
    mockReturnText(JSON.stringify({ action: 'accept', innerThought: 'ok', voiceline: 'Accepted. Proceed.' }));

    const controller = new AbortController();
    const result = await callLLMJudgment(makeDecisionCtx(), 0.5, controller.signal);

    expect(result.action).toBe('accept');
    expect(generateContentSpy).toHaveBeenCalledTimes(2);

    const signal0 = generateContentSpy.mock.calls[0][0].config.abortSignal;
    const signal1 = generateContentSpy.mock.calls[1][0].config.abortSignal;
    // MUST be reference equality — same signal, not a freshly created one
    expect(signal0).toBe(signal1);
  });
});

// ---------------------------------------------------------------------------
// E. Invariant 9 — card-id-not-in-hand (validation + retry + throws)
// ---------------------------------------------------------------------------

describe('invariant 9: own-play card-id-not-in-hand validation', () => {
  it('throws LLMInvalidJSONError with reason card-id-not-in-hand after 2 invocations', async () => {
    const invalidResponse = JSON.stringify({
      cardsToPlay: ['NOT-IN-HAND'],
      claimCount: 1,
      claimText: 'One Queen.',
      truthState: 'honest',
      innerThought: 'trying to cheat',
    });
    mockReturnText(invalidResponse);
    mockReturnText(invalidResponse);

    const signal = new AbortController().signal;
    const err = await callLLMOwnPlay(makeOwnPlayCtx(), signal).catch(e => e);

    expect(err).toBeInstanceOf(LLMInvalidJSONError);
    expect((err as LLMInvalidJSONError).reason).toBe('card-id-not-in-hand');
    expect(generateContentSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// F. Invariant 13 — GEMINI_API_KEY missing throws at module load
// ---------------------------------------------------------------------------

describe('invariant 13: GEMINI_API_KEY missing throws at module load', () => {
  it('throws synchronously at module load when GEMINI_API_KEY is unset', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      vi.resetModules();
      // Dynamic import after resetModules forces a fresh module evaluation —
      // the env-check runs again with the missing key and should throw.
      let threw = false;
      try {
        await import('./llm');
      } catch (e) {
        threw = true;
        expect(String(e)).toMatch(/GEMINI_API_KEY is required/);
      }
      expect(threw).toBe(true);
    } finally {
      process.env.GEMINI_API_KEY = original;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// G. Retry-once SUCCESS — invalid then valid JSON resolves
// ---------------------------------------------------------------------------

describe('retry-once success: invalid-then-valid resolves with valid output', () => {
  it('resolves with LLMJudgmentOutput after 1 retry (exactly 2 invocations)', async () => {
    mockReturnText('not-json');
    mockReturnText(JSON.stringify({ action: 'challenge', innerThought: 'Suspicious.', voiceline: 'You are lying.' }));

    const signal = new AbortController().signal;
    const result = await callLLMJudgment(makeDecisionCtx(), 0.5, signal);

    expect(result.action).toBe('challenge');
    expect(result.innerThought).toBe('Suspicious.');
    expect(generateContentSpy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// H. Timeout does NOT retry — exactly 1 SDK invocation
// ---------------------------------------------------------------------------

describe('timeout does not retry', () => {
  it('throws LLMTimeoutError with exactly 1 SDK invocation (no retry)', async () => {
    const controller = new AbortController();
    generateContentSpy.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const p = callLLMJudgment(makeDecisionCtx(), 0.5, controller.signal);
    controller.abort();

    await expect(p).rejects.toBeInstanceOf(LLMTimeoutError);
    expect(generateContentSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// I. Own-play additional validators
// ---------------------------------------------------------------------------

describe('own-play additional validators', () => {
  it('count-mismatch: cardsToPlay length !== claimCount → LLMInvalidJSONError reason count-mismatch', async () => {
    // 2 cards but claimCount=1
    const invalidResponse = JSON.stringify({
      cardsToPlay: ['Q-0', 'Q-1'],
      claimCount: 1,
      claimText: 'One Queen.',
      truthState: 'honest',
      innerThought: 'oops',
    });
    mockReturnText(invalidResponse);
    mockReturnText(invalidResponse);

    const signal = new AbortController().signal;
    const err = await callLLMOwnPlay(makeOwnPlayCtx(), signal).catch(e => e);

    expect(err).toBeInstanceOf(LLMInvalidJSONError);
    expect((err as LLMInvalidJSONError).reason).toBe('count-mismatch');
  });

  it('truth-state-mismatch: all target-rank cards but truthState "lying" → reason truth-state-mismatch', async () => {
    // Q-0 and Q-1 are both Queens (target rank), so truthState must be 'honest'
    const invalidResponse = JSON.stringify({
      cardsToPlay: ['Q-0', 'Q-1'],
      claimCount: 2,
      claimText: 'Two Queens.',
      truthState: 'lying',
      innerThought: 'oops',
    });
    mockReturnText(invalidResponse);
    mockReturnText(invalidResponse);

    const signal = new AbortController().signal;
    const err = await callLLMOwnPlay(makeOwnPlayCtx(), signal).catch(e => e);

    expect(err).toBeInstanceOf(LLMInvalidJSONError);
    expect((err as LLMInvalidJSONError).reason).toBe('truth-state-mismatch');
  });
});
