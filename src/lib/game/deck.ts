import type { Card, Rank, RoundDeal } from './types';

// The 4 playable ranks — iteration-friendly alternative to typing the union manually.
export const ALL_RANKS: readonly Rank[] = ['Queen', 'King', 'Ace', 'Jack'] as const;

/**
 * Build a canonical, unshuffled 20-card deck. Card IDs are stable per-process:
 * `${rank}-${index}` where index is 0..4 per rank.
 *
 * Determinism: same call → same order → same IDs. Tests rely on this.
 * Use shuffle(makeDeck(), rng) to randomise.
 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of ALL_RANKS) {
    for (let i = 0; i < 5; i++) {
      deck.push({ id: `${rank}-${i}`, rank });
    }
  }
  return deck;
}

/**
 * In-place-safe Fisher-Yates shuffle. Returns a NEW array (does not mutate input).
 *
 * @param arr Input array (any type).
 * @param rng Random source (0 ≤ x < 1). Defaults to `Math.random`.
 *            Pass a seeded PRNG (e.g. mulberry32) in tests for determinism.
 */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Produce a complete RoundDeal: shuffled 20 cards → 5/5 hands + 10-card
 * remainingDeck + random targetRank + coin-flipped activePlayer.
 *
 * All randomness comes from the single injected `rng`. Deterministic when
 * rng is seeded.
 */
export function dealFresh(rng: () => number = Math.random): RoundDeal {
  const shuffled = shuffle(makeDeck(), rng);
  const playerHand = shuffled.slice(0, 5);
  const aiHand = shuffled.slice(5, 10);
  const remainingDeck = shuffled.slice(10); // 10 cards
  const targetRank = ALL_RANKS[Math.floor(rng() * 4)];
  const activePlayer: 'player' | 'ai' = rng() < 0.5 ? 'player' : 'ai';
  return { playerHand, aiHand, remainingDeck, targetRank, activePlayer };
}
