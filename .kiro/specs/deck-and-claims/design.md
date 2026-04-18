---
inclusion: fileMatch
fileMatchPattern: "src/lib/game/deck.ts|src/lib/game/claims.ts|src/lib/game/**/*.ts"
---

# deck-and-claims — Design

## Provenance

Authored by Claude Code as a TypeScript-level codification of `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md` §1.1 (deck + deal mechanics) + §5.2 (voice-parsing regex), iter-5 locked 2026-04-16. Kiro Spec mode generated `requirements.md` + `tasks.md` from this design via seeded prompt. Tasks executed by Claude Code.

The deck model + claim-parse layer for Hearsay. This spec owns **everything** about how cards are created, shuffled, dealt into a `RoundDeal`, and how player voice transcripts are parsed into structured `{ count, rank }` claims.

**Scope of this spec:**
1. `makeDeck()` — the 20-card factory with stable IDs (5Q / 5K / 5A / 5J)
2. `shuffle(arr, rng)` — Fisher-Yates shuffle, pure if `rng` is deterministic
3. `dealFresh(rng?)` — high-level assembler that produces a `RoundDeal` for SetupComplete + JokerPicked
4. `parseClaim(transcript)` — regex parse of STT transcript → `{ count, rank } | null`
5. `CLAIM_REGEX` and `FILLER_WORDS_TO_NUM` constants
6. The locked invariants that protect gameplay correctness (20 cards, unique IDs, uniform shuffle, parse precision)

**NOT in this spec** (handled elsewhere):
- Voice presets + STT heuristic + lie-score derivation — `voice-tell-taxonomy` spec
- Claim validation against FSM state (does the active player actually hold those cards?) — `game-engine` spec via `ClaimMade` transition
- TTS / audio generation — `voice-tell-taxonomy` + `§1.5` layers
- Target rank selection policy (which rank per round) — belongs inside `dealFresh` but the *game rule* that it changes per round is `game-engine` spec
- `VoiceMeta.parsed` field population — caller (API route) combines `parseClaim` output with `stt.ts` output

## Canonical sources

- Architecture §1.1 (deck + deal mechanics) and §5.2 (voice parsing regex) in [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) — iter-5 locked. Architecture's parseClaim code is the authoritative reference below.
- Consumer spec: `game-engine` — defines `RoundDeal` interface in `.kiro/specs/game-engine/design.md` §2. `dealFresh` produces that exact shape.
- Steering: `.kiro/steering/structure.md` — names the implementation files `src/lib/game/deck.ts` + `src/lib/game/claims.ts`.

---

## 1. Types

All types already live in `src/lib/game/types.ts` (shipped in commit `0ef7d5e`). This spec references them; no new types needed.

```ts
// Already exported — this spec just uses these.
type Rank = 'Queen' | 'King' | 'Ace' | 'Jack';
interface Card { id: string; rank: Rank; }

// From game-engine spec §2 — this spec's dealFresh() produces this.
interface RoundDeal {
  playerHand: Card[];       // length === 5
  aiHand: Card[];           // length === 5
  remainingDeck: Card[];    // length === 10
  targetRank: Rank;
  activePlayer: 'player' | 'ai';
}
```

### 1.1 New constants (this spec adds)

```ts
// The 4 playable ranks — iteration-friendly alternative to typing the union manually.
export const ALL_RANKS: readonly Rank[] = ['Queen', 'King', 'Ace', 'Jack'] as const;

// Count-word → integer map for claim parsing.
export const WORD_TO_NUM: Record<string, 1 | 2> = {
  one: 1, two: 2, '1': 1, '2': 2,
};

// Claim parse regex — architecture §5.2 verbatim.
// Matches: "one queen", "ONE queen", "1 queen", "two kings", "1 queen!", "uh, one queen.".
// Word-boundaries prevent "one queenly" or "butonequeen".
// Trailing "s?" accepts both singular ("One queen") and plural ("Two queens") forms.
export const CLAIM_REGEX = /\b(one|two|1|2)\s+(queen|king|ace|jack)s?\b/i;
```

---

## 2. `makeDeck()` — the 20-card factory

```ts
/**
 * Build a canonical, unshuffled 20-card deck. Card IDs are stable per-process:
 * `${rank}-${index}` where index is 0..4 per rank.
 *
 * Determinism: same call → same order → same IDs. Tests rely on this.
 * Use shuffle(makeDeck(), rng) to randomise.
 */
export function makeDeck(): Card[];
```

### 2.1 ID scheme

- `"Queen-0"`, `"Queen-1"`, ..., `"Queen-4"`
- `"King-0"`, ..., `"King-4"`
- `"Ace-0"`, ..., `"Ace-4"`
- `"Jack-0"`, ..., `"Jack-4"`

**Why this scheme:** human-readable in debug logs (`game-debug` MCP server, autopsy UI, Vitest failure messages), stable across sessions so cached test fixtures remain valid, trivially unique across the 20-card population.

