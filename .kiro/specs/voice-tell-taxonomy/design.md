---
inclusion: fileMatch
fileMatchPattern: "src/lib/voice/presets.ts|src/lib/voice/heuristic.ts|src/lib/voice/**/*.ts"
---

# voice-tell-taxonomy — Design

The voice layer that makes Hearsay actually play: **how the AI's voice leaks truth-state** (TTS preset modulation) and **how the player's voice leaks lie-signal** (STT metadata heuristic).

**Scope of this spec:**
1. `VOICE_PRESETS` constant — 4 personas × 2 truth-states = 8 `VoiceSettings` objects
2. `computeLieScore` heuristic — turns raw STT metadata into a single 0..1 lie-score
3. The locked invariants that protect the gameplay feel (Misdirector inversion, Novice audibility, Silent subtlety, Reader ordering)
4. Voice-ID selection strategy per persona (ElevenLabs preset library vs Voice Generation API A/B)

**NOT in this spec** (handled elsewhere):
- Claim parsing regex (`CLAIM_REGEX` + `parseClaim`) — in `deck-and-claims` spec
- ElevenLabs SDK client wrapper (`tts.ts`, `stt.ts` module structure) — implementation detail of whoever imports presets; spec owns the *values + contract*, not the SDK surface
- AI judging logic that consumes `lieScore` — in `ai-opponent` spec
- Elimination-beat static clips (4 per-persona final-words + strike-3 stinger) — §1.5 presentation, lives in `voice-preset-conventions.md` steering + pre-gen scripts; not a spec
- Music API tracks — `tension-music-system` spec
- Tuning block process itself (A/B listening protocol) — operational, not spec'd

## Canonical sources

- Architecture §6.1 `VOICE_PRESETS` table + §6.2 STT heuristic formula in [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) — iter-5 locked
- Steering: [`.kiro/steering/voice-preset-conventions.md`](../../../steering/voice-preset-conventions.md) — preset grammar, tuning process, model selection, elimination-beat clips

---

## 1. Types

All voice types live in `src/lib/game/types.ts` (shared with game-engine spec — already stubbed when this spec lands). This spec adds or references:

```ts
type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
type TruthState = 'honest' | 'lying';

interface VoiceSettings {
  stability: number;        // [0, 1] — lower = more variance
  similarity_boost: number; // [0, 1] — voice-clone fidelity
  style: number;            // [0, 1] — emotional expressiveness
  speed: number;            // ~[0.9, 1.1] — playback rate
}

interface VoiceMeta {
  latencyMs: number;        // turn_start → first_non_silence_frame
  fillerCount: number;      // regex hits on um/uh/er/like/so/you know/kinda/i mean
  pauseCount: number;       // inter-word gaps > 400ms (excluding initial latency)
  speechRateWpm: number;
  lieScore: number;         // 0..1 derived — this spec owns the derivation
  parsed: { count: number; rank: Rank } | null;  // null = unparseable, set by deck-and-claims parser
}
```

## 2. VOICE_PRESETS (locked values)

Verbatim from architecture §6.1. The 4 personas × 2 truth-states table drives every AI TTS call. **Do not tune these without updating the invariant tests in §4** — they encode gameplay feel.

```ts
const VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>> = {
  Novice: {
    honest: { stability: 0.85, similarity_boost: 0.85, style: 0.20, speed: 1.00 },
    lying:  { stability: 0.20, similarity_boost: 0.75, style: 0.60, speed: 0.92 }, // OBVIOUS
  },
  Reader: {
    honest: { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
    lying:  { stability: 0.45, similarity_boost: 0.80, style: 0.50, speed: 0.96 }, // subtle
  },
  Misdirector: {
    // DO NOT reorder — inversion is intentional.
    // honest = acoustically nervous (low stability / high style)
    // lying  = acoustically calm  (high stability / low style)
    // Any preset "normalizer" that sorts by acoustic property BREAKS this persona.
    honest: { stability: 0.40, similarity_boost: 0.80, style: 0.55, speed: 0.95 },
    lying:  { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
  },
  Silent: {
    honest: { stability: 0.75, similarity_boost: 0.85, style: 0.30, speed: 1.00 },
    lying:  { stability: 0.55, similarity_boost: 0.82, style: 0.45, speed: 0.97 }, // thin tell
  },
};
```

