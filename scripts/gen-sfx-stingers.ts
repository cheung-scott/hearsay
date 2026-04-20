/**
 * gen-sfx-stingers.ts
 *
 * Pre-generates short SFX stingers via the ElevenLabs Sound Effects API
 * (client.textToSoundEffects.convert). Two clips:
 *
 *   1. public/sfx/silent-beat.mp3  — §1.5 pre-reveal hush / inhale (~1.0s)
 *   2. public/sfx/gavel.mp3        — verdict gavel strike (~0.8s)
 *
 * Usage:
 *   pnpm tsx scripts/gen-sfx-stingers.ts               # regen both
 *   pnpm tsx scripts/gen-sfx-stingers.ts --only=1      # silent-beat only
 *   pnpm tsx scripts/gen-sfx-stingers.ts --only=2      # gavel only
 *   pnpm tsx scripts/gen-sfx-stingers.ts --only=1,2    # both (explicit)
 *
 * Requires ELEVENLABS_API_KEY in .env.local (or already in process.env).
 *
 * Credit note: ElevenLabs Sound FX is billed at ~50 credits/second (≈1x TTS),
 * so ~50 for silent-beat (1.0s) + ~40 for gavel (0.8s) ≈ 90 credits total.
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Env loading — mirrors gen-tutorial-mp3s.ts. Node 21+ native process.loadEnvFile
// with manual-parse fallback. No dotenv runtime dep required.
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
// Stinger definitions — locked 2026-04-20.
// Index order matters: --only=1 = silent-beat, --only=2 = gavel.
// ---------------------------------------------------------------------------
interface StingerSpec {
  filename:        string;
  prompt:          string;
  durationSeconds: number;
  promptInfluence: number;
  description:     string;
}

const STINGERS: StingerSpec[] = [
  {
    filename:        'silent-beat.mp3',
    prompt:          'Courtroom audience sudden hush, breath inhale, anticipation, ~1 second',
    durationSeconds: 1.0,
    // Slightly higher than default (0.3) — we want it recognisably a hush,
    // not a creative reinterpretation.
    promptInfluence: 0.55,
    description:     '§1.5 pre-reveal hush / inhale',
  },
  {
    filename:        'gavel.mp3',
    prompt:          'Judge gavel single strike, wooden, decisive, verdict',
    durationSeconds: 0.8,
    // Higher influence — a gavel is a very specific sound and we don't want
    // the model improvising a "decisive verdict ambience".
    promptInfluence: 0.70,
    description:     'verdict gavel strike',
  },
];

// ElevenLabs Sound FX credit rate: ~50 credits/second (same ballpark as Flash TTS).
// This is an estimate for logging only — the true cost is billed by the API.
const SFX_CREDITS_PER_SECOND = 50;

// ---------------------------------------------------------------------------
// Stream → Uint8Array helper (same pattern as gen-tutorial-mp3s.ts)
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
// --only=N[,N] parsing. Index 1 = silent-beat, 2 = gavel.
// ---------------------------------------------------------------------------
function parseOnly(): Set<number> | null {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  const raw = arg.slice('--only='.length);
  const steps = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n >= 1 && n <= STINGERS.length);
  if (steps.length === 0) {
    console.error(
      `ERROR: --only=${raw} parsed to no valid steps (expected 1..${STINGERS.length}, comma-separated)`,
    );
    process.exit(1);
  }
  return new Set(steps);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'public', 'sfx');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[init] Output dir: ${outDir}`);

  const only = parseOnly();
  const targetIndices = STINGERS
    .map((_, i) => i + 1)
    .filter((n) => !only || only.has(n));

  const targetSeconds = targetIndices.reduce(
    (sum, n) => sum + STINGERS[n - 1].durationSeconds,
    0,
  );
  const targetEstCredits = Math.ceil(targetSeconds * SFX_CREDITS_PER_SECOND);
  console.log(
    only
      ? `[plan] regenerating stingers ${targetIndices.join(', ')} (${targetSeconds.toFixed(1)}s total, ~${targetEstCredits} credits)`
      : `[plan] ${STINGERS.length} stingers, ${targetSeconds.toFixed(1)}s total, ~${targetEstCredits} estimated credits (Sound FX API)`,
  );
  console.log('');

  const client = new ElevenLabsClient({ apiKey });

  const fileSizes: number[] = [];
  let creditsConsumed = 0;
  const startTime = Date.now();

  for (let i = 0; i < STINGERS.length; i++) {
    const stepNum = i + 1;
    if (only && !only.has(stepNum)) continue;
    const spec = STINGERS[i];
    const creditsEst = Math.ceil(spec.durationSeconds * SFX_CREDITS_PER_SECOND);
    const outPath = path.join(outDir, spec.filename);

    console.log(
      `[sfx-${stepNum}] generating ${spec.filename} (${spec.durationSeconds}s, ~${creditsEst} credits) — ${spec.description}`,
    );
    console.log(`          prompt: "${spec.prompt}"`);

    const audioStream = await client.textToSoundEffects.convert({
      text:            spec.prompt,
      durationSeconds: spec.durationSeconds,
      promptInfluence: spec.promptInfluence,
      outputFormat:    'mp3_44100_128',
    });

    const audioData = await streamToUint8Array(audioStream);
    fs.writeFileSync(outPath, audioData);

    fileSizes.push(audioData.length);
    creditsConsumed += creditsEst;
    console.log(`[sfx-${stepNum}] wrote ${audioData.length} bytes -> ${outPath}`);
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalBytes = fileSizes.reduce((sum, s) => sum + s, 0);

  console.log('='.repeat(60));
  console.log(`[done] Stingers generated in ${elapsed}s`);
  console.log(`[done] Total bytes: ${totalBytes.toLocaleString()}`);
  console.log(
    `[done] Estimated credits consumed: ~${creditsConsumed} (Sound FX, ~${SFX_CREDITS_PER_SECOND} credits/sec)`,
  );
  console.log('');
  let idx = 0;
  for (let i = 0; i < STINGERS.length; i++) {
    const stepNum = i + 1;
    if (only && !only.has(stepNum)) continue;
    console.log(`       ${STINGERS[i].filename}: ${fileSizes[idx].toLocaleString()} bytes`);
    idx++;
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
