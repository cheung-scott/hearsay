# Requirements Document

## Introduction

Live-gameplay tension music bed for Hearsay: three ElevenLabs Music API-generated tracks (calm / tense / critical) pre-generated at session setup, played via client-side Web Audio with `GainNode` ducking that lowers music volume during STT input and TTS playback. This is the third concurrent audio surface in the app (TTS + SFX + music). All requirements are derived from the authoritative `design.md`.

## Glossary

- **Tension level**: Enum value (`calm` | `tense` | `critical`) derived from FSM state; selects which pregen track plays
- **Music bed**: The continuously-looping background track; volume-modulated, never stopped during `round_active`
- **Pregen**: Generating all three tracks at session setup via `Promise.all`, storing MP3 buffers in KV and serving via API route
- **Ducking**: Temporary volume reduction via `GainNode.gain.linearRampToValueAtTime()`; input-duck (STT press) and output-duck (TTS play) share the same ramp primitives
- **Cross-fade**: Tension-level change: fade out old track over ~800ms while fading in new one; two `<audio>` + `GainNode` pairs, swap which is "primary"
- **AudioContext priming**: Browser autoplay policy requires first `AudioContext.resume()` inside a user-gesture handler; iOS Safari starts AudioContext in `suspended` state
- **Music-disabled path**: If pregen fails or any track URL is empty, client sets `musicDisabled = true` and gameplay proceeds silently
- **Ramp anchoring**: `cancelScheduledValues` + `setValueAtTime(gain.value, now)` + `linearRampToValueAtTime(target, now + DUCK_FADE_MS/1000)` — prevents stale scheduled values from causing audible jumps
- **KV**: Vercel KV (Redis-backed) blob storage for pregen MP3 buffers; keyed by `music:<sha256-of-prompt>`

## Requirements

### Requirement 1: Tension Level Taxonomy

**User Story:** As a game designer, I want exactly three tension levels mapped to gameplay stakes, so that the music bed escalates predictably with the session.

#### Acceptance Criteria

1.1 THE system SHALL define a `TensionLevel` type with exactly three values: `calm`, `tense`, and `critical`. *(design §4.1)*

1.2 THE system SHALL NOT add a fourth tension level (e.g. `death`); the three-level taxonomy is locked per product.md §1.5 pivot. *(design §4.1)*

### Requirement 2: FSM → TensionLevel Derivation

**User Story:** As the music hook, I want to derive the current tension level from session state without new server-side fields, so that tension tracking is pure and stateless.

#### Acceptance Criteria

2.1 WHEN `Session.status` is `session_over`, `deriveTensionLevel` SHALL return `critical`. *(design §4.2)*

2.2 WHEN `Session.status` is NOT `round_active` (e.g. `setup`, `joker_offer`), `deriveTensionLevel` SHALL return `calm`. *(design §4.2)*

2.3 WHEN `Session.status` is `round_active` AND `Math.max(player.strikes, ai.strikes) >= 2`, `deriveTensionLevel` SHALL return `critical`. *(design §4.2)*

2.4 WHEN `Session.status` is `round_active` AND max strikes is exactly 1, `deriveTensionLevel` SHALL return `tense`. *(design §4.2)*

2.5 WHEN `Session.status` is `round_active` AND max strikes is 0, `deriveTensionLevel` SHALL return `calm`. *(design §4.2)*

2.6 `deriveTensionLevel` SHALL be a pure function with no I/O, no `Date.now()`, and no new fields added to `Session`. *(design §4.3)*

### Requirement 3: Music Composition Prompts

**User Story:** As a developer, I want three named prompt constants for the Music API, so that track generation is reproducible and tunable.

#### Acceptance Criteria

3.1 THE system SHALL export `CALM_PROMPT`, `TENSE_PROMPT`, and `CRITICAL_PROMPT` string constants from `src/lib/music/prompts.ts`. *(design §7.1)*

3.2 EACH prompt SHALL be a non-empty string suitable for `client.music.compose({ prompt })`. *(design §5.3)*

### Requirement 4: Track URL Resolution

**User Story:** As the client hook, I want a helper that resolves a track URL from the tracks array by tension level, so that missing-track detection is centralized.

#### Acceptance Criteria

4.1 `getTrackUrl(tracks, level)` SHALL return the `url` string for the matching `MusicTrack` entry, or `null` if no entry matches or the URL is empty. *(design §7.1)*

4.2 WHEN `getTrackUrl` returns `null`, the caller SHALL treat this as the music-disabled path. *(design §8)*

### Requirement 5: KV Blob Storage

**User Story:** As the pregen route, I want to store and retrieve MP3 buffers by content-addressed hash, so that tracks survive Vercel's read-only runtime filesystem.

