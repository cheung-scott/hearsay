import { describe, it, expect } from 'vitest';
import type { Card, Claim, GameEvent, PlayerState, Round, Session } from './types';
import { InvalidTransitionError } from './types';
import {
  applyJokerEffect,
  checkRoundEnd,
  checkSessionEnd,
  expireJokerEffects,
  reduce,
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

// ---------------------------------------------------------------------------
// Helpers for Tasks 4.1 + 4.2
// ---------------------------------------------------------------------------

function makeCard(rank: Card['rank'], idx: number): Card {
  return { id: `${rank}-${idx}`, rank };
}

/** 5 Queens for player, 5 Kings for AI, 10 Aces in remaining deck */
function makeInitialDeal() {
  return {
    playerHand: [0, 1, 2, 3, 4].map((i) => makeCard('Queen', i)),
    aiHand: [0, 1, 2, 3, 4].map((i) => makeCard('King', i)),
    remainingDeck: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      makeCard('Ace', i),
    ),
    targetRank: 'Queen' as const,
    activePlayer: 'player' as const,
  };
}

function makeSetupCompleteEvent(overrides: Partial<Extract<GameEvent, { type: 'SetupComplete' }>> = {}): Extract<GameEvent, { type: 'SetupComplete' }> {
  return {
    type: 'SetupComplete',
    now: 1000,
    initialDeal: makeInitialDeal(),
    musicTracks: [
      { level: 'calm', url: 'calm.mp3' },
      { level: 'tense', url: 'tense.mp3' },
      { level: 'critical', url: 'critical.mp3' },
    ],
    ...overrides,
  };
}

function makeClaimEvent(overrides: Partial<Claim> = {}): Extract<GameEvent, { type: 'ClaimMade' }> {
  const base: Claim = {
    by: 'player',
    count: 1,
    claimedRank: 'Queen',
    actualCardIds: ['Queen-0'],
    truthState: 'honest', // reducer will re-derive
    timestamp: 2000,
    ...overrides,
  };
  return { type: 'ClaimMade', claim: base, now: 2000 };
}

// ---------------------------------------------------------------------------
// Task 4.1 — SetupComplete (Invariants 2, 15)
// ---------------------------------------------------------------------------

