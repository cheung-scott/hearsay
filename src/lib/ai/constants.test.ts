// constants.test.ts — requirement 12.3: PERSONA_DESCRIPTIONS steering-file drift check.
// Reads .kiro/steering/llm-prompt-conventions.md at test time and asserts that
// each persona's description string matches the runtime value in constants.ts verbatim.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERSONA_DESCRIPTIONS } from './constants';
import type { Persona } from '../game/types';

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
