// Static catalog of all 5 v1 jokers. Spec: joker-system §5 (catalog table).
//
// Flavor strings are synchronised with `.kiro/steering/product.md`
// "Session-Jokers (5 in MVP)" table. The I13 drift-guard test
// (catalog.test.ts) ensures they never diverge.

import type { JokerType } from '../game/types';
import type { Joker } from './types';

export const JOKER_CATALOG: Record<JokerType, Joker> = Object.freeze({
  poker_face: {
    type: 'poker_face',
    name: 'Poker Face',
    flavor: "AI's voice-heuristic input is suppressed for 1 claim of your choice (math-only judging)",
    triggers: [{ kind: 'self_claim_phase' }],
    duration: 'next_claim',
    cost: { kind: 'none' },
    visibleOnActivate: true,
    accentVar: '--joker-poker-face',
  },
  stage_whisper: {
    type: 'stage_whisper',
    name: 'Stage Whisper',
    flavor: 'Unlocks probing: speak 1 free-form probe before next AI claim; AI answers via LLM + TTS with voice tells active',
    triggers: [{ kind: 'pre_ai_claim' }],
    duration: 'one_shot_on_use',
    cost: { kind: 'none' },
    visibleOnActivate: true,
    accentVar: '--joker-stage-whisper',
  },
  earful: {
    type: 'earful',
    name: 'Earful',
    flavor: 'After any challenge won by you, AI reveals which voice-tell preset was active',
    triggers: [{ kind: 'opponent_claim_resolved' }],
    duration: 'one_shot_on_use',
    cost: { kind: 'none' },
    visibleOnActivate: true,
    accentVar: '--joker-earful',
  },
  cold_read: {
    type: 'cold_read',
    name: 'Cold Read',
    flavor: 'Next AI claim: math-weight amplified, voice-weight reduced — easier to catch big lies',
    triggers: [{ kind: 'opponent_claim_resolved' }],
    duration: 'next_challenge',
    cost: { kind: 'none' },
    visibleOnActivate: true,
    accentVar: '--joker-cold-read',
  },
  second_wind: {
    type: 'second_wind',
    name: 'Second Wind',
    flavor: 'One-time: next strikes-penalty against you is cancelled',
    triggers: [{ kind: 'on_my_strike' }],
    duration: 'one_shot_on_use',
    cost: { kind: 'none' },
    visibleOnActivate: true,
    accentVar: '--joker-second-wind',
  },
}) as Record<JokerType, Joker>;
