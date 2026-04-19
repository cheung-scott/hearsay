# Implementation Plan: Joker System

## ⚠ Spec drift flag (escalation — do not silently resolve)

**Cross-spec drift found during Task 2 implementation (2026-04-19):**

Three flavor strings in `.kiro/steering/product.md` "Session-Jokers" table exceed the 80-char cap specified by Requirement 1.2 / Task 3:

| Joker | chars | status |
|---|---|---|
| poker_face | 88 | exceeds |
| stage_whisper | 112 | exceeds |
| earful | 77 | OK |
| cold_read | 87 | exceeds |
| second_wind | 56 | OK |

Additionally, `design.md` §5 has a DIFFERENT set of courtroom-themed flavors (all ≤80) plus a "Naming + flavor lock" clause saying product.md and design.md must be updated in the same PR — but they are currently out of sync.

**Current resolution (provisional, pending Scott's call):** Task 2 copied product.md strings verbatim per its explicit "character-for-character" instruction and Req 1.4. In Task 3, the I13 drift guard (product.md ↔ catalog) is kept live; the standalone `flavor.length ≤ 80` assertion is commented-out with a reference to this flag. Scott to decide: either (a) shorten product.md flavors to ≤80, (b) raise the cap, or (c) resync product.md to design.md §5's courtroom flavors.

## Overview

Cross-cutting joker meta-system extending the game-engine FSM with 5 joker definitions, draw-pile/offer mechanics, slot lifecycle, and effect handlers. Implementation follows strict dependency order: types extension → catalog → lifecycle (pure, no FSM coupling) → FSM reducer additions → effects (simplest-3 first) → toClientView projections → Earful (blocks on voice-tell-taxonomy) → Stage Whisper (blocks on probe-phase) → integration suite. All code is pure (no I/O). Testing via Vitest with co-located test files.

Pre-landed in commit `29f6a34`: `src/lib/jokers/types.ts` (JokerSlot, JokerOffer stubs), `src/lib/game/types.ts` (Session/Round/PlayerState optional fields, GameEvent variants, ActiveProbe, etc.), stub reducer case-branches in `fsm.ts`, projection gates in `toClientView.ts`. Tasks MUST import/extend these, NOT re-declare.

## Tasks

- [x] 1. Extend joker types in `src/lib/jokers/types.ts`
  - Extend the pre-landed `JokerSlot` to add `state: 'held' | 'consumed'`, `acquiredRoundIdx: number`, `consumedRoundIdx?: number` (the pre-landed version only has `joker` and `acquiredAt` — extend, don't break existing shape)
  - Define `Joker` interface (type, name, flavor, triggers, duration, cost, visibleOnActivate, accentVar)
  - Define `JokerTrigger` union: `self_claim_phase | pre_ai_claim | opponent_claim_resolved | on_my_strike`
  - Define `JokerDuration` union: `next_claim | next_challenge | one_shot_on_use | session`
  - Define `JokerCost` union: `{ kind: 'none' } | { kind: 'reveal_own_card'; count: 1 } | { kind: 'strike_penalty'; amount: 1 }`
  - Define `ProbeRequest` with LOCKED shape: `{ whisperId: string; targetAiId: 'ai'; roundIdx: number; triggeredAtTurn: number; now: number; mathProb?: number }` — byte-for-byte aligned with probe-phase §4
  - Do NOT re-declare `JokerOffer` (already pre-landed) — only extend if needed
  - Do NOT modify `src/lib/game/types.ts` field declarations — they're pre-landed
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Implement joker catalog in `src/lib/jokers/catalog.ts`
  - Define `JOKER_CATALOG: Record<JokerType, Joker>` as a frozen const with all 5 entries
  - Poker Face: trigger `self_claim_phase`, duration `next_claim`, cost `none`, visible `true`, accent `--joker-poker-face: #c9bfa3`
  - Stage Whisper: trigger `pre_ai_claim`, duration `one_shot_on_use`, cost `none`, visible `true`, accent `--joker-stage-whisper: #55c6fd`
  - Earful: trigger `opponent_claim_resolved`, duration `one_shot_on_use`, cost `none`, visible `true`, accent `--joker-earful: #fda200`
  - Cold Read: trigger `opponent_claim_resolved`, duration `next_challenge`, cost `none`, visible `true`, accent `--joker-cold-read: #e8e8e8`
  - Second Wind: trigger `on_my_strike`, duration `one_shot_on_use`, cost `none`, visible `true`, accent `--joker-second-wind: #fd5f55`
  - Flavor strings MUST match `steering/product.md` character-for-character
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 3. Write catalog tests in `src/lib/jokers/catalog.test.ts`
  - **I13 drift guard:** load `steering/product.md`, extract the 5 one-line descriptions from the "Session-Jokers" table, assert each matches `JOKER_CATALOG[type].flavor` character-for-character
  - Assert catalog has exactly 5 entries matching the 5 `JokerType` literals
  - Assert all `accentVar` values are valid CSS custom property format (`--joker-*`)
  - Assert all flavor strings are ≤ 80 characters
  - Assert all v1 jokers have `visibleOnActivate: true` and `cost.kind === 'none'`
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Implement lifecycle helpers in `src/lib/jokers/lifecycle.ts`
  - `seedDrawPile(): JokerType[]` — returns stable ordered array of 15 jokers (3× each type in canonical order: poker_face, stage_whisper, earful, cold_read, second_wind)
  - `pickOffer(drawPile: JokerType[], rng: () => number): { offered: JokerType[], remaining: JokerType[] }` — dedup by type before sampling, offer length = min(3, distinct types remaining), remaining = drawPile minus offered copies
  - `canActivate(joker: JokerType, roundStatus: Round['status'], activePlayer: 'player' | 'ai', by: 'player' | 'ai', jokerTriggeredThisRound: JokerType[]): boolean` — validates trigger window + no-stacking
  - `advanceSlot(slots: JokerSlot[], jokerType: JokerType, roundIdx: number): JokerSlot[]` — transitions matching slot from `held` → `consumed`, sets `consumedRoundIdx`
  - All functions are pure — no I/O, no randomness (rng injected)
  - _Requirements: 3.2, 3.3, 4.2, 4.4, 7.1, 8.2, 8.3_

- [ ] 5. Write lifecycle tests in `src/lib/jokers/lifecycle.test.ts`
  - **I9:** `seedDrawPile()` returns exactly 15 jokers with 3 of each of 5 types
  - **I1:** `canActivate` rejects Poker Face during `response_phase` (trigger mismatch)
  - **I11:** `canActivate` rejects same joker type if already in `jokerTriggeredThisRound`
  - **I8:** `pickOffer` with full pile returns 3 distinct types; unpicked types remain in pile
  - Test `pickOffer` with 2 distinct types remaining returns offer of length 2
  - Test `pickOffer` with empty pile returns empty offer
  - Test `advanceSlot` transitions `held` → `consumed` and sets `consumedRoundIdx`
  - Test `advanceSlot` throws if joker not found in slots with `state: 'held'`
  - _Requirements: 3.2, 3.3, 4.2, 4.4, 7.1, 8.2, 8.3_

- [ ] 6. Checkpoint — run `pnpm vitest run src/lib/jokers/`
  - Ensure catalog + lifecycle tests pass before touching the FSM reducer

- [ ] 7. Implement FSM reducer additions in `src/lib/game/fsm.ts` — JokerOffered, JokerOfferEmpty, JokerPicked extension
  - **JokerOffered handler:** validate `Session.status === 'joker_offer'`, set `Session.currentOffer = { offered, offeredToWinner: <round winner> }`, update `Session.jokerDrawPile = event.newDrawPile`
  - **JokerOfferEmpty handler:** validate `Session.status === 'joker_offer'` and pile empty, transition directly to next round via `event.nextRoundDeal` (same as JokerPicked's round-creation logic minus joker pick), no `currentOffer` set
  - **JokerPicked extension:** in addition to existing logic, push new `JokerSlot { joker, state: 'held', acquiredRoundIdx }` to winner's `jokerSlots`, push 2 un-picked from `currentOffer.offered` to `Session.discardedJokers`, clear `currentOffer`, mirror to legacy `jokers[]`. Validate joker is in `currentOffer.offered` (throw `joker_not_offered`), validate `currentOffer` exists (throw `no_current_offer`), validate slot cap ≤ 3 (throw `slot_cap_exceeded`)
  - **SetupComplete extension:** seed `Session.jokerDrawPile` from `event.initialJokerDrawPile` or `seedDrawPile()` default; init `Session.discardedJokers = []`; init both players' `jokerSlots = []`; init `Round.jokerTriggeredThisRound = []`
  - Import helpers from `src/lib/jokers/lifecycle.ts`
  - _Requirements: 3.1, 3.2, 3.4, 4.1, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.2_

- [ ] 8. Implement FSM reducer additions in `src/lib/game/fsm.ts` — UseJoker handler + Second Wind auto-consume
  - **UseJoker handler:** validate joker held (`joker_not_held`), validate trigger window via `canActivate` (`joker_trigger_mismatch`), validate no stacking via `jokerTriggeredThisRound` (throw), call `advanceSlot` to consume, push to `jokerTriggeredThisRound`, push appropriate `ActiveJokerEffect` to `Round.activeJokerEffects` using `JOKER_CATALOG[joker].duration`. For `one_shot_on_use` jokers (Stage Whisper, Earful), push and remove in same tick. For `second_wind`, throw — it auto-consumes, never via UseJoker.
  - **Second Wind auto-consume edge in RevealComplete:** BEFORE incrementing the player's strike, check if `second_wind` is in `player.jokerSlots` with `state: 'held'`. If yes: consume it (advanceSlot), skip the strike increment, push `second_wind` to `jokerTriggeredThisRound`. If `strikes === 0` and no strike is being applied to this player, Second Wind stays `held` (inert, no error).
  - **Earful auto-consume edge in RevealComplete:** when `challengeWasCorrect === true` and `earful` is in `player.jokerSlots` with `state: 'held'`, consume it and set `Session.autopsy = { preset: claim.voicePreset ?? 'unknown', roundIdx, turnIdx }`.
  - **ProbeComplete handler:** validate `Round.activeProbe` exists (throw `no_pending_probe` if not), clear `Round.activeProbe`
  - Extend `applyJokerEffect` to accept `expiresAfter` override or dispatch by joker type using `JOKER_CATALOG[joker].duration`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.3, 11.5, 11.6, 12.1, 12.3, 14.1, 14.2, 14.3, 14.4, 16.1, 16.2, 16.3, 16.4, 16.7_

- [ ] 9. Checkpoint — run `pnpm vitest run src/lib/game/fsm.test.ts`
  - Ensure existing game-engine tests still pass after reducer additions (no regressions)

- [ ] 10. Implement simplest-3 effects in `src/lib/jokers/effects.ts` — Cold Read, Poker Face, Second Wind
  - `applyPokerFace(lieScore: number): number` — returns exactly `0.5` (deterministic override, ignores input). The API route layer calls this to mutate `DecisionContext.claim.voiceMeta.lieScore` before passing to `aiDecideOnClaim`.
  - `applyColdRead(round: Round): boolean` — returns `true` if `cold_read` is in `Round.activeJokerEffects`, signaling `toClientView` to retain `lieScore` in the PublicClaim projection
  - `applySecondWind(playerSlots: JokerSlot[]): { shouldCancel: boolean; updatedSlots: JokerSlot[] }` — checks for held `second_wind`, returns whether to cancel the strike and the updated slots with consumed state. Pure helper consumed by the RevealComplete reducer.
  - All functions are pure — no I/O
  - _Requirements: 10.1, 10.2, 13.1, 13.2, 13.3, 14.1_

- [ ] 11. Write effects tests in `src/lib/jokers/effects.test.ts` — Cold Read, Poker Face, Second Wind
  - **I6:** `applyPokerFace(0.87)` returns exactly `0.5`; `applyPokerFace(0.12)` returns exactly `0.5`
  - **I4:** `applySecondWind` with no held `second_wind` returns `shouldCancel: false`, slots unchanged
  - **I4b:** `applySecondWind` with held `second_wind` returns `shouldCancel: true`, slot consumed
  - **I5:** `applyColdRead` returns `true` when `cold_read` in activeJokerEffects, `false` otherwise
  - _Requirements: 10.2, 13.2, 14.1, 14.4_

- [ ] 12. Extend `toClientView` projections in `src/lib/game/toClientView.ts`
  - Strip `Session.jokerDrawPile` entirely from client view
  - Project `Session.discardedJokers` ONLY when `Session.status !== 'round_active'`
  - Project `Session.currentOffer` ONLY when `viewer === currentOffer.offeredToWinner`
  - Project `jokerSlots` fully in both `self` and `opponent` views (public info)
  - Project `ClientSession.autopsy` only on the self viewer (not opponent)
  - When Cold Read is active (`applyColdRead(round) === true`), retain `voiceMeta.lieScore` in the last AI claim's PublicClaim projection
  - Extend existing `toClientView.test.ts` with:
    - **I12:** player view has no `jokerDrawPile`; `discardedJokers` present when `status !== 'round_active'`, absent when `round_active`; `currentOffer` present for winner, absent for loser; `jokerSlots` present in both views; `autopsy` present for self only
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 13.2_

- [ ] 13. Checkpoint — run `pnpm vitest run`
  - Full test suite: catalog + lifecycle + effects + fsm + toClientView. All green before cross-spec effects.

- [ ] 14. Implement Earful autopsy effect in `src/lib/jokers/effects.ts`
  - `applyEarful(playerSlots: JokerSlot[], claim: Claim, roundIdx: number, turnIdx: number): { autopsy: Session['autopsy']; updatedSlots: JokerSlot[] } | null` — returns autopsy data + consumed slots if earful is held and claim has voicePreset; returns null if earful not held. Falls back to `preset: 'unknown'` if `claim.voicePreset` is undefined.
  - Pure helper consumed by the RevealComplete reducer (already wired in Task 8)
  - **BLOCKING:** depends on `VoiceTellPreset` type from `src/lib/voice/presets.ts`. Currently a `string` alias (pre-landed). If voice-tell-taxonomy spec narrows the type, update the import. Escalate to Scott if the dependency spec isn't merged yet.
  - Add test to `effects.test.ts`:
    - **I7:** Earful with held slot + `voicePreset: 'confident_honest'` + `challengeWasCorrect: true` → returns autopsy with correct preset, roundIdx, turnIdx; slot consumed
    - Test Earful with `voicePreset: undefined` → autopsy preset is `'unknown'`
    - Test Earful with no held earful slot → returns null
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 15. Implement Stage Whisper effect in `src/lib/jokers/effects.ts`
  - `produceProbeRequest(round: Round, whisperIdGen: () => string, now: number, mathProb?: number): ProbeRequest` — builds the LOCKED-shape ProbeRequest from round state
  - Pure helper consumed by the API route when Stage Whisper fires
  - **BLOCKING:** probe-phase spec's `consumeStageWhisper` / `buildActiveProbe` helpers consume this `ProbeRequest`. If probe-phase spec isn't merged yet, this function can still be implemented and tested in isolation. Escalate to Scott if integration is needed before probe-phase lands.
  - Add test to `effects.test.ts`:
    - **I3:** `produceProbeRequest` returns correct shape with `whisperId`, `targetAiId: 'ai'`, `roundIdx`, `triggeredAtTurn` matching `claimHistory.length`, `now`, optional `mathProb`
    - Test `produceProbeRequest` with `mathProb: undefined` → field absent in output
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [ ] 16. Write full integration tests in `src/lib/game/fsm.test.ts` — joker lifecycle walkthrough
  - Test complete joker flow: SetupComplete (pile seeded) → round play → RoundSettled → JokerOffered → JokerPicked (slot populated, unpicked discarded, offer cleared) → next round with joker held → UseJoker (Cold Read) → effect active → ClaimAccepted (effect expired)
  - Test Second Wind auto-consume: player has second_wind held → RevealComplete with player-strike → strike cancelled, joker consumed
  - Test Earful auto-consume: player has earful held → RevealComplete with challengeWasCorrect:true → autopsy projected
  - Test JokerOfferEmpty: empty pile → direct transition to next round
  - Test error paths: UseJoker outside trigger window, UseJoker for consumed joker, JokerPicked with invalid joker, stacking same type
  - **I2:** after UseJoker, slot state is `consumed` and effect is in `activeJokerEffects`
  - **I8:** after JokerPicked, discardedJokers has 2 unpicked, currentOffer cleared
  - **I10:** JokerOfferEmpty transitions to round_active with currentRoundIdx incremented
  - _Requirements: 3.1, 4.1, 5.1, 6.1, 6.2, 6.3, 8.1, 8.2, 8.3, 8.4, 9.1, 10.1, 12.1, 13.1, 14.1, 16.1_

- [ ] 17. Final checkpoint — run `pnpm vitest run`
  - Full suite green. All 13 invariants (I1-I13) covered. No regressions in game-engine, toClientView, or other spec test suites.

- [ ]* 18. Optional — Catalog drift guard automation
  - Add a Vitest test that reads `steering/product.md` as raw text, parses the "Session-Jokers" markdown table, and asserts each row's effect column matches `JOKER_CATALOG[type].flavor`. This is a stronger version of the I13 test in Task 3 — it parses the markdown table programmatically rather than hardcoding expected strings.
  - _Requirements: 1.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at Tasks 6, 9, 13, 17 ensure incremental validation
- **Cross-spec blocking dependencies:**
  - Task 14 (Earful): blocks on `VoiceTellPreset` narrowing from voice-tell-taxonomy spec. Currently uses `string` alias — functional but not type-narrow. Escalate to Scott if voice-tell-taxonomy hasn't exported a canonical union by Day-5.
  - Task 15 (Stage Whisper): blocks on probe-phase spec's `buildActiveProbe` / `consumeStageWhisper` for full integration. `produceProbeRequest` can be implemented and tested in isolation. Escalate to Scott if probe-phase isn't merged.
- **Do NOT modify `src/lib/game/types.ts` field declarations** — they're pre-landed in commit `29f6a34`. This spec populates them at runtime.
- **File inventory (7 files):** `src/lib/jokers/types.ts` (extend), `catalog.ts`, `catalog.test.ts`, `effects.ts`, `effects.test.ts`, `lifecycle.ts`, `lifecycle.test.ts`. Reducer additions land inline in `src/lib/game/fsm.ts`. Projection extensions land in `src/lib/game/toClientView.ts`.

### Invariant coverage map

| Invariant | Task(s) |
|---|---|
| I1 — Trigger window enforcement | 5, 16 |
| I2 — Consumed joker slot state | 5, 16 |
| I3 — Stage Whisper probe entry | 15, 16 |
| I4 — Second Wind no-op at 0 strikes | 11, 16 |
| I4b — Second Wind auto-consume | 11, 16 |
| I5 — Cold Read lie-score reveal | 11, 12 |
| I6 — Poker Face deterministic 0.5 | 11 |
| I7 — Earful autopsy on ChallengeWon | 14 |
| I8 — Offer pick 3, discard 2 | 5, 16 |
| I9 — Draw pile 5×3=15 | 5 |
| I10 — Exhausted pile → JokerOfferEmpty | 16 |
| I11 — No stacking same type | 5, 16 |
| I12 — toClientView joker projections | 12 |
| I13 — Catalog flavor drift guard | 3 |
