// Effects helper tests — invariants I4, I4b, I5, I6, I7, I3.
// Spec: joker-system §9, §7.4.1 (Poker Face), §7.4.2 (Cold Read), §5 (Second Wind),
//       §7.4.3 (Earful), §7.2 (Stage Whisper).
// Requirements: 10.2, 13.2, 14.1, 14.4, 11.1–11.4, 12.1–12.5.

import { describe, it, expect } from 'vitest';
import { applyPokerFace, applyColdRead, applySecondWind, applyEarful, produceProbeRequest } from './effects';
import type { Round, JokerSlot, ActiveJokerEffect, Claim, VoiceTellPreset } from '../game/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeRound = (effects: ActiveJokerEffect[] = []): Round => ({
  roundNumber: 1,
  targetRank: 'Queen',
  activePlayer: 'player',
  pile: [],
  claimHistory: [],
  status: 'claim_phase',
  activeJokerEffects: effects,
  tensionLevel: 0,
});

const heldSlot = (joker: JokerSlot['joker'], roundIdx = 0): JokerSlot => ({
  joker,
  acquiredAt: 0,
  acquiredRoundIdx: roundIdx,
  state: 'held',
});

const consumedSlot = (joker: JokerSlot['joker'], roundIdx = 0): JokerSlot => ({
  joker,
  acquiredAt: 0,
  acquiredRoundIdx: roundIdx,
  consumedRoundIdx: roundIdx,
  state: 'consumed',
});

// ---------------------------------------------------------------------------
// applyPokerFace — Req 10.2, Invariant I6
// ---------------------------------------------------------------------------
//
// I6: pure + deterministic — ignores input, always returns exactly 0.5.

