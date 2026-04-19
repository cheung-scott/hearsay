// Shared fixtures for tool tests.
// Intentionally local to the Power — we don't import test helpers from the
// Hearsay app (keeps the Power self-contained).

import type {
  Card,
  Claim,
  PlayerState,
  Round,
  Session,
} from '../../../../src/lib/game/types';

export function makeCard(rank: 'Queen' | 'King' | 'Ace' | 'Jack', i: number): Card {
  return { id: `${rank}-${i}`, rank };
}

export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    hand: overrides.hand ?? [makeCard('Queen', 0), makeCard('King', 1)],
    takenCards: overrides.takenCards ?? [],
    roundsWon: overrides.roundsWon ?? 0,
    strikes: overrides.strikes ?? 0,
    jokers: overrides.jokers ?? [],
    ...overrides,
  };
}

export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    by: overrides.by ?? 'ai',
    count: overrides.count ?? 1,
    claimedRank: overrides.claimedRank ?? 'Queen',
    actualCardIds: overrides.actualCardIds ?? ['Queen-0'],
    truthState: overrides.truthState ?? 'honest',
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    ...overrides,
  };
}

export function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    roundNumber: overrides.roundNumber ?? 1,
    targetRank: overrides.targetRank ?? 'Queen',
    activePlayer: overrides.activePlayer ?? 'player',
    pile: overrides.pile ?? [],
    claimHistory: overrides.claimHistory ?? [],
    status: overrides.status ?? 'claim_phase',
    activeJokerEffects: overrides.activeJokerEffects ?? [],
    tensionLevel: overrides.tensionLevel ?? 0,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'sess-1',
    player: overrides.player ?? makePlayer(),
    ai: overrides.ai ?? makePlayer({ personaIfAi: 'Novice' }),
    deck: overrides.deck ?? [],
    rounds: overrides.rounds ?? [makeRound()],
    currentRoundIdx: overrides.currentRoundIdx ?? 0,
    status: overrides.status ?? 'round_active',
    musicTracks: overrides.musicTracks ?? [
      { level: 'calm', url: 'https://example.test/calm.mp3' },
      { level: 'tense', url: 'https://example.test/tense.mp3' },
      { level: 'critical', url: 'https://example.test/critical.mp3' },
    ],
    ...overrides,
  };
}
