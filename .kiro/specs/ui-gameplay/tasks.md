# Implementation Plan: UI Gameplay (Phase 1)

## Overview

React + Next.js 16 App Router presentation layer for Hearsay. Renders the Court-of-Hearsay Variant D scene, wires player hand + voice input + Accept/Liar buttons, plays AI claim-bubble typewriter with TTS audio, and drives the game-engine FSM through thin API routes. Session state persisted via Vercel KV. Tests-first where feasible; all files per design.md §5.

Phase 1 only — no jokers UI, no probe phase, no elimination beat, no tension music, no lie-score bar. `<LieScoreMini/>` is NOT in phase 1 (gated behind Cold Read joker per §10.2).

## Tasks

- [ ] 1. CSS theme + persona display names (foundation layer)
  - [ ] 1.1 Create `src/styles/game-theme.css` with all CSS custom properties from design §6.1 (scene colors, persona accents, shared accents, `--accent: var(--persona-prosecutor)`), Google Fonts imports (`Press Start 2P`, `VT323`), `font-display` / `font-ambient` family definitions, and all §6.4 keyframe animations (`breathe`, `blink`, `char-pop`, `blink-cursor`, `dot-pulse`, `flicker`). Derive all values from `variant-d-across-table.html`.
    _Requirements: 15.1, 15.2, 15.3_

  - [ ] 1.2 Create `src/lib/persona/displayNames.ts` — export `PERSONA_DISPLAY_NAMES: Record<Persona, string>` mapping `Novice → 'The Defendant'`, `Reader → 'The Prosecutor'`, `Misdirector → 'The Attorney'`, `Silent → 'The Judge'`.
    _Requirements: 14.1_

  - [ ] 1.3 Create `src/lib/persona/displayNames.test.ts` — assert all four keys present, sorted equals `['Misdirector','Novice','Reader','Silent']`, and each value is a non-empty string.
    _Requirements: 14.2_

- [ ] 2. Vercel KV session store
  - [ ] 2.1 Run `pnpm add @vercel/kv`. Add `KV_URL` and `KV_REST_API_TOKEN` to `.env.local` (gitignored). Document required env vars in a comment at top of store.ts.
    _Requirements: 13.3_

  - [ ] 2.2 Create `src/lib/session/store.ts` — export `get(id): Promise<Session | null>`, `set(id, session): Promise<void>`, `delete(id): Promise<void>`. Use `@vercel/kv` client. `set()` applies TTL of 1 hour (`ex: 3600`). Serialize/deserialize `Session` as JSON. Same interface shape as an in-memory Map so callers don't care about backend.
    _Requirements: 13.1, 13.2_

- [ ] 3. Client hooks (test-first)
  - [ ] 3.1 Create `src/hooks/useTypewriter.ts` — `useTypewriter(text, charDelayMs, onDone)` hook using `setInterval` to reveal one character per tick. Returns `{ displayedText, isDone }`. Fires `onDone` exactly once on completion. AND create `src/hooks/useTypewriter.test.ts` — with `vi.useFakeTimers()`, advance by N×charDelayMs and assert: `displayedText` equals full string, `isDone === true`, and `onDone` was called exactly once (invariant 6, MANDATORY).
    _Requirements: 7.1, 7.2_

  - [ ] 3.2 Create `src/hooks/useHoldToSpeak.ts` — `useHoldToSpeak()` hook wrapping `MediaRecorder` + `AnalyserNode`. Returns `{ state, start(), stop(), audioBlob, waveformData }`. `stop()` before `start()` is no-op; double-`start()` is idempotent. AND create `src/hooks/useHoldToSpeak.test.ts` — mock `navigator.mediaDevices.getUserMedia` + `MediaRecorder` + `AudioContext`/`AnalyserNode` via `vi.stubGlobal`. Assert: `stop()` before `start()` is no-op (no state change, no error), double-`start()` is idempotent (single active recorder, no duplicate state transition) (invariant 7, MANDATORY).
    _Requirements: 8.1, 8.2, 8.3_

  - [ ] 3.3 Create `src/hooks/useAudioPlayer.ts` — `useAudioPlayer()` hook for queued TTS playback. Plays one clip at a time; exposes `play(url)`, `isPlaying`, and `onEnded` callback.
    _Requirements: 3.3, 3.4_

  - [ ] 3.4 Create `src/hooks/useGameSession.ts` — `useGameSession()` hook implementing the `GameSessionState` interface from design §3.1. Phase derivation from `ClientSession.status` + local async state per §3.3 gate table. `dispatch(event)` issues `POST /api/turn`, applies returned `ClientSession`, handles errors. Includes `useCardSelection` logic (local `Set<CardId>` with toggle, clears on phase exit from `recording`).
    _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 6.1, 6.2_

  - [ ] 3.5 Create `src/hooks/useGameSession.test.ts` — mock `fetch` for `/api/turn`. Test: phase derivation from ClientSession snapshots across all 6 gate-table rows (invariant 1, covers AC 3.1-3.6), dispatch issues exactly one POST (invariant 2), fetch failure populates `state.error` without advancing phase (invariant 3), card selection clears on phase change (invariant 5).
    _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 6.2_

