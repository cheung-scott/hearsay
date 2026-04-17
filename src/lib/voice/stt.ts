// Voice-tell-taxonomy spec §2 — STT wrapper + derived metadata.
// Server-side only (Node runtime). Never import in client components.

import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { SpeechToTextChunkResponseModel } from '@elevenlabs/elevenlabs-js/api';
import { FILLER_REGEX, computeLieScore } from './heuristic';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Subset of VoiceMeta owned by this module — omits `parsed`, which belongs to
 * the deck-and-claims spec (caller populates it via parseClaim).
 */
export interface VoiceMetaFromAudio {
  /** Full transcript text from Scribe. */
  transcript: string;
  /** Milliseconds from audio start to first word-type entry. 0 if no words. */
  latencyMs: number;
  /** Number of FILLER_REGEX matches in the transcript. */
  fillerCount: number;
  /** Inter-word gaps strictly > 400ms (consecutive word-type entries only). */
  pauseCount: number;
  /** wordCount / (audioDurationSecs / 60); 0 if duration <= 0. */
  speechRateWpm: number;
  /** computeLieScore result from derived signals. */
  lieScore: number;
  /** Pass-through from Scribe for caller convenience. */
  audioDurationSecs: number;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when Scribe returns a response shape this module cannot handle
 * (e.g. multichannel or webhook modes that lack a top-level `words` array).
 */
export class STTUnexpectedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'STTUnexpectedResponseError';
  }
}

// ---------------------------------------------------------------------------
// Pure helper — testable without SDK mocks
// ---------------------------------------------------------------------------

/**
 * Derive VoiceMetaFromAudio from a fully-resolved Scribe chunk response.
 * Pure: no I/O. Tested directly in stt.test.ts.
 *
 * @throws {STTUnexpectedResponseError} if the response lacks a `words` array.
 */
export function extractVoiceMeta(
  response: unknown,
): VoiceMetaFromAudio {
  // Narrow the union — multichannel/webhook responses don't have `words`.
  if (
    typeof response !== 'object' ||
    response === null ||
    !('words' in response)
  ) {
    throw new STTUnexpectedResponseError(
      'Expected chunk response with words, got: ' +
        JSON.stringify(response).slice(0, 200),
    );
  }

  const chunk = response as SpeechToTextChunkResponseModel;

  // Coerce text defensively — chunk.text can be null/undefined on empty audio.
  const text = typeof chunk.text === 'string' ? chunk.text : '';

  // latencyMs — time to first word-type entry.
  const firstWord = chunk.words.find(
    (w) => w.type === 'word' && w.start != null,
  );
  const latencyMs = firstWord?.start != null ? firstWord.start * 1000 : 0;

  // fillerCount — use .match() to avoid mutating the global regex's lastIndex.
  const fillerCount = (text.match(FILLER_REGEX) ?? []).length;

  // pauseCount — gaps strictly > 400ms between consecutive word-type entries.
  const wordEntries = chunk.words.filter((w) => w.type === 'word');
  let pauseCount = 0;
  for (let i = 1; i < wordEntries.length; i++) {
    const prev = wordEntries[i - 1];
    const curr = wordEntries[i];
    if (prev.end != null && curr.start != null) {
      const gapMs = (curr.start - prev.end) * 1000;
      if (gapMs > 400) {
        pauseCount++;
      }
    }
  }

  // speechRateWpm.
  const wordCount = wordEntries.length;
  const audioDurationSecs = chunk.audioDurationSecs ?? 0;
  const speechRateWpm =
    audioDurationSecs > 0 ? wordCount / (audioDurationSecs / 60) : 0;

  // lieScore.
  const lieScore = computeLieScore({
    latencyMs,
    fillerCount,
    pauseCount,
    speechRateWpm,
  });

  return {
    transcript: text,
    latencyMs,
    fillerCount,
    pauseCount,
    speechRateWpm,
    lieScore,
    audioDurationSecs,
  };
}

// ---------------------------------------------------------------------------
// IO wrapper
// ---------------------------------------------------------------------------

/**
 * Server-side wrapper: sends audio to ElevenLabs Scribe and returns derived
 * voice metadata.
 *
 * Caller responsibilities:
 *   - Provide an authenticated ElevenLabsClient (inject from env var).
 *   - Call parseClaim(result.transcript) separately — deck-and-claims owns that.
 *   - Build the final VoiceMeta: { ...result, parsed: parseClaim(...) }.
 *
 * @throws {STTUnexpectedResponseError} if Scribe returns multichannel/webhook shape.
 * @throws SDK errors propagate as-is — the calling API route handles status codes.
 */
export async function computeVoiceMetaFromAudio(
  audio: Blob | File,
  client: ElevenLabsClient,
): Promise<VoiceMetaFromAudio> {
  const response = await client.speechToText.convert({
    modelId: 'scribe_v2',
    file: audio,
    tagAudioEvents: true,
    timestampsGranularity: 'word',
  });

  return extractVoiceMeta(response);
}
