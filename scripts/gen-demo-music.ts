/**
 * gen-demo-music.ts
 *
 * Generates the demo-video music bed + title-card sting via ElevenLabs Music API.
 * DEMO-SCRIPT.md contract: one tension bed rising through Acts 2-3, peak mid-Act-3,
 * cut to silence at 0:45 (handled in edit), title sting at 0:55-0:65.
 *
 * Output:
 *   public/sfx/demo-music/tension-bed.mp3   — 60s, rising industrial drone + heartbeat
 *   public/sfx/demo-music/title-sting.mp3   — ~8s, single amber sting
 *
 * Usage: pnpm tsx scripts/gen-demo-music.ts [--only=bed|sting]
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

type Track = { id: string; prompt: string; lengthMs: number };

const TRACKS: Track[] = [
  {
    id: 'tension-bed',
    prompt:
      'Dark cinematic underscore for a courtroom drama. Sub-bass drone around 60 Hz with a ' +
      'steady 60 BPM pulse like a slow heartbeat. Pulsing low strings, metallic overtones, ' +
      'rising synthetic tension. No melody, no vocals. Builds from hushed to near-peak across 60 seconds. ' +
      'Loopable. Amber and sepia mood. Inspired by the atmosphere of gritty cinematic scoring with a brooding edge.',
    lengthMs: 60_000,
  },
  {
    id: 'title-sting',
    prompt:
      'Single short cinematic sting for a title-card reveal. Dark amber synth pad ' +
      'with a distant metallic bell overtone. Swells then decays. No percussion, no melody. ' +
      '8 seconds total. Somber finality.',
    lengthMs: 8_000,
  },
];

function parseOnly(): Set<string> | null {
  const arg = process.argv.find(a => a.startsWith('--only='));
  if (!arg) return null;
  return new Set(arg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean));
}

async function collect(stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  if (Symbol.asyncIterator in (stream as object)) {
    for await (const c of stream as AsyncIterable<Uint8Array>) chunks.push(c);
  } else {
    const r = (stream as ReadableStream<Uint8Array>).getReader();
    while (true) { const { done, value } = await r.read(); if (done) break; if (value) chunks.push(value); }
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'public', 'sfx', 'demo-music');
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[init] Output dir: ${outDir}`);

  const only = parseOnly();
  const targets = only ? TRACKS.filter(t => only.has(t.id)) : TRACKS;
  const client = new ElevenLabsClient({ apiKey });

  for (const t of targets) {
    const outPath = path.join(outDir, `${t.id}.mp3`);
    console.log(`[${t.id}] composing ${t.lengthMs}ms...`);
    const stream = (await client.music.compose({
      prompt: t.prompt,
      musicLengthMs: t.lengthMs,
    })) as unknown as AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
    const buf = await collect(stream);
    fs.writeFileSync(outPath, buf);
    console.log(`[${t.id}] wrote ${buf.length.toLocaleString()} bytes -> ${outPath}`);
  }
  console.log(`[done] ${targets.length} music tracks generated.`);
}

main().catch(e => { console.error('[fatal]', e instanceof Error ? e.message : String(e)); process.exit(1); });
