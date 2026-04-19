# Implementation Plan: Tension Music System

## Overview

ElevenLabs Music API-generated tension tracks with Web Audio `GainNode` ducking. Implementation follows dependency order: pure lib functions → KV storage helper → server routes → client hook → integration wiring. Tests-first where feasible. All files per design.md §10 file layout.

## Tasks

- [ ] 1. Scaffold dependencies and pure lib: `tension.ts` + `prompts.ts` + `tracks.ts`
  - [ ] 1.1 Install `@elevenlabs/elevenlabs-js` SDK dependency via `pnpm add @elevenlabs/elevenlabs-js`. Verify `ELEVENLABS_API_KEY` is already present in `.env.local` (do NOT create a new env var).
    _Requirements: 18.1, 18.2_

  - [ ] 1.2 Create `src/lib/music/tension.ts`: export `TensionLevel` type (`'calm' | 'tense' | 'critical'`) and `deriveTensionLevel(session): TensionLevel` pure function. Import `Session` from `src/lib/game/types.ts`. Logic per design §4.2: `session_over` → critical; not `round_active` → calm; `maxStrikes >= 2` → critical; `maxStrikes === 1` → tense; else calm. Export `DUCK_FADE_MS = 400` and `DUCK_GAIN = 0.2` constants.
    _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.1, 10.2_

  - [ ] 1.3 Create `src/lib/music/tension.test.ts`: test `deriveTensionLevel` against 6+ session fixtures per invariant I8: setup → calm, round_active 0 strikes → calm, round_active 1 strike → tense, round_active 2 strikes (either player) → critical, session_over → critical, joker_offer → calm. Test purity (same input → same output). Test `DUCK_FADE_MS === 400` and `DUCK_GAIN === 0.2`.
    _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.1, 10.2_

  - [ ] 1.4 Create `src/lib/music/prompts.ts`: export `CALM_PROMPT`, `TENSE_PROMPT`, `CRITICAL_PROMPT` string constants. Values are placeholder composition descriptions (tuned Day 5); shape is locked.
    _Requirements: 3.1, 3.2_

  - [ ] 1.5 Create `src/lib/music/tracks.ts`: export `getTrackUrl(tracks: MusicTrack[], level: TensionLevel): string | null`. Returns matching track's URL or null if missing/empty. Import `MusicTrack` from `src/lib/game/types.ts`, `TensionLevel` from `./tension`.
    _Requirements: 4.1, 4.2_

- [ ] 2. KV blob storage helper: `kvStore.ts`
  - [ ] 2.1 Create `src/lib/music/kvStore.ts`: export `putMusicBlob(hash: string, buffer: Buffer): Promise<void>` and `getMusicBlob(hash: string): Promise<Buffer | null>`. Use `@vercel/kv` (already a project dependency per ui-gameplay §4.4). Key schema: `music:<hash>`. Do NOT write to `/public/sfx/music/` or any filesystem path.
    _Requirements: 5.1, 5.2, 5.3_

- [ ] 3. Checkpoint — run `pnpm vitest run src/lib/music/`
  - Verify tension.test.ts passes. Fix any issues before proceeding.

- [ ] 4. Pregen API route: `POST /api/music/pregen`
  - [ ] 4.1 Create `src/app/api/music/pregen/route.ts`: validate sessionId via session store; build 3 prompts from `prompts.ts`; call `client.music.compose({ prompt, musicLengthMs: 60000 })` 3× via `Promise.all`, each wrapped in `Promise.race` with 20s timeout; collect `Uint8Array` chunks via `for await`; compute SHA-256 of prompt; store buffer via `putMusicBlob`; set URL to `/api/music/track/<hash>`; update `Session.musicTracks`; return `{ tracks, generatedMs }`. On failure return `MusicPregenError` with `tracks: []`.
    _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ] 4.2 Create `src/app/api/music/pregen/route.test.ts`: mock `@elevenlabs/elevenlabs-js` SDK. Test I4 (all 3 tension levels have non-empty URLs after success). Test I9 (SDK never resolves → 20s timeout → `MusicPregenError` with `tracks: []`, no crash). Test idempotency (same prompts → same hashes → cache hit).
    _Requirements: 6.1, 6.5, 6.6, 6.7, 6.8_

