---
inclusion: fileMatch
fileMatchPattern: "src/app/game/**/*.tsx|src/components/game/**/*.tsx|src/hooks/**/*.ts|src/styles/game-theme.css|src/lib/persona/**/*.ts"
---

# ui-gameplay — Design

## Provenance

Authored by Claude Code as the React + Tailwind-level codification of the locked Variant D aesthetic (`design-previews/variant-d-across-table.html`, iter-5), the locked design decisions in `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/DESIGN-DECISIONS.md`, and the ROADMAP Day-4 UI build phase 1 surface list. Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via seeded prompt. Tasks executed by Claude Code with Sonnet 4.6 implementation subagents + Opus 4.7 review subagent per spec.

Makes Hearsay playable in a browser: renders the Court-of-Hearsay scene, wires the player's hand + voice input + Accept/Liar buttons, plays the AI's claim-bubble typewriter with TTS audio, and drives the `game-engine` FSM through the `ai-opponent` brain.

**Scope of this spec (Day-4 phase 1 — demo-critical surfaces only):**
- Scene backdrop (room + wall + hanging bulb + round wooden table + CRT scanlines + vignette)
- Opponent silhouette placeholder (Prosecutor — Reader persona) + breathing + eye blink + card-backs
- Claim bubble with center-out typewriter effect + speech-trail dots + cursor blink
- Pile of face-down cards on felt + `PILE · N` label
- 5-card player hand (bottom of viewport, tilted forward, amber-border selection glow)
- `HOLD TO SPEAK` button + live mic waveform during voice input
- `Accept` / `Liar!` button pair (bottom corners)
- Strike counter (3 Balatro-style chunky blocks + candle flicker on lit strikes)
- Top-bar HUD: `CALL · {rank}` target tag + round pill + persona display name
- Client-side `GameSession` React component that owns session state and proxies all FSM events through thin API routes
- API routes: `POST /api/session`, `POST /api/turn`, `POST /api/voice/tts` (minimum viable)
- AI TTS playback with preset look-up per persona + truthState (`voice-tell-taxonomy`)
- Live persona-display-name mapping (`personaDisplayNames` module — display layer only, internal `Persona` type unchanged)

