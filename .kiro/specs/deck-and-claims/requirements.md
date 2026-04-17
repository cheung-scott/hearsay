# Requirements Document

## Introduction

This document specifies the requirements for the deck-and-claims module of Hearsay — the 20-card deck factory, Fisher-Yates shuffle, round-deal assembler, and voice-transcript claim parser. These four pure functions (plus three exported constants) form the data layer consumed by the game-engine FSM and API routes. All requirements are derived from the authoritative `design.md`.

## Glossary

- **Deck**: An ordered array of 20 `Card` objects (5 per rank) produced by `makeDeck()`.
- **Card**: An object `{ id: string; rank: Rank }` representing one playing card.
- **Rank**: One of the four string literals `'Queen' | 'King' | 'Ace' | 'Jack'`.
- **ALL_RANKS**: A frozen array `['Queen', 'King', 'Ace', 'Jack']` exported as a constant.
- **WORD_TO_NUM**: A constant map from count-words/digits (`"one"`, `"two"`, `"1"`, `"2"`) to integers `1 | 2`.
- **CLAIM_REGEX**: A case-insensitive regular expression matching `(one|two|1|2)\s+(queen|king|ace|jack)s?` with word boundaries.
- **Shuffle**: The `shuffle(arr, rng)` function — a Fisher-Yates (Durstenfeld) in-place-safe shuffle returning a new array.
- **RoundDeal**: The interface `{ playerHand: Card[]; aiHand: Card[]; remainingDeck: Card[]; targetRank: Rank; activePlayer: 'player' | 'ai' }` defined in game-engine spec §2.
- **DealFresh**: The `dealFresh(rng?)` function that produces a complete `RoundDeal`.
- **ParseClaim**: The `parseClaim(transcript)` function that regex-parses a voice transcript into `{ count: 1|2; rank: Rank } | null`.
- **Seeded_RNG**: A deterministic pseudo-random number generator producing values in `[0, 1)`, used to make shuffle/deal reproducible in tests.

## Requirements

### Requirement 1: Exported Constants

**User Story:** As a developer, I want well-defined constants for ranks, count-word mappings, and the claim regex, so that all modules share a single source of truth.

#### Acceptance Criteria

1. THE ALL_RANKS constant SHALL be a readonly array equal to `['Queen', 'King', 'Ace', 'Jack']`.
2. THE WORD_TO_NUM constant SHALL map `"one"` to `1`, `"two"` to `2`, `"1"` to `1`, and `"2"` to `2`, with no other keys.
3. THE CLAIM_REGEX constant SHALL be a case-insensitive RegExp matching the pattern `\b(one|two|1|2)\s+(queen|king|ace|jack)s?\b`.

### Requirement 2: makeDeck — 20-Card Factory

**User Story:** As a game engine consumer, I want a deterministic factory that produces the canonical 20-card deck, so that every session starts from a known card population.

#### Acceptance Criteria

1. THE makeDeck function SHALL return an array of exactly 20 Card objects.
2. THE makeDeck function SHALL return exactly 5 cards of each Rank (Queen, King, Ace, Jack).
3. THE makeDeck function SHALL assign each card a unique ID following the scheme `"${rank}-${index}"` where index is 0 through 4 per rank, producing 20 unique IDs.
4. THE makeDeck function SHALL return cards grouped by rank in ALL_RANKS order (Queen, King, Ace, Jack), with indices ascending within each group.
5. WHEN makeDeck is called multiple times, THE makeDeck function SHALL return identical arrays (deterministic, stable IDs).

### Requirement 3: shuffle — Fisher-Yates Shuffle

**User Story:** As a game engine consumer, I want a pure, unbiased shuffle that accepts an injectable RNG, so that card order is random in production and reproducible in tests.

#### Acceptance Criteria

