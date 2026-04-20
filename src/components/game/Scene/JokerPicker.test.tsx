// @vitest-environment jsdom
//
// JokerPicker component invariants — co-located test module.
// Tests: card count rendering, catalog name display, click → onPick once,
//        no dismiss via backdrop, keyboard accessibility.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { JokerPicker } from './JokerPicker';
import { JOKER_CATALOG } from '@/lib/jokers/catalog';
import type { JokerOffer } from '@/lib/game/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeOffer(types: JokerOffer['offered']): JokerOffer {
  return { offered: types, offeredToWinner: 'player' };
}

// ---------------------------------------------------------------------------
// Test 1: Renders 3 cards when offer.offered.length === 3
// ---------------------------------------------------------------------------

describe('JokerPicker — card count', () => {
  it('renders 3 cards when offer has 3 jokers', () => {
    const offer = makeOffer(['poker_face', 'cold_read', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button[data-joker]');
    expect(buttons).toHaveLength(3);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Renders 1 card when offer shrunk to 1 (exhaustion tail)
  // ---------------------------------------------------------------------------

  it('renders 1 card when offer has only 1 joker (exhaustion tail)', () => {
    const offer = makeOffer(['earful']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button[data-joker]');
    expect(buttons).toHaveLength(1);
  });

  it('renders 2 cards when offer has 2 jokers', () => {
    const offer = makeOffer(['stage_whisper', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );
    const buttons = container.querySelectorAll('button[data-joker]');
    expect(buttons).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Each card shows correct joker name from catalog
// ---------------------------------------------------------------------------

describe('JokerPicker — catalog name display', () => {
  it('each card shows the correct joker name from JOKER_CATALOG', () => {
    const offer = makeOffer(['poker_face', 'stage_whisper', 'earful']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );

    const nameEls = container.querySelectorAll('[data-testid^="card-name-"]');
    expect(nameEls).toHaveLength(3);

    const texts = Array.from(nameEls).map((el) => el.textContent ?? '');

    expect(texts).toContain(JOKER_CATALOG.poker_face.name);
    expect(texts).toContain(JOKER_CATALOG.stage_whisper.name);
    expect(texts).toContain(JOKER_CATALOG.earful.name);
  });

  it('single exhaustion card shows correct name', () => {
    const offer = makeOffer(['cold_read']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );

    const nameEl = container.querySelector('[data-testid="card-name-cold_read"]');
    expect(nameEl).not.toBeNull();
    expect(nameEl?.textContent).toBe(JOKER_CATALOG.cold_read.name);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Click a card → onPick called with that joker type exactly once
// ---------------------------------------------------------------------------

describe('JokerPicker — click fires onPick exactly once', () => {
  it('clicking a card calls onPick with the correct JokerType exactly once', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['poker_face', 'cold_read', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    const button = container.querySelector(
      'button[data-joker="poker_face"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    fireEvent.click(button);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('poker_face');
  });

  it('clicking the same card twice does NOT call onPick a second time', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['cold_read', 'earful', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    const button = container.querySelector(
      'button[data-joker="cold_read"]',
    ) as HTMLButtonElement;

    fireEvent.click(button);
    fireEvent.click(button);

    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('clicking a different card after picking the first does NOT fire onPick again', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['poker_face', 'earful', 'stage_whisper']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    fireEvent.click(
      container.querySelector('button[data-joker="poker_face"]') as HTMLButtonElement,
    );
    fireEvent.click(
      container.querySelector('button[data-joker="earful"]') as HTMLButtonElement,
    );

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('poker_face');
  });
});

// ---------------------------------------------------------------------------
// Test 5: No close / backdrop-click fires onPick
// ---------------------------------------------------------------------------

describe('JokerPicker — no dismiss without picking', () => {
  it('clicking the backdrop does NOT call onPick', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['poker_face', 'cold_read', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    const backdrop = container.querySelector(
      '[data-testid="joker-picker-backdrop"]',
    ) as HTMLElement;
    expect(backdrop).not.toBeNull();

    fireEvent.click(backdrop);

    expect(onPick).not.toHaveBeenCalled();
  });

  it('renders no close / X button', () => {
    const offer = makeOffer(['poker_face', 'cold_read', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );

    // Only the 3 card buttons should be present; no dismiss button
    const allButtons = container.querySelectorAll('button');
    expect(allButtons).toHaveLength(3);

    // None of the buttons should be a dismiss/close control
    const hasClose = Array.from(allButtons).some((b) => {
      const label = (b.getAttribute('aria-label') ?? '').toLowerCase();
      const text = (b.textContent ?? '').toLowerCase();
      return (
        label.includes('close') ||
        label.includes('dismiss') ||
        text === 'x' ||
        text === '×' ||
        text === '✕'
      );
    });
    expect(hasClose).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Keyboard accessibility — Enter on focused card calls onPick
// ---------------------------------------------------------------------------

describe('JokerPicker — keyboard accessibility', () => {
  it('pressing Enter on a focused card calls onPick with that joker type', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['stage_whisper', 'second_wind', 'cold_read']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    const button = container.querySelector(
      'button[data-joker="stage_whisper"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('stage_whisper');
  });

  it('pressing Space on a focused card calls onPick with that joker type', () => {
    const onPick = vi.fn();
    const offer = makeOffer(['earful']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={onPick} />,
    );

    const button = container.querySelector(
      'button[data-joker="earful"]',
    ) as HTMLButtonElement;

    fireEvent.keyDown(button, { key: ' ', code: 'Space' });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('earful');
  });

  it('card buttons are focusable (tabIndex >= 0 is default for button)', () => {
    const offer = makeOffer(['poker_face', 'cold_read', 'second_wind']);
    const { container } = render(
      <JokerPicker offer={offer} onPick={vi.fn()} />,
    );

    const buttons = Array.from(
      container.querySelectorAll('button[data-joker]'),
    ) as HTMLButtonElement[];

    buttons.forEach((btn) => {
      // HTML buttons are focusable by default (tabIndex is 0 unless set to -1)
      expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    });
  });
});
