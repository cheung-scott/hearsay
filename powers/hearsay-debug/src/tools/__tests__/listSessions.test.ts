import { describe, expect, it, vi, beforeEach } from 'vitest';
import { makeSession } from '../../__tests__/fixtures';

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

import { listSessions } from '../listSessions';

beforeEach(() => {
  kvMock.map.clear();
});

function parseEnvelope(result: Awaited<ReturnType<typeof listSessions>>) {
  return JSON.parse(result.content[0]!.text);
}

describe('listSessions', () => {
  it('I4: returns only hearsay:session:* keys; ignores unrelated keys', async () => {
    kvMock.map.set('hearsay:session:a', makeSession({ id: 'a' }));
    kvMock.map.set('hearsay:session:b', makeSession({ id: 'b' }));
    kvMock.map.set('unrelated:key', { foo: 'bar' });
    kvMock.map.set('auth:token:xyz', 'secret');

    const result = await listSessions({});
    const env = parseEnvelope(result);

    expect(env.ok).toBe(true);
    const ids = env.data.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('respects limit and paginates when >20 sessions exist', async () => {
    for (let i = 0; i < 25; i++) {
      kvMock.map.set(
        `hearsay:session:s${i}`,
        makeSession({ id: `s${i}` }),
      );
    }

    const defaulted = parseEnvelope(await listSessions({}));
    expect(defaulted.data).toHaveLength(20);

    const explicit = parseEnvelope(await listSessions({ limit: 5 }));
    expect(explicit.data).toHaveLength(5);
  });

  it('surfaces KV scan failure as KV_ERROR', async () => {
    const tool = vi
      .spyOn(kvMock.kv, 'keys')
      .mockRejectedValueOnce(new Error('upstash down'));

    const env = parseEnvelope(await listSessions({}));
    expect(env.ok).toBe(false);
    expect(env.code).toBe('KV_ERROR');
    tool.mockRestore();
  });

  it('rejects invalid limit via INVALID_INPUT', async () => {
    const env = parseEnvelope(await listSessions({ limit: 0 }));
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_INPUT');

    const env2 = parseEnvelope(await listSessions({ limit: 500 }));
    expect(env2.ok).toBe(false);
    expect(env2.code).toBe('INVALID_INPUT');
  });

  it('returns session summary fields (id, status, currentRoundIdx)', async () => {
    kvMock.map.set(
      'hearsay:session:x',
      makeSession({
        id: 'x',
        status: 'joker_offer',
        currentRoundIdx: 1,
      }),
    );
    const env = parseEnvelope(await listSessions({}));
    expect(env.data[0]).toMatchObject({
      id: 'x',
      status: 'joker_offer',
      currentRoundIdx: 1,
    });
  });
});
