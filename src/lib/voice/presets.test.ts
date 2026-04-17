import { describe, it, expect } from 'vitest';
import { VOICE_PRESETS, PERSONA_VOICE_IDS } from './presets';
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
