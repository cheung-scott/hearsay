/**
 * pre-gen-tuning-clips.ts
 *
 * Pre-generates 32 A/B tuning clips for Day-2 voice-preset tuning:
 *   4 personas × 2 truth-states × 4 claim strings = 32 clips
 *
 * Output: public/sfx/presets/{persona-lowercased}-{truthState}-{claim-slug}.mp3
 *
 * Uses eleven_flash_v2_5 — the same model as gameplay runtime.
 * Voice settings come directly from VOICE_PRESETS in src/lib/voice/presets.ts.
 *
 * Usage:
 *   pnpm pre-gen:tuning                          # skip already-existing files
 *   pnpm pre-gen:tuning -- --force               # regenerate all 32
 *   pnpm pre-gen:tuning -- --force --persona Reader  # regenerate only Reader's 8 clips
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
// CLI flags
// ---------------------------------------------------------------------------
const force = process.argv.includes('--force');

const personaFlagIdx = process.argv.indexOf('--persona');
const personaFilter: string | null = personaFlagIdx !== -1
  ? (process.argv[personaFlagIdx + 1] ?? null)
  : null;

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
// Types — inlined to avoid importing Next.js app code into this Node script
// ---------------------------------------------------------------------------
type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
type TruthState = 'honest' | 'lying';

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
}

// ---------------------------------------------------------------------------
// Voice presets — mirrored from src/lib/voice/presets.ts (source of truth).
// Update this block whenever presets.ts changes.
// ---------------------------------------------------------------------------
const VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>> = {
  Novice: {
    honest: { stability: 0.85, similarity_boost: 0.85, style: 0.20, speed: 1.00 },
    lying:  { stability: 0.20, similarity_boost: 0.75, style: 0.60, speed: 0.92 }, // obvious
  },
  Reader: {
    honest: { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
    lying:  { stability: 0.45, similarity_boost: 0.80, style: 0.50, speed: 0.96 }, // subtle
  },
  Misdirector: {
    // DO NOT reorder — inversion is intentional.
    // honest = acoustically NERVOUS (low stability / high style)
    // lying  = acoustically CALM    (high stability / low style)
    honest: { stability: 0.40, similarity_boost: 0.80, style: 0.55, speed: 0.95 },
    lying:  { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
  },
  Silent: {
    honest: { stability: 0.75, similarity_boost: 0.85, style: 0.30, speed: 1.00 },
    lying:  { stability: 0.55, similarity_boost: 0.82, style: 0.45, speed: 0.97 }, // thin tell
  },
};

const PERSONA_VOICE_IDS: Record<Persona, string> = {
  Novice:      '21m00Tcm4TlvDq8ikWAM',  // Rachel
  Reader:      'JBFqnCBsd6RMkjVDRZzb',  // George
  Misdirector: 'VR6AewLTigWG4xSOukaG',  // Arnold
  Silent:      'pNInz6obpgDQGcFmaJgB',  // Adam
};

// ---------------------------------------------------------------------------
// Claim strings — 4 representative gameplay phrases.
// Covers all 4 ranks + both 1/2 counts + one "Just" filler variation.
// ---------------------------------------------------------------------------
const CLAIM_STRINGS: Array<{ text: string; slug: string }> = [
  { text: 'One queen.',    slug: 'one-queen'    },
  { text: 'Two kings.',    slug: 'two-kings'    },
  { text: 'Just one ace.', slug: 'just-one-ace' },
  { text: 'Two jacks.',    slug: 'two-jacks'    },
];

const PERSONAS: Persona[]    = ['Novice', 'Reader', 'Misdirector', 'Silent'];
const TRUTH_STATES: TruthState[] = ['honest', 'lying'];

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/sfx/presets');
const LISTENING_MD_PATH = path.join(OUTPUT_DIR, 'LISTENING.md');

// Flash v2.5 credit rate: ~0.5 credits per character
const FLASH_CREDITS_PER_CHAR = 0.5;

function estimateCredits(text: string): number {
  return Math.ceil(text.length * FLASH_CREDITS_PER_CHAR);
}

// ---------------------------------------------------------------------------
// Stream → Uint8Array helper (same pattern as pre-gen-elimination-beat.ts)
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
// LISTENING.md generator
// Always regenerates — it's cheap text, no API cost.
// ---------------------------------------------------------------------------
function writeListeningMarkdown(): void {
  // For each persona, pair honest + lying per claim
  function personaTable(persona: Persona): string {
    const claims = CLAIM_STRINGS.map(c => c.slug);
    const isMisdirector = persona === 'Misdirector';
    const honestHeader = isMisdirector ? 'Honest (should sound NERVOUS)' : 'Honest';
    const lyingHeader  = isMisdirector ? 'Lying (should sound CALM)'     : 'Lying';
    const auditHeader  = isMisdirector ? 'Inversion correct? (Y/N)'      : 'Tell audible? (Y/N/Subtle)';

    const rows = claims.map(slug => {
      const claimLabel = CLAIM_STRINGS.find(c => c.slug === slug)!.text.replace(/\.$/, '');
      const honestFile = `${persona.toLowerCase()}-honest-${slug}.mp3`;
      const lyingFile  = `${persona.toLowerCase()}-lying-${slug}.mp3`;
      return `| ${claimLabel} | [honest](./${honestFile}) | [lying](./${lyingFile}) | | |`;
    });

    return [
      `| Claim | ${honestHeader} | ${lyingHeader} | ${auditHeader} | Notes |`,
      `|---|---|---|---|---|`,
      ...rows,
    ].join('\n');
  }

  const md = `# Day-2 Tuning Block — A/B Listening Reference

Use this file during the voice-preset tuning block to evaluate whether each persona's
honest/lying voice tells are audibly distinguishable at the right distinctiveness level.

**How to use:**
1. Open this folder in your file browser (or a media player that can browse directories)
2. For each persona section below, listen to the honest and lying clips side-by-side using headphones
3. Fill in the "Tell audible?" column: **Y** (clearly audible), **Subtle** (present but requires attention), **N** (indistinguishable)
4. See the tuning protocol at the bottom of this file if any persona needs adjustment

---

## Novice

**Target:** Lying should be OBVIOUS — demo-safe, immediately readable even on first listen.
No subtlety required. If a first-time player can't hear the tell, the preset is wrong.
Invariant: \`stability <= 0.25\` AND \`style >= 0.55\` on lying preset.

${personaTable('Novice')}

---

## Reader

**Target:** Tell should be SUBTLE but RELIABLE — present on every claim, but requires
attention to catch. A good player can read it; a casual player might miss it.

${personaTable('Reader')}

---

## Misdirector

**Target:** INVERSION — honest sounds nervous, lying sounds calm. The OPPOSITE of Reader.
This persona punishes players who learned "shaky = lying" from Reader.

> **⚠️ Misdirector inversion check**
>
> Misdirector's HONEST clip should sound NERVOUS. Misdirector's LYING clip should sound CALM.
> If it sounds backwards (honest calm, lying nervous), the preset was accidentally normalised —
> re-read \`voice-preset-conventions.md\` LOCKED invariant 2 and check \`presets.ts\`.
> The invariant test (\`pnpm test\`) enforces: \`Misdirector.honest.stability < Misdirector.lying.stability\`.

${personaTable('Misdirector')}

---

## Silent

**Target:** Tells near-IMPERCEPTIBLE — expert-challenge persona. Even an attentive player
should struggle to reliably distinguish honest from lying. The delta should be present
(not literally identical) but very small.
Invariant: \`|honest.stability − lying.stability| < 0.25\`.

${personaTable('Silent')}

---

## Tuning Protocol

1. Listen to each pair with headphones
2. Mark "Tell audible?" in the table above
3. If a persona's tells need adjustment, edit \`src/lib/voice/presets.ts\`:
   - Adjust \`stability\` first: ±0.1 (most impactful for shaky/nervous quality)
   - Then \`style\`: ±0.1 (emotional expressiveness)
   - Then \`speed\`: ±0.04 (pacing changes are subtle but compound with the above)
4. Run \`pnpm test\` to verify the Misdirector inversion invariant and Novice audibility invariant still hold
5. Re-run for one persona at a time:
   \`\`\`
   pnpm pre-gen:tuning -- --force --persona <NAME>
   \`\`\`
6. Re-listen to the regenerated 8 clips and repeat until satisfied
`;

  fs.writeFileSync(LISTENING_MD_PATH, md);
  console.log(`[done] LISTENING.md written → ${LISTENING_MD_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  // Validate --persona flag if provided
  if (personaFilter !== null) {
    if (!PERSONAS.includes(personaFilter as Persona)) {
      console.error(`ERROR: --persona "${personaFilter}" is not valid. Must be one of: ${PERSONAS.join(', ')}`);
      process.exit(1);
    }
    console.log(`[init] Filtering to persona: ${personaFilter}`);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`[init] Output dir: ${OUTPUT_DIR}`);

  const client = new ElevenLabsClient({ apiKey });

  // Build the full list of 32 work items (or 8 if --persona is set)
  type WorkItem = {
    persona: Persona;
    truthState: TruthState;
    claim: { text: string; slug: string };
    outPath: string;
    voiceId: string;
    preset: VoiceSettings;
    creditsEst: number;
  };

  const workItems: WorkItem[] = [];

  for (const persona of PERSONAS) {
    if (personaFilter && persona !== personaFilter) continue;
    for (const truthState of TRUTH_STATES) {
      for (const claim of CLAIM_STRINGS) {
        const filename = `${persona.toLowerCase()}-${truthState}-${claim.slug}.mp3`;
        workItems.push({
          persona,
          truthState,
          claim,
          outPath: path.join(OUTPUT_DIR, filename),
          voiceId: PERSONA_VOICE_IDS[persona],
          preset:  VOICE_PRESETS[persona][truthState],
          creditsEst: estimateCredits(claim.text),
        });
      }
    }
  }

  // Credit estimation summary before starting
  const totalEstimated = workItems.reduce((sum, w) => sum + w.creditsEst, 0);
  const toGenerate = workItems.filter(w => force || !fs.existsSync(w.outPath));
  const estimatedThisRun = toGenerate.reduce((sum, w) => sum + w.creditsEst, 0);

  console.log(`[plan] ${workItems.length} clips total, ${toGenerate.length} to generate`);
  console.log(`[plan] Estimated credits this run: ~${estimatedThisRun} (full set would be ~${totalEstimated})`);
  console.log(`[plan] Rate: ~${FLASH_CREDITS_PER_CHAR} credits/char (Flash v2.5)`);
  console.log('');

  let anyFailed = false;
  let creditsConsumed = 0;
  const startTime = Date.now();

  // Generate all clips — sequential to avoid hitting rate limits
  for (const item of workItems) {
    const label = `${item.persona} / ${item.truthState} / "${item.claim.text}"`;

    if (!force && fs.existsSync(item.outPath)) {
      const size = fs.statSync(item.outPath).size;
      console.log(`[skip] ${label} — ${path.basename(item.outPath)} exists (${size} bytes)`);
      continue;
    }

    console.log(`[tts]  ${label}`);
    console.log(`       voice: ${item.voiceId} | stability: ${item.preset.stability} | style: ${item.preset.style} | speed: ${item.preset.speed} | ~${item.creditsEst} credits`);

    try {
      const audioStream = await client.textToSpeech.convert(item.voiceId, {
        text: item.claim.text,
        modelId: 'eleven_flash_v2_5',
        outputFormat: 'mp3_44100_128',
        voiceSettings: {
          stability:       item.preset.stability,
          similarityBoost: item.preset.similarity_boost,   // snake_case → camelCase
          style:           item.preset.style,
          speed:           item.preset.speed,
          useSpeakerBoost: true,
        },
      });

      const audioData = await streamToUint8Array(audioStream);
      fs.writeFileSync(item.outPath, audioData);

      console.log(`[ok]   ${path.basename(item.outPath)} (${audioData.length} bytes)`);
      creditsConsumed += item.creditsEst;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[fail] ${label}: ${message}`);
      anyFailed = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`[done] Elapsed: ${elapsed}s`);
  console.log(`[done] Credits consumed this run: ~${creditsConsumed}`);
  console.log(`[done] (Flash v2.5 rate: ~${FLASH_CREDITS_PER_CHAR} credits/char)`);

  // Verify all expected output files exist
  const allExpected = workItems.every(w => fs.existsSync(w.outPath));
  if (allExpected) {
    console.log(`[done] All ${workItems.length} expected files are present in ${OUTPUT_DIR}`);
  } else {
    console.warn('[warn] Some expected files are missing — check failures above.');
  }

  // Always regenerate LISTENING.md — cheap text, no API cost.
  writeListeningMarkdown();

  if (anyFailed) {
    console.error('[warn] One or more clips failed — see errors above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
