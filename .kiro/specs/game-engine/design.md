---
inclusion: fileMatch
fileMatchPattern: "src/lib/game/**/*.ts|src/lib/game/fsm.ts|src/lib/game/types.ts"
---

# game-engine — Design

Pure-TypeScript finite state machine for a best-of-3 voice-bluffing card game (1 human vs 1 AI).

**Scope of this spec:** turn / round / session transitions, hand/pile/takenCards bookkeeping, strike accounting, round-end and session-end detection, joker-effect slots, inter-round reshuffle+redeal.

**NOT in this spec** (handled elsewhere):
- AI decisioning (`ai-opponent` spec)
- Voice presets + STT heuristic (`voice-tell-taxonomy` spec)
- Deck factory + shuffle + claim parsing (`deck-and-claims` spec — consumed by this FSM)
- Joker effect implementations (`joker-system` spec — this FSM only reads/writes `activeJokerEffects` slots)
- Probe flow internals (`probe-phase` spec — this FSM only branches into it)
- Tension music (`tension-music-system` spec — this FSM only updates `tensionLevel`)
- Strikes UI rendering (`strikes-penalty-system` spec — this FSM owns the counter, not the render)
- §1.5 Elimination Beat (presentation-only, consumes `session_over` transition — zero type impact)

## Canonical source

See [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) §4 (data model) and §5 (turn flow). This design.md is the authoritative TypeScript-level codification; the architecture file is the authoritative prose rationale. If they diverge, flag it — do not silently resolve.

**2026-04-17 iter-1 review patches** (applied post-Kiro spec generation, before implementation):
1. Added `PlayerState.takenCards: Card[]` — cards a player takes when losing a challenge go here (not hand, not a global discard)
2. Caught-on-final-card-lie → round ends immediately with opponent as winner (no more "round continues with empty hand" ambiguity)
3. `Timeout` event carries `cardIdToPlay: string` chosen by caller (reducer stays pure)
4. Inter-round reshuffle+redeal: `JokerPicked` event carries fresh `nextRoundDeal` chosen by caller; caller reshuffles all 20 cards between rounds

These changes do not re-open the iter-5 locked architecture decisions — they fill gaps in the game-engine-spec translation, not alter the game design.

---

## 1. State machine

### 1.1 States

**Session-level** (`Session.status`):

| State | Meaning |
|---|---|
| `setup` | Session created, shuffling deck, dealing, pre-generating 3 music tracks |
| `round_active` | A round is in progress. Round-level status lives in `Round.status`. |
| `joker_offer` | A round just ended, winner picks 1-of-3 jokers |
| `session_over` | 2 rounds won OR 3 strikes reached. Terminal state. |

**Round-level** (`Round.status`):

| State | Meaning |
|---|---|
| `claim_phase` | Active player selects cards + voices claim |
| `response_phase` | Opponent accepts or challenges |
| `resolving` | Challenge was called; revealing cards, distributing strike/pile |
| `round_over` | Round decided; transitioning to `joker_offer` or `session_over` |

**Pseudo-state (not stored):** `probe_phase` — inserted **before** an AI `claim_phase` if `Round.activeJokerEffects` contains a `stage_whisper` entry. The FSM calls the probe-phase spec's handler (out-of-spec here), then consumes the effect, then proceeds to the AI's `claim_phase`. No new persisted state.

### 1.2 State diagram

