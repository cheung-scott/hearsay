// constants.test.ts — requirement 12.3: PERSONA_DESCRIPTIONS steering-file drift check.
// Reads .kiro/steering/llm-prompt-conventions.md at test time and asserts that
// each persona's description string matches the runtime value in constants.ts verbatim.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERSONA_DESCRIPTIONS, templateHonest, templateLie } from './constants';
import type { Persona, Rank, TruthState } from '../game/types';

const STEERING_PATH = resolve(
  process.cwd(),
  '.kiro/steering/llm-prompt-conventions.md',
);

/**
 * Extract a persona's description string from the steering file.
 * Matches lines of the form:
 *   Novice:      "a new player who bluffs...",
 *   Reader:      "balanced and observant...",
 * The value is the content between the double quotes.
 */
function extractFromSteering(persona: Persona, text: string): string {
  const re = new RegExp(`^\\s*${persona}:\\s*"([^"]+)",?\\s*$`, 'm');
  const m = text.match(re);
  if (!m) {
    throw new Error(
      `Could not extract ${persona} from steering file at ${STEERING_PATH}`,
    );
  }
  return m[1];
}

describe('constants.ts drift check vs steering file (req 12.3)', () => {
  const steering = readFileSync(STEERING_PATH, 'utf8');

  it.each(['Novice', 'Reader', 'Misdirector', 'Silent'] as Persona[])(
    'PERSONA_DESCRIPTIONS[%s] matches steering file verbatim',
    (persona) => {
      const expected = extractFromSteering(persona, steering);
      expect(PERSONA_DESCRIPTIONS[persona]).toBe(expected);
    },
  );
});

// ai-personas spec invariants (design.md §9 — I7 partial, I9)

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];
const TRUTH_STATES: TruthState[] = ['honest', 'lying'];

describe('PERSONA_DESCRIPTIONS — exhaustive persona coverage (I7 partial)', () => {
  it('has exactly the four canonical Persona keys', () => {
    expect(Object.keys(PERSONA_DESCRIPTIONS).sort()).toEqual([
      'Misdirector',
      'Novice',
      'Reader',
      'Silent',
    ]);
  });
});

// I9 — every (persona, truthState) dialogue bank exposes 4 distinct variants.
// The variant arrays are module-private, so we probe via rng stubs that
// deterministically hit indices 0, 1, 2, 3 (Math.floor(rng() * 4)).
describe('templateHonest / templateLie — 4 distinct variants per (persona, truthState) (I9)', () => {
  const RNG_INDICES = [0.0, 0.25, 0.5, 0.75];
  const RANK: Rank = 'Queen';
  const COUNT = 1 as const;

  const pairs = PERSONAS.flatMap((p) =>
    TRUTH_STATES.map((t) => [p, t] as [Persona, TruthState]),
  );

  it.each(pairs)('%s.%s has 4 distinct variants across rng indices 0..3', (persona, truth) => {
    const fn = truth === 'honest' ? templateHonest : templateLie;
    const outputs = RNG_INDICES.map((r) => fn(persona, COUNT, RANK, () => r));
    expect(outputs).toHaveLength(4);
    expect(new Set(outputs).size).toBe(4);
  });
});