1. THE shuffle function SHALL return a new array without mutating the input array.
2. THE shuffle function SHALL preserve the element multiset — the output contains exactly the same elements as the input with no additions or removals.
3. WHEN a Seeded_RNG is provided, THE shuffle function SHALL produce identical output for identical input and seed (deterministic).
4. THE shuffle function SHALL implement the Fisher-Yates (Durstenfeld) algorithm where swap index `j = Math.floor(rng() * (i + 1))` for `i` from `length - 1` down to `1`.
5. WHEN shuffle is run 1000 times with a uniform RNG on a 20-card deck, THE shuffle function SHALL place each card in position 0 at least 10 times (uniformity smoke test).

### Requirement 4: dealFresh — RoundDeal Assembler

**User Story:** As an API route, I want a single function that produces a complete RoundDeal from one RNG source, so that session-start and between-round deals are simple one-call operations.

#### Acceptance Criteria

1. THE dealFresh function SHALL return a RoundDeal with `playerHand.length === 5`, `aiHand.length === 5`, and `remainingDeck.length === 10`.
2. THE dealFresh function SHALL produce a RoundDeal where the union of playerHand, aiHand, and remainingDeck contains 20 unique card IDs with no duplicates.
3. THE dealFresh function SHALL set `targetRank` to a valid member of ALL_RANKS.
4. THE dealFresh function SHALL set `activePlayer` to either `'player'` or `'ai'`.
5. WHEN a Seeded_RNG is provided, THE dealFresh function SHALL produce an identical RoundDeal for the same seed (deterministic).
6. THE dealFresh function SHALL consume the injected RNG in a fixed order: 19 shuffle-swap calls, then 1 rank selection, then 1 activePlayer coin flip (21 total RNG calls).

### Requirement 5: parseClaim — Voice Transcript Parser

**User Story:** As an API route handling player voice input, I want to parse STT transcripts into structured `{ count, rank }` claims, so that the game engine receives validated claim data.

#### Acceptance Criteria

