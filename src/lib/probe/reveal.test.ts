// reveal.test.ts — probe-phase invariants I8, I9, I11, I12.
//
// White-box tests of the pure glue between filter and FSM. The actual reducer
// case tests live alongside fsm.test.ts in the game-engine layer; here we
// verify the helper functions' contracts.

import { describe, it, expect } from 'vitest';

import {
  buildActiveProbe,
  toRevealedProbe,
  toProbeResponse,
  checkProbeEntry,
  checkProbeComplete,
  DEFAULT_DECAY_MS,
} from './reveal';
import { reduce } from '../game/fsm';
import { InvalidTransitionError } from '../game/types';
import type {
  ActiveJokerEffect,
  Claim,
  Round,
  Session,
} from '../game/types';
import type { ProbeRequest } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAiClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    by: 'ai',
    count: 1,
    claimedRank: 'Queen',
    actualCardIds: ['Q-2'],
    truthState: 'lying',
    llmReasoning: 'Something felt slightly rushed about that delivery.',
    timestamp: 0,
    ...overrides,
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    roundNumber: 1,
    targetRank: 'Queen',
    activePlayer: 'ai',
    pile: [{ id: 'Q-2', rank: 'Queen' }],
    claimHistory: [makeAiClaim()],
    status: 'response_phase',
    activeJokerEffects: [
      { type: 'stage_whisper', expiresAfter: 'next_claim' },
    ] satisfies ActiveJokerEffect[],
    tensionLevel: 0.3,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const round = makeRound();
  return {
    id: 'sess-1',
    player: {
      hand: [],
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
    musicTracks: [],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ProbeRequest> = {}): ProbeRequest {
  return {
    whisperId: 'wh-1',
    targetAiId: 'ai',
    roundIdx: 0,
    triggeredAtTurn: 1,
    now: 1_000_000,
    mathProb: 0.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildActiveProbe
// ---------------------------------------------------------------------------

describe('buildActiveProbe', () => {
  it('populates all 10 ActiveProbe fields', () => {
    const probe = buildActiveProbe(
      makeRequest(),
      'Something felt rushed.',
      'Reader',
      1_000_000,
    );
    expect(Object.keys(probe).sort()).toEqual(
      [
        'decayMs',
        'expiresAt',
        'filterSource',
        'rawLlmReasoning',
        'revealedReasoning',
        'roundIdx',
        'startedAt',
        'targetAiId',
        'triggeredAtTurn',
        'whisperId',
      ].sort(),
    );
  });

  it('defaults decayMs to 4000 and computes expiresAt = startedAt + decayMs', () => {
    const probe = buildActiveProbe(
      makeRequest(),
      'Felt rushed.',
      'Reader',
      2_000_000,
    );
    expect(probe.decayMs).toBe(DEFAULT_DECAY_MS);
    expect(probe.startedAt).toBe(2_000_000);
    expect(probe.expiresAt).toBe(2_000_000 + DEFAULT_DECAY_MS);
  });

  it('preserves rawLlmReasoning server-side', () => {
    const raw = 'As the Reader I note probability is 0.34 — smells like a lie.';
    const probe = buildActiveProbe(makeRequest(), raw, 'Reader', 1);
    expect(probe.rawLlmReasoning).toBe(raw);
    // And the filtered field must NOT contain the raw leaks.
    expect(probe.revealedReasoning).toMatch(/^[^0-9%]*$/);
    expect(probe.revealedReasoning.toLowerCase()).not.toContain('reader');
  });

  it('handles undefined llmReasoning via static fallback', () => {
    const probe = buildActiveProbe(
      makeRequest({ mathProb: 0.9 }),
      undefined,
      'Silent',
      1,
    );
    expect(probe.filterSource).toBe('fallback-static');
    expect(probe.rawLlmReasoning).toBe('');
  });
});

// ---------------------------------------------------------------------------
// toRevealedProbe / toProbeResponse — projection correctness
// ---------------------------------------------------------------------------

describe('client projections', () => {
  const probe = buildActiveProbe(
    makeRequest(),
    'Felt a little off.',
    'Reader',
    1,
  );

  it('toRevealedProbe produces exactly 5 fields, stripping rawLlmReasoning', () => {
    const revealed = toRevealedProbe(probe);
    expect(Object.keys(revealed).sort()).toEqual(
      ['decayMs', 'expiresAt', 'filterSource', 'revealedReasoning', 'whisperId'].sort(),
    );
    expect((revealed as Record<string, unknown>).rawLlmReasoning).toBeUndefined();
  });

  it('toProbeResponse projects 4 fields', () => {
    const resp = toProbeResponse(probe);
    expect(Object.keys(resp).sort()).toEqual(
      ['decayMs', 'filterSource', 'revealedReasoning', 'whisperId'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// I8 — entry guards reject invalid states.
// ---------------------------------------------------------------------------

describe('I8 — entry guards', () => {
  it('rejects when session.status !== round_active', () => {
    const s = makeSession({ status: 'setup' });
    expect(checkProbeEntry(s)).toBe('PROBE_REJECTED_INVALID_PHASE');
  });

  it('rejects when round.status === claim_phase', () => {
    const s = makeSession({
      rounds: [makeRound({ status: 'claim_phase', claimHistory: [] })],
    });
    expect(checkProbeEntry(s)).toBe('PROBE_REJECTED_INVALID_PHASE');
  });

  it('rejects when no stage_whisper in activeJokerEffects', () => {
    const s = makeSession({ rounds: [makeRound({ activeJokerEffects: [] })] });
    expect(checkProbeEntry(s)).toBe('PROBE_REJECTED_NO_JOKER');
  });

  it('rejects when claimHistory is empty', () => {
    const s = makeSession({
      rounds: [
        makeRound({
          claimHistory: [],
          // keep status on response_phase to isolate the no-claim guard
        }),
      ],
    });
    expect(checkProbeEntry(s)).toBe('PROBE_REJECTED_NO_CLAIM');
  });

  it('rejects when last claim was by player', () => {
    const s = makeSession({
      rounds: [
        makeRound({
          claimHistory: [makeAiClaim({ by: 'player', llmReasoning: undefined })],
        }),
      ],
    });
    expect(checkProbeEntry(s)).toBe('PROBE_REJECTED_NO_CLAIM');
  });

  it('accepts a valid response_phase with stage_whisper + AI claim', () => {
    expect(checkProbeEntry(makeSession())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I9 — concurrent probe rejected.
// ---------------------------------------------------------------------------

describe('I9 — concurrent probe rejected', () => {
  it('blocks a second probe while round.activeProbe is set', () => {
    const probe = buildActiveProbe(
      makeRequest(),
      'Felt off.',
      'Reader',
      1,
    );
    const s = makeSession({
      rounds: [makeRound({ activeProbe: probe })],
    });
    expect(checkProbeEntry(s)).toBe('PROBE_ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// I11 — ProbeComplete and ProbeExpired both clear activeProbe without
// changing round.status.
// ---------------------------------------------------------------------------

describe('I11 — ProbeComplete and ProbeExpired clear activeProbe', () => {
  function sessionWithProbe(): Session {
    const probe = buildActiveProbe(
      makeRequest(),
      'Felt off.',
      'Reader',
      1,
    );
    return makeSession({ rounds: [makeRound({ activeProbe: probe })] });
  }

  it('ProbeStart sets activeProbe; round.status unchanged', () => {
    const s = makeSession();
    const probe = buildActiveProbe(
      makeRequest(),
      s.rounds[0]?.claimHistory[0]?.llmReasoning,
      'Reader',
      5,
    );
    const next = reduce(s, { type: 'ProbeStart', probe, now: 5 });
    const r = next.rounds[0]!;
    expect(r.activeProbe).toEqual(probe);
    expect(r.status).toBe('response_phase');
  });

  it('ProbeComplete clears activeProbe; round.status unchanged', () => {
    const s = sessionWithProbe();
    const whisperId = s.rounds[0]!.activeProbe!.whisperId;
    const next = reduce(s, { type: 'ProbeComplete', whisperId, now: 10 });
    const r = next.rounds[0]!;
    expect(r.activeProbe).toBeUndefined();
    expect(r.status).toBe('response_phase');
  });

  it('ProbeExpired clears activeProbe; round.status unchanged', () => {
    const s = sessionWithProbe();
    const whisperId = s.rounds[0]!.activeProbe!.whisperId;
    const next = reduce(s, { type: 'ProbeExpired', whisperId, now: 10 });
    const r = next.rounds[0]!;
    expect(r.activeProbe).toBeUndefined();
    expect(r.status).toBe('response_phase');
  });

  it('ProbeComplete with mismatched whisperId throws', () => {
    const s = sessionWithProbe();
    expect(() =>
      reduce(s, { type: 'ProbeComplete', whisperId: 'nope', now: 10 }),
    ).toThrow(InvalidTransitionError);
  });

  it('ProbeComplete without active probe throws', () => {
    const s = makeSession();
    expect(() =>
      reduce(s, { type: 'ProbeComplete', whisperId: 'wh-1', now: 10 }),
    ).toThrow(InvalidTransitionError);
  });

  it('ClaimAccepted while probe active is rejected', () => {
    const s = sessionWithProbe();
    expect(() => reduce(s, { type: 'ClaimAccepted', now: 10 })).toThrow(
      /probe_active/,
    );
  });

  it('ChallengeCalled while probe active is rejected', () => {
    const s = sessionWithProbe();
    expect(() => reduce(s, { type: 'ChallengeCalled', now: 10 })).toThrow(
      /probe_active/,
    );
  });
});

// ---------------------------------------------------------------------------
// I12 — One probe per Stage Whisper consumption.
// ---------------------------------------------------------------------------

describe('I12 — one probe per Stage Whisper consumption', () => {
  it('second probe while first active → PROBE_ACTIVE; after complete, second fires', () => {
    const s0 = makeSession({
      rounds: [
        makeRound({
          activeJokerEffects: [
            { type: 'stage_whisper', expiresAfter: 'next_claim' },
            { type: 'stage_whisper', expiresAfter: 'next_claim' },
          ],
        }),
      ],
    });

    // First probe fires.
    const probe1 = buildActiveProbe(
      makeRequest({ whisperId: 'wh-1' }),
      'A',
      'Reader',
      1,
    );
    const s1 = reduce(s0, { type: 'ProbeStart', probe: probe1, now: 1 });
    expect(checkProbeEntry(s1)).toBe('PROBE_ACTIVE');

    // Complete first; guard reopens.
    const s2 = reduce(s1, {
      type: 'ProbeComplete',
      whisperId: 'wh-1',
      now: 2,
    });
    expect(checkProbeEntry(s2)).toBeNull();

    // Second probe fires.
    const probe2 = buildActiveProbe(
      makeRequest({ whisperId: 'wh-2' }),
      'B',
      'Reader',
      3,
    );
    const s3 = reduce(s2, { type: 'ProbeStart', probe: probe2, now: 3 });
    expect(s3.rounds[0]!.activeProbe?.whisperId).toBe('wh-2');
  });
});

// ---------------------------------------------------------------------------
// checkProbeComplete — route layer helper.
// ---------------------------------------------------------------------------

describe('checkProbeComplete', () => {
  it('returns null when activeProbe is set and whisperId matches', () => {
    const probe = buildActiveProbe(makeRequest(), 'X', 'Reader', 1);
    const s = makeSession({ rounds: [makeRound({ activeProbe: probe })] });
    expect(checkProbeComplete(s, probe.whisperId)).toBeNull();
  });

  it('returns PROBE_REJECTED_INVALID_PHASE when no activeProbe', () => {
    expect(checkProbeComplete(makeSession())).toBe(
      'PROBE_REJECTED_INVALID_PHASE',
    );
  });

  it('returns PROBE_NOT_FOUND on whisperId mismatch', () => {
    const probe = buildActiveProbe(makeRequest(), 'X', 'Reader', 1);
    const s = makeSession({ rounds: [makeRound({ activeProbe: probe })] });
    expect(checkProbeComplete(s, 'other-id')).toBe('PROBE_NOT_FOUND');
  });
});