#### Acceptance Criteria

5.1 THE system SHALL store pregen MP3 buffers in KV keyed by `music:<sha256-hex-of-prompt>`. *(design §5.4)*

5.2 THE system SHALL NOT write MP3 files to `/public/sfx/music/` or any filesystem path — Vercel production filesystem is read-only outside build. *(design §5.1 step 4c, §5.4)*

5.3 THE KV helper SHALL export `putMusicBlob(hash, buffer)` and `getMusicBlob(hash)` functions. *(design §5.1, §5.4)*

### Requirement 6: Pregen Pipeline

**User Story:** As the session setup flow, I want to pre-generate three 60-second tension tracks concurrently, so that music is ready before the first round begins.

#### Acceptance Criteria

6.1 `POST /api/music/pregen` SHALL accept `{ sessionId: string }` and return `{ tracks: MusicTrack[]; generatedMs: number }` on success. *(design §5.1)*

6.2 THE route SHALL call `client.music.compose({ prompt, musicLengthMs: 60000 })` via the `@elevenlabs/elevenlabs-js` SDK, where `musicLengthMs` is in milliseconds (min 3000, max 600000). The SDK call SHALL NOT use `durationSeconds` or any other parameter name. *(design §5.3)*

6.3 THE route SHALL invoke all three `compose()` calls concurrently via `Promise.all`. *(design §5.1 step 3, tech.md)*

6.4 FOR EACH returned async iterable, the route SHALL collect `Uint8Array` chunks via `for await (const chunk of music)` and concatenate into a `Buffer`. The return type is an async iterable of `Uint8Array` chunks, NOT a `ReadableStream<Uint8Array>`. *(design §5.3)*

6.5 THE route SHALL compute SHA-256 of the prompt string, store the buffer in KV via `putMusicBlob`, and set the track URL to `/api/music/track/<hash>`. *(design §5.1 steps 4a-4d)*

6.6 THE route SHALL update `Session.musicTracks` with the three populated `MusicTrack` entries. *(design §5.1 step 6)*

6.7 WHEN any SDK call fails or times out (20s budget per track via `Promise.race`), the route SHALL return `MusicPregenError` with `tracks: []` — all-or-nothing, no partial tracks. *(design §5.1 timeout, §8)*

6.8 THE route SHALL be idempotent: re-calling with the same session and prompts SHALL cache-hit on hash-identical KV entries. *(design §5.1 idempotency)*

### Requirement 7: Track Serve Route

**User Story:** As the client `<audio>` element, I want to fetch pregen MP3 data by hash, so that tracks load without filesystem access.

#### Acceptance Criteria

7.1 `GET /api/music/track/[hash]` SHALL look up `music:<hash>` in KV and return the raw MP3 buffer with `Content-Type: audio/mpeg` and `Cache-Control: public, max-age=86400`. *(design §5.4)*

7.2 WHEN the hash is not found in KV, the route SHALL return 404 with `{ error: 'track-not-found' }`. *(design §5.4)*

### Requirement 8: Client Hook — `useMusicBed` Signature

**User Story:** As the `<GameSession>` component, I want a React hook that manages AudioContext, loop playback, cross-fade, and ducking, so that music integrates cleanly with existing hooks.

#### Acceptance Criteria

8.1 `useMusicBed({ tracks, currentTensionLevel, enabled })` SHALL return `{ prime, duckForInput, duckForOutput, restore, stop, isRunning }`. *(design §6.1)*

8.2 `prime()` SHALL be async, idempotent, and MUST `await audioContext.resume()` inside the user-gesture tick before any `.play()` call — iOS Safari starts AudioContext in `suspended` state. *(design §6.1, §2 AudioContext priming)*

8.3 WHEN `enabled` is `false`, ALL ducking API calls (`duckForInput`, `duckForOutput`, `restore`) SHALL be no-ops, and no `AudioContext` SHALL be created. *(design §8, invariant I5)*

### Requirement 9: Audio Element Wiring

**User Story:** As the music hook, I want `<audio>` elements connected through the Web Audio graph, so that `GainNode` ducking actually affects playback volume.

#### Acceptance Criteria

9.1 EACH `<audio>` element SHALL be wired via `ctx.createMediaElementSource(audioEl).connect(musicGain).connect(ctx.destination)`. *(design §6.4)*

9.2 BOTH primary and secondary `<audio>` elements SHALL be wired at `AudioContext` init. *(design §6.4)*

9.3 EACH `<audio>` element SHALL have `loop = true` for continuous playback. *(design §6.4)*

### Requirement 10: Ducking Ramp Behavior

