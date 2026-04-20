// Tension-music-system spec §9 invariant I8 — deriveTensionLevel purity + mapping.

import { describe, it, expect } from 'vitest';
import {
  deriveTensionLevel,
  DUCK_FADE_MS,
  DUCK_GAIN,
  BASE_GAIN,
  CROSSFADE_MS,
  type TensionInput,
} from './tension';

function makeSession(overrides: Partial<TensionInput> = {}): TensionInput {
  return {
    status: 'setup',
    player: { strikes: 0 },
    ai: { strikes: 0 },
    ...overrides,
  };
}

describe('deriveTensionLevel — I8 mapping', () => {
  it('setup → calm', () => {
    expect(deriveTensionLevel(makeSession({ status: 'setup' }))).toBe('calm');
  });

  it('joker_offer → calm', () => {
    expect(deriveTensionLevel(makeSession({ status: 'joker_offer' }))).toBe('calm');
  });

  it('round_active with 0 strikes → calm', () => {
    expect(deriveTensionLevel(makeSession({ status: 'round_active' }))).toBe('calm');
  });

  it('round_active with 1 strike (player) → tense', () => {
    expect(
      deriveTensionLevel(makeSession({ status: 'round_active', player: { strikes: 1 } })),
    ).toBe('tense');
  });

  it('round_active with 1 strike (ai) → tense', () => {
    expect(
      deriveTensionLevel(makeSession({ status: 'round_active', ai: { strikes: 1 } })),
    ).toBe('tense');
  });

  it('round_active with 2 strikes (player) → critical', () => {
    expect(
      deriveTensionLevel(makeSession({ status: 'round_active', player: { strikes: 2 } })),
    ).toBe('critical');
  });

  it('round_active with 2 strikes (ai) → critical', () => {
    expect(
      deriveTensionLevel(makeSession({ status: 'round_active', ai: { strikes: 2 } })),
    ).toBe('critical');
  });

  it('round_active with both at 2 strikes → critical', () => {
    expect(
      deriveTensionLevel(
        makeSession({ status: 'round_active', player: { strikes: 2 }, ai: { strikes: 2 } }),
      ),
    ).toBe('critical');
  });

  it('session_over → critical (stinger landing zone)', () => {
    expect(deriveTensionLevel(makeSession({ status: 'session_over' }))).toBe('critical');
  });

  it('is pure — same input yields same output across calls', () => {
    const s = makeSession({ status: 'round_active', player: { strikes: 1 } });
    const a = deriveTensionLevel(s);
    const b = deriveTensionLevel(s);
    const c = deriveTensionLevel(s);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('accepts ClientSession-shaped input without synthesis', () => {
    // Demonstrates the shape narrowing — a real ClientSession's self/opponent
    // (PlayerState / ClientOpponent) both satisfy { strikes: number }.
    const clientLike = {
      status: 'round_active' as const,
      self: { strikes: 1, hand: [], takenCards: [], roundsWon: 0, jokers: [] },
      opponent: { strikes: 0, handSize: 5, takenCards: [], roundsWon: 0, jokers: [] },
    };
    const result = deriveTensionLevel({
      status: clientLike.status,
      player: { strikes: clientLike.self.strikes },
      ai: { strikes: clientLike.opponent.strikes },
    });
    expect(result).toBe('tense');
  });
});

describe('duck/gain constants — steering §1.5 lock', () => {
  it('DUCK_FADE_MS === 400 (NOT 150)', () => {
    expect(DUCK_FADE_MS).toBe(400);
  });

  it('DUCK_GAIN === 0.2', () => {
    expect(DUCK_GAIN).toBe(0.2);
  });

  it('BASE_GAIN === 1.0', () => {
    expect(BASE_GAIN).toBe(1.0);
  });

  it('CROSSFADE_MS === 800', () => {
    expect(CROSSFADE_MS).toBe(800);
  });
});
