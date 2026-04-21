// route.test.ts — API invariants 8, 9, 10, 11 for POST /api/turn.
// Mocks: session store, ai brain, voice STT, ElevenLabs SDK.
// Real FSM (reduce), toClientView, parseClaim, buildContexts run as-is.

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — MUST be declared before any imports (vi.mock is hoisted).
// ---------------------------------------------------------------------------

vi.mock('@/lib/session/store', () => {
  const get = vi.fn();
  const set = vi.fn();
  const deleteFn = vi.fn();
  (globalThis as Record<string, unknown>).__storeGet = get;
  (globalThis as Record<string, unknown>).__storeSet = set;
  (globalThis as Record<string, unknown>).__storeDelete = deleteFn;
  return { get, set, delete: deleteFn };
});

vi.mock('@/lib/ai/brain', () => {
  const aiDecideOnClaim = vi.fn();
  const aiDecideOwnPlay = vi.fn();
  (globalThis as Record<string, unknown>).__aiDecideOnClaim = aiDecideOnClaim;
  (globalThis as Record<string, unknown>).__aiDecideOwnPlay = aiDecideOwnPlay;
  return { aiDecideOnClaim, aiDecideOwnPlay };
});

vi.mock('@/lib/voice/stt', () => ({
  computeVoiceMetaFromAudio: vi.fn().mockResolvedValue({
    transcript: 'One Queen.',
    latencyMs: 1200,
    fillerCount: 0,
    pauseCount: 0,
    speechRateWpm: 180,
    lieScore: 0.2,
    audioDurationSecs: 3,
  }),
}));

vi.mock('@elevenlabs/elevenlabs-js', () => {
  // Shared spy stored on globalThis so it survives hoisting and every
  // `new ElevenLabsClient()` call in the route returns the same instance.
  const ttsConvert = vi.fn();
  const sttConvert = vi.fn().mockResolvedValue({
    text: 'One Queen.',
    words: [],
    audioDurationSecs: 3,
  });

  // Default TTS implementation: return a minimal async-iterable.
  ttsConvert.mockImplementation(() =>
    (async function* () {
      yield new Uint8Array([0x00]);
    })(),
  );

  (globalThis as Record<string, unknown>).__ttsConvertSpy = ttsConvert;

  // IMPORTANT: ElevenLabsClient must be a regular function (not arrow) so
  // it is new-able. Return the same instance shape every time so spies are shared.
  function ElevenLabsClient() {
    return {
      textToSpeech: { convert: ttsConvert },
      speechToText: { convert: sttConvert },
    };
  }

  return { ElevenLabsClient };
});

// Env guards — must be set before module load.
process.env.ELEVENLABS_API_KEY = 'test-key';
process.env.GEMINI_API_KEY = 'test-key';

// ---------------------------------------------------------------------------
// Imports — after all mocks.
// ---------------------------------------------------------------------------

import { POST } from './route';
import type { Session } from '@/lib/game/types';
import { VOICE_PRESETS } from '@/lib/voice/presets';

// ---------------------------------------------------------------------------
// Retrieve spy references from globalThis (set by vi.mock factories).
// ---------------------------------------------------------------------------

const storeGet = () =>
  (globalThis as Record<string, unknown>).__storeGet as ReturnType<typeof vi.fn>;
const storeSet = () =>
  (globalThis as Record<string, unknown>).__storeSet as ReturnType<typeof vi.fn>;
const aiDecideOnClaimSpy = () =>
  (globalThis as Record<string, unknown>).__aiDecideOnClaim as ReturnType<typeof vi.fn>;
const aiDecideOwnPlaySpy = () =>
  (globalThis as Record<string, unknown>).__aiDecideOwnPlay as ReturnType<typeof vi.fn>;
const ttsConvertSpy = () =>
  (globalThis as Record<string, unknown>).__ttsConvertSpy as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Session fixture factories
// ---------------------------------------------------------------------------

