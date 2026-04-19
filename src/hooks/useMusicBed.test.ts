// @vitest-environment jsdom
//
// Tension-music-system spec §9 invariants I1, I2, I3, I5, I6, I7, I10.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMusicBed } from './useMusicBed';
import type { MusicTrack } from '@/lib/game/types';
import { DUCK_GAIN, BASE_GAIN, DUCK_FADE_MS, CROSSFADE_MS } from '@/lib/music/tension';

// ---------------------------------------------------------------------------
// Web Audio mocks
// ---------------------------------------------------------------------------

interface MockGainNode {
  gain: {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

interface MockAudioContext {
  state: 'running' | 'suspended' | 'closed';
  currentTime: number;
  destination: object;
  createGain: () => MockGainNode;
  createMediaElementSource: () => { connect: ReturnType<typeof vi.fn> };
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface CtorRecord {
  ctxs: MockAudioContext[];
  gainNodes: MockGainNode[];
  ctor: ReturnType<typeof vi.fn>;
}

function setupAudioMocks(): CtorRecord {
  const ctxs: MockAudioContext[] = [];
  const gainNodes: MockGainNode[] = [];

  // Must be a regular function (not arrow) so `new Ctor()` works.
  const ctor = vi.fn(function () {
    const ctx: MockAudioContext = {
      state: 'suspended',
      currentTime: 0,
      destination: {},
      createGain: () => {
        const g: MockGainNode = {
          gain: {
            value: 0,
            cancelScheduledValues: vi.fn(),
            setValueAtTime: vi.fn((v: number) => { g.gain.value = v; }),
            linearRampToValueAtTime: vi.fn((v: number) => { g.gain.value = v; }),
          },
          connect: vi.fn().mockReturnThis(),
        };
        gainNodes.push(g);
        return g;
      },
      createMediaElementSource: () => ({ connect: vi.fn().mockReturnThis() }),
      resume: vi.fn(async () => { ctx.state = 'running'; }),
      close: vi.fn(async () => { ctx.state = 'closed'; }),
    };
    ctxs.push(ctx);
    return ctx;
  });

  vi.stubGlobal('AudioContext', ctor);

  // jsdom Audio() — minimal stub
  class MockAudio {
    src = '';
    crossOrigin: string | null = null;
    loop = false;
    preload = '';
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
  }
  vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);

  return { ctxs, gainNodes, ctor };
}

const TRACKS: MusicTrack[] = [
  { level: 'calm', url: '/api/music/track/c'.padEnd(82, '0') },
  { level: 'tense', url: '/api/music/track/t'.padEnd(82, '0') },
  { level: 'critical', url: '/api/music/track/x'.padEnd(82, '0') },
];

let mocks: CtorRecord;

beforeEach(() => {
  mocks = setupAudioMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// I7 — autoplay guard
// ---------------------------------------------------------------------------

describe('I7 — autoplay guard (duck before prime is no-op)', () => {
  it('does not create AudioContext when ducking before prime()', () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    act(() => {
      result.current.duckForInput();
      result.current.duckForOutput();
    });
    expect(mocks.ctor).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I5 — disabled path
// ---------------------------------------------------------------------------

describe('I5 — music-disabled path', () => {
  it('enabled: false → no AudioContext, no errors, no-op API', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: false }),
    );
    await act(async () => {
      await result.current.prime();
      result.current.duckForInput();
      result.current.duckForOutput();
      result.current.restoreFromInput();
      result.current.restoreFromOutput();
    });
    expect(mocks.ctor).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });

  it('empty tracks array still primes safely (no-track standby)', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: [], currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => {
      await result.current.prime();
    });
    // Context IS created since enabled=true and prime() succeeded; the hook
    // sits in a primed-but-silent standby waiting for tracks. Caller enforces
    // the music-disabled path by setting enabled=false (e.g. when pregen
    // returns no tracks). isRunning being true is intentional — ducking will
    // ramp the (silent) primary gain harmlessly.
    expect(result.current.isRunning).toBe(true);
    // No ramps fired because no track URL → primary src never set.
    const primaryGain = mocks.gainNodes[0]!;
    expect(primaryGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// I1 — input ducking
// ---------------------------------------------------------------------------

describe('I1 — input ducking on hold-to-speak press', () => {
  it('duckForInput() ramps primary gain to DUCK_GAIN over 400ms', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => { await result.current.prime(); });
    expect(result.current.isRunning).toBe(true);

    act(() => { result.current.duckForInput(); });

    const primaryGain = mocks.gainNodes[0]!;
    const calls = primaryGain.gain.linearRampToValueAtTime.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(last[0]).toBe(DUCK_GAIN);
    // arg[1] is now + DUCK_FADE_MS/1000; ctx.currentTime is 0 in mock, so DUCK_FADE_MS/1000
    expect(last[1]).toBeCloseTo(DUCK_FADE_MS / 1000, 3);
  });
});

// ---------------------------------------------------------------------------
// I2 — restore on TTS onEnded
// ---------------------------------------------------------------------------

describe('I2 — restore on TTS onEnded', () => {
  it('duckForOutput() then restoreFromOutput() ramps back to BASE_GAIN', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => { await result.current.prime(); });

    act(() => {
      result.current.duckForOutput();
      result.current.restoreFromOutput();
    });

    const primaryGain = mocks.gainNodes[0]!;
    const ramps = primaryGain.gain.linearRampToValueAtTime.mock.calls;
    // Last ramp must target BASE_GAIN
    const last = ramps[ramps.length - 1]!;
    expect(last[0]).toBe(BASE_GAIN);
  });

  it('restoreFromOutput works when fired from a one-shot callback (mimics useAudioPlayer.onEnded chain)', async () => {
    // Reproduces the GameSession.tsx wiring at lines ~145-150:
    //   audioPlayer.onEnded(() => { markAudioEnded(); music.restoreFromOutput(); });
    // useAudioPlayer.onEnded is one-shot self-clearing — this test covers the
    // failure mode where restoreFromOutput's closure breaks when invoked
    // through indirection. If GameSession ever drops the music.restoreFromOutput
    // call from the combined callback, this test is the first signal — replicate
    // that change here and watch this test fail.
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => { await result.current.prime(); });

    let oneShotCb: (() => void) | null = null;
    const fakeOnEnded = (cb: () => void) => { oneShotCb = cb; };
    const markAudioEnded = vi.fn();

    act(() => {
      result.current.duckForOutput();
      fakeOnEnded(() => {
        markAudioEnded();
        result.current.restoreFromOutput();
      });
    });

    const primaryGain = mocks.gainNodes[0]!;
    const rampsBefore = primaryGain.gain.linearRampToValueAtTime.mock.calls.length;

    // Fire the one-shot callback (TTS ended).
    act(() => { oneShotCb?.(); });

    expect(markAudioEnded).toHaveBeenCalledTimes(1);
    const rampsAfter = primaryGain.gain.linearRampToValueAtTime.mock.calls;
    expect(rampsAfter.length).toBe(rampsBefore + 1);
    const last = rampsAfter[rampsAfter.length - 1]!;
    expect(last[0]).toBe(BASE_GAIN);
  });
});

// ---------------------------------------------------------------------------
// I3 + I6 — cross-fade on tension change
// ---------------------------------------------------------------------------

describe('I3 + I6 — cross-fade on tension-level change', () => {
  it('changing currentTensionLevel fires dual ramps; old paused at CROSSFADE_MS', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook<
      ReturnType<typeof useMusicBed>,
      { level: 'calm' | 'tense' }
    >(
      ({ level }) =>
        useMusicBed({ tracks: TRACKS, currentTensionLevel: level, enabled: true }),
      { initialProps: { level: 'calm' } },
    );
    await act(async () => { await result.current.prime(); });

    // Re-render with new level — useEffect for cross-fade fires.
    await act(async () => {
      rerender({ level: 'tense' });
    });

    const primaryGain = mocks.gainNodes[0]!;
    const secondaryGain = mocks.gainNodes[1]!;

    // Primary ramps DOWN to 0
    const primaryRamps = primaryGain.gain.linearRampToValueAtTime.mock.calls;
    const primaryLast = primaryRamps[primaryRamps.length - 1]!;
    expect(primaryLast[0]).toBe(0);
    expect(primaryLast[1]).toBeCloseTo(CROSSFADE_MS / 1000, 3);

    // Secondary ramps UP to BASE_GAIN
    const secondaryRamps = secondaryGain.gain.linearRampToValueAtTime.mock.calls;
    const secondaryLast = secondaryRamps[secondaryRamps.length - 1]!;
    expect(secondaryLast[0]).toBe(BASE_GAIN);
    expect(secondaryLast[1]).toBeCloseTo(CROSSFADE_MS / 1000, 3);

    // I6 — pause swap happens at 800ms
    const ctx = mocks.ctxs[0]!;
    expect(ctx.close).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CROSSFADE_MS + 1);
    });
    // Old primary's audio.pause() — we can't directly inspect it without
    // capturing, but we can confirm the timer ran (no more pending).
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Crossfade-while-ducked — secondary respects active duck state
// ---------------------------------------------------------------------------

describe('crossfade respects active duck state', () => {
  it('tension change while ducked-for-input ramps secondary to DUCK_GAIN, not BASE_GAIN', async () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useMusicBed>,
      { level: 'calm' | 'tense' }
    >(
      ({ level }) =>
        useMusicBed({ tracks: TRACKS, currentTensionLevel: level, enabled: true }),
      { initialProps: { level: 'calm' } },
    );
    await act(async () => { await result.current.prime(); });

    // Enter ducked-for-input state, THEN change tension.
    act(() => { result.current.duckForInput(); });
    await act(async () => {
      rerender({ level: 'tense' });
    });

    const secondaryGain = mocks.gainNodes[1]!;
    const ramps = secondaryGain.gain.linearRampToValueAtTime.mock.calls;
    const last = ramps[ramps.length - 1]!;
    // Secondary must come up to DUCK_GAIN (0.2), NOT BASE_GAIN (1.0)
    expect(last[0]).toBe(DUCK_GAIN);
  });

  it('duck released MID-crossfade triggers post-swap correction to BASE_GAIN', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook<
      ReturnType<typeof useMusicBed>,
      { level: 'calm' | 'tense' }
    >(
      ({ level }) =>
        useMusicBed({ tracks: TRACKS, currentTensionLevel: level, enabled: true }),
      { initialProps: { level: 'calm' } },
    );
    await act(async () => { await result.current.prime(); });

    // Start ducked-for-input → secondary scheduled to DUCK_GAIN.
    act(() => { result.current.duckForInput(); });
    await act(async () => { rerender({ level: 'tense' }); });

    // Mid-crossfade (T=200ms): user releases hold.
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    act(() => { result.current.restoreFromInput(); });

    // Capture pre-swap mock call counts on what WAS the secondary (will be primary post-swap).
    const willBecomePrimaryGain = mocks.gainNodes[1]!;
    const beforeSwap = willBecomePrimaryGain.gain.linearRampToValueAtTime.mock.calls.length;

    // Advance past CROSSFADE_MS to trigger swap + post-swap reconciliation.
    await act(async () => { await vi.advanceTimersByTimeAsync(CROSSFADE_MS); });

    const afterSwap = willBecomePrimaryGain.gain.linearRampToValueAtTime.mock.calls;
    expect(afterSwap.length).toBeGreaterThan(beforeSwap);
    const correctionRamp = afterSwap[afterSwap.length - 1]!;
    // Post-swap correction must drive new primary back up to BASE_GAIN.
    expect(correctionRamp[0]).toBe(BASE_GAIN);
  });
});