- [ ] 4. Checkpoint: run all tests
  - Run `pnpm vitest --run`. Verify `displayNames.test.ts` and `useGameSession.test.ts` pass. Fix any failures before proceeding.

- [ ] 5. Presentational components — Scene layer
  - [ ] 5.1 Create `src/components/game/Scene/OverlayEffects.tsx` — CRT scanlines (~13% opacity `repeating-linear-gradient`) + vignette (radial gradient). Top of z-stack.
    _Requirements: 16.1, 16.2_

  - [ ] 5.2 Create `src/components/game/Scene/Room.tsx` — wall + paneling + hanging bulb backdrop. Uses `.room` class from variant-d.
    _Requirements: 17.1_

  - [ ] 5.3 Create `src/components/game/Scene/RoundTable.tsx` — ellipse with `rotateX(58deg)`. Uses `.table-wrap` / `.round-table` classes.
    _Requirements: 17.1_

  - [ ] 5.4 Create `src/components/game/Scene/Opponent.tsx`, `Silhouette.tsx`, `OpponentHand.tsx` — silhouette with `breathe` + `blink` animations, opponent hand rendering `handSize` card-backs. Uses `.opponent-area`, `.silhouette-block`, `.silhouette`, `.eyes`, `.eye`, `.opponent-hand`, `.opp-card` classes. Includes `.opponent-label` with persona display name (phase 1: separate label, not merged into TopBar per §10.5 pending).
    _Requirements: 17.1_

  - [ ] 5.5 Create `src/components/game/Scene/ClaimBubble.tsx` — typewriter text display with `char-pop` animation per character, `blink-cursor`, and `dot-pulse` speech-trail dots. Visible during `playing-ai-audio` and `awaiting-player-response` phases. Uses `.claim-bubble`, `.cursor`, `.speech-trail` classes.
    _Requirements: 17.2_

  - [ ] 5.6 Create `src/components/game/Scene/Pile.tsx` — tilted pile cards + `PILE · N` label from `round.pileSize`. Uses `.pile-area`, `.pile-cards-tilted`, `.pile-card`, `.pile-label` classes.
    _Requirements: 17.3_

  - [ ] 5.7 Create `src/components/game/Scene/Scene.tsx` — perspective container composing `<Room/>`, `<RoundTable/>`, `<Opponent/>`, `<ClaimBubble/>`, `<Pile/>`.
    _Requirements: 2.1_

- [ ] 6. Presentational components — HUD layer
  - [ ] 6.1 Create `src/components/game/Hud/TargetTag.tsx` — displays `CALL · {rank}` using `font-display`. Uses `.target-tag` class.
    _Requirements: 18.1_

  - [ ] 6.2 Create `src/components/game/Hud/RoundPill.tsx` — displays `ROUND N · BEST OF 3`. Uses `.round-pill` class.
    _Requirements: 18.2_

  - [ ] 6.3 Create `src/components/game/Hud/StrikeCounter.tsx` — 3 Balatro-style blocks; lit blocks get `.strike.lit` class with `flicker` animation. Uses `.strikes`, `.strike`, `.strikes-label` classes.
    _Requirements: 18.3_

  - [ ] 6.4 Create `src/components/game/Hud/RoundsWonGavels.tsx` — 3 mini-gavel slots: empty (not played) / gold-filled (won) / red-X (lost). Reads `self.roundsWon` and `opponent.roundsWon` from ClientSession.
    _Requirements: 18.4_

  - [ ] 6.5 Create `src/components/game/Hud/TopBar.tsx` — layout container composing `<TargetTag/>`, `<RoundPill/>`, `<StrikeCounter/>`, `<RoundsWonGavels/>`. z-index: 20.
    _Requirements: 2.1, 18.1, 18.2, 18.3, 18.4_

