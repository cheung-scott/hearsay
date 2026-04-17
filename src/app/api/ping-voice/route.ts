import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Next.js 16 App Router: force dynamic so env vars + external API are never
// statically cached, and pin the runtime to Node (the ElevenLabs SDK uses
// node:stream internals).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Day 1 smoke test for Architecture §11 risk #1:
//   "ElevenLabs per-request voice-settings override on Flash v2.5 works"
//
// GET /api/ping-voice
//   → calls Flash v2.5 with an explicit voiceSettings override
//   → streams MP3 back
// Hardcoded text + voice ID + preset. Replace with `Reader.honest` from
// VOICE_PRESETS once src/lib/ai/personas.ts is in place (spec: ai-personas).

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // ElevenLabs preset voice
const TEST_TEXT = "One queen.";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set on the server" },
      { status: 500 },
    );
  }

  const voiceId = process.env.ELEVENLABS_PING_VOICE_ID ?? DEFAULT_VOICE_ID;
  const client = new ElevenLabsClient({ apiKey });

  try {
    const audio = await client.textToSpeech.convert(voiceId, {
      text: TEST_TEXT,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: 0.8,
        similarityBoost: 0.85,
        style: 0.25,
        useSpeakerBoost: true,
      },
    });

    // SDK returns a Web ReadableStream<Uint8Array>. Pass it straight to
    // Response — browser starts playing as bytes arrive (no Buffer.concat
    // wait). Response accepts ReadableStream as its body. No Content-Length
    // because we don't know the total size up front.
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "ElevenLabs TTS failed", detail: message },
      { status: 502 },
    );
  }
}