- [ ] 5. Track serve route: `GET /api/music/track/[hash]`
  - [ ] 5.1 Create `src/app/api/music/track/[hash]/route.ts`: look up `music:<hash>` in KV via `getMusicBlob`; on hit return raw buffer with `Content-Type: audio/mpeg` and `Cache-Control: public, max-age=86400`; on miss return 404 `{ error: 'track-not-found' }`.
    _Requirements: 7.1, 7.2_

- [ ] 6. Checkpoint — run `pnpm vitest run src/app/api/music/ src/lib/music/`
  - Verify all route tests and lib tests pass.

- [ ] 7. Client hook: `useMusicBed.ts`
  - [ ] 7.1 Create `src/hooks/useMusicBed.ts`: implement `useMusicBed({ tracks, currentTensionLevel, enabled }): UseMusicBedAPI`. Internal state: two `HTMLAudioElement` + `GainNode` pairs (primary/secondary), `DuckState` enum (`idle | ducked-for-input | ducked-for-output | ducked-for-both`). Key behaviors:
    - `prime()`: `await audioContext.resume()` inside user-gesture tick, then `primary.play()` + `primary.pause()`. Idempotent.
    - Wire `<audio>` elements via `ctx.createMediaElementSource(audioEl).connect(musicGain).connect(ctx.destination)` at init.
    - Both elements: `loop = true`.
    - `duckForInput()` / `duckForOutput(opts?)`: anchored ramp (`cancelScheduledValues` → `setValueAtTime(gain.value, now)` → `linearRampToValueAtTime(DUCK_GAIN, now + fadeMs/1000)`). Default `fadeMs = DUCK_FADE_MS` (400ms).
    - `restore()`: anchored ramp back to base volume over `DUCK_FADE_MS`.
    - Concurrent duck: `DuckState` transitions per design §6.3 — no re-ramp when already ducked.
    - Cross-fade on `currentTensionLevel` change: secondary.src = new URL, secondary.play(), dual ramps over 800ms, swap after timeout.
    - When `enabled === false`: no AudioContext created, all API calls are no-ops.
    - iOS Safari fallback: `visibilitychange` → `resume()`; if rejects, `pointerdown` once fallback.
    - `stop()`: pause both elements, close AudioContext.
    - `isRunning`: true only after successful `prime()`.
    - Do NOT modify `src/hooks/useAudioPlayer.ts`.
    _Requirements: 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 12.1, 12.2, 14.1, 14.2, 15.3, 16.1, 16.2_

  - [ ] 7.2 Create `src/hooks/useMusicBed.test.ts`: mock `AudioContext`, `GainNode`, `HTMLAudioElement`, `createMediaElementSource`. Tests:
    - **I1**: simulate `duckForInput()` → assert `linearRampToValueAtTime(0.2, ~now + 0.4)` called.
    - **I2**: simulate `duckForOutput()` then trigger `restore()` → assert ramp back to base volume with 400ms.
    - **I3**: change `currentTensionLevel` from `calm` to `tense` → assert both ramps fire (old → 0, new → base) over 800ms; no abrupt pause before ramp completes.
    - **I5**: set `enabled: false` → assert no AudioContext created, all duck/restore calls are no-ops, no errors.
    - **I6**: fake timers; fire tension change → assert swap happens at exactly 800ms.
    - **I7**: call `duckForInput()` before `prime()` → assert no AudioContext created, no errors.
    - **I10**: trigger `duckForOutput()` then `duckForInput()` before restore → gain stays at DUCK_GAIN (no re-ramp). Restore TTS: still ducked. Release STT: ramps to base.
    _Requirements: 8.3, 10.1, 10.2, 10.3, 11.1, 11.2, 11.3, 12.1, 12.2, 16.1, 16.2_

- [ ] 8. Checkpoint — run `pnpm vitest run src/hooks/useMusicBed.test.ts`
  - Verify all hook tests pass.