describe('reduce — SetupComplete (Invariant 2)', () => {
  it('transitions setup → round_active and installs deal correctly', () => {
    const session = makeSession();
    const event = makeSetupCompleteEvent();
    const out = reduce(session, event);

    expect(out.status).toBe('round_active');
    expect(out.player.hand).toHaveLength(5);
    expect(out.ai.hand).toHaveLength(5);
    expect(out.deck).toHaveLength(10);
    expect(out.rounds).toHaveLength(1);
    expect(out.currentRoundIdx).toBe(0);

    const round = out.rounds[0];
    expect(round.pile).toEqual([]);
    expect(round.status).toBe('claim_phase');
    expect(round.targetRank).toBe('Queen');
    expect(round.roundNumber).toBe(1);
    expect(['Queen', 'King', 'Ace', 'Jack']).toContain(round.targetRank);
  });

  it('both takenCards remain []', () => {
    const out = reduce(makeSession(), makeSetupCompleteEvent());
    expect(out.player.takenCards).toEqual([]);
    expect(out.ai.takenCards).toEqual([]);
  });

  it('installs musicTracks on session', () => {
    const out = reduce(makeSession(), makeSetupCompleteEvent());
    expect(out.musicTracks).toHaveLength(3);
  });

  it('preserves other PlayerState fields (strikes, roundsWon, jokers)', () => {
    const session = makeSession({
      player: makePlayer({ strikes: 1, roundsWon: 1, jokers: ['poker_face'] }),
    });
    const out = reduce(session, makeSetupCompleteEvent());
    expect(out.player.strikes).toBe(1);
    expect(out.player.roundsWon).toBe(1);
    expect(out.player.jokers).toEqual(['poker_face']);
  });

  it('throws when session.status !== setup (Invariant 15)', () => {
    const session = makeSession({ status: 'round_active', rounds: [makeRound()] });
    expect(() => reduce(session, makeSetupCompleteEvent())).toThrow(InvalidTransitionError);
  });

  it('throws for any event when session_over (Invariant 15 terminal guard)', () => {
    const session = makeSession({ status: 'session_over' });
    expect(() => reduce(session, makeSetupCompleteEvent())).toThrow(InvalidTransitionError);
  });

  it('throws when playerHand.length !== 5', () => {
    const event = makeSetupCompleteEvent({
      initialDeal: { ...makeInitialDeal(), playerHand: [makeCard('Queen', 0)] },
    });
    expect(() => reduce(makeSession(), event)).toThrow(InvalidTransitionError);
  });

  it('throws when aiHand.length !== 5', () => {
    const event = makeSetupCompleteEvent({
      initialDeal: { ...makeInitialDeal(), aiHand: [makeCard('King', 0)] },
    });
    expect(() => reduce(makeSession(), event)).toThrow(InvalidTransitionError);
  });

  it('throws when remainingDeck.length !== 10', () => {
    const event = makeSetupCompleteEvent({
      initialDeal: { ...makeInitialDeal(), remainingDeck: [] },
    });
    expect(() => reduce(makeSession(), event)).toThrow(InvalidTransitionError);
  });

  it('throws when musicTracks.length !== 3', () => {
    const event = makeSetupCompleteEvent({
      musicTracks: [{ level: 'calm', url: 'calm.mp3' }],
    });
    expect(() => reduce(makeSession(), event)).toThrow(InvalidTransitionError);
  });

  it('does not mutate input session', () => {
    const session = makeSession();
    const before = JSON.stringify(session);
    reduce(session, makeSetupCompleteEvent());
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 4.2 — ClaimMade (Invariants 3, 5, 8, 15)
// ---------------------------------------------------------------------------

describe('reduce — ClaimMade', () => {
  /** Build a session already in round_active / claim_phase with player's Queens */
  function makeActiveSession() {
    const session = makeSession();
    return reduce(session, makeSetupCompleteEvent());
  }

  it('sanity: active hand loses played cards, pile gains them, status → response_phase', () => {
    const session = makeActiveSession();
    const out = reduce(session, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }));

    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('response_phase');
    expect(round.pile).toHaveLength(1);
    expect(round.pile[0].id).toBe('Queen-0');
    expect(out.player.hand).toHaveLength(4);
    expect(out.player.hand.find((c) => c.id === 'Queen-0')).toBeUndefined();
  });

  it('claim is appended last in claimHistory', () => {
    const session = makeActiveSession();
    const out = reduce(session, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }));
    const round = out.rounds[out.currentRoundIdx];
    expect(round.claimHistory).toHaveLength(1);
    expect(round.claimHistory[0].actualCardIds).toEqual(['Queen-0']);
  });

  it('can play 2 cards (count=2)', () => {
    const session = makeActiveSession();
    const out = reduce(session, makeClaimEvent({ count: 2, actualCardIds: ['Queen-0', 'Queen-1'] }));
    expect(out.rounds[out.currentRoundIdx].pile).toHaveLength(2);
    expect(out.player.hand).toHaveLength(3);
  });

  // Invariant 5 — truth derivation
  it('Invariant 5: honest when all played cards match claimedRank', () => {
    const session = makeActiveSession();
    // Player has Queens; claim Queen — honest
    const out = reduce(session, makeClaimEvent({ count: 2, claimedRank: 'Queen', actualCardIds: ['Queen-0', 'Queen-1'], truthState: 'lying' /* caller lie; reducer overwrites */ }));
    expect(out.rounds[out.currentRoundIdx].claimHistory[0].truthState).toBe('honest');
  });

  it('Invariant 5: lying when any played card does not match claimedRank', () => {
    // Player has Queens; claim Kings → lying
    const session = makeActiveSession();
    const out = reduce(session, makeClaimEvent({ count: 1, claimedRank: 'King', actualCardIds: ['Queen-0'], truthState: 'honest' /* caller lie; reducer overwrites */ }));
    expect(out.rounds[out.currentRoundIdx].claimHistory[0].truthState).toBe('lying');
  });

  // Invariant 8 — forced lie accepted without error
  it('Invariant 8: forced-lie accepted without error, truthState === lying', () => {
    // AI hand has only Kings; target is Queen; claim 1 Queen but play King
    const session = makeSession({
      status: 'round_active',
      rounds: [
        makeRound({
          activePlayer: 'ai',
          targetRank: 'Queen',
          status: 'claim_phase',
        }),
      ],
      ai: makePlayer({
        hand: [makeCard('King', 0), makeCard('King', 1)],
      }),
    });
    const event: GameEvent = {
      type: 'ClaimMade',
      now: 1000,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['King-0'],
        truthState: 'honest', // should be overwritten
        timestamp: 1000,
      },
    };
    const out = reduce(session, event);
    const round = out.rounds[out.currentRoundIdx];
    expect(round.claimHistory[0].truthState).toBe('lying');
    expect(round.status).toBe('response_phase');
  });

  // Invariant 3 — claim validation
  it('Invariant 3: throws when actualCardIds.length !== count', () => {
    const session = makeActiveSession();
    expect(() =>
      reduce(session, makeClaimEvent({ count: 2, actualCardIds: ['Queen-0'] }))
    ).toThrow(InvalidTransitionError);
  });

  it('Invariant 3: throws when a card ID is not in active player hand', () => {
    const session = makeActiveSession();
    expect(() =>
      reduce(session, makeClaimEvent({ count: 1, actualCardIds: ['Ghost-99'] }))
    ).toThrow(InvalidTransitionError);
  });

  // Invariant 15 — invalid transitions
  it('Invariant 15: throws when round.status === response_phase', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'response_phase' })],
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    expect(() =>
      reduce(session, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }))
    ).toThrow(InvalidTransitionError);
  });

  it('Invariant 15: throws when session.status === session_over', () => {
    const session = makeSession({ status: 'session_over' });
    expect(() => reduce(session, makeClaimEvent())).toThrow(InvalidTransitionError);
  });

  it('does not mutate input session', () => {
    const session = makeActiveSession();
    const before = JSON.stringify(session);
    reduce(session, makeClaimEvent());
    expect(JSON.stringify(session)).toBe(before);
  });

  it('reducer is pure — same inputs produce equal outputs', () => {
    const session = makeActiveSession();
    const event = makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] });
    const out1 = reduce(session, event);
    const out2 = reduce(session, event);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });
});