- [ ] 7. Presentational components — PlayerControls layer
  - [ ] 7.1 Create `src/components/game/PlayerControls/Card.tsx` — shared card component for face-up player cards and face-down pile/opponent variants. Renders rank in top-left, center, bottom-right (`.card-rank-tl`, `.card-rank-mid`, `.card-rank-br`). Selection state via amber border glow. Hover lift via 0.2s ease `translateY(-18px)`.
    _Requirements: 19.1_

  - [ ] 7.2 Create `src/components/game/PlayerControls/PlayerHand.tsx` — renders up to 5 `<Card/>` components from `self.hand`. Passes selection state from `useCardSelection`. Uses `.your-hand` class.
    _Requirements: 19.1_

  - [ ] 7.3 Create `src/components/game/PlayerControls/Waveform.tsx` — canvas renderer for live mic waveform data from `useHoldToSpeak`.
    _Requirements: 19.2_

  - [ ] 7.4 Create `src/components/game/PlayerControls/HoldToSpeak.tsx` — button with mic pulse indicator + `<Waveform/>` canvas. Wires to `useHoldToSpeak` hook. Active only during `recording` phase.
    _Requirements: 19.2_

  - [ ] 7.5 Create `src/components/game/PlayerControls/AcceptLiarButtons.tsx` — `Accept` and `Liar!` buttons. Visible ONLY during `awaiting-player-response` phase. Uses `.actions`, `.btn`, `.btn-challenge` classes. Phase 1 default: `bottom: 8%` per §10.4.
    _Requirements: 19.3_

  - [ ] 7.6 Create `src/components/game/PlayerControls/PlayerControls.tsx` — layout container composing `<PlayerHand/>`, `<HoldToSpeak/>`, `<AcceptLiarButtons/>`. z-index: 30.
    _Requirements: 2.1_

- [ ] 8. Checkpoint: run all tests + verify component imports compile
  - Run `pnpm vitest --run`. Verify all existing tests still pass. Run `pnpm tsc --noEmit` to catch any import/type errors in new components.

- [ ] 9. GameSession root component + smoke test
  - [ ] 9.1 Create `src/components/game/GameSession.tsx` — `"use client"` root component. Composes `<OverlayEffects/>`, `<Scene>`, `<TopBar>`, `<PlayerControls>`. Owns state via `useGameSession()`. Passes phase-derived props to children for visibility gating. Renders "Start" CTA in `idle`, "NEW TRIAL" button in `session-over`. Does NOT import FSM `reduce()` directly.
    _Requirements: 1.1, 2.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ] 9.2 Create `src/components/game/GameSession.test.tsx` — smoke test: render `<GameSession/>` with a mocked initial `ClientSession` in `round_active` / `claim_phase`. Assert: renders without crash, player hand cards visible, `CALL · {rank}` target tag visible.
    _Requirements: 20.1_

- [ ] 10. Context builders + API route helpers
  - [ ] 10.1 Create `src/lib/session/buildContexts.ts` — export `buildDecisionContext(session, round)` and `buildOwnPlayContext(session, round)` that construct the context objects expected by `aiDecideOnClaim` and `aiDecideOwnPlay` from the `ai-opponent` spec.
    _Requirements: 10.3, 12.1_

  - [ ] 10.2 Create `src/app/game/page.tsx` — server component shell that renders `<GameSession/>`.
    _Requirements: 1.1, 2.1_

- [ ] 11. API routes
  - [ ] 11.1 Create `src/app/api/session/route.ts` — `POST`: create new Session (via game-engine `reduce` with `SetupComplete`), persist to Vercel KV via `store.set()`, return `ClientSession`. Default persona: `Reader`. `GET`: retrieve current session from KV.
    _Requirements: 9.1, 9.2, 13.1_

  - [ ] 11.2 Create `src/app/api/turn/route.ts` — `POST`: parse `TurnRequest` discriminated union. For `PlayerClaim`: validate card IDs against server session, run STT + heuristic, build Claim, fire `ClaimMade`, chain AI judgment inline (build DecisionContext → `aiDecideOnClaim` → fire `ChallengeCalled`/`ClaimAccepted`), persist updated session to KV, return `TurnResponse` with `ClientSession` + `aiDecision`. For `PlayerRespond`: fire FSM events, resolve challenge if applicable, persist, return. For `AiAct`: validate activePlayer === 'ai', build OwnPlayContext → `aiDecideOwnPlay` → TTS synthesis via `VOICE_PRESETS[persona][truthState]` → fire `ClaimMade`, persist, return with `aiClaim`. Apply `toClientView` on EVERY response.
    _Requirements: 1.2, 1.3, 10.1, 10.2, 10.3, 11.1, 11.2, 12.1, 12.2, 21.1_

  - [ ] 11.3 Create `src/app/api/voice/tts/route.ts` — stub returning HTTP 501 Not Implemented with body `{ error: 'tts-not-implemented-in-phase-1' }`. Accept body shape `{ text, persona, truthState }` for Day-5 consumer binding.
    _Requirements: 12b.1, 12b.2, 12b.3_

- [ ] 12. Checkpoint: run all tests
  - Run `pnpm vitest --run`. Verify all tests pass including `GameSession.test.tsx`, `useGameSession.test.ts`, `displayNames.test.ts`. Run `pnpm tsc --noEmit`.

- [ ] 13. API route tests (invariants 8-11)
  - [ ] 13.1 Create `src/app/api/turn/route.test.ts` — mock game-engine, ai-opponent, voice modules, and Vercel KV store. Tests:
    - `PlayerClaim` with invalid card IDs → 400 response, session unchanged (invariant 8)
    - `PlayerClaim` with valid cards → response includes `aiDecision` (invariant 9)
    - `AiAct` → TTS call uses `VOICE_PRESETS[persona][truthState]` args (invariant 10)
    - Every response `ClientSession` has zero `actualCardIds`, opponent as `handSize` not array (invariant 11)
    _Requirements: 10.1, 10.2, 10.3, 12.2, 21.1_

- [ ] 14. Final checkpoint: full test suite
  - Run `pnpm vitest --run`. All tests green. Run `pnpm tsc --noEmit`. Zero type errors. Verify all 12 design invariants are covered:
    - Invariant 1 (phase derivation): Task 3.5
    - Invariant 2 (dispatch → fetch): Task 3.5
    - Invariant 3 (fetch failure → error): Task 3.5
    - Invariant 4 (persona display names): Task 1.3
    - Invariant 5 (card selection reset): Task 3.5
    - Invariant 6 (typewriter completes): Task 3.1 (hook + co-located test)
    - Invariant 7 (HoldToSpeak gates): Task 3.2 (hook + co-located test with mocked MediaRecorder)
    - Invariant 8 (reject invalid card IDs): Task 13.1
    - Invariant 9 (chain AI judgment): Task 13.1
    - Invariant 10 (TTS preset selection): Task 13.1
    - Invariant 11 (toClientView on every response): Task 13.1
    - Invariant 12 (GameSession smoke test): Task 9.2

## Notes

- `<LieScoreMini/>` is NOT in phase 1 — gated behind Cold Read joker per design §10.2. Do not create this component.
- All CSS class names derive from `variant-d-across-table.html` — if implementation diverges, flag it.
- Session storage uses Vercel KV (`@vercel/kv`). Both design §4.4 and §10.8 reflect this.
- The `AiAct` client event is for AI claim turns only (activePlayer === 'ai', claim_phase). AI response to player claims is chained inline within the `PlayerClaim` server handler.
- Tasks marked with `*` are optional. All other tasks are required for phase 1 demo.
