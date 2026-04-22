// @vitest-environment jsdom
//
// Gauntlet-specific tests for GameSession (Option B localStorage progression).
//
// Covers:
// 1. session_over + player wins + Novice persona → localStorage has Novice in defeated
// 2. re-mount after Novice defeated → preferredPersona passed to next CreateSession is 'Reader'

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import type { ClientSession, ClientRound } from '../../lib/game/types';
import { __PROGRESS_INTERNAL } from '../../lib/game/progress';

const KEY = __PROGRESS_INTERNAL.LOCALSTORAGE_KEY;

// ---------------------------------------------------------------------------
// Browser API stubs (jsdom doesn't have AudioContext / MediaRecorder)
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
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
      configurable: true,
    });
  }

  // Stub HTMLAudioElement play/pause (jsdom doesn't implement them).
  if (!HTMLAudioElement.prototype.play) {
    HTMLAudioElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  }
  if (!HTMLAudioElement.prototype.pause) {
    HTMLAudioElement.prototype.pause = vi.fn();
  }

  // Override Audio constructor — jsdom provides a broken stub that doesn't implement
  // play() as a promise. Replace it with a working mock.
  vi.stubGlobal('Audio', vi.fn(() => ({
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    src: '',
  })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
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
    id: 'gauntlet-test-session',
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
      personaIfAi: 'Novice',
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
// Test 1: session_over + player wins + Novice persona → Novice in defeated
// ---------------------------------------------------------------------------

describe('GameSession gauntlet — save-on-win', () => {
  it('writes Novice to localStorage when player wins a session with Novice persona', async () => {
    // Ensure localStorage starts clean.
    localStorage.clear();

    // Stub fetch to return a music/pregen empty tracks response.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/music/pregen')) {
          return new Response(JSON.stringify({ tracks: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }) as Response;
        }
        return new Response(JSON.stringify({ session: makeClientSession() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }) as Response;
      }),
    );

    const { GameSession } = await import('./GameSession');

    // Provide a session_over ClientSession where player won against Novice.
    // Keep strikes < 3 to avoid triggering the stinger audio path (which needs
    // a real HTMLAudioElement, not available in jsdom without extra setup).
    const sessionOver = makeClientSession({
      id: 'session-novice-win',
      status: 'session_over',
      sessionWinner: 'player',
      opponent: {
        handSize: 0,
        takenCards: [],
        roundsWon: 2, // won via rounds, not strikes
        strikes: 2,   // below 3 to skip stinger path
        jokers: [],
        personaIfAi: 'Novice',
      },
    });

    await act(async () => {
      render(<GameSession initialSession={sessionOver} />);
      // Allow useEffects to flush.
      await new Promise(r => setTimeout(r, 20));
    });

    // Check localStorage was updated.
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.defeated).toContain('Novice');
  });

  it('does NOT write to localStorage when AI wins (player loses)', async () => {
    localStorage.clear();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/music/pregen')) {
          return new Response(JSON.stringify({ tracks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
        }
        return new Response(JSON.stringify({ session: makeClientSession() }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
      }),
    );

    const { GameSession } = await import('./GameSession');

    const sessionOver = makeClientSession({
      id: 'session-ai-win',
      status: 'session_over',
      sessionWinner: 'ai',
      self: {
        hand: [],
        takenCards: [],
        roundsWon: 0,
        strikes: 2, // < 3 to avoid stinger path
        jokers: [],
      },
      opponent: {
        handSize: 0,
        takenCards: [],
        roundsWon: 2, // AI won by rounds
        strikes: 0,
        jokers: [],
        personaIfAi: 'Novice',
      },
    });

    await act(async () => {
      render(<GameSession initialSession={sessionOver} />);
      await new Promise(r => setTimeout(r, 20));
    });

    // localStorage should NOT have been written (no player win).
    const raw = localStorage.getItem(KEY);
    expect(raw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: re-mount after Novice defeated → preferredPersona sent as 'Reader'
// ---------------------------------------------------------------------------

describe('GameSession gauntlet — preferredPersona routing after re-mount', () => {
  // Hackathon build (2026-04-22): GameSession now clears gauntlet progress +
  // tutorial flag on mount so every hard-refresh lands on the tutorial against
  // the Defendant (Novice). Persisted-across-refresh behaviour returns
  // post-event; this test asserts the current hackathon-mode reset.
  it('ignores seeded Novice-defeated progress on mount and targets Novice (hackathon reset)', async () => {
    // Seed localStorage with Novice defeated — GameSession should wipe this on mount.
    localStorage.setItem(KEY, JSON.stringify({ defeated: ['Novice'] }));

    const createSessionCalls: Array<{ preferredPersona?: string }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/music/pregen')) {
          return new Response(JSON.stringify({ tracks: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
        }
        if (url.includes('/api/session')) {
          try {
            const body = JSON.parse((init?.body as string) ?? '{}');
            createSessionCalls.push({ preferredPersona: body.preferredPersona });
          } catch { /* noop */ }
        }
        return new Response(JSON.stringify({ session: makeClientSession() }), { status: 200, headers: { 'content-type': 'application/json' } }) as Response;
      }),
    );

    const { GameSession } = await import('./GameSession');

    // Render with no initialSession → component shows idle "BEGIN TRIAL" screen.
    let container!: HTMLElement;
    await act(async () => {
      const result = render(<GameSession />);
      container = result.container;
      await new Promise(r => setTimeout(r, 10));
    });

    // After mount, localStorage progress key should be cleared.
    expect(localStorage.getItem(KEY)).toBeNull();

    // Click BEGIN TRIAL to fire CreateSession with the current preferredPersona.
    await act(async () => {
      const btn = container.querySelector('button');
      expect(btn).not.toBeNull();
      fireEvent.click(btn!);
      await new Promise(r => setTimeout(r, 30));
    });

    // The CreateSession call should target Novice (first in gauntlet), since
    // mount reset wiped the seeded Novice-defeated progress.
    expect(createSessionCalls.length).toBeGreaterThan(0);
    const call = createSessionCalls.find(c => c.preferredPersona === 'Novice');
    expect(call).toBeDefined();
    expect(call?.preferredPersona).toBe('Novice');
  });
});
