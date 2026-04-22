/**
 * gen-demo-narration.ts
 *
 * Generates the demo-video narration clips per DEMO-SCRIPT.md iter-4:
 *   Prosecutor × 5 lines (Reader voice)
 *   Misdirector × 1 line  (Attorney voice)
 *   Judge × 2 lines        (Silent voice)
 *
 * Output: public/sfx/demo-narration/{p01..p05,m01,j01,j02}.mp3
 *
 * Model: eleven_multilingual_v2 (narration quality > Flash)
 *
 * Key fallback: ELEVENLABS_API_KEY is read from .env.local if present,
 * otherwise from ~/.claude/skills/video-use/.env (where Scott keeps it
 * shared with the video-use skill). Never logged.
 *
 * Usage:
 *   pnpm tsx scripts/gen-demo-narration.ts
 *   pnpm tsx scripts/gen-demo-narration.ts --only=p01,j02
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.join(os.homedir(), '.claude', 'skills', 'video-use', '.env'));

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('ERROR: ELEVENLABS_API_KEY not found in .env.local or skill .env.');
  process.exit(1);
}
console.log(`[init] API key loaded (${apiKey.length} chars).`);

const VOICE_IDS = {
  prosecutor: 'NxGA8X3YhTrnf3TRQf6Q', // Reader — hearsay-prosecutor
  misdirector: '0Q0MDAMrmHYYHDqFoGUx', // Misdirector — hearsay-attorney
  judge: '0XMldg7YUhIHRMJqiWHr',      // Silent — hearsay-judge
} as const;

type LineSpec = {
  id: string;
  voice: keyof typeof VOICE_IDS;
  text: string;
  register: string;
  settings: {
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
  };
};

const LINES: LineSpec[] = [
  // PROSECUTOR — cold → faux-polite → gloat → near-whisper
  {
    id: 'p01-welcome',
    voice: 'prosecutor',
    text: 'Welcome to the Court of Hearsay.',
    register: 'cold, faux-polite, Gus-Fring flat',
    settings: { stability: 0.82, similarityBoost: 0.85, style: 0.28, speed: 0.97 },
  },
  {
    id: 'p02-wont-be-here-long',
    voice: 'prosecutor',
    text: "You won't be here long.",
    register: 'quiet menace beneath politeness',
    settings: { stability: 0.78, similarityBoost: 0.85, style: 0.35, speed: 0.95 },
  },
  {
    id: 'p03-accepted',
    voice: 'prosecutor',
    text: 'Accepted.',
    register: 'calm, controlled, single word',
    settings: { stability: 0.85, similarityBoost: 0.85, style: 0.20, speed: 1.00 },
  },
  {
    id: 'p04-liars-all-sound-the-same',
    voice: 'prosecutor',
    text: 'Liars all sound the same.',
    register: 'softer, gloating, almost pleased',
    settings: { stability: 0.70, similarityBoost: 0.85, style: 0.45, speed: 0.92 },
  },
  {
    id: 'p05-one-strike-left',
    voice: 'prosecutor',
    text: 'One strike left.',
    register: 'near-whisper, savouring',
    settings: { stability: 0.88, similarityBoost: 0.85, style: 0.18, speed: 0.88 },
  },

  // MISDIRECTOR — theatrical barrister, smug, relishing
  {
    id: 'm01-liar',
    voice: 'misdirector',
    text: '...Liar.',
    register: 'theatrical British barrister, smug, on music stab',
    settings: { stability: 0.55, similarityBoost: 0.85, style: 0.65, speed: 0.95 },
  },

  // JUDGE — deep, dispassionate, slow. Scarcity = weight.
  {
    id: 'j01-court-finds-guilty',
    voice: 'judge',
    text: 'The court finds you guilty.',
    register: 'deep, dispassionate, slow — first time we hear him',
    settings: { stability: 0.88, similarityBoost: 0.85, style: 0.20, speed: 0.82 },
  },
  {
    id: 'j02-executed',
    voice: 'judge',
    text: 'Executed.',
    register: 'flat finality, one word',
    settings: { stability: 0.92, similarityBoost: 0.85, style: 0.15, speed: 0.78 },
  },
];

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function parseOnly(): Set<string> | null {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'public', 'sfx', 'demo-narration');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[init] Output dir: ${outDir}`);

  const only = parseOnly();
  const targets = only ? LINES.filter((l) => only.has(l.id)) : LINES;
  const totalChars = targets.reduce((s, l) => s + l.text.length, 0);
  console.log(`[plan] ${targets.length} lines, ${totalChars} chars, ~${totalChars * 2} credits (multilingual_v2 ≈ 2 cr/char).`);
  console.log('');

  const client = new ElevenLabsClient({ apiKey });
  const t0 = Date.now();

  for (const line of targets) {
    const voiceId = VOICE_IDS[line.voice];
    const outPath = path.join(outDir, `${line.id}.mp3`);
    console.log(`[${line.id}] voice=${line.voice} "${line.text}"  — ${line.register}`);

    const stream = await client.textToSpeech.convert(voiceId, {
      text: line.text,
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      voiceSettings: line.settings,
    });
    const data = await streamToUint8Array(stream);
    fs.writeFileSync(outPath, data);
    console.log(`[${line.id}] wrote ${data.length.toLocaleString()} bytes -> ${outPath}`);
    console.log('');
  }

  console.log(`[done] ${targets.length} narration clips in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error('[fatal]', e instanceof Error ? e.message : String(e)); process.exit(1); });
