import { describe, it, expect } from 'vitest';
import type { Claim, PlayerState, Round, Session } from './types';
import { toClientView } from './toClientView';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCard(rank: 'Queen' | 'King' | 'Ace' | 'Jack', idx: number) {
  return { id: `${rank}-${idx}`, rank } as const;
}

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

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    player: makePlayer(),
    ai: makePlayer(),
    deck: [],
    rounds: [],
    currentRoundIdx: 0,
    status: 'setup',
    musicTracks: [
      { level: 'calm', url: 'calm.mp3' },
      { level: 'tense', url: 'tense.mp3' },
      { level: 'critical', url: 'critical.mp3' },
    ],
    ...overrides,
  };
}

/** A full server-side Claim with all optional fields populated. */
function makeFullClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    by: 'player',
    count: 1,
    claimedRank: 'Queen',
    actualCardIds: ['Queen-0'],
    truthState: 'honest',
    voiceMeta: {
      latencyMs: 200,
      fillerCount: 1,
      pauseCount: 0,
      speechRateWpm: 120,
      lieScore: 0.1,
      parsed: { count: 1, rank: 'Queen' },
    },
    ttsSettings: {
      stability: 0.7,
      similarity_boost: 0.8,
      style: 0.5,
      speed: 1.0,
    },
    llmReasoning: 'I think the player is bluffing',
    claimText: 'I play one Queen',
    timestamp: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Invariant 12 — no actualCardIds in serialized output
// ---------------------------------------------------------------------------

describe('toClientView — Invariant 12: actualCardIds stripped', () => {
  it('serialized output contains ZERO occurrences of actualCardIds', () => {
    const claim = makeFullClaim({ actualCardIds: ['Queen-0', 'Queen-1'] });
    const round = makeRound({ claimHistory: [claim], pile: [] });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    const client = toClientView(session, 'player');
    const serialized = JSON.stringify(client);
    expect(serialized).not.toContain('actualCardIds');
  });

  it('nested in multiple rounds — still zero actualCardIds', () => {
    const claim1 = makeFullClaim({ actualCardIds: ['King-0'] });
    const claim2 = makeFullClaim({ by: 'ai', actualCardIds: ['Ace-2'] });
    const round1 = makeRound({ roundNumber: 1, claimHistory: [claim1] });
    const round2 = makeRound({ roundNumber: 2, claimHistory: [claim2], status: 'round_over' });
    const session = makeSession({
      status: 'round_active',
      rounds: [round1, round2],
      currentRoundIdx: 1,
    });
    const serialized = JSON.stringify(toClientView(session, 'player'));
    expect(serialized).not.toContain('actualCardIds');
  });
});

// ---------------------------------------------------------------------------
// Invariant 12 — opponent hand absent, handSize present
// ---------------------------------------------------------------------------

