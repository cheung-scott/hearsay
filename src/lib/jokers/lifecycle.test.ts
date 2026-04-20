// Lifecycle helper tests — invariants I1, I8, I9, I11.
// Spec: joker-system §6.2, §7.1.3, §7.1.8, §9.
// Requirements: 3.2, 3.3, 4.2, 4.4, 7.1, 8.2, 8.3.

import { describe, it, expect } from 'vitest';
import type { JokerType, JokerSlot } from '../game/types';
import { InvalidTransitionError } from '../game/types';
import { seedDrawPile, pickOffer, canActivate, advanceSlot } from './lifecycle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple LCG — deterministic, seed-stable across platforms. */
const makeRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

/** Factory for a minimal held JokerSlot. */
const heldSlot = (joker: JokerType, roundIdx = 0): JokerSlot => ({
  joker,
  acquiredAt: 0,
  acquiredRoundIdx: roundIdx,
  state: 'held',
});

// ---------------------------------------------------------------------------
// seedDrawPile — I9
// ---------------------------------------------------------------------------

describe('seedDrawPile', () => {
  it('returns exactly 15 jokers', () => {
    expect(seedDrawPile()).toHaveLength(15);
  });

  it('contains exactly 3 copies of each of the 5 types', () => {
    const pile = seedDrawPile();
    const types: JokerType[] = [
      'poker_face',
      'stage_whisper',
      'earful',
      'cold_read',
      'second_wind',
    ];
    for (const t of types) {
      expect(pile.filter((j) => j === t)).toHaveLength(3);
    }
  });

  it('returns a new array each call (no shared reference)', () => {
    const a = seedDrawPile();
    const b = seedDrawPile();
    expect(a).not.toBe(b);
  });

  it('two calls produce equal-by-value arrays', () => {
    expect(seedDrawPile()).toEqual(seedDrawPile());
  });
});

// ---------------------------------------------------------------------------
// pickOffer — I8
// ---------------------------------------------------------------------------

