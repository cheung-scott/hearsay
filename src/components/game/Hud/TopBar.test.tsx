// @vitest-environment jsdom
//
// TopBar component invariants — Wave-5 A1: active-joker HUD indicator.
// Tests: empty activeJokerEffects (silent), one effect, two different types,
// same-type dedup, accent-var attribute on chip.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TopBar } from './TopBar';
import { JOKER_CATALOG } from '@/lib/jokers/catalog';
import type { ClientSession, ActiveJokerEffect, JokerType } from '@/lib/game/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEffect(type: JokerType, expiresAfter: ActiveJokerEffect['expiresAfter'] = 'next_claim'): ActiveJokerEffect {
  return { type, expiresAfter };
}

/**
 * Builds a minimal ClientSession with the provided activeJokerEffects on
 * round 0. All other fields are filled with safe defaults so TopBar renders
 * without errors.
 */
function makeSession(activeJokerEffects: ActiveJokerEffect[] = []): ClientSession {
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
      handSize: 0,
      takenCards: [],
      roundsWon: 0,
      strikes: 0,
      jokers: [],
    },
    rounds: [
      {
        roundNumber: 1,
        targetRank: 'Queen',
        activePlayer: 'player',
        pileSize: 0,
        claimHistory: [],
        status: 'claim_phase',
        activeJokerEffects,
        tensionLevel: 0,
      },
    ],
    currentRoundIdx: 0,
    status: 'round_active',
  };
}

// ---------------------------------------------------------------------------
// Test 1: Empty activeJokerEffects → no "ACTIVE" label in DOM
// ---------------------------------------------------------------------------

describe('TopBar — empty activeJokerEffects', () => {
  it('renders nothing for the active powers row when activeJokerEffects is empty', () => {
    const { container } = render(<TopBar session={makeSession([])} />);

    // The "ACTIVE" label must not appear
    expect(container.textContent).not.toMatch(/^ACTIVE$/);

    // No active-powers-row in the DOM
    expect(container.querySelector('[data-testid="active-powers-row"]')).toBeNull();
  });
});

describe('TopBar - opponent strikes', () => {
  it('renders an opponent strike counter', () => {
    const session = makeSession([]);
    session.opponent.strikes = 2;

    const { container } = render(<TopBar session={session} />);

    const opponentStrikes = container.querySelector('[data-testid="opponent-strikes-row"]');
    expect(opponentStrikes).not.toBeNull();
    expect(opponentStrikes?.querySelectorAll('.strike.lit')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 2: One cold_read effect → chip with "COLD READ" text
// ---------------------------------------------------------------------------

describe('TopBar — one active effect', () => {
  it('renders a chip with the correct name when one cold_read effect is present', () => {
    const { container } = render(
      <TopBar session={makeSession([makeEffect('cold_read')])} />,
    );

    const chip = container.querySelector('[data-testid="active-joker-chip-cold_read"]');
    expect(chip).not.toBeNull();

    // Text should be the all-caps name from catalog
    expect(chip?.textContent?.toUpperCase()).toContain(JOKER_CATALOG.cold_read.name.toUpperCase());
  });
});

// ---------------------------------------------------------------------------
// Test 3: Two effects of different types → 2 chips
// ---------------------------------------------------------------------------

describe('TopBar — two effects of different types', () => {
  it('renders two chips when two different joker types are active', () => {
    const effects: ActiveJokerEffect[] = [
      makeEffect('cold_read'),
      makeEffect('poker_face'),
    ];

    const { container } = render(<TopBar session={makeSession(effects)} />);

    const coldReadChip = container.querySelector('[data-testid="active-joker-chip-cold_read"]');
    const pokerFaceChip = container.querySelector('[data-testid="active-joker-chip-poker_face"]');

    expect(coldReadChip).not.toBeNull();
    expect(pokerFaceChip).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Two effects of the SAME type → 1 chip (dedupe)
// ---------------------------------------------------------------------------

describe('TopBar — dedupe same-type effects', () => {
  it('renders only one chip when two effects of the same type are present', () => {
    const effects: ActiveJokerEffect[] = [
      makeEffect('cold_read', 'next_claim'),
      makeEffect('cold_read', 'next_challenge'),
    ];

    const { container } = render(<TopBar session={makeSession(effects)} />);

    const chips = container.querySelectorAll('[data-testid="active-joker-chip-cold_read"]');
    expect(chips).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Chip carries the correct accentVar from JOKER_CATALOG
// ---------------------------------------------------------------------------

describe('TopBar — chip accent var', () => {
  it('chip has data-accent-var matching JOKER_CATALOG accentVar', () => {
    const effects: ActiveJokerEffect[] = [makeEffect('stage_whisper')];

    const { container } = render(<TopBar session={makeSession(effects)} />);

    const chip = container.querySelector('[data-testid="active-joker-chip-stage_whisper"]');
    expect(chip).not.toBeNull();

    const accentVar = chip?.getAttribute('data-accent-var');
    expect(accentVar).toBe(JOKER_CATALOG.stage_whisper.accentVar);
  });
});
