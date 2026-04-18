import { describe, it, expect } from 'vitest';
import type { PlayerState, Round, Session } from './types';
import {
  applyJokerEffect,
  checkRoundEnd,
  checkSessionEnd,
  expireJokerEffects,
} from './fsm';

// ---------------------------------------------------------------------------
// Factories — minimal seeds; tests pass `overrides` for the fields they care about
// ---------------------------------------------------------------------------

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    hand: [],
    takenCards: [],
    roundsWon: 0,
    strikes: 0,
    jokers: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    player: makePlayer(),
    ai: makePlayer(),
    deck: [],
    rounds: [],
    currentRoundIdx: 0,
    status: 'setup',
    musicTracks: [],
    ...overrides,
  };
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    roundNumber: 1,
    targetRank: 'Queen',
    activePlayer: 'player',
    pile: [],
    claimHistory: [],
    status: 'claim_phase',
    activeJokerEffects: [],
    tensionLevel: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkSessionEnd — Invariants 10 + 11
// ---------------------------------------------------------------------------

describe('checkSessionEnd', () => {
  it('returns null on a fresh session', () => {
    expect(checkSessionEnd(makeSession())).toBeNull();
  });

  it('player strikes === 3 → ai wins (Invariant 10)', () => {
    const s = makeSession({ player: makePlayer({ strikes: 3 }) });
    expect(checkSessionEnd(s)).toBe('ai');
  });

  it('ai strikes === 3 → player wins (Invariant 10)', () => {
    const s = makeSession({ ai: makePlayer({ strikes: 3 }) });
    expect(checkSessionEnd(s)).toBe('player');
  });

  it('player roundsWon === 2 → player wins (Invariant 11)', () => {
    const s = makeSession({ player: makePlayer({ roundsWon: 2 }) });
    expect(checkSessionEnd(s)).toBe('player');
  });

  it('ai roundsWon === 2 → ai wins (Invariant 11)', () => {
    const s = makeSession({ ai: makePlayer({ roundsWon: 2 }) });
    expect(checkSessionEnd(s)).toBe('ai');
  });

  it('strike-3 loss has priority over rounds-won-2 (spec §1.4 rule 7)', () => {
    // Player simultaneously has 3 strikes AND 2 rounds won — strike-3 wins the race.
    const s = makeSession({
      player: makePlayer({ strikes: 3, roundsWon: 2 }),
    });
    expect(checkSessionEnd(s)).toBe('ai');
  });

  it('returns null when neither player hit a trigger yet', () => {
    const s = makeSession({
      player: makePlayer({ strikes: 2, roundsWon: 1 }),
      ai: makePlayer({ strikes: 2, roundsWon: 1 }),
    });
    expect(checkSessionEnd(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkRoundEnd — ClaimAccepted path only (caught-lie lives in RevealComplete)
// ---------------------------------------------------------------------------

describe('checkRoundEnd', () => {
  it('hand non-empty → { ended: false }', () => {
    expect(checkRoundEnd(makeRound(), 'player', 3)).toEqual({ ended: false });
  });

  it('hand empty, active was player → player wins', () => {
    expect(checkRoundEnd(makeRound(), 'player', 0)).toEqual({
      ended: true,
      winner: 'player',
    });
  });

  it('hand empty, active was ai → ai wins', () => {
    expect(checkRoundEnd(makeRound(), 'ai', 0)).toEqual({
      ended: true,
      winner: 'ai',
    });
  });

  it('works for any round state — does not inspect round internals in the accepted-path', () => {
    const loaded = makeRound({
      pile: [{ id: 'Queen-0', rank: 'Queen' }],
      claimHistory: [],
      status: 'response_phase',
      activeJokerEffects: [{ type: 'poker_face', expiresAfter: 'next_claim' }],
    });
    expect(checkRoundEnd(loaded, 'ai', 0)).toEqual({
      ended: true,
      winner: 'ai',
    });
  });
});

// ---------------------------------------------------------------------------
// applyJokerEffect + expireJokerEffects (Invariant 19 / Task 2.6)
// ---------------------------------------------------------------------------

describe('applyJokerEffect', () => {
  it('pushes an effect with next_claim expiry', () => {
    const round = makeRound();
    const out = applyJokerEffect(round, 'poker_face');
    expect(out.activeJokerEffects).toEqual([
      { type: 'poker_face', expiresAfter: 'next_claim' },
    ]);
  });

  it('appends — does not replace existing effects', () => {
    const round = makeRound({
      activeJokerEffects: [
        { type: 'cold_read', expiresAfter: 'next_challenge' },
      ],
    });
    const out = applyJokerEffect(round, 'stage_whisper');
    expect(out.activeJokerEffects).toHaveLength(2);
    expect(out.activeJokerEffects[0].type).toBe('cold_read');
    expect(out.activeJokerEffects[1]).toEqual({
      type: 'stage_whisper',
      expiresAfter: 'next_claim',
    });
  });

  it('returns a new Round — does not mutate input', () => {
    const round = makeRound();
    const effectsRef = round.activeJokerEffects;
    applyJokerEffect(round, 'poker_face');
    expect(round.activeJokerEffects).toBe(effectsRef);
    expect(round.activeJokerEffects).toHaveLength(0);
  });
});

describe('expireJokerEffects', () => {
  it('removes matching-trigger effects, preserves others', () => {
    const round = makeRound({
      activeJokerEffects: [
        { type: 'poker_face', expiresAfter: 'next_claim' },
        { type: 'cold_read', expiresAfter: 'next_challenge' },
        { type: 'stage_whisper', expiresAfter: 'next_claim' },
      ],
    });
    const out = expireJokerEffects(round, 'next_claim');
    expect(out.activeJokerEffects).toEqual([
      { type: 'cold_read', expiresAfter: 'next_challenge' },
    ]);
  });

  it('preserves session-lived effects on next_claim trigger', () => {
    const round = makeRound({
      activeJokerEffects: [
        { type: 'second_wind', expiresAfter: 'session' },
        { type: 'poker_face', expiresAfter: 'next_claim' },
      ],
    });
    const out = expireJokerEffects(round, 'next_claim');
    expect(out.activeJokerEffects).toEqual([
      { type: 'second_wind', expiresAfter: 'session' },
    ]);
  });

  it('no-op when no matching effects', () => {
    const round = makeRound({
      activeJokerEffects: [{ type: 'cold_read', expiresAfter: 'session' }],
    });
    const out = expireJokerEffects(round, 'next_claim');
    expect(out.activeJokerEffects).toHaveLength(1);
  });

  it('returns a new Round — does not mutate input', () => {
    const round = makeRound({
      activeJokerEffects: [
        { type: 'poker_face', expiresAfter: 'next_claim' },
      ],
    });
    const effectsRef = round.activeJokerEffects;
    expireJokerEffects(round, 'next_claim');
    expect(round.activeJokerEffects).toBe(effectsRef);
    expect(round.activeJokerEffects).toHaveLength(1);
  });
});