```
                 ┌──────────┐
                 │  setup   │   (shuffle + deal + music pre-gen)
                 └─────┬────┘
                       │ SetupComplete(initialDeal)
                       ▼
              ┌──────────────────┐
              │  round_active    │
              │                  │
              │   ┌──────────┐   │
              │   │  [probe] │ ← only if AI's turn AND stage_whisper active
              │   └────┬─────┘   │
              │        ▼         │
              │  ┌─────────────┐ │
              │  │ claim_phase │ │
              │  └──────┬──────┘ │
              │         │ ClaimMade OR Timeout(active_player, cardIdToPlay)
              │         ▼        │
              │  ┌───────────────┐
              │  │response_phase │
              │  └──────┬────────┘
              │         │                │
              │ ClaimAccepted  ChallengeCalled
              │ OR Timeout      │         │
              │    (responder)  ▼         │
              │    │     ┌────────────┐   │
              │    │     │ resolving  │   │
              │    │     └──────┬─────┘   │
              │    │            │         │
              │    │   RevealComplete(challengeWasCorrect)
              │    │            │         │
              │    │   [3-strikes?] → session_over (immediately)
              │    │   [caught-on-final-card-lie?] → round_over (opponent wins immediately)
              │    │   [honest-final-wrongly-challenged?] → round_over (active wins immediately)
              │    │   else: swap active → claim_phase
              │    ▼            ▼         │
              │  (round-end    (round-end  │
              │   check) OR     or swap   │
              │   swap active)  active)   │
              └────────────────────────────┘
                               ▼
                      ┌────────────────┐
                      │  joker_offer   │
                      └───────┬────────┘
                              │ JokerPicked(joker, nextRoundDeal)
                              │ OR JokerOfferSkippedSessionOver
                              ▼
                      (new Round appended with fresh 5/5 deal,
                       Session.currentRoundIdx++)
                              │
                              ▼
                     ┌────────────────┐
                     │ round_active   │ (next)
                     └────────────────┘
                              │
                              ▼
                          ... or ...
                     ┌────────────────┐
                     │ session_over   │  (terminal)
                     └────────────────┘
```

### 1.3 Transition table

Every transition is a pure function `(Session, Event) → Session`. No I/O. No `Math.random()`. No `Date.now()` — all time and randomness injected via events.

