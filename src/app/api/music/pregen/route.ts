// POST /api/music/pregen
//
// Pregenerate the three tension tracks for a session via 3 concurrent
// `client.music.compose({ prompt, musicLengthMs: 60000 })` calls (spec §5.1).
//
// SDK contract (Context7-verified):
//   - Method: client.music.compose({ prompt, musicLengthMs })
//   - musicLengthMs in ms, ∈ [3000, 600000] — NOT durationSeconds
//   - Returns an async iterable of Uint8Array chunks — NOT ReadableStream
//
// Storage (spec §5.4):
//   - MP3 buffers go to KV under `music:<sha256-of-prompt>`
//   - Track URL = `/api/music/track/<hash>` (served by sibling [hash]/route.ts)
//   - Vercel production filesystem is read-only outside build — DO NOT write to /public/

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import * as store from '@/lib/session/store';
import type { MusicTrack } from '@/lib/game/types';
import type { TensionLevel } from '@/lib/music/tension';
import { PROMPT_BY_LEVEL } from '@/lib/music/prompts';
import { putMusicBlob, hasMusicBlob } from '@/lib/music/kvStore';

const TRACK_LENGTH_MS = 60_000;
const PER_TRACK_TIMEOUT_MS = 20_000;

interface MusicPregenRequest {
  sessionId: string;
}

interface MusicPregenResponse {
  tracks: MusicTrack[];
  generatedMs: number;
}

interface MusicPregenError {
  error: { code: 'elevenlabs-error' | 'invalid-session' | 'timeout' | 'bad-request'; message: string };
  tracks: MusicTrack[];
}

const LEVELS: TensionLevel[] = ['calm', 'tense', 'critical'];

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
  });
}

/**
 * Generate a single tension-level track. Cache-hit on identical prompt.
 * Returns the URL (or throws).
 */
async function generateTrack(
  client: ElevenLabsClient,
  level: TensionLevel,
): Promise<MusicTrack> {
  const prompt = PROMPT_BY_LEVEL[level];
  const hash = sha256Hex(prompt);

  if (await hasMusicBlob(hash)) {
    return { level, url: `/api/music/track/${hash}` };
  }

  const composeWork = (async () => {
    const stream = (await client.music.compose({
      prompt,
      musicLengthMs: TRACK_LENGTH_MS,
    })) as unknown as AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

    const chunks: Uint8Array[] = [];
    // SDK returns ReadableStream<Uint8Array>; in Node 18+ ReadableStream is
    // async-iterable, but TS lib.dom.d.ts doesn't expose [Symbol.asyncIterator].
    // Try async iteration first (works in mocks + Node), fall back to reader.
    if (Symbol.asyncIterator in (stream as object)) {
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    } else {
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    }
    return Buffer.concat(chunks);
  })();

  const buffer = await Promise.race([
    composeWork,
    timeout<Buffer>(PER_TRACK_TIMEOUT_MS, `compose(${level})`),
  ]);

  if (buffer.length === 0) {
    throw new Error(`empty MP3 buffer for ${level}`);
  }

  await putMusicBlob(hash, buffer);
  return { level, url: `/api/music/track/${hash}` };
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  let body: MusicPregenRequest;
  try {
    body = await req.json();
  } catch {
    const err: MusicPregenError = {
      error: { code: 'bad-request', message: 'request body must be JSON' },
      tracks: [],
    };
    return Response.json(err, { status: 400 });
  }

  if (!body || typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    const err: MusicPregenError = {
      error: { code: 'bad-request', message: 'sessionId is required' },
      tracks: [],
    };
    return Response.json(err, { status: 400 });
  }

  const session = await store.get(body.sessionId);
  if (!session) {
    const err: MusicPregenError = {
      error: { code: 'invalid-session', message: `no session with id ${body.sessionId}` },
      tracks: [],
    };
    return Response.json(err, { status: 404 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const err: MusicPregenError = {
      error: { code: 'elevenlabs-error', message: 'ELEVENLABS_API_KEY is not set' },
      tracks: [],
    };
    return Response.json(err, { status: 500 });
  }

  const client = new ElevenLabsClient({ apiKey });

  try {
    // All-or-nothing: any failure invalidates the whole pregen (a partial set
    // would leave a tension level unmapped, worse than music-disabled).
    const tracks = await Promise.all(LEVELS.map(level => generateTrack(client, level)));

    // Persist into Session.musicTracks so subsequent ClientSession projections
    // see the populated URLs. We re-fetch under the assumption another route
    // could have advanced state in parallel; in practice pregen is fired once
    // per session right after CreateSession.
    const fresh = await store.get(body.sessionId);
    if (fresh) {
      fresh.musicTracks = tracks;
      await store.set(body.sessionId, fresh);
    }

    const response: MusicPregenResponse = {
      tracks,
      generatedMs: Date.now() - startedAt,
    };
    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code: MusicPregenError['error']['code'] = /timeout/i.test(message)
      ? 'timeout'
      : 'elevenlabs-error';
    const failed: MusicPregenError = {
      error: { code, message },
      tracks: [],
    };
    return Response.json(failed, { status: 502 });
  }
}
