---
inclusion: fileMatch
fileMatchPattern: "src/lib/music/**/*.ts|src/hooks/useMusicBed.ts|src/app/api/music/**/*.ts"
---

# tension-music-system — Design

## Provenance

Authored by Claude Code on 2026-04-19 as a TypeScript-level codification of the Day-5 music-bed layer called out in `.kiro/steering/tech.md` ("ElevenLabs Music API ... 3 pre-gen tracks per session via `Promise.all` ... Web Audio GainNode ducking") + `.kiro/steering/product.md` §1.5 ("Music ducks via Web Audio `GainNode` ... 400ms linear ramp"). Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via seeded prompt (§12). Tasks executed by Claude Code with Sonnet 4.6 implementation subagents + Opus 4.7 review subagent per spec.

Iter-1 review (2026-04-19) applied: 12 findings fixed (3 critical, 5 high, 4 medium) + 1 gap addressed. SDK call shape Context7-verified.

Iter-2 review (2026-04-19) caught 1 regression + 2 staleness findings; iter-3 fixes applied same day — Fix 5 re-strategized to key on `audioPlayer.isPlaying` transition (no hook mod).

Live-gameplay audio bed: ElevenLabs Music API-generated tension tracks staged at session setup, client-side Web Audio `GainNode` ducking that lowers music volume during STT input (hold-to-speak press) and TTS playback (AI claim voice), tension-level cross-fading driven by FSM state.

**Scope of this spec:**
- Tension-level taxonomy (3 levels: `calm` / `tense` / `critical` — lines up with existing `Session.musicTracks[].level` stub in `src/lib/game/types.ts`)
- FSM → TensionLevel derivation (pure function, no new state needed on `Session`)
- Pregeneration pipeline (`POST /api/music/pregen` → 3 concurrent `client.music.compose()` calls via `@elevenlabs/elevenlabs-js` SDK)
- Client hook `useMusicBed` — AudioContext priming, loop playback, cross-fade between tension levels
- Ducking signaling — `duckForInput()` / `duckForOutput()` / `restore()` API called by `<GameSession>` in response to `useHoldToSpeak` state changes + `useAudioPlayer` onEnded callback
- Graceful degradation (Music API failure → music disabled, game still plays)
- Browser compat (autoplay policy, iOS Safari AudioContext suspension)

**NOT in this spec** (handled elsewhere):
- TTS voice presets + persona voice binding — `voice-tell-taxonomy` / `ai-personas`
- STT metadata heuristic — `voice-tell-taxonomy`
- §1.5 elimination-beat static clips (final-words, stinger, mechanical SFX) — `voice-preset-conventions.md` steering, pre-gen scripts, NOT music
- Music generation prompts themselves (LLM-crafted or hand-authored composition descriptions per level) — lives in `src/lib/music/prompts.ts`, values are iterated on during Day-5 tuning; shape is owned here
- Live-gen / streaming music mid-session — future work (§11 open question 3); MVP is pregen-only
- Fine-grained tempo / key matching across tracks — only tension-level matters

## Canonical sources

Read in this order when extending or auditing this spec:

1. `.kiro/steering/tech.md` "Music" row — locked the three-track pregen + `Promise.all` + GainNode-ducking approach.
2. `.kiro/steering/product.md` §1.5 "Silent-beat-before-reveal" — locks the 400ms linear-ramp ducking behavior for the elimination beat; this spec extends that to cover STT-input + TTS-output ducking for every turn, not just reveals.
3. `.kiro/steering/voice-preset-conventions.md` — canonical audio/voice structure (Flash v2.5 is Day-1 live TTS; v3 is §1.5 pre-gen only; music is a third concurrent audio surface).
4. `.kiro/specs/voice-tell-taxonomy/design.md` — TTS playback is the "output duck" trigger; `useAudioPlayer` consumes TTS URLs.
5. `.kiro/specs/ui-gameplay/design.md` §2 (component tree), §3.2 (`useHoldToSpeak` + `useAudioPlayer`), §3.3 (phase table) — music hook sits alongside these hooks inside `<GameSession>`.
6. `src/lib/game/types.ts` lines 133-149 — existing `MusicTrack { level: 'calm'|'tense'|'critical'; url: string }` + `Session.musicTracks: MusicTrack[]` + `ClientSession.currentMusicUrl?: string` already stubbed.
7. `src/hooks/useAudioPlayer.ts` — one-shot TTS player; `onEnded(cb)` is the output-duck-restore signal.
8. `src/hooks/useHoldToSpeak.ts` — `state: 'idle' | 'requesting' | 'recording' | 'stopped'` is the input-duck-trigger source.
9. ElevenLabs JS SDK (`@elevenlabs/elevenlabs-js`) — `client.music.compose({ prompt, musicLengthMs })` returns an async iterable yielding `Uint8Array` chunks (Context7-verified; the `for await (const chunk of music)` usage in §5.3 confirms this shape — see §3 research citation).

---

## 1. Overview

### 1.1 Purpose

Add a continuously-present tension music bed to Hearsay that (a) escalates with gameplay stakes via three tension levels, and (b) politely steps back during every voice moment so speech — player STT and AI TTS — is intelligible. This is the third concurrent audio surface in the app (TTS + SFX + music); the ducking is what makes three-surface coexistence not a mess.

### 1.2 In scope

- `TensionLevel` enum + FSM-derived mapping function
- `POST /api/music/pregen` route that calls ElevenLabs Music API 3× concurrently and writes URLs back into `Session.musicTracks`
- `useMusicBed` React hook — loop playback + cross-fade + ducking primitives
- Wiring into `<GameSession>` via existing hook signals
- Graceful-degradation path (music-disabled) verified by invariant

