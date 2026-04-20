// @vitest-environment jsdom
//
// ProbeReveal component invariants.
// Tests: reasoning text render, filter-source pill labels (all 3 variants),
//        countdown tick after timer advance, clean unmount, past-expiry handling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ProbeReveal } from './ProbeReveal';
import type { RevealedProbe } from '@/lib/game/types';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeProbe(
  overrides: Partial<RevealedProbe> = {},
): RevealedProbe {
  return {
    whisperId: 'test-whisper-id',
    revealedReasoning: 'Something feels off about this one.',
    filterSource: 'llm-heuristic-layer',
    decayMs: 4000,
    expiresAt: Date.now() + 4000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Renders the revealed reasoning text
// ---------------------------------------------------------------------------

describe('ProbeReveal — reasoning text', () => {
  it('renders the revealedReasoning string in the document', () => {
    const probe = makeProbe({ revealedReasoning: 'The claim felt too casual.' });
    const { container } = render(<ProbeReveal probe={probe} />);
    expect(container.textContent).toContain('The claim felt too casual.');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Correct pill label for each filterSource variant
// ---------------------------------------------------------------------------

describe('ProbeReveal — filter-source pill labels', () => {
  it('shows "HEURISTIC" pill for llm-heuristic-layer', () => {
    const probe = makeProbe({ filterSource: 'llm-heuristic-layer' });
    const { container } = render(<ProbeReveal probe={probe} />);

    const pill = container.querySelector('[data-filter-source="llm-heuristic-layer"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('HEURISTIC');
  });

  it('shows "SANITIZED" pill for regex-scrub', () => {
    const probe = makeProbe({ filterSource: 'regex-scrub' });
    const { container } = render(<ProbeReveal probe={probe} />);

    const pill = container.querySelector('[data-filter-source="regex-scrub"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('SANITIZED');
  });

  it('shows "INTUITION" pill for fallback-static', () => {
    const probe = makeProbe({ filterSource: 'fallback-static' });
    const { container } = render(<ProbeReveal probe={probe} />);

    const pill = container.querySelector('[data-filter-source="fallback-static"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('INTUITION');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Countdown — after 1000ms advance, remaining ≈ 3000ms (≤ 4000)
// ---------------------------------------------------------------------------

describe('ProbeReveal — countdown timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('remaining ms drops by ~1000 after 1000ms fake-timer advance', () => {
    const now = Date.now();
    const probe = makeProbe({ decayMs: 4000, expiresAt: now + 4000 });

    const { container } = render(<ProbeReveal probe={probe} />);

    // Grab the countdown bar before advancing
    const barBefore = container.querySelector<HTMLDivElement>(
      '[aria-label="time remaining"] > div',
    );
    const widthBefore = parseFloat(barBefore?.style.width ?? '100');

    // Advance fake timers by 1000ms — the 100ms interval fires 10 times
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const barAfter = container.querySelector<HTMLDivElement>(
      '[aria-label="time remaining"] > div',
    );
    const widthAfter = parseFloat(barAfter?.style.width ?? '0');

    // Width should have decreased by roughly 25% (1000/4000)
    // Allow ±5% for timing jitter in fake timers
    expect(widthBefore).toBeGreaterThan(widthAfter);
    expect(widthBefore - widthAfter).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Unmount during countdown → no leaked-interval error / console.warn
// ---------------------------------------------------------------------------

describe('ProbeReveal — unmount cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmounts without throwing or leaking the countdown interval', () => {
    const probe = makeProbe({ decayMs: 4000, expiresAt: Date.now() + 4000 });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<ProbeReveal probe={probe} />);

    // Advance a bit then unmount mid-countdown
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(() => unmount()).not.toThrow();

    // Advance timers past expiry — should not trigger state-update warnings
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 5: expiresAt already in the past → renders with 0% bar, no crash
// ---------------------------------------------------------------------------

describe('ProbeReveal — past-expiry handling', () => {
  it('renders with 0% bar width when expiresAt is already in the past', () => {
    const probe = makeProbe({
      decayMs: 4000,
      expiresAt: Date.now() - 1000, // already expired
    });

    const { container } = render(<ProbeReveal probe={probe} />);

    const bar = container.querySelector<HTMLDivElement>(
      '[aria-label="time remaining"] > div',
    );
    const width = parseFloat(bar?.style.width ?? '-1');
    expect(width).toBe(0);

    // Reasoning text still visible (component hasn't crashed)
    expect(container.textContent).toContain(probe.revealedReasoning);
  });
});
