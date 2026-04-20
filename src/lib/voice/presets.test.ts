import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VOICE_PRESETS, PERSONA_VOICE_IDS, CLERK_VOICE_ID } from './presets';
import type { Persona, TruthState } from '@/lib/game/types';

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];
const TRUTH_STATES: TruthState[] = ['honest', 'lying'];

describe('VOICE_PRESETS — shape completeness (invariant 1)', () => {
  it.each(PERSONAS)('%s has both honest and lying presets', (persona) => {
    expect(VOICE_PRESETS[persona].honest).toBeDefined();
    expect(VOICE_PRESETS[persona].lying).toBeDefined();
  });

  it.each(
    PERSONAS.flatMap((p) =>
      TRUTH_STATES.map((t) => [p, t] as [Persona, TruthState]),
    ),
  )('%s.%s has all 4 fields in valid ranges', (persona, truth) => {
    const s = VOICE_PRESETS[persona][truth];
    expect(s.stability).toBeGreaterThanOrEqual(0);
    expect(s.stability).toBeLessThanOrEqual(1);
    expect(s.similarity_boost).toBeGreaterThanOrEqual(0);
    expect(s.similarity_boost).toBeLessThanOrEqual(1);
    expect(s.style).toBeGreaterThanOrEqual(0);
    expect(s.style).toBeLessThanOrEqual(1);
    expect(s.speed).toBeGreaterThanOrEqual(0.8);
    expect(s.speed).toBeLessThanOrEqual(1.2);
  });
});

describe('VOICE_PRESETS — Misdirector inversion (invariant 2 — LOCKED)', () => {
  it('honest is MORE nervous (lower stability) than lying', () => {
    expect(VOICE_PRESETS.Misdirector.honest.stability).toBeLessThan(
      VOICE_PRESETS.Misdirector.lying.stability,
    );
  });

  it('honest is MORE expressive (higher style) than lying', () => {
    expect(VOICE_PRESETS.Misdirector.honest.style).toBeGreaterThan(
      VOICE_PRESETS.Misdirector.lying.style,
    );
  });
});

describe('VOICE_PRESETS — Novice audibility (invariant 3)', () => {
  it('Novice.lying.stability <= 0.25 (obvious tell)', () => {
    expect(VOICE_PRESETS.Novice.lying.stability).toBeLessThanOrEqual(0.25);
  });

  it('Novice.lying.style >= 0.55 (obvious expressiveness)', () => {
    expect(VOICE_PRESETS.Novice.lying.style).toBeGreaterThanOrEqual(0.55);
  });
});

describe('VOICE_PRESETS — persona difficulty ordering (invariants 4 + 5)', () => {
  const deltaStability = (p: Persona) =>
    Math.abs(VOICE_PRESETS[p].honest.stability - VOICE_PRESETS[p].lying.stability);

  it('Silent has the smallest honest/lying stability delta (< 0.25)', () => {
    expect(deltaStability('Silent')).toBeLessThan(0.25);
  });

  it('ordering: Novice > Reader > Silent (by stability delta)', () => {
    expect(deltaStability('Novice')).toBeGreaterThan(deltaStability('Reader'));
    expect(deltaStability('Reader')).toBeGreaterThan(deltaStability('Silent'));
  });
});

describe('VOICE_PRESETS — reference stability (invariant 6)', () => {
  it('two imports return the same object reference', async () => {
    const a = (await import('./presets')).VOICE_PRESETS;
    const b = (await import('./presets')).VOICE_PRESETS;
    expect(a).toBe(b);
  });
});

describe('PERSONA_VOICE_IDS — shape', () => {
  it('has an entry for every persona', () => {
    for (const p of PERSONAS) {
      expect(PERSONA_VOICE_IDS[p]).toBeDefined();
      expect(typeof PERSONA_VOICE_IDS[p]).toBe('string');
    }
  });
});

// ai-personas spec invariants (design.md §9 — I2, I3, I7 partial, I10)

