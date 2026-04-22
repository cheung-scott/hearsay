// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientRound, ClientSession } from '../../lib/game/types';

vi.mock('@/hooks/useGameSession', () => ({
  useGameSession: vi.fn(),
}));

vi.mock('@/hooks/useAudioPlayer', () => ({
  useAudioPlayer: vi.fn(),
}));

vi.mock('@/hooks/useHoldToSpeak', () => ({
  useHoldToSpeak: vi.fn(() => ({
    state: 'idle',
    audioBlob: null,
    waveformData: [],
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
}));

vi.mock('@/hooks/useTypewriter', () => ({
  useTypewriter: vi.fn(() => ({ displayedText: '', isDone: true })),
}));

vi.mock('@/hooks/useMusicBed', () => ({
  useMusicBed: vi.fn(() => ({
    prime: vi.fn().mockResolvedValue(undefined),
    duckForInput: vi.fn(),
    restoreFromInput: vi.fn(),
    duckForOutput: vi.fn(),
    restoreFromOutput: vi.fn(),
  })),
}));

vi.mock('@/hooks/useTutorial', () => ({
  useTutorial: vi.fn(() => ({
    step: 0,
    active: false,
    advance: vi.fn(),
    skip: vi.fn(),
  })),
}));

vi.mock('./Scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));
vi.mock('./Hud/TopBar', () => ({ TopBar: () => null }));
vi.mock('./PlayerControls/PlayerControls', () => ({ PlayerControls: () => null }));
vi.mock('./Scene/OverlayEffects', () => ({ OverlayEffects: () => null }));
vi.mock('./PlayerControls/JokerTray', () => ({ JokerTray: () => null }));
vi.mock('./Scene/JokerPicker', () => ({ JokerPicker: () => null }));
vi.mock('./Scene/ProbeReveal', () => ({ ProbeReveal: () => null }));
vi.mock('./Scene/AutopsyOverlay', () => ({ AutopsyOverlay: () => null }));
vi.mock('./Scene/ClerkTutorial', () => ({ ClerkTutorial: () => null }));
vi.mock('./Scene/OutcomeBanners', () => ({
  YouPlayedBanner: () => null,
  ChallengeOutcomeBanner: () => null,
}));

import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useGameSession } from '@/hooks/useGameSession';
import { GameSession } from './GameSession';

function makeRound(overrides?: Partial<ClientRound>): ClientRound {
  return {
    roundNumber: 1,
    targetRank: 'Queen',
    activePlayer: 'ai',
    pileSize: 0,
    claimHistory: [],
    status: 'claim_phase',
    activeJokerEffects: [],
    tensionLevel: 0,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<ClientSession>): ClientSession {
  return {
    id: 'pacing-session',
    self: {
      hand: [{ id: 'Queen-0', rank: 'Queen' }],
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
      jokerSlots: [],
    },
    opponent: {
      handSize: 5,
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
      jokerSlots: [],
      personaIfAi: 'Novice',
    },
    rounds: [makeRound()],
    currentRoundIdx: 0,
    status: 'round_active',
    sessionWinner: undefined,
    currentMusicUrl: undefined,
    musicTracks: [],
    ...overrides,
  };
}

describe('GameSession pacing', () => {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const responseEndedCallbacks: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    responseEndedCallbacks.length = 0;
    dispatch.mockClear();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tracks: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    vi.mocked(useAudioPlayer).mockReturnValue({
      play: vi.fn(),
      isPlaying: false,
      onEnded: vi.fn((cb: () => void) => {
        responseEndedCallbacks.push(cb);
      }),
    });

    vi.mocked(useGameSession).mockReturnValue({
      state: {
        session: makeSession(),
        phase: 'awaiting-ai',
        lastAiResponseAudioUrl: 'data:audio/mpeg;base64,verdict',
        lastAiResponseText: 'LIAR.',
      },
      dispatch,
      selectedCardIds: new Set(),
      toggleCardSelection: vi.fn(),
      markAudioEnded: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for verdict audio plus breather before auto-firing AiAct', async () => {
    render(<GameSession />);

    await act(async () => {});

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'AiAct' });
    expect(responseEndedCallbacks).toHaveLength(1);

    await act(async () => {
      responseEndedCallbacks[0]();
      vi.advanceTimersByTime(1399);
    });

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'AiAct' });

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'AiAct' });
  });
});
