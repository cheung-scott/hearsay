import { describe, it, expect } from 'vitest';
import { PERSONA_DISPLAY_NAMES } from './displayNames';
import type { Persona } from '../game/types';

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];

describe('PERSONA_DISPLAY_NAMES (ui-gameplay invariant 4)', () => {
  it('covers all four Persona keys', () => {
    expect(Object.keys(PERSONA_DISPLAY_NAMES).sort()).toEqual([
      'Misdirector',
      'Novice',
      'Reader',
      'Silent',
    ]);
  });

  it('maps each persona to a non-empty courtroom name', () => {
    for (const name of Object.values(PERSONA_DISPLAY_NAMES)) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('uses the locked courtroom names from DESIGN-DECISIONS.md §9', () => {
    expect(PERSONA_DISPLAY_NAMES.Novice).toBe('The Defendant');
    expect(PERSONA_DISPLAY_NAMES.Reader).toBe('The Prosecutor');
    expect(PERSONA_DISPLAY_NAMES.Misdirector).toBe('The Attorney');
    expect(PERSONA_DISPLAY_NAMES.Silent).toBe('The Judge');
  });
});

// ai-personas spec invariants (design.md §9 — I5, I10 partial)

describe('PERSONA_DISPLAY_NAMES — courtroom prefix (I5)', () => {
  it.each(PERSONAS)('%s display name starts with "The "', (persona) => {
    expect(PERSONA_DISPLAY_NAMES[persona].startsWith('The ')).toBe(true);
  });
});

describe('PERSONA_DISPLAY_NAMES — uniqueness (I5)', () => {
  it('all four courtroom names are pairwise distinct', () => {
    expect(new Set(Object.values(PERSONA_DISPLAY_NAMES)).size).toBe(4);
  });
});

describe('PERSONA_DISPLAY_NAMES — Clerk non-membership (I10 partial)', () => {
  it('"Clerk" is not a key in PERSONA_DISPLAY_NAMES', () => {
    expect('Clerk' in (PERSONA_DISPLAY_NAMES as Record<string, unknown>)).toBe(false);
  });
});
