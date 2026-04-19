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
      label: 'joker_offer → round-over',
      session: makeClientSession({ status: 'joker_offer' }),
      expected: 'round-over',
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

  it('dispatch PlayerRespond calls POST /api/turn exactly once with correct body', async () => {
    const { result } = renderHook(() => useGameSession());

    await act(async () => {
      await result.current.dispatch({ type: 'PlayerRespond', action: 'challenge' });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'PlayerRespond', action: 'challenge' }),
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