describe('PERSONA_VOICE_IDS / VOICE_PRESETS — exhaustive persona coverage (I7 partial)', () => {
  it('PERSONA_VOICE_IDS has exactly the four canonical Persona keys', () => {
    expect(Object.keys(PERSONA_VOICE_IDS).sort()).toEqual([
      'Misdirector',
      'Novice',
      'Reader',
      'Silent',
    ]);
  });

  it('VOICE_PRESETS has exactly the four canonical Persona keys', () => {
    expect(Object.keys(VOICE_PRESETS).sort()).toEqual([
      'Misdirector',
      'Novice',
      'Reader',
      'Silent',
    ]);
  });
});

describe('PERSONA_VOICE_IDS / CLERK_VOICE_ID — distinctness (I2)', () => {
  it('all five voice IDs (4 personas + Clerk) are pairwise distinct', () => {
    const all = [...Object.values(PERSONA_VOICE_IDS), CLERK_VOICE_ID];
    expect(new Set(all).size).toBe(5);
  });
});

describe('PERSONA_VOICE_IDS / CLERK_VOICE_ID — format (I3)', () => {
  const VOICE_ID_RE = /^[A-Za-z0-9]{20}$/;

  it.each(PERSONAS)('PERSONA_VOICE_IDS.%s matches ElevenLabs voice-ID shape', (persona) => {
    expect(PERSONA_VOICE_IDS[persona]).toMatch(VOICE_ID_RE);
  });

  it('CLERK_VOICE_ID matches ElevenLabs voice-ID shape', () => {
    expect(CLERK_VOICE_ID).toMatch(VOICE_ID_RE);
  });

  it('rejects empty, whitespace, and placeholder IDs (regex negative check)', () => {
    expect('').not.toMatch(VOICE_ID_RE);
    expect('   ').not.toMatch(VOICE_ID_RE);
    expect('TBD').not.toMatch(VOICE_ID_RE);
    expect(' Lrx118tn6NTNAXspnuEN ').not.toMatch(VOICE_ID_RE);
  });
});

describe('PERSONA_VOICE_IDS / CLERK_VOICE_ID — exact locked values (design.md §6.1, §6.2)', () => {
  it('Novice → hearsay-defendant', () => {
    expect(PERSONA_VOICE_IDS.Novice).toBe('Lrx118tn6NTNAXspnuEN');
  });

  it('Reader → hearsay-prosecutor', () => {
    expect(PERSONA_VOICE_IDS.Reader).toBe('NxGA8X3YhTrnf3TRQf6Q');
  });

  it('Misdirector → hearsay-attorney', () => {
    expect(PERSONA_VOICE_IDS.Misdirector).toBe('0Q0MDAMrmHYYHDqFoGUx');
  });

  it('Silent → hearsay-judge', () => {
    expect(PERSONA_VOICE_IDS.Silent).toBe('0XMldg7YUhIHRMJqiWHr');
  });

  it('Clerk → hearsay-clerk (tutorial narrator)', () => {
    expect(CLERK_VOICE_ID).toBe('Al9pMcZxV70KAzzehiTE');
  });
});

describe('PERSONA_VOICE_IDS / VOICE_PRESETS — Clerk non-membership (I10)', () => {
  it('"Clerk" is not a key in PERSONA_VOICE_IDS', () => {
    expect('Clerk' in (PERSONA_VOICE_IDS as Record<string, unknown>)).toBe(false);
  });

  it('"Clerk" is not a key in VOICE_PRESETS', () => {
    expect('Clerk' in (VOICE_PRESETS as Record<string, unknown>)).toBe(false);
  });
});

// Task 8 — brain-isolation static assertion (req 7.1).
// The ai-opponent brain must stay presentation-free; it should never import
// PERSONA_VOICE_IDS, PERSONA_DISPLAY_NAMES, or PERSONA_ACCENT_COLORS.
describe('ai-opponent brain.ts — presentation isolation (req 7.1)', () => {
  const BRAIN_PATH = resolve(process.cwd(), 'src/lib/ai/brain.ts');
  const brainSrc = readFileSync(BRAIN_PATH, 'utf8');

  it.each([
    'PERSONA_VOICE_IDS',
    'PERSONA_DISPLAY_NAMES',
    'PERSONA_ACCENT_COLORS',
    'CLERK_VOICE_ID',
  ])('brain.ts does not reference %s', (symbol) => {
    expect(brainSrc).not.toContain(symbol);
  });
});
