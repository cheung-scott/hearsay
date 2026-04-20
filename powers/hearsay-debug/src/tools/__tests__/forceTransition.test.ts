import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  makeCard,
  makePlayer,
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

import { makeForceTransition } from '../forceTransition';

beforeEach(() => {
  kvMock.map.clear();
  vi.restoreAllMocks();
});

function parseEnvelope(
  result: Awaited<ReturnType<ReturnType<typeof makeForceTransition>>>,
) {
  return JSON.parse(result.content[0]!.text);
}

const DEV = { allowForceTransition: true, allowInspectAIDecision: true };
const PROD = { allowForceTransition: false, allowInspectAIDecision: false };

function sessionWithQueenInClaimPhase() {
  return makeSession({
    id: 's1',
    status: 'round_active',
    player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    ai: makePlayer({ personaIfAi: 'Novice' }),
    rounds: [
      makeRound({
        roundNumber: 1,
        targetRank: 'Queen',
        activePlayer: 'player',
        status: 'claim_phase',
      }),
    ],
  });
}

describe('forceTransition', () => {
  it('I3: HEARSAY_DEBUG !== "1" → PERMISSION_DENIED, KV unchanged', async () => {
    const session = sessionWithQueenInClaimPhase();
    kvMock.map.set('hearsay:session:s1', session);
    const setSpy = vi.spyOn(kvMock.kv, 'set');

    const tool = makeForceTransition(PROD);
    const env = parseEnvelope(
      await tool({
        sessionId: 's1',
        event: {
          type: 'ClaimMade',
          now: 1,
          claim: {
            by: 'player',
            count: 1,
            claimedRank: 'Queen',
            actualCardIds: ['Queen-0'],
            truthState: 'honest',
            timestamp: 1,
          },
        },
      }),
    );

    expect(env.ok).toBe(false);
    expect(env.code).toBe('PERMISSION_DENIED');
    expect(setSpy).not.toHaveBeenCalled();
    // Session unchanged.
    expect(kvMock.map.get('hearsay:session:s1')).toBe(session);
  });

  it('I2: rejects events that reduce rejects (ClaimAccepted in claim_phase)', async () => {
    kvMock.map.set('hearsay:session:s1', sessionWithQueenInClaimPhase());
    const tool = makeForceTransition(DEV);

    const env = parseEnvelope(
      await tool({
        sessionId: 's1',
        event: { type: 'ClaimAccepted', now: 2 },
      }),
    );

    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_TRANSITION');
    expect(env.details?.eventType).toBe('ClaimAccepted');
  });

  it('I9: dryRun=true never calls store.set', async () => {
    kvMock.map.set('hearsay:session:s1', sessionWithQueenInClaimPhase());
    const setSpy = vi.spyOn(kvMock.kv, 'set');
    const tool = makeForceTransition(DEV);

    const env = parseEnvelope(
      await tool({
        sessionId: 's1',
        dryRun: true,
        event: {
          type: 'ClaimMade',
          now: 3,
          claim: {
            by: 'player',
            count: 1,
            claimedRank: 'Queen',
            actualCardIds: ['Queen-0'],
            truthState: 'honest',
            timestamp: 3,
          },
        },
      }),
    );

    expect(env.ok).toBe(true);
    expect(env.data.applied).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('valid event applies and persists via store.set', async () => {
    kvMock.map.set('hearsay:session:s1', sessionWithQueenInClaimPhase());
    const setSpy = vi.spyOn(kvMock.kv, 'set');
    const tool = makeForceTransition(DEV);

    const env = parseEnvelope(
      await tool({
        sessionId: 's1',
        event: {
          type: 'ClaimMade',
          now: 4,
          claim: {
            by: 'player',
            count: 1,
            claimedRank: 'Queen',
            actualCardIds: ['Queen-0'],
            truthState: 'honest',
            timestamp: 4,
          },
        },
      }),
    );

    expect(env.ok).toBe(true);
    expect(env.data.applied).toBe(true);
    expect(setSpy).toHaveBeenCalledOnce();
    // after projection shows response_phase now
    expect(env.data.after.rounds[0].status).toBe('response_phase');
  });

  it('INVALID_INPUT for malformed event (missing type)', async () => {
    kvMock.map.set('hearsay:session:s1', sessionWithQueenInClaimPhase());
    const tool = makeForceTransition(DEV);

    const env = parseEnvelope(
      await tool({ sessionId: 's1', event: { now: 5 } }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_INPUT');
  });

  it('INVALID_INPUT for unknown event.type', async () => {
    kvMock.map.set('hearsay:session:s1', sessionWithQueenInClaimPhase());
    const tool = makeForceTransition(DEV);

    const env = parseEnvelope(
      await tool({
        sessionId: 's1',
        event: { type: 'FakeEvent', now: 6 },
      }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_INPUT');
  });

  it('missing session → SESSION_NOT_FOUND', async () => {
    const tool = makeForceTransition(DEV);
    const env = parseEnvelope(
      await tool({
        sessionId: 'nope',
        event: { type: 'ClaimAccepted', now: 7 },
      }),
    );
    expect(env.ok).toBe(false);
    expect(env.code).toBe('SESSION_NOT_FOUND');
  });
});