**User Story:** As a player, I want music to smoothly lower during voice moments and restore afterward, so that speech is always intelligible.

#### Acceptance Criteria

10.1 `DUCK_FADE_MS` SHALL be `400` for both duck and restore ramps. This value is locked by steering product.md §1.5 and SHALL NOT be reduced to 150ms or any other value. *(design §6.2, steering §1.5 lock)*

10.2 `DUCK_GAIN` SHALL be `0.2` (20% of base volume). *(design §6.2)*

10.3 EVERY ramp SHALL be anchored: `gain.cancelScheduledValues(now)` → `gain.setValueAtTime(gain.value, now)` → `gain.linearRampToValueAtTime(target, now + DUCK_FADE_MS/1000)`. *(design §6.2)*

10.4 `duckForOutput` SHALL accept an optional `{ fadeMs?: number }` parameter for §1.5 elimination-beat override (default 400ms). *(design §6.2, §7.4)*

### Requirement 11: Concurrent Duck State

**User Story:** As the music hook, I want to handle overlapping STT and TTS duck requests without volume jitter, so that concurrent voice events don't cause audible glitches.

#### Acceptance Criteria

11.1 THE hook SHALL track an internal `DuckState` of `idle | ducked-for-input | ducked-for-output | ducked-for-both`. *(design §6.3)*

11.2 WHEN a second duck request arrives while already ducked, the hook SHALL transition to `ducked-for-both` WITHOUT re-ramping (already at `DUCK_GAIN`). *(design §6.3)*

11.3 WHEN one duck source releases while the other is still active, the hook SHALL remain at `DUCK_GAIN` (no restore ramp). *(design §6.3)*

### Requirement 12: Cross-Fade on Tension Change

**User Story:** As a player, I want the music to smoothly transition between tension levels, so that escalation feels cinematic rather than jarring.

#### Acceptance Criteria

12.1 WHEN `currentTensionLevel` changes, the hook SHALL set the secondary `<audio>` source to the new track URL, call `.play()`, and schedule dual ramps: primary gain → 0 and secondary gain → base volume, both over 800ms. *(design §6.2)*

12.2 AFTER 800ms, the hook SHALL pause the old primary and swap labels (secondary becomes primary). *(design §6.2)*

### Requirement 13: TTS onEnded Re-Registration

**User Story:** As the music hook consumer, I want TTS-end restore to work for every AI claim, not just the first one, so that music doesn't stay permanently ducked.

#### Acceptance Criteria

13.1 THE `<GameSession>` wiring SHALL re-register `audioPlayer.onEnded(() => music.restore())` on every `audioPlayer.isPlaying` false→true transition, using a `wasPlayingRef` pattern. *(design §6.5)*

13.2 THE system SHALL NOT modify `src/hooks/useAudioPlayer.ts` — the hook stays `{ play, isPlaying, onEnded }`. *(design §6.5, §7.3)*

### Requirement 14: iOS Safari Suspension Fallback

**User Story:** As a mobile player, I want music to resume after tab-backgrounding on iOS Safari, so that the experience doesn't silently break.

#### Acceptance Criteria

14.1 THE hook SHALL listen for `document.visibilitychange` and call `audioContext.resume()` when the page returns to foreground. *(design §8)*

14.2 WHEN `resume()` rejects (recent Safari rejects non-gesture resumes), the hook SHALL enqueue a `document.addEventListener('pointerdown', resumeOnce, { once: true })` fallback that calls `audioContext.resume()` on next user interaction. *(design §8)*

### Requirement 15: Graceful Degradation

**User Story:** As a player, I want the game to work perfectly without music if the Music API fails, so that a third-party service outage never blocks gameplay.

#### Acceptance Criteria

15.1 WHEN `POST /api/music/pregen` returns an error or `tracks: []`, the client SHALL set `musicState.disabled = true` on `ClientSession`. *(design §8)*

15.2 WHEN any track URL returns 404 at load time, the hook SHALL fall through to `enabled: false`. *(design §8)*

15.3 THE music-disabled path SHALL produce no `AudioContext`, no errors, and all ducking calls SHALL be no-ops. Gameplay proceeds silently. *(design §8, invariant I5)*

15.4 `ClientSession.musicState?: { disabled: boolean; userMuted: boolean }` is already pre-landed in `src/lib/game/types.ts` — tasks SHALL import this type, NOT re-declare it. *(pre-land commit 29f6a34)*

### Requirement 16: Autoplay Guard

**User Story:** As a developer, I want ducking calls before `prime()` to be safe no-ops, so that race conditions during startup don't crash the app.

#### Acceptance Criteria

