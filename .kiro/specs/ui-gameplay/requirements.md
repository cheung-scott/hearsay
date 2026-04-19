# Requirements Document

## Introduction

React + Next.js 16 App Router presentation layer for Hearsay — the Court-of-Hearsay voice-bluffing card game. This spec covers the Day-4 phase 1 demo-critical surfaces: scene rendering (Variant D aesthetic), player hand + voice input, AI claim bubble with TTS playback, Accept/Liar response buttons, HUD (strikes, round pill, target tag, rounds-won gavels), and the thin API route layer that proxies all FSM events through the server-authoritative `game-engine` reducer and `ai-opponent` brain. Session state is persisted via Vercel KV (`@vercel/kv`). All requirements derived from `design.md` §§1-12.

Phase 1 scope only. NOT included: jokers UI, probe phase, elimination beat orchestration, tension music, lie-score bar, persona portraits, courtroom re-skin.

## Glossary

- **GameSession**: The `"use client"` root React component that owns all gameplay state via `useGameSession` hook
- **ClientSession**: Wire-safe projection of server `Session` produced by `toClientView` — strips `actualCardIds`, replaces opponent hand with `handSize`
- **Phase**: Client-derived UI state (`idle` | `recording` | `awaiting-ai` | `playing-ai-audio` | `awaiting-player-response` | `round-over` | `session-over`) computed from `ClientSession.status` + local async work
- **Scene**: The perspective container rendering the courtroom backdrop, opponent, claim bubble, pile, and table
- **TopBar**: HUD overlay containing target tag, round pill, strike counter, and rounds-won gavels
- **PlayerControls**: Bottom-of-viewport layer containing player hand, hold-to-speak button, and accept/liar buttons
- **Dispatch**: Async function that sends a `GameEvent` to `POST /api/turn` and applies the returned `ClientSession`
- **TurnRequest**: Discriminated union sent to `/api/turn`: `PlayerClaim` | `PlayerRespond` | `AiAct`
- **TurnResponse**: Server response containing `ClientSession` + optional `aiClaim` (with TTS URL) + optional `aiDecision`
- **Persona_Display_Name**: Human-readable courtroom title for each AI persona (e.g. Reader → "The Prosecutor")
- **Vercel_KV**: Redis-backed key-value store (`@vercel/kv`) used for session persistence with 1-hour TTL
- **Store**: The `src/lib/session/store.ts` module exposing `get(id) / set(id, session) / delete(id)` backed by Vercel KV

## Requirements

### Requirement 1: Server-Authoritative Architecture

**User Story:** As a game designer, I want all game logic to execute server-side with the client as a dumb renderer, so that hidden state (AI hand, LLM reasoning) never leaks and the architecture scales to multiplayer.

#### Acceptance Criteria

1. THE GameSession component SHALL never import or invoke the FSM `reduce()` function directly — all state transitions flow through `POST /api/turn` round-trips. *(design §1, §3.1)*
2. WHEN the client receives a `TurnResponse`, THE GameSession SHALL apply only the `ClientSession` returned by the server (produced via `toClientView`) and SHALL NOT contain `actualCardIds`, opponent `hand` arrays, or `llmReasoning` fields. *(design §1, §4.4 security note)*
3. THE API route layer SHALL invoke `toClientView` on every response before serializing to the client. *(design §4.4, invariant 11)*

### Requirement 2: Component Tree Structure

**User Story:** As a developer, I want the component tree to match the design spec exactly, so that the file layout is predictable and auditable against `variant-d-across-table.html`.

#### Acceptance Criteria

1. THE GameSession component SHALL render the following child tree: `<OverlayEffects/>`, `<Scene>` (containing `<Room/>`, `<RoundTable/>`, `<Opponent/>`, `<ClaimBubble/>`, `<Pile/>`), `<TopBar>` (containing `<TargetTag/>`, `<RoundPill/>`, `<StrikeCounter/>`, `<RoundsWonGavels/>`), and `<PlayerControls>` (containing `<PlayerHand/>`, `<HoldToSpeak/>`, `<AcceptLiarButtons/>`). *(design §2)*
2. THE component file layout SHALL match design §5 exactly: `src/components/game/GameSession.tsx`, `src/components/game/Scene/*.tsx`, `src/components/game/Hud/*.tsx`, `src/components/game/PlayerControls/*.tsx`. *(design §5)*
3. THE `<LieScoreMini/>` component SHALL NOT be rendered or created in phase 1 — it is gated behind the Cold Read joker per §10.2. *(design §10.2)*

