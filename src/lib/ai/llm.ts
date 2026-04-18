// LLM layer — wraps @google/genai (Gemini 2.5 Flash) for AI-opponent decisions.
// Owns: prompt assembly, AbortController timeout, JSON schema enforcement,
// retry-once on invalid JSON, and structured error throwing.
// See design.md §4 and llm-prompt-conventions.md for authoritative contracts.

import { GoogleGenAI, Type } from '@google/genai';

import type { DecisionContext, OwnPlayContext, LLMJudgmentOutput, LLMOwnPlayOutput } from './types';
import { LLMTimeoutError, LLMInvalidJSONError, LLMNetworkError } from './types';
import { PERSONA_DESCRIPTIONS } from './constants';
import { PERSONA_BLUFF_BIAS } from './math';
import type { Card, PublicClaim, Rank } from '../game/types';

// ---------------------------------------------------------------------------
// Module-load env check (invariant 13)
// Throw synchronously at import time so a missing key is a loud startup
// failure, not a silent runtime fallback deep inside a request handler.
// ---------------------------------------------------------------------------
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required at module load');
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL_ID = 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Response schemas (design.md §4.2)
// Use responseJsonSchema (NOT responseSchema — that is the legacy SDK field).
// ---------------------------------------------------------------------------

const JUDGMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action:       { type: Type.STRING, enum: ['accept', 'challenge'] },
    innerThought: { type: Type.STRING },
  },
  required: ['action', 'innerThought'],
};

const OWN_PLAY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cardsToPlay:  { type: Type.ARRAY, items: { type: Type.STRING } },
    claimCount:   { type: Type.INTEGER, enum: [1, 2] },
    claimText:    { type: Type.STRING },
    truthState:   { type: Type.STRING, enum: ['honest', 'lying'] },
    innerThought: { type: Type.STRING },
  },
  required: ['cardsToPlay', 'claimCount', 'claimText', 'truthState', 'innerThought'],
};

// ---------------------------------------------------------------------------
// Private interpolation helpers (design.md §4.3)
// ---------------------------------------------------------------------------

/** Group hand by rank and emit "2 Queen, 1 King, 2 Jack" style string. */
function formatHand(hand: Card[]): string {
  const counts = new Map<Rank, number>();
  for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');
}

/** Format round history as semicolon-separated claim lines, or "(none)". */
function formatHistory(history: PublicClaim[]): string {
  if (history.length === 0) return '(none)';
  return history.map(c => `${c.by} claimed ${c.count} ${c.claimedRank}`).join('; ');
}

