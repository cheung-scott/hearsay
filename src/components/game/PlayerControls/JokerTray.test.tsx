// @vitest-environment jsdom
//
// JokerTray component invariants — co-located test module.
// Tests: empty tray, slot rendering, consumed dim, firing glow, click semantics.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { JokerTray } from './JokerTray';
import { JOKER_CATALOG } from '@/lib/jokers/catalog';
import type { JokerSlot, ActiveJokerEffect } from '@/lib/game/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeSlot(joker: JokerSlot['joker'], state: 'held' | 'consumed' = 'held'): JokerSlot {
  return {
    joker,
    state,
    acquiredAt: 1000,
    acquiredRoundIdx: 0,
    consumedRoundIdx: state === 'consumed' ? 1 : undefined,
  };
}

function makeEffect(type: ActiveJokerEffect['type']): ActiveJokerEffect {
  return { type, expiresAfter: 'next_claim' };
}

// ---------------------------------------------------------------------------
// Test 1: Empty jokerSlots → container.firstChild === null
// ---------------------------------------------------------------------------

describe('JokerTray — empty slots', () => {
  it('renders nothing when jokerSlots is empty', () => {
    const { container } = render(
      <JokerTray jokerSlots={[]} activeEffects={[]} onActivate={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2: 3 held slots render 3 cards with correct names from catalog
// ---------------------------------------------------------------------------

describe('JokerTray — slot rendering', () => {
  it('renders 3 cards with correct names when 3 held slots provided', () => {
    const slots: JokerSlot[] = [
      makeSlot('poker_face'),
      makeSlot('cold_read'),
      makeSlot('second_wind'),
    ];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={vi.fn()} />,
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(3);

    // Each button should contain the correct joker name from catalog
    const buttonTexts = Array.from(buttons).map(b => b.textContent ?? '');
    expect(buttonTexts.some(t => t.includes(JOKER_CATALOG.poker_face.name))).toBe(true);
    expect(buttonTexts.some(t => t.includes(JOKER_CATALOG.cold_read.name))).toBe(true);
    expect(buttonTexts.some(t => t.includes(JOKER_CATALOG.second_wind.name))).toBe(true);
  });

  it('caps at 5 slots even if more are provided', () => {
    const slots: JokerSlot[] = [
      makeSlot('poker_face'),
      makeSlot('cold_read'),
      makeSlot('second_wind'),
      makeSlot('earful'),
      makeSlot('stage_whisper'),
      // Duplicate — should be capped at 5
      makeSlot('poker_face'),
    ];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={vi.fn()} />,
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Consumed slot has opacity < 1 OR grayscale filter present
// ---------------------------------------------------------------------------

describe('JokerTray — consumed slot dimming', () => {
  it('consumed slot has opacity < 1 and grayscale filter', () => {
    const slots: JokerSlot[] = [makeSlot('poker_face', 'consumed')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={vi.fn()} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    const opacity = parseFloat(button.style.opacity);
    const filter = button.style.filter;

    const isDimmed = opacity < 1 || filter.includes('grayscale');
    expect(isDimmed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Firing slot has a distinguishing class/style (active/firing indicator)
// ---------------------------------------------------------------------------

describe('JokerTray — active/firing slot styling', () => {
  it('slot whose joker type is in activeEffects has a distinguishing firing indicator', () => {
    const slots: JokerSlot[] = [makeSlot('cold_read', 'held')];
    const activeEffects: ActiveJokerEffect[] = [makeEffect('cold_read')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={activeEffects} onActivate={vi.fn()} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    // Firing slot should have data-firing="true" attribute
    expect(button.getAttribute('data-firing')).toBe('true');

    // Should also have a distinct box-shadow glow
    const boxShadow = button.style.boxShadow;
    expect(boxShadow).toBeTruthy();
    // The glow shadow contains rgba with amber color
    expect(boxShadow).toContain('rgba(253,162,0');
  });

  it('non-firing slot has data-firing="false"', () => {
    const slots: JokerSlot[] = [makeSlot('cold_read', 'held')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={vi.fn()} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button?.getAttribute('data-firing')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Click on held non-firing slot → onActivate called with correct type once
// ---------------------------------------------------------------------------

describe('JokerTray — click semantics', () => {
  it('click on held non-firing slot calls onActivate with correct joker type exactly once', () => {
    const onActivate = vi.fn();
    const slots: JokerSlot[] = [makeSlot('poker_face', 'held')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={onActivate} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    fireEvent.click(button);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('poker_face');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Click on consumed slot → onActivate NOT called
  // ---------------------------------------------------------------------------

  it('click on consumed slot does NOT call onActivate', () => {
    const onActivate = vi.fn();
    const slots: JokerSlot[] = [makeSlot('poker_face', 'consumed')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={[]} onActivate={onActivate} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    fireEvent.click(button);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('click on actively-firing slot does NOT call onActivate', () => {
    const onActivate = vi.fn();
    const slots: JokerSlot[] = [makeSlot('cold_read', 'held')];
    const activeEffects: ActiveJokerEffect[] = [makeEffect('cold_read')];

    const { container } = render(
      <JokerTray jokerSlots={slots} activeEffects={activeEffects} onActivate={onActivate} />,
    );

    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    fireEvent.click(button);

    expect(onActivate).not.toHaveBeenCalled();
  });
});