### 2.1 Day-2 tuning sidecar

The locked values above are the *starting* values. Day-2 tuning block A/B-tests each `(persona, truthState)` and may nudge `stability` ±0.1, `style` ±0.1, `speed` ±0.04. Any change to `VOICE_PRESETS` after Day 2 **must re-run the invariant tests** (§4) and should include a short `// TUNED: <YYYY-MM-DD> <note>` comment above the affected entry.

## 3. STT heuristic — `computeLieScore`

Verbatim from architecture §6.2. Pure function, no I/O, no state, fully tested.

```ts
const FILLER_REGEX = /\b(uh|um|er|like|so|you know|kinda|i mean)\b/gi;

interface LieScoreInput {
  latencyMs: number;       // turn_start_event → first_non_silence_frame
  fillerCount: number;     // FILLER_REGEX.global matches in transcript
  pauseCount: number;      // inter-word gaps > 400ms, excluding initial latency
  speechRateWpm: number;   // wordCount / (audioSeconds / 60)
}

function computeLieScore(m: LieScoreInput): number {
  const lat = Math.min(m.latencyMs / 2000, 1);
  const fil = Math.min(m.fillerCount / 3, 1);
  const pau = Math.min(m.pauseCount / 3, 1);
  const rat = (m.speechRateWpm < 120 || m.speechRateWpm > 220) ? 1 : 0;
  return 0.40 * lat + 0.30 * fil + 0.20 * pau + 0.10 * rat;  // max 1.0
}
```

### 3.1 Weighting rationale

- **Latency (40%)** — biggest, most reliable signal. People planning a lie hesitate at turn start.
- **Fillers (30%)** — second-most reliable. "Um" is textbook deception-research indicator.
- **Pauses (20%)** — mid-sentence pauses also indicate cognitive load but noisier (breathing, thinking).
- **Rate (10%)** — binary threshold. Too-slow (<120 wpm) or too-fast (>220 wpm) = nervous; normal range = no signal.

All four signals independently range 0..1; weighted sum caps at 1.0. The AI's `ai-opponent` spec combines `lieScore` with `mathProbability` via `PERSONA_WEIGHTS` (in `ai-personas` spec, not here).

### 3.2 Fallback when Scribe metadata missing

If ElevenLabs Scribe doesn't return word timestamps (risk #2 in architecture §11), client-side `MediaRecorder` + Web Audio VAD must compute `latencyMs` + `pauseCount` + `speechRateWpm`. `fillerCount` is computed from the transcript text regardless. Implementation detail of `src/lib/voice/stt.ts` (NOT in this spec) — this spec just defines the input shape.

### 3.3 Neutral score on skip

If the player skips voice entirely (button-only claim), API route sets `voiceMeta.lieScore = 0.5` (neutral — AI decides on math alone). Reducer and AI-opponent spec both treat 0.5 as "no voice signal."

## 4. Invariants (Vitest — MANDATORY)

All tests live in `src/lib/voice/presets.test.ts` and `src/lib/voice/heuristic.test.ts`.

### `VOICE_PRESETS` invariants

1. **Shape completeness** — all 4 personas present, each with both `honest` and `lying` keys; all 4 `VoiceSettings` fields present on every object; every numeric value in valid range (stability/similarity_boost/style ∈ [0,1], speed ∈ [0.8, 1.2]).
2. **Misdirector inversion (LOCKED — never break):** `VOICE_PRESETS.Misdirector.honest.stability < VOICE_PRESETS.Misdirector.lying.stability`. Additionally: `Misdirector.honest.style > Misdirector.lying.style`. (The nervous-sounding read is the HONEST one.)
3. **Novice.lying is audibly obvious:** `Novice.lying.stability <= 0.25` AND `Novice.lying.style >= 0.55`. Starter persona — demo must be immediately readable.
4. **Silent has the smallest honest-vs-lying stability delta:** `|Silent.honest.stability − Silent.lying.stability| < 0.25`. Expert challenge — subtle tells only.
5. **Reader sits between Novice and Silent in honest-vs-lying stability delta:** `|Reader.honest.stability − Reader.lying.stability|` is greater than Silent's delta AND less than Novice's delta.
6. **Preset reference stability** — importing `VOICE_PRESETS` from two modules returns the same object (no accidental mutations).

