// route.test.ts — POST /api/game/probe integration.
//
// Real FSM + toClientView + filter; mocks session store only.
// Covers invariant I10 (rawLlmReasoning strip).

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted; declare before imports.
// ---------------------------------------------------------------------------

vi.mock('@/lib/session/store', () => {
  const get = vi.fn();
  const set = vi.fn();
  const deleteFn = vi.fn();
  (globalThis as Record<string, unknown>).__probeStoreGet = get;
  (globalThis as Record<string, unknown>).__probeStoreSet = set;
  return { get, set, delete: deleteFn };
});

import { POST } from './route';
import type {
  ActiveJokerEffect,
  ActiveProbe,
  Claim,
  Round,
  Session,
} from '@/lib/game/types';

const storeGet = () =>
  (globalThis as Record<string, unknown>).__probeStoreGet as ReturnType<typeof vi.fn>;
const storeSet = () =>
  (globalThis as Record<string, unknown>).__probeStoreSet as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Round> = {}): Session {
  const aiClaim: Claim = {
    by: 'ai',
    count: 1,
    claimedRank: 'Queen',
    actualCardIds: ['Q-2'],
    truthState: 'lying',
    llmReasoning:
      'As the Reader persona, probability is 0.34 — something felt off.',
    timestamp: 0,
  };
  const round: Round = {
    roundNumber: 1,
    targetRank: 'Queen',
    activePlayer: 'ai',
    pile: [{ id: 'Q-2', rank: 'Queen' }],
    claimHistory: [aiClaim],
    status: 'response_phase',
    activeJokerEffects: [
      { type: 'stage_whisper', expiresAfter: 'next_claim' },
    ] satisfies ActiveJokerEffect[],
    tensionLevel: 0.3,
    ...overrides,
  };
  return {
    id: 'sess-1',
    player: {
      hand: [{ id: 'K-0', rank: 'King' }],
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: ['stage_whisper'],
    },
    ai: {
      hand: [],
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
      personaIfAi: 'Reader',
    },
    deck: [],
    rounds: [round],
    currentRoundIdx: 0,
    status: 'round_active',
    musicTracks: [
      { level: 'calm', url: 'calm.mp3' },
      { level: 'tense', url: 'tense.mp3' },
      { level: 'critical', url: 'critical.mp3' },
    ],
  };
}

function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/game/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  storeGet().mockReset();
  storeSet().mockReset();
});

// ---------------------------------------------------------------------------
// Success — initiation
// ---------------------------------------------------------------------------