1. WHEN a transcript contains a valid claim phrase (count word/digit followed by a rank, with optional plural "s"), THE parseClaim function SHALL return `{ count: 1|2, rank: Rank }` with the correct values.
2. THE parseClaim function SHALL match 32 meaningful positive variants — `2 word-counts (one, two) × 4 ranks × 3 casings = 24` + `2 digit-counts (1, 2) × 4 ranks × 1 casing = 8` (digits don't casing-permute). Matches design.md §6 invariant 14 + tasks.md Task 11.3.
3. WHEN a transcript contains leading or trailing noise (filler words, punctuation), THE parseClaim function SHALL still extract the valid claim phrase.
4. WHEN a transcript contains multiple valid claim phrases, THE parseClaim function SHALL return the first match only.
5. WHEN a transcript is an empty string, THE parseClaim function SHALL return null.
6. WHEN a transcript contains no valid claim phrase, THE parseClaim function SHALL return null.
7. WHEN a transcript contains a count word outside {one, two, 1, 2}, THE parseClaim function SHALL return null.
8. WHEN a transcript contains a rank word outside {queen, king, ace, jack}, THE parseClaim function SHALL return null.
9. WHEN a transcript contains a valid count and rank without word boundaries (concatenated), THE parseClaim function SHALL return null.
10. WHEN a transcript contains a valid rank followed by a valid count (wrong order), THE parseClaim function SHALL return null.
11. WHEN a transcript contains a valid count and rank without whitespace between them, THE parseClaim function SHALL return null.
12. THE parseClaim function SHALL be pure — calling it twice with the same input SHALL produce deep-equal output with no regex state leaks between calls.

### Requirement 6: Correctness Properties

**User Story:** As a developer, I want property-based and example-based tests that enforce the 25 locked invariants from design.md §6, so that gameplay correctness is protected against regressions.

#### Acceptance Criteria

1. THE test suite SHALL verify that `makeDeck().length === 20` (Invariant 1).
2. THE test suite SHALL verify that makeDeck produces exactly 5 cards of each rank (Invariant 2).
3. THE test suite SHALL verify that all 20 card IDs from makeDeck are unique (Invariant 3).
4. THE test suite SHALL verify that makeDeck produces stable IDs across calls (Invariant 4).
5. THE test suite SHALL verify that shuffle does not mutate its input array (Invariant 5).
6. THE test suite SHALL verify that shuffle preserves the element multiset (Invariant 6).
7. THE test suite SHALL verify that shuffle is deterministic with a seeded RNG (Invariant 7).
8. THE test suite SHALL verify shuffle uniformity via a 1000-iteration smoke test (Invariant 8).
9. THE test suite SHALL verify dealFresh hand sizes: 5 + 5 + 10 (Invariant 9).
10. THE test suite SHALL verify dealFresh produces no duplicate IDs across partitions (Invariant 10).
11. THE test suite SHALL verify dealFresh targetRank is a valid member of ALL_RANKS (Invariant 11).
12. THE test suite SHALL verify dealFresh activePlayer is 'player' or 'ai' (Invariant 12).
13. THE test suite SHALL verify dealFresh determinism with a seeded RNG (Invariant 13).
14. THE test suite SHALL verify parseClaim positive matches across all 32 meaningful count × rank × casing variants (Invariant 14 — 24 word + 8 digit, digits don't casing-permute).
15. THE test suite SHALL verify parseClaim handles numeric digit forms (Invariant 15).
16. THE test suite SHALL verify parseClaim handles leading/trailing noise (Invariant 16).
17. THE test suite SHALL verify parseClaim first-match-wins behavior (Invariant 17).
18. THE test suite SHALL verify parseClaim returns null for empty string (Invariant 18).
19. THE test suite SHALL verify parseClaim returns null for non-claim text (Invariant 19).
20. THE test suite SHALL verify parseClaim returns null for out-of-range counts (Invariant 20).
21. THE test suite SHALL verify parseClaim returns null for invalid ranks (Invariant 21).
22. THE test suite SHALL verify parseClaim rejects inputs without word boundaries (Invariant 22).
23. THE test suite SHALL verify parseClaim rejects wrong-order inputs (Invariant 23).
24. THE test suite SHALL verify parseClaim rejects no-space variants (Invariant 24).
25. THE test suite SHALL verify parseClaim purity — no regex lastIndex leaks (Invariant 25).

---

## Invariant Cross-Reference

Maps each of the 25 locked invariants from design.md §6 to the requirement(s) that cover it.

| Invariant | Description | Requirement(s) |
|---|---|---|
| 1 | Deck size: `makeDeck().length === 20` | 2.1, 6.1 |
| 2 | Rank distribution: exactly 5 per rank | 2.2, 6.2 |
| 3 | Unique IDs: 20 unique card IDs | 2.3, 6.3 |
| 4 | Stable IDs across calls | 2.5, 6.4 |
| 5 | shuffle doesn't mutate input | 3.1, 6.5 |
| 6 | shuffle preserves element multiset | 3.2, 6.6 |
| 7 | shuffle deterministic with seeded rng | 3.3, 6.7 |
| 8 | shuffle uniformity smoke test | 3.5, 6.8 |
| 9 | dealFresh hand sizes 5/5/10 | 4.1, 6.9 |
| 10 | dealFresh no duplicate IDs across partitions | 4.2, 6.10 |
| 11 | dealFresh targetRank valid | 4.3, 6.11 |
| 12 | dealFresh activePlayer valid | 4.4, 6.12 |
| 13 | dealFresh determinism with seeded rng | 4.5, 6.13 |
| 14 | parseClaim positive matches (32 variants) | 5.1, 5.2, 6.14 |
| 15 | parseClaim numeric digit forms | 5.2, 6.15 |
| 16 | parseClaim leading/trailing noise | 5.3, 6.16 |
| 17 | parseClaim first-match-wins | 5.4, 6.17 |
| 18 | parseClaim empty string → null | 5.5, 6.18 |
| 19 | parseClaim non-claim text → null | 5.6, 6.19 |
| 20 | parseClaim out-of-range count → null | 5.7, 6.20 |
| 21 | parseClaim invalid rank → null | 5.8, 6.21 |
| 22 | parseClaim word-boundary enforcement | 5.9, 6.22 |
| 23 | parseClaim wrong order → null | 5.10, 6.23 |
| 24 | parseClaim no-space variant → null | 5.11, 6.24 |
| 25 | parseClaim purity (no regex state leaks) | 5.12, 6.25 |
