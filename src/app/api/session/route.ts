// POST /api/session — create a new game session
// GET  /api/session?id={id} — fetch current ClientSession
//
// Next.js 16 App Router. Runtime pinned to Node (ElevenLabs SDK + KV client
// both use Node internals).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { dealFresh } from '@/lib/game/deck';
import { reduce } from '@/lib/game/fsm';
import { toClientView } from '@/lib/game/toClientView';
import type { Session, MusicTrack } from '@/lib/game/types';
import * as store from '@/lib/session/store';

// ---------------------------------------------------------------------------
// POST /api/session — create
// ---------------------------------------------------------------------------

export async function POST(): Promise<Response> {
  try {
    const id = crypto.randomUUID();

    // Build the initial (bare) Session in 'setup' state.
    const initialSession: Session = {
      id,
      status: 'setup',
      player: {
        hand: [],
        takenCards: [],
        roundsWon: 0,
        strikes: 0,
        jokers: [],
      },
      ai: {
        hand: [],
        takenCards: [],
        roundsWon: 0,
        strikes: 0,
        jokers: [],
        // Phase 1 demo: Reader is the sole opponent persona.
        personaIfAi: 'Reader',
      },
      deck: [],
      rounds: [],
      currentRoundIdx: 0,
      // Phase 1 stub: music tracks are empty (tension-music-system spec, Day 5).
      // FSM SetupComplete requires exactly 3 tracks, so provide 3 placeholders.
      musicTracks: [] as MusicTrack[],
    };

    // Dealer provides all randomness — coin flip, targetRank, shuffle.
    const deal = dealFresh();

    // Phase 1: 3 stub music track URLs (tension-music-system fills these Day 5).
    const musicTracks: MusicTrack[] = [
      { level: 'calm',     url: '' },
      { level: 'tense',    url: '' },
      { level: 'critical', url: '' },
    ];

    // Fire SetupComplete on the FSM to advance from 'setup' → 'round_active'.
    const session = reduce(initialSession, {
      type: 'SetupComplete',
      now: Date.now(),
      initialDeal: deal,
      musicTracks,
    });

    await store.set(id, session);

    return Response.json({ session: toClientView(session, 'player') });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: 'CREATE_SESSION_FAILED', message } },
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/session?id={id} — fetch
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return Response.json(
        { error: { code: 'MISSING_ID', message: 'id query param is required' } },
        { status: 400 },
      );
    }

    const session = await store.get(id);
    if (!session) {
      return Response.json(
        { error: { code: 'SESSION_NOT_FOUND', message: `No session with id ${id}` } },
        { status: 404 },
      );
    }

    return Response.json({ session: toClientView(session, 'player') });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: { code: 'GET_SESSION_FAILED', message } },
      { status: 400 },
    );
  }
}