describe('POST /api/game/probe — initiation', () => {
  it('returns currentProbe with filtered revealedReasoning on success', async () => {
    storeGet().mockResolvedValue(makeSession());

    const res = await POST(post({ sessionId: 'sess-1' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      session: { rounds: Array<{ currentProbe?: { revealedReasoning: string } }> };
      probe: { whisperId: string; revealedReasoning: string; filterSource: string };
    };
    expect(body.probe.whisperId).toBeTypeOf('string');
    expect(body.probe.revealedReasoning.length).toBeGreaterThan(0);
    expect(body.probe.revealedReasoning).toMatch(/^[^0-9%]*$/);
    expect(body.probe.revealedReasoning.toLowerCase()).not.toContain('reader');
    expect(body.session.rounds[0]?.currentProbe?.revealedReasoning).toBe(
      body.probe.revealedReasoning,
    );
    expect(storeSet()).toHaveBeenCalledTimes(1);
  });

  it('persists the updated session with Round.activeProbe set server-side', async () => {
    storeGet().mockResolvedValue(makeSession());
    await POST(post({ sessionId: 'sess-1' }));

    const [, persisted] = storeSet().mock.calls[0] as [string, Session];
    expect(persisted.rounds[0]?.activeProbe).toBeDefined();
    expect(persisted.rounds[0]?.activeProbe?.rawLlmReasoning).toContain(
      'probability is 0.34',
    );
  });
});

// ---------------------------------------------------------------------------
// Success — completion
// ---------------------------------------------------------------------------

describe('POST /api/game/probe — completion', () => {
  it('clears currentProbe on action=complete', async () => {
    const session = makeSession();
    const activeProbe: ActiveProbe = {
      whisperId: 'wh-1',
      targetAiId: 'ai',
      roundIdx: 0,
      triggeredAtTurn: 1,
      revealedReasoning: '*Hard to say.*',
      filterSource: 'fallback-static',
      startedAt: 1,
      decayMs: 4000,
      expiresAt: 4001,
      rawLlmReasoning: 'secret',
    };
    session.rounds[0]!.activeProbe = activeProbe;
    storeGet().mockResolvedValue(session);

    const res = await POST(
      post({ sessionId: 'sess-1', action: 'complete', whisperId: 'wh-1' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { rounds: Array<{ currentProbe?: unknown }> };
    };
    expect(body.session.rounds[0]?.currentProbe).toBeUndefined();
  });

  it('returns 404 on whisperId mismatch', async () => {
    const session = makeSession();
    session.rounds[0]!.activeProbe = {
      whisperId: 'wh-1',
      targetAiId: 'ai',
      roundIdx: 0,
      triggeredAtTurn: 1,
      revealedReasoning: '*Hard to say.*',
      filterSource: 'fallback-static',
      startedAt: 1,
      decayMs: 4000,
      expiresAt: 4001,
      rawLlmReasoning: '',
    };
    storeGet().mockResolvedValue(session);

    const res = await POST(
      post({ sessionId: 'sess-1', action: 'complete', whisperId: 'other' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on action=complete when no active probe', async () => {
    storeGet().mockResolvedValue(makeSession());
    const res = await POST(
      post({ sessionId: 'sess-1', action: 'complete', whisperId: 'wh-x' }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('POST /api/game/probe — error paths', () => {
  it('returns 404 when session not found', async () => {
    storeGet().mockResolvedValue(null);
    const res = await POST(post({ sessionId: 'missing' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 INVALID_JSON on bad body', async () => {
    const req = new Request('http://localhost/api/game/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  it('returns 400 MISSING_SESSION_ID when sessionId absent', async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('MISSING_SESSION_ID');
  });

  it('returns 400 when no stage_whisper joker effect present', async () => {
    storeGet().mockResolvedValue(makeSession({ activeJokerEffects: [] }));
    const res = await POST(post({ sessionId: 'sess-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('PROBE_REJECTED_NO_JOKER');
  });

  it('returns 400 when round.status !== response_phase', async () => {
    storeGet().mockResolvedValue(
      makeSession({ status: 'claim_phase', claimHistory: [] }),
    );
    const res = await POST(post({ sessionId: 'sess-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('PROBE_REJECTED_INVALID_PHASE');
  });

  it('returns 400 when last claim is by player', async () => {
    const s = makeSession();
    s.rounds[0]!.claimHistory[0]!.by = 'player';
    storeGet().mockResolvedValue(s);
    const res = await POST(post({ sessionId: 'sess-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('PROBE_REJECTED_NO_CLAIM');
  });

  it('returns 409 when a probe is already active', async () => {
    const s = makeSession();
    s.rounds[0]!.activeProbe = {
      whisperId: 'wh-existing',
      targetAiId: 'ai',
      roundIdx: 0,
      triggeredAtTurn: 1,
      revealedReasoning: '*Hard to say.*',
      filterSource: 'fallback-static',
      startedAt: 1,
      decayMs: 4000,
      expiresAt: 4001,
      rawLlmReasoning: '',
    };
    storeGet().mockResolvedValue(s);
    const res = await POST(post({ sessionId: 'sess-1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('PROBE_ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// I10 — toClientView strips rawLlmReasoning from the wire.
// ---------------------------------------------------------------------------

describe('I10 — rawLlmReasoning never crosses the wire', () => {
  it('projected ClientSession contains no rawLlmReasoning / digits / persona', async () => {
    const s = makeSession();
    s.rounds[0]!.activeProbe = {
      whisperId: 'wh-leak',
      targetAiId: 'ai',
      roundIdx: 0,
      triggeredAtTurn: 1,
      revealedReasoning: '*Something feels off about this one.*',
      filterSource: 'fallback-static',
      startedAt: 1,
      decayMs: 4000,
      expiresAt: 4001,
      rawLlmReasoning: 'SECRET MATH: 0.42 from Silent persona',
    };
    storeGet().mockResolvedValue(s);

    const res = await POST(
      post({ sessionId: 'sess-1', action: 'complete', whisperId: 'wh-leak' }),
    );
    // This request clears the probe — verify via a *second* request path: we
    // just need the ClientSession serialization to never leak the raw string.
    // Easier: project directly.

    // Direct projection: import toClientView and verify on the fixture itself.
    const { toClientView } = await import('@/lib/game/toClientView');
    const client = toClientView(s, 'player');
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('0.42');
    expect(serialized).not.toContain('Silent persona');

    // Also confirm the projected currentProbe has exactly 5 fields.
    const projected = client.rounds[0]?.currentProbe;
    expect(projected).toBeDefined();
    expect(Object.keys(projected!).sort()).toEqual(
      ['decayMs', 'expiresAt', 'filterSource', 'revealedReasoning', 'whisperId'].sort(),
    );
    expect((projected as Record<string, unknown>).rawLlmReasoning).toBeUndefined();

    // Completion request itself succeeded.
    expect(res.status).toBe(200);
  });
});
