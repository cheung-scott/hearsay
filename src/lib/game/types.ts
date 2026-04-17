// Shared game + voice types. Minimal stub for Day 2 voice work.
// game-engine spec's Task 1.1 will extend this file with Session/Round/Claim/etc.

export type Rank = 'Queen' | 'King' | 'Ace' | 'Jack';
export type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
export type TruthState = 'honest' | 'lying';

export interface Card {
  id: string;
  rank: Rank;
}

// Matches ElevenLabs `voiceSettings` payload for Flash v2.5.
// Property names are snake_case to mirror the API — we pass this verbatim into
// the `voiceSettings` field of `textToSpeech.convert()` after a shape adapter
// (SDK uses camelCase on its typed surface). See tts.ts (Day 2+).
export interface VoiceSettings {
  stability: number;         // [0, 1]
  similarity_boost: number;  // [0, 1]
  style: number;             // [0, 1]
  speed: number;             // ~[0.9, 1.1]
}

export interface VoiceMeta {
  latencyMs: number;
  fillerCount: number;
  pauseCount: number;
  speechRateWpm: number;
  lieScore: number;
  parsed: { count: number; rank: Rank } | null;
}

// From game-engine spec §2 — produced by dealFresh(), consumed by SetupComplete/JokerPicked events.
export interface RoundDeal {
  playerHand: Card[];       // length === 5
  aiHand: Card[];           // length === 5
  remainingDeck: Card[];    // length === 10
  targetRank: Rank;
  activePlayer: 'player' | 'ai';
}