describe('pickOffer', () => {
  it('I8 full pile: returns 3 distinct types and removes all 3 copies each', () => {
    const pile = seedDrawPile(); // 15 jokers, 5 types × 3
    const { offered, remaining } = pickOffer(pile, makeRng(42));

    expect(offered).toHaveLength(3);
    // All offered must be distinct
    expect(new Set(offered).size).toBe(3);
    // Each offered type had 3 copies removed → 15 - 9 = 6
    expect(remaining).toHaveLength(6);
    // Remaining must NOT contain any offered types
    for (const j of offered) {
      expect(remaining).not.toContain(j);
    }
  });

  it('2 distinct types remaining: returns offer of length 2 and empty remaining', () => {
    const pile: JokerType[] = ['earful', 'earful', 'cold_read'];
    const { offered, remaining } = pickOffer(pile, makeRng(7));

    expect(offered).toHaveLength(2);
    expect(offered).toContain('earful');
    expect(offered).toContain('cold_read');
    expect(remaining).toHaveLength(0);
  });

  it('empty pile: returns { offered: [], remaining: [] }', () => {
    const { offered, remaining } = pickOffer([], makeRng(1));
    expect(offered).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it('1 distinct type with many copies: offers exactly 1 and empties remaining', () => {
    const pile: JokerType[] = ['poker_face', 'poker_face', 'poker_face'];
    const { offered, remaining } = pickOffer(pile, makeRng(99));

    expect(offered).toHaveLength(1);
    expect(offered[0]).toBe('poker_face');
    expect(remaining).toHaveLength(0);
  });

  it('pure — does not mutate a frozen input array', () => {
    const pile = Object.freeze([...seedDrawPile()]) as JokerType[];
    // Must not throw (frozen array read-only, but pickOffer must not write to it)
    expect(() => pickOffer(pile, makeRng(5))).not.toThrow();
    // Length still 15 — pile itself unchanged
    expect(pile).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// canActivate — I1, I11
// ---------------------------------------------------------------------------

describe('canActivate', () => {
  // I1 — trigger window enforcement
  it('I1: Poker Face rejects during response_phase (trigger mismatch)', () => {
    expect(canActivate('poker_face', 'response_phase', 'player', 'player', [])).toBe(false);
  });

  it('Poker Face accepts during claim_phase when player is active and triggering', () => {
    expect(canActivate('poker_face', 'claim_phase', 'player', 'player', [])).toBe(true);
  });

  it('Stage Whisper accepts when AI is active and player triggers (pre_ai_claim)', () => {
    expect(canActivate('stage_whisper', 'claim_phase', 'ai', 'player', [])).toBe(true);
  });

  it('Stage Whisper rejects when player is active (player cannot pre-whisper own claim)', () => {
    expect(canActivate('stage_whisper', 'claim_phase', 'player', 'player', [])).toBe(false);
  });

  it('Cold Read accepts in response_phase when AI claimed and player responds', () => {
    // activePlayer === 'ai', by === 'player' → activePlayer !== by → opponent_claim_resolved
    expect(canActivate('cold_read', 'response_phase', 'ai', 'player', [])).toBe(true);
  });

  it('Cold Read rejects during claim_phase', () => {
    expect(canActivate('cold_read', 'claim_phase', 'ai', 'player', [])).toBe(false);
  });

  it('Cold Read rejects when responding to own claim (same player — guard against impossible state)', () => {
    // activePlayer === 'player', by === 'player' → activePlayer === by → trigger NOT met
    expect(canActivate('cold_read', 'response_phase', 'player', 'player', [])).toBe(false);
  });

  it('Second Wind always rejects via UseJoker (on_my_strike is auto-consume only)', () => {
    expect(canActivate('second_wind', 'claim_phase', 'player', 'player', [])).toBe(false);
  });

  // I11 — no-stacking same type in same round
  it('I11: rejects Cold Read if already triggered this round', () => {
    expect(
      canActivate('cold_read', 'response_phase', 'ai', 'player', ['cold_read']),
    ).toBe(false);
  });

  it('I11: allows Cold Read when a different joker triggered this round', () => {
    expect(
      canActivate('cold_read', 'response_phase', 'ai', 'player', ['poker_face']),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceSlot — I2 (slot state transition)
// ---------------------------------------------------------------------------

describe('advanceSlot', () => {
  it('transitions held → consumed and sets consumedRoundIdx', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read', 0)];
    const result = advanceSlot(slots, 'cold_read', 1);

    expect(result).toHaveLength(1);
    const slot = result[0];
    expect(slot.state).toBe('consumed');
    expect(slot.consumedRoundIdx).toBe(1);
    // All other fields preserved
    expect(slot.joker).toBe('cold_read');
    expect(slot.acquiredAt).toBe(0);
    expect(slot.acquiredRoundIdx).toBe(0);
  });

  it('pure — does not mutate the input slots array', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read', 0)];
    const original = slots[0];
    advanceSlot(slots, 'cold_read', 1);

    // Input slot unchanged
    expect(original.state).toBe('held');
    expect(original.consumedRoundIdx).toBeUndefined();
  });

  it('advances only the first matching held slot when two held slots of same type exist', () => {
    const slots: JokerSlot[] = [heldSlot('poker_face', 0), heldSlot('poker_face', 0)];
    const result = advanceSlot(slots, 'poker_face', 2);

    expect(result[0].state).toBe('consumed');
    expect(result[0].consumedRoundIdx).toBe(2);
    // Second slot untouched
    expect(result[1].state).toBe('held');
    expect(result[1].consumedRoundIdx).toBeUndefined();
  });

  it('skips already-consumed slots and throws if only consumed matches exist', () => {
    const consumedSlot: JokerSlot = {
      joker: 'cold_read',
      acquiredAt: 0,
      acquiredRoundIdx: 0,
      state: 'consumed',
      consumedRoundIdx: 0,
    };
    expect(() => advanceSlot([consumedSlot], 'cold_read', 1)).toThrow(InvalidTransitionError);
  });

  it('throws InvalidTransitionError with joker_not_held message when joker absent', () => {
    let threw: unknown;
    try {
      advanceSlot([], 'cold_read', 0);
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeInstanceOf(InvalidTransitionError);
    expect((threw as InvalidTransitionError).message).toContain('joker_not_held');
  });
});
