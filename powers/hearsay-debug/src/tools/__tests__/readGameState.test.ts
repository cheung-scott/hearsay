import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  makeCard,
  makeClaim,
  makePlayer,
  makeRound,
  makeSession,
} from '../../__tests__/fixtures';

// vi.hoisted runs before any imports, so the kv mock must be fully self-
// contained here — we cannot import makeKvMock from a sibling file.
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

import { makeReadGameState } from '../readGameState';
import { toClientView } from '../../../../../src/lib/game/toClientView';

beforeEach(() => {
  kvMock.map.clear();
});

function parseEnvelope(result: Awaited<ReturnType<ReturnType<typeof makeReadGameState>>>) {
  return JSON.parse(result.content[0]!.text);
}

describe('readGameState', () => {
  it('I1: client view is round-trip equivalent to toClientView(session, "player")', async () => {
    const session = makeSession({
      id: 's1',
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
      ai: makePlayer({
        hand: [makeCard('King', 1), makeCard('Ace', 2)],
        personaIfAi: 'Reader',
      }),
      rounds: [
        makeRound({
          claimHistory: [
            makeClaim({
              by: 'ai',
              actualCardIds: ['King-1'],
              truthState: 'lying',
              llmReasoning: 'internal thought',
            }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s1', session);

    const tool = makeReadGameState({
      allowForceTransition: false,
      allowInspectAIDecision: false,
    });
    const result = await tool({ sessionId: 's1', view: 'client' });
    const env = parseEnvelope(result);

    expect(env.ok).toBe(true);
    expect(env.data).toEqual(toClientView(session, 'player'));
    // No actualCardIds / llmReasoning anywhere in the client projection.
    const serialized = JSON.stringify(env.data);
    expect(serialized).not.toContain('actualCardIds');
    expect(serialized).not.toContain('llmReasoning');
    // Opponent hand replaced with handSize.
    expect(env.data.opponent.handSize).toBe(2);
    expect((env.data.opponent as unknown as { hand?: unknown }).hand).toBeUndefined();
  });

  it('view=full with HEARSAY_DEBUG=1 returns full session (actualCardIds present)', async () => {
    const session = makeSession({
      id: 's2',
      rounds: [
        makeRound({
          claimHistory: [
            makeClaim({ actualCardIds: ['Queen-0'], llmReasoning: 'hi' }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s2', session);

    const tool = makeReadGameState({
      allowForceTransition: true,
      allowInspectAIDecision: true,
    });
    const result = await tool({ sessionId: 's2', view: 'full' });
    const env = parseEnvelope(result);

    expect(env.ok).toBe(true);
    expect(env.data.id).toBe('s2');
    expect(env.data.rounds[0].claimHistory[0].actualCardIds).toBeDefined();
  });

  it('view=full without HEARSAY_DEBUG returns PERMISSION_DENIED', async () => {
    const session = makeSession({ id: 's3' });
    kvMock.map.set('hearsay:session:s3', session);

    const tool = makeReadGameState({
      allowForceTransition: false,
      allowInspectAIDecision: false,
    });
    const result = await tool({ sessionId: 's3', view: 'full' });
    const env = parseEnvelope(result);

    expect(env.ok).toBe(false);
    expect(env.code).toBe('PERMISSION_DENIED');
  });

  it('missing session returns SESSION_NOT_FOUND', async () => {
    const tool = makeReadGameState({
      allowForceTransition: false,
      allowInspectAIDecision: false,
    });
    const result = await tool({ sessionId: 'missing' });
    const env = parseEnvelope(result);

    expect(env.ok).toBe(false);
    expect(env.code).toBe('SESSION_NOT_FOUND');
  });

  it('defaults view to client when omitted', async () => {
    const session = makeSession({ id: 's4' });
    kvMock.map.set('hearsay:session:s4', session);

    const tool = makeReadGameState({
      allowForceTransition: false,
      allowInspectAIDecision: false,
    });
    const result = await tool({ sessionId: 's4' });
    const env = parseEnvelope(result);

    expect(env.ok).toBe(true);
    expect(JSON.stringify(env.data)).not.toContain('actualCardIds');
  });
});
