import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  makeClaim,
  makeRound,
  makeSession,
} from '../../__tests__/fixtures';

const kvMock = vi.hoisted(() => {
  const map = new Map<string, unknown>();
  return {
    map,
    kv: {
      async get<T>(key: string): Promise<T | null> {
        return (map.get(key) as T | undefined) ?? null;
      },
      async set(key: string, value: unknown): Promise<'OK'> {
        map.set(key, value);
        return 'OK';
      },
      async del(key: string): Promise<number> {
        return map.delete(key) ? 1 : 0;
      },
      async keys(pattern: string): Promise<string[]> {
        const prefix = pattern.replace(/\*$/, '');
        return [...map.keys()].filter((k) => k.startsWith(prefix));
      },
    },
  };
});

vi.mock('@vercel/kv', () => ({ kv: kvMock.kv }));

import { makeInspectAIDecision } from '../inspectAIDecision';

beforeEach(() => {
  kvMock.map.clear();
});

function parseEnvelope(
  result: Awaited<ReturnType<ReturnType<typeof makeInspectAIDecision>>>,
) {
  return JSON.parse(result.content[0]!.text);
}

describe('inspectAIDecision', () => {
  it('I7: HEARSAY_DEBUG unset → PERMISSION_DENIED', async () => {
    const tool = makeInspectAIDecision({
      allowForceTransition: false,
      allowInspectAIDecision: false,
    });
    const env = parseEnvelope(await tool({ sessionId: 's', turnIndex: 0 }));
    expect(env.ok).toBe(false);
    expect(env.code).toBe('PERMISSION_DENIED');
  });

  it('I7: with HEARSAY_DEBUG=1 returns full Claim including llmReasoning', async () => {
    const session = makeSession({
      id: 's1',
      rounds: [
        makeRound({
          claimHistory: [
            makeClaim({
              by: 'ai',
              claimedRank: 'Queen',
              llmReasoning: 'I suspect this is a bluff',
              ttsSettings: {
                stability: 0.5,
                similarity_boost: 0.5,
                style: 0.1,
                speed: 1,
              },
            }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s1', session);

    const tool = makeInspectAIDecision({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const env = parseEnvelope(
      await tool({ sessionId: 's1', turnIndex: 0 }),
    );
    expect(env.ok).toBe(true);
    expect(env.data.llmReasoning).toBe('I suspect this is a bluff');
    expect(env.data.actualCardIds).toBeDefined();
    expect(env.data.ttsSettings).toBeDefined();
    // mathProb is re-derived for AI claims (design §5 tool 3 note).
    expect(typeof env.data.mathProb).toBe('number');
    expect(env.data.mathProb).toBeGreaterThanOrEqual(0);
    expect(env.data.mathProb).toBeLessThanOrEqual(1);
  });

  it('omits mathProb for player claims (only AI claims get re-derivation)', async () => {
    const session = makeSession({
      id: 'sp',
      rounds: [
        makeRound({
          claimHistory: [makeClaim({ by: 'player' })],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:sp', session);

    const tool = makeInspectAIDecision({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const env = parseEnvelope(await tool({ sessionId: 'sp', turnIndex: 0 }));
    expect(env.ok).toBe(true);
    expect(env.data.mathProb).toBeUndefined();
  });

  it('out-of-range turnIndex → TURN_NOT_FOUND', async () => {
    const session = makeSession({
      id: 's2',
      rounds: [makeRound({ claimHistory: [makeClaim()] })],
    });
    kvMock.map.set('hearsay:session:s2', session);

    const tool = makeInspectAIDecision({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const env = parseEnvelope(
      await tool({ sessionId: 's2', turnIndex: 5 }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('TURN_NOT_FOUND');
  });

  it('flattens across multiple rounds', async () => {
    const session = makeSession({
      id: 's3',
      rounds: [
        makeRound({
          roundNumber: 1,
          claimHistory: [
            makeClaim({ by: 'player', claimText: 'R1-T0' }),
            makeClaim({ by: 'ai', claimText: 'R1-T1' }),
          ],
        }),
        makeRound({
          roundNumber: 2,
          claimHistory: [makeClaim({ by: 'player', claimText: 'R2-T2' })],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s3', session);

    const tool = makeInspectAIDecision({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const t0 = parseEnvelope(await tool({ sessionId: 's3', turnIndex: 0 }));
    const t1 = parseEnvelope(await tool({ sessionId: 's3', turnIndex: 1 }));
    const t2 = parseEnvelope(await tool({ sessionId: 's3', turnIndex: 2 }));

    expect(t0.data.claimText).toBe('R1-T0');
    expect(t1.data.claimText).toBe('R1-T1');
    expect(t2.data.claimText).toBe('R2-T2');
  });

  it('missing session → SESSION_NOT_FOUND', async () => {
    const tool = makeInspectAIDecision({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const env = parseEnvelope(
      await tool({ sessionId: 'missing', turnIndex: 0 }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('SESSION_NOT_FOUND');
  });
});