- [ ] 9. Integration wiring into `<GameSession>`
  - [ ] 9.1 Wire `useMusicBed` into `src/components/game/GameSession.tsx` (or equivalent game root component):
    - Import `deriveTensionLevel` from `src/lib/music/tension.ts`, `useMusicBed` from `src/hooks/useMusicBed.ts`.
    - Import `ClientSession.musicState` type from `src/lib/game/types.ts` (already pre-landed — do NOT re-declare).
    - Pass `{ tracks: session.musicTracks, currentTensionLevel: deriveTensionLevel(session), enabled: !musicState?.disabled && !musicState?.userMuted }`.
    - Wire input ducking: `useEffect` on `holdToSpeak.state` — `'recording'` → `music.duckForInput()`, `'stopped'` → `music.restore()`.
    - Wire output ducking: `useEffect` on `audioPlayer.isPlaying` — true → `music.duckForOutput()`.
    - Wire TTS-end restore via `wasPlayingRef` pattern: re-register `audioPlayer.onEnded(() => music.restore())` on every `isPlaying` false→true transition. Do NOT modify `useAudioPlayer.ts`.
    - Wire `prime()` into the BEGIN TRIAL / first user-gesture handler.
    - Fire `POST /api/music/pregen` after session creation, set `musicState.disabled = true` on failure.
    - No new `GameEvent` variants added to FSM.
    _Requirements: 8.1, 8.2, 13.1, 13.2, 15.1, 15.4, 17.1, 17.2, 17.3_

- [ ] 10. Graceful degradation integration test
  - [ ] 10.1 Add a test (in `src/hooks/useMusicBed.test.ts` or `GameSession.test.tsx`) that verifies the I5 path end-to-end: mock pregen to return `tracks: []`, render the game session, assert no AudioContext created, no errors thrown, all duck/restore calls are no-ops, gameplay proceeds normally.
    _Requirements: 15.1, 15.2, 15.3_

- [ ] 11. Checkpoint — run `pnpm vitest run`
  - Full test suite. Verify no regressions across game-engine, voice-tell-taxonomy, deck-and-claims, ui-gameplay, and tension-music-system tests.

- [ ]* 12. iOS Safari AudioContext suspension fallback test
  - [ ]* 12.1 Add a test in `src/hooks/useMusicBed.test.ts` that mocks `document.visibilitychange` event and verifies `audioContext.resume()` is called on foreground return. Mock `resume()` rejection and verify `pointerdown` once-listener fallback is registered.
    _Requirements: 14.1, 14.2_

- [ ]* 13. Cross-fade timing precision test
  - [ ]* 13.1 Add a test in `src/hooks/useMusicBed.test.ts` with fake timers that verifies the old primary is paused and labels are swapped at exactly 800ms after a tension-level change (I6). Verify no `.pause()` fires before the ramp completes.
    _Requirements: 12.1, 12.2_

- [ ] 14. Final checkpoint — run `pnpm vitest run`
  - Full test suite. All tests green. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 3, 6, 8, 11, and 14 ensure incremental validation
- Do NOT modify `src/hooks/useAudioPlayer.ts` (hook stays `{ play, isPlaying, onEnded }`)
- Do NOT write to `/public/sfx/music/` (Vercel prod filesystem read-only outside build)
- `ClientSession.musicState?` is already pre-landed in `src/lib/game/types.ts` — import, never re-declare
- All 10 design invariants (I1-I10) are covered:
  - I1 (Input ducking): Task 7.2
  - I2 (Restore on TTS onEnded): Task 7.2
  - I3 (Cross-fade on tension change): Task 7.2
  - I4 (Track URL presence after pregen): Task 4.2
  - I5 (Music-disabled path): Tasks 7.2, 10.1
  - I6 (Cross-fade timing 800ms): Tasks 7.2, 13.1*
  - I7 (Autoplay guard): Task 7.2
  - I8 (deriveTensionLevel purity + mapping): Task 1.3
  - I9 (Pregen timeout fails cleanly): Task 4.2
  - I10 (Concurrent duck-both state): Task 7.2