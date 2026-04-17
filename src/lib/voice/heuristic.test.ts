import { describe, it, expect } from 'vitest';
import { computeLieScore, FILLER_REGEX } from './heuristic';

const ZERO_INPUT = {
  latencyMs: 0,
  fillerCount: 0,
  pauseCount: 0,
  speechRateWpm: 150, // inside [120, 220] normal range
};

describe('computeLieScore — range (invariant 7)', () => {
  it('zero input → 0', () => {
    expect(computeLieScore(ZERO_INPUT)).toBe(0);
  });

  it('saturated input → 1', () => {
    const score = computeLieScore({
      latencyMs: 2000,
      fillerCount: 3,
      pauseCount: 3,
      speechRateWpm: 100, // below 120 → rate=1
    });
    expect(score).toBe(1);
  });

  it('way-above-saturation input still clamps to 1', () => {
    const score = computeLieScore({
      latencyMs: 10000,
      fillerCount: 50,
      pauseCount: 20,
      speechRateWpm: 300,
    });
    expect(score).toBe(1);
  });

  it('never returns NaN for finite input', () => {
    const score = computeLieScore({
      latencyMs: 500,
      fillerCount: 1,
      pauseCount: 2,
      speechRateWpm: 180,
    });
    expect(Number.isNaN(score)).toBe(false);
  });
});

describe('computeLieScore — weight allocation (invariants 8 + 9)', () => {
  it('latency alone at saturation contributes exactly 0.40', () => {
    const score = computeLieScore({ ...ZERO_INPUT, latencyMs: 2000 });
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('fillers alone at saturation contributes exactly 0.30', () => {
    const score = computeLieScore({ ...ZERO_INPUT, fillerCount: 3 });
    expect(score).toBeCloseTo(0.3, 5);
  });

  it('pauses alone at saturation contributes exactly 0.20', () => {
    const score = computeLieScore({ ...ZERO_INPUT, pauseCount: 3 });
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('rate out of range alone contributes exactly 0.10 (low)', () => {
    const score = computeLieScore({ ...ZERO_INPUT, speechRateWpm: 100 });
    expect(score).toBeCloseTo(0.1, 5);
  });

  it('rate out of range alone contributes exactly 0.10 (high)', () => {
    const score = computeLieScore({ ...ZERO_INPUT, speechRateWpm: 250 });
    expect(score).toBeCloseTo(0.1, 5);
  });
});

describe('computeLieScore — rate binary behavior (invariant 10)', () => {
  it.each([120, 150, 180, 220])('rate %i inside [120,220] contributes 0', (wpm) => {
    const score = computeLieScore({ ...ZERO_INPUT, speechRateWpm: wpm });
    expect(score).toBe(0);
  });

  it.each([119, 221, 50, 400])(
    'rate %i outside [120,220] contributes exactly 0.10',
    (wpm) => {
      const score = computeLieScore({ ...ZERO_INPUT, speechRateWpm: wpm });
      expect(score).toBeCloseTo(0.1, 5);
    },
  );
});

describe('computeLieScore — monotonicity (invariant 11)', () => {
  const base = { latencyMs: 500, fillerCount: 1, pauseCount: 1, speechRateWpm: 150 };

  it('increasing latencyMs (within clamp) never decreases score', () => {
    const a = computeLieScore({ ...base, latencyMs: 500 });
    const b = computeLieScore({ ...base, latencyMs: 1000 });
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('increasing fillerCount (within clamp) never decreases score', () => {
    const a = computeLieScore({ ...base, fillerCount: 1 });
    const b = computeLieScore({ ...base, fillerCount: 2 });
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('increasing pauseCount (within clamp) never decreases score', () => {
    const a = computeLieScore({ ...base, pauseCount: 1 });
    const b = computeLieScore({ ...base, pauseCount: 2 });
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('FILLER_REGEX — word-boundary correctness (invariant 12)', () => {
  const matchCount = (s: string) => {
    FILLER_REGEX.lastIndex = 0; // reset stateful /g regex between tests
    return (s.match(FILLER_REGEX) ?? []).length;
  };

  it.each([
    ['um', 1],
    ['uh', 1],
    ['er', 1],
    ['like', 1],
    ['so', 1],
    ['you know', 1],
    ['kinda', 1],
    ['i mean', 1],
  ])('matches "%s" exactly once', (word, expected) => {
    expect(matchCount(word)).toBe(expected);
  });

  it.each([
    ['umbrella', 0],
    ['soft', 0],
    ['likewise', 0],
    ['other', 0],
    ['sokind', 0],
  ])('does not match sub-string "%s"', (word, expected) => {
    expect(matchCount(word)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(matchCount('UM, well...')).toBe(1);
    expect(matchCount('I Mean, like, so...')).toBe(3);
  });

  it('counts multiple fillers in one transcript', () => {
    expect(matchCount('um, well, I mean, uh, like, I dunno')).toBe(4);
  });
});