**NOT in this spec** (Day-5+ or other specs):
- Jokers UI — `joker-system` spec, Day 5
- Probe phase / Stage Whisper UI — `probe-phase` spec, Day 5
- Post-round autopsy panel (Earful joker / `llmReasoning` reveal) — `joker-system` consumer, Day 5
- §1.5 elimination beat orchestration (silent beat + final-words + stinger + cut-to-black + `GUILTY · EXECUTED`) — Day 5 wiring; UI only fires the `session_over` transition here
- Tension music system (ElevenLabs Music API beds + Web Audio `GainNode` ducking) — `tension-music-system` spec, Day 5
- Lie-score bar UI — LOCKED per §10.2 to `joker-system` spec (Day 5); phase 1 renders no lie-score UI at all
- Persona portraits (Flux/Midjourney) — external generation, replaces silhouette stand-ins post-portraits
- Courtroom background re-skin (judge's bench / pews / columns) — iter-6 pending (§10.6)
- Tutorial flow / Clerk onboarding — future milestone
- Audio/sound-effects authoring (card flick, gavel, strike-ignite whoosh) — Day 5 elimination-beat + Day 6 recording pipeline
- Win/lose screens (`CASE DISMISSED` / `GUILTY · EXECUTED`) — minimal phase 1 stub only (`NEW TRIAL` button per §10.7); full implementation deferred to Day 5 elimination beat

## Canonical sources

Read in this order when extending or auditing this spec:

1. `design-previews/variant-d-across-table.html` — AUTHORITATIVE visual spec (iter-5). 584 lines of HTML + inline CSS. All CSS variables, keyframe animations, perspective transforms, z-index stack, and DOM class names in this spec are derived from here. If the code diverges, flag it — do not silently resolve.
2. `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/DESIGN-DECISIONS.md` §§1-9 (LOCKED) and §10a+§10b (iter-6 pending — call out in requirements as open items).
3. `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md` §1.1 (mechanics), §4 (data model), §5 (turn flow), §1.5 (elimination beat — deferred, Day 5).
4. `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/DEMO-SCRIPT.md` Acts 2-4 — the gameplay states that must be recordable by Day 6.
5. `.kiro/specs/game-engine/design.md` §1-3 (FSM states, transitions, events) — all FSM events fired by the UI must match this contract.
6. `.kiro/specs/ai-opponent/design.md` §5-6 (brain entry points + caller-context construction) — the API route layer builds `DecisionContext` / `OwnPlayContext` and invokes `aiDecideOnClaim` / `aiDecideOwnPlay`.
7. `.kiro/specs/voice-tell-taxonomy/design.md` — `VOICE_PRESETS` lookup by persona + truthState (for AI TTS settings) and `stt.ts` heuristic (for voice-lie scoring on player claims).
8. `.kiro/steering/product.md`, `structure.md`, `tech.md` — stack conventions (Next.js 16 App Router, Tailwind 4, shadcn/ui conventions, deployed to Vercel).

---

## 1. Architecture

```
                       ┌──────────────────────────┐
                       │ src/app/game/page.tsx    │   (server component — shell)
                       │  └─ <GameSession>        │   "use client"
                       └─────────────┬────────────┘
                                     │ owns state
                                     ▼
                  ┌──────────────────────────────────────┐
                  │ useGameSession (reducer hook)        │
                  │  - initial session from POST /session │
                  │  - dispatches events via POST /turn   │
                  │  - applies server-returned Session    │
                  └─────────────┬───────────────┬────────┘
                                │               │
                  ┌─────────────▼───┐    ┌──────▼─────────────────┐
                  │ <Scene>         │    │ <PlayerControls>       │
                  │  <Opponent/>    │    │  <PlayerHand/>         │
                  │  <ClaimBubble/> │    │  <HoldToSpeak/>        │
                  │  <Pile/>        │    │  <AcceptLiarButtons/>  │
                  │  <TopBar/>      │    │                        │
                  └─────────────────┘    └────────┬───────────────┘
                                                  │ user events
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │ useGameSession.dispatch(ev)  │
                                   │  → POST /api/turn            │
                                   └──────────────┬───────────────┘
                                                  │
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │ /api/turn route (server)     │
                                   │  1. validate req             │
                                   │  2. build Decision/OwnPlayCtx│
                                   │  3. invoke ai-opponent brain │
                                   │  4. reduce FSM (game-engine) │
                                   │  5. if AI turn next: repeat  │
                                   │  6. return ClientSession     │
                                   │     + ttsAudioUrl (if AI)    │
                                   └──────────────────────────────┘
```

**Client owns:** rendering, local interaction state (card-selection, recording-state, typewriter-progress, waveform buffer).

**Server owns:** full `Session` (never sent to client — client receives `ClientSession` via `toClientView`), FSM reducer invocations, AI brain calls, TTS synthesis. `actualCardIds` never leaves the server.

**Why server-authoritative:** the AI's real hand and LLM reasoning are hidden state. Keeping all game logic server-side preserves fair play even though this is single-player — the same pattern scales to multiplayer without reshaping. Also simplifies testing (client is a dumb renderer).

---

## 2. Component tree (authoritative)

```
<GameSession>                         "use client" root
├── <OverlayEffects/>                 CRT scanlines (z-max) + vignette (z-max-1)
├── <Scene>                           perspective container (z: 0-10)
│   ├── <Room/>                       wall + paneling + hanging bulb (z: 0-2)
│   ├── <RoundTable/>                 ellipse + rotateX(58deg) (z: 5)
│   ├── <Opponent/>                   silhouette + opponent-hand (z: 4-6, split across table)
│   │   ├── <Silhouette/>             body + eyes (blink animation) (z: 4)
│   │   └── <OpponentHand/>           5 card-backs @ z: 6 (above table edge)
│   ├── <ClaimBubble/>                typewriter + cursor + dotted speech-trail (z: 12)
│   └── <Pile/>                       tilted pile cards + PILE · N label (z: 7)
├── <TopBar>                          z: 20 (above scene)
│   ├── <TargetTag/>                  CALL · {rank} (left)
│   ├── <RoundPill/>                  ROUND N · BEST OF 3 (center)
│   ├── <StrikeCounter/>              3 Balatro blocks + candle flicker (right)
│   └── <RoundsWonGavels/>            3 mini-gavels under strikes: empty / gold-filled (won) / red-X (lost)
└── <PlayerControls>                  z: 30
    ├── <PlayerHand/>                 5 cards, selectable, tilted forward
    ├── <HoldToSpeak/>                button + mic pulse + live waveform
    └── <AcceptLiarButtons/>          2 buttons, bottom corners — visible only in response_phase
```

**Class-name-to-component map** (traceability to `variant-d-across-table.html`):

| HTML class | React component | Notes |
|---|---|---|
| `.room` | `<Room/>` | backdrop |
| `.opponent-area` | wrapper inside `<Opponent/>` | |
| `.silhouette-block` / `.silhouette` / `.eyes` / `.eye` | `<Silhouette/>` | |
| `.opponent-hand` / `.opp-card` | `<OpponentHand/>` | renders `ctx.opponent.handSize` backs |
| `.claim-bubble` / `.cursor` / `.speech-trail` | `<ClaimBubble/>` | |
| `.opponent-label` | `<Opponent/>` — persona display name; **iter-6 pending**: merge into `<TopBar/>` (§10a item 1) |
| `.table-wrap` / `.round-table` | `<RoundTable/>` | |
| `.pile-area` / `.pile-cards-tilted` / `.pile-card` / `.pile-label` | `<Pile/>` | |
| `.your-hand` / `.card` + `.card-rank-{tl,mid,br}` | `<PlayerHand/>` + `<Card/>` | |
| `.top-bar` / `.target-tag` / `.round-pill` | `<TopBar/>` + children | |
| `.strikes` / `.strike` / `.strike.lit` / `.strikes-label` | `<StrikeCounter/>` | |
| `.actions` / `.btn` / `.btn-challenge` | `<AcceptLiarButtons/>` | |
| `.overlay` | `<OverlayEffects/>` | |
| `.lie-score-bar` / `.lie-score-fill` / `.lie-score-mini` | (not rendered phase 1) | Gated behind Cold Read joker per §10.2 decision; rendered by `joker-system` spec on Day 5 |
| `.variant-label` | DROP — dev-only marker in preview, not in production UI |

---

## 3. State management

### 3.1 `useGameSession` hook

```ts
type GameEvent =
  | { type: 'CreateSession' }
  | { type: 'PlayerClaim'; cards: Card[]; audio: Blob; claimText: string; voiceMeta: VoiceMeta }
  | { type: 'PlayerRespond'; action: 'accept' | 'challenge' }
  | { type: 'AiAct' }  // trigger AI's turn when activePlayer === 'ai'
  | { type: 'PickJoker'; joker: JokerType }  // Day 5, stubbed here
  | { type: 'TimeoutActive' } | { type: 'TimeoutResponder' };  // Day 5

interface GameSessionState {
  session: ClientSession | null;
  phase: 'idle' | 'recording' | 'awaiting-ai' | 'playing-ai-audio' | 'awaiting-player-response' | 'round-over' | 'session-over';
  lastClaimAudioUrl?: string;    // TTS URL for AI's most recent claim
  lastClaimText?: string;        // for typewriter re-entry
  error?: string;
}

export function useGameSession(): {
  state: GameSessionState;
  dispatch: (event: GameEvent) => Promise<void>;
};
```

`dispatch` is async — each event issues a `POST /api/turn` with `{ event }` body, server computes `ClientSession` + optional side effects (TTS URL), client sets state. The client NEVER runs the FSM reducer directly.

**Why useReducer-style semantics via server round-trip:** keeps the FSM single-source-of-truth on the server (see `game-engine` §3.2 purity contract). Client cannot desync. Cost: 1 network round-trip per event; acceptable at hackathon scale (local dev = same process, prod = Vercel edge to self).

### 3.2 Local-only hooks

These do NOT touch the server:
- **`useHoldToSpeak()`** — `MediaRecorder` + `AnalyserNode` for live waveform samples. Returns `{ state, start(), stop(), audioBlob, waveformData }`.
- **`useAudioPlayer()`** — queued TTS playback. Plays one clip at a time; exposes `onEnded` for the typewriter finish.
- **`useTypewriter(text, charDelayMs, onDone)`** — char-by-char progression state; used by `<ClaimBubble/>`.
- **`useCardSelection()`** — local `Set<CardId>` with toggle; reset on phase change.

### 3.3 Phase → UI gate table

| `GameSessionState.phase` | UI visible | Interactive |
|---|---|---|
| `idle` | scene + "Start" CTA | Start button |
| `recording` | hand + `HOLD TO SPEAK` active + waveform | release to stop; ×1 selected cards confirm |
| `awaiting-ai` | "..." indicator on opponent (dotted breathing dots fade in) | — |
| `playing-ai-audio` | claim bubble typewriter + TTS audio | — (wait for `onEnded`) |
| `awaiting-player-response` | claim bubble held + `Accept` / `Liar!` visible | two buttons |
| `round-over` | brief pause + reveal pile; render `joker_offer` stub or advance | — (Day 5 joker pick) |
| `session-over` | minimal win/lose screen (phase 1 stub) | "New Trial" → CreateSession |

The phase is DERIVED from `ClientSession.status` + local async work:
- `Session.status === 'round_active'` AND `Round.status === 'claim_phase'` AND `Round.activePlayer === 'player'` → `recording` (or `idle` pre-press)
- `Session.status === 'round_active'` AND `Round.activePlayer === 'ai'` AND waiting on `/api/turn` → `awaiting-ai`
- just-received AI claim + TTS URL → `playing-ai-audio` (typewriter runs during audio)
- typewriter/audio `onEnded` fired → `awaiting-player-response`
- `Session.status === 'joker_offer'` → `round-over`
- `Session.status === 'session_over'` → `session-over`

---

## 4. API routes

### 4.1 `POST /api/session`

Creates a new `Session`. Returns initial `ClientSession` (player's hand + pile empty + round 1 claim_phase + activePlayer coin-flipped). Body: optional `{ persona?: Persona }` — defaults to `Reader` (the Prosecutor) for the demo-critical MVP. Full 4-persona selection is Day 5.

### 4.2 `POST /api/turn`

Request body:
```ts
type TurnRequest =
  | { type: 'PlayerClaim'; cards: { id: string }[]; audioBase64: string; claimText: string; voiceMetaOverrides?: Partial<VoiceMeta> }
  | { type: 'PlayerRespond'; action: 'accept' | 'challenge' }
  | { type: 'AiAct' };
```

Response body:
```ts
interface TurnResponse {
  session: ClientSession;                 // already toClientView-stripped
  aiClaim?: {
    claimText: string;
    ttsAudioUrl: string;                  // URL to the synthesized audio
    persona: Persona;                     // for claim-bubble border color
  };
  aiDecision?: {
    action: 'accept' | 'challenge';
    innerThought: string;                 // for Day 5 autopsy — not shown in phase 1
  };
  error?: { code: string; message: string };
}
```

**Server-side responsibilities per `TurnRequest.type`:**

- `PlayerClaim`:
  1. Decode `audioBase64` → run STT (`stt.ts`) → compute `VoiceMeta.lieScore` via heuristic.
  2. Parse `cards` into `Card[]` via server-held session state. Validate `cards.length ∈ {1, 2}` and that every id exists in player's hand.
  3. Derive `truthState` from cards vs `round.targetRank`.
  4. Build `Claim { by: 'player', count, claimedRank: round.targetRank, actualCardIds, truthState, voiceMeta, claimText, timestamp }`.
  5. Fire `ClaimMade` event on FSM.
  6. After FSM tick, `session.status` is now `response_phase`. Return `ClientSession`. Client goes to `awaiting-ai`.
  7. Immediately invoke `AiAct` logic inline (chaining a single round-trip): build `DecisionContext` including the just-appended claim, call `aiDecideOnClaim(ctx)`, fire `ChallengeCalled` or `ClaimAccepted` on FSM, include `aiDecision` in response.

- `PlayerRespond`:
  1. Fire `ClaimAccepted` or `ChallengeCalled` on FSM.
  2. If challenge → FSM reaches `resolving`; caller fires `RevealComplete(challengeWasCorrect)` with the server-computed correctness; FSM progresses to `round_over`, `session_over`, or swap-active.
  3. Return updated `ClientSession`.

- `AiAct`:
  1. Only valid when `Round.activePlayer === 'ai'` AND `Round.status === 'claim_phase'`.
  2. Build `OwnPlayContext`, call `aiDecideOwnPlay(ctx)`.
  3. Look up `VOICE_PRESETS[persona][truthState]`. Synthesize TTS via ElevenLabs Flash v2.5 with those settings + `claimText`. Store audio (temp file or data URL; phase 1 may return a `data:audio/mpeg;base64,...` URL to avoid file-system setup).
  4. Fire `ClaimMade` on FSM. Return `ClientSession` + `aiClaim { claimText, ttsAudioUrl, persona }`.

### 4.3 `POST /api/voice/tts` (direct TTS for future use)

Standalone TTS endpoint; phase 1 uses it only for re-plays (clicking on a past claim in the future autopsy panel). Body: `{ text: string; persona: Persona; truthState: 'honest' | 'lying' }`. Response: audio blob. Stub in phase 1; real consumer is Day 5 autopsy.

### 4.4 Session storage

**Backend: Vercel KV (locked per §10.8).** Session state lives in Redis managed by `@vercel/kv`. `src/lib/session/store.ts` exposes a Map-shaped interface — `get(id): Promise<Session | null>`, `set(id, session): Promise<void>`, `delete(id): Promise<void>` — so callers don't care about the backend. TTL 1 hour per session (`ex: 3600`). Requires `KV_URL` + `KV_REST_API_TOKEN` env vars in Vercel project settings + `pnpm add @vercel/kv`.

**Why KV, not an in-memory Map:** Vercel functions are stateless — module-level state doesn't survive cold starts, redeploys, or concurrent lambdas. A judge returning to the site after watching the demo video would hit a fresh lambda with an empty Map and lose their session. KV survives all three.

**Security note:** `Session.ai.hand`, `Session.ai.personaIfAi`, `Round.claimHistory[].actualCardIds`, `Round.claimHistory[].llmReasoning` must be stripped by `toClientView` before every response. The `game-engine` spec already provides `toClientView`; use it without exception.

---

## 5. File layout

```
src/
  app/
    game/
      page.tsx                    — server shell; renders <GameSession/>
    api/
      session/route.ts            — POST: create, GET: current
      turn/route.ts               — POST: player-claim / player-respond / ai-act
      voice/
        tts/route.ts              — POST: synthesize (stub in phase 1)

  components/
    game/
      GameSession.tsx             — "use client" root; owns state
      GameSession.test.tsx        — smoke test: renders idle → recording phase
      Scene/
        Scene.tsx                 — perspective container + children
        Room.tsx                  — wall + paneling + bulb
        RoundTable.tsx            — ellipse
        Opponent.tsx              — wrapper
        Silhouette.tsx            — body + eyes
        OpponentHand.tsx          — N card-backs
        ClaimBubble.tsx           — typewriter + cursor + speech-trail
        Pile.tsx                  — tilted cards + label
        OverlayEffects.tsx        — scanlines + vignette
      Hud/
        TopBar.tsx                — layout
        TargetTag.tsx             — CALL · {rank}
        RoundPill.tsx             — ROUND N · BEST OF 3
        StrikeCounter.tsx         — 3 blocks + flicker
        RoundsWonGavels.tsx       — 3 mini-gavels: empty / gold (won) / red-X (lost)
      PlayerControls/
        PlayerControls.tsx        — layout
        PlayerHand.tsx            — 5 cards
        Card.tsx                  — shared (face-up + pile variants)
        HoldToSpeak.tsx           — button + mic + waveform
        Waveform.tsx              — canvas renderer
        AcceptLiarButtons.tsx     — 2 buttons

  hooks/
    useGameSession.ts             — reducer-shaped client (server-proxied); includes useCardSelection as an internal helper
    useGameSession.test.ts        — mocks /api/turn; verifies phase derivation
    useHoldToSpeak.ts             — MediaRecorder + Analyser
    useHoldToSpeak.test.ts        — mocked MediaRecorder; gates on state machine
    useAudioPlayer.ts             — TTS playback queue
    useTypewriter.ts              — char-by-char animation state
    useTypewriter.test.ts         — fake timers; full reveal + onDone-fires-once

  lib/
    persona/
      displayNames.ts             — { Novice: 'The Defendant', Reader: 'The Prosecutor', Misdirector: 'The Attorney', Silent: 'The Judge' }
      displayNames.test.ts
    session/
      store.ts                    — Vercel KV-backed session store (get/set/delete interface per §10.8)
      buildContexts.ts            — buildDecisionContext / buildOwnPlayContext (design.md §6 of ai-opponent)

  styles/
    game-theme.css                — CSS custom properties + font imports + global scene styles
```

**Not listed** because already present: `src/lib/game/*`, `src/lib/ai/*`, `src/lib/voice/*` — the engine + brain + voice layers are already shipped.

---

## 6. Theming & typography

### 6.1 CSS custom properties (from `DESIGN-DECISIONS.md` §2, exported by `styles/game-theme.css`)

```css
:root {
  /* scene */
  --wall: #1a100a;   --wall-lit: #3a2015;
  --wood: #3a1f10;   --wood-lit: #6b3a1c;   --wood-hi: #8f5528;   --wood-rim: #1f0e05;
  --felt: #1e3a2f;   --felt-dark: #0d1f17;   --felt-far: #081610;
  --shadow: #050302;
  --navy: #1a2130;
  --bone: #f4ecd8;   --bone-dim: #c9bfa3;

  /* persona accents */
  --persona-defendant: #55c6fd;
  --persona-prosecutor: #fda200;
  --persona-attorney:   #d94a84;
  --persona-judge:      #e8e8e8;

  /* shared accents */
  --coral: #fd5f55;
  --blood: #8b1a1a;
  --amber-hi: #ffc760;
  --amber-dim: #8b5a0f;

  /* convenience aliases — phase 1 defaults to Reader/Prosecutor as the sole opponent */
  --accent: var(--persona-prosecutor);
}
```

### 6.2 Fonts

Imported via `@import` in `game-theme.css` at the top of cascade:

```css
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');
```

Tailwind config extends:
```ts
fontFamily: {
  display: ['"Press Start 2P"', 'monospace'],
  ambient: ['VT323', 'monospace'],
}
```

- `font-display` for headers, rank letters, strike counters, claim bubbles, target tags, button labels.
- `font-ambient` for flavor text, opponent state labels, ambient UI.

### 6.3 Overlay effects

CRT scanlines at ~13% opacity via `repeating-linear-gradient(0deg, ...)` applied to `<OverlayEffects/>` at the top of the z-stack. Vignette via radial gradient. No grain. (DESIGN-DECISIONS.md §4.)

### 6.4 Animations (keyframes)

Defined once in `game-theme.css`:

| Name | Duration | Used by |
|---|---|---|
| `breathe` | 4.5s | `.silhouette` Y-oscillation ±3px |
| `blink` | 5.2s cycle (step) | `.eye` opacity |
| `char-pop` | 0.15s | `.claim-char` scale-in |
| `blink-cursor` | 0.9s | claim-bubble cursor |
| `dot-pulse` | 1.3s, stagger 0.4s | speech-trail dots |
| `flicker` | 1.2s alternate | `.strike.lit` candle scaleY |
| (card hover) | 0.2s ease | `.card:hover { translateY(-18px) }` (not a keyframe; hover transition) |

Day-5 additions (NOT in phase 1): caught-lie desaturate-to-red, strike-increment screen-shake, card-flip reveal, lie-score number-pop juice.

---

## 7. Types (consumed from elsewhere, summarized)

No new types live in this spec. Everything is consumed:

- `Persona`, `Rank`, `Card`, `ClientSession`, `ClientRound`, `PublicClaim`, `VoiceMeta`, `JokerType` — from `src/lib/game/types.ts`.
- `AiDecision`, `AiPlay` — from `src/lib/ai/types.ts` (server-side only; never reaches client after `toClientView`).
- `VOICE_PRESETS`, `PERSONA_VOICE_IDS` — from `src/lib/voice/presets.ts`.

The display-name module adds ONE value constant:

```ts
// src/lib/persona/displayNames.ts
import type { Persona } from '../game/types';
export const PERSONA_DISPLAY_NAMES: Record<Persona, string> = {
  Novice:      'The Defendant',
  Reader:      'The Prosecutor',
  Misdirector: 'The Attorney',
  Silent:      'The Judge',
};
```

Drift guard: a test (`displayNames.test.ts`) asserts all four keys are present.

---

## 8. Invariants (Vitest — mandatory)

Visual regression testing (pixel snapshots) is OUT of scope for phase 1 (it's fragile, slow, and the aesthetic is still iter-6-pending). Instead, test BEHAVIORAL invariants:

1. **`useGameSession` phase derivation** — given a `ClientSession` snapshot with `status: 'round_active'`, `round.status: 'claim_phase'`, `round.activePlayer: 'player'` → hook state `phase === 'idle'` (pre-press) or `'recording'` (press held). Covers the phase-gate matrix in §3.3.
2. **Event dispatch → fetch** — `dispatch({ type: 'PlayerRespond', action: 'challenge' })` issues exactly one `POST /api/turn` with the correct body; on 2xx response, applies returned `ClientSession` to state.
3. **Fetch failure surfaces error** — network rejection → `state.error` populated, `state.phase` unchanged (does not advance phase).
4. **Persona display names are complete** — `Object.keys(PERSONA_DISPLAY_NAMES).sort()` deep-equals `['Misdirector','Novice','Reader','Silent']`.
5. **Card selection state resets on phase change** — `useCardSelection` clears its Set when `phase` transitions out of `recording`.
6. **Typewriter completes** — `useTypewriter('hello', 10, onDone)` with fake timers → after 5 × 10ms ticks, full string rendered AND `onDone` fired exactly once.
7. **HoldToSpeak gates on MediaRecorder state** — stop() before start() is a no-op; double-start is idempotent.
8. **API `/api/turn` `PlayerClaim` rejects card ids not in hand** — 400 response with error code; session state unchanged.
9. **API `/api/turn` chains AI judgment inline for `PlayerClaim`** — response includes `aiDecision` when the just-claimed card triggered a challenge or accept.
10. **TTS preset selected from persona + truthState** — mocked TTS client; assert the call args use `VOICE_PRESETS[persona][truthState]`.
11. **`toClientView` applied on every response** — a response body's `ClientSession` has no `actualCardIds` anywhere; opponent hand is `handSize`, not a card array.
12. **`GameSession` component smoke test** — renders without crashing when given an initial `ClientSession` in `round_active`/`claim_phase`; shows the player's hand and the CALL tag.

Target: 12-20 tests across `GameSession.test.tsx`, `useGameSession.test.ts`, `displayNames.test.ts`, and `api/turn/route.test.ts`.

**NOT tested:** pixel output, specific Tailwind class presence, specific z-index values (these are locked in `variant-d-across-table.html` — the iter-6 review will re-validate).

---

## 9. Out of scope (deferred with named owners)

| Item | Owner / When |
|---|---|
| Jokers UI + jokers effect animations | `joker-system` spec, Day 5 |
| Stage Whisper probe UI (question input + AI probe response bubble) | `probe-phase` spec, Day 5 |
| Post-round autopsy panel (Earful joker / `llmReasoning` reveal) | `joker-system` spec consumer, Day 5 |
| §1.5 elimination beat orchestration (silent beat, final-words, stinger, cut-to-black, `GUILTY · EXECUTED` reveal) | §1.5 consumer, Day 5 |
| Tension music bed (ElevenLabs Music API + Web Audio ducking) | `tension-music-system` spec, Day 5 |
| Lie-score bar UI (only visible when Cold Read joker active) | `joker-system` spec, Day 5 — decision locked per §10.2 |
| ~~Rounds-won indicator~~ | LOCKED §10.3 mini-gavels — `<RoundsWonGavels/>` is phase-1 in-scope |
| Persona portraits (replace silhouette stand-in) | external Flux/Midjourney generation |
| Courtroom background re-skin (judge's bench, pews, columns) | iter-6 pending |
| Tutorial / Clerk onboarding flow | future milestone |
| Full sound-effects library (card flick, gavel, whoosh) | Day 5 + Day 6 recording |
| Win/lose full presentation (beyond phase-1 stub) | Day 5 elimination beat |
| `CASE DISMISSED` / `GUILTY · EXECUTED` typewriter reveal sequence | Day 5 |
| OBJECTION! button variant rename (if approved iter-6) | iter-6 pending |

---

## 10. Pending design decisions (iter-6 — flag in requirements.md as open items)

These are explicitly NOT locked. Requirements.md should capture them under `## Design questions for Scott` so they surface for review before Day 5 polish:

1. ~~**`TARGET` → `CALL` rename**~~ — **LOCKED 2026-04-19**: target tag reads `CALL · {rank}`. No longer pending.
2. ~~**Lie-score bar placement**~~ — **LOCKED 2026-04-19**: option (b) — **gated behind the Cold Read joker** (Day 5). When the joker is active for a round, the opponent's `voiceMeta.lieScore` is revealed via a compact bar. When inactive, the value is server-only (AI brain uses it, player does not see it). This means **`<LieScoreMini/>` is NOT part of phase 1** — the component moves to `joker-system` spec scope. Phase 1 renders NO lie-score UI. Removed from §2 component tree and §5 file layout accordingly.
3. ~~**Rounds-won indicator**~~ — **LOCKED 2026-04-19**: row of 3 mini-gavels below `<StrikeCounter/>` in the top-right HUD cluster. Each gavel slot: empty (not played) / filled gold (won) / red-X (lost). New component `<RoundsWonGavels/>` added to §2 component tree; new file `src/components/game/Hud/RoundsWonGavels.tsx` added to §5 file layout. Round pill stays simple "ROUND N · BEST OF 3".
4. **Button placement distance from hand** (§10a item 5). Phase 1 default: `bottom: 8%` (moved up from `14px`). Revisit after portraits land.
5. **Opponent name → top-bar title merge** (§10a item 1). Phase 1 default: separate `.opponent-label` under silhouette. iter-6 decision: merge into dynamic top-bar title "THE PROSECUTOR · ROUND 01 · BEST OF 3 · STRIKES [X][][]".
6. **Courtroom background re-skin** (§10a item 9). Phase 1: keep current wood-paneling. iter-6: swap to judge's bench / pews / columns after portraits.
7. **Lose-screen button text** — Scott already locked `NEW TRIAL` (DESIGN-DECISIONS.md §12); phase 1 stub uses this.
8. ~~**Session storage strategy**~~ — **LOCKED 2026-04-19**: Vercel KV. Session state lives in Redis managed by `@vercel/kv` (≈5-15 ms read, survives cold starts + redeploys + concurrent lambdas). `src/lib/session/store.ts` exposes the same `get(id) / set(id, session) / delete(id)` interface as an in-memory Map so callers don't care about the backend. TTL 1 hour per session. Requires `KV_URL` + `KV_REST_API_TOKEN` env vars in Vercel project settings + `pnpm add @vercel/kv`.

---

## 11. Dependencies

| Dep | Owner spec | What this spec needs |
|---|---|---|
| `reduce(Session, GameEvent)` + `toClientView` | `game-engine` | Server-side FSM reducer + client projection |
| `makeDeck`, `shuffleDeck`, `dealFresh`, `parseClaim` | `deck-and-claims` | Server uses these to seed initial session + handle inter-round reshuffle |
| `VOICE_PRESETS`, `PERSONA_VOICE_IDS`, `stt.ts` heuristic | `voice-tell-taxonomy` | Server looks up TTS settings per persona + truthState; runs STT on player audio |
| `aiDecideOnClaim`, `aiDecideOwnPlay` | `ai-opponent` | Server invokes brain; passes result back into FSM |
| `@elevenlabs/elevenlabs-js` (or direct fetch) | infra | TTS call from server |
| `@vercel/kv` | infra (add on Day 4) | Session storage — see §10.8 |
| Next.js 16 App Router + React 19 + Tailwind 4 | infra | stack conventions |
| shadcn/ui Button + Dialog primitives | infra | styled buttons base |

Consumed but NOT modified: all of the above live outside `src/app/game/**`, `src/components/game/**`, `src/hooks/**`.

---

## 12. Architecture consistency note

This spec introduces NO new game types. The `game-engine` FSM remains the single source of truth for session state. The `ai-opponent` brain remains the single entry point for AI decisions. This spec is a presentation + thin-API-route + client-state layer.

The ONLY additions to the broader codebase are:
- React components under `src/components/game/**` (purely presentational)
- Client hooks under `src/hooks/**` (no server logic)
- API routes under `src/app/api/{session,turn,voice}/**` (thin — validate → build-ctx → delegate → respond)
- `src/lib/persona/displayNames.ts` (4-entry constant + drift test)
- `src/lib/session/{store,buildContexts}.ts` (session singleton + ctx builders)
- CSS theme + font imports

If any of these introduce cross-layer coupling (e.g. a hook importing from `src/app/api/**`, or a component directly calling the FSM reducer), flag it — the architecture invariant is:

```
presentation (components + hooks)
       ↓ dispatch via fetch
    API routes
       ↓ function call
 game-engine FSM + ai-opponent brain
       ↓ consumes
   deck-and-claims + voice-tell-taxonomy
```