### Requirement 3: Phase Derivation from ClientSession

**User Story:** As a player, I want the UI to show the correct controls for each game phase, so that I always know what action is available.

#### Acceptance Criteria

1. WHEN `ClientSession.status` is `round_active` AND `round.status` is `claim_phase` AND `round.activePlayer` is `player`, THE useGameSession hook SHALL derive phase as `idle` (pre-press) or `recording` (hold-to-speak active). *(design §3.3, invariant 1)*
2. WHEN `ClientSession.status` is `round_active` AND `round.activePlayer` is `ai` AND a `/api/turn` request is pending, THE useGameSession hook SHALL derive phase as `awaiting-ai`. *(design §3.3)*
3. WHEN a TurnResponse containing `aiClaim` with a `ttsAudioUrl` is received, THE useGameSession hook SHALL transition phase to `playing-ai-audio`. *(design §3.3)*
4. WHEN TTS audio playback completes (`onEnded` fires), THE useGameSession hook SHALL transition phase to `awaiting-player-response`. *(design §3.3)*
5. WHEN `ClientSession.status` is `joker_offer`, THE useGameSession hook SHALL derive phase as `round-over`. *(design §3.3)*
6. WHEN `ClientSession.status` is `session_over`, THE useGameSession hook SHALL derive phase as `session-over`. *(design §3.3)*

### Requirement 4: Phase-Gated UI Visibility

**User Story:** As a player, I want only the relevant UI elements visible and interactive for each phase, so that the interface is uncluttered and I cannot take invalid actions.

#### Acceptance Criteria

1. WHILE phase is `idle`, THE GameSession SHALL display the scene and a "Start" CTA, with only the Start button interactive. *(design §3.3 gate table)*
2. WHILE phase is `recording`, THE GameSession SHALL display the player hand with card selection enabled and the `HOLD TO SPEAK` button active with live waveform. *(design §3.3 gate table)*
3. WHILE phase is `awaiting-ai`, THE GameSession SHALL display a waiting indicator on the opponent (breathing dots) with no interactive elements. *(design §3.3 gate table)*
4. WHILE phase is `playing-ai-audio`, THE GameSession SHALL display the claim bubble with typewriter animation synchronized to TTS audio, with no interactive elements. *(design §3.3 gate table)*
5. WHILE phase is `awaiting-player-response`, THE GameSession SHALL display the held claim bubble and make the `Accept` and `Liar!` buttons visible and interactive. *(design §3.3 gate table)*
6. WHILE phase is `session-over`, THE GameSession SHALL display a minimal win/lose screen with a "NEW TRIAL" button that dispatches `CreateSession`. *(design §3.3 gate table, §10.7)*

### Requirement 5: Event Dispatch via Server Round-Trip

**User Story:** As a developer, I want every user action to flow through a single async dispatch function that calls the server, so that client state never diverges from server state.

#### Acceptance Criteria

1. WHEN `dispatch` is called with any `GameEvent`, THE useGameSession hook SHALL issue exactly one `POST /api/turn` request with the event as the request body. *(design §3.1, invariant 2)*
2. WHEN the server responds with a 2xx status, THE useGameSession hook SHALL apply the returned `ClientSession` to state. *(design §3.1, invariant 2)*
3. IF the server responds with a non-2xx status or the network request fails, THEN THE useGameSession hook SHALL populate `state.error` and SHALL NOT advance the phase. *(design §3.1, invariant 3)*

### Requirement 6: Card Selection Hook

**User Story:** As a player, I want to select 1-2 cards from my hand before speaking my claim, so that I can choose which cards to play face-down.

#### Acceptance Criteria

1. THE useCardSelection hook SHALL maintain a local `Set<CardId>` with toggle semantics (tap to select, tap again to deselect). *(design §3.2)*
2. WHEN phase transitions out of `recording`, THE useCardSelection hook SHALL clear its selection Set. *(design §3.2, invariant 5)*

### Requirement 7: Typewriter Animation

**User Story:** As a player, I want the AI's claim text to appear character-by-character in the claim bubble, so that the reveal feels dramatic and synchronized with TTS audio.

#### Acceptance Criteria

1. WHEN `useTypewriter(text, charDelayMs, onDone)` is invoked, THE hook SHALL reveal one character per `charDelayMs` interval until the full string is rendered. *(design §3.2)*
2. WHEN the full string is rendered, THE useTypewriter hook SHALL fire the `onDone` callback exactly once. *(design §3.2, invariant 6)*