**Return order:** `[Q0, Q1, Q2, Q3, Q4, K0, K1, K2, K3, K4, A0, A1, A2, A3, A4, J0, J1, J2, J3, J4]` — grouped by rank, index ascending. Shuffle consumers should never depend on this order; tests that depend on it must call `makeDeck()` directly (not `dealFresh()`).

---

## 3. `shuffle(arr, rng)` — Fisher-Yates

```ts
/**
 * In-place-safe Fisher-Yates shuffle. Returns a NEW array (does not mutate input).
 *
 * @param arr Input array (any type).
 * @param rng Random source (0 ≤ x < 1). Defaults to `Math.random`.
 *            Pass a seeded PRNG (e.g. mulberry32) in tests for determinism.
 */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[];
```

### 3.1 Algorithm

Unbiased Fisher-Yates (Durstenfeld variant):
```ts
const out = [...arr];
for (let i = out.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [out[i], out[j]] = [out[j], out[i]];
}
return out;
```

**Correctness guard:** `j` must be in `[0, i]` inclusive. `Math.floor(rng() * (i + 1))` satisfies this given `rng() ∈ [0, 1)`.

**Uniformity:** every permutation is equally likely when rng is uniform on `[0, 1)`. Biased rngs (e.g. `() => 0.5`) will produce biased shuffles — that's acceptable for deterministic testing.

### 3.2 Purity

- No I/O. No `Math.random()` called internally (all randomness via injected `rng`).
- Input array is not mutated (first line spreads into `out`).
- Same `rng` sequence → same shuffled output.

---

## 4. `dealFresh(rng?)` — RoundDeal assembler

```ts
/**
 * Produce a complete RoundDeal: shuffled 20 cards → 5/5 hands + 10-card
 * remainingDeck + random targetRank + coin-flipped activePlayer.
 *
 * All randomness comes from the single injected `rng`. Deterministic when
 * rng is seeded.
 */
export function dealFresh(rng: () => number = Math.random): RoundDeal;
```

### 4.1 Construction

```ts
const shuffled = shuffle(makeDeck(), rng);
const playerHand = shuffled.slice(0, 5);
const aiHand = shuffled.slice(5, 10);
const remainingDeck = shuffled.slice(10);            // 10 cards
const targetRank = ALL_RANKS[Math.floor(rng() * 4)];
const activePlayer: 'player' | 'ai' = rng() < 0.5 ? 'player' : 'ai';
return { playerHand, aiHand, remainingDeck, targetRank, activePlayer };
```

### 4.2 Why a single `rng` for all four draws

- Simplest determinism contract (`dealFresh(seededRng)` → known output).
- Caller (API route) passes one `Math.random` in production; tests pass a seeded PRNG.
- The 4 draws consume rng in a fixed order: 19 swap calls + 1 rank + 1 coin = 21 rng() calls total. Seeded tests assert this exact count if needed.

### 4.3 Who calls this

- **`game-engine` reducer does NOT call `dealFresh` directly** — purity contract forbids randomness inside the reducer.
- Production caller: API routes (`/api/game/start`, `/api/game/ai-turn`) compute `dealFresh()` BEFORE dispatching `SetupComplete` / `JokerPicked` events with the result as payload.
- Test caller: Vitest specs pass `shuffle(makeDeck(), seededRng)` or a manually-constructed `RoundDeal` to FSM events.

---

## 5. `parseClaim(transcript)` — voice → claim

```ts
/**
 * Parse a player's voice transcript into a structured claim. Returns null if
 * the transcript doesn't contain a valid claim phrase.
 *
 * Pure. No I/O. Stateless regex (uses .match(), not .exec()).
 */
export function parseClaim(transcript: string): { count: 1 | 2; rank: Rank } | null;
```

### 5.1 Implementation (from architecture §5.2, verbatim)

```ts
export function parseClaim(transcript: string): { count: 1 | 2; rank: Rank } | null {
  const m = transcript.toLowerCase().match(CLAIM_REGEX);
  if (!m) return null;
  const count = WORD_TO_NUM[m[1]];
  const rank = (m[2][0].toUpperCase() + m[2].slice(1)) as Rank;
  return { count, rank };
}
```

### 5.2 Behaviour

| Transcript | Parsed output |
|---|---|
| `"One queen."` | `{ count: 1, rank: 'Queen' }` |
| `"ONE QUEEN"` | same (case-insensitive regex) |
| `"1 queen"` | same |
| `"Two queens."` | `{ count: 2, rank: 'Queen' }` (plural matched) |
| `"Two Kings"` | `{ count: 2, rank: 'King' }` |
| `"uh, one queen."` | `{ count: 1, rank: 'Queen' }` (leading filler allowed) |
| `"Just one ace"` | `{ count: 1, rank: 'Ace' }` (prefix words allowed) |
| `"one queen or two kings"` | `{ count: 1, rank: 'Queen' }` — **first match wins** |
| `""` | `null` |
| `"Three kings"` | `null` (count not in {1, 2, one, two}) |
| `"One five"` | `null` (rank not in {queen, king, ace, jack}) |
| `"onequeen"` | `null` (word boundary prevents this) |
| `"queenly one"` | `null` (word order must be `count rank`) |

### 5.3 Known limitations (acceptable for MVP)

