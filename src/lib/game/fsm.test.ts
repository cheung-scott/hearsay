import { describe, it, expect } from 'vitest';
import type { Card, Claim, GameEvent, JokerType, PlayerState, Round, Session } from './types';
import { InvalidTransitionError } from './types';
import {
  applyJokerEffect,
  checkRoundEnd,
  checkSessionEnd,
  expireJokerEffects,
  reduce,
} from './fsm';

// ---------------------------------------------------------------------------
// mulberry32 — deterministic seeded PRNG (inline helper for integration tests)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  it('Invariant 3 + 4: throws on duplicate actualCardIds (would break card conservation)', () => {
    const session = makeActiveSession();
    expect(() =>
      reduce(
        session,
        makeClaimEvent({ count: 2, actualCardIds: ['Queen-0', 'Queen-0'] }),
      ),
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

// ---------------------------------------------------------------------------
// Task 5 helpers — shared factories
// ---------------------------------------------------------------------------

/**
 * Build a full 20-card set: 5 of each rank.
 * IDs follow the convention `${rank}-${i}`.
 */
function make20Cards() {
  const ranks: Card['rank'][] = ['Queen', 'King', 'Ace', 'Jack'];
  const cards: Card[] = [];
  for (const rank of ranks) {
    for (let i = 0; i < 5; i++) {
      cards.push({ id: `${rank}-${i}`, rank });
    }
  }
  return cards;
}

/** Count total cards across all six pools (Invariant 4). */
function countAllCards(session: Session): number {
  const round = session.rounds[session.currentRoundIdx];
  return (
    session.deck.length +
    session.player.hand.length +
    session.ai.hand.length +
    (round?.pile.length ?? 0) +
    session.player.takenCards.length +
    session.ai.takenCards.length
  );
}

/** Collect all card IDs across the six pools for uniqueness check (Invariant 4). */
function collectAllCardIds(session: Session): string[] {
  const round = session.rounds[session.currentRoundIdx];
  return [
    ...session.deck.map((c) => c.id),
    ...session.player.hand.map((c) => c.id),
    ...session.ai.hand.map((c) => c.id),
    ...(round?.pile.map((c) => c.id) ?? []),
    ...session.player.takenCards.map((c) => c.id),
    ...session.ai.takenCards.map((c) => c.id),
  ];
}

/**
 * Build a session already in `response_phase` with a specific pile + claimHistory.
 * Player has played their first card (honest claim) from a known 20-card set.
 */
function makeSessionInResponsePhase({
  activePlayer = 'player' as 'player' | 'ai',
  playerHand,
  aiHand,
  deck,
  pile,
  lastClaim,
  playerStrikes = 0,
  aiStrikes = 0,
  playerTakenCards = [] as Card[],
  aiTakenCards = [] as Card[],
}: {
  activePlayer?: 'player' | 'ai';
  playerHand: Card[];
  aiHand: Card[];
  deck: Card[];
  pile: Card[];
  lastClaim: Claim;
  playerStrikes?: number;
  aiStrikes?: number;
  playerTakenCards?: Card[];
  aiTakenCards?: Card[];
}): Session {
  const round = makeRound({
    activePlayer,
    status: 'response_phase',
    pile,
    claimHistory: [lastClaim],
  });
  return makeSession({
    status: 'round_active',
    deck,
    rounds: [round],
    currentRoundIdx: 0,
    player: makePlayer({ hand: playerHand, strikes: playerStrikes, takenCards: playerTakenCards }),
    ai: makePlayer({ hand: aiHand, strikes: aiStrikes, takenCards: aiTakenCards }),
  });
}

/** Build a session in `resolving` phase. */
function makeSessionInResolvingPhase(opts: {
  activePlayer?: 'player' | 'ai';
  playerHand: Card[];
  aiHand: Card[];
  deck: Card[];
  pile: Card[];
  lastClaim: Claim;
  playerStrikes?: number;
  aiStrikes?: number;
  playerTakenCards?: Card[];
  aiTakenCards?: Card[];
}): Session {
  const s = makeSessionInResponsePhase(opts);
  return reduce(s, { type: 'ChallengeCalled', now: 3000 });
}

function makeClaimFor(by: 'player' | 'ai', cardIds: string[], honest: boolean): Claim {
  return {
    by,
    count: cardIds.length,
    claimedRank: 'Queen',
    actualCardIds: cardIds,
    truthState: honest ? 'honest' : 'lying',
    timestamp: 2000,
  };
}

// ---------------------------------------------------------------------------
// Task 5.1 — ClaimAccepted
// ---------------------------------------------------------------------------

describe('reduce — ClaimAccepted (5.1)', () => {
  it('sanity: hand non-empty → swaps active player, status claim_phase', () => {
    // Player has 4 cards remaining after playing one (pile has 1)
    const all = make20Cards();
    const playerHand = all.slice(0, 4);  // Queen-0..3
    const aiHand = all.slice(5, 10);     // King-0..4
    const deck = all.slice(10, 20);      // Ace-0..4, Jack-0..4
    const pile = [all[4]];               // Queen-4 was played
    const claim = makeClaimFor('player', ['Queen-4'], true);

    const session = makeSessionInResponsePhase({
      activePlayer: 'player',
      playerHand,
      aiHand,
      deck,
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'ClaimAccepted', now: 3000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('claim_phase');
    expect(round.activePlayer).toBe('ai'); // swapped
    expect(out.player.hand).toHaveLength(4);
    expect(out.ai.hand).toHaveLength(5);
  });

  it('hand empty after accepted claim → round_over, winner is claimant (active)', () => {
    // Player played their LAST card (hand now empty)
    const all = make20Cards();
    const playerHand: Card[] = [];      // already empty — last card in pile
    const aiHand = all.slice(5, 10);
    const deck = all.slice(10, 20);
    const pile = [all[0]];             // Queen-0 in pile
    const claim = makeClaimFor('player', ['Queen-0'], true);

    const session = makeSessionInResponsePhase({
      activePlayer: 'player',
      playerHand,
      aiHand,
      deck,
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'ClaimAccepted', now: 3000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('round_over');
    expect(round.winner).toBe('player');
  });

  it('throws when round.status === claim_phase (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'ClaimAccepted', now: 3000 })).toThrow(InvalidTransitionError);
  });

  it('throws when round.status === resolving (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'resolving' })],
    });
    expect(() => reduce(session, { type: 'ClaimAccepted', now: 3000 })).toThrow(InvalidTransitionError);
  });

  it('does not mutate input', () => {
    const all = make20Cards();
    const claim = makeClaimFor('player', ['Queen-4'], true);
    const session = makeSessionInResponsePhase({
      playerHand: all.slice(0, 4),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile: [all[4]],
      lastClaim: claim,
    });
    const before = JSON.stringify(session);
    reduce(session, { type: 'ClaimAccepted', now: 3000 });
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 5.2 — ChallengeCalled
// ---------------------------------------------------------------------------

describe('reduce — ChallengeCalled (5.2)', () => {
  it('transitions response_phase → resolving', () => {
    const all = make20Cards();
    const claim = makeClaimFor('player', ['Queen-4'], false);
    const session = makeSessionInResponsePhase({
      playerHand: all.slice(0, 4),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile: [all[4]],
      lastClaim: claim,
    });
    const out = reduce(session, { type: 'ChallengeCalled', now: 3000 });
    expect(out.rounds[out.currentRoundIdx].status).toBe('resolving');
  });

  it('throws when round.status === claim_phase (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'ChallengeCalled', now: 3000 })).toThrow(InvalidTransitionError);
  });

  it('throws when round.status === resolving (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'resolving' })],
    });
    expect(() => reduce(session, { type: 'ChallengeCalled', now: 3000 })).toThrow(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Task 5.3 — RevealComplete
// ---------------------------------------------------------------------------

describe('reduce — RevealComplete (5.3)', () => {
  it('throws when round.status === claim_phase (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 })).toThrow(InvalidTransitionError);
  });

  it('throws when round.status === response_phase (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'response_phase' })],
    });
    expect(() => reduce(session, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 })).toThrow(InvalidTransitionError);
  });

  it('else-branch: challengeWasCorrect=true, hand non-empty → claimant struck, pile cleared, swap active, claim_phase', () => {
    // Player (active) played a lying claim; AI challenged correctly; player hand still has cards
    const all = make20Cards();
    const pile = [all[0]]; // Queen-0 played by player
    const claim = makeClaimFor('player', ['Queen-0'], false); // lying
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),   // 4 cards remain
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('claim_phase');
    expect(round.activePlayer).toBe('ai'); // swapped
    expect(round.pile).toEqual([]);
    expect(out.player.strikes).toBe(1);   // claimant punished
    expect(out.ai.strikes).toBe(0);
    expect(out.player.takenCards).toHaveLength(1);
    expect(out.ai.takenCards).toHaveLength(0);
  });

  it('else-branch: challengeWasCorrect=false, hand non-empty → challenger struck, pile cleared, swap active, claim_phase', () => {
    // Player (active) played honestly; AI challenged wrongly; player hand has cards
    const all = make20Cards();
    const pile = [all[0]];
    const claim = makeClaimFor('player', ['Queen-0'], true); // honest
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('claim_phase');
    expect(round.activePlayer).toBe('ai'); // swapped (same: ai was challenger, now their turn)
    expect(round.pile).toEqual([]);
    expect(out.ai.strikes).toBe(1);    // challenger (ai) punished
    expect(out.player.strikes).toBe(0);
    expect(out.ai.takenCards).toHaveLength(1);
    expect(out.player.takenCards).toHaveLength(0);
  });

  // Invariant 6: Caught-on-final-card-lie → opponent wins round
  it('Invariant 6: caught-on-final-card-lie → round_over, opponent wins, active strikes+1, pile → active.takenCards', () => {
    const all = make20Cards();
    const pile = [all[0]]; // Queen-0 was the final (only) card played by player
    const claim = makeClaimFor('player', ['Queen-0'], false); // lying claim
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: [],          // hand NOW empty (played last card)
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('round_over');
    expect(round.winner).toBe('ai');       // opponent wins
    expect(round.pile).toEqual([]);
    expect(out.player.strikes).toBe(1);   // active (liar) struck
    expect(out.player.takenCards).toEqual([all[0]]); // pile → active.takenCards
    expect(out.ai.takenCards).toHaveLength(0);
  });

  // Invariant 7: Honest-final-wrongly-challenged → active wins round
  it('Invariant 7: honest-final-wrongly-challenged → round_over, active wins, challenger strikes+1, pile → challenger.takenCards', () => {
    const all = make20Cards();
    const pile = [all[0]]; // Queen-0 was the final honest card played by player
    const claim = makeClaimFor('player', ['Queen-0'], true); // honest claim
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: [],          // hand empty — last card in pile
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('round_over');
    expect(round.winner).toBe('player');   // active wins
    expect(round.pile).toEqual([]);
    expect(out.ai.strikes).toBe(1);        // challenger (ai) struck
    expect(out.ai.takenCards).toEqual([all[0]]); // pile → challenger.takenCards
    expect(out.player.takenCards).toHaveLength(0);
  });

  // Invariant 9: exactly ONE player's strikes increment per resolution
  it('Invariant 9: exactly one player strikes+1 per RevealComplete (challengeWasCorrect=true)', () => {
    const all = make20Cards();
    const pile = [all[0]];
    const claim = makeClaimFor('player', ['Queen-0'], false);
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });
    const before = { p: session.player.strikes, ai: session.ai.strikes };
    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 });
    const delta = (out.player.strikes - before.p) + (out.ai.strikes - before.ai);
    expect(delta).toBe(1);
  });

  it('Invariant 9: exactly one player strikes+1 per RevealComplete (challengeWasCorrect=false)', () => {
    const all = make20Cards();
    const pile = [all[0]];
    const claim = makeClaimFor('player', ['Queen-0'], true);
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });
    const before = { p: session.player.strikes, ai: session.ai.strikes };
    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    const delta = (out.player.strikes - before.p) + (out.ai.strikes - before.ai);
    expect(delta).toBe(1);
  });

  // Invariant 10: session-end when strikes reach 3
  it('Invariant 10: loser reaching strikes=3 → session_over, correct winner, round_over consistent', () => {
    const all = make20Cards();
    const pile = [all[0]];
    const claim = makeClaimFor('player', ['Queen-0'], false); // lying → player gets strike
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
      playerStrikes: 2, // one more → 3 → session_over
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 });
    expect(out.status).toBe('session_over');
    expect(out.sessionWinner).toBe('ai');
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('round_over');
    expect(round.winner).toBe('ai');
    expect(out.player.strikes).toBe(3);
  });

  it('Invariant 10: ai reaching strikes=3 → session_over, player wins', () => {
    const all = make20Cards();
    const pile = [all[0]];
    // Player is active, claim was honest → ai (challenger) loses → ai gets strike → ai at 3
    const claim = makeClaimFor('player', ['Queen-0'], true); // honest → challenger (ai) gets strike
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
      aiStrikes: 2,
    });

    const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    expect(out.status).toBe('session_over');
    expect(out.sessionWinner).toBe('player');
    expect(out.ai.strikes).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Task 5.4 — Invariant 4: Card conservation across full cycle