### Requirement 8: Hold-to-Speak Voice Input

**User Story:** As a player, I want to hold a button to record my voice claim with a live waveform visualization, so that I can speak naturally and see feedback.

#### Acceptance Criteria

1. THE useHoldToSpeak hook SHALL use `MediaRecorder` + `AnalyserNode` to capture audio and provide live waveform samples. *(design §3.2)*
2. WHEN `stop()` is called before `start()`, THE useHoldToSpeak hook SHALL treat it as a no-op. *(design §3.2, invariant 7)*
3. WHEN `start()` is called while already recording, THE useHoldToSpeak hook SHALL be idempotent (no double-start). *(design §3.2, invariant 7)*

### Requirement 9: API Route — Session Creation

**User Story:** As a player, I want to start a new game session, so that I can begin playing.

#### Acceptance Criteria

1. WHEN a `POST /api/session` request is received, THE route SHALL create a new `Session` via the game-engine, persist it to Vercel KV via `store.set()`, and return the initial `ClientSession`. *(design §4.1)*
2. WHEN no `persona` is provided in the request body, THE route SHALL default to `Reader` (the Prosecutor). *(design §4.1)*

### Requirement 10: API Route — Turn Processing (PlayerClaim)

**User Story:** As the server, I want to process player claims by running STT, validating cards, firing the FSM, and chaining the AI response, so that a single round-trip handles the full claim→response flow.

#### Acceptance Criteria

1. WHEN a `PlayerClaim` TurnRequest is received, THE route SHALL validate that `cards.length` is 1 or 2 and that every card ID exists in the player's server-held hand. *(design §4.2, invariant 8)*
2. IF any card ID in a `PlayerClaim` does not exist in the player's hand, THEN THE route SHALL respond with HTTP 400 and an error code, leaving session state unchanged. *(design §4.2, invariant 8)*
3. WHEN a valid `PlayerClaim` is processed, THE route SHALL fire `ClaimMade` on the FSM, then immediately chain the AI judgment inline (build `DecisionContext`, call `aiDecideOnClaim`), and return both the updated `ClientSession` and `aiDecision` in a single response. *(design §4.2, invariant 9)*

### Requirement 11: API Route — Turn Processing (PlayerRespond)

**User Story:** As the server, I want to process player accept/challenge responses and resolve challenges, so that the round progresses correctly.

#### Acceptance Criteria

1. WHEN a `PlayerRespond` TurnRequest with `action: 'accept'` is received, THE route SHALL fire `ClaimAccepted` on the FSM and return the updated `ClientSession`. *(design §4.2)*
2. WHEN a `PlayerRespond` TurnRequest with `action: 'challenge'` is received, THE route SHALL fire `ChallengeCalled` then `RevealComplete` (with server-computed correctness) on the FSM and return the updated `ClientSession`. *(design §4.2)*

### Requirement 12: API Route — Turn Processing (AiAct)

**User Story:** As the server, I want to process AI turns by invoking the brain, synthesizing TTS, and returning the claim with audio, so that the client can play the AI's claim.

#### Acceptance Criteria

1. WHEN an `AiAct` TurnRequest is received while `round.activePlayer` is `ai` AND `round.status` is `claim_phase`, THE route SHALL build `OwnPlayContext`, call `aiDecideOwnPlay`, look up `VOICE_PRESETS[persona][truthState]` for TTS synthesis, fire `ClaimMade` on the FSM, and return `ClientSession` + `aiClaim { claimText, ttsAudioUrl, persona }`. *(design §4.2)*
2. WHEN synthesizing TTS for an AI claim, THE route SHALL use the voice settings from `VOICE_PRESETS` indexed by the current persona and the derived `truthState`. *(design §4.2, invariant 10)*
3. IF an `AiAct` TurnRequest is received when `round.activePlayer !== 'ai'` OR `round.status !== 'claim_phase'`, THEN THE route SHALL respond with HTTP 400 and leave session state unchanged. *(design §4.2)*

### Requirement 12b: API Route — Voice TTS Stub

**User Story:** As a developer, I want a `/api/voice/tts` route scaffolded in phase 1 so Day-5 consumers (autopsy panel, joker reveals) can bind to it without a new spec.

#### Acceptance Criteria

