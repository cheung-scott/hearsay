/**
 * design-persona-voices.ts
 *
 * Calls the ElevenLabs Voice Design API to generate preview voices for
 * each of the 4 Hearsay personas. Saves MP3 previews + metadata to
 * public/sfx/voice-design-previews/ for listening/picking tomorrow.
 *
 * Does NOT commit previews to permanent voices — that's a manual follow-up
 * after Scott listens and picks his favourite per persona.
 *
 * Usage:
 *   pnpm design:voices                          # skip if PREVIEWS.json exists
 *   pnpm design:voices -- --force               # regenerate all
 *   pnpm design:voices -- --persona Reader      # regenerate single persona
 *
 * Credit cost: ~1000 credits per persona × 4 = ~4000 credits one-time
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Env loading — Node 21+ native process.loadEnvFile, manual parse fallback
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  if (typeof (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile === 'function') {
    (process as NodeJS.Process & { loadEnvFile: (path: string) => void }).loadEnvFile(filePath);
    return;
  }

  // Manual fallback (no dotenv dep)
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
const args = process.argv.slice(2);
const force = args.includes('--force');
const personaFlagIdx = args.indexOf('--persona');
const personaFilter: string | null =
  personaFlagIdx !== -1 && args[personaFlagIdx + 1]
    ? args[personaFlagIdx + 1]
    : null;

// ---------------------------------------------------------------------------
// Validate API key (never echo raw value — feedback_secret_checks)
// ---------------------------------------------------------------------------
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ERROR: ELEVENLABS_API_KEY is not set. Add it to .env.local');
  process.exit(1);
}
console.log(`[init] API key loaded (length: ${apiKey.length}, prefix: ${apiKey.slice(0, 4)}***)`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';

interface PreviewEntry {
  index: number;
  generatedVoiceId: string;
  file: string;
}

interface PersonaMetadata {
  brief: string;
  previews: PreviewEntry[];
}

interface PreviewsJson {
  generatedAt: string;
  model: string;
  sampleText: string;
  personas: Record<Persona, PersonaMetadata>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODEL_ID = 'eleven_ttv_v3' as const;

// API requires text between 100 and 1000 characters.
// We use a longer gameplay-relevant passage to exercise each persona's
// dynamic range — still card-game vocabulary, no meta commentary.
const SAMPLE_TEXT =
  "One queen. Two kings. Just a jack. Your call. " +
  "I've seen this hand before. You're either holding exactly what you say, " +
  "or you're bluffing harder than anyone at this table. " +
  "Either way, I'm watching. Make your move.";

// Verbatim from .kiro/steering/voice-preset-conventions.md §"Voice ID selection (Day 2)"
const PERSONA_DESIGN_BRIEFS: Record<Persona, string> = {
  Novice:
    "Nervous young male voice, mid-20s, hesitant rhythm, slight upward inflection — sounds like someone trying their first-ever bluff",
  Reader:
    "Calm confident alto, late 30s, measured cadence, slight smoker's rasp — sounds like they've played this game many times",
  Misdirector:
    "Theatrical silky baritone, 40s, unpredictable pitch range, hint of a smile in every line — sounds like a stage magician",
  Silent:
    "Sparse deep voice, mid-50s, long pauses between words, minimal affect — sounds like someone who speaks only when necessary",
};

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/sfx/voice-design-previews');
const PREVIEWS_JSON_PATH = path.join(OUTPUT_DIR, 'PREVIEWS.json');
const README_PATH = path.join(OUTPUT_DIR, 'README.md');

// ---------------------------------------------------------------------------
// Idempotency guard
// ---------------------------------------------------------------------------
if (!force && fs.existsSync(PREVIEWS_JSON_PATH)) {
  if (!personaFilter) {
    console.log(
      '[skip] PREVIEWS.json already exists. Run with --force to regenerate, or --persona <name> for a single persona.'
    );
    process.exit(0);
  }
  // With --persona, we'll merge into the existing file rather than aborting
}

// ---------------------------------------------------------------------------
// Ensure output directory
// ---------------------------------------------------------------------------
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
console.log(`[init] Output dir: ${OUTPUT_DIR}`);

// ---------------------------------------------------------------------------
// ElevenLabs client
// ---------------------------------------------------------------------------
const client = new ElevenLabsClient({ apiKey });

// ---------------------------------------------------------------------------
// Credit logging helper
// ---------------------------------------------------------------------------
async function getUserCredits(): Promise<number | null> {
  try {
    const sub = await client.user.subscription();
    // character_count / character_limit available; credits field varies by plan
    const remaining = (sub as Record<string, unknown>)['characterCount']
      ?? (sub as Record<string, unknown>)['character_count']
      ?? null;
    return typeof remaining === 'number' ? remaining : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const creditsBefore = await getUserCredits();
  if (creditsBefore !== null) {
    console.log(`[credits] Before run: ${creditsBefore} characters used`);
  } else {
    console.log('[credits] Could not fetch subscription info (informational only)');
  }

  // Load existing PREVIEWS.json if doing single-persona merge
  let existingData: PreviewsJson | null = null;
  if (personaFilter && fs.existsSync(PREVIEWS_JSON_PATH)) {
    try {
      existingData = JSON.parse(fs.readFileSync(PREVIEWS_JSON_PATH, 'utf8')) as PreviewsJson;
      console.log(`[merge] Loaded existing PREVIEWS.json for --persona merge`);
    } catch {
      console.warn('[merge] Could not parse existing PREVIEWS.json — will overwrite');
    }
  }

  const personasToRun = personaFilter
    ? PERSONAS.filter(p => p.toLowerCase() === personaFilter.toLowerCase())
    : PERSONAS;

  if (personasToRun.length === 0) {
    console.error(
      `ERROR: --persona "${personaFilter}" is not a valid persona. Valid: ${PERSONAS.join(', ')}`
    );
    process.exit(1);
  }

  const results: Partial<Record<Persona, PersonaMetadata>> = {};
  const failures: Persona[] = [];

  for (const persona of personasToRun) {
    console.log(`\n[design] ${persona} — calling textToVoice.design()...`);
    console.log(`  Brief: ${PERSONA_DESIGN_BRIEFS[persona]}`);

    try {
      const response = await client.textToVoice.design({
        voiceDescription: PERSONA_DESIGN_BRIEFS[persona],
        text: SAMPLE_TEXT,
        modelId: MODEL_ID,
      });

      const previews = response.previews;
      if (!previews || previews.length === 0) {
        console.warn(`[warn] ${persona}: previews array is empty — skipping`);
        failures.push(persona);
        continue;
      }

      console.log(`  Got ${previews.length} preview(s)`);

      const previewEntries: PreviewEntry[] = [];

      for (let i = 0; i < previews.length; i++) {
        const preview = previews[i];
        const index = i + 1; // 1-based
        const filename = `${persona.toLowerCase()}-${index}.mp3`;
        const outPath = path.join(OUTPUT_DIR, filename);

        // Decode base64 → Buffer → write MP3
        const audioBuffer = Buffer.from(preview.audioBase64, 'base64');
        fs.writeFileSync(outPath, audioBuffer);

        const sizeKB = (audioBuffer.byteLength / 1024).toFixed(1);
        console.log(`  [${index}] generatedVoiceId=${preview.generatedVoiceId} → ${filename} (${sizeKB} KB, ${preview.durationSecs?.toFixed(1) ?? '?'}s)`);

        // Sanity check — MP3 should be >5KB
        if (audioBuffer.byteLength < 5 * 1024) {
          console.warn(`  [warn] ${filename} is only ${sizeKB} KB — may be truncated`);
        }

        previewEntries.push({
          index,
          generatedVoiceId: preview.generatedVoiceId,
          file: filename,
        });
      }

      results[persona] = {
        brief: PERSONA_DESIGN_BRIEFS[persona],
        previews: previewEntries,
      };

      console.log(`  [ok] ${persona} done — ${previewEntries.length} previews saved`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${persona} failed: ${message}`);

      // Hint for Voice Design permission error
      if (message.includes('401') || message.includes('403') || message.includes('permission') || message.includes('forbidden')) {
        console.error(
          '  HINT: Voice Design may require "Voice Generation Access + Voices Read" permission.\n' +
          '  Re-scope the ElevenLabs API key in the dashboard: https://elevenlabs.io/app/settings/api-keys'
        );
      }

      failures.push(persona);
    }
  }

  // ---------------------------------------------------------------------------
  // Build final PREVIEWS.json
  // ---------------------------------------------------------------------------
  let finalData: PreviewsJson;

  if (existingData && personaFilter) {
    // Merge: update only the targeted persona
    finalData = { ...existingData };
    for (const [persona, meta] of Object.entries(results) as [Persona, PersonaMetadata][]) {
      finalData.personas[persona] = meta;
    }
    finalData.generatedAt = new Date().toISOString(); // refresh timestamp on any change
  } else {
    // Full run: build from scratch, using existing data for any personas we didn't re-run
    const allPersonasData: Record<string, PersonaMetadata> = {};
    for (const p of PERSONAS) {
      if (results[p]) {
        allPersonasData[p] = results[p]!;
      } else if (existingData?.personas[p]) {
        allPersonasData[p] = existingData.personas[p];
      }
    }

    finalData = {
      generatedAt: new Date().toISOString(),
      model: MODEL_ID,
      sampleText: SAMPLE_TEXT,
      personas: allPersonasData as Record<Persona, PersonaMetadata>,
    };
  }

  fs.writeFileSync(PREVIEWS_JSON_PATH, JSON.stringify(finalData, null, 2));
  console.log(`\n[done] PREVIEWS.json written`);

  // ---------------------------------------------------------------------------
  // Write README.md
  // ---------------------------------------------------------------------------
  const readmeContent = `# Voice Design Previews — Day 2 Tuning

These are **preview voices** generated via the ElevenLabs Voice Design API.
They are NOT permanently saved voices — each has a temporary \`generatedVoiceId\`
that is valid for a limited time (typically 24–72 hours after generation).

**Generated:** ${finalData.generatedAt}
**Model:** \`${MODEL_ID}\`
**Sample text:** _See PREVIEWS.json for exact text used_

---

## How to pick your favourite

1. Open each persona's MP3 files in your audio player:
   - \`novice-1.mp3\`, \`novice-2.mp3\`, \`novice-3.mp3\`
   - \`reader-1.mp3\`, \`reader-2.mp3\`, \`reader-3.mp3\`
   - \`misdirector-1.mp3\`, \`misdirector-2.mp3\`, \`misdirector-3.mp3\`
   - \`silent-1.mp3\`, \`silent-2.mp3\`, \`silent-3.mp3\`
2. For each persona, note which index (1, 2, or 3) sounds closest to the character brief.
3. Look up that index's \`generatedVoiceId\` in \`PREVIEWS.json\` under
   \`personas.<Persona>.previews[index-1].generatedVoiceId\`.

---

## How to commit a chosen preview

Once you've picked the best preview per persona, run this to permanently
save it to your ElevenLabs account:

\`\`\`ts
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

const voice = await client.textToVoice.create({
  voiceName: 'Hearsay — Novice',          // name it clearly
  voiceDescription: '<paste the brief>',
  generatedVoiceId: '<paste the generatedVoiceId from PREVIEWS.json>',
});

console.log('Permanent voice ID:', voice.voiceId);
\`\`\`

**Do this for each persona where the designed voice beats the preset library voice.**
ElevenLabs will return a permanent \`voiceId\` — use that in the next step.

---

## How to update PERSONA_VOICE_IDS

After committing a preview to a permanent voice:

1. Open \`src/lib/voice/presets.ts\`
2. Find the \`PERSONA_VOICE_IDS\` map
3. Replace the old placeholder voice ID for that persona with the new permanent \`voiceId\`
4. Add a \`// VOICE CASTING\` comment noting the design brief and chosen ID

Then regenerate the elimination-beat clips (they use the voice IDs):

\`\`\`bash
pnpm pre-gen:elim-beat -- --force
\`\`\`

---

## Character briefs (for reference)

| Persona | Brief |
|---------|-------|
| Novice | ${PERSONA_DESIGN_BRIEFS.Novice} |
| Reader | ${PERSONA_DESIGN_BRIEFS.Reader} |
| Misdirector | ${PERSONA_DESIGN_BRIEFS.Misdirector} |
| Silent | ${PERSONA_DESIGN_BRIEFS.Silent} |

---

## Credit cost

~1000 credits per persona × 4 personas = ~4000 credits (one-time)

After committing a preview to a permanent voice, that voice is reused at $0
per TTS call — you only pay the per-character TTS rate, not the design fee again.
`;

  fs.writeFileSync(README_PATH, readmeContent);
  console.log('[done] README.md written');

  // ---------------------------------------------------------------------------
  // Post-run credit logging
  // ---------------------------------------------------------------------------
  const creditsAfter = await getUserCredits();
  if (creditsAfter !== null && creditsBefore !== null) {
    console.log(`[credits] After run: ${creditsAfter} characters used (delta: +${creditsAfter - creditsBefore})`);
  } else if (creditsAfter !== null) {
    console.log(`[credits] After run: ${creditsAfter} characters used`);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=== SUMMARY ===');
  for (const p of personasToRun) {
    if (results[p]) {
      console.log(`  ${p}: ${results[p]!.previews.length} previews saved ✓`);
    } else {
      console.log(`  ${p}: FAILED ✗`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[exit 1] ${failures.length} persona(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  console.log('\n[done] All personas completed successfully.');
  console.log(`  MP3s:         ${OUTPUT_DIR}`);
  console.log(`  Metadata:     ${PREVIEWS_JSON_PATH}`);
  console.log(`  Instructions: ${README_PATH}`);
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