16.1 WHEN `duckForInput()` or `duckForOutput()` is called before `prime()`, the hook SHALL not create an `AudioContext` and SHALL not throw. *(design §8, invariant I7)*

16.2 `isRunning` SHALL be `false` until `prime()` completes successfully. *(design §6.1)*

### Requirement 17: No FSM Modification

**User Story:** As the game engine owner, I want the music system to be a pure side-effect layer with zero FSM changes, so that removing music doesn't affect game logic.

#### Acceptance Criteria

17.1 THE music system SHALL NOT add any `GameEvent` variant to the FSM union. *(design §7.2)*

17.2 THE music system SHALL NOT add any field to `Session` beyond the already-stubbed `musicTracks`. *(design §4.3, §7.2)*

17.3 `deriveTensionLevel` SHALL be a caller-side derivation, NOT imported by the FSM. *(design §7.2)*

### Requirement 18: SDK Dependency

**User Story:** As a developer, I want the ElevenLabs JS SDK installed as a project dependency, so that the pregen route can call `client.music.compose()`.

#### Acceptance Criteria

18.1 THE project SHALL have `@elevenlabs/elevenlabs-js` as a dependency in `package.json`. *(design §3, §5.3)*

18.2 THE SDK client SHALL be instantiated with `process.env.ELEVENLABS_API_KEY` (server-side only, already present in `.env.local`). *(design §5.3, tech.md)*

## Invariant Cross-Reference

Every design.md §9 invariant maps to at least one numbered requirement:

| Invariant | Requirement(s) |
|---|---|
| I1 — Input ducking on hold-to-speak press | 10.1, 10.2, 10.3 |
| I2 — Restore on TTS onEnded | 10.1, 13.1 |
| I3 — Tension-level change triggers cross-fade | 12.1, 12.2 |
| I4 — Track URL presence after successful pregen | 6.5, 6.6 |
| I5 — Music-disabled path lets gameplay proceed | 8.3, 15.1, 15.2, 15.3 |
| I6 — Cross-fade timing matches config (800ms) | 12.1, 12.2 |
| I7 — Autoplay guard (duck before prime is no-op) | 16.1, 16.2 |
| I8 — `deriveTensionLevel` purity + mapping | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 |
| I9 — Pregen timeout fails cleanly | 6.7 |
| I10 — Concurrent duck-both state | 11.1, 11.2, 11.3 |

## Design questions for Scott

1. **Q8 — `useAudioPlayer.onEnded` persistent listener variant.** The current `onEnded(cb)` API is one-shot and self-clearing. Design §6.5 works around this by re-registering on the `audioPlayer.isPlaying` false→true transition via a `wasPlayingRef`. A cleaner long-term fix would be a persistent-listener variant (e.g. `addEventListener('ended', cb)`). Should this be a Day-5 follow-up to `useAudioPlayer.ts`, or is the `wasPlayingRef` workaround acceptable long-term?

2. **Q9 — `DUCK_FADE_MS` 400ms vs split ramp.** Design §6.2 sets `DUCK_FADE_MS = 400` for all ramps (restored from 150ms per steering §1.5 LOCK). If a shorter ramp (e.g. 150ms) was intentionally desired for STT/TTS ducking (faster response) while keeping 400ms for the elimination-beat silent-beat, this requires an explicit steering update to document the split. Is 400ms acceptable for all duck/restore ramps, or should we introduce `DUCK_FADE_MS_VOICE = 150` separately?

3. **Q1 — Music API concurrency limits.** `Promise.all` of 3 concurrent `compose()` calls — rate-limit headroom on Creator tier is undocumented. If the tier caps at 1 concurrent music call, we'd need to serialize (wall-time ~30s instead of ~10s). Resolve during Day 5 first spike.

4. **Q2 — Budget per session.** 3 × 60s = 180s of generated music per session. Credit cost per second is not listed in Context7 results. Should MVP cap at 30s/track instead of 60s to conserve credits?

5. **Q3 — Loop strategy polish.** Native `loop = true` may produce audible seams. If Day 5 listening test finds them jarring, should we add `loopPointMs` to `MusicTrack` and implement manual cross-fade at loop point?

6. **Q5 — `Session.currentTensionLevel` server-held field.** Currently derivation is pure + client-side. If future jokers need server-side tension control, add the field then?

7. **Q6 — `ClientSession.currentMusicUrl` activation.** Currently unused (design §4.3). Keep stubbed for future server-side switching?

8. **Q7 — Mute toggle UX.** Where does the user mute music? Top-bar icon? Keyboard shortcut (`M`)? `enabled: false` path already handles the wire-up — `ui-gameplay` phase 2 owns the control.