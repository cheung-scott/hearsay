// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from './useTypewriter';

describe('useTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals full string after N×charDelayMs ticks and fires onDone exactly once', () => {
    const text = 'hello';
    const charDelayMs = 10;
    const onDone = vi.fn();

    const { result } = renderHook(() => useTypewriter(text, charDelayMs, onDone));

    expect(result.current.displayedText).toBe('');
    expect(result.current.isDone).toBe(false);

    // Advance by 5×10ms = 50ms — exactly enough for all 5 chars.
    act(() => {
      vi.advanceTimersByTime(text.length * charDelayMs);
    });

    expect(result.current.displayedText).toBe(text);
    expect(result.current.isDone).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fires onDone exactly once even after extra ticks beyond completion', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useTypewriter('abc', 20, onDone));

    // Advance well past completion.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.displayedText).toBe('abc');
    expect(result.current.isDone).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('resets the reveal when text changes', () => {
    const onDone = vi.fn();
    let text = 'hi';
    const { result, rerender } = renderHook(
      ({ t }: { t: string }) => useTypewriter(t, 10, onDone),
      { initialProps: { t: text } },
    );

    // Complete first text.
    act(() => {
      vi.advanceTimersByTime(text.length * 10);
    });

    expect(result.current.displayedText).toBe('hi');
    expect(onDone).toHaveBeenCalledTimes(1);

    // Change text — hook should reset.
    text = 'bye';
    rerender({ t: text });

    // Right after rerender, displayedText should reset.
    expect(result.current.displayedText).toBe('');
    expect(result.current.isDone).toBe(false);

    // Complete second text.
    act(() => {
      vi.advanceTimersByTime(text.length * 10);
    });

    expect(result.current.displayedText).toBe('bye');
    expect(result.current.isDone).toBe(true);
    // onDone fires once per complete reveal.
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
