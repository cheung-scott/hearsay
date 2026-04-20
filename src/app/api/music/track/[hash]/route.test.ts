// Tension-music-system spec §5.4 + R7.1/R7.2 — KV-served MP3 route.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/music/kvStore', () => {
  const blobs = new Map<string, Buffer>();
  (globalThis as Record<string, unknown>).__trackKvBlobs = blobs;
  return {
    putMusicBlob: vi.fn(async (hash: string, buf: Buffer) => { blobs.set(hash, buf); }),
    getMusicBlob: vi.fn(async (hash: string) => blobs.get(hash) ?? null),
    hasMusicBlob: vi.fn(async (hash: string) => blobs.has(hash)),
  };
});

import { GET } from './route';

const blobs = () =>
  (globalThis as Record<string, unknown>).__trackKvBlobs as Map<string, Buffer>;

const VALID_HASH = 'a'.repeat(64);
const INVALID_HASH_SHORT = 'abc';
const INVALID_HASH_NONHEX = 'g'.repeat(64);

function getRequest(hash: string): Request {
  return new Request(`http://localhost/api/music/track/${hash}`, { method: 'GET' });
}

beforeEach(() => { blobs().clear(); });

describe('GET /api/music/track/[hash]', () => {
  it('returns 200 + audio/mpeg + cache headers + body bytes on hit', async () => {
    const buf = Buffer.from([0x49, 0x44, 0x33, 0x01, 0x02, 0x03]); // "ID3" tag start
    blobs().set(VALID_HASH, buf);

    const res = await GET(getRequest(VALID_HASH), { params: Promise.resolve({ hash: VALID_HASH }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Cache-Control')).toMatch(/public, max-age=86400/);
    expect(res.headers.get('Content-Length')).toBe(String(buf.length));

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(buf.length);
    expect(Array.from(bytes)).toEqual(Array.from(buf));
  });

  it('returns 404 with track-not-found error on KV miss (R7.2)', async () => {
    const res = await GET(getRequest(VALID_HASH), { params: Promise.resolve({ hash: VALID_HASH }) });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('track-not-found');
  });

  it('returns 400 on non-hex or short hash (defensive validation)', async () => {
    const r1 = await GET(getRequest(INVALID_HASH_SHORT), { params: Promise.resolve({ hash: INVALID_HASH_SHORT }) });
    expect(r1.status).toBe(400);
    const r2 = await GET(getRequest(INVALID_HASH_NONHEX), { params: Promise.resolve({ hash: INVALID_HASH_NONHEX }) });
    expect(r2.status).toBe(400);
  });
});
