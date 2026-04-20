import { describe, expect, it } from 'vitest';
import { listFSMEvents } from '../listFSMEvents';
import { CATALOG_EVENT_TYPES, FSM_EVENT_CATALOG } from '../../fsmEvents';

function parseEnvelope(result: Awaited<ReturnType<typeof listFSMEvents>>) {
  return JSON.parse(result.content[0]!.text);
}

describe('listFSMEvents', () => {
  it('returns the catalog with type/required/description for each entry', async () => {
    const env = parseEnvelope(await listFSMEvents({}));
    expect(env.ok).toBe(true);
    expect(env.data).toHaveLength(FSM_EVENT_CATALOG.length);
    for (const entry of env.data) {
      expect(entry.type).toBeTruthy();
      expect(Array.isArray(entry.required)).toBe(true);
      expect(typeof entry.description).toBe('string');
    }
  });

  it('covers every GameEvent variant defined in src/lib/game/types.ts', () => {
    // Static list mirrored from the union (types.ts). If this list changes,
    // update fsmEvents.ts AND this test in the same commit.
    const expected = [
      'SetupComplete',
      'ClaimMade',
      'ClaimAccepted',
      'ChallengeCalled',
      'RevealComplete',
      'RoundSettled',
      'JokerPicked',
      'JokerOfferSkippedSessionOver',
      'Timeout',
      'JokerOffered',
      'JokerOfferEmpty',
      'UseJoker',
      'ProbeStart',
      'ProbeComplete',
      'ProbeExpired',
    ].sort();
    const actual = [...CATALOG_EVENT_TYPES].sort();
    expect(actual).toEqual(expected);
  });
});