describe('applyPokerFace', () => {
  it('I6: suppresses high lie score to 0.5', () => {
    expect(applyPokerFace(0.87)).toBe(0.5);
  });

  it('I6: suppresses low lie score to 0.5', () => {
    expect(applyPokerFace(0.12)).toBe(0.5);
  });

  it('I6: suppresses 0 to 0.5', () => {
    expect(applyPokerFace(0)).toBe(0.5);
  });

  it('I6: suppresses 1 to 0.5', () => {
    expect(applyPokerFace(1)).toBe(0.5);
  });

  it('I6: idempotent — 0.5 input returns 0.5', () => {
    expect(applyPokerFace(0.5)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// applyColdRead — Req 13.2, Invariant I5
// ---------------------------------------------------------------------------
//
// I5: returns true iff cold_read is in activeJokerEffects.

describe('applyColdRead', () => {
  it('I5: returns true when cold_read effect is active', () => {
    const round = makeRound([
      { type: 'cold_read', expiresAfter: 'next_challenge' },
    ]);
    expect(applyColdRead(round)).toBe(true);
  });

  it('I5: returns false when activeJokerEffects is empty', () => {
    const round = makeRound([]);
    expect(applyColdRead(round)).toBe(false);
  });

  it('I5: returns false when only a different joker type is active', () => {
    const round = makeRound([
      { type: 'poker_face', expiresAfter: 'next_claim' },
    ]);
    expect(applyColdRead(round)).toBe(false);
  });

  it('I5: returns true when cold_read is mixed with other effects', () => {
    const round = makeRound([
      { type: 'poker_face', expiresAfter: 'next_claim' },
      { type: 'cold_read', expiresAfter: 'next_challenge' },
    ]);
    expect(applyColdRead(round)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applySecondWind — Reqs 14.1, 14.4, Invariants I4, I4b
// ---------------------------------------------------------------------------
//
// I4:  no held second_wind → no-op, shouldCancel: false, same array reference.
// I4b: held second_wind present → shouldCancel: true, first held slot consumed.

describe('applySecondWind', () => {
  // I4 — no-op cases

  it('I4: empty slots → shouldCancel: false, same array reference', () => {
    const slots: JokerSlot[] = [];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(false);
    expect(result.updatedSlots).toBe(slots);
  });

  it('I4: slots without second_wind → shouldCancel: false, same array reference', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read'), heldSlot('poker_face')];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(false);
    expect(result.updatedSlots).toBe(slots);
  });

  it('I4: already-consumed second_wind only → shouldCancel: false (nothing held to consume)', () => {
    const slots: JokerSlot[] = [consumedSlot('second_wind')];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(false);
    expect(result.updatedSlots).toBe(slots);
  });

  // I4b — consume cases

  it('I4b: one held second_wind → shouldCancel: true, slot flipped to consumed', () => {
    const slots: JokerSlot[] = [heldSlot('second_wind')];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(true);
    expect(result.updatedSlots).toHaveLength(1);
    expect(result.updatedSlots[0].state).toBe('consumed');
    expect(result.updatedSlots[0].joker).toBe('second_wind');
  });

  it('I4b: input array is NOT mutated after consume', () => {
    const slots: JokerSlot[] = [heldSlot('second_wind')];
    applySecondWind(slots);
    // Original slot must still be held
    expect(slots[0].state).toBe('held');
  });

  it('I4b: multiple held second_winds — only the FIRST is consumed, rest remain held', () => {
    const slots: JokerSlot[] = [heldSlot('second_wind'), heldSlot('second_wind')];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(true);
    expect(result.updatedSlots[0].state).toBe('consumed');
    expect(result.updatedSlots[1].state).toBe('held');
  });

  it('I4b: mixed slots — only second_wind consumed, other slots untouched', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read'), heldSlot('second_wind')];
    const result = applySecondWind(slots);
    expect(result.shouldCancel).toBe(true);
    expect(result.updatedSlots).toHaveLength(2);
    // cold_read slot must be structurally unchanged
    expect(result.updatedSlots[0].joker).toBe('cold_read');
    expect(result.updatedSlots[0].state).toBe('held');
    // second_wind slot must be consumed
    expect(result.updatedSlots[1].joker).toBe('second_wind');
    expect(result.updatedSlots[1].state).toBe('consumed');
  });

  it('I4b: non-second_wind fields (acquiredAt, acquiredRoundIdx) are preserved on consumed slot', () => {
    const slots: JokerSlot[] = [heldSlot('second_wind', 2)];
    const result = applySecondWind(slots);
    const consumed = result.updatedSlots[0];
    expect(consumed.acquiredAt).toBe(0);
    expect(consumed.acquiredRoundIdx).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applyEarful — Reqs 12.1–12.5, Invariant I7
// ---------------------------------------------------------------------------
//
// I7: held earful consumed, autopsy built from claim.voicePreset + indices.

const makeClaim = (overrides: Partial<Claim> = {}): Claim => ({
  by: 'ai',
  count: 1,
  claimedRank: 'Queen',
  actualCardIds: ['Queen-0'],
  truthState: 'honest',
  timestamp: 0,
  ...overrides,
});

describe('applyEarful', () => {
  it('I7: held earful + voicePreset populated → correct autopsy + slot consumed', () => {
    const slots: JokerSlot[] = [heldSlot('earful')];
    const claim = makeClaim({ voicePreset: 'CONFIDENT' as VoiceTellPreset });
    const result = applyEarful(slots, claim, 0, 1);
    expect(result).not.toBeNull();
    expect(result!.autopsy.preset).toBe('CONFIDENT');
    expect(result!.autopsy.roundIdx).toBe(0);
    expect(result!.autopsy.turnIdx).toBe(1);
    expect(result!.updatedSlots[0].state).toBe('consumed');
  });

  it('voicePreset undefined → preset falls back to "unknown"', () => {
    const slots: JokerSlot[] = [heldSlot('earful')];
    const claim = makeClaim({ voicePreset: undefined });
    const result = applyEarful(slots, claim, 1, 2);
    expect(result).not.toBeNull();
    expect(result!.autopsy.preset).toBe('unknown');
  });

  it('no held earful → returns null', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read')];
    const claim = makeClaim({ voicePreset: 'CONFIDENT' as VoiceTellPreset });
    expect(applyEarful(slots, claim, 0, 0)).toBeNull();
  });

  it('already-consumed earful → returns null', () => {
    const slots: JokerSlot[] = [consumedSlot('earful')];
    const claim = makeClaim({ voicePreset: 'CONFIDENT' as VoiceTellPreset });
    expect(applyEarful(slots, claim, 0, 0)).toBeNull();
  });

  it('mixed slots: cold_read held + earful held → cold_read untouched, earful consumed', () => {
    const slots: JokerSlot[] = [heldSlot('cold_read'), heldSlot('earful')];
    const claim = makeClaim({ voicePreset: 'CONFIDENT' as VoiceTellPreset });
    const result = applyEarful(slots, claim, 0, 0);
    expect(result).not.toBeNull();
    expect(result!.updatedSlots).toHaveLength(2);
    expect(result!.updatedSlots[0].joker).toBe('cold_read');
    expect(result!.updatedSlots[0].state).toBe('held');
    expect(result!.updatedSlots[1].joker).toBe('earful');
    expect(result!.updatedSlots[1].state).toBe('consumed');
  });

  it('purity: input slots are NOT mutated after call', () => {
    const slots: JokerSlot[] = [heldSlot('earful')];
    const claim = makeClaim({ voicePreset: 'CONFIDENT' as VoiceTellPreset });
    applyEarful(slots, claim, 0, 0);
    expect(slots[0].state).toBe('held');
  });
});

// ---------------------------------------------------------------------------
// produceProbeRequest — Reqs 11.1–11.4, Invariant I3
// ---------------------------------------------------------------------------
//
// I3: locked ProbeRequest shape — byte-for-byte aligned with probe-phase §4.

const makeRoundForProbe = (
  roundNumber: 1 | 2 | 3,
  claimHistory: Claim[] = [],
): Round => ({
  roundNumber,
  targetRank: 'Queen',
  activePlayer: 'player',
  pile: [],
  claimHistory,
  status: 'claim_phase',
  activeJokerEffects: [],
  tensionLevel: 0,
});

describe('produceProbeRequest', () => {
  it('I3: correct locked shape with mathProb', () => {
    const c1 = makeClaim();
    const c2 = makeClaim();
    const round = makeRoundForProbe(1, [c1, c2]);
    const result = produceProbeRequest(round, () => 'wid-123', 5000, 0.73);
    expect(result).toEqual({
      whisperId: 'wid-123',
      targetAiId: 'ai',
      roundIdx: 0,
      triggeredAtTurn: 2,
      now: 5000,
      mathProb: 0.73,
    });
  });

  it('mathProb undefined → field absent from output object', () => {
    const round = makeRoundForProbe(1, [makeClaim()]);
    const result = produceProbeRequest(round, () => 'wid-abc', 1000);
    expect(result).not.toHaveProperty('mathProb');
  });

  it('roundNumber 2 → roundIdx 1', () => {
    const round = makeRoundForProbe(2, []);
    const result = produceProbeRequest(round, () => 'w', 0);
    expect(result.roundIdx).toBe(1);
  });

  it('empty claimHistory → triggeredAtTurn: 0', () => {
    const round = makeRoundForProbe(1, []);
    const result = produceProbeRequest(round, () => 'w', 0);
    expect(result.triggeredAtTurn).toBe(0);
  });

  it('whisperIdGen called exactly once', () => {
    const round = makeRoundForProbe(1, [makeClaim()]);
    let callCount = 0;
    const gen = () => {
      callCount += 1;
      return `wid-${callCount}`;
    };
    produceProbeRequest(round, gen, 0);
    expect(callCount).toBe(1);
  });
});
