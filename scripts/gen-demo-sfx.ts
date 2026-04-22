/**
 * gen-demo-sfx.ts
 *
 * Generates the missing SFX clips for the demo video per DEMO-SCRIPT.md.
 * ElevenLabs Sound Effects API: client.textToSoundEffects.convert.
 * Existing SFX (gavel.mp3, silent-beat.mp3, stinger.mp3) are untouched.
 *
 * Output: public/sfx/demo-sfx/<id>.mp3
 *
 * Usage: pnpm tsx scripts/gen-demo-sfx.ts [--only=<id>,...]
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.join(os.homedir(), '.claude', 'skills', 'video-use', '.env'));

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) { console.error('ERROR: ELEVENLABS_API_KEY missing.'); process.exit(1); }
console.log(`[init] API key loaded (${apiKey.length} chars).`);

type Sfx = { id: string; prompt: string; durationSec: number };

const SFX: Sfx[] = [
  {
    id: 'metallic-clack',
    prompt: 'Single short metallic wooden clack, like the stress-creak of a wooden gavel before being lifted. Dry, close-mic, no reverb. 0.3 seconds.',
    durationSec: 0.8,
  },
  {
    id: 'card-shuffle',
    prompt: 'ASMR-quality close-mic card shuffle. Wooden table surface. Short, crisp, dry. 1.2 seconds.',
    durationSec: 1.5,
  },
  {
    id: 'card-deal',
    prompt: 'Single card dealing onto a wooden table. Crisp paper-on-wood slap. Close-mic ASMR quality. No reverb. 0.4 seconds.',
    durationSec: 0.8,
  },
  {
    id: 'card-flip',
    prompt: 'Single playing card flipping face-up on a wooden table. Sharp woody snap. Close-mic. No reverb. 0.4 seconds.',
    durationSec: 0.8,
  },
  {
    id: 'strike-ignite',
    prompt: 'Short whoosh of a single candle flame igniting — gaseous ignition, low breath-like whoosh with faint crackle. 0.6 seconds.',
    durationSec: 1.0,
  },
  {
    id: 'crt-hum',
    prompt: 'Quiet continuous CRT television hum with faint scanline crackle. Low-frequency analog electrical hum, constant level. Ambient, loopable. 6 seconds.',
    durationSec: 6.0,
  },
  {
    id: 'heartbeat-60bpm',
    prompt: 'Slow muffled heartbeat, 60 beats per minute, low thud with soft secondary pulse. Deep chest resonance, close. No music. 6 seconds of steady beating.',
    durationSec: 6.0,
  },
  {
    id: 'industrial-drone',
    prompt: 'Dark industrial ambient drone. ~60Hz fundamental with metallic overtones, no melody, no rhythm. Stable continuous level, almost sub-bass. 6 seconds loopable.',
    durationSec: 6.0,
  },
  {
    id: 'screen-shake-thud',
    prompt: 'Short low thud with brief sub-bass rumble tail, like a heavy object hitting wood from below. Impact for a lie-caught moment. 0.5 seconds.',
    durationSec: 1.0,
  },
];

function parseOnly(): Set<string> | null {
  const arg = process.argv.find(a => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean));
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'public', 'sfx', 'demo-sfx');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[init] Output dir: ${outDir}`);

  const only = parseOnly();
  const targets = only ? SFX.filter(s => only.has(s.id)) : SFX;
  const client = new ElevenLabsClient({ apiKey });

  for (const s of targets) {
    const outPath = path.join(outDir, `${s.id}.mp3`);
    console.log(`[${s.id}] generating (${s.durationSec}s) "${s.prompt.slice(0, 60)}..."`);
    const stream = await client.textToSoundEffects.convert({
      text: s.prompt,
      durationSeconds: s.durationSec,
      promptInfluence: 0.6,
    });
    const data = await streamToUint8Array(stream);
    fs.writeFileSync(outPath, data);
    console.log(`[${s.id}] wrote ${data.length.toLocaleString()} bytes -> ${outPath}`);
  }
  console.log(`[done] ${targets.length} SFX generated.`);
}

main().catch(e => { console.error('[fatal]', e instanceof Error ? e.message : String(e)); process.exit(1); });
