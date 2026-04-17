# Voice Design Previews — Day 2 Tuning

These are **preview voices** generated via the ElevenLabs Voice Design API.
They are NOT permanently saved voices — each has a temporary `generatedVoiceId`
that is valid for a limited time (typically 24–72 hours after generation).

**Generated:** 2026-04-17T19:55:56.755Z
**Model:** `eleven_ttv_v3`
**Sample text:** _See PREVIEWS.json for exact text used_

---

## How to pick your favourite

1. Open each persona's MP3 files in your audio player:
   - `novice-1.mp3`, `novice-2.mp3`, `novice-3.mp3`
   - `reader-1.mp3`, `reader-2.mp3`, `reader-3.mp3`
   - `misdirector-1.mp3`, `misdirector-2.mp3`, `misdirector-3.mp3`
   - `silent-1.mp3`, `silent-2.mp3`, `silent-3.mp3`
2. For each persona, note which index (1, 2, or 3) sounds closest to the character brief.
3. Look up that index's `generatedVoiceId` in `PREVIEWS.json` under
   `personas.<Persona>.previews[index-1].generatedVoiceId`.

---

## How to commit a chosen preview

Once you've picked the best preview per persona, run this to permanently
save it to your ElevenLabs account:

```ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

const voice = await client.textToVoice.create({
  voiceName: 'Hearsay — Novice',          // name it clearly
  voiceDescription: '<paste the brief>',
  generatedVoiceId: '<paste the generatedVoiceId from PREVIEWS.json>',
});

console.log('Permanent voice ID:', voice.voiceId);
```

**Do this for each persona where the designed voice beats the preset library voice.**
ElevenLabs will return a permanent `voiceId` — use that in the next step.

---

## How to update PERSONA_VOICE_IDS

After committing a preview to a permanent voice:

1. Open `src/lib/voice/presets.ts`
2. Find the `PERSONA_VOICE_IDS` map
3. Replace the old placeholder voice ID for that persona with the new permanent `voiceId`
4. Add a `// VOICE CASTING` comment noting the design brief and chosen ID

Then regenerate the elimination-beat clips (they use the voice IDs):

```bash
pnpm pre-gen:elim-beat -- --force
```

---

## Character briefs (for reference)

| Persona | Brief |
|---------|-------|
| Novice | Nervous young male voice, mid-20s, hesitant rhythm, slight upward inflection — sounds like someone trying their first-ever bluff |
| Reader | Calm confident alto, late 30s, measured cadence, slight smoker's rasp — sounds like they've played this game many times |
| Misdirector | Theatrical silky baritone, 40s, unpredictable pitch range, hint of a smile in every line — sounds like a stage magician |
| Silent | Sparse deep voice, mid-50s, long pauses between words, minimal affect — sounds like someone who speaks only when necessary |

---

## Credit cost

~1000 credits per persona × 4 personas = ~4000 credits (one-time)

After committing a preview to a permanent voice, that voice is reused at $0
per TTS call — you only pay the per-character TTS rate, not the design fee again.
