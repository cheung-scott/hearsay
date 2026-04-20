// Composition prompts for ElevenLabs Music API.
// Tuned Day 5 — values are intentionally evocative; shape is locked.
//
// Each prompt is fed verbatim to `client.music.compose({ prompt, musicLengthMs: 60000 })`.
// SHA-256 of the prompt is the KV cache key — re-tuning a prompt invalidates its track.

import type { TensionLevel } from './tension';

export const CALM_PROMPT =
  'Sparse, brooding noir lounge piano. Low double bass, distant brushed cymbals. ' +
  'Underplayed, smoky speakeasy at 1am. No vocals. Loopable, no melodic resolution. ' +
  '60 seconds. Tempo around 72 BPM.';

export const TENSE_PROMPT =
  'Tense cinematic underscore. Pulsing low strings, muted heartbeat percussion, ' +
  'occasional unsettling piano stab. Stalked-in-an-alley energy. No vocals. ' +
  'Loopable. 60 seconds. Tempo around 96 BPM.';

export const CRITICAL_PROMPT =
  'High-stakes thriller climax bed. Driving low brass, taiko-style hits, ' +
  'rising synthetic dread layer. About-to-snap, courtroom-verdict tension. ' +
  'No vocals, no melodic resolution. Loopable. 60 seconds. Tempo around 128 BPM.';

/** Lookup table — mirror of the TensionLevel union. */
export const PROMPT_BY_LEVEL: Record<TensionLevel, string> = {
  calm: CALM_PROMPT,
  tense: TENSE_PROMPT,
  critical: CRITICAL_PROMPT,
};