### 1.3 Out of scope

- Voice lines (TTS) — `voice-tell-taxonomy`
- §1.5 elimination-beat static clips — pre-gen scripts, not this spec
- Streaming/live-gen per-tension-change — future work; MVP pregenerates once
- Tempo/beat matching across tracks — tension-level change is a cross-fade, not a beat-matched transition
- Custom mixing (EQ, reverb, compression) — out per `product.md` "Out of scope" row

---

## 2. Key concepts

| Term | Meaning |
|---|---|
| **Tension level** | Enum value (`calm` / `tense` / `critical`) that the FSM state maps to. Selects which pregen track plays. |
| **Music bed** | The continuously-looping background track. Never silent during `round_active`; volume modulated, not stopped. |
| **Pregen** | Generating all three tracks at session setup via `Promise.all`, storing MP3 URLs on `Session.musicTracks`. Opposite of live/stream generation. |
| **Ducking** | Temporary volume reduction via `GainNode.gain.linearRampToValueAtTime()`. Input-duck (STT press) and output-duck (TTS play) share the same ramp primitives. |
| **Cross-fade** | Tension-level change: fade out the old track over ~800ms while fading in the new one over the same window. Two `<audio>` + `GainNode` pairs, swap which is "primary". |
| **AudioContext priming** | Browser autoplay policy requires the first `AudioContext.resume()` or `audio.play()` to happen inside a user-gesture handler. We wire this to the player's first BEGIN TRIAL click. Without priming, every subsequent programmatic `.play()` rejects. iOS Safari starts the `AudioContext` in `suspended` state even after creation — `await audioContext.resume()` MUST be called inside the gesture tick before any `.play()`. Prime pseudocode: `async function prime() { await audioContext.resume(); await primary.play(); primary.pause(); }` |
| **Music-disabled path** | If pregen fails or returns any empty URL, client sets `musicDisabled = true` and gameplay proceeds silently. Never a blocking error. |

---

## 3. Architecture

```
                                       Session setup (one-time)
                                       ════════════════════════
  POST /api/session  ──►  POST /api/music/pregen (server-side)
                                       │
                                       │  @elevenlabs/elevenlabs-js
                                       │  Promise.all([
                                       │    client.music.compose({ prompt: CALM_PROMPT,     musicLengthMs: 60000 }),
                                       │    client.music.compose({ prompt: TENSE_PROMPT,    musicLengthMs: 60000 }),
                                       │    client.music.compose({ prompt: CRITICAL_PROMPT, musicLengthMs: 60000 }),
                                       │  ])
                                       │
                                       ▼
                       Session.musicTracks = [
                         { level: 'calm',     url: '/api/music/track/<hash>' },
                         { level: 'tense',    url: '...' },
                         { level: 'critical', url: '...' },
                       ]


                                       Live gameplay (every frame)
                                       ═══════════════════════════
  FSM state  ──► deriveTensionLevel(session)  ──►  currentTensionLevel
                                                         │
                                                         ▼
                                             useMusicBed (client hook)
                                             ┌────────────────────────────────┐
                                             │  AudioContext (primed once)    │
                                             │                                │
                                             │  primary <audio>  ─► GainNode ─┼─► destination
                                             │                                │
                                             │  secondary <audio> ─► GainNode ┤ (cross-fade target)
                                             │                                │
                                             └────────┬─────────────┬─────────┘
                                                      │             │
                              duckForInput()  ◄───────┘             └───► restore()
                              duckForOutput() ◄───────┐             ┌───► restore()
                                                      │             │
                                       useHoldToSpeak.state         useAudioPlayer.onEnded
                                       ('recording' → duck,
                                        'stopped'   → no-op;
                                        restore triggered by
                                        STT-done or TTS-start)
```

**Research citation:** ElevenLabs Music API confirmed as a first-class product offering. Library ID `/elevenlabs/elevenlabs-js`. The SDK surface is `client.music.compose({ prompt, musicLengthMs })`, documented under `POST /v1/music` (endpoint body type `ElevenLabs.BodyComposeMusicV1MusicPost`). `musicLengthMs` is milliseconds (min 3000, max 600000); use `60000` for 60-second tracks. `client.music.stream(...)` is NOT confirmed by Context7 — pending SDK verification; use `compose()` only in v1. Response is an async iterable yielding `Uint8Array` chunks — server-side we collect chunks into a Buffer, write to `/tmp/music-cache/<hash>.mp3` in dev, and serve via `GET /api/music/track/[hash]` at runtime (see §5.3). This mirrors the TTS cache pattern in `voice-preset-conventions.md` §"Cache policy". No raw HTTP needed — SDK covers it.

**Why pregen not stream:** (a) three 60-second tracks concurrently fit in ~10s of wall-time (`Promise.all`) — acceptable loading moment with a "Generating game..." label per `tech.md`; (b) MP3 URLs are seekable, enabling clean cross-fade and loop management without re-requesting mid-game; (c) `$0` cost repeats when cache-hit on hash-identical prompts; (d) deterministic audio = reproducible demos; (e) stream would eat bandwidth + flake on tension-change boundaries. Live/stream is documented as future work (§11).

---

## 4. Data model

### 4.1 TensionLevel (enum)

```ts
// src/lib/music/tension.ts
export type TensionLevel = 'calm' | 'tense' | 'critical';
```

Three levels, locked to match the existing `MusicTrack['level']` union in `src/lib/game/types.ts` line 134. Adding a fourth later would be additive (no rename), but the spec LOCKS three for MVP — product.md §1.5 pivot explicitly "cut during §1.5 pivot risk analysis: ... 4th music track 'death'".

