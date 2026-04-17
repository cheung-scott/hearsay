import { describe, it, expect } from 'vitest';
import { ALL_RANKS, makeDeck, shuffle, dealFresh } from './deck';
import { parseClaim } from './claims';

// ---------------------------------------------------------------------------
// Seeded PRNG helper (mulberry32) for deterministic tests
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('ALL_RANKS', () => {
  it('equals [Queen, King, Ace, Jack]', () => {
    expect(ALL_RANKS).toEqual(['Queen', 'King', 'Ace', 'Jack']);
  });

  it('has exactly 4 elements', () => {
    expect(ALL_RANKS.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// makeDeck
// ---------------------------------------------------------------------------
describe('makeDeck', () => {
  it('returns exactly 20 cards (Invariant 1)', () => {
    expect(makeDeck().length).toBe(20);
  });

  it('returns exactly 5 cards per rank (Invariant 2)', () => {
    const deck = makeDeck();
    for (const rank of ALL_RANKS) {
      expect(deck.filter(c => c.rank === rank).length).toBe(5);
    }
  });

  it('all 20 card IDs are unique (Invariant 3)', () => {
    const deck = makeDeck();
    const ids = deck.map(c => c.id);
    expect(new Set(ids).size).toBe(20);
  });

  it('IDs follow ${rank}-${index} scheme, grouped by rank in ALL_RANKS order (Invariant 3 + req 2.4)', () => {
    const deck = makeDeck();
    let pos = 0;
    for (const rank of ALL_RANKS) {
      for (let i = 0; i < 5; i++) {
        expect(deck[pos].id).toBe(`${rank}-${i}`);
        expect(deck[pos].rank).toBe(rank);
        pos++;
      }
    }
  });

  it('is deterministic — two calls produce identical arrays (Invariant 4)', () => {
    expect(makeDeck()).toEqual(makeDeck());
  });
});

// ---------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------
describe('shuffle', () => {
  it('does not mutate the input array (Invariant 5)', () => {
    const rng = mulberry32(42);
    const deck = makeDeck();
    const original = deck.map(c => ({ ...c }));
    shuffle(deck, rng);
    expect(deck).toEqual(original);
  });

  it('preserves the element multiset (Invariant 6)', () => {
    const rng = mulberry32(123);
    const deck = makeDeck();
    const result = shuffle(deck, rng);
    // Same IDs when sorted
    const sortById = (cards: typeof deck) => [...cards].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(result)).toEqual(sortById(deck));
  });

  it('is deterministic with a seeded rng (Invariant 7)', () => {
    const deck = makeDeck();
    const result1 = shuffle(deck, mulberry32(999));
    const result2 = shuffle(deck, mulberry32(999));
    expect(result1).toEqual(result2);
  });

  it('produces different orderings for different seeds', () => {
    const deck = makeDeck();
    const result1 = shuffle(deck, mulberry32(1));
    const result2 = shuffle(deck, mulberry32(2));
    expect(result1).not.toEqual(result2);
  });

  it('uniformity smoke test — each card appears in position 0 at least 10 times in 1000 shuffles (Invariant 8)', () => {
    const deck = makeDeck();
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const result = shuffle(deck); // uses Math.random
      const firstId = result[0].id;
      counts[firstId] = (counts[firstId] ?? 0) + 1;
    }
    for (const card of deck) {
      expect(counts[card.id] ?? 0).toBeGreaterThanOrEqual(10);
    }
  });

  it('returns a new array, not the same reference', () => {
    const deck = makeDeck();
    const result = shuffle(deck, mulberry32(1));
    expect(result).not.toBe(deck);
  });
});

// ---------------------------------------------------------------------------
// dealFresh
// ---------------------------------------------------------------------------
describe('dealFresh', () => {
  it('playerHand.length === 5, aiHand.length === 5, remainingDeck.length === 10 (Invariant 9)', () => {
    // Test with multiple seeds
    for (const seed of [1, 42, 100, 999, 12345]) {
      const deal = dealFresh(mulberry32(seed));
      expect(deal.playerHand.length).toBe(5);
      expect(deal.aiHand.length).toBe(5);
      expect(deal.remainingDeck.length).toBe(10);
    }
  });

  it('no duplicate IDs across all partitions (Invariant 10)', () => {
    for (const seed of [1, 42, 100]) {
      const deal = dealFresh(mulberry32(seed));
      const allIds = [
        ...deal.playerHand,
        ...deal.aiHand,
        ...deal.remainingDeck,
      ].map(c => c.id);
      expect(new Set(allIds).size).toBe(20);
    }
  });

  it('targetRank is a valid member of ALL_RANKS (Invariant 11)', () => {
    for (const seed of [1, 42, 100, 999]) {
      const deal = dealFresh(mulberry32(seed));
      expect(ALL_RANKS).toContain(deal.targetRank);
    }
  });

  it('activePlayer is "player" or "ai" (Invariant 12)', () => {
    for (const seed of [1, 42, 100, 999]) {
      const deal = dealFresh(mulberry32(seed));
      expect(['player', 'ai']).toContain(deal.activePlayer);
    }
  });

  it('is deterministic with same seed (Invariant 13)', () => {
    const deal1 = dealFresh(mulberry32(777));
    const deal2 = dealFresh(mulberry32(777));
    expect(deal1).toEqual(deal2);
  });

  it('produces different deals for different seeds', () => {
    const deal1 = dealFresh(mulberry32(1));
    const deal2 = dealFresh(mulberry32(2));
    // At least one partition should differ
    const differs =
      JSON.stringify(deal1.playerHand) !== JSON.stringify(deal2.playerHand) ||
      JSON.stringify(deal1.aiHand) !== JSON.stringify(deal2.aiHand) ||
      deal1.targetRank !== deal2.targetRank ||
      deal1.activePlayer !== deal2.activePlayer;
    expect(differs).toBe(true);
  });

  it('consumes exactly 21 rng() calls in order: 19 shuffle swaps + 1 targetRank + 1 activePlayer (Req 4.6)', () => {
    let calls = 0;
    const countingRng = () => {
      calls++;
      return 0.5;
    };
    dealFresh(countingRng);
    expect(calls).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test: dealFresh → parseClaim round-trip (Task 13)
// ---------------------------------------------------------------------------
describe('dealFresh → parseClaim round-trip', () => {
  it('constructing "one ${targetRank.toLowerCase()}" from a dealFresh result parses back correctly', () => {
    for (const seed of [1, 42, 100, 999]) {
      const deal = dealFresh(mulberry32(seed));
      const transcript = `one ${deal.targetRank.toLowerCase()}`;
      const parsed = parseClaim(transcript);
      expect(parsed).toEqual({ count: 1, rank: deal.targetRank });
    }
  });

  it('constructing "two ${targetRank.toLowerCase()}s" parses back correctly', () => {
    for (const seed of [1, 42]) {
      const deal = dealFresh(mulberry32(seed));
      const transcript = `two ${deal.targetRank.toLowerCase()}s`;
      const parsed = parseClaim(transcript);
      expect(parsed).toEqual({ count: 2, rank: deal.targetRank });
    }
  });
});
