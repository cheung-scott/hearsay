// @vitest-environment jsdom
//
// Invariant 12 smoke test — GameSession renders without crashing when given
// an initial ClientSession in round_active / claim_phase.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import type { ClientSession, ClientRound } from '../../lib/game/types';

// ---------------------------------------------------------------------------
// Minimal browser API stubs (jsdom doesn't have AudioContext / MediaRecorder)
// ---------------------------------------------------------------------------

beforeAll(() => {
  // AudioContext stub
  if (!('AudioContext' in globalThis)) {
    const analyserStub = {
      connect: vi.fn(),
      getByteTimeDomainData: vi.fn(),
      frequencyBinCount: 128,
    };
    const sourceStub = { connect: vi.fn() };
    const ctxStub = {
      createAnalyser: () => analyserStub,
      createMediaStreamSource: () => sourceStub,
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('AudioContext', vi.fn(() => ctxStub));
  }

  // MediaRecorder stub
  if (!('MediaRecorder' in globalThis)) {
    const mrStub = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null as null | ((e: { data: { size: number } }) => void),
      onstop: null as null | (() => void),
      state: 'inactive',
    };
    vi.stubGlobal('MediaRecorder', vi.fn(() => mrStub));
  }

  // navigator.mediaDevices stub
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [],
        }),
      },
      configurable: true,
    });
  }

  // HTMLAudioElement.prototype.play stub (jsdom doesn't implement it)
  if (!HTMLAudioElement.prototype.play) {
    HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  }

  // fetch stub — GameSession may attempt CreateSession on mount if no initialSession;
  // since we pass initialSession, this shouldn't be hit, but stub defensively.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ session: makeClientSession() }),
    }),
  );
});

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
    id: 'smoke-test-session',
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
      personaIfAi: 'Reader',
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
// Invariant 12 — smoke test
// ---------------------------------------------------------------------------

describe('GameSession — invariant 12 smoke test', () => {
  it('renders without crash when given an initial session in round_active/claim_phase', async () => {
    // Dynamic import so vi.stubGlobal has already run in beforeAll.
    const { GameSession } = await import('./GameSession');

    const initialSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
    });

    const { container, getByText } = render(
      <GameSession initialSession={initialSession} />,
    );

    // Component rendered something.
    expect(container).toBeDefined();
    expect(container.firstChild).not.toBeNull();

    // Target tag visible — contains "CALL" (from TargetTag).
    const callElement = getByText(/CALL/i);
    expect(callElement).toBeTruthy();

    // Player hand cards visible — rank letters rendered in the card faces.
    // Cards render rank letters; check that rank text appears somewhere.
    const rankText = container.textContent ?? '';
    expect(rankText).toMatch(/Q|K|A|J/);
  });
});