// ---------------------------------------------------------------------------
// I10 — concurrent duck-both state
// ---------------------------------------------------------------------------

describe('I10 — concurrent duck-both state', () => {
  it('output then input duck → no re-ramp; releasing TTS keeps duck; releasing STT restores', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => { await result.current.prime(); });

    const primaryGain = mocks.gainNodes[0]!;
    const rampSpy = primaryGain.gain.linearRampToValueAtTime;

    // After prime, primary was ramped up to BASE_GAIN once.
    const baseCount = rampSpy.mock.calls.length;

    act(() => { result.current.duckForOutput(); });
    expect(rampSpy.mock.calls.length).toBe(baseCount + 1); // ramp down

    act(() => { result.current.duckForInput(); });
    expect(rampSpy.mock.calls.length).toBe(baseCount + 1); // no re-ramp

    // Release TTS — still ducked for STT.
    act(() => { result.current.restoreFromOutput(); });
    expect(rampSpy.mock.calls.length).toBe(baseCount + 1); // no ramp

    // Release STT — now restore.
    act(() => { result.current.restoreFromInput(); });
    expect(rampSpy.mock.calls.length).toBe(baseCount + 2);
    const last = rampSpy.mock.calls[rampSpy.mock.calls.length - 1]!;
    expect(last[0]).toBe(BASE_GAIN);
  });
});

// ---------------------------------------------------------------------------
// duckForOutput fadeMs override (elimination beat path)
// ---------------------------------------------------------------------------

describe('duckForOutput accepts fadeMs override', () => {
  it('passes through custom fadeMs (e.g. elimination beat 400ms)', async () => {
    const { result } = renderHook(() =>
      useMusicBed({ tracks: TRACKS, currentTensionLevel: 'calm', enabled: true }),
    );
    await act(async () => { await result.current.prime(); });

    act(() => { result.current.duckForOutput({ fadeMs: 400 }); });
    const primaryGain = mocks.gainNodes[0]!;
    const calls = primaryGain.gain.linearRampToValueAtTime.mock.calls;
    const last = calls[calls.length - 1]!;
    expect(last[0]).toBe(DUCK_GAIN);
    expect(last[1]).toBeCloseTo(0.4, 3);
  });
});
