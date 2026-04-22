// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ClientSession, ClientRound } from '../lib/game/types';
import { useGameSession, derivePhase, type GamePhase } from './useGameSession';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeClientRound(overrides?: Partial<ClientRound>): ClientRound {
  return {
    roundNumber: 1,
    targetRank: 'Queen',
    activePlayer: 'player',
    pileSize: 0,
    claimHistory: [],
    status: 'claim_phase',
    activeJokerEffects: [],
    tensionLevel: 0,
    winner: undefined,
    ...overrides,
  };
}

function makeClientSession(overrides?: Partial<ClientSession>): ClientSession {
  return {
    id: 'test-session-id',
    self: {
      hand: [
        { id: 'Queen-0', rank: 'Queen' },
        { id: 'King-0', rank: 'King' },
        { id: 'Ace-0', rank: 'Ace' },
        { id: 'Jack-0', rank: 'Jack' },
        { id: 'King-1', rank: 'King' },
      ],
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
    },
    opponent: {
      handSize: 5,
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
    },
    rounds: [makeClientRound()],
    currentRoundIdx: 0,
    status: 'round_active',
    sessionWinner: undefined,
    currentMusicUrl: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Invariant 1 — Phase derivation table
// ---------------------------------------------------------------------------

describe('derivePhase — phase gate table', () => {
  it.each<{
    label: string;
    session: ClientSession | null;
    audioUrl?: string;
    expected: GamePhase;
  }>([
    {
      label: 'null session → idle',
      session: null,
      expected: 'idle',
    },
    {
      label: 'session_over → session-over',
      session: makeClientSession({ status: 'session_over' }),
      expected: 'session-over',
    },
    {
      label: 'joker_offer → joker-offer',
      session: makeClientSession({ status: 'joker_offer' }),
      expected: 'joker-offer',
    },
    {
      label: 'round_active + claim_phase + activePlayer=player → recording',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
      }),
      expected: 'recording',
    },
    {
      label: 'round_active + claim_phase + activePlayer=ai → awaiting-ai',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'ai' })],
      }),
      expected: 'awaiting-ai',
    },
    {
      label: 'round_active + response_phase + audioUrl set → playing-ai-audio',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'response_phase', activePlayer: 'player' })],
      }),
      audioUrl: 'https://example.com/audio.mp3',
      expected: 'playing-ai-audio',
    },
    {
      label: 'round_active + response_phase + no audioUrl → awaiting-player-response',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'response_phase', activePlayer: 'player' })],
      }),
      audioUrl: undefined,
      expected: 'awaiting-player-response',
    },
    // H-H4 / H-H6: resolving + round_over must not fall through to idle
    {
      label: 'round_active + resolving → awaiting-ai (H-H4)',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'resolving', activePlayer: 'player' })],
      }),
      expected: 'awaiting-ai',
    },
    {
      label: 'round_active + round_over → awaiting-ai (H-H4)',
      session: makeClientSession({
        status: 'round_active',
        rounds: [makeClientRound({ status: 'round_over', activePlayer: 'player' })],
      }),
      expected: 'awaiting-ai',
    },
    {
      label: 'round_active + setup (empty rounds) → idle',
      session: makeClientSession({
        status: 'round_active',
        rounds: [],
        currentRoundIdx: 0,
      }),
      expected: 'idle',
    },
  ])('$label', ({ session, audioUrl, expected }) => {
    expect(derivePhase(session, audioUrl)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2 — dispatch issues exactly one fetch
// ---------------------------------------------------------------------------

describe('useGameSession — dispatch issues fetch', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ session: makeClientSession() }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatch PlayerRespond calls POST /api/turn exactly once with correct body (sessionId threaded)', async () => {
    const initial = makeClientSession();
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.dispatch({ type: 'PlayerRespond', action: 'challenge' });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'PlayerRespond',
        sessionId: initial.id,
        action: 'challenge',
      }),
    });
  });

  it('dispatch CreateSession calls POST /api/session', async () => {
    const { result } = renderHook(() => useGameSession());

    await act(async () => {
      await result.current.dispatch({ type: 'CreateSession' });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ...unknown[]];
    expect(calledUrl).toBe('/api/session');
  });

  it('dispatch ResetSession returns to idle without fetching', async () => {
    const initial = makeClientSession({ status: 'session_over', sessionWinner: 'ai' });
    const { result } = renderHook(() => useGameSession(initial));

    await act(async () => {
      await result.current.dispatch({ type: 'ResetSession' });
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.state.session).toBeNull();
    expect(result.current.state.phase).toBe('idle');
  });

  // H-I2: assert that PlayerClaim dispatch threads sessionId into the body
  // (catches the CreateSession drift CRITICAL: a missing sessionId 400s silently)
  it('dispatch PlayerClaim includes sessionId in POST body (H-I2)', async () => {
    const initial = makeClientSession({ id: 'claim-session-id' });
    const { result } = renderHook(() => useGameSession(initial));

    const fakeCard = initial.self.hand[0];
    const fakeBlob = new Blob(['audio-data'], { type: 'audio/webm' });

    await act(async () => {
      await result.current.dispatch({
        type: 'PlayerClaim',
        cards: [fakeCard],
        audio: fakeBlob,
        claimText: '1 Queen',
      });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/api/turn');
    const body = JSON.parse(calledInit.body as string);
    expect(body.sessionId).toBe('claim-session-id');
    expect(body.type).toBe('PlayerClaim');
    expect(Array.isArray(body.cards)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3 — fetch failure surfaces error without advancing phase
// ---------------------------------------------------------------------------

describe('useGameSession — fetch failure surfaces error', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('network rejection populates state.error and leaves phase unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network-fail')),
    );

    const { result } = renderHook(() => useGameSession());

    const initialPhase = result.current.state.phase;

    await act(async () => {
      await result.current.dispatch({ type: 'PlayerRespond', action: 'accept' });
    });

    expect(result.current.state.error).toContain('network-fail');
    expect(result.current.state.phase).toBe(initialPhase);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5 — card selection resets when phase exits recording
// ---------------------------------------------------------------------------

describe('useGameSession — card selection resets on phase change', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selection clears when phase transitions from recording to another phase', async () => {
    // First response: put us in recording phase (player turn, claim_phase).
    const recordingSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
    });

    // Second response: move us to awaiting-ai (ai turn, claim_phase).
    const awaitingAiSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'ai' })],
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ session: recordingSession }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ session: awaitingAiSession }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useGameSession());

    // First dispatch → recording phase.
    await act(async () => {
      await result.current.dispatch({ type: 'AiAct' });
    });

    expect(result.current.state.phase).toBe('recording');

    // Select a card.
    act(() => {
      result.current.toggleCardSelection('Queen-0');
    });

    expect(result.current.selectedCardIds.has('Queen-0')).toBe(true);

    // Second dispatch → awaiting-ai phase.
    await act(async () => {
      await result.current.dispatch({ type: 'AiAct' });
    });

    expect(result.current.state.phase).toBe('awaiting-ai');
    expect(result.current.selectedCardIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H-H7 — concurrent-dispatch race: stale response is dropped
// ---------------------------------------------------------------------------

describe('useGameSession — concurrent dispatch race (H-H7)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a stale response does not overwrite state when a newer dispatch completes first', async () => {
    // Slow response for dispatch-1 (resolves after dispatch-2 completes).
    // Fast response for dispatch-2.
    let resolveSlowFetch!: (value: unknown) => void;
    const slowPromise = new Promise(r => { resolveSlowFetch = r; });

    const staleSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'ai' })],
    });
    const freshSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
    });

    const fetchMock = vi.fn()
      .mockImplementationOnce(() => slowPromise.then(() => ({
        ok: true,
        json: async () => ({ session: staleSession }),
      })))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ session: freshSession }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useGameSession());

    // Fire dispatch-1 (will hang).
    const d1 = result.current.dispatch({ type: 'AiAct' });

    // Fire dispatch-2 immediately (wins the seq race).
    await act(async () => {
      await result.current.dispatch({ type: 'AiAct' });
    });

    // Now let dispatch-1's slow fetch resolve.
    act(() => { resolveSlowFetch(undefined); });
    await act(async () => { await d1; });

    // The stale (awaiting-ai) response from dispatch-1 must NOT overwrite
    // the fresh (recording) state set by dispatch-2.
    expect(result.current.state.phase).toBe('recording');
  });
});

// ---------------------------------------------------------------------------
// Extra — lastClaimAudioUrl + lastClaimText populated from aiClaim in response
// ---------------------------------------------------------------------------

describe('useGameSession — aiClaim response populates audio/text', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lastClaimAudioUrl and lastClaimText are set from response aiClaim', async () => {
    const responseSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'response_phase', activePlayer: 'player' })],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          session: responseSession,
          aiClaim: {
            claimText: 'I claim two Queens.',
            ttsAudioUrl: 'https://example.com/tts/claim.mp3',
            persona: 'Reader',
          },
        }),
      }),
    );

    const { result } = renderHook(() => useGameSession());

    await act(async () => {
      await result.current.dispatch({ type: 'AiAct' });
    });

    expect(result.current.state.lastClaimAudioUrl).toBe(
      'https://example.com/tts/claim.mp3',
    );
    expect(result.current.state.lastClaimText).toBe('I claim two Queens.');
    // Phase should be playing-ai-audio since audioUrl is set and round is response_phase.
    expect(result.current.state.phase).toBe('playing-ai-audio');
  });
});