/** Build a minimal valid Session seeded for a specific scenario. */
function makeSession(overrides: {
  activePlayer: 'player' | 'ai';
  roundStatus: 'claim_phase' | 'response_phase';
  persona?: 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
  playerHand?: Session['player']['hand'];
  aiHand?: Session['ai']['hand'];
}): Session {
  const {
    activePlayer,
    roundStatus,
    persona = 'Reader',
    playerHand = [
      { id: 'Q-0', rank: 'Queen' },
      { id: 'Q-1', rank: 'Queen' },
      { id: 'K-0', rank: 'King' },
      { id: 'A-0', rank: 'Ace' },
      { id: 'J-0', rank: 'Jack' },
    ],
    aiHand = [
      { id: 'Q-2', rank: 'Queen' },
      { id: 'Q-3', rank: 'Queen' },
      { id: 'K-1', rank: 'King' },
      { id: 'A-1', rank: 'Ace' },
      { id: 'J-1', rank: 'Jack' },
    ],
  } = overrides;

  const playerState = {
    hand: playerHand,
    takenCards: [],
    roundsWon: 0,
    strikes: 0,
    jokers: [],
  } satisfies Session['player'];

  const aiState = {
    hand: aiHand,
    takenCards: [],
    roundsWon: 0,
    strikes: 0,
    jokers: [],
    personaIfAi: persona,
  } satisfies Session['ai'];

  // For response_phase we need a claim in history and pile must have cards.
  const claimHistory =
    roundStatus === 'response_phase'
      ? [
          {
            by: activePlayer === 'player' ? 'player' : 'ai',
            count: 1,
            claimedRank: 'Queen' as const,
            actualCardIds: ['Q-0'],
            truthState: 'honest' as const,
            claimText: 'One Queen.',
            timestamp: 0,
          } satisfies Session['rounds'][number]['claimHistory'][number],
        ]
      : [];

  const pile =
    roundStatus === 'response_phase'
      ? [{ id: 'Q-0', rank: 'Queen' as const }]
      : [];

  // In response_phase the active player's hand has already had Q-0 removed.
  const adjustedPlayerState =
    roundStatus === 'response_phase' && activePlayer === 'player'
      ? {
          ...playerState,
          hand: playerHand.filter((c) => c.id !== 'Q-0'),
        }
      : playerState;

  return {
    id: 'test-id',
    status: 'round_active',
    player: adjustedPlayerState,
    ai: aiState,
    deck: [],
    currentRoundIdx: 0,
    rounds: [
      {
        roundNumber: 1,
        targetRank: 'Queen',
        activePlayer,
        pile,
        claimHistory,
        status: roundStatus,
        activeJokerEffects: [],
        tensionLevel: 0.1,
      },
    ],
    musicTracks: [
      { level: 'calm', url: 'calm.mp3' },
      { level: 'tense', url: 'tense.mp3' },
      { level: 'critical', url: 'critical.mp3' },
    ],
    sessionWinner: undefined,
  };
}

/** POST helper — wraps a plain-object body in a Next.js-compatible Request. */
function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Recursive helper — scan for `actualCardIds` anywhere in a plain-JS value.
// ---------------------------------------------------------------------------

function hasActualCardIdsDeep(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) {
    return value.some(hasActualCardIdsDeep);
  }
  const obj = value as Record<string, unknown>;
  if ('actualCardIds' in obj) return true;
  return Object.values(obj).some(hasActualCardIdsDeep);
}

// ---------------------------------------------------------------------------
// Reset mocks between tests.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: store.set resolves silently.
  storeSet().mockResolvedValue(undefined);
});

// ===========================================================================
// Invariant 8 — reject invalid card IDs
// ===========================================================================