### 4.2 FSM → TensionLevel derivation (pure)

```ts
// src/lib/music/tension.ts
export function deriveTensionLevel(session: Session): TensionLevel {
  if (session.status === 'session_over') return 'critical';
  if (session.status !== 'round_active') return 'calm';

  const maxStrikes = Math.max(session.player.strikes, session.ai.strikes);
  if (maxStrikes >= 2) return 'critical';       // one strike from elimination
  if (maxStrikes === 1) return 'tense';
  return 'calm';
}
```

**Rationale:**
- Strikes are the cleanest tension axis — they're visible to the player, cumulative, and gameplay-relevant (3 = instant loss per `product.md`).
- FSM phase (`claim_phase` vs `response_phase`) is intentionally NOT used as a tension signal — that would cross-fade twice per turn, which auditory testing in adjacent games shows is disorienting. Strikes change only on challenge reveals, so cross-fades happen at natural narrative beats.
- `session_over` → `critical` so the stinger lands over the already-high-stakes bed. The elimination-beat's ducking (`product.md` §1.5) then handles the silent-beat reveal on top.
- Setup/joker-offer → `calm` — the between-round breather.

### 4.3 Session shape (ALREADY STUBBED — no new types)

`Session.musicTracks` is ALREADY defined per Day 4 retro:

```ts
// from src/lib/game/types.ts (read-only for this spec)
export interface MusicTrack {
  level: 'calm' | 'tense' | 'critical';
  url: string;
}
export interface Session {
  /* ... */
  musicTracks: MusicTrack[];   // currently stubbed with 3 empty-URL entries per Day 4 FSM SetupComplete invariant
}
export interface ClientSession {
  /* ... */
  currentMusicUrl?: string;    // already present
}
```