### `computeLieScore` invariants

7. **Range:** output always in `[0, 1]`, inclusive. No NaN for any finite numeric input.
8. **Weighted sum:** when all four inputs are at their saturation thresholds (latencyMs >= 2000, fillerCount >= 3, pauseCount >= 3, speechRateWpm < 120 OR > 220), output === 1.0. When all four are below threshold (latencyMs 0, fillerCount 0, pauseCount 0, speechRateWpm 150), output === 0.0.
9. **Latency dominance:** given all else 0, `lat=1` (latencyMs=2000) returns 0.40. Proves weight allocation.
10. **Rate binary behavior:** rate in [120, 220] contributes 0; rate outside contributes exactly 0.1. No partial credit.
11. **Monotonicity:** increasing any single input (without crossing a clamp) never decreases the output.
12. **Filler regex correctness:** `FILLER_REGEX` matches 'um', 'uh', 'er', 'like', 'so', 'you know', 'kinda', 'i mean' (case-insensitive, word-boundary). Does NOT match sub-strings like 'umbrella', 'soft', 'likewise'.

### Neutral-score contract

13. **Skip-voice default:** API route layer sets `voiceMeta.lieScore = 0.5` when player skips voice. This is a *caller contract*, not enforced by `computeLieScore` (which only runs when voice is present). Test: `computeLieScore` is never called with all-zero input "by accident" in a skip-voice code path — verify via code review, not unit test.

## 5. Voice-ID selection (Day-2 operation)

Per `voice-preset-conventions.md` §"Voice ID selection (Day 2)":
- **Path A (baseline):** pick 1 voice ID per persona from the ElevenLabs preset library
- **Path B (stretch):** design each persona's voice via Voice Generation API from character briefs

A/B listen → keep whichever sounds closer to the persona brief → lock in `PERSONA_VOICE_IDS: Record<Persona, string>` in `src/lib/voice/presets.ts` (or `src/lib/ai/personas.ts` — sort this out during implementation).

This spec exports the CONSTANT shape; the *values* are filled during Day 2 tuning (tracked in `voice-preset-conventions.md`).

```ts
const PERSONA_VOICE_IDS: Record<Persona, string> = {
  Novice: 'TBD_DAY2_TUNING',
  Reader: 'JBFqnCBsd6RMkjVDRZzb',  // placeholder from /api/ping-voice
  Misdirector: 'TBD_DAY2_TUNING',
  Silent: 'TBD_DAY2_TUNING',
};
```

## 6. Out of scope

- ElevenLabs SDK client wrapping — implementation concern for `src/lib/voice/tts.ts` / `stt.ts`
- Claim parsing (CLAIM_REGEX, parseClaim) — `deck-and-claims` spec
- AI judging weights (PERSONA_WEIGHTS combining lieScore + mathProb) — `ai-personas` spec
- Music tracks — `tension-music-system` spec
- §1.5 elimination-beat static clips — conventions steering + pre-gen scripts

## 7. Dependencies

This spec depends on (but does NOT implement):

| Dep | Owner | What we need |
|---|---|---|
| `Persona`, `TruthState`, `Rank` types | `game-engine` spec / `src/lib/game/types.ts` | Shared across specs |
| ElevenLabs JS SDK | npm package `@elevenlabs/elevenlabs-js` | TTS client applies VOICE_PRESETS via `voiceSettings` override on Flash v2.5 |
| MediaRecorder + Web Audio VAD fallback | `src/lib/voice/stt.ts` (out of spec) | Produces `LieScoreInput` when Scribe word timestamps miss |