1. THE `POST /api/voice/tts` route SHALL accept a JSON body of shape `{ text: string; persona: Persona; truthState: 'honest' | 'lying' }`. *(design §4.3)*
2. THE route SHALL return HTTP 501 Not Implemented with a body of shape `{ error: 'tts-not-implemented-in-phase-1' }` in phase 1. *(design §4.3 — stub only)*
3. THE route file SHALL exist at `src/app/api/voice/tts/route.ts` per the §5 file layout. *(design §5)*

### Requirement 13: Session Storage via Vercel KV

**User Story:** As a developer, I want session state persisted in Vercel KV so that sessions survive cold starts, redeploys, and concurrent lambda invocations.

#### Acceptance Criteria

1. THE `src/lib/session/store.ts` module SHALL expose `get(id): Promise<Session | null>`, `set(id, session): Promise<void>`, and `delete(id): Promise<void>` backed by `@vercel/kv`. *(design §10.8)*
2. WHEN `set()` is called, THE store SHALL apply a TTL of 1 hour to the session key. *(design §10.8)*
3. THE store interface SHALL require `KV_URL` and `KV_REST_API_TOKEN` environment variables. *(design §10.8)*

### Requirement 14: Persona Display Names

**User Story:** As a player, I want to see courtroom-themed display names for AI personas, so that the game feels thematic.

#### Acceptance Criteria

1. THE `PERSONA_DISPLAY_NAMES` constant SHALL map all four `Persona` values: `Novice` → `'The Defendant'`, `Reader` → `'The Prosecutor'`, `Misdirector` → `'The Attorney'`, `Silent` → `'The Judge'`. *(design §7, invariant 4)*
2. THE `displayNames.test.ts` SHALL assert that `Object.keys(PERSONA_DISPLAY_NAMES).sort()` deep-equals `['Misdirector','Novice','Reader','Silent']`. *(design §7, invariant 4)*

### Requirement 15: CSS Theme and Typography

**User Story:** As a designer, I want all visual tokens (colors, fonts, animations) defined in a single CSS file derived from the authoritative `variant-d-across-table.html`, so that the aesthetic is consistent and auditable.

#### Acceptance Criteria

1. THE `src/styles/game-theme.css` file SHALL define all CSS custom properties from design §6.1 (scene colors, persona accents, shared accents) with `--accent` defaulting to `var(--persona-prosecutor)`. *(design §6.1)*
2. THE `game-theme.css` file SHALL import Google Fonts `Press Start 2P` and `VT323` and define `font-display` and `font-ambient` families. *(design §6.2)*
3. THE `game-theme.css` file SHALL define all keyframe animations from design §6.4: `breathe`, `blink`, `char-pop`, `blink-cursor`, `dot-pulse`, `flicker`. *(design §6.4)*

### Requirement 16: Overlay Effects

**User Story:** As a player, I want CRT scanlines and vignette effects overlaying the scene, so that the retro courtroom aesthetic is immersive.

#### Acceptance Criteria

1. THE `<OverlayEffects/>` component SHALL render CRT scanlines at approximately 13% opacity via `repeating-linear-gradient` at the top of the z-stack. *(design §6.3)*
2. THE `<OverlayEffects/>` component SHALL render a vignette via radial gradient below the scanlines layer. *(design §6.3)*

### Requirement 17: Scene Components

**User Story:** As a player, I want to see the courtroom scene with opponent silhouette, card-backs, claim bubble, pile, and round table, so that the game world is visually present.

#### Acceptance Criteria

1. THE `<Opponent/>` component SHALL render `<Silhouette/>` (with breathing + eye-blink animations) and `<OpponentHand/>` (rendering `opponent.handSize` card-backs). *(design §2)*
2. THE `<ClaimBubble/>` component SHALL render the typewriter text with cursor blink and dotted speech-trail, visible only during `playing-ai-audio` and `awaiting-player-response` phases. *(design §2)*
3. THE `<Pile/>` component SHALL render tilted pile cards and a `PILE · N` label reflecting `round.pileSize`. *(design §2)*

### Requirement 18: HUD Components

**User Story:** As a player, I want to see the current call target, round number, strike count, and rounds-won status at a glance, so that I can make informed decisions.

#### Acceptance Criteria

1. THE `<TargetTag/>` component SHALL display `CALL · {rank}` using the current round's `targetRank`. *(design §2)*
2. THE `<RoundPill/>` component SHALL display `ROUND N · BEST OF 3` using the current `currentRoundIdx + 1`. *(design §2)*
3. THE `<StrikeCounter/>` component SHALL render 3 Balatro-style blocks with candle `flicker` animation on lit (struck) blocks. *(design §2)*
4. THE `<RoundsWonGavels/>` component SHALL render 3 mini-gavel slots: empty (not played), gold-filled (won), or red-X (lost). *(design §2, §10.3)*

