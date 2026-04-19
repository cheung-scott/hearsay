// POST /api/voice/tts — standalone TTS endpoint (phase 1 stub).
//
// Phase 1: returns 501 Not Implemented.
// Day 5 consumer: autopsy panel re-plays past claims with { text, persona, truthState }.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  return Response.json(
    { error: 'tts-not-implemented-in-phase-1' },
    { status: 501 },
  );
}
