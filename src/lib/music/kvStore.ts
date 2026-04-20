// KV blob storage for pregen MP3 buffers.
//
// Why KV not /public/: Vercel production filesystem is read-only at runtime.
// Writes to /public/ from server code silently 404. KV (Redis-backed via
// @vercel/kv) survives across cold starts and is the canonical seam.
//
// Key schema: `music:<hash>` where <hash> is SHA-256 hex of the prompt string.
// Buffers are base64-encoded for transport (kv.set otherwise JSON-serializes
// Buffer as `{"type":"Buffer","data":[...]}` which round-trips lossily).

import { kv } from '@vercel/kv';

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — content-addressed, harmless to retain

function key(hash: string): string {
  return `music:${hash}`;
}

export async function putMusicBlob(hash: string, buffer: Buffer): Promise<void> {
  const b64 = buffer.toString('base64');
  await kv.set(key(hash), b64, { ex: TTL_SECONDS });
}

export async function getMusicBlob(hash: string): Promise<Buffer | null> {
  const b64 = await kv.get<string>(key(hash));
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

/** Cheap existence probe — avoids dragging the buffer over the wire. */
export async function hasMusicBlob(hash: string): Promise<boolean> {
  const exists = await kv.exists(key(hash));
  return exists === 1;
}
