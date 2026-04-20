// Tension-music-system spec §9 invariants I4 (track URL presence) +
// I9 (timeout fails cleanly) + idempotency.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (declared before route import — vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/session/store', () => {
  const sessions = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).__sessionStore = sessions;
  return {
    get: vi.fn(async (id: string) => sessions.get(id) ?? null),
    set: vi.fn(async (id: string, s: unknown) => { sessions.set(id, s); }),
  };
});

vi.mock('@/lib/music/kvStore', () => {
  const blobs = new Map<string, Buffer>();
  (globalThis as Record<string, unknown>).__kvBlobs = blobs;
  return {
    putMusicBlob: vi.fn(async (hash: string, buf: Buffer) => { blobs.set(hash, buf); }),
    getMusicBlob: vi.fn(async (hash: string) => blobs.get(hash) ?? null),
    hasMusicBlob: vi.fn(async (hash: string) => blobs.has(hash)),
  };
});

vi.mock('@elevenlabs/elevenlabs-js', () => {
  const composeMock = vi.fn();
  (globalThis as Record<string, unknown>).__composeMock = composeMock;

  // Default: yield a small non-empty buffer.
  composeMock.mockImplementation(async () =>
    (async function* () {
      yield new Uint8Array([0x49, 0x44, 0x33]); // "ID3" tag start
      yield new Uint8Array([0x01, 0x02, 0x03]);
    })(),
  );

  function ElevenLabsClient() {
    return { music: { compose: composeMock } };
  }
  return { ElevenLabsClient };
});

process.env.ELEVENLABS_API_KEY = 'test-key';

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { POST } from './route';
import type { Session } from '@/lib/game/types';

const sessionStore = () =>
  (globalThis as Record<string, unknown>).__sessionStore as Map<string, Session>;
const kvBlobs = () =>
  (globalThis as Record<string, unknown>).__kvBlobs as Map<string, Buffer>;
const composeMock = () =>
  (globalThis as Record<string, unknown>).__composeMock as ReturnType<typeof vi.fn>;

function makeSession(id: string): Session {
  return {
    id,
    status: 'round_active',
    player: { hand: [], takenCards: [], roundsWon: 0, strikes: 0, jokers: [] },
    ai: { hand: [], takenCards: [], roundsWon: 0, strikes: 0, jokers: [] },
    deck: [],
    rounds: [],
    currentRoundIdx: 0,
    musicTracks: [
      { level: 'calm', url: '' },
      { level: 'tense', url: '' },
      { level: 'critical', url: '' },
    ],
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/music/pregen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionStore().clear();
  kvBlobs().clear();
  composeMock().mockClear();
  composeMock().mockImplementation(async () =>
    (async function* () {
      yield new Uint8Array([0x49, 0x44, 0x33]);
      yield new Uint8Array([0x01, 0x02, 0x03]);
    })(),
  );
});

describe('POST /api/music/pregen', () => {
  describe('happy path — I4 (track URL presence on every TensionLevel)', () => {
    it('returns 3 tracks covering calm/tense/critical with non-empty URLs', async () => {
      const id = 'session-A';
      sessionStore().set(id, makeSession(id));

      const res = await POST(postRequest({ sessionId: id }));
      expect(res.status).toBe(200);
      const data = (await res.json()) as { tracks: { level: string; url: string }[]; generatedMs: number };

      expect(data.tracks).toHaveLength(3);
      const levels = data.tracks.map(t => t.level).sort();
      expect(levels).toEqual(['calm', 'critical', 'tense']);
      for (const t of data.tracks) {
        expect(t.url).toMatch(/^\/api\/music\/track\/[a-f0-9]{64}$/);
      }
      expect(data.generatedMs).toBeGreaterThanOrEqual(0);
      expect(composeMock()).toHaveBeenCalledTimes(3);
    });

    it('persists tracks back into Session.musicTracks', async () => {
      const id = 'session-B';
      sessionStore().set(id, makeSession(id));

      await POST(postRequest({ sessionId: id }));

      const after = sessionStore().get(id)!;
      expect(after.musicTracks.every(t => t.url.startsWith('/api/music/track/'))).toBe(true);
    });
  });

  describe('idempotency — cache hit on identical prompts', () => {
    it('second call does not re-invoke compose() (KV hash hit)', async () => {
      const id = 'session-C';
      sessionStore().set(id, makeSession(id));

      await POST(postRequest({ sessionId: id }));
      expect(composeMock()).toHaveBeenCalledTimes(3);

      composeMock().mockClear();
      await POST(postRequest({ sessionId: id }));
      expect(composeMock()).not.toHaveBeenCalled();
    });
  });

  describe('I9 — timeout fails cleanly', () => {
    it('returns MusicPregenError with tracks: [] when SDK never resolves', async () => {
      vi.useFakeTimers();
      const id = 'session-D';
      sessionStore().set(id, makeSession(id));

      // Replace compose with a never-resolving promise.
      composeMock().mockImplementation(() => new Promise(() => { /* hang */ }));

      const respPromise = POST(postRequest({ sessionId: id }));
      // Advance past the per-track 20s budget so the timeout fires.
      await vi.advanceTimersByTimeAsync(20_001);
      const res = await respPromise;
      vi.useRealTimers();

      expect(res.status).toBe(502);
      const data = (await res.json()) as { tracks: unknown[]; error: { code: string } };
      expect(data.tracks).toEqual([]);
      expect(data.error.code).toBe('timeout');
    });
  });

  describe('error paths', () => {
    it('returns 400 for missing sessionId', async () => {
      const res = await POST(postRequest({}));
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { code: string }; tracks: unknown[] };
      expect(data.error.code).toBe('bad-request');
      expect(data.tracks).toEqual([]);
    });

    it('returns 404 for unknown session', async () => {
      const res = await POST(postRequest({ sessionId: 'nope' }));
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: { code: string } };
      expect(data.error.code).toBe('invalid-session');
    });

    it('returns 502 when compose throws', async () => {
      const id = 'session-E';
      sessionStore().set(id, makeSession(id));
      composeMock().mockRejectedValueOnce(new Error('elevenlabs 5xx'));

      const res = await POST(postRequest({ sessionId: id }));
      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: { code: string }; tracks: unknown[] };
      expect(data.error.code).toBe('elevenlabs-error');
      expect(data.tracks).toEqual([]);
    });

    it('returns 502 when buffer is empty (degenerate SDK response)', async () => {
      const id = 'session-F';
      sessionStore().set(id, makeSession(id));
      composeMock().mockImplementation(async () =>
        (async function* () {
          // yields nothing
        })(),
      );

      const res = await POST(postRequest({ sessionId: id }));
      expect(res.status).toBe(502);
      const data = (await res.json()) as { tracks: unknown[] };
      expect(data.tracks).toEqual([]);
    });
  });
});