**What this spec does with the stub:**
- Leaves the type shape exactly as-is (no mutations — read-only constraint).
- Replaces the three empty-URL entries with real URLs via `POST /api/music/pregen` once per session.
- `ClientSession.currentMusicUrl` is NOT populated by this spec — the client already receives `musicTracks` through `ClientSession` projection (it's not secret state), and the hook resolves the URL from (tracks, currentTensionLevel). Keeping `currentMusicUrl` unused for now preserves it for any future server-selected-track use case; flagged as open question §11 Q2.

**No new `Session.currentTensionLevel` field.** Derivation is pure — recomputed every render from FSM state. Adding a persisted field would duplicate truth (classic `reference_ai_regression_patterns.md` "duplicated state" anti-pattern).

### 4.4 DuckingState (client-only)

```ts
// src/hooks/useMusicBed.ts — internal state, not exported
type DuckState = 'idle' | 'ducked-for-input' | 'ducked-for-output' | 'ducked-for-both';
```

Lives inside the hook; never crosses the wire. `ducked-for-both` handles the race where STT press and TTS playback overlap (unusual but survivable — see §6.3).

---

## 5. API surface

### 5.1 `POST /api/music/pregen`

**Request:**
```ts
interface MusicPregenRequest {
  sessionId: string;
}
```

**Response (success):**
```ts
interface MusicPregenResponse {
  tracks: MusicTrack[];         // length 3, covers all TensionLevels
  generatedMs: number;          // wall-time for telemetry
}
```

**Response (failure):**
```ts
interface MusicPregenError {
  error: { code: 'elevenlabs-error' | 'invalid-session' | 'timeout'; message: string };
  tracks: MusicTrack[];         // empty array — client flips musicDisabled = true
}
```

**Server-side flow:**
1. Validate `sessionId` exists via `src/lib/session/store.ts`. If not, return `invalid-session`.
2. Build 3 prompt strings via `src/lib/music/prompts.ts` (one per `TensionLevel`).
3. `Promise.all([calm, tense, critical])` of `client.music.compose({ prompt, musicLengthMs: 60000 })` calls. **Note:** generated MP3s are NOT written to `/public/` — Vercel production filesystem is read-only at runtime.
4. For each returned async iterable:
   a. Collect chunks into `Buffer`.
   b. Compute SHA-256 hash of prompt (cache key).
   c. Store the `Buffer` in KV (already present) keyed by `music:<hash>`. **Do NOT write to `/public/`** — Vercel production filesystem is read-only outside build; writing to `/public/` silently 404s.
   d. URL = `/api/music/track/<hash>` (served by `GET /api/music/track/[hash]` route — see §5.4).
5. Construct `tracks: MusicTrack[]` of length 3.
6. Update `Session.musicTracks` via session store.
7. Return response.

**Timeout:** SDK call wrapped in `Promise.race` with a 20-second budget per track. If any track times out, the whole request fails (all-or-nothing — partial tracks produce a gap in the tension-level coverage, worse than no music).

**Idempotency:** Hash-based cache means re-calling `/api/music/pregen` for the same session with the same prompts is cheap (cache-hits on all 3). Safe to retry.

### 5.2 Alternative: inline in `/api/session` POST

**Considered:** Make `POST /api/session` do both setup AND music pregen in one round-trip.

**Rejected for MVP because:**
- `/api/session` currently returns quickly (<200ms) — inlining +10s wall-time blocks the initial render of the scene.
- Separating lets the UI show the scene backdrop + "Generating game music..." progress indicator in parallel with the pregen call — better UX.
- The operations can fail independently; separation means music-fail doesn't fail session-create.

**Flow chosen:** Client calls `POST /api/session` → renders idle scene → fires `POST /api/music/pregen` in parallel with the user reading the scene → when pregen resolves, music bed begins on first BEGIN TRIAL click (which primes the AudioContext — §2).

### 5.3 `client.music.compose` SDK contract (verbatim from research)

```ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY! });

const music = await client.music.compose({
  prompt: CALM_PROMPT,
  musicLengthMs: 60000,   // milliseconds; min 3000, max 600000 (Context7-verified)
});

const chunks: Uint8Array[] = [];
for await (const chunk of music) {
  chunks.push(chunk);
}
const mp3 = Buffer.concat(chunks);
```

SDK method: `client.music.compose({ prompt, musicLengthMs })`. Underlying REST endpoint: `POST /v1/music`. Returns an async iterable yielding `Uint8Array` chunks. No streaming-to-client in MVP — server collects fully then stores in KV, and serves via `GET /api/music/track/[hash]`.

### 5.4 `GET /api/music/track/[hash]`

**Purpose:** Runtime-serve pregen MP3 buffers stored in KV. Vercel production filesystem is read-only at runtime — `/public/` writes from server code silently 404; this route is the correct alternative.

**Request:** `GET /api/music/track/<hash>` (no body).

**Response (hit):** `Content-Type: audio/mpeg`, body = raw MP3 buffer from KV. Add `Cache-Control: public, max-age=86400` (tracks are content-addressed by prompt hash — immutable for a given prompt).

**Response (miss):** `404 { error: 'track-not-found' }` — client hook falls through to `enabled: false` (same as I5 path).

**KV key schema:** `music:<hash>` where `<hash>` is SHA-256 of the prompt string (hex, 64 chars).

---

## 6. Client hook — `useMusicBed`

### 6.1 Signature

```ts
// src/hooks/useMusicBed.ts
export interface UseMusicBedArgs {
  tracks: MusicTrack[];          // 3-entry array from ClientSession
  currentTensionLevel: TensionLevel;
  enabled: boolean;              // false when musicDisabled OR user muted
}

export interface UseMusicBedAPI {
  /**
   * Call once, inside a user-gesture handler (BEGIN TRIAL click). Idempotent.
   * MUST await audioContext.resume() first — iOS Safari starts AudioContext suspended.
   * Implementation: async function prime() { await audioContext.resume(); await primary.play(); primary.pause(); }
   */
  prime: () => Promise<void>;
  /** Lower volume for STT input (hold-to-speak). */
  duckForInput: () => void;
  /** Lower volume for TTS output playback. Optional fadeMs overrides DUCK_FADE_MS (e.g. elimination beat). */
  duckForOutput: (opts?: { fadeMs?: number }) => void;
  /** Restore full volume. Caller decides when (e.g. TTS onEnded). */
  restore: () => void;
  /** Stop playback entirely — used only on unmount. */
  stop: () => void;
  /** Telemetry — whether the AudioContext is actually running. */
  isRunning: boolean;
}

export function useMusicBed(args: UseMusicBedArgs): UseMusicBedAPI;
```

**Why a pair of `duckFor*` methods instead of one `duck(reason)`:** explicit call sites in `<GameSession>` are easier to audit — someone reading the component sees exactly which hook event causes a duck. The internal state combines them via `DuckState`.

### 6.2 Internal state machine

Two `HTMLAudioElement` + `GainNode` pairs, labeled `primary` and `secondary`. Primary is the currently-audible track; secondary sits at gain 0 ready for cross-fade.

**Tension-level change** (e.g. `calm` → `tense`):
1. Set `secondary.src` to new track URL.
2. Call `secondary.play()`.
3. In a single `requestAnimationFrame`, schedule:
   - `primaryGain.gain.linearRampToValueAtTime(0, now + 0.8)` — fade out over 800ms.
   - `secondaryGain.gain.linearRampToValueAtTime(baseVolume, now + 0.8)` — fade in over 800ms.
4. After 800ms, pause the old primary, swap labels (secondary becomes primary).

**Ducking** (input or output):
- Ramp MUST be anchored to avoid starting from a stale scheduled value (audible jumps or no-op ramp):
  ```ts
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);           // anchor at current actual value
  gain.linearRampToValueAtTime(target, now + DUCK_FADE_MS / 1000);
  ```
- `primaryGain.gain.linearRampToValueAtTime(DUCK_GAIN, now + DUCK_FADE_MS / 1000)` where:
  - `DUCK_GAIN = 0.2` (20% of base volume)
  - `DUCK_FADE_MS = 400` (locked by steering §1.5 — 400ms linear ramp; see §11 Q9 if a shorter STT/TTS ramp is desired)
  - `DUCK_FADE_MS_ELIMINATION = 400` (for §1.5 silent-beat — locked by product.md §1.5; `<EliminationBeat>` will import a constant from this module on Day 5)

**Restore:**
- `primaryGain.gain.linearRampToValueAtTime(baseVolume, now + DUCK_FADE_MS / 1000)`

### 6.3 Concurrent duck handling

If both STT press and TTS playback want to duck simultaneously (rare — would require player pressing-to-speak while AI audio is still finishing):

| Scenario | DuckState transition | Effect |
|---|---|---|
| Input-duck while idle | `idle → ducked-for-input` | ramp down |
| Output-duck while idle | `idle → ducked-for-output` | ramp down |
| Input-duck while already output-ducked | `ducked-for-output → ducked-for-both` | no ramp (already at DUCK_GAIN) |
| Output-duck while already input-ducked | `ducked-for-input → ducked-for-both` | no ramp |
| Restore from `ducked-for-input` | `ducked-for-input → idle` | ramp up |
| Restore from `ducked-for-both` (input released) | `ducked-for-both → ducked-for-output` | no ramp (still need duck for TTS) |
| Restore from `ducked-for-both` (TTS ended) | `ducked-for-both → ducked-for-input` | no ramp (still need duck for STT) |

The ramp-duration cost is paid only on transitions into/out of any ducked state; concurrent events don't re-ramp. This avoids volume jitter.

### 6.4 Loop management

Each `<audio>` element MUST be wired into the Web Audio graph via:
```ts
ctx.createMediaElementSource(audioEl).connect(musicGain).connect(ctx.destination);
```
Without `createMediaElementSource`, the `GainNode` chain never sees the audio output and ducking has no effect. Wire both `primary` and `secondary` elements this way at `AudioContext` init.

Each `<audio>` element has `loop = true`. Chosen over manual cross-fade-at-loop-point because:
- ElevenLabs Music API does not guarantee gapless loop points — the composed 60s track may have silence at start/end.
- Browser native `loop = true` is battle-tested; manual looping adds 50+ lines for marginal aesthetic gain.
- Any loop-seam clunk is masked by the continuous gameplay audio (TTS, SFX).

Flagged as a polish item in §11 Q3: "if loop seams are audibly bad, add manual cross-fade at pre-computed loopPointMs."

### 6.5 Integration wiring in `<GameSession>`

Pseudocode (actual wiring lives in `<GameSession>`, not this spec):

```tsx
const holdToSpeak = useHoldToSpeak();
const audioPlayer = useAudioPlayer();
const music = useMusicBed({
  tracks: session.musicTracks,
  currentTensionLevel: deriveTensionLevel(session),
  enabled: !musicDisabled && !userMuted,
});

// Wire input ducking
useEffect(() => {
  if (holdToSpeak.state === 'recording') music.duckForInput();
  if (holdToSpeak.state === 'stopped')   music.restore();   // combined with TTS state below
}, [holdToSpeak.state]);

// Wire output ducking
useEffect(() => {
  if (audioPlayer.isPlaying) music.duckForOutput();
}, [audioPlayer.isPlaying]);

// Prime AudioContext on first user gesture
const onBeginTrial = async () => {
  await music.prime();
  dispatch({ type: 'CreateSession' });
};

// TTS-end restore
// WARNING: audioPlayer.onEnded(cb) is a one-shot, self-clearing callback — it
// clears itself on fire. Registering once in [audioPlayer] deadlocks after the
// first TTS: music stays ducked forever. Re-register on every false→true
// transition of isPlaying instead (audioPlayer exposes no currentUrl field):
const wasPlayingRef = useRef(false);
useEffect(() => {
  if (audioPlayer.isPlaying && !wasPlayingRef.current) {
    audioPlayer.onEnded(() => music.restore());
  }
  wasPlayingRef.current = audioPlayer.isPlaying;
}, [audioPlayer.isPlaying]);
```

**Note:** the actual `<GameSession>` modifications are owned by `ui-gameplay` spec phase 2 (Day 5). This spec OWNS the hook contract; the phase-2 caller reads and implements the wiring.

### 6.6 Client state (`musicDisabled` / `userMuted`)

`musicDisabled` and `userMuted` are referenced throughout this spec. Their canonical home:

```ts
// src/lib/game/types.ts — additive extension to ClientSession (tiny, non-breaking)
export interface ClientSession {
  /* ... existing fields ... */
  musicState?: {
    disabled: boolean;    // true when pregen failed; set by POST /api/music/pregen error handler
    userMuted: boolean;   // true when player has toggled mute; persisted in component state (§11 Q7)
  };
}
```

The `enabled` prop on `useMusicBed` is derived as `!musicState?.disabled && !musicState?.userMuted`.

**Why on `ClientSession` not component state:** `musicDisabled` is a server-originated fact (pregen failed) that may need to persist across component re-mounts. `userMuted` is client-preference and may migrate to `localStorage` in a future session (§11 Q7) — living on `ClientSession` keeps both in the same place.

---

## 7. Integration points

### 7.1 Shared-state additions

| Item | Location | Status |
|---|---|---|
| `Session.musicTracks` shape | `src/lib/game/types.ts` L133-149 | **ALREADY STUBBED** — no change; this spec populates URLs |
| `ClientSession.currentMusicUrl` | `src/lib/game/types.ts` L172 | **ALREADY STUBBED** — unused by this spec (see §4.3); reserved |
| `ClientSession.musicState` | `src/lib/game/types.ts` (ADDITIVE) | `{ disabled: boolean; userMuted: boolean }` — see §6.6 |
| `TensionLevel` type | `src/lib/music/tension.ts` (NEW) | alias of `MusicTrack['level']` |
| `deriveTensionLevel(session)` | `src/lib/music/tension.ts` (NEW) | pure function |
| `POST /api/music/pregen` route | `src/app/api/music/pregen/route.ts` (NEW) | calls SDK |
| `GET /api/music/track/[hash]` route | `src/app/api/music/track/[hash]/route.ts` (NEW) | KV-served MP3 stream |
| `useMusicBed` hook | `src/hooks/useMusicBed.ts` (NEW) | client-side |
| `src/lib/music/prompts.ts` | NEW | `CALM_PROMPT`, `TENSE_PROMPT`, `CRITICAL_PROMPT` constants |
| `src/lib/music/tracks.ts` | NEW | helpers: `getTrackUrl(tracks, level): string \| null` |

**Modifications to existing files:** Only `src/lib/game/types.ts` is touched — additive `musicState?` field on `ClientSession` (§6.6). All other existing files unchanged.

### 7.2 Interface with FSM

The FSM does NOT import anything from this spec. `deriveTensionLevel` is a caller-side derivation:
- Client computes it every render from `ClientSession`.
- Server computes it when needed (e.g. to populate `ClientSession.currentMusicUrl` if that field is ever activated).

No `GameEvent` is added to the FSM union. Music is a pure side-effect layer — if it's gone, FSM behavior is unchanged.

### 7.3 Interface with existing audio hooks

| Hook | Signal | Music-hook action |
|---|---|---|
| `useHoldToSpeak` | `state === 'recording'` | `music.duckForInput()` |
| `useHoldToSpeak` | `state === 'stopped'` | `music.restore()` (if not also ducked for TTS) |
| `useAudioPlayer` | `isPlaying` transitions `false → true` | `music.duckForOutput()` |
| `useAudioPlayer` | `onEnded` fires | `music.restore()` |

No changes required to `useHoldToSpeak.ts` or `useAudioPlayer.ts`. Their existing exports are sufficient — this spec consumes them read-only. (verified iter-3: Fix 5 now keys on `isPlaying` transition, no hook modification needed)

### 7.4 §1.5 elimination-beat hook

`<EliminationBeat>` (Day 5, owned by `ui-gameplay` phase 2) calls `music.duckForOutput()` with the 400ms ramp for the silent-beat-before-reveal. Since the ramp duration is per-call not per-hook-config, this spec exposes:

```ts
music.duckForOutput({ fadeMs: 400 });  // optional override
```

Default `fadeMs = 400` (steering §1.5 lock); elimination beat may pass 400 explicitly for clarity. Documented in §6.2.

---

## 8. Error handling

| Failure mode | Response | Invariant |
|---|---|---|
| ElevenLabs Music API returns 5xx | Server returns `MusicPregenError` with `tracks: []`. | Client sets `musicDisabled = true`. Gameplay proceeds silently. |
| Music API returns 429 rate-limit | Same as 5xx — don't block game on rate limits. | Degrade gracefully. |
| Any track URL returns 404 when client loads it | Hook emits `trackLoadFailed` telemetry; falls through to `enabled: false`. | I5: music-disabled path works. |
| `AudioContext` suspended (iOS Safari tab-backgrounded) | Detect via `document.visibilitychange`; call `audioContext.resume()` on foreground. If `resume()` rejects (recent Safari rejects non-gesture resumes), enqueue a `document.addEventListener('pointerdown', resumeOnce, { once: true })` fallback that calls `audioContext.resume()` on next user interaction. | Music resumes at current tension level without cross-fade. |
| Autoplay policy blocks `.play()` before gesture | `prime()` wraps the first `.play()` + `.pause()` inside the BEGIN TRIAL click. Until primed, `isRunning === false`. | I7: music stays silent until primed; ducking API is a no-op pre-prime. |
| `musicLengthMs < 3000` returns <3s audio (ElevenLabs minimum is 3000ms) | SDK throws; caught as `elevenlabs-error`. | Pregen fails cleanly. |
| `Session.musicTracks` has an empty URL (stub not overwritten) | Hook falls through to disabled state. | I5. |
| Concurrent pregen retries | Hash cache makes second call free. | Idempotency via §5.1. |

**Non-goal:** a Retry button. If pregen fails, the user sees the game proceed silently with a small "(music unavailable)" footer. Retrying with a button adds 3 code paths and a bounce loop risk for a feature that's nice-to-have.

---

## 9. Invariants (Vitest — MANDATORY)

Target 6-10. All tests live in `src/lib/music/*.test.ts` + `src/hooks/useMusicBed.test.ts` + `src/app/api/music/pregen/route.test.ts`.

1. **I1 — Input ducking on hold-to-speak press.** Mock AudioContext + GainNode. Render `<GameSession>` with music enabled, simulate `useHoldToSpeak.state === 'recording'`. Assert `primaryGain.gain.linearRampToValueAtTime` was called with `(0.2, ~now + 0.4s)`.
2. **I2 — Restore on TTS onEnded.** Mock `useAudioPlayer.onEnded`, trigger it. Assert ramp back to `baseVolume` (e.g. 1.0) with 400ms duration.
3. **I3 — Tension-level change triggers cross-fade.** Change `currentTensionLevel` prop from `'calm'` to `'tense'`. Assert both ramps fire: old gain → 0, new gain → base, over 800ms. No abrupt transition (no `.pause()` before ramp completes; new audio `.play()` happens before old one pauses).
4. **I4 — Track URL presence on every TensionLevel after successful pregen.** Mock SDK to return 3 non-empty streams. Call `POST /api/music/pregen`. Assert `Session.musicTracks` contains entries for all of `'calm'`, `'tense'`, `'critical'` with non-empty `url`.
5. **I5 — Music-disabled path still lets gameplay proceed.** Set `enabled: false` on hook. Run the full `<GameSession>` smoke test (from `ui-gameplay`). Assert no errors, no AudioContext created, all ducking API calls are no-ops.
6. **I6 — Cross-fade timing matches config.** Fake timers. Fire tension-level change. Assert audible switch-over happens exactly 800ms later (the `setTimeout` that pauses old primary).
7. **I7 — Autoplay guard.** Call `duckForInput()` before `prime()`. Assert no AudioContext was created (no premature gesture-less init); no errors.
8. **I8 — `deriveTensionLevel` purity + mapping.** Unit test the function against 6+ session fixtures: setup → calm, round_active with 0 strikes → calm, round_active with 1 strike → tense, round_active with 2 strikes (either player) → critical, session_over → critical, joker_offer → calm.
9. **I9 — Pregen timeout fails cleanly.** Mock SDK to never resolve. `Promise.race` with 20s fires first. Route returns `MusicPregenError` with `tracks: []`. No crash.
10. **I10 — Concurrent duck-both state.** Trigger `duckForOutput` then `duckForInput` before the first restore. Assert gain is still at `DUCK_GAIN` (no re-ramp). Restore TTS first: gain stays at `DUCK_GAIN`. Release STT: gain ramps back to base.

---

## 10. File layout

```
src/
  app/
    api/
      music/
        pregen/
          route.ts                  — POST /api/music/pregen (SDK wrapper + KV store + session-store update)
          route.test.ts             — I4, I9 (mocks @elevenlabs/elevenlabs-js)
        track/
          [hash]/
            route.ts                — GET /api/music/track/[hash] (KV lookup → audio/mpeg response)

  hooks/
    useMusicBed.ts                  — React hook: AudioContext, GainNode pair, ducking + cross-fade
    useMusicBed.test.ts             — I1, I2, I3, I5, I6, I7, I10 (mocks Web Audio API)

  lib/
    music/
      tension.ts                    — TensionLevel type + deriveTensionLevel(session)
      tension.test.ts               — I8
      tracks.ts                     — getTrackUrl(tracks, level) + empty-URL detection
      prompts.ts                    — CALM_PROMPT / TENSE_PROMPT / CRITICAL_PROMPT (~3 strings; tuned Day 5)
```

Total: 4 source files + 4 test files = 8 files. Single Day-5 implementation session.

---

## 11. Open questions (flag in requirements.md)

1. **ElevenLabs Music API concurrency limits.** `Promise.all` of 3 concurrent calls — verified endpoint exists (`POST /v1/music`, SDK `client.music.compose()`) but rate-limit headroom on Creator tier is not documented at time of writing (2026-04-19). If the tier caps at 1 concurrent music call, serialize via `.reduce((p, prompt) => p.then(() => compose(prompt)), Promise.resolve())` — wall-time becomes ~30s instead of ~10s. Resolve during Day 5 first spike.
2. **Budget per session.** 3 × 60s = 180s of generated music per session. ElevenLabs Music API credit cost per second is not listed in the context7 results; document exact cost Day 5 and decide if MVP should cap at 30s/track instead of 60s (trading loop frequency for budget).
3. **Loop strategy polish.** Native `loop = true` may produce audible seams. If Day 5 listening test finds them jarring, add `loopPointMs?: number` to `MusicTrack` and implement manual cross-fade at loopPoint. This is a type-additive change — safe to defer. Alternative: ask the Music API for a looping composition prompt (e.g. "seamlessly loopable 60-second track"); unclear whether the model honors this.
4. **Live-gen vs pregen if API latency drops.** If ElevenLabs releases streaming music with <1s first-chunk latency, consider live-gen on tension-change for higher compositional variety. MVP locks pregen.
5. **`Session.currentTensionLevel` server-held field.** Currently derivation is pure + client-side. If server-side logic needs it (e.g. `POST /api/music/switch` endpoint for explicit tension control by future jokers), add the field then. Do NOT pre-emptively add.
6. **`ClientSession.currentMusicUrl` activation.** Currently unused (§4.3). Possible future use: server-side switching for debugging / replay. Keep stubbed; don't delete.
7. **Mute toggle UX.** Where does the user mute music? Top-bar icon? Keyboard shortcut (`M`)? Out of scope for this spec, but `enabled: false` path already handles the wire-up — `ui-gameplay` phase 2 owns the control.
8. **`useAudioPlayer.onEnded` persistent listener.** The current `onEnded(cb)` API is one-shot and self-clearing. §6.5 works around this by re-registering on the `audioPlayer.isPlaying` false→true transition (via a `wasPlayingRef`). A cleaner long-term fix is to add a `useAudioPlayer.onEnded` persistent-listener variant (e.g. `addEventListener('ended', cb)`). This is a Day-5 follow-up; do NOT modify `useAudioPlayer.ts` in this spec.
9. **`DUCK_FADE_MS` vs steering §1.5.** §6.2 sets `DUCK_FADE_MS = 400` (restored from 150 per steering §1.5 LOCK). If 150ms was intentionally different for STT/TTS vs elimination-beat ramps, this requires an explicit steering §1.5 update to document the split. Resolve on Day 5.

---

## 12. Seed prompt for Kiro (canonical form, paste-ready)

Per `reference_kiro_spec_workflow.md` canonical template. Paste into Kiro Spec mode to generate `requirements.md` + `tasks.md`.

```
Generate requirements.md and tasks.md for the `tension-music-system` spec.

Canonical sources already in repo:

- `.kiro/specs/tension-music-system/design.md` — authoritative architecture, 3-track pregen pipeline, Web Audio ducking contract, 9 Vitest invariants (do NOT modify)
- `.kiro/specs/ui-gameplay/design.md` §2, §3.2, §3.3 — component tree + `useHoldToSpeak` / `useAudioPlayer` consumed read-only; phase-gate extension
- `.kiro/specs/voice-tell-taxonomy/design.md` — TTS playback as the output-duck trigger
- `.kiro/steering/product.md` §1.5 — 400ms linear ramp LOCK (do NOT reduce to 150ms anywhere)
- `.kiro/steering/tech.md` — 3 pregen tracks + Promise.all + GainNode ducking LOCK
- `.kiro/steering/structure.md` / voice-preset-conventions.md — file paths + third-audio-surface convention
- ElevenLabs SDK: `@elevenlabs/elevenlabs-js` — Context7-verified `client.music.compose({ prompt, musicLengthMs })` returning an async iterable of `Uint8Array` chunks (NOT a `ReadableStream`)
- Pre-land commit `29f6a34` on main already adds `ClientSession.musicState?: { disabled: boolean; userMuted: boolean }` to `src/lib/game/types.ts` — tasks MUST import, NOT re-declare

requirements.md — EARS format. Derive acceptance criteria from design.md §2 (key concepts), §3 (architecture), §4 (data model + tension-level derivation), §5 (API surface), §6 (client hook + AudioContext priming + ducking), §7 (integration), §8 (error handling + autoplay + iOS), §9 (invariants I1-I9). Aim ~16-22 criteria. Every design.md invariant (I1-I9) must map to at least one numbered requirement. Locked items that must NOT appear as pending:

- SDK call: `client.music.compose({ prompt, musicLengthMs })` with `musicLengthMs ∈ [3000, 600000]` (NOT `durationSeconds`)
- Return type: async iterable of `Uint8Array` chunks (NOT `ReadableStream<Uint8Array>`)
- Tension taxonomy locked at 3 levels: `calm | tense | critical`
- `DUCK_FADE_MS = 400` for both duck + restore (steering §1.5 lock — NOT 150ms)
- `prime()` awaits `audioContext.resume()` inside the user-gesture tick (iOS Safari requirement)
- Tracks served via new `GET /api/music/track/[hash]` route (NOT written to `/public/sfx/music/`; Vercel prod filesystem is read-only outside build)
- `useAudioPlayer.onEnded` re-registered on `audioPlayer.isPlaying` false→true transition (via `wasPlayingRef`) — NO modification to `useAudioPlayer.ts` (hook stays `{ play, isPlaying, onEnded }`)
- `<audio>` elements wired via `ctx.createMediaElementSource(audioEl).connect(musicGain).connect(ctx.destination)`
- Ramp anchoring: `cancelScheduledValues + setValueAtTime(gain.value, now) + linearRampToValueAtTime(target, now + DUCK_FADE_MS/1000)`
- iOS Safari suspension fallback: `visibilitychange → resume()` with `document.addEventListener('pointerdown', resumeOnce, { once: true })` fallback when resume rejects
- FSM → TensionLevel derivation is PURE (no new `Session` state)
- `ClientSession.musicState?` already pre-landed in types.ts — tasks import, never re-declare

§11 open questions (Q8 persistent-listener `useAudioPlayer.onEnded` variant, Q9 150ms-vs-400ms split ramp discussion, plus any others) MUST appear under `## Design questions for Scott` at bottom — do NOT resolve unilaterally.

tasks.md — 10-14 granular tasks, tests-first where feasible. Each task:

- Links to specific requirement numbers via `_Requirements: X.Y, X.Z_`
- Names exact files (per design.md §10 file layout — `src/lib/music/{tension.ts, prompts.ts, tracks.ts, kvStore.ts}` + co-located `*.test.ts`; `src/hooks/useMusicBed.ts` + test; `src/app/api/music/pregen/route.ts`; `src/app/api/music/track/[hash]/route.ts`)
- Ordered by dependency: pure lib first (`tension.ts` FSM→level derivation, `prompts.ts` composition prompts, `tracks.ts` URL resolver) → KV blob storage helper (`kvStore.ts`) → `POST /api/music/pregen` route → `GET /api/music/track/[hash]` serve route → `useMusicBed.ts` hook (AudioContext prime + `createMediaElementSource` wiring + anchored ramp + ducking + re-register onEnded on `isPlaying` transition) → integration into `<GameSession>` → graceful-degradation test (I5 path) → final full-suite vitest
- Checkpoints every 3-4 tasks for `pnpm vitest run`
- Optional-but-skippable tasks marked with `*` (truly-nice-to-haves only)
- ElevenLabs SDK install MUST land in the scaffold task: add `@elevenlabs/elevenlabs-js` dep; env var `ELEVENLABS_API_KEY` is already present
- Do NOT modify `src/hooks/useAudioPlayer.ts` (hook stays `{ play, isPlaying, onEnded }` per orchestrator lock)
- Do NOT write to `/public/sfx/music/` (Vercel prod filesystem read-only outside build — use the KV-backed `/api/music/track/[hash]` route instead)

Do NOT write implementation code. Do NOT modify design.md. If design.md seems wrong or contradictory, flag at bottom of requirements.md under `## Design questions for Claude Code`.

Output both files in `.kiro/specs/tension-music-system/`.
```

---

## 13. Architecture consistency note

This spec:
- Does NOT add any new game types (leans entirely on existing `MusicTrack` stub).
- Does NOT modify the FSM reducer, event union, or any existing file.
- Does NOT change the server-authoritative invariant from `ui-gameplay` spec — the client hook is pure presentation + Web Audio state.
- Adds one new API route (`/api/music/pregen`) matching the thin-route pattern: validate → build prompts → delegate to SDK → respond.
- Keeps all browser-specific concerns (AudioContext, GainNode, autoplay policy, iOS suspension) inside `useMusicBed.ts` — the rest of the codebase is unaware of them.
- Graceful degradation is a first-class path, not an afterthought — verified by I5.

The architecture invariant from `ui-gameplay` §12 remains:

```
presentation (components + hooks)    ← useMusicBed lives here
       ↓ dispatch via fetch
    API routes                       ← /api/music/pregen lives here
       ↓ function call
 game-engine FSM + ai-opponent brain ← UNCHANGED by this spec
       ↓ consumes
   deck-and-claims + voice-tell-taxonomy + MUSIC (NEW)
```

If implementation introduces `useMusicBed` importing from `/api/**`, or a component bypassing the hook to call Web Audio directly, flag it — those are layer violations.
