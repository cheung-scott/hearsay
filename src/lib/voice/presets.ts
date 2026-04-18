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

// VOICE CASTING — custom-designed voices via ElevenLabs Voice Design, 2026-04-18.
// Each voice was prompted per the briefs in Obsidian_Vault/Projects/ElevenHacks-Kiro/VOICE-DESIGN.md.
// Display-layer persona names are courtroom archetypes (Defendant/Prosecutor/Attorney/Judge);
// internal Persona keys stay as Novice/Reader/Misdirector/Silent per game-engine type lock.
// To replace a voice: update the ID and annotate with // TUNED: YYYY-MM-DD <reason>.
//
//   Novice      → "hearsay-defendant"
//                 Working-class London nervous-young-male. Obvious tells, heavy fillers
//                 when lying. The training-wheels opponent.
//
//   Reader      → "hearsay-prosecutor"
//                 American neutral, late-50s male. Gus Fring register — soft-spoken,
//                 measured, over-articulated, emotionally flat. Carries the demo video.
//
//   Misdirector → "hearsay-attorney"
//                 British RP, 40s male. Theatrical narrative-spinner. Inverted tell —
//                 halting when truthful, smooth when lying.
//
//   Silent      → "hearsay-judge"
//                 British RP, elderly (70s) male. Deep gravelly, dispassionate,
//                 drawn-out. Act 4 climax voice; scarcity = weight.
export const PERSONA_VOICE_IDS: Record<Persona, string> = {
  Novice:      'Lrx118tn6NTNAXspnuEN',  // hearsay-defendant
  Reader:      'NxGA8X3YhTrnf3TRQf6Q',  // hearsay-prosecutor
  Misdirector: '0Q0MDAMrmHYYHDqFoGUx',  // hearsay-attorney
  Silent:      '0XMldg7YUhIHRMJqiWHr',  // hearsay-judge
};

// Tutorial-only persona — not in the game's Persona union.
// The Clerk welcomes new players in tutorial mode, explains the mechanic, then
// "the court will see you now" cuts to the real trial.
//   Clerk → "hearsay-clerk"
//           British RP, 40s female. Warm-bureaucratic, procedural.
export const CLERK_VOICE_ID = 'Al9pMcZxV70KAzzehiTE';  // hearsay-clerk
