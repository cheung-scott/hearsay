# Tasks — deck-and-claims

- [x] 1. Export constants: ALL_RANKS, WORD_TO_NUM, CLAIM_REGEX
  **Requirements:** 1.1, 1.2, 1.3
  **Files:** `src/lib/game/deck.ts` (ALL_RANKS), `src/lib/game/claims.ts` (WORD_TO_NUM, CLAIM_REGEX)
  - [x] 1.1 In `src/lib/game/deck.ts`, export `ALL_RANKS` as a `readonly Rank[]` equal to `['Queen', 'King', 'Ace', 'Jack'] as const`.
  - [x] 1.2 In `src/lib/game/claims.ts`, export `WORD_TO_NUM` mapping `{one:1, two:2, '1':1, '2':2}` and `CLAIM_REGEX` as the case-insensitive regex `/\b(one|two|1|2)\s+(queen|king|ace|jack)s?\b/i`.

- [x] 2. Implement makeDeck()
  **Requirements:** 2.1, 2.2, 2.3, 2.4, 2.5
  **Files:** `src/lib/game/deck.ts`
  - [x] 2.1 Implement `makeDeck(): Card[]` — iterate `ALL_RANKS`, for each rank generate 5 cards with IDs `"${rank}-${index}"` (index 0..4). Return the flat 20-card array.
  - [x] 2.2 Verify return type uses `Card` from `src/lib/game/types.ts`. No new types needed.

- [x] 3. Write tests for constants and makeDeck
  **Requirements:** 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3, 6.4
  **Files:** `src/lib/game/deck.test.ts`
  - [x] 3.1 Test ALL_RANKS equals `['Queen', 'King', 'Ace', 'Jack']` and is readonly.
  - [x] 3.2 Test makeDeck returns exactly 20 cards (Invariant 1).
  - [x] 3.3 Test makeDeck returns exactly 5 cards per rank (Invariant 2).
  - [x] 3.4 Test all 20 IDs are unique (Invariant 3).
  - [x] 3.5 Test IDs follow `"${rank}-${index}"` scheme and cards are grouped by rank in ALL_RANKS order, index ascending.
  - [x] 3.6 Test makeDeck is deterministic — two calls produce identical arrays (Invariant 4).

- [x] 4. Implement shuffle()
  **Requirements:** 3.1, 3.2, 3.3, 3.4
  **Files:** `src/lib/game/deck.ts`
  - [x] 4.1 Implement `shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[]` — spread input into new array, apply Fisher-Yates (Durstenfeld) with `j = Math.floor(rng() * (i + 1))` for `i` from `length - 1` down to `1`. Return the new array.

- [x] 5. Write tests for shuffle
  **Requirements:** 3.1, 3.2, 3.3, 3.4, 3.5, 6.5, 6.6, 6.7, 6.8
  **Files:** `src/lib/game/deck.test.ts`
  - [x] 5.1 Create a seeded PRNG helper (e.g. mulberry32) for deterministic tests.
  - [x] 5.2 Test shuffle does not mutate input array (Invariant 5) — property test: for any seeded rng, original array unchanged after shuffle.
  - [x] 5.3 Test shuffle preserves element multiset (Invariant 6) — property test: for any seeded rng, sorted output equals sorted input.
  - [x] 5.4 Test shuffle determinism (Invariant 7) — property test: two calls with same seed produce identical output.
  - [x] 5.5 Test shuffle uniformity smoke test (Invariant 8) — 1000 iterations with Math.random, each card in position 0 at least 10 times.

- [x] 6. Checkpoint: run all tests
  **Files:** `src/lib/game/deck.test.ts`
  Run `pnpm vitest run src/lib/game/deck.test.ts` and verify all tests pass.

- [x] 7. Implement dealFresh()
  **Requirements:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
  **Files:** `src/lib/game/deck.ts`, `src/lib/game/types.ts` (import RoundDeal if not yet exported — may need to add the interface)
  - [x] 7.1 If `RoundDeal` is not yet exported from `src/lib/game/types.ts`, add the interface matching game-engine spec §2 definition.
  - [x] 7.2 Implement `dealFresh(rng: () => number = Math.random): RoundDeal` — call `shuffle(makeDeck(), rng)`, slice into 5/5/10 partitions, pick `targetRank` via `ALL_RANKS[Math.floor(rng() * 4)]`, pick `activePlayer` via `rng() < 0.5 ? 'player' : 'ai'`. Return the RoundDeal.

