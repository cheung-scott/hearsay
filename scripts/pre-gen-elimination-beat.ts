/**
 * pre-gen-elimination-beat.ts
 *
 * Pre-generates the §1.5 Elimination-Beat static audio assets:
 *   - 4 per-persona "final words" TTS clips  → public/sfx/final-words/{persona}.mp3
 *   - 1 strike-3 stinger sound effect         → public/sfx/stinger.mp3
 *
 * Uses eleven_v3 for TTS (supports emotional tags like [gasps], [whispers], etc.)
 * Uses eleven_text_to_sound_v2 for sound effects.
 *
 * Usage:
 *   pnpm pre-gen:elim-beat           # skip already-existing files
 *   pnpm pre-gen:elim-beat -- --force # regenerate all
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Env loading — use Node 21+ native process.loadEnvFile if available,
// otherwise fall back to manual parse. Either way, no dotenv runtime dep.
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  // Node 21+ native API
  if (typeof (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile === 'function') {
    (process as NodeJS.Process & { loadEnvFile: (path: string) => void }).loadEnvFile(filePath);
    return;
  }

  // Fallback: manual parse (no dotenv dep)
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const force = process.argv.includes('--force');

// ---------------------------------------------------------------------------
// Validate API key (never echo raw value)
// ---------------------------------------------------------------------------
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ERROR: ELEVENLABS_API_KEY is not set. Add it to .env.local');
  process.exit(1);
}
console.log(`[init] API key loaded (${apiKey.length} chars).`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';

interface TtsClip {
  persona: Persona;
  voiceId: string;
  text: string;
  outPath: string;
}

// ---------------------------------------------------------------------------
// Constants — voice IDs mirrored from src/lib/voice/presets.ts
// (duplicated here to avoid importing Next.js app code into this Node script)
// ---------------------------------------------------------------------------
const PERSONA_VOICE_IDS: Record<Persona, string> = {
  Novice:      '21m00Tcm4TlvDq8ikWAM',  // Rachel
  Reader:      'JBFqnCBsd6RMkjVDRZzb',  // George
  Misdirector: 'VR6AewLTigWG4xSOukaG',  // Arnold
  Silent:      'pNInz6obpgDQGcFmaJgB',  // Adam
};

// Verbatim from voice-preset-conventions.md §"Elimination-beat static clips"
const FINAL_WORDS: Record<Persona, string> = {
  Novice:      '[gasps] No— no, wait—[breathing heavily]',
  Reader:      '[whispers] ...huh.',
  Misdirector: '[laughs darkly] ...well played. [sighs]',
  Silent:      '[long exhale]...',
};

const OUTPUT_DIR_TTS    = path.resolve(process.cwd(), 'public/sfx/final-words');
const OUTPUT_DIR_SFX    = path.resolve(process.cwd(), 'public/sfx');
const STINGER_PATH      = path.join(OUTPUT_DIR_SFX, 'stinger.mp3');
const STINGER_PROMPT    = 'heavy cell-door clang, metallic reverberant, single deep impact, no music, 1 second';

// Voice settings for elimination-beat clips (emotional range, non-gameplay)
// Per steering doc: stability 0.4, similarityBoost 0.85, style 0.65, useSpeakerBoost true
// speed: 0.95 — within spec §1.5 required range 0.92-0.98; SDK VoiceSettings.speed?: number confirmed.
const ELIM_VOICE_SETTINGS = {
  stability:       0.4,
  similarityBoost: 0.85,
  style:           0.65,
  speed:           0.95,  // spec §1.5 requires 0.92-0.98
  useSpeakerBoost: true,
} as const;

// ---------------------------------------------------------------------------
// Credit estimation helpers (rough ElevenLabs pricing)
// TTS v3: ~1 credit/char; Sound Effects v2: ~40 credits/sec
// ---------------------------------------------------------------------------
function estimateTtsCredits(text: string): number {
  return text.length; // 1 credit per character on v3
}

function estimateSfxCredits(durationSeconds: number): number {
  return Math.ceil(durationSeconds * 40);
}

// ---------------------------------------------------------------------------
// Stream → Buffer helper
// ---------------------------------------------------------------------------
async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  // Concatenate all chunks into a single Uint8Array
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Ensure output directories exist
  fs.mkdirSync(OUTPUT_DIR_TTS, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR_SFX, { recursive: true });
  console.log(`[init] Output dirs ready: ${OUTPUT_DIR_TTS}, ${OUTPUT_DIR_SFX}`);

  const client = new ElevenLabsClient({ apiKey });

  let anyFailed = false;
  let totalCreditsEstimate = 0;

  // -------------------------------------------------------------------------
  // Generate per-persona final-words TTS clips
  // -------------------------------------------------------------------------
  const personas: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];

  for (const persona of personas) {
    const outPath = path.join(OUTPUT_DIR_TTS, `${persona.toLowerCase()}.mp3`);
    const text    = FINAL_WORDS[persona];
    const voiceId = PERSONA_VOICE_IDS[persona];
    const creditsEst = estimateTtsCredits(text);

    if (!force && fs.existsSync(outPath)) {
      const size = fs.statSync(outPath).size;
      console.log(`[skip] ${persona} — ${outPath} already exists (${size} bytes). Use --force to regenerate.`);
      continue;
    }

    console.log(`[tts]  ${persona} → ${path.basename(outPath)}`);
    console.log(`       voice: ${voiceId} | text: "${text}" | ~${creditsEst} credits`);

    try {
      const audioStream = await client.textToSpeech.convert(voiceId, {
        text,
        modelId: 'eleven_v3',
        outputFormat: 'mp3_44100_128',
        voiceSettings: ELIM_VOICE_SETTINGS,
      });

      const audioData = await streamToUint8Array(audioStream);
      fs.writeFileSync(outPath, audioData);

      console.log(`[ok]   ${persona} → ${outPath} (${audioData.length} bytes)`);
      totalCreditsEstimate += creditsEst;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[fail] ${persona}: ${message}`);
      anyFailed = true;
    }
  }

  // -------------------------------------------------------------------------
  // Generate strike-3 stinger via Sound Effects API
  // -------------------------------------------------------------------------
  const sfxDurationEst = 1; // 1-second prompt
  const sfxCreditsEst  = estimateSfxCredits(sfxDurationEst);

  if (!force && fs.existsSync(STINGER_PATH)) {
    const size = fs.statSync(STINGER_PATH).size;
    console.log(`[skip] stinger — ${STINGER_PATH} already exists (${size} bytes). Use --force to regenerate.`);
  } else {
    console.log(`[sfx]  stinger → ${path.basename(STINGER_PATH)}`);
    console.log(`       prompt: "${STINGER_PROMPT}" | ~${sfxCreditsEst} credits (1s est.)`);

    try {
      const sfxStream = await client.textToSoundEffects.convert({
        text:    STINGER_PROMPT,
        modelId: 'eleven_text_to_sound_v2',
      });

      const sfxData = await streamToUint8Array(sfxStream);
      fs.writeFileSync(STINGER_PATH, sfxData);

      console.log(`[ok]   stinger → ${STINGER_PATH} (${sfxData.length} bytes)`);
      totalCreditsEstimate += sfxCreditsEst;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[fail] stinger: ${message}`);
      anyFailed = true;
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('');
  console.log(`[done] Estimated credits consumed this run: ~${totalCreditsEstimate}`);
  console.log('       (TTS v3: ~1 credit/char; Sound Effects v2: ~40 credits/sec)');

  if (anyFailed) {
    console.error('[warn] One or more files failed — see errors above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
