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

import { replayRound } from '../replayRound';

beforeEach(() => {
  kvMock.map.clear();
});

function parseEnvelope(result: Awaited<ReturnType<typeof replayRound>>) {
  return JSON.parse(result.content[0]!.text);
}

describe('replayRound', () => {
  it('returns public claim sequence for a valid round', async () => {
    const session = makeSession({
      id: 's1',
      rounds: [
        makeRound({
          claimHistory: [
            makeClaim({ by: 'player', claimedRank: 'Queen', timestamp: 1 }),
            makeClaim({ by: 'ai', claimedRank: 'King', timestamp: 2 }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s1', session);

    const env = parseEnvelope(
      await replayRound({ sessionId: 's1', roundIndex: 0 }),
    );
    expect(env.ok).toBe(true);
    expect(env.data).toHaveLength(2);
    expect(env.data[0].claim.by).toBe('player');
    expect(env.data[1].claim.by).toBe('ai');
    // PublicClaim projection strips actualCardIds / truthState / llmReasoning.
    expect(JSON.stringify(env.data)).not.toContain('actualCardIds');
    expect(JSON.stringify(env.data)).not.toContain('truthState');
  });

  it('out-of-range roundIndex → ROUND_NOT_FOUND', async () => {
    const session = makeSession({
      id: 's2',
      rounds: [makeRound()],
    });
    kvMock.map.set('hearsay:session:s2', session);

    const env = parseEnvelope(
      await replayRound({ sessionId: 's2', roundIndex: 2 }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('ROUND_NOT_FOUND');
  });

  it('never writes to KV (read-only guarantee)', async () => {
    const session = makeSession({
      id: 's3',
      rounds: [makeRound({ claimHistory: [makeClaim()] })],
    });
    kvMock.map.set('hearsay:session:s3', session);
    const setSpy = vi.spyOn(kvMock.kv, 'set');

    await replayRound({ sessionId: 's3', roundIndex: 0 });
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
