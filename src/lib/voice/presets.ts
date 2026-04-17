import type { Persona, TruthState, VoiceSettings } from '@/lib/game/types';

// Locked from architecture §6.1 + voice-tell-taxonomy spec §2.
// Any change here must re-run presets.test.ts invariants (Misdirector inversion,
// Novice obvious, Silent subtle, Reader middle). Day-2 tuning may nudge values
// within ±0.1 stability / ±0.1 style / ±0.04 speed; annotate with
// `// TUNED: YYYY-MM-DD <note>` on any tuned entry.
export const VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>> = {
  Novice: {
    honest: { stability: 0.85, similarity_boost: 0.85, style: 0.20, speed: 1.00 },
    lying:  { stability: 0.20, similarity_boost: 0.75, style: 0.60, speed: 0.92 }, // obvious
  },
  Reader: {
    honest: { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
    lying:  { stability: 0.45, similarity_boost: 0.80, style: 0.50, speed: 0.96 }, // subtle
  },
  Misdirector: {
    // DO NOT reorder — inversion is intentional.
    // honest = acoustically NERVOUS (low stability / high style)
    // lying  = acoustically CALM    (high stability / low style)
    // Any "normalizer" that sorts by acoustic property silently breaks this persona.
    honest: { stability: 0.40, similarity_boost: 0.80, style: 0.55, speed: 0.95 },
    lying:  { stability: 0.80, similarity_boost: 0.85, style: 0.25, speed: 1.00 },
  },
  Silent: {
    honest: { stability: 0.75, similarity_boost: 0.85, style: 0.30, speed: 1.00 },
    lying:  { stability: 0.55, similarity_boost: 0.82, style: 0.45, speed: 0.97 }, // thin tell
  },
};

// Voice IDs per persona — Day-2 tuning block fills these from the ElevenLabs
// preset library or Voice Generation API (stretch). Reader's ID is the smoke-
// test placeholder from /api/ping-voice and will be confirmed or replaced.
export const PERSONA_VOICE_IDS: Record<Persona, string> = {
  Novice: 'TBD_DAY2_TUNING',
  Reader: 'JBFqnCBsd6RMkjVDRZzb',
  Misdirector: 'TBD_DAY2_TUNING',
  Silent: 'TBD_DAY2_TUNING',
};