describe('toClientView — opponent hand hidden, handSize exposed', () => {
  it('viewer=player: opponent (ai) hand absent, handSize = original hand length', () => {
    const aiHand = [makeCard('King', 0), makeCard('King', 1), makeCard('King', 2)];
    const session = makeSession({
      ai: makePlayer({ hand: aiHand }),
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    const client = toClientView(session, 'player');
    // opponent shape must NOT have 'hand'
    expect('hand' in client.opponent).toBe(false);
    expect(client.opponent.handSize).toBe(3);
  });

  it('viewer=ai: opponent (player) hand absent, handSize = original hand length', () => {
    const playerHand = [makeCard('Queen', 0), makeCard('Queen', 1)];
    const session = makeSession({
      player: makePlayer({ hand: playerHand }),
      ai: makePlayer({ hand: [makeCard('King', 0)] }),
    });
    const client = toClientView(session, 'ai');
    expect('hand' in client.opponent).toBe(false);
    expect(client.opponent.handSize).toBe(2);
  });

  it('opponent.handSize === 0 when opponent hand is empty', () => {
    const session = makeSession({
      ai: makePlayer({ hand: [] }),
    });
    const client = toClientView(session, 'player');
    expect(client.opponent.handSize).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Invariant 12 — opponent takenCards remain visible
// ---------------------------------------------------------------------------

describe('toClientView — opponent takenCards visible', () => {
  it('opponent takenCards deeply equals the server-side opponent.takenCards', () => {
    const taken = [makeCard('King', 0), makeCard('Ace', 1)];
    const session = makeSession({
      ai: makePlayer({ hand: [], takenCards: taken }),
    });
    const client = toClientView(session, 'player');
    expect(client.opponent.takenCards).toEqual(taken);
  });

  it('own takenCards are included in self', () => {
    const taken = [makeCard('Queen', 3)];
    const session = makeSession({
      player: makePlayer({ hand: [makeCard('Queen', 0)], takenCards: taken }),
    });
    const client = toClientView(session, 'player');
    expect(client.self.takenCards).toEqual(taken);
  });
});

// ---------------------------------------------------------------------------
// llmReasoning stripped uniformly (§3.4 note — own-view autopsy is server-side)
// ---------------------------------------------------------------------------

describe('toClientView — llmReasoning stripped from ALL claims', () => {
  it('llmReasoning not present on any claim in serialized output', () => {
    const ownClaim = makeFullClaim({ by: 'player', llmReasoning: 'player reasoning' });
    const aiClaim = makeFullClaim({ by: 'ai', llmReasoning: 'ai reasoning' });
    const round = makeRound({ claimHistory: [ownClaim, aiClaim] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const serialized = JSON.stringify(toClientView(session, 'player'));
    expect(serialized).not.toContain('llmReasoning');
    expect(serialized).not.toContain('player reasoning');
    expect(serialized).not.toContain('ai reasoning');
  });

  it('llmReasoning stripped from ai-viewer projection too', () => {
    const claim = makeFullClaim({ by: 'ai', llmReasoning: 'secret reasoning' });
    const round = makeRound({ claimHistory: [claim] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const serialized = JSON.stringify(toClientView(session, 'ai'));
    expect(serialized).not.toContain('llmReasoning');
  });
});

// ---------------------------------------------------------------------------
// Viewer symmetry
// ---------------------------------------------------------------------------

describe('toClientView — viewer symmetry', () => {
  it('player view has player hand in self, ai handSize in opponent', () => {
    const playerHand = [makeCard('Queen', 0), makeCard('Queen', 1)];
    const aiHand = [makeCard('King', 0), makeCard('King', 1), makeCard('King', 2)];
    const session = makeSession({
      player: makePlayer({ hand: playerHand }),
      ai: makePlayer({ hand: aiHand }),
    });
    const playerView = toClientView(session, 'player');
    expect(playerView.self.hand).toHaveLength(2);
    expect(playerView.opponent.handSize).toBe(3);
    expect('hand' in playerView.opponent).toBe(false);
  });

  it('ai view has ai hand in self, player handSize in opponent', () => {
    const playerHand = [makeCard('Queen', 0), makeCard('Queen', 1)];
    const aiHand = [makeCard('King', 0), makeCard('King', 1), makeCard('King', 2)];
    const session = makeSession({
      player: makePlayer({ hand: playerHand }),
      ai: makePlayer({ hand: aiHand }),
    });
    const aiView = toClientView(session, 'ai');
    expect(aiView.self.hand).toHaveLength(3);
    expect(aiView.opponent.handSize).toBe(2);
    expect('hand' in aiView.opponent).toBe(false);
  });

  it('same session — player view and ai view are both valid projections', () => {
    const playerHand = [makeCard('Queen', 0)];
    const aiHand = [makeCard('King', 0), makeCard('King', 1)];
    const session = makeSession({
      player: makePlayer({ hand: playerHand }),
      ai: makePlayer({ hand: aiHand }),
    });
    const playerView = toClientView(session, 'player');
    const aiView = toClientView(session, 'ai');
    // Neither exposes the opponent's hand
    expect('hand' in playerView.opponent).toBe(false);
    expect('hand' in aiView.opponent).toBe(false);
    // self is the viewer's own state
    expect(playerView.self.hand).toHaveLength(1);
    expect(aiView.self.hand).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// PublicClaim shape — EXACTLY the right fields
// ---------------------------------------------------------------------------

describe('toClientView — PublicClaim exact shape', () => {
  it('each PublicClaim has exactly the allowed fields (with optional claimText)', () => {
    const claim = makeFullClaim({ claimText: 'I play one Queen' });
    const round = makeRound({ claimHistory: [claim] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const client = toClientView(session, 'player');
    const publicClaim = client.rounds[0].claimHistory[0];
    const keys = Object.keys(publicClaim).sort();
    expect(keys).toEqual(['by', 'claimText', 'claimedRank', 'count', 'timestamp'].sort());
  });

  it('PublicClaim without claimText has exactly 4 fields', () => {
    const claim = makeFullClaim();
    delete (claim as Partial<Claim>).claimText; // no claimText
    const round = makeRound({ claimHistory: [claim] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const client = toClientView(session, 'player');
    const publicClaim = client.rounds[0].claimHistory[0];
    const keys = Object.keys(publicClaim).sort();
    // Must NOT include: actualCardIds, truthState, voiceMeta, ttsSettings, llmReasoning
    expect(keys).toEqual(['by', 'claimedRank', 'count', 'timestamp'].sort());
    expect(keys).not.toContain('actualCardIds');
    expect(keys).not.toContain('truthState');
    expect(keys).not.toContain('voiceMeta');
    expect(keys).not.toContain('ttsSettings');
    expect(keys).not.toContain('llmReasoning');
  });
});

// ---------------------------------------------------------------------------
// pileSize per round
// ---------------------------------------------------------------------------

describe('toClientView — pileSize', () => {
  it('pileSize === original pile.length', () => {
    const pile = [makeCard('Queen', 0), makeCard('King', 1), makeCard('Ace', 2)];
    const round = makeRound({ pile });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const client = toClientView(session, 'player');
    expect(client.rounds[0].pileSize).toBe(3);
  });

  it('pileSize === 0 for empty pile', () => {
    const round = makeRound({ pile: [] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const client = toClientView(session, 'player');
    expect(client.rounds[0].pileSize).toBe(0);
  });

  it('pile field is not present on ClientRound', () => {
    const round = makeRound({ pile: [makeCard('Queen', 0)] });
    const session = makeSession({ status: 'round_active', rounds: [round] });
    const client = toClientView(session, 'player');
    expect('pile' in client.rounds[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// currentMusicUrl — tension bucket mapping
// ---------------------------------------------------------------------------

describe('toClientView — currentMusicUrl', () => {
  function makeSessionWithTension(tensionLevel: number): Session {
    const round = makeRound({ tensionLevel });
    return makeSession({
      status: 'round_active',
      rounds: [round],
      musicTracks: [
        { level: 'calm', url: 'https://music/calm.mp3' },
        { level: 'tense', url: 'https://music/tense.mp3' },
        { level: 'critical', url: 'https://music/critical.mp3' },
      ],
    });
  }

  it('tensionLevel 0.0 → calm URL', () => {
    const client = toClientView(makeSessionWithTension(0.0), 'player');
    expect(client.currentMusicUrl).toBe('https://music/calm.mp3');
  });

  it('tensionLevel 0.32 → calm URL (just below 0.33 threshold)', () => {
    const client = toClientView(makeSessionWithTension(0.32), 'player');
    expect(client.currentMusicUrl).toBe('https://music/calm.mp3');
  });

  it('tensionLevel 0.33 → tense URL (at lower boundary)', () => {
    const client = toClientView(makeSessionWithTension(0.33), 'player');
    expect(client.currentMusicUrl).toBe('https://music/tense.mp3');
  });

  it('tensionLevel 0.5 → tense URL (mid-range)', () => {
    const client = toClientView(makeSessionWithTension(0.5), 'player');
    expect(client.currentMusicUrl).toBe('https://music/tense.mp3');
  });

  it('tensionLevel 0.65 → tense URL (just below 0.66)', () => {
    const client = toClientView(makeSessionWithTension(0.65), 'player');
    expect(client.currentMusicUrl).toBe('https://music/tense.mp3');
  });

  it('tensionLevel 0.66 → critical URL (at upper boundary)', () => {
    const client = toClientView(makeSessionWithTension(0.66), 'player');
    expect(client.currentMusicUrl).toBe('https://music/critical.mp3');
  });

  it('tensionLevel 0.9 → critical URL', () => {
    const client = toClientView(makeSessionWithTension(0.9), 'player');
    expect(client.currentMusicUrl).toBe('https://music/critical.mp3');
  });

  it('tensionLevel 1.0 → critical URL', () => {
    const client = toClientView(makeSessionWithTension(1.0), 'player');
    expect(client.currentMusicUrl).toBe('https://music/critical.mp3');
  });

  it('no rounds (setup state) → currentMusicUrl undefined', () => {
    const session = makeSession({ status: 'setup', rounds: [] });
    const client = toClientView(session, 'player');
    expect(client.currentMusicUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Input not mutated
// ---------------------------------------------------------------------------

describe('toClientView — input not mutated', () => {
  it('calling toClientView does not mutate the input session', () => {
    const pile = [makeCard('Queen', 0)];
    const playerHand = [makeCard('Queen', 1)];
    const aiHand = [makeCard('King', 0)];
    const claim = makeFullClaim();
    const round = makeRound({ pile, claimHistory: [claim] });
    const session = makeSession({
      status: 'round_active',
      rounds: [round],
      player: makePlayer({ hand: playerHand }),
      ai: makePlayer({ hand: aiHand }),
    });
    const before = JSON.stringify(session);
    toClientView(session, 'player');
    expect(JSON.stringify(session)).toBe(before);
  });

  it('mutating returned ClientSession does not affect input session (no aliasing)', () => {
    const aiHand = [makeCard('King', 0), makeCard('King', 1)];
    const session = makeSession({
      ai: makePlayer({ hand: aiHand }),
      player: makePlayer({ hand: [makeCard('Queen', 0)] }),
    });
    const client = toClientView(session, 'player');
    // Mutate the returned self.hand
    (client.self.hand as unknown[]).push({ id: 'ghost', rank: 'Queen' });
    // Original session should be unaffected
    expect(session.player.hand).toHaveLength(1);
  });
});