| Current | Event | Next | Invariant fired |
|---|---|---|---|
| `setup` | `SetupComplete(initialDeal)` | `round_active` with fresh `Round` | Deck shuffled by caller; `initialDeal.playerHand.length === 5`; `initialDeal.aiHand.length === 5`; `initialDeal.remainingDeck.length === 10`; `initialDeal.targetRank ∈ {Queen, King, Ace, Jack}`; `initialDeal.activePlayer` set (caller coin-flipped); pile empty; both `takenCards` empty; `Session.deck = initialDeal.remainingDeck`; 3 music tracks URLs present |
| `claim_phase` | `ClaimMade(claim)` | `response_phase` | `claim.count ∈ {1,2}`; `claim.actualCardIds.length === claim.count`; every ID exists in active player's hand pre-removal; cards removed from hand; cards appended to `Round.pile`; `claimHistory` appended |
| `response_phase` | `ClaimAccepted` | `claim_phase` (swap active) OR `round_over` | Run round-end check first; if active player hand now empty AND claim was accepted → `round.winner = active`, status `round_over` |
| `response_phase` | `ChallengeCalled` | `resolving` | — |
| `resolving` | `RevealComplete(challengeWasCorrect)` | One of: `session_over` / `round_over` / `claim_phase` (swap) | **(1)** Increment strike on exactly one player: claimant if caught lying, else challenger. **(2)** Move `Round.pile` → that-same-player's `takenCards` (append); clear `Round.pile = []`. **(3)** Check session-end (strikes==3) first — if yes, `session_over`. **(4)** Else check round-end: caught-on-final-card-lie (active's hand now 0, challenge was correct) → `round_over`, winner = opponent; honest-final-wrongly-challenged (active's hand now 0, challenge was wrong) → `round_over`, winner = active. **(5)** Else swap active, `claim_phase`. |
| `claim_phase` / `response_phase` | `Timeout(kind, cardIdToPlay?)` | depends on kind | `kind='active_player'`: auto-fire `ClaimMade` with `cardIdToPlay` (caller-provided, caller's randomness), count=1, `claimedRank = targetRank`, truthState derived normally. `kind='responder'`: treat as `ClaimAccepted`. |
| `round_over` | `RoundSettled` | `joker_offer` OR `session_over` | Increment `roundsWon[winner]`. If `roundsWon === 2` → `session_over`. Else → `joker_offer`. |
| `joker_offer` | `JokerPicked(joker, nextRoundDeal)` | `round_active` (new Round, `currentRoundIdx++`) | Append joker to winner's `jokers`. Caller-provided `nextRoundDeal` has fresh shuffled 5/5 hands + `remainingDeck[10]` + new target rank + `activePlayer`. Install all three pools: `player.hand = nextRoundDeal.playerHand`, `ai.hand = nextRoundDeal.aiHand`, `Session.deck = nextRoundDeal.remainingDeck`. Previous `takenCards` and `Round.pile` cleared back to [] on both players. Strikes / roundsWon / jokers carry forward unchanged. |
| `joker_offer` | `JokerOfferSkippedSessionOver` | `session_over` | Only used if gameplay-layer determines session should end at this exact joint (rare — normally `session_over` transition happens from `resolving`). |
| `session_over` | any | throws `InvalidTransitionError` | Terminal state. |

### 1.4 Strike / round / session / deal rules (LOCKED)

1. **Strike = +1** applied to exactly one player per challenge resolution.
2. **Strikes cumulative across rounds.** They do NOT reset.
3. **Session loss (3 strikes):** checked AFTER strike increment AND BEFORE round-end. `strikes === 3` → `session_over`, loser = player with 3 strikes, winner = opponent.
4. **Round win (honest hand-empty):** normal round-end path — active player's hand empty AND last claim was accepted or truthful → `round_over`, winner = active player.
5. **Caught-on-final-card-lie ends the round immediately:** sequence `[active plays final card lying, opponent challenges]` → strike+1 on active, `round.pile → active.takenCards`, **`round_over` with `winner = opponent`**. No "round continues" ambiguity; liar can't continue, opponent wins the round. (Prevents empty-hand-stall; simplifies reducer.)
6. **Honest-final-wrongly-challenged ends the round immediately:** sequence `[active plays final card honestly, opponent challenges]` → strike+1 on challenger, `round.pile → challenger.takenCards`, `round_over` with `winner = active`.
7. **Session winner is FIRST of:** opponent hits 3 strikes → current player wins; OR `roundsWon === 2` → that player wins. (Best-of-3 cannot go past round 3.)
8. **Simultaneous strike-3 impossible:** each resolution increments exactly one player's strike.
9. **Inter-round reshuffle+redeal:** on `JokerPicked`, caller collects all 20 cards (`player.hand` + `ai.hand` + `round.pile` + `player.takenCards` + `ai.takenCards` + `Session.deck`), reshuffles (Fisher-Yates or equivalent — caller's randomness), picks new `activePlayer` + `targetRank`, and splits into `RoundDeal { playerHand[5], aiHand[5], remainingDeck[10], ... }`. Reducer installs the three pools, clears `round.pile = []` and both `takenCards = []`, appends new `Round`.

---

## 2. Types (authoritative)

Mirror of architecture §4 with one addition: `PlayerState.takenCards: Card[]`. All other types unchanged.

```ts
type Rank = 'Queen' | 'King' | 'Ace' | 'Jack';
type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
type TruthState = 'honest' | 'lying';
type JokerType = 'poker_face' | 'stage_whisper' | 'earful' | 'cold_read' | 'second_wind';

interface Card {
  id: string;        // stable per session, `${rank}-${i}` where i ∈ 0..4 — e.g. `Queen-0`, `King-3` (shipped convention per deck-and-claims spec Task 2.1)
  rank: Rank;
}

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
}

interface VoiceMeta {
  latencyMs: number;
  fillerCount: number;
  pauseCount: number;
  speechRateWpm: number;
  lieScore: number;                              // 0..1 normalized
  parsed: { count: number; rank: Rank } | null;  // null = unparseable, triggers retry
}

interface Claim {
  by: 'player' | 'ai';
  count: number;                                 // 1 | 2
  claimedRank: Rank;
  actualCardIds: string[];                       // SERVER-ONLY — stripped by toClientView
  truthState: TruthState;                        // derived server-side
  voiceMeta?: VoiceMeta;                         // player claims only
  ttsSettings?: VoiceSettings;                   // AI claims only
  llmReasoning?: string;                         // AI claims only — autopsy post-round
  claimText?: string;                            // dialogue variant
  timestamp: number;
}

interface PublicClaim {
  by: 'player' | 'ai';
  count: number;
  claimedRank: Rank;
  claimText?: string;
  timestamp: number;
}

interface Round {
  roundNumber: 1 | 2 | 3;
  targetRank: Rank;
  activePlayer: 'player' | 'ai';
  pile: Card[];
  claimHistory: Claim[];
  status: 'claim_phase' | 'response_phase' | 'resolving' | 'round_over';
  activeJokerEffects: {
    type: JokerType;
    expiresAfter: 'next_claim' | 'next_challenge' | 'session';
  }[];
  tensionLevel: number;                          // 0..1
  winner?: 'player' | 'ai';
}

interface PlayerState {
  hand: Card[];
  takenCards: Card[];                            // NEW — cards this player took after losing a challenge
  roundsWon: number;
  strikes: number;                               // 0..3
  jokers: JokerType[];
  personaIfAi?: Persona;
}

interface Session {
  id: string;
  player: PlayerState;
  ai: PlayerState;
  deck: Card[];                                  // 10 undealt cards for the current round (not a replay artifact). After SetupComplete and after JokerPicked, length === 10.
  rounds: Round[];
  currentRoundIdx: number;
  status: 'setup' | 'round_active' | 'joker_offer' | 'session_over';
  sessionWinner?: 'player' | 'ai';
  musicTracks: { level: 'calm' | 'tense' | 'critical'; url: string }[];
}

// Wire format — the ONLY thing that crosses to client
interface ClientSession {
  id: string;
  self: PlayerState;
  opponent: Omit<PlayerState, 'hand'> & { handSize: number };  // opponent's takenCards remain visible (fair-info)
  rounds: ClientRound[];
  currentRoundIdx: number;
  status: Session['status'];
  sessionWinner?: Session['sessionWinner'];
  currentMusicUrl?: string;
}

interface ClientRound extends Omit<Round, 'claimHistory' | 'pile'> {
  claimHistory: PublicClaim[];
  pileSize: number;
}

// Auxiliary types used in events (caller-provided)
interface RoundDeal {
  playerHand: Card[];                            // length === 5
  aiHand: Card[];                                // length === 5
  remainingDeck: Card[];                         // length === 10 — the undealt cards for this round
  targetRank: Rank;
  activePlayer: 'player' | 'ai';
}
// Invariant: playerHand + aiHand + remainingDeck === all 20 cards, no duplicates.
```

---

## 3. FSM interface (pure TS, no I/O)

### 3.1 Event union

```ts
type GameEvent =
  | { type: 'SetupComplete'; now: number; initialDeal: RoundDeal; musicTracks: Session['musicTracks'] }
  | { type: 'ClaimMade'; claim: Claim; now: number }
  | { type: 'ClaimAccepted'; now: number }
  | { type: 'ChallengeCalled'; now: number }
  | { type: 'RevealComplete'; challengeWasCorrect: boolean; now: number }
  | { type: 'RoundSettled'; now: number }
  | { type: 'JokerPicked'; joker: JokerType; nextRoundDeal: RoundDeal; now: number }
  | { type: 'JokerOfferSkippedSessionOver'; now: number }
  | { type: 'Timeout'; kind: 'active_player'; cardIdToPlay: string; now: number }
  | { type: 'Timeout'; kind: 'responder'; now: number };
```

### 3.2 Reducer signature

```ts
function reduce(session: Session, event: GameEvent): Session;
```

**Contract:**
- Pure function — no `Date.now()`, no `Math.random()`, no `fetch`, no `console.*` outside DEBUG guard.
- Returns a new `Session` object — never mutates input. (Immutability makes Vitest snapshots trivial.)
- If the event is invalid for the current state, throw `InvalidTransitionError(currentState, eventType)`. Never silently no-op.
- All randomness + time is injected via caller (e.g., caller shuffles deck, passes `now` in events, generates `Card.id` values, picks `cardIdToPlay` on timeout, computes `nextRoundDeal`).

### 3.3 Timeouts

- **Active-player timeout (30s):** caller fires `Timeout { kind: 'active_player', cardIdToPlay }`. The caller (API route) picks which card to play (typically at-random client-side). Reducer auto-generates a `ClaimMade` from that card: `count = 1`, `claimedRank = round.targetRank`, `actualCardIds = [cardIdToPlay]`, `truthState` derived normally from whether the card matches target. Reducer stays pure.
- **Responder timeout (30s):** caller fires `Timeout { kind: 'responder' }`. Reducer treats as `ClaimAccepted`.

Timer orchestration lives in the API-route layer — FSM only reacts to `Timeout` events.

### 3.4 Helper functions (pure)

```ts
function toClientView(session: Session, viewer: 'player' | 'ai'): ClientSession;
// Strips actualCardIds from all claims
// Strips llmReasoning for opponent claims
// Reveals own hand, hides opponent hand (replaces with handSize)
// Maps Round[] → ClientRound[] (claimHistory: PublicClaim[], pileSize: number)
// Opponent's takenCards REMAIN visible (public info — you saw them take the pile)

function checkSessionEnd(session: Session): 'player' | 'ai' | null;
// Returns winner if session should end, null otherwise.
// Priority: strike-3 loss > rounds-won-reaches-2.

function checkRoundEnd(
  round: Round,
  activePlayer: 'player' | 'ai',
  activePlayerHandSize: number
): { ended: true; winner: 'player' | 'ai' } | { ended: false };
// True if hand empty AND last claim was accepted or truthful.
// Caller must pass post-resolution state (after strike + pile transfer).

function applyJokerEffect(round: Round, joker: JokerType): Round;
// For effects with `next_claim` expiry, push onto activeJokerEffects.
// For effects with `session` expiry (e.g. second_wind), hoist to Session level (handled by joker-system spec).

function expireJokerEffects(round: Round, trigger: 'next_claim' | 'next_challenge'): Round;
// Filter out expired effects after the trigger fires.
```

---

## 4. Invariants (Vitest tests — MANDATORY)

All must exist in `src/lib/game/fsm.test.ts` or `src/lib/game/types.test.ts`:

1. **Deck size:** fresh deck has exactly 20 cards: 5 Queen + 5 King + 5 Ace + 5 Jack. Card IDs unique. *(covered here; factory lives in `deck-and-claims` spec — test imports it.)*
2. **Deal:** after `SetupComplete`, each player has exactly 5 cards; `Session.deck.length === 10`; pile is empty; both `takenCards` are empty; target rank ∈ {Queen, King, Ace, Jack}; 3 music tracks present.
3. **Claim validation:** `claim.actualCardIds.length === claim.count` and every ID exists in active player's hand pre-removal.
4. **Card conservation (expanded):** `Session.deck.length + player.hand.length + ai.hand.length + round.pile.length + player.takenCards.length + ai.takenCards.length === 20` at every reducer tick. All 20 cards accounted for across the six pools.
5. **Truth derivation:** `claim.truthState === 'honest'` iff every actualCard has `rank === claimedRank`.
6. **Caught-on-final-card-lie → round ends opponent-wins:** sequence `[play final card lying, opponent challenges]` → `round.status === 'round_over'`, `round.winner === opponent`, active strikes +1, active.takenCards has the pile contents.
7. **Honest-final-wrongly-challenged → round ends active-wins:** sequence `[play final card honest, opponent challenges]` → `round.status === 'round_over'`, `round.winner === active`, challenger strikes +1, challenger.takenCards has the pile contents.
8. **Forced-lie:** hand with zero target rank cards → active player MUST lie (reducer accepts, doesn't error).
9. **Simultaneous strike-3 impossible:** no single resolution increments both players' strikes.
10. **Session loss trigger:** `strikes === 3` in same reducer tick as the increment → `Session.status === 'session_over'`, correct winner.
11. **Best-of-3 win trigger:** `roundsWon === 2` → `session_over`, correct winner.
12. **toClientView isolation:** serialized output contains NO `actualCardIds` field anywhere; opponent's `hand` is absent, `handSize` is present; opponent's `takenCards` remains visible (public info).
13. **Misdirector preset invariant** (lives in voice-preset tests, referenced here for cross-spec sanity): `VOICE_PRESETS.Misdirector.honest.stability < VOICE_PRESETS.Misdirector.lying.stability`.
14. **Reducer purity:** reducer called twice with identical inputs returns structurally-equal outputs; does not depend on `Date.now()` / `Math.random()`. Specifically: given the same `Timeout(active_player, cardIdToPlay)` event twice, returns identical Session.
15. **Invalid transitions throw:** e.g., `ClaimAccepted` fired during `claim_phase` throws `InvalidTransitionError`. Any event in `session_over` throws.
16. **Inter-round reshuffle:** after `JokerPicked`, both hands have length 5, `Session.deck.length === 10`, `round.pile === []`, `player.takenCards === []`, `ai.takenCards === []`, new Round appended with fresh `targetRank`, `currentRoundIdx` incremented, strikes/roundsWon/jokers carried forward unchanged.

---

## 5. Out of scope

- Deck shuffle algorithm (Fisher-Yates) — in `deck-and-claims` spec
- Card ID generation strategy — in `deck-and-claims` spec
- Voice claim parsing — in `deck-and-claims` spec (regex)
- STT metadata computation → `lieScore` — in `voice-tell-taxonomy` spec
- AI challenge / own-play decisioning — in `ai-opponent` spec
- Joker-offer randomization (which 3 to offer) — in `joker-system` spec
- Joker effect implementations (Earful autopsy read, Cold Read weight adjustment, etc.) — in `joker-system` spec
- Probe-phase LLM flow — in `probe-phase` spec
- Tension-level computation + music bucket mapping — in `tension-music-system` spec
- Elimination-beat SFX/TTS orchestration — §1.5 consumer, not part of FSM

## 6. Dependencies

This spec depends on (but does NOT implement):

| Dep | Owner spec | What FSM needs from it |
|---|---|---|
| `shuffleDeck()`, `dealFresh()`, `parseClaim()` | `deck-and-claims` | Caller uses these to build `initialDeal` and `nextRoundDeal` RoundDeal objects, passes them into SetupComplete and JokerPicked events |
| `VOICE_PRESETS` (read-only ref) | `voice-tell-taxonomy` | AI claim's `ttsSettings` populated here |
| `getAIDecision(claim)`, `getAIPlay()` | `ai-opponent` | Called by API-route layer, result fed to FSM as events |
| `offerJokers(winner)` | `joker-system` | Randomly select 3, presented between rounds |
| `probePhase(session, probeText)` | `probe-phase` | Called by API-route layer pre-AI-claim when `stage_whisper` active |

All of the above are OUT of `game-engine`'s scope. The FSM consumes their results via events; it never calls them directly.

---

## 7. Architecture consistency note

The 4 iter-1 fixes (takenCards field, caught-on-final-card-lie → round-over, Timeout cardIdToPlay, inter-round reshuffle) fill gaps in the architecture's game-mechanic prose rather than pivot design. Architecture §4 (type definitions) and §1.1 (mechanics) should be updated to reflect:
- Add `takenCards: Card[]` to PlayerState
- Clarify "caught on final card" → "round ends immediately, opponent wins the round"
- Clarify "deal" happens per-round, not just at session start

Architecture update is the user's call (post-iter-5 patches have happened before, e.g. §1.5). Not blocking for implementation.