// ---------------------------------------------------------------------------

describe('Invariant 4: Card conservation through a challenge cycle', () => {
  /**
   * Full cycle: SetupComplete → ClaimMade → ChallengeCalled → RevealComplete(correct)
   * Assert 20 cards accounted for at each step.
   */
  it('20 cards conserved through SetupComplete→ClaimMade→ChallengeCalled→RevealComplete(true)', () => {
    // Build a known 20-card session via SetupComplete
    const all = make20Cards(); // 5Q 5K 5A 5J
    const initialDeal = {
      playerHand: all.slice(0, 5),   // Queen-0..4
      aiHand: all.slice(5, 10),      // King-0..4
      remainingDeck: all.slice(10, 20), // Ace+Jack
      targetRank: 'Queen' as const,
      activePlayer: 'player' as const,
    };
    const musicTracks: Session['musicTracks'] = [
      { level: 'calm', url: 'c.mp3' },
      { level: 'tense', url: 't.mp3' },
      { level: 'critical', url: 'cr.mp3' },
    ];

    const s0 = makeSession();
    const s1 = reduce(s0, { type: 'SetupComplete', now: 1000, initialDeal, musicTracks });
    expect(countAllCards(s1)).toBe(20);

    // Player plays Queen-0 (lying: claims King)
    const s2 = reduce(s1, {
      type: 'ClaimMade',
      now: 2000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'King',
        actualCardIds: ['Queen-0'],
        truthState: 'honest',
        timestamp: 2000,
      },
    });
    expect(countAllCards(s2)).toBe(20);

    const s3 = reduce(s2, { type: 'ChallengeCalled', now: 3000 });
    expect(countAllCards(s3)).toBe(20);

    // challengeWasCorrect=true → claimant (player) struck + gets pile
    const s4 = reduce(s3, { type: 'RevealComplete', challengeWasCorrect: true, now: 4000 });
    expect(countAllCards(s4)).toBe(20);

    // Verify uniqueness — no duplicates
    const ids = collectAllCardIds(s4);
    expect(new Set(ids).size).toBe(20);
  });

  it('20 cards conserved through SetupComplete→ClaimMade→ChallengeCalled→RevealComplete(false)', () => {
    const all = make20Cards();
    const initialDeal = {
      playerHand: all.slice(0, 5),
      aiHand: all.slice(5, 10),
      remainingDeck: all.slice(10, 20),
      targetRank: 'Queen' as const,
      activePlayer: 'player' as const,
    };
    const musicTracks: Session['musicTracks'] = [
      { level: 'calm', url: 'c.mp3' },
      { level: 'tense', url: 't.mp3' },
      { level: 'critical', url: 'cr.mp3' },
    ];

    const s1 = reduce(makeSession(), { type: 'SetupComplete', now: 1000, initialDeal, musicTracks });
    expect(countAllCards(s1)).toBe(20);

    // Player plays Queen-0 honestly
    const s2 = reduce(s1, {
      type: 'ClaimMade',
      now: 2000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-0'],
        truthState: 'honest',
        timestamp: 2000,
      },
    });
    expect(countAllCards(s2)).toBe(20);

    const s3 = reduce(s2, { type: 'ChallengeCalled', now: 3000 });
    expect(countAllCards(s3)).toBe(20);

    // challengeWasCorrect=false → challenger (ai) struck + gets pile
    const s4 = reduce(s3, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    expect(countAllCards(s4)).toBe(20);

    const ids = collectAllCardIds(s4);
    expect(new Set(ids).size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Task 7 — RoundSettled, JokerPicked, JokerOfferSkippedSessionOver
// ---------------------------------------------------------------------------

/** Build a session already in joker_offer with round_over round, ready to settle. */
function makeJokerOfferSession({
  roundWinner = 'player' as 'player' | 'ai',
  playerRoundsWon = 1,
  aiRoundsWon = 0,
  playerStrikes = 0,
  aiStrikes = 0,
  playerJokers = [] as import('./types').JokerType[],
  aiJokers = [] as import('./types').JokerType[],
  playerTakenCards = [] as Card[],
  aiTakenCards = [] as Card[],
  roundPile = [] as Card[],
} = {}): Session {
  const round = makeRound({
    roundNumber: 1,
    status: 'round_over',
    winner: roundWinner,
    pile: roundPile,
  });
  return makeSession({
    status: 'joker_offer',
    rounds: [round],
    currentRoundIdx: 0,
    player: makePlayer({
      roundsWon: playerRoundsWon,
      strikes: playerStrikes,
      jokers: playerJokers,
      takenCards: playerTakenCards,
    }),
    ai: makePlayer({
      roundsWon: aiRoundsWon,
      strikes: aiStrikes,
      jokers: aiJokers,
      takenCards: aiTakenCards,
    }),
  });
}

/** A valid nextRoundDeal for JokerPicked — fresh 5/5 hands + 10-card deck. */
function makeNextRoundDeal(overrides: Partial<import('./types').RoundDeal> = {}): import('./types').RoundDeal {
  return {
    playerHand: [0, 1, 2, 3, 4].map((i) => makeCard('King', i)),
    aiHand: [0, 1, 2, 3, 4].map((i) => makeCard('Ace', i)),
    remainingDeck: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => makeCard('Jack', i)),
    targetRank: 'King' as const,
    activePlayer: 'ai' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 7.1 — RoundSettled
// ---------------------------------------------------------------------------

describe('reduce — RoundSettled (7.1)', () => {
  it('Invariant 11: player roundsWon reaches 2 → session_over, player wins', () => {
    // Build a session where the round just ended with player winning, player has 1 roundsWon already.
    // RoundSettled increments to 2 → session_over.
    const round = makeRound({ roundNumber: 1, status: 'round_over', winner: 'player' });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      currentRoundIdx: 0,
      player: makePlayer({ roundsWon: 1 }),
      ai: makePlayer({ roundsWon: 0 }),
    });

    const out = reduce(session, { type: 'RoundSettled', now: 5000 });
    expect(out.player.roundsWon).toBe(2);
    expect(out.status).toBe('session_over');
    expect(out.sessionWinner).toBe('player');
  });

  it('ai roundsWon reaches 2 → session_over, ai wins', () => {
    const round = makeRound({ roundNumber: 2, status: 'round_over', winner: 'ai' });
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ roundNumber: 1, status: 'round_over', winner: 'ai' }), round],
      currentRoundIdx: 1,
      player: makePlayer({ roundsWon: 0 }),
      ai: makePlayer({ roundsWon: 1 }),
    });

    const out = reduce(session, { type: 'RoundSettled', now: 5000 });
    expect(out.ai.roundsWon).toBe(2);
    expect(out.status).toBe('session_over');
    expect(out.sessionWinner).toBe('ai');
  });

  it('winner does not yet reach 2 → joker_offer', () => {
    const round = makeRound({ roundNumber: 1, status: 'round_over', winner: 'player' });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      currentRoundIdx: 0,
      player: makePlayer({ roundsWon: 0 }),
      ai: makePlayer({ roundsWon: 0 }),
    });

    const out = reduce(session, { type: 'RoundSettled', now: 5000 });
    expect(out.player.roundsWon).toBe(1);
    expect(out.status).toBe('joker_offer');
    expect(out.sessionWinner).toBeUndefined();
  });

  it('throws when round.status !== round_over (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'RoundSettled', now: 5000 })).toThrow(InvalidTransitionError);
  });

  it('throws when session.status === session_over (terminal guard)', () => {
    const session = makeSession({ status: 'session_over' });
    expect(() => reduce(session, { type: 'RoundSettled', now: 5000 })).toThrow(InvalidTransitionError);
  });

  it('round stays round_over — reducer does not mutate round status', () => {
    const round = makeRound({ roundNumber: 1, status: 'round_over', winner: 'player' });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      currentRoundIdx: 0,
      player: makePlayer({ roundsWon: 0 }),
    });
    const out = reduce(session, { type: 'RoundSettled', now: 5000 });
    expect(out.rounds[0].status).toBe('round_over');
  });

  it('does not mutate input session', () => {
    const round = makeRound({ roundNumber: 1, status: 'round_over', winner: 'player' });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      currentRoundIdx: 0,
      player: makePlayer({ roundsWon: 0 }),
    });
    const before = JSON.stringify(session);
    reduce(session, { type: 'RoundSettled', now: 5000 });
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 7.2 — JokerPicked
// ---------------------------------------------------------------------------