describe('Invariant 8 — reject invalid card IDs', () => {
  it('returns 400 when a card ID is not in the player hand', async () => {
    const session = makeSession({ activePlayer: 'player', roundStatus: 'claim_phase' });
    storeGet().mockResolvedValue(session);

    const req = post({
      type: 'PlayerClaim',
      sessionId: 'test-id',
      cards: [{ id: 'NOT-IN-HAND' }],
      audioBase64: 'dGVzdA==',
      claimText: 'One Queen.',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    // Session must NOT be persisted.
    expect(storeSet()).not.toHaveBeenCalled();
  });

  it('returns 400 with zero cards (empty cards array)', async () => {
    const session = makeSession({ activePlayer: 'player', roundStatus: 'claim_phase' });
    storeGet().mockResolvedValue(session);

    const req = post({
      type: 'PlayerClaim',
      sessionId: 'test-id',
      cards: [],
      audioBase64: 'dGVzdA==',
      claimText: 'One Queen.',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
    expect(storeSet()).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Invariant 9 — chain AI judgment inline
// ===========================================================================

describe('Invariant 9 — chain AI judgment inline (PlayerClaim)', () => {
  it('response body includes aiDecision with action + innerThought, and aiDecideOnClaim was called', async () => {
    const session = makeSession({ activePlayer: 'player', roundStatus: 'claim_phase' });
    storeGet().mockResolvedValue(session);

    aiDecideOnClaimSpy().mockResolvedValue({
      action: 'accept',
      innerThought: 'Seems fine to me.',
      voiceline: 'Proceed.',
      source: 'llm',
      latencyMs: 42,
      mathProb: 0.3,
    });

    const req = post({
      type: 'PlayerClaim',
      sessionId: 'test-id',
      // Q-0 is a valid Queen in the player hand (targetRank is Queen → honest play).
      cards: [{ id: 'Q-0' }],
      audioBase64: 'dGVzdA==',
      claimText: 'One Queen.',
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(aiDecideOnClaimSpy()).toHaveBeenCalledOnce();

    expect(body).toHaveProperty('aiDecision');
    const aiDecision = body.aiDecision as { action: string; innerThought: string };
    expect(aiDecision.action).toBe('accept');
    expect(aiDecision.innerThought).toBe('Seems fine to me.');
  });
});

// ===========================================================================
// Invariant 10 — TTS preset selected from persona + truthState
// ===========================================================================

describe('Invariant 10 — TTS preset selected from persona + truthState (AiAct)', () => {
  it('calls ElevenLabs convert with voice settings matching VOICE_PRESETS[Reader][honest]', async () => {
    const session = makeSession({
      activePlayer: 'ai',
      roundStatus: 'claim_phase',
      persona: 'Reader',
    });
    storeGet().mockResolvedValue(session);

    // aiDecideOwnPlay returns an honest play using the AI's first hand card.
    const aiHandCard = session.ai.hand[0]; // Q-2 (Queen)
    aiDecideOwnPlaySpy().mockResolvedValue({
      cardsToPlay: [aiHandCard],
      claim: { count: 1, rank: 'Queen' },
      truthState: 'honest',
      claimText: 'One Queen, of course.',
      innerThought: 'Easy.',
      source: 'llm',
      latencyMs: 30,
    });

    const req = post({ type: 'AiAct', sessionId: 'test-id' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(aiDecideOwnPlaySpy()).toHaveBeenCalledOnce();

    // Verify the TTS spy was called with voice settings from VOICE_PRESETS.Reader.honest.
    const convertSpy = ttsConvertSpy();
    expect(convertSpy).toHaveBeenCalledOnce();

    const [_voiceId, convertArgs] = convertSpy.mock.calls[0] as [
      string,
      { text: string; voiceSettings: { stability: number; similarityBoost: number; style: number; speed: number } },
    ];

    const expected = VOICE_PRESETS['Reader']['honest'];
    expect(convertArgs.voiceSettings).toMatchObject({
      stability: expected.stability,
      similarityBoost: expected.similarity_boost,
      style: expected.style,
      speed: expected.speed,
    });
  });
});

// ===========================================================================
// Invariant 11 — toClientView applied on every response
// ===========================================================================

describe('Invariant 11 — toClientView on every response type', () => {
  it('PlayerClaim: session has no actualCardIds, opponent has handSize not hand array', async () => {
    const session = makeSession({ activePlayer: 'player', roundStatus: 'claim_phase' });
    storeGet().mockResolvedValue(session);

    aiDecideOnClaimSpy().mockResolvedValue({
      action: 'accept',
      innerThought: 'Looks good.',
      voiceline: 'Acknowledged.',
      source: 'llm',
      latencyMs: 20,
      mathProb: 0.5,
    });

    const req = post({
      type: 'PlayerClaim',
      sessionId: 'test-id',
      cards: [{ id: 'Q-0' }],
      audioBase64: 'dGVzdA==',
      claimText: 'One Queen.',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Record<string, unknown> };

    expect(hasActualCardIdsDeep(body.session)).toBe(false);
    expect(body.session).toHaveProperty('opponent');
    const opponent = body.session.opponent as Record<string, unknown>;
    expect(typeof opponent.handSize).toBe('number');
    expect(opponent).not.toHaveProperty('hand');
    // self.hand must be present (player sees own cards).
    const self = body.session.self as Record<string, unknown>;
    expect(Array.isArray(self.hand)).toBe(true);
  });

  it('PlayerRespond: session has no actualCardIds, opponent has handSize not hand array', async () => {
    // response_phase with activePlayer player so ClaimAccepted is valid.
    const session = makeSession({ activePlayer: 'player', roundStatus: 'response_phase' });
    storeGet().mockResolvedValue(session);

    const req = post({
      type: 'PlayerRespond',
      sessionId: 'test-id',
      action: 'accept',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Record<string, unknown> };

    expect(hasActualCardIdsDeep(body.session)).toBe(false);
    const opponent = body.session.opponent as Record<string, unknown>;
    expect(typeof opponent.handSize).toBe('number');
    expect(opponent).not.toHaveProperty('hand');
    const self = body.session.self as Record<string, unknown>;
    expect(Array.isArray(self.hand)).toBe(true);
  });

  it('AiAct: session has no actualCardIds, opponent has handSize not hand array', async () => {
    const session = makeSession({
      activePlayer: 'ai',
      roundStatus: 'claim_phase',
      persona: 'Reader',
    });
    storeGet().mockResolvedValue(session);

    const aiHandCard = session.ai.hand[0];
    aiDecideOwnPlaySpy().mockResolvedValue({
      cardsToPlay: [aiHandCard],
      claim: { count: 1, rank: 'Queen' },
      truthState: 'honest',
      claimText: 'One Queen.',
      innerThought: 'Easy.',
      source: 'llm',
      latencyMs: 25,
    });

    const req = post({ type: 'AiAct', sessionId: 'test-id' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Record<string, unknown> };

    expect(hasActualCardIdsDeep(body.session)).toBe(false);
    const opponent = body.session.opponent as Record<string, unknown>;
    expect(typeof opponent.handSize).toBe('number');
    expect(opponent).not.toHaveProperty('hand');
    const self = body.session.self as Record<string, unknown>;
    expect(Array.isArray(self.hand)).toBe(true);
  });
});
