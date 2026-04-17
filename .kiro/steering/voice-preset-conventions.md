---
inclusion: fileMatch
fileMatchPattern: "src/lib/ai/personas.ts|src/lib/voice/tts.ts|src/lib/voice/**/*.ts"
---

# Hearsay — Voice Preset Conventions

Applies when editing TTS/voice-preset code. Codifies the preset grammar + locked invariants.

## Preset grammar

Every `(persona, truthState)` pair maps to a `VoiceSettings` object with EXACTLY these 4 keys:

```ts
interface VoiceSettings {
  stability: number;        // [0, 1] — lower = more variance in voice
  similarity_boost: number; // [0, 1] — voice-clone fidelity
  style: number;            // [0, 1] — emotional expressiveness
  speed: number;            // ~[0.9, 1.1] — playback rate
}

const VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>> = {
  Novice:      { honest: {...}, lying: {...} },
  Reader:      { honest: {...}, lying: {...} },
  Misdirector: { honest: {...}, lying: {...} },
  Silent:      { honest: {...}, lying: {...} },
};
```

## LOCKED INVARIANTS (required Vitest assertions)

### 1. Misdirector inversion — NEVER BREAK

```ts
expect(VOICE_PRESETS.Misdirector.honest.stability)
  .toBeLessThan(VOICE_PRESETS.Misdirector.lying.stability);
```

Misdirector fakes tells on honest claims (nervous-sounding, low stability / high style) and stays calm when lying (high stability / low style). **Any code that "normalizes" presets by acoustic property will silently break this persona.** The whole point of Misdirector is to punish players who learn Reader's "shaky = lying" mapping.

### 2. Novice.lying IS audibly obvious

```ts
expect(VOICE_PRESETS.Novice.lying.stability).toBeLessThanOrEqual(0.25);
expect(VOICE_PRESETS.Novice.lying.style).toBeGreaterThanOrEqual(0.55);
```

Starter persona — demo must be immediately readable.

### 3. Silent has the smallest honest-vs-lying delta

```ts
const delta = Math.abs(
  VOICE_PRESETS.Silent.honest.stability - VOICE_PRESETS.Silent.lying.stability
);
expect(delta).toBeLessThan(0.25);
```

Silent is the expert challenge — subtle tells only.

### 4. Reader sits between Novice and Silent in obviousness

Not a hard assertion, but maintain the ordering in tuning:  
**Novice (loudest tells) > Reader > Misdirector (inverted) > Silent (quietest tells).**

## Day 2 tuning process

1. Generate 4 test claim strings per `(persona, truthState)` = **32 clips total**
2. Save as `public/sfx/presets/{persona}-{truthState}-{claimSlug}.mp3`
3. A/B listen with headphones: **can you reliably hear the tell?**
4. If not: adjust `stability` first (±0.1), then `style` (±0.1), then `speed` (±0.04), regenerate
5. Repeat until all 4 personas have the desired differentiation
6. Commit final `VOICE_PRESETS` to `src/lib/ai/personas.ts`
7. Commit sample MP3s to `/public/sfx/presets/` as dev reference (not runtime)

## Model selection (strict)

- **Flash v2.5** — ALL live gameplay TTS. ~75ms latency, 32 langs.
- **Eleven v3** — ONLY the 4 pre-gen "final-words" clips for §1.5 elimination beat. Supports emotional tags (`[gasps]`, `[laughs]`, `[whispers]`, `[sighs]`, `[breathing heavily]`) that Flash v2.5 ignores.
- **NO runtime model switching.** Each clip's model is baked at build/pre-gen time.

## Elimination-beat static clips (§1.5)

4 per-persona "final words" — generated ONCE, never regenerated at runtime:

| Persona | Prompt | File |
|---|---|---|
| Novice | `[gasps] No— no, wait—[breathing heavily]` | `public/sfx/final-words/novice.mp3` |
| Reader | `[whispers] ...huh.` | `public/sfx/final-words/reader.mp3` |
| Misdirector | `[laughs darkly] ...well played. [sighs]` | `public/sfx/final-words/misdirector.mp3` |
| Silent | `[long exhale]...` | `public/sfx/final-words/silent.mp3` |

Voice settings for these (non-gameplay emotional range):
- stability: 0.3-0.5 (allow variance)
- similarity_boost: 0.85
- style: 0.55-0.75 (expressive)
- speed: 0.92-0.98 (slower, heavier)

**Content rule:** non-violent only. No self-harm language. No slurs. These play in front of judges.

## Voice ID selection (Day 2)

Two paths, tried in parallel:

**Path A — ElevenLabs preset library (baseline, always available):**
- Pick 1 voice ID per persona from the curated library
- Safe, quality-controlled, zero design risk

**Path B — ElevenLabs Voice Generation API (stretch, A/B vs Path A):**
- Design each persona's voice from a character description (~4 × 1-sentence prompts)
- Example prompts:
  - **Novice:** "Nervous young male voice, mid-20s, hesitant rhythm, slight upward inflection — sounds like someone trying their first-ever bluff"
  - **Reader:** "Calm confident alto, late 30s, measured cadence, slight smoker's rasp — sounds like they've played this game many times"
  - **Misdirector:** "Theatrical silky baritone, 40s, unpredictable pitch range, hint of a smile in every line — sounds like a stage magician"
  - **Silent:** "Sparse deep voice, mid-50s, long pauses between words, minimal affect — sounds like someone who speaks only when necessary"
- Generated voices saved to account, reusable at $0 per-call after one-time design credit spend
- ~1000 credits per voice design × 4 = ~4000 credits one-time

**A/B decision gate (~30 min):**
1. Generate 1 sample claim ("One Queen.") in both Path A and Path B for each persona
2. Listen back-to-back on headphones
3. Keep whichever sounds closer to the persona character brief
4. Lock the chosen voice ID per persona in `src/lib/ai/personas.ts` as `PERSONA_VOICE_IDS: Record<Persona, string>`
5. Document chosen voice (name OR design prompt + ID + characterization) in a `// VOICE CASTING` comment block at top of `personas.ts`

**Fallback rule:** If a designed voice sounds worse than any preset tested, take the preset. No attachment to "we designed it" if the audio is worse — better-sounding persona > more-creative-narrative.

**Not cloned:** PVC (Professional Voice Cloning) from user-supplied recordings is NOT used for MVP. Architecture §11 risk #1 keeps it as a fallback ONLY if per-request voice-settings override fails on Flash v2.5.

## Cache policy

- TTS cache key: SHA-256 of `(text + voiceId + JSON.stringify(voiceSettings) + modelId)`
- Cache location: `/tmp/tts-cache/{hash}.mp3` in dev; `/public/sfx/cache/{hash}.mp3` in build output (committed to repo for Vercel static serving)
- Check cache before every TTS call. Log cache-hit/miss count in dev mode for debugging.