describe('reduce — JokerPicked (7.2, Invariant 16)', () => {
  it('Invariant 16: both hands length 5, deck.length === 10, takenCards cleared', () => {
    const all = make20Cards();
    const session = makeJokerOfferSession({
      roundWinner: 'player',
      playerRoundsWon: 1,
      playerTakenCards: [all[0], all[1]], // non-empty — should be cleared
      aiTakenCards: [all[5]],             // non-empty — should be cleared
      roundPile: [all[10]],               // non-empty — stays on round (not cleared by JokerPicked)
    });

    const deal = makeNextRoundDeal();
    const out = reduce(session, { type: 'JokerPicked', joker: 'poker_face', nextRoundDeal: deal, now: 6000 });

    expect(out.player.hand).toHaveLength(5);
    expect(out.ai.hand).toHaveLength(5);
    expect(out.deck).toHaveLength(10);
    expect(out.player.takenCards).toEqual([]);
    expect(out.ai.takenCards).toEqual([]);
  });

  it('Invariant 16: new Round appended with correct shape, currentRoundIdx incremented', () => {
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 1 });
    const deal = makeNextRoundDeal({ targetRank: 'Ace', activePlayer: 'player' });
    const out = reduce(session, { type: 'JokerPicked', joker: 'stage_whisper', nextRoundDeal: deal, now: 6000 });

    expect(out.currentRoundIdx).toBe(1);
    expect(out.rounds).toHaveLength(2);

    const newRound = out.rounds[1];
    expect(newRound.roundNumber).toBe(2);
    expect(newRound.targetRank).toBe('Ace');
    expect(newRound.activePlayer).toBe('player');
    expect(newRound.pile).toEqual([]);
    expect(newRound.claimHistory).toEqual([]);
    expect(newRound.status).toBe('claim_phase');
    expect(newRound.activeJokerEffects).toEqual([]);
    expect(newRound.tensionLevel).toBe(0);
  });

  it('Invariant 16: strikes/roundsWon/personaIfAi carried forward unchanged', () => {
    const session = makeJokerOfferSession({
      roundWinner: 'player',
      playerRoundsWon: 1,
      aiRoundsWon: 0,
      playerStrikes: 1,
      aiStrikes: 2,
    });
    const out = reduce(session, { type: 'JokerPicked', joker: 'earful', nextRoundDeal: makeNextRoundDeal(), now: 6000 });

    expect(out.player.strikes).toBe(1);
    expect(out.ai.strikes).toBe(2);
    expect(out.player.roundsWon).toBe(1);
    expect(out.ai.roundsWon).toBe(0);
  });

  it('Invariant 16: new joker appended to winner jokers array', () => {
    const session = makeJokerOfferSession({
      roundWinner: 'player',
      playerJokers: ['cold_read'],
    });
    const out = reduce(session, { type: 'JokerPicked', joker: 'poker_face', nextRoundDeal: makeNextRoundDeal(), now: 6000 });
    expect(out.player.jokers).toEqual(['cold_read', 'poker_face']);
    expect(out.ai.jokers).toEqual([]); // loser unchanged
  });

  it('Invariant 16: joker goes to ai winner when ai won the round', () => {
    const session = makeJokerOfferSession({
      roundWinner: 'ai',
      aiJokers: ['stage_whisper'],
    });
    const out = reduce(session, { type: 'JokerPicked', joker: 'earful', nextRoundDeal: makeNextRoundDeal(), now: 6000 });
    expect(out.ai.jokers).toEqual(['stage_whisper', 'earful']);
    expect(out.player.jokers).toEqual([]);
  });

  it('session.status → round_active', () => {
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 1 });
    const out = reduce(session, { type: 'JokerPicked', joker: 'second_wind', nextRoundDeal: makeNextRoundDeal(), now: 6000 });
    expect(out.status).toBe('round_active');
  });

  it('JokerPicked is deterministic — identical event twice yields structurally equal Session (Invariant 14)', () => {
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 1 });
    const deal = makeNextRoundDeal();
    const event: GameEvent = { type: 'JokerPicked', joker: 'poker_face', nextRoundDeal: deal, now: 6000 };
    const out1 = reduce(session, event);
    const out2 = reduce(session, event);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it('throws when session.status !== joker_offer (Invariant 15)', () => {
    const session = makeSession({ status: 'round_active', rounds: [makeRound()] });
    expect(() =>
      reduce(session, { type: 'JokerPicked', joker: 'poker_face', nextRoundDeal: makeNextRoundDeal(), now: 6000 })
    ).toThrow(InvalidTransitionError);
  });

  it('does not mutate input session', () => {
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 1 });
    const before = JSON.stringify(session);
    reduce(session, { type: 'JokerPicked', joker: 'cold_read', nextRoundDeal: makeNextRoundDeal(), now: 6000 });
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 7.2 — JokerOfferSkippedSessionOver
// ---------------------------------------------------------------------------

