import { describe, it, expect } from 'vitest';
import { PERSONA_DISPLAY_NAMES } from './displayNames';

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
