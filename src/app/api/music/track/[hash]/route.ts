// GET /api/music/track/[hash]
//
// Serves pregen MP3 buffers stored in KV (spec §5.4). Vercel production
// filesystem is read-only at runtime — KV is the canonical home for
// content-addressed audio. Cache header is aggressive because the hash IS the
// content fingerprint; re-tuning a prompt produces a new hash and a new URL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { getMusicBlob } from '@/lib/music/kvStore';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const { hash } = await params;

  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return Response.json(
      { error: 'invalid-hash', message: 'hash must be 64-char hex (sha256)' },
      { status: 400 },
    );
  }

  const buffer = await getMusicBlob(hash);
  if (!buffer) {
    return Response.json({ error: 'track-not-found' }, { status: 404 });
  }

  // Copy into a fresh Uint8Array backed by a plain ArrayBuffer (not Node's
  // SharedArrayBuffer-backed slab) so it satisfies the BodyInit type.
  const body = new Uint8Array(buffer.byteLength);
  body.set(buffer);

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
