/**
 * gen-tutorial-mp3s.ts
 *
 * Pre-generates 7 Clerk tutorial voice MP3s for the ClerkTutorial component.
 * Output: public/sfx/tutorial/step-{1..7}.mp3
 *
 * Voice: hearsay-clerk (British RP, 40s female, warm-bureaucratic, procedural)
 * Model: eleven_flash_v2_5
 * Settings: stability 0.72, similarityBoost 0.80, style 0.35, speed 0.95
 *
 * Usage:
 *   pnpm tsx scripts/gen-tutorial-mp3s.ts
 *   npx tsx scripts/gen-tutorial-mp3s.ts
 *
 * Requires ELEVENLABS_API_KEY in .env.local (or already in process.env).
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Env loading — Node 21+ native process.loadEnvFile with manual-parse fallback.
// No dotenv runtime dep required.
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  if (typeof (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile === 'function') {
    (process as NodeJS.Process & { loadEnvFile: (path: string) => void }).loadEnvFile(filePath);
    return;
  }

  // Fallback: manual parse
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
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
// Validate API key (never echo raw value)
// ---------------------------------------------------------------------------
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ERROR: ELEVENLABS_API_KEY is not set. Add it to .env.local');
  process.exit(1);
}
console.log(`[init] API key loaded (${apiKey.length} chars).`);

// ---------------------------------------------------------------------------
// Clerk voice ID — from src/lib/voice/presets.ts L71
// Hardcoded here to avoid importing Next.js app code into a Node script.
// If CLERK_VOICE_ID changes in presets.ts, update this constant too.
// ---------------------------------------------------------------------------
const CLERK_VOICE_ID = 'Al9pMcZxV70KAzzehiTE';  // hearsay-clerk

// ---------------------------------------------------------------------------
// The 7 Scott-locked tutorial lines (locked 2026-04-20).
// Index 0 = step 1, index 6 = step 7.
// ---------------------------------------------------------------------------
const TUTORIAL_LINES: string[] = [
  "Court is in session. Before your trial, let me brief you on the rules.",
  "The rank called each round is here.",
  "Select your cards here. Press and hold this button, then say the number of cards you're playing followed by the rank. You can be honest, or you can bluff — the defendant will listen to your voice and decide whether to believe you. You win the round by emptying your hand, or by catching him in three lies.",
  "If you're caught bluffing, you take a strike. Three strikes and you lose the round. Win best-of-three to advance to the next opponent.",
  "The defendant just made his claim. Listen for the tells. Do you believe him?",
  "Well played. Winning a round grants you a joker which holds a power — use it against your opponent to gain an advantage. Most expire after one turn.",
  "Court is now in recess. Good luck.",
];

// ---------------------------------------------------------------------------
// Voice settings — warm-bureaucratic, clerk-brief register.
// Locked from Day-3 voice-design brief.
// ---------------------------------------------------------------------------
const VOICE_SETTINGS = {
  stability:       0.72,
  similarityBoost: 0.80,
  style:           0.35,
  speed:           0.95,
} as const;

// Flash v2.5 credit rate: ~1 credit per character
const FLASH_CREDITS_PER_CHAR = 1;

// ---------------------------------------------------------------------------
// Stream → Uint8Array helper (same pattern as existing pregen scripts)
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
  const outDir = path.resolve(process.cwd(), 'public', 'sfx', 'tutorial');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[init] Output dir: ${outDir}`);

  const totalChars = TUTORIAL_LINES.reduce((sum, line) => sum + line.length, 0);
  const totalEstCredits = totalChars * FLASH_CREDITS_PER_CHAR;
  console.log(`[plan] 7 lines, ~${totalChars} total chars, ~${totalEstCredits} estimated credits (Flash v2.5)`);
  console.log(`[plan] Voice: ${CLERK_VOICE_ID} (hearsay-clerk)`);
  console.log('');

  const client = new ElevenLabsClient({ apiKey });

  const fileSizes: number[] = [];
  let creditsConsumed = 0;
  const startTime = Date.now();

  for (let i = 0; i < TUTORIAL_LINES.length; i++) {
    const stepNum = i + 1;
    const text = TUTORIAL_LINES[i];
    const creditsEst = text.length * FLASH_CREDITS_PER_CHAR;
    const outPath = path.join(outDir, `step-${stepNum}.mp3`);

    console.log(`[step-${stepNum}] generating (${text.length} chars, ~${creditsEst} credits)...`);
    console.log(`           "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);

    const audioStream = await client.textToSpeech.convert(CLERK_VOICE_ID, {
      text,
      modelId: 'eleven_flash_v2_5',
      outputFormat: 'mp3_44100_128',
      voiceSettings: VOICE_SETTINGS,
    });

    const audioData = await streamToUint8Array(audioStream);
    fs.writeFileSync(outPath, audioData);

    fileSizes.push(audioData.length);
    creditsConsumed += creditsEst;
    console.log(`[step-${stepNum}] wrote ${audioData.length} bytes -> ${outPath}`);
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalBytes = fileSizes.reduce((sum, s) => sum + s, 0);

  console.log('='.repeat(60));
  console.log(`[done] All 7 tutorial MP3s generated in ${elapsed}s`);
  console.log(`[done] Total bytes: ${totalBytes.toLocaleString()}`);
  console.log(`[done] Credits consumed: ~${creditsConsumed} (Flash v2.5, ${FLASH_CREDITS_PER_CHAR} credit/char)`);
  console.log('');
  fileSizes.forEach((size, i) => {
    console.log(`       step-${i + 1}.mp3: ${size.toLocaleString()} bytes`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
