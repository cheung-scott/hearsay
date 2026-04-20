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

import { dumpTranscript } from '../dumpTranscript';

beforeEach(() => {
  kvMock.map.clear();
});

function parseEnvelope(result: Awaited<ReturnType<typeof dumpTranscript>>) {
  return JSON.parse(result.content[0]!.text);
}

const CARD_ID_RE = /[QKAJ][a-z]+-\d/;

describe('dumpTranscript', () => {
  it('I8: narrative never emits a raw card ID, but DOES emit truthState', async () => {
    const session = makeSession({
      id: 's1',
      rounds: [
        makeRound({
          roundNumber: 1,
          targetRank: 'Queen',
          claimHistory: [
            makeClaim({
              by: 'player',
              count: 2,
              claimedRank: 'Queen',
              actualCardIds: ['Queen-0', 'Queen-1'],
              truthState: 'honest',
              claimText: 'Two queens',
            }),
            makeClaim({
              by: 'ai',
              count: 1,
              claimedRank: 'King',
              actualCardIds: ['Ace-3'],
              truthState: 'lying',
              claimText: 'One king',
            }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s1', session);

    const env = parseEnvelope(
      await dumpTranscript({ sessionId: 's1', format: 'narrative' }),
    );
    expect(env.ok).toBe(true);
    const text: string = env.data;

    expect(text).not.toMatch(CARD_ID_RE);
    expect(text).toContain('honest');
    expect(text).toContain('lying');
    expect(text).toContain('Queens');
    expect(text).toContain('King');
  });

  it('json format returns structured entries one per claim', async () => {
    const session = makeSession({
      id: 's2',
      rounds: [
        makeRound({
          claimHistory: [
            makeClaim({ by: 'player' }),
            makeClaim({ by: 'ai' }),
          ],
        }),
      ],
    });
    kvMock.map.set('hearsay:session:s2', session);

    const env = parseEnvelope(
      await dumpTranscript({ sessionId: 's2', format: 'json' }),
    );
    expect(env.ok).toBe(true);
    expect(Array.isArray(env.data)).toBe(true);
    expect(env.data).toHaveLength(2);
    for (const entry of env.data) {
      expect(entry.truthState).toBeDefined();
      expect(JSON.stringify(entry)).not.toMatch(CARD_ID_RE);
    }
  });

  it('defaults format to narrative when omitted', async () => {
    const session = makeSession({
      id: 's3',
      rounds: [makeRound({ claimHistory: [makeClaim({ truthState: 'lying' })] })],
    });
    kvMock.map.set('hearsay:session:s3', session);

    const env = parseEnvelope(await dumpTranscript({ sessionId: 's3' }));
    expect(env.ok).toBe(true);
    expect(typeof env.data).toBe('string');
    expect(env.data).toContain('lying');
  });

  it('missing session → SESSION_NOT_FOUND', async () => {
    const env = parseEnvelope(
      await dumpTranscript({ sessionId: 'missing', format: 'narrative' }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('SESSION_NOT_FOUND');
  });
});
