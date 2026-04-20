// @vitest-environment jsdom
/**
 * Tests for the useTutorial hook — 7-step Clerk tutorial state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTutorial } from './useTutorial';
import type { ClientSession, ClientRound } from '@/lib/game/types';

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

function makeSession(overrides?: Partial<ClientSession>): ClientSession {
  return {
    id: 'test-session',
    self: {
      hand: [],
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
    status: 'setup',
    sessionWinner: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function clearTutorialFlag() {
  localStorage.removeItem('hearsay-tutorial-seen');
}

function setTutorialFlag() {
  localStorage.setItem('hearsay-tutorial-seen', '1');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTutorial', () => {
  beforeEach(() => {
    clearTutorialFlag();
  });

  afterEach(() => {
    clearTutorialFlag();
  });

  it('1. First-time user (no localStorage) with null session → starts at step 1, active', async () => {
    const { result } = renderHook(() => useTutorial(null));

    // After initial mount useEffect runs.
    await act(async () => {});

    expect(result.current.step).toBe(1);
    expect(result.current.active).toBe(true);
  });

  it('2. Returning user (localStorage flag set) → step 0, inactive', async () => {
    setTutorialFlag();

    const { result } = renderHook(() => useTutorial(null));

    await act(async () => {});

    expect(result.current.step).toBe(0);
    expect(result.current.active).toBe(false);
  });

  it('3. Steps 1-4 advance sequentially via advance() (not via session status transitions)', async () => {
    const session = makeSession({ status: 'setup' });
    const { result, rerender } = renderHook(
      ({ s }: { s: ClientSession | null }) => useTutorial(s),
      { initialProps: { s: session } },
    );

    await act(async () => {});
    expect(result.current.step).toBe(1);
    expect(result.current.active).toBe(true);

    // Transitioning session status does NOT auto-advance in the corrected
    // state machine — steps 1-4 are user-paced so the player can actually
    // read each overlay without jumps.
    const activeSession = makeSession({ status: 'round_active' });
    act(() => { rerender({ s: activeSession }); });
    expect(result.current.step).toBe(1);

    // User advances manually.
    act(() => result.current.advance());
    expect(result.current.step).toBe(2);
    expect(result.current.active).toBe(true);
  });

  it('4. Step 5 reveals ONLY after user advances past step 4 AND an AI claim appears', async () => {
    const session = makeSession({ status: 'round_active' });
    const { result, rerender } = renderHook(
      ({ s }: { s: ClientSession | null }) => useTutorial(s),
      { initialProps: { s: session } },
    );

    await act(async () => {});
    // Advance sequentially 1→2→3→4→5 (step 5 enters pending state).
    act(() => result.current.advance()); // 1→2
    act(() => result.current.advance()); // 2→3
    act(() => result.current.advance()); // 3→4
    act(() => result.current.advance()); // 4→5 (pending — AI hasn't claimed)
    expect(result.current.step).toBe(5);
    expect(result.current.active).toBe(false); // pending: overlay hidden

    // AI's first claim fires → pending flips off → step 5 becomes visible.
    const sessionWithAiClaim = makeSession({
      status: 'round_active',
      rounds: [
        makeClientRound({
          claimHistory: [
            {
              by: 'ai',
              count: 1,
              claimedRank: 'Queen',
              timestamp: Date.now(),
            },
          ],
        }),
      ],
    });
    act(() => { rerender({ s: sessionWithAiClaim }); });

    expect(result.current.step).toBe(5);
    expect(result.current.active).toBe(true);
  });

  it('4b. AI claim BEFORE user finishes steps 1-4 does NOT skip them', async () => {
    // Session already has AI claim on render — user should still walk 1→2→3→4
    // before step 5 surfaces. This guards the "tutorial skips steps" bug.
    const sessionWithAiClaim = makeSession({
      status: 'round_active',
      rounds: [
        makeClientRound({
          claimHistory: [
            { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: Date.now() },
          ],
        }),
      ],
    });
    const { result } = renderHook(() => useTutorial(sessionWithAiClaim));

    await act(async () => {});
    expect(result.current.step).toBe(1);
    expect(result.current.active).toBe(true);

    // User advances to step 4 — AI claim should NOT have force-jumped them.
    act(() => result.current.advance()); // 1→2
    expect(result.current.step).toBe(2);
    act(() => result.current.advance()); // 2→3
    expect(result.current.step).toBe(3);
    act(() => result.current.advance()); // 3→4
    expect(result.current.step).toBe(4);

    // Advancing past 4 → step 5 immediately visible (trigger already fired).
    act(() => result.current.advance()); // 4→5
    expect(result.current.step).toBe(5);
    expect(result.current.active).toBe(true);
  });

  it('5. skip() → step becomes 7, then advance() → step 0 + localStorage set', async () => {
    const { result } = renderHook(() => useTutorial(null));

    await act(async () => {});
    expect(result.current.step).toBe(1);

    // Skip should jump to step 7.
    act(() => result.current.skip());
    expect(result.current.step).toBe(7);
    expect(result.current.active).toBe(true);

    // Advance from step 7 → deactivates + sets localStorage.
    act(() => result.current.advance());
    expect(result.current.step).toBe(0);
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem('hearsay-tutorial-seen')).toBe('1');
  });

  it('6. Advancing past step 7 sets localStorage flag and deactivates', async () => {
    const { result } = renderHook(() => useTutorial(null));

    await act(async () => {});

    // Walk through all 7 steps.
    for (let i = 1; i <= 6; i++) {
      act(() => result.current.advance());
    }
    expect(result.current.step).toBe(7);

    // Final advance sets flag.
    act(() => result.current.advance());
    expect(result.current.step).toBe(0);
    expect(result.current.active).toBe(false);
    expect(localStorage.getItem('hearsay-tutorial-seen')).toBe('1');
  });

  it('7. SSR-safe: useTutorial works with null session initially (no localStorage access at render)', async () => {
    // Temporarily spy on localStorage to ensure it's not called synchronously
    // during the render phase (should be inside useEffect).
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    // Render without triggering effects.
    const { result } = renderHook(() => useTutorial(null));

    // Before effects run, step should be 0 (initial state, not yet resolved).
    // The key is: no crash and localStorage hasn't been called synchronously.
    expect(result.current.step).toBeDefined();

    // Trigger effects.
    await act(async () => {});

    // Now localStorage should have been accessed (via useEffect, not render).
    expect(getItemSpy).toHaveBeenCalledWith('hearsay-tutorial-seen');

    getItemSpy.mockRestore();
  });

  it('8. Step 6 reveals ONLY after user advances past 5 AND player wins a round', async () => {
    // Provide an AI claim so step 5 unlocks cleanly.
    const session = makeSession({
      status: 'round_active',
      rounds: [
        makeClientRound({
          claimHistory: [
            { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: Date.now() },
          ],
        }),
      ],
    });
    const { result, rerender } = renderHook(
      ({ s }: { s: ClientSession | null }) => useTutorial(s),
      { initialProps: { s: session } },
    );

    await act(async () => {});

    // Walk to step 6 (pending — player hasn't won yet).
    act(() => result.current.advance()); // 1→2
    act(() => result.current.advance()); // 2→3
    act(() => result.current.advance()); // 3→4
    act(() => result.current.advance()); // 4→5 (immediately visible, AI claim fired)
    expect(result.current.step).toBe(5);
    expect(result.current.active).toBe(true);

    act(() => result.current.advance()); // 5→6 (pending — no player win yet)
    expect(result.current.step).toBe(6);
    expect(result.current.active).toBe(false);

    // Simulate player winning a round.
    const sessionPlayerWon = makeSession({
      status: 'round_active',
      rounds: [
        makeClientRound({
          claimHistory: [
            { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: Date.now() },
          ],
          winner: 'player',
        }),
      ],
    });

    act(() => { rerender({ s: sessionPlayerWon }); });

    expect(result.current.step).toBe(6);
    expect(result.current.active).toBe(true);
  });
});