- **First-match-wins**: "two queens or one king" parses as `{2, Queen}`, ignoring the "or one king". Player rarely says this in a real turn; demo-safe.
- **No homophone correction**: "Won queen" (a Scribe misrecognition of "One queen") doesn't parse. UI retry handles this (game-engine spec §5.1 edge cases).
- **No number-over-two support**: "Three queens" doesn't parse — by design, architecture §1.1 locks turn output to 1-2 cards only.

---

## 6. Invariants (Vitest — MANDATORY)

Tests live in `src/lib/game/deck.test.ts` and `src/lib/game/claims.test.ts`.

### `makeDeck` / `shuffle` / `dealFresh`

1. **Deck size:** `makeDeck().length === 20`.
2. **Rank distribution:** exactly 5 cards of each rank. `makeDeck().filter(c => c.rank === 'Queen').length === 5` (same for K/A/J).
3. **Unique IDs:** `new Set(makeDeck().map(c => c.id)).size === 20`.
4. **Stable IDs across calls:** `makeDeck()[0].id === makeDeck()[0].id` (deterministic).
5. **`shuffle` doesn't mutate input:** given `const d = makeDeck()`, calling `shuffle(d, rng)` leaves `d` in original order.
6. **`shuffle` preserves element set:** the multiset of `shuffle(d, rng)` equals the multiset of `d` — no duplicates introduced, no cards dropped.
7. **`shuffle` is deterministic with seeded rng:** two `shuffle(d, sameSeededRng)` calls with independent seed streams of the same seed produce identical outputs.
8. **`shuffle` uniformity smoke test:** run shuffle 1000× with `Math.random`, assert each of the 20 cards appears in position 0 at least 10 times (avoids dead-zone bugs). Non-rigorous but catches disasters.
9. **`dealFresh` hand sizes:** `playerHand.length === 5 && aiHand.length === 5 && remainingDeck.length === 10`.
10. **`dealFresh` no duplicates across partitions:** union of all three partitions has 20 unique IDs.
11. **`dealFresh` targetRank valid:** `ALL_RANKS.includes(result.targetRank)`.
12. **`dealFresh` activePlayer valid:** `result.activePlayer === 'player' || result.activePlayer === 'ai'`.
13. **`dealFresh` determinism with seeded rng:** two `dealFresh(sameSeedRng)` calls produce identical `RoundDeal` objects (deep-equal).

### `parseClaim`

14. **Positive matches:** parameterised test over 32 meaningful variants — `2 word-counts (one, two) × 4 ranks × 3 casings = 24` + `2 digit-counts (1, 2) × 4 ranks × 1 casing = 8` (digits don't casing-permute) → all parse to expected `{ count, rank }`. Earlier spec draft said "48" but that double-counted digits across nonexistent casing states.
15. **Numeric digits:** `"1 queen"` and `"2 queens"` parse same as word forms.
16. **Leading/trailing noise:** `"uh, one queen."` / `"One queen, please."` / `"Just two kings"` all parse correctly.
17. **First-match-wins:** `"two queens or one king"` → `{2, Queen}`.
18. **Empty string:** `parseClaim('')` → `null`.
19. **Non-claim text:** `"Hello world"` / `"I pass"` / `"nope"` → `null`.
20. **Out-of-range count:** `"three queens"` / `"zero aces"` / `"five kings"` → `null`.
21. **Invalid rank:** `"one five"` / `"two banana"` → `null`.
22. **Word-boundary:** `"butonequeenly"` / `"antonequeen"` → `null`.
23. **Wrong order:** `"queens one"` → `null` (count must precede rank).
24. **No-space variant:** `"1queen"` → `null` (regex requires `\s+` between count and rank).
25. **Purity:** calling `parseClaim` twice with the same input returns deep-equal output (no regex lastIndex leak across calls).

---

## 7. Out of scope

- Claim validation against FSM state (`game-engine`'s `ClaimMade` transition)
- Voice recording / MediaRecorder wiring (client-side, future)
- Scribe API call (`voice-tell-taxonomy` / `stt.ts`)
- Retry UI on parse failure (`game-engine` §5.1 edge cases)
- Button-based claim fallback (UI-level, future)
- Homophone correction or fuzzy rank matching

---

## 8. Dependencies

This spec depends on (but does NOT implement):

| Dep | Owner | Purpose |
|---|---|---|
| `Card`, `Rank` types | `src/lib/game/types.ts` (already shipped) | Deck + RoundDeal shape |
| `RoundDeal` interface | `game-engine` spec §2 (will be exported from types.ts when game-engine impl lands) | `dealFresh()` returns this |

**Consumers of this spec:**
- `/api/game/start` — calls `dealFresh()` for SetupComplete event's `initialDeal` payload
- `/api/game/ai-turn` + joker flow — calls `dealFresh()` for JokerPicked event's `nextRoundDeal` payload
- `/api/game/claim` — calls `parseClaim(transcript)` + merges with `stt.ts` output into full `VoiceMeta`

None of the consumers exist yet — they're built in Day 3 (LLM orchestrator) and Day 5 (full wiring).