/** Replace all occurrences of {{key}} in template with value. */
function interpolate(template: string, map: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(map)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompt assembly — pure functions (design.md §4.3)
// ---------------------------------------------------------------------------

/** Assemble the judging-opponent's-claim prompt from llm-prompt-conventions.md §"Prompt template — judging opponent's claim". */
export function buildJudgmentPrompt(ctx: DecisionContext, mathProb: number): string {
  const template = `You are {{persona}}: {{personaDescription}}.
Liar's Bar-style bluff game, best-of-3 rounds.
This round's target: {{targetRank}}.
Your hand: {{handDescription}}.
Pile face-down: {{pileSize}} cards. Claim history this round: {{publicClaims}}.
Opponent hand size: {{playerHandSize}}. Opponent jokers: {{opponentJokers}}.
Strikes: you {{strikesMe}}/3, them {{strikesPlayer}}/3.

DETERMINISTIC GROUNDING:
- Math probability opponent's claim is a lie: {{mathProb}} (0=honest, 1=impossible)
- Opponent voice lie-score: {{voiceLie}} (0=calm, 1=nervous)

Decide: accept the claim, or call "Liar!"
Stay in-character for {{persona}}.

Return JSON: {"action": "accept"|"challenge", "innerThought": "<one sentence>"}`;

  return interpolate(template, {
    persona:             ctx.persona,
    personaDescription:  PERSONA_DESCRIPTIONS[ctx.persona],
    targetRank:          ctx.targetRank,
    handDescription:     formatHand(ctx.myHand),
    pileSize:            String(ctx.pileSize),
    publicClaims:        formatHistory(ctx.roundHistory),
    playerHandSize:      String(ctx.opponentHandSize),
    opponentJokers:      ctx.opponentJokers.join(', ') || 'none',
    strikesMe:           String(ctx.strikesMe),
    strikesPlayer:       String(ctx.strikesPlayer),
    mathProb:            mathProb.toFixed(2),
    voiceLie:            (ctx.claim.voiceMeta?.lieScore ?? 0.5).toFixed(2),
  });
}

/** Assemble the own-play prompt from llm-prompt-conventions.md §"Prompt template — own play". */
export function buildOwnPlayPrompt(ctx: OwnPlayContext): string {
  const template = `You are {{persona}}: {{personaDescription}}.
Target this round: {{targetRank}}. Your hand: {{hand}}.
Strikes: you {{strikesMe}}/3, them {{strikesPlayer}}/3.
Round history: {{publicClaims}}.

Play 1-2 cards face-down, claim a count of {{targetRank}}.
Stay in-character. {{persona}} bluff-bias: {{bluffBias}}.

Return JSON: {
  "cardsToPlay": ["cardId1", "cardId2"?],
  "claimCount": 1 | 2,
  "claimText": "<short spoken line>",
  "truthState": "honest" | "lying",
  "innerThought": "<one sentence>"
}`;

  return interpolate(template, {
    persona:            ctx.persona,
    personaDescription: PERSONA_DESCRIPTIONS[ctx.persona],
    targetRank:         ctx.targetRank,
    hand:               formatHand(ctx.myHand),
    strikesMe:          String(ctx.strikesMe),
    strikesPlayer:      String(ctx.strikesPlayer),
    publicClaims:       formatHistory(ctx.roundHistory),
    bluffBias:          PERSONA_BLUFF_BIAS[ctx.persona].toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// Validators — hand-rolled, no zod (design.md §4.4)
// ---------------------------------------------------------------------------

function validateJudgment(raw: string, parsed: unknown): LLMJudgmentOutput {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new LLMInvalidJSONError(raw, 'not-object');
  }
  const p = parsed as Record<string, unknown>;
  if (p.action !== 'accept' && p.action !== 'challenge') {
    throw new LLMInvalidJSONError(raw, 'bad-action');
  }
  if (typeof p.innerThought !== 'string') {
    throw new LLMInvalidJSONError(raw, 'bad-innerThought');
  }
  return { action: p.action, innerThought: p.innerThought };
}

function validateOwnPlay(
  raw: string,
  parsed: unknown,
  ctx: OwnPlayContext,
): LLMOwnPlayOutput {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new LLMInvalidJSONError(raw, 'not-object');
  }
  const p = parsed as Record<string, unknown>;

  if (
    !Array.isArray(p.cardsToPlay) ||
    !p.cardsToPlay.every((x: unknown) => typeof x === 'string')
  ) {
    throw new LLMInvalidJSONError(raw, 'bad-cardsToPlay');
  }
  if (p.claimCount !== 1 && p.claimCount !== 2) {
    throw new LLMInvalidJSONError(raw, 'bad-claimCount');
  }
  if (typeof p.claimText !== 'string') {
    throw new LLMInvalidJSONError(raw, 'bad-claimText');
  }
  if (p.truthState !== 'honest' && p.truthState !== 'lying') {
    throw new LLMInvalidJSONError(raw, 'bad-truthState');
  }
  if (typeof p.innerThought !== 'string') {
    throw new LLMInvalidJSONError(raw, 'bad-innerThought');
  }

  const cardIds = p.cardsToPlay as string[];
  if (cardIds.length !== p.claimCount) {
    throw new LLMInvalidJSONError(raw, 'count-mismatch');
  }

  const handIds = new Set(ctx.myHand.map(c => c.id));
  for (const id of cardIds) {
    if (!handIds.has(id)) throw new LLMInvalidJSONError(raw, 'card-id-not-in-hand');
  }

  // truthState must agree with actual card ranks
  const cardsById = new Map(ctx.myHand.map(c => [c.id, c]));
  const allTargets = cardIds.every(id => cardsById.get(id)!.rank === ctx.targetRank);
  const derivedTruth = allTargets ? 'honest' : 'lying';
  if (p.truthState !== derivedTruth) {
    throw new LLMInvalidJSONError(raw, 'truth-state-mismatch');
  }

  return {
    cardsToPlay:  cardIds,
    claimCount:   p.claimCount,
    claimText:    p.claimText,
    truthState:   p.truthState,
    innerThought: p.innerThought,
  };
}

// ---------------------------------------------------------------------------
// Core SDK call (single attempt)
// ---------------------------------------------------------------------------

async function callOnce(
  prompt: string,
  schema: object,
  temperature: number,
  signal: AbortSignal,
): Promise<string> {
  const response = await ai.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      temperature,
      abortSignal: signal,
    },
  });
  return response.text ?? '';
}

// ---------------------------------------------------------------------------
// Retry-once wrapper (design.md §4.5)
// Retry fires ONLY on LLMInvalidJSONError, ONCE, using the SAME signal.
// The same AbortSignal is shared across both attempts so the 2 s budget is
// consumed jointly — a slow first attempt leaves less headroom for the retry.
// ---------------------------------------------------------------------------

async function callWithRetry<T>(
  prompt: string,
  schema: object,
  temperature: number,
  signal: AbortSignal,
  validate: (raw: string, parsed: unknown) => T,
): Promise<T> {
  let lastErr: LLMInvalidJSONError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await callOnce(prompt, schema, temperature, signal);
    } catch (err) {
      // Check signal.aborted FIRST — the SDK may throw a generic error when
      // the signal fires; detecting via signal.aborted is the safest approach.
      if (signal.aborted) throw new LLMTimeoutError();
      throw new LLMNetworkError(err);
    }

    try {
      const parsed = JSON.parse(raw);
      return validate(raw, parsed);
    } catch (err) {
      if (err instanceof LLMInvalidJSONError) {
        lastErr = err;
        continue; // retry once
      }
      if (err instanceof SyntaxError) {
        lastErr = new LLMInvalidJSONError(raw, 'parse-failed');
        continue;
      }
      throw err; // unexpected error — propagate immediately
    }
  }

  throw lastErr!; // both attempts returned invalid JSON — brain.ts falls back
}

// ---------------------------------------------------------------------------
// Public call functions (design.md §4.4)
// ---------------------------------------------------------------------------

export async function callLLMJudgment(
  ctx: DecisionContext,
  mathProb: number,
  signal: AbortSignal,
): Promise<LLMJudgmentOutput> {
  const prompt = buildJudgmentPrompt(ctx, mathProb);
  return callWithRetry(prompt, JUDGMENT_SCHEMA, 0.7, signal, validateJudgment);
}

export async function callLLMOwnPlay(
  ctx: OwnPlayContext,
  signal: AbortSignal,
): Promise<LLMOwnPlayOutput> {
  const prompt = buildOwnPlayPrompt(ctx);
  return callWithRetry(
    prompt,
    OWN_PLAY_SCHEMA,
    0.8,
    signal,
    (raw, parsed) => validateOwnPlay(raw, parsed, ctx),
  );
}
