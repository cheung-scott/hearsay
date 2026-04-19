import { describe, it, expect } from 'vitest';
import { PERSONA_ACCENT_COLORS } from './accentColors';
import type { Persona } from '../game/types';

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];

describe('PERSONA_ACCENT_COLORS — exhaustive persona coverage (I7 partial)', () => {
  it('has exactly the four canonical Persona keys', () => {
    expect(Object.keys(PERSONA_ACCENT_COLORS).sort()).toEqual([
      'Misdirector',
      'Novice',
      'Reader',
      'Silent',
    ]);
  });
});

describe('PERSONA_ACCENT_COLORS — format (I6)', () => {
  it.each(PERSONAS)('%s value matches 6-hex regex /^#[0-9a-f]{6}$/i', (persona) => {
    expect(PERSONA_ACCENT_COLORS[persona]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('all four values are pairwise distinct', () => {
    const values = Object.values(PERSONA_ACCENT_COLORS);
    expect(new Set(values).size).toBe(4);
  });
});

describe('PERSONA_ACCENT_COLORS — exact locked values (design.md §7.3)', () => {
  it('Novice (The Defendant) is muted olive #8ca880', () => {
    expect(PERSONA_ACCENT_COLORS.Novice).toBe('#8ca880');
  });

  it('Reader (The Prosecutor) is amber/tobacco #b57c3a', () => {
    expect(PERSONA_ACCENT_COLORS.Reader).toBe('#b57c3a');
  });

  it('Misdirector (The Attorney) is deep violet #6b4a9e', () => {
    expect(PERSONA_ACCENT_COLORS.Misdirector).toBe('#6b4a9e');
  });

  it('Silent (The Judge) is near-black navy #1e2a3a', () => {
    expect(PERSONA_ACCENT_COLORS.Silent).toBe('#1e2a3a');
  });
});