### Requirement 19: Player Controls

**User Story:** As a player, I want to see my hand, speak claims, and respond to AI claims, so that I can play the game.

#### Acceptance Criteria

1. THE `<PlayerHand/>` component SHALL render up to 5 face-up cards with selection glow (amber border) on selected cards and hover lift animation. *(design §2)*
2. THE `<HoldToSpeak/>` component SHALL render a button with mic pulse indicator and live `<Waveform/>` canvas during recording. *(design §2)*
3. THE `<AcceptLiarButtons/>` component SHALL render `Accept` and `Liar!` buttons visible ONLY during `awaiting-player-response` phase. *(design §2, §3.3)*

### Requirement 20: GameSession Smoke Test

**User Story:** As a developer, I want a smoke test confirming the GameSession component renders without crashing, so that integration regressions are caught early.

#### Acceptance Criteria

1. WHEN given an initial `ClientSession` in `round_active` / `claim_phase` state, THE `<GameSession/>` component SHALL render without crashing, display the player's hand, and show the `CALL · {rank}` target tag. *(design §8, invariant 12)*

### Requirement 21: toClientView Applied on Every Response

**User Story:** As a security-conscious developer, I want every API response to be stripped of server secrets, so that hidden game state never reaches the browser.

#### Acceptance Criteria

1. THE API routes SHALL ensure every `ClientSession` in a response body contains zero `actualCardIds` fields, opponent hand represented as `handSize` (not a card array), and no `llmReasoning` on opponent claims. *(design §4.4, invariant 11)*

---

## Invariant Cross-Reference

Every design.md §8 invariant (1-12) maps to at least one numbered acceptance criterion:

| Invariant | Description | Requirement(s) |
|---|---|---|
| 1 | `useGameSession` phase derivation | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 |
| 2 | Event dispatch → fetch | 5.1, 5.2 |
| 3 | Fetch failure surfaces error | 5.3 |
| 4 | Persona display names complete | 14.1, 14.2 |
| 5 | Card selection resets on phase change | 6.2 |
| 6 | Typewriter completes | 7.1, 7.2 |
| 7 | HoldToSpeak gates on MediaRecorder state | 8.2, 8.3 |
| 8 | API `/api/turn` PlayerClaim rejects invalid card ids | 10.1, 10.2 |
| 9 | API `/api/turn` chains AI judgment inline | 10.3 |
| 10 | TTS preset selected from persona + truthState | 12.2 |
| 11 | `toClientView` applied on every response | 1.2, 1.3, 21.1 |
| 12 | GameSession component smoke test | 20.1 |

---

## Design questions for Scott

The following iter-6 items from design.md §10 are NOT locked and need Scott's decision before Day 5 polish:

1. **§10.4 — Button placement distance from hand.** Phase 1 default: `bottom: 8%` (moved up from `14px`). Revisit after portraits land. Should the Accept/Liar buttons move closer to or further from the player's hand?

2. **§10.5 — Opponent name → top-bar title merge.** Phase 1 default: separate `.opponent-label` under silhouette. iter-6 proposal: merge into a dynamic top-bar title reading "THE PROSECUTOR · ROUND 01 · BEST OF 3 · STRIKES [X][][]". Decide before Day 5.

3. **§10.6 — Courtroom background re-skin.** Phase 1: keep current wood-paneling from Variant D. iter-6: swap to judge's bench / pews / columns after persona portraits land. Decide scope + timing.

---

<!--
## Design questions for Claude Code

All 5 Kiro-generated meta-questions (§4.4 vs §10.8, /api/voice/tts stub, AiAct
chaining, useCardSelection, GameSession.test.tsx location) were addressed
during iter-1 review on 2026-04-19:
- §4.4 rewritten to reference Vercel KV (matches §10.8)
- /api/voice/tts stub gains dedicated Requirement 12b
- AiAct chaining behavior clarified in design §4.2 and Req 10.3 (inline
  chaining) + Req 12.1-12.3 (standalone AI turn)
- useCardSelection inlined in useGameSession.ts per design §5 and task 3.4
- GameSession.test.tsx already co-located per existing convention

No outstanding questions for Claude Code.
-->