- [x] 8. Write tests for dealFresh
  **Requirements:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.9, 6.10, 6.11, 6.12, 6.13
  **Files:** `src/lib/game/deck.test.ts`
  - [x] 8.1 Test dealFresh structural validity (property test with multiple seeds): playerHand.length === 5, aiHand.length === 5, remainingDeck.length === 10 (Invariant 9).
  - [x] 8.2 Test dealFresh no duplicate IDs across partitions — union of all three has 20 unique IDs (Invariant 10).
  - [x] 8.3 Test dealFresh targetRank is a member of ALL_RANKS (Invariant 11).
  - [x] 8.4 Test dealFresh activePlayer is 'player' or 'ai' (Invariant 12).
  - [x] 8.5 Test dealFresh determinism — two calls with same seed produce deep-equal RoundDeal (Invariant 13).

- [x] 9. Checkpoint: run deck tests
  **Files:** `src/lib/game/deck.test.ts`
  Run `pnpm vitest run src/lib/game/deck.test.ts` and verify all tests pass.

- [x] 10. Implement parseClaim()
  **Requirements:** 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12
  **Files:** `src/lib/game/claims.ts`
  - [x] 10.1 Implement `parseClaim(transcript: string): { count: 1 | 2; rank: Rank } | null` — lowercase the transcript, match against CLAIM_REGEX, extract count via WORD_TO_NUM, capitalize rank, return structured result or null.

- [x] 11. Write tests for parseClaim
  **Requirements:** 5.1–5.12, 6.14–6.25
  **Files:** `src/lib/game/claims.test.ts`
  - [x] 11.1 Test WORD_TO_NUM has exactly 4 entries with correct mappings.
  - [x] 11.2 Test CLAIM_REGEX is a RegExp with the expected pattern.
  - [x] 11.3 Parameterized test: all 32 meaningful variants — 24 word (2 words × 4 ranks × 3 casings) + 8 digit (2 digits × 4 ranks × 1 casing) — parse correctly (Invariant 14).
  - [x] 11.4 Test numeric digit forms: "1 queen" → {1, Queen}, "2 queens" → {2, Queen} (Invariant 15).
  - [x] 11.5 Test leading/trailing noise: "uh, one queen.", "One queen, please.", "Just two kings" (Invariant 16).
  - [x] 11.6 Test first-match-wins: "two queens or one king" → {2, Queen} (Invariant 17).
  - [x] 11.7 Test empty string → null (Invariant 18).
  - [x] 11.8 Test non-claim text → null: "Hello world", "I pass", "nope" (Invariant 19).
  - [x] 11.9 Test out-of-range counts → null: "three queens", "zero aces", "five kings" (Invariant 20).
  - [x] 11.10 Test invalid ranks → null: "one five", "two banana" (Invariant 21).
  - [x] 11.11 Test word-boundary enforcement → null: "butonequeenly", "antonequeen" (Invariant 22).
  - [x] 11.12 Test wrong order → null: "queens one" (Invariant 23).
  - [x] 11.13 Test no-space variant → null: "1queen" (Invariant 24).
  - [x] 11.14 Test purity — property test: for any string, two parseClaim calls produce deep-equal output (Invariant 25).

- [x] 12. Checkpoint: run all tests
  **Files:** `src/lib/game/deck.test.ts`, `src/lib/game/claims.test.ts`
  Run `pnpm vitest run src/lib/game/deck.test.ts src/lib/game/claims.test.ts` and verify all tests pass.

- [x] 13. Integration smoke test: dealFresh → parseClaim round-trip
  **Requirements:** 4.1, 5.1
  **Files:** `src/lib/game/deck.test.ts`
  - [x] 13.1 Test that for a dealFresh result, constructing a claim string like `"one ${targetRank.toLowerCase()}"` and passing it to parseClaim returns `{ count: 1, rank: targetRank }`. Verifies the two modules compose correctly.