describe('reduce — JokerOfferSkippedSessionOver (7.2)', () => {
  it('transitions joker_offer → session_over', () => {
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 1 });
    const out = reduce(session, { type: 'JokerOfferSkippedSessionOver', now: 7000 });
    expect(out.status).toBe('session_over');
  });

  it('sets sessionWinner from checkSessionEnd when available', () => {
    // Player has 2 roundsWon — should be detected as winner
    const session = makeJokerOfferSession({ roundWinner: 'player', playerRoundsWon: 2 });
    const out = reduce(session, { type: 'JokerOfferSkippedSessionOver', now: 7000 });
    expect(out.status).toBe('session_over');
    expect(out.sessionWinner).toBe('player');
  });

  it('throws when session.status !== joker_offer (Invariant 15)', () => {
    const session = makeSession({ status: 'round_active', rounds: [makeRound()] });
    expect(() =>
      reduce(session, { type: 'JokerOfferSkippedSessionOver', now: 7000 })
    ).toThrow(InvalidTransitionError);
  });

  it('throws when session.status === session_over (Invariant 15 terminal guard)', () => {
    const session = makeSession({ status: 'session_over' });
    expect(() =>
      reduce(session, { type: 'JokerOfferSkippedSessionOver', now: 7000 })
    ).toThrow(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Task 8.2 — Timeout handling
// ---------------------------------------------------------------------------

describe('reduce — Timeout (active_player)', () => {
  /** Session in round_active / claim_phase. Player has a Queen and a King. */
  function makeClaimPhaseSession() {
    const queenCard: Card = { id: 'Queen-0', rank: 'Queen' };
    const kingCard: Card = { id: 'King-0', rank: 'King' };
    const round = makeRound({ targetRank: 'Queen', activePlayer: 'player', status: 'claim_phase' });
    return makeSession({
      status: 'round_active',
      player: makePlayer({ hand: [queenCard, kingCard] }),
      ai: makePlayer({ hand: [makeCard('King', 1)] }),
      rounds: [round],
      currentRoundIdx: 0,
    });
  }

  it('consumes cardIdToPlay from active hand and moves card to pile', () => {
    const session = makeClaimPhaseSession();
    const out = reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 });
    expect(out.player.hand.find((c) => c.id === 'Queen-0')).toBeUndefined();
    expect(out.player.hand).toHaveLength(1);
    const round = out.rounds[out.currentRoundIdx];
    expect(round.pile.some((c) => c.id === 'Queen-0')).toBe(true);
  });

  it('generates a 1-card claim with count=1, claimedRank=targetRank, actualCardIds=[cardIdToPlay]', () => {
    const session = makeClaimPhaseSession();
    const out = reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.claimHistory).toHaveLength(1);
    const claim = round.claimHistory[0];
    expect(claim.count).toBe(1);
    expect(claim.claimedRank).toBe('Queen');
    expect(claim.actualCardIds).toEqual(['Queen-0']);
    expect(claim.by).toBe('player');
    expect(claim.timestamp).toBe(9000);
  });

  it('truthState is honest when cardIdToPlay rank matches targetRank', () => {
    const session = makeClaimPhaseSession(); // Queen-0 rank=Queen, targetRank=Queen
    const out = reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 });
    const claim = out.rounds[out.currentRoundIdx].claimHistory[0];
    expect(claim.truthState).toBe('honest');
  });

  it('truthState is lying when cardIdToPlay rank does NOT match targetRank', () => {
    const session = makeClaimPhaseSession(); // King-0 rank=King, targetRank=Queen
    const out = reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'King-0', now: 9000 });
    const claim = out.rounds[out.currentRoundIdx].claimHistory[0];
    expect(claim.truthState).toBe('lying');
  });

  it('round transitions to response_phase after active_player timeout', () => {
    const session = makeClaimPhaseSession();
    const out = reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 });
    expect(out.rounds[out.currentRoundIdx].status).toBe('response_phase');
  });

  it('purity — same Timeout event twice yields structurally-equal Session', () => {
    const session = makeClaimPhaseSession();
    const event: GameEvent = { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 };
    expect(JSON.stringify(reduce(session, event))).toBe(JSON.stringify(reduce(session, event)));
  });

  it('throws when round.status !== claim_phase', () => {
    const session = makeClaimPhaseSession();
    const inResponsePhase = makeSession({
      ...session,
      rounds: [makeRound({ status: 'response_phase' })],
    });
    expect(() =>
      reduce(inResponsePhase, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 })
    ).toThrow(InvalidTransitionError);
  });

  it('throws when cardIdToPlay is not in active hand', () => {
    const session = makeClaimPhaseSession();
    expect(() =>
      reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'nonexistent-card', now: 9000 })
    ).toThrow(InvalidTransitionError);
  });

  it('does not mutate input session', () => {
    const session = makeClaimPhaseSession();
    const before = JSON.stringify(session);
    reduce(session, { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 });
    expect(JSON.stringify(session)).toBe(before);
  });
});

