// AI-opponent public types — TS-level codification of design.md §2.
// Game-engine types (Persona, Rank, Card, PublicClaim, VoiceMeta, JokerType)
// are re-used from ../game/types, never duplicated.

import type {
  Persona,
  Rank,
  Card,
  PublicClaim,
  VoiceMeta,
  JokerType,
} from '../game/types';

/** Telemetry tag for which leg of the pipeline produced a decision. */
export type AiSource =
  | 'llm'
  | 'fallback-timeout'
  | 'fallback-invalid-json'
  | 'fallback-network-error';

/** Input to aiDecideOnClaim — the AI is judging a claim just made by the player. */
export interface DecisionContext {
  persona: Persona;
  targetRank: Rank;
  myHand: Card[];
  myJokers: JokerType[];
  opponentJokers: JokerType[];
  opponentHandSize: number;
  /** All claims this round, oldest first. MUST include the claim being judged
   *  (caller appends before invoking the brain — see design.md §6). */
  roundHistory: PublicClaim[];
  claim: PublicClaim & { voiceMeta?: VoiceMeta };
  pileSize: number;
  strikesMe: number;
  strikesPlayer: number;
}

/** Input to aiDecideOwnPlay — the AI is about to make its own claim. */
export interface OwnPlayContext {
  persona: Persona;
  targetRank: Rank;
  myHand: Card[];
  myJokers: JokerType[];
  opponentJokers: JokerType[];
  opponentHandSize: number;
  roundHistory: PublicClaim[];
  pileSize: number;
  strikesMe: number;
  strikesPlayer: number;
}

/** Output of aiDecideOnClaim — caller fires ClaimAccepted or ChallengeCalled. */
export interface AiDecision {
  action: 'accept' | 'challenge';
  /** Autopsy UI / Earful joker. Populated whether from LLM or fallback. */
  innerThought: string;
  /** LLM-path only; undefined on fallback paths. */
  llmReasoning?: string;
  /**
   * Short (≤15-word) in-character spoken reaction the AI utters when applying
   * its verdict. The server TTSes this via ElevenLabs Flash v2.5 with the
   * persona's voice + a voice-settings preset matched to the decision.
   * Always populated — LLM path returns it directly, fallback paths fill in
   * a static pool line per (persona, action).
   */
  voiceline: string;
  source: AiSource;
  /** Includes math + LLM + any retry. */
  latencyMs: number;
  /** Surfaced for DEBUG_LLM logs and autopsy UI. */
  mathProb: number;
}

/** Output of aiDecideOwnPlay — caller fires ClaimMade. */
export interface AiPlay {
  /** Length 1 or 2, all drawn from ctx.myHand. */
  cardsToPlay: Card[];
  claim: {
    count: 1 | 2;
    /** MUST === ctx.targetRank (round target). */
    rank: Rank;
  };
  /** Derived from cardsToPlay vs claimedRank. */
  truthState: 'honest' | 'lying';
  /** Dialogue line for TTS (LLM-generated or templated fallback). */
  claimText: string;
  innerThought: string;
  llmReasoning?: string;
  source: AiSource;
  latencyMs: number;
}

/** Raw LLM JSON output for judging — validated against this schema. */
export interface LLMJudgmentOutput {
  action: 'accept' | 'challenge';
  /** One sentence. */
  innerThought: string;
  /**
   * Short (≤15 words) in-character spoken reaction. Server pipes into
   * ElevenLabs Flash v2.5 TTS so the AI actually verbalises its verdict.
   */
  voiceline: string;
}

/** Raw LLM JSON output for own-play — validated against this schema. */
export interface LLMOwnPlayOutput {
  /** Card IDs, length 1 or 2, MUST be subset of ctx.myHand IDs. */
  cardsToPlay: string[];
  /** MUST === cardsToPlay.length. */
  claimCount: 1 | 2;
  claimText: string;
  /** MUST agree with cardsToPlay ranks vs targetRank. */
  truthState: 'honest' | 'lying';
  innerThought: string;
}

/* --- LLM errors --------------------------------------------------------- */
/* Caught by brain.ts to trigger fallback and map to AiSource.             */

export class LLMTimeoutError extends Error {
  constructor() {
    super('LLM call aborted at 2000ms timeout');
    this.name = 'LLMTimeoutError';
  }
}

export class LLMInvalidJSONError extends Error {
  constructor(
    public readonly raw: string,
    public readonly reason: string,
  ) {
    super(`LLM returned invalid JSON: ${reason}`);
    this.name = 'LLMInvalidJSONError';
  }
}

export class LLMNetworkError extends Error {
  constructor(public readonly cause: unknown) {
    super(`LLM network error: ${String(cause)}`);
    this.name = 'LLMNetworkError';
  }
}
