// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoldToSpeak } from './useHoldToSpeak';

// ---------------------------------------------------------------------------
// Mock types
// ---------------------------------------------------------------------------

interface MockRecorderInstance {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  state: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

let lastRecorderInstance: MockRecorderInstance | null = null;

function MockMediaRecorder(this: MockRecorderInstance, _stream: MediaStream) {
  this.start = vi.fn(() => {
    this.state = 'recording';
  });
  this.stop = vi.fn(() => {
    this.state = 'inactive';
    // Simulate browser firing ondataavailable then onstop.
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['chunk'], { type: 'audio/webm' }) });
    }
    if (this.onstop) {
      this.onstop();
    }
  });
  this.state = 'inactive';
  this.ondataavailable = null;
  this.onstop = null;
  lastRecorderInstance = this;
}

interface MockAnalyserNodeInstance {
  frequencyBinCount: number;
  getByteTimeDomainData: ReturnType<typeof vi.fn>;
}

interface MockAudioContextInstance {
  createAnalyser: () => MockAnalyserNodeInstance;
  createMediaStreamSource: () => { connect: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
}

function MockAudioContext(this: MockAudioContextInstance) {
  const analyser: MockAnalyserNodeInstance = {
    frequencyBinCount: 128,
    getByteTimeDomainData: vi.fn(),
  };
  this.createAnalyser = () => analyser;
  this.createMediaStreamSource = () => ({ connect: vi.fn() });
  this.close = vi.fn().mockResolvedValue(undefined);
}

function makeFakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  lastRecorderInstance = null;

  // Stub globals.
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((_cb: FrameRequestCallback) => 0),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  vi.stubGlobal('AudioContext', MockAudioContext);

  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useHoldToSpeak', () => {
  it('stop() before start() is a no-op — state stays idle, no errors', () => {
    const { result } = renderHook(() => useHoldToSpeak());

    expect(result.current.state).toBe('idle');

    act(() => {
      result.current.stop();
    });

    expect(result.current.state).toBe('idle');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('double-start() is idempotent — getUserMedia called exactly once', async () => {
    const { result } = renderHook(() => useHoldToSpeak());

    // First start.
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('recording');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    // Second start while already recording — should be a no-op.
    await act(async () => {
      await result.current.start();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('recording');
  });

  it('start() → stop() transitions state correctly and produces a non-null audioBlob', async () => {
    const { result } = renderHook(() => useHoldToSpeak());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('recording');

    act(() => {
      result.current.stop();
    });

    // The mock MediaRecorder fires onstop synchronously in stop().
    expect(result.current.state).toBe('stopped');
    expect(result.current.audioBlob).not.toBeNull();
    expect(result.current.audioBlob).toBeInstanceOf(Blob);
  });
});