describe('reduce — Timeout (responder)', () => {
  /** Session in round_active / response_phase — active player has cards remaining */
  function makeResponsePhaseSession(activeHandSize = 2) {
    const cards = Array.from({ length: activeHandSize }, (_, i) => makeCard('Queen', i));
    const round = makeRound({ targetRank: 'Queen', activePlayer: 'player', status: 'response_phase' });
    return makeSession({
      status: 'round_active',
      player: makePlayer({ hand: cards }),
      ai: makePlayer({ hand: [makeCard('King', 0)] }),
      rounds: [round],
      currentRoundIdx: 0,
    });
  }

  it('behaves as ClaimAccepted — swaps active player when hand non-empty', () => {
    const session = makeResponsePhaseSession(2);
    const out = reduce(session, { type: 'Timeout', kind: 'responder', now: 9100 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('claim_phase');
    expect(round.activePlayer).toBe('ai');
  });

  it('behaves as ClaimAccepted — round ends when active hand is empty', () => {
    const session = makeResponsePhaseSession(0);
    const out = reduce(session, { type: 'Timeout', kind: 'responder', now: 9100 });
    const round = out.rounds[out.currentRoundIdx];
    expect(round.status).toBe('round_over');
    expect(round.winner).toBe('player');
  });

  it('purity — same responder Timeout twice yields structurally-equal Session', () => {
    const session = makeResponsePhaseSession(2);
    const event: GameEvent = { type: 'Timeout', kind: 'responder', now: 9100 };
    expect(JSON.stringify(reduce(session, event))).toBe(JSON.stringify(reduce(session, event)));
  });

  it('throws when round.status !== response_phase', () => {
    const session = makeResponsePhaseSession(2);
    const inClaimPhase = makeSession({
      ...session,
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() =>
      reduce(inClaimPhase, { type: 'Timeout', kind: 'responder', now: 9100 })
    ).toThrow(InvalidTransitionError);
  });

  it('does not mutate input session', () => {
    const session = makeResponsePhaseSession(2);
    const before = JSON.stringify(session);
    reduce(session, { type: 'Timeout', kind: 'responder', now: 9100 });
    expect(JSON.stringify(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Task 11.1 — Reducer purity (Invariant 14)
// ---------------------------------------------------------------------------

describe('Invariant 14: Reducer purity', () => {
  it('SetupComplete called twice with identical inputs → structurally equal outputs', () => {
    const session = makeSession();
    const event = makeSetupCompleteEvent();
    const out1 = reduce(session, event);
    const out2 = reduce(session, event);
    expect(out1).toEqual(out2);
  });

  it('ClaimMade called twice with identical inputs → structurally equal outputs', () => {
    const session = reduce(makeSession(), makeSetupCompleteEvent());
    const event = makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] });
    const out1 = reduce(session, event);
    const out2 = reduce(session, event);
    expect(out1).toEqual(out2);
  });

  it('Timeout(active_player) called twice → identical output (Invariant 14 specific clause)', () => {
    const queenCard: Card = { id: 'Queen-0', rank: 'Queen' };
    const round = makeRound({ targetRank: 'Queen', activePlayer: 'player', status: 'claim_phase' });
    const session = makeSession({
      status: 'round_active',
      player: makePlayer({ hand: [queenCard, makeCard('King', 0)] }),
      ai: makePlayer({ hand: [makeCard('King', 1)] }),
      rounds: [round],
      currentRoundIdx: 0,
    });
    const event: GameEvent = { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 9000 };
    const out1 = reduce(session, event);
    const out2 = reduce(session, event);
    expect(out1).toEqual(out2);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
  });

  it('full claim→accept cycle: reduce called twice from same start → equal', () => {
    const s0 = reduce(makeSession(), makeSetupCompleteEvent());
    const s1 = reduce(s0, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }));
    const event: GameEvent = { type: 'ClaimAccepted', now: 3000 };
    expect(reduce(s1, event)).toEqual(reduce(s1, event));
  });

  it('input session not mutated after reduce (all event types)', () => {
    // SetupComplete
    const s0 = makeSession();
    const snap0 = JSON.stringify(s0);
    reduce(s0, makeSetupCompleteEvent());
    expect(JSON.stringify(s0)).toBe(snap0);

    // ClaimMade
    const s1 = reduce(makeSession(), makeSetupCompleteEvent());
    const snap1 = JSON.stringify(s1);
    reduce(s1, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }));
    expect(JSON.stringify(s1)).toBe(snap1);

    // ClaimAccepted
    const s2 = reduce(s1, makeClaimEvent({ count: 1, actualCardIds: ['Queen-0'] }));
    const snap2 = JSON.stringify(s2);
    reduce(s2, { type: 'ClaimAccepted', now: 3000 });
    expect(JSON.stringify(s2)).toBe(snap2);
  });
});

// ---------------------------------------------------------------------------
// Task 11.2 — Invalid transition tests (Invariant 15)
// ---------------------------------------------------------------------------

describe('Invariant 15: Invalid transitions', () => {
  // All 10 event types throw when session_over
  const allEventVariants: GameEvent[] = [
    { type: 'SetupComplete', now: 0, initialDeal: makeInitialDeal(), musicTracks: [
        { level: 'calm', url: 'c.mp3' },
        { level: 'tense', url: 't.mp3' },
        { level: 'critical', url: 'cr.mp3' },
      ] },
    { type: 'ClaimMade', now: 0, claim: { by: 'player', count: 1, claimedRank: 'Queen', actualCardIds: ['Queen-0'], truthState: 'honest', timestamp: 0 } },
    { type: 'ClaimAccepted', now: 0 },
    { type: 'ChallengeCalled', now: 0 },
    { type: 'RevealComplete', now: 0, challengeWasCorrect: true },
    { type: 'RoundSettled', now: 0 },
    { type: 'JokerPicked', now: 0, joker: 'poker_face', nextRoundDeal: makeNextRoundDeal() },
    { type: 'JokerOfferSkippedSessionOver', now: 0 },
    { type: 'Timeout', kind: 'active_player', cardIdToPlay: 'Queen-0', now: 0 },
    { type: 'Timeout', kind: 'responder', now: 0 },
  ];

  it('every event type throws InvalidTransitionError when session.status === session_over', () => {
    const terminated = makeSession({ status: 'session_over' });
    for (const event of allEventVariants) {
      expect(() => reduce(terminated, event), `event type ${event.type}`).toThrow(InvalidTransitionError);
    }
  });

  it('ClaimAccepted during claim_phase throws (Invariant 15)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'ClaimAccepted', now: 0 })).toThrow(InvalidTransitionError);
  });

  it('SetupComplete throws when session.status !== setup (from round_active)', () => {
    const session = makeSession({ status: 'round_active', rounds: [makeRound()] });
    expect(() => reduce(session, makeSetupCompleteEvent())).toThrow(InvalidTransitionError);
  });

  it('SetupComplete throws when session.status is joker_offer', () => {
    const session = makeSession({ status: 'joker_offer', rounds: [makeRound()] });
    expect(() => reduce(session, makeSetupCompleteEvent())).toThrow(InvalidTransitionError);
  });

  it('ClaimMade throws when round.status !== claim_phase (response_phase)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'response_phase' })],
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    expect(() => reduce(session, makeClaimEvent())).toThrow(InvalidTransitionError);
  });

  it('ClaimMade throws when round.status === resolving', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'resolving' })],
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    expect(() => reduce(session, makeClaimEvent())).toThrow(InvalidTransitionError);
  });

  it('RoundSettled throws when round.status !== round_over', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'RoundSettled', now: 0 })).toThrow(InvalidTransitionError);
  });

  it('RoundSettled throws when round.status === response_phase', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'response_phase' })],
    });
    expect(() => reduce(session, { type: 'RoundSettled', now: 0 })).toThrow(InvalidTransitionError);
  });

  it('JokerPicked throws outside joker_offer', () => {
    const session = makeSession({ status: 'round_active', rounds: [makeRound()] });
    expect(() =>
      reduce(session, { type: 'JokerPicked', joker: 'poker_face', nextRoundDeal: makeNextRoundDeal(), now: 0 })
    ).toThrow(InvalidTransitionError);
  });

  it('ChallengeCalled throws outside response_phase', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'ChallengeCalled', now: 0 })).toThrow(InvalidTransitionError);
  });

  it('RevealComplete throws outside resolving (from claim_phase)', () => {
    const session = makeSession({
      status: 'round_active',
      rounds: [makeRound({ status: 'claim_phase' })],
    });
    expect(() => reduce(session, { type: 'RevealComplete', now: 0, challengeWasCorrect: true })).toThrow(InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Task 12.1 — Integration walkthrough: 2-round session
// ---------------------------------------------------------------------------

describe('Integration: 2-round session walkthrough', () => {
  /**
   * Helper: count all cards across the 6 pools (deck + two hands + pile + two takenCards).
   * Invariant 4 (expanded): sum === 20 at every reducer tick.
   */
  function assertCardConservation(session: Session, round: Round): void {
    const total =
      session.deck.length +
      session.player.hand.length +
      session.ai.hand.length +
      round.pile.length +
      session.player.takenCards.length +
      session.ai.takenCards.length;
    expect(total).toBe(20);

    // All 20 IDs must be unique
    const ids = [
      ...session.deck.map((c) => c.id),
      ...session.player.hand.map((c) => c.id),
      ...session.ai.hand.map((c) => c.id),
      ...round.pile.map((c) => c.id),
      ...session.player.takenCards.map((c) => c.id),
      ...session.ai.takenCards.map((c) => c.id),
    ];
    expect(new Set(ids).size).toBe(20);
  }

  it('complete 2-round session: setup→claims→resolution→joker→round2→session win (Invariants 4, 9, 16)', () => {
    // 20 cards in fixed layout: Queen-0..4, King-0..4, Ace-0..4, Jack-0..4
    const queens = [0,1,2,3,4].map((i) => makeCard('Queen', i));
    const kings  = [0,1,2,3,4].map((i) => makeCard('King', i));
    const aces   = [0,1,2,3,4].map((i) => makeCard('Ace', i));
    const jacks  = [0,1,2,3,4].map((i) => makeCard('Jack', i));

    // ----- SETUP -----
    // Player hand: 5 Queens; AI hand: 5 Kings; deck: 5 Aces + 5 Jacks
    const s0 = makeSession();
    const s1 = reduce(s0, {
      type: 'SetupComplete',
      now: 1000,
      initialDeal: {
        playerHand: queens,
        aiHand: kings,
        remainingDeck: [...aces, ...jacks],
        targetRank: 'Queen',
        activePlayer: 'player',
      },
      musicTracks: [
        { level: 'calm', url: 'calm.mp3' },
        { level: 'tense', url: 'tense.mp3' },
        { level: 'critical', url: 'critical.mp3' },
      ],
    });
    assertCardConservation(s1, s1.rounds[s1.currentRoundIdx]);
    expect(s1.status).toBe('round_active');
    expect(s1.rounds[0].status).toBe('claim_phase');
    expect(s1.rounds[0].activePlayer).toBe('player');

    // ----- Round 1, player plays 1 Queen honestly; AI challenges wrongly → AI gets strike -----
    const s2 = reduce(s1, {
      type: 'ClaimMade',
      now: 2000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-0'],
        truthState: 'honest',
        timestamp: 2000,
      },
    });
    assertCardConservation(s2, s2.rounds[s2.currentRoundIdx]);
    expect(s2.rounds[0].status).toBe('response_phase');
    expect(s2.player.hand).toHaveLength(4); // Queen-0 played

    // AI challenges (wrongly — player was honest)
    const s3 = reduce(s2, { type: 'ChallengeCalled', now: 3000 });
    assertCardConservation(s3, s3.rounds[s3.currentRoundIdx]);

    // Invariant 9: exactly 1 strike delta
    const aiStrikesBefore = s3.ai.strikes;
    const playerStrikesBefore = s3.player.strikes;
    const s4 = reduce(s3, { type: 'RevealComplete', challengeWasCorrect: false, now: 4000 });
    assertCardConservation(s4, s4.rounds[s4.currentRoundIdx]);
    const totalDelta = (s4.player.strikes - playerStrikesBefore) + (s4.ai.strikes - aiStrikesBefore);
    expect(totalDelta).toBe(1);
    expect(s4.ai.strikes).toBe(1);   // challenger (AI) struck
    expect(s4.player.strikes).toBe(0);
    // Active swapped to AI after RevealComplete (pile cleared)
    expect(s4.rounds[0].activePlayer).toBe('ai');

    // AI plays 1 King; player accepts → swap to player
    const s5 = reduce(s4, {
      type: 'ClaimMade',
      now: 5000,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['King-0'],
        truthState: 'lying',
        timestamp: 5000,
      },
    });
    assertCardConservation(s5, s5.rounds[s5.currentRoundIdx]);

    const s6 = reduce(s5, { type: 'ClaimAccepted', now: 6000 });
    assertCardConservation(s6, s6.rounds[s6.currentRoundIdx]);
    expect(s6.rounds[0].activePlayer).toBe('player');

    // Player plays Queen-1; AI accepts → swap to AI
    const s7 = reduce(s6, {
      type: 'ClaimMade',
      now: 7000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-1'],
        truthState: 'honest',
        timestamp: 7000,
      },
    });
    assertCardConservation(s7, s7.rounds[s7.currentRoundIdx]);

    const s8 = reduce(s7, { type: 'ClaimAccepted', now: 8000 });
    assertCardConservation(s8, s8.rounds[s8.currentRoundIdx]);
    expect(s8.rounds[0].activePlayer).toBe('ai');

    // AI plays King-1; player accepts → swap to player
    const s9 = reduce(s8, {
      type: 'ClaimMade',
      now: 9000,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['King-1'],
        truthState: 'lying',
        timestamp: 9000,
      },
    });
    assertCardConservation(s9, s9.rounds[s9.currentRoundIdx]);

    const s10 = reduce(s9, { type: 'ClaimAccepted', now: 10000 });
    assertCardConservation(s10, s10.rounds[s10.currentRoundIdx]);
    expect(s10.rounds[0].activePlayer).toBe('player');
    expect(s10.player.hand).toHaveLength(3); // Queen-2,3,4 remaining

    // Player plays Queen-2; AI accepts → swap to AI
    const s11a = reduce(s10, {
      type: 'ClaimMade',
      now: 11000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-2'],
        truthState: 'honest',
        timestamp: 11000,
      },
    });
    assertCardConservation(s11a, s11a.rounds[s11a.currentRoundIdx]);

    const s11b = reduce(s11a, { type: 'ClaimAccepted', now: 11100 });
    assertCardConservation(s11b, s11b.rounds[s11b.currentRoundIdx]);
    expect(s11b.rounds[0].activePlayer).toBe('ai');

    // AI plays King-2; player accepts → player's turn
    const s11c = reduce(s11b, {
      type: 'ClaimMade',
      now: 11200,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['King-2'],
        truthState: 'lying',
        timestamp: 11200,
      },
    });
    assertCardConservation(s11c, s11c.rounds[s11c.currentRoundIdx]);

    const s11d = reduce(s11c, { type: 'ClaimAccepted', now: 11300 });
    assertCardConservation(s11d, s11d.rounds[s11d.currentRoundIdx]);
    expect(s11d.rounds[0].activePlayer).toBe('player');
    expect(s11d.player.hand).toHaveLength(2); // Queen-3,4

    // Player plays Queen-3; AI accepts
    const s11e = reduce(s11d, {
      type: 'ClaimMade',
      now: 11400,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-3'],
        truthState: 'honest',
        timestamp: 11400,
      },
    });
    assertCardConservation(s11e, s11e.rounds[s11e.currentRoundIdx]);

    const s11f = reduce(s11e, { type: 'ClaimAccepted', now: 11500 });
    assertCardConservation(s11f, s11f.rounds[s11f.currentRoundIdx]);
    expect(s11f.rounds[0].activePlayer).toBe('ai');

    // AI plays King-3; player accepts
    const s11g = reduce(s11f, {
      type: 'ClaimMade',
      now: 11600,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['King-3'],
        truthState: 'lying',
        timestamp: 11600,
      },
    });
    assertCardConservation(s11g, s11g.rounds[s11g.currentRoundIdx]);

    const s11h = reduce(s11g, { type: 'ClaimAccepted', now: 11700 });
    assertCardConservation(s11h, s11h.rounds[s11h.currentRoundIdx]);
    expect(s11h.rounds[0].activePlayer).toBe('player');
    expect(s11h.player.hand).toHaveLength(1); // Queen-4 only

    // Player plays final Queen-4 → hand empty → round_over (player wins) when accepted
    const s11i = reduce(s11h, {
      type: 'ClaimMade',
      now: 11800,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Queen',
        actualCardIds: ['Queen-4'],
        truthState: 'honest',
        timestamp: 11800,
      },
    });
    assertCardConservation(s11i, s11i.rounds[s11i.currentRoundIdx]);
    expect(s11i.player.hand).toHaveLength(0);

    // AI accepts → round_over (player hand empty + claim accepted)
    const s12 = reduce(s11i, { type: 'ClaimAccepted', now: 11900 });
    assertCardConservation(s12, s12.rounds[s12.currentRoundIdx]);
    expect(s12.rounds[0].status).toBe('round_over');
    expect(s12.rounds[0].winner).toBe('player');

    // ----- RoundSettled → joker_offer -----
    const s13 = reduce(s12, { type: 'RoundSettled', now: 12000 });
    expect(s13.status).toBe('joker_offer');
    expect(s13.player.roundsWon).toBe(1);

    // Round 2 deal: caller reshuffles all 20 cards (aces + jacks now in play)
    // Player gets aces, AI gets jacks, deck gets queens+kings
    const round2DealClean = {
      playerHand: aces,
      aiHand: jacks,
      remainingDeck: [...queens, ...kings], // caller-collected all 20
      targetRank: 'Ace' as const,
      activePlayer: 'player' as const,
    };

    const s14 = reduce(s13, {
      type: 'JokerPicked',
      joker: 'poker_face',
      nextRoundDeal: round2DealClean,
      now: 13000,
    });

    // Invariant 16: both hands 5, deck 10, takenCards cleared
    expect(s14.player.hand).toHaveLength(5);
    expect(s14.ai.hand).toHaveLength(5);
    expect(s14.deck).toHaveLength(10);
    expect(s14.player.takenCards).toEqual([]);
    expect(s14.ai.takenCards).toEqual([]);
    expect(s14.rounds[1].pile).toEqual([]);
    expect(s14.currentRoundIdx).toBe(1);
    assertCardConservation(s14, s14.rounds[s14.currentRoundIdx]);

    // Invariant 16: strikes carried forward unchanged
    expect(s14.player.strikes).toBe(s13.player.strikes);
    expect(s14.ai.strikes).toBe(s13.ai.strikes);

    // ----- Round 2: player is active, targetRank = Ace -----
    expect(s14.status).toBe('round_active');
    expect(s14.rounds[1].status).toBe('claim_phase');
    expect(s14.rounds[1].activePlayer).toBe('player');

    // Player plays Ace-0 (honest); AI accepts → AI's turn
    const s15 = reduce(s14, {
      type: 'ClaimMade',
      now: 14000,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Ace-0'],
        truthState: 'honest',
        timestamp: 14000,
      },
    });
    assertCardConservation(s15, s15.rounds[s15.currentRoundIdx]);

    const s16 = reduce(s15, { type: 'ClaimAccepted', now: 15000 });
    assertCardConservation(s16, s16.rounds[s16.currentRoundIdx]);
    expect(s16.rounds[1].activePlayer).toBe('ai');

    // AI plays Jack-0 (lying — not an Ace); player accepts → player's turn
    const s17 = reduce(s16, {
      type: 'ClaimMade',
      now: 16000,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Jack-0'],
        truthState: 'lying',
        timestamp: 16000,
      },
    });
    assertCardConservation(s17, s17.rounds[s17.currentRoundIdx]);

    const s18 = reduce(s17, { type: 'ClaimAccepted', now: 17000 });
    assertCardConservation(s18, s18.rounds[s18.currentRoundIdx]);
    expect(s18.rounds[1].activePlayer).toBe('player');

    // Player plays remaining 4 Aces (Ace-1..4), all in one 2-card then 2-card claim
    const s19 = reduce(s18, {
      type: 'ClaimMade',
      now: 18000,
      claim: {
        by: 'player',
        count: 2,
        claimedRank: 'Ace',
        actualCardIds: ['Ace-1', 'Ace-2'],
        truthState: 'honest',
        timestamp: 18000,
      },
    });
    assertCardConservation(s19, s19.rounds[s19.currentRoundIdx]);

    const s20 = reduce(s19, { type: 'ClaimAccepted', now: 19000 });
    assertCardConservation(s20, s20.rounds[s20.currentRoundIdx]);
    expect(s20.rounds[1].activePlayer).toBe('ai');

    // AI plays Jack-1; player accepts → player's turn
    const s21 = reduce(s20, {
      type: 'ClaimMade',
      now: 19500,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Jack-1'],
        truthState: 'lying',
        timestamp: 19500,
      },
    });
    assertCardConservation(s21, s21.rounds[s21.currentRoundIdx]);

    const s22 = reduce(s21, { type: 'ClaimAccepted', now: 20000 });
    assertCardConservation(s22, s22.rounds[s22.currentRoundIdx]);
    expect(s22.rounds[1].activePlayer).toBe('player');
    expect(s22.player.hand).toHaveLength(2); // Ace-3, Ace-4

    // Player plays Ace-3; AI accepts
    const s23 = reduce(s22, {
      type: 'ClaimMade',
      now: 20500,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Ace-3'],
        truthState: 'honest',
        timestamp: 20500,
      },
    });
    assertCardConservation(s23, s23.rounds[s23.currentRoundIdx]);

    const s24 = reduce(s23, { type: 'ClaimAccepted', now: 21000 });
    assertCardConservation(s24, s24.rounds[s24.currentRoundIdx]);
    expect(s24.rounds[1].activePlayer).toBe('ai');

    // AI plays Jack-2; player accepts → player's final Ace
    const s25 = reduce(s24, {
      type: 'ClaimMade',
      now: 21500,
      claim: {
        by: 'ai',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Jack-2'],
        truthState: 'lying',
        timestamp: 21500,
      },
    });
    assertCardConservation(s25, s25.rounds[s25.currentRoundIdx]);

    const s26 = reduce(s25, { type: 'ClaimAccepted', now: 22000 });
    assertCardConservation(s26, s26.rounds[s26.currentRoundIdx]);
    expect(s26.rounds[1].activePlayer).toBe('player');
    expect(s26.player.hand).toHaveLength(1); // Ace-4 only

    // Player plays final Ace-4 → hand empty
    const s27 = reduce(s26, {
      type: 'ClaimMade',
      now: 22500,
      claim: {
        by: 'player',
        count: 1,
        claimedRank: 'Ace',
        actualCardIds: ['Ace-4'],
        truthState: 'honest',
        timestamp: 22500,
      },
    });
    assertCardConservation(s27, s27.rounds[s27.currentRoundIdx]);
    expect(s27.player.hand).toHaveLength(0);

    // AI accepts → round_over, player wins round 2
    const s28 = reduce(s27, { type: 'ClaimAccepted', now: 23000 });
    assertCardConservation(s28, s28.rounds[s28.currentRoundIdx]);
    expect(s28.rounds[1].status).toBe('round_over');
    expect(s28.rounds[1].winner).toBe('player');

    // RoundSettled → session_over (player wins 2nd round → 2 total)
    const s29 = reduce(s28, { type: 'RoundSettled', now: 24000 });
    expect(s29.status).toBe('session_over');
    expect(s29.sessionWinner).toBe('player');
    expect(s29.player.roundsWon).toBe(2);
  });

  it('Invariant 9 across all RevealComplete firings: exactly ONE player strikes per resolution', () => {
    const all = make20Cards();
    const pile = [all[0]];
    const claim: Claim = {
      by: 'player',
      count: 1,
      claimedRank: 'Queen',
      actualCardIds: ['Queen-0'],
      truthState: 'lying',
      timestamp: 2000,
    };
    const session = makeSessionInResolvingPhase({
      activePlayer: 'player',
      playerHand: all.slice(1, 5),
      aiHand: all.slice(5, 10),
      deck: all.slice(10, 20),
      pile,
      lastClaim: claim,
    });

    for (const correct of [true, false]) {
      const before = { p: session.player.strikes, ai: session.ai.strikes };
      const out = reduce(session, { type: 'RevealComplete', challengeWasCorrect: correct, now: 4000 });
      const delta = (out.player.strikes - before.p) + (out.ai.strikes - before.ai);
      expect(delta).toBe(1);
    }
  });
});
