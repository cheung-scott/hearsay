// @vitest-environment jsdom
//
// §1.5 Elimination-Beat invariants — co-located test module.
// Tests: stinger on strike-3, per-persona final-words, strike-2 CSS dim.
// Supplements GameSession.test.tsx (invariant 12 smoke + pregen reset).

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { ClientSession, ClientRound } from '../../lib/game/types';

// ---------------------------------------------------------------------------
// Browser API stubs
// ---------------------------------------------------------------------------

beforeAll(() => {
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

  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      },
      configurable: true,
    });
  }

  if (!HTMLAudioElement.prototype.play) {
    HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  }

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
    id: 'eb-test-session',
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
// Shared Audio constructor stub.
// useAudioPlayer calls `new Audio()` — must be a real constructor, not arrow fn.
// ---------------------------------------------------------------------------

function makeAudioStub(
  audioSrcs: string[],
  endedCallbacks?: Map<object, () => void>,
): typeof Audio {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function AudioStub(this: any) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    self._src = '';
    self.play = vi.fn().mockResolvedValue(undefined);
    self.pause = vi.fn();
    self.crossOrigin = '';
    self.loop = false;
    self.preload = '';
    self.addEventListener = vi.fn(function (event: string, cb: () => void) {
      if (event === 'ended' && endedCallbacks) endedCallbacks.set(self, cb);
    });
    self.removeEventListener = vi.fn();
    Object.defineProperty(self, 'src', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(this: any) { return this._src as string; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set(this: any, v: string) { this._src = v; audioSrcs.push(v); },
      configurable: true,
    });
  }
  return AudioStub as unknown as typeof Audio;
}

// ---------------------------------------------------------------------------
// §1.5 Invariant: stinger plays exactly once on strike-3 session_over
// ---------------------------------------------------------------------------

describe('§1.5 Elimination-Beat — stinger on strike-3 session_over', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('plays stinger.mp3 when session_over reached via strike-3 (AI wins)', async () => {
    const { GameSession } = await import('./GameSession');
    const audioSrcs: string[] = [];
    vi.stubGlobal('Audio', makeAudioStub(audioSrcs));

    const session: ClientSession = makeClientSession({
      id: 'eb-stinger-1',
      status: 'session_over',
      sessionWinner: 'ai',
      self: { hand: [], takenCards: [], roundsWon: 0, strikes: 3, jokers: [] },
      opponent: {
        handSize: 0, takenCards: [], roundsWon: 0, strikes: 0, jokers: [],
        personaIfAi: 'Reader',
      },
    });

    const { unmount } = render(<GameSession initialSession={session} />);
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });

    expect(audioSrcs.some(s => s.includes('stinger.mp3'))).toBe(true);
    unmount();
  });

  it('does NOT play final-words when AI wins (player hit 3 strikes)', async () => {
    const { GameSession } = await import('./GameSession');
    const audioSrcs: string[] = [];
    vi.stubGlobal('Audio', makeAudioStub(audioSrcs));

    const session: ClientSession = makeClientSession({
      id: 'eb-stinger-2',
      status: 'session_over',
      sessionWinner: 'ai',
      self: { hand: [], takenCards: [], roundsWon: 0, strikes: 3, jokers: [] },
      opponent: {
        handSize: 0, takenCards: [], roundsWon: 0, strikes: 0, jokers: [],
        personaIfAi: 'Novice',
      },
    });

    const { unmount } = render(<GameSession initialSession={session} />);
    // Wait past any FINAL_WORDS_DELAY_MS to confirm nothing fires.
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });

    const finalWordsSrcs = audioSrcs.filter(s => s.includes('final-words'));
    expect(finalWordsSrcs).toHaveLength(0);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// §1.5 Invariant: per-persona final-words when player wins (AI eliminated)
// ---------------------------------------------------------------------------

describe('§1.5 Elimination-Beat — per-persona final-words when player wins', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('queues Misdirector final-words after stinger when AI eliminated', async () => {
    const { GameSession } = await import('./GameSession');
    const audioSrcs: string[] = [];
    const endedCallbacks = new Map<object, () => void>();
    vi.stubGlobal('Audio', makeAudioStub(audioSrcs, endedCallbacks));

    const session: ClientSession = makeClientSession({
      id: 'eb-fw-1',
      status: 'session_over',
      sessionWinner: 'player',
      self: { hand: [], takenCards: [], roundsWon: 2, strikes: 0, jokers: [] },
      opponent: {
        handSize: 0, takenCards: [], roundsWon: 0, strikes: 3, jokers: [],
        personaIfAi: 'Misdirector',
      },
    });

    const { unmount } = render(<GameSession initialSession={session} />);
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });

    // Stinger must play first.
    expect(audioSrcs.some(s => s.includes('stinger.mp3'))).toBe(true);

    // Simulate stinger ended event to chain final-words.
    for (const cb of endedCallbacks.values()) {
      act(() => { cb(); });
    }

    // After FINAL_WORDS_DELAY_MS (1000ms), misdirector clip should be queued.
    await act(async () => { await new Promise(r => setTimeout(r, 1100)); });

    const finalWordsSrcs = audioSrcs.filter(s => s.includes('final-words'));
    expect(finalWordsSrcs.some(s => s.includes('misdirector.mp3'))).toBe(true);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// §1.5 Invariant: strike-2 CSS dim applied to gameplay container
// ---------------------------------------------------------------------------

describe('§1.5 Elimination-Beat — strike-2 CSS dim on gameplay container', () => {
  it('applies brightness(0.85) contrast(1.1) filter when any player has 2+ strikes', async () => {
    const { GameSession } = await import('./GameSession');

    const session: ClientSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
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
        strikes: 2,
        jokers: [],
      },
      opponent: {
        handSize: 5, takenCards: [], roundsWon: 0, strikes: 0, jokers: [],
        personaIfAi: 'Reader',
      },
    });

    const { container } = render(<GameSession initialSession={session} />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    const rootDiv = container.firstChild as HTMLElement;
    expect(rootDiv).toBeTruthy();
    expect(rootDiv.style.filter).toMatch(/brightness\(0\.85\)/);
    expect(rootDiv.style.filter).toMatch(/contrast\(1\.1\)/);
  });

  it('does NOT apply CSS dim filter when max strikes is 0 or 1', async () => {
    const { GameSession } = await import('./GameSession');

    const session: ClientSession = makeClientSession({
      status: 'round_active',
      rounds: [makeClientRound({ status: 'claim_phase', activePlayer: 'player' })],
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
        strikes: 1,
        jokers: [],
      },
      opponent: {
        handSize: 5, takenCards: [], roundsWon: 0, strikes: 0, jokers: [],
        personaIfAi: 'Reader',
      },
    });

    const { container } = render(<GameSession initialSession={session} />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    const rootDiv = container.firstChild as HTMLElement;
    const filterStyle = rootDiv?.style.filter ?? '';
    expect(filterStyle).not.toMatch(/brightness\(0\.85\)/);
  });
});
