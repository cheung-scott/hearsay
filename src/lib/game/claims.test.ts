import { describe, it, expect } from 'vitest';
import { parseClaim, WORD_TO_NUM, CLAIM_REGEX } from './claims';
import type { Rank } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('WORD_TO_NUM', () => {
  it('has exactly 4 entries (one, two, 1, 2)', () => {
    expect(Object.keys(WORD_TO_NUM)).toHaveLength(4);
  });

  it('maps "one" → 1, "two" → 2, "1" → 1, "2" → 2', () => {
    expect(WORD_TO_NUM['one']).toBe(1);
    expect(WORD_TO_NUM['two']).toBe(2);
    expect(WORD_TO_NUM['1']).toBe(1);
    expect(WORD_TO_NUM['2']).toBe(2);
  });
});

describe('CLAIM_REGEX', () => {
  it('is a RegExp', () => {
    expect(CLAIM_REGEX).toBeInstanceOf(RegExp);
  });

  it('is case-insensitive', () => {
    expect(CLAIM_REGEX.flags).toContain('i');
  });

  it('matches "one queen"', () => {
    expect(CLAIM_REGEX.test('one queen')).toBe(true);
  });

  it('matches "two kings"', () => {
    expect(CLAIM_REGEX.test('two kings')).toBe(true);
  });

  it('does not match "three queens"', () => {
    expect(CLAIM_REGEX.test('three queens')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseClaim — positive matches
// ---------------------------------------------------------------------------
describe('parseClaim — positive matches (Invariant 14)', () => {
  const ranks: Rank[] = ['Queen', 'King', 'Ace', 'Jack'];
  const countWords = ['one', 'two'] as const;
  const countDigits = ['1', '2'] as const;

  // 16 count×rank combinations across 3 casings = 48 variants
  for (const rank of ranks) {
    for (const countWord of countWords) {
      const expectedCount = countWord === 'one' ? 1 : 2;

      it(`lowercase: "${countWord} ${rank.toLowerCase()}" → { count: ${expectedCount}, rank: '${rank}' }`, () => {
        const result = parseClaim(`${countWord} ${rank.toLowerCase()}`);
        expect(result).toEqual({ count: expectedCount, rank });
      });

      it(`Title Case: "${countWord[0].toUpperCase() + countWord.slice(1)} ${rank}" → { count: ${expectedCount}, rank: '${rank}' }`, () => {
        const result = parseClaim(`${countWord[0].toUpperCase() + countWord.slice(1)} ${rank}`);
        expect(result).toEqual({ count: expectedCount, rank });
      });

      it(`UPPERCASE: "${countWord.toUpperCase()} ${rank.toUpperCase()}" → { count: ${expectedCount}, rank: '${rank}' }`, () => {
        const result = parseClaim(`${countWord.toUpperCase()} ${rank.toUpperCase()}`);
        expect(result).toEqual({ count: expectedCount, rank });
      });
    }

    for (const digit of countDigits) {
      const expectedCount = digit === '1' ? 1 : 2;

      it(`digit: "${digit} ${rank.toLowerCase()}" → { count: ${expectedCount}, rank: '${rank}' } (Invariant 15)`, () => {
        const result = parseClaim(`${digit} ${rank.toLowerCase()}`);
        expect(result).toEqual({ count: expectedCount, rank });
      });
    }
  }

  // Plural forms
  it('plural "Two queens" → { count: 2, rank: "Queen" }', () => {
    expect(parseClaim('Two queens')).toEqual({ count: 2, rank: 'Queen' });
  });

  it('plural "2 kings" → { count: 2, rank: "King" }', () => {
    expect(parseClaim('2 kings')).toEqual({ count: 2, rank: 'King' });
  });
});

// ---------------------------------------------------------------------------
// parseClaim — leading/trailing noise (Invariant 16)
// ---------------------------------------------------------------------------
describe('parseClaim — leading/trailing noise (Invariant 16)', () => {
  it('"uh, one queen." → { count: 1, rank: "Queen" }', () => {
    expect(parseClaim('uh, one queen.')).toEqual({ count: 1, rank: 'Queen' });
  });

  it('"One queen, please." → { count: 1, rank: "Queen" }', () => {
    expect(parseClaim('One queen, please.')).toEqual({ count: 1, rank: 'Queen' });
  });

  it('"Just two kings" → { count: 2, rank: "King" }', () => {
    expect(parseClaim('Just two kings')).toEqual({ count: 2, rank: 'King' });
  });

  it('"Just one ace" → { count: 1, rank: "Ace" }', () => {
    expect(parseClaim('Just one ace')).toEqual({ count: 1, rank: 'Ace' });
  });
});

// ---------------------------------------------------------------------------
// parseClaim — first-match-wins (Invariant 17)
// ---------------------------------------------------------------------------
describe('parseClaim — first-match-wins (Invariant 17)', () => {
  it('"two queens or one king" → { count: 2, rank: "Queen" }', () => {
    expect(parseClaim('two queens or one king')).toEqual({ count: 2, rank: 'Queen' });
  });

  it('"one jack and two aces" → { count: 1, rank: "Jack" }', () => {
    expect(parseClaim('one jack and two aces')).toEqual({ count: 1, rank: 'Jack' });
  });
});

// ---------------------------------------------------------------------------
// parseClaim — null cases
// ---------------------------------------------------------------------------
describe('parseClaim — empty string → null (Invariant 18)', () => {
  it('empty string "" → null', () => {
    expect(parseClaim('')).toBeNull();
  });
});

describe('parseClaim — non-claim text → null (Invariant 19)', () => {
  it('"Hello world" → null', () => {
    expect(parseClaim('Hello world')).toBeNull();
  });

  it('"I pass" → null', () => {
    expect(parseClaim('I pass')).toBeNull();
  });

  it('"nope" → null', () => {
    expect(parseClaim('nope')).toBeNull();
  });
});

describe('parseClaim — out-of-range count → null (Invariant 20)', () => {
  it('"three queens" → null', () => {
    expect(parseClaim('three queens')).toBeNull();
  });

  it('"zero aces" → null', () => {
    expect(parseClaim('zero aces')).toBeNull();
  });

  it('"five kings" → null', () => {
    expect(parseClaim('five kings')).toBeNull();
  });
});

describe('parseClaim — invalid rank → null (Invariant 21)', () => {
  it('"one five" → null', () => {
    expect(parseClaim('one five')).toBeNull();
  });

  it('"two banana" → null', () => {
    expect(parseClaim('two banana')).toBeNull();
  });
});

describe('parseClaim — word-boundary enforcement → null (Invariant 22)', () => {
  it('"butonequeenly" → null', () => {
    expect(parseClaim('butonequeenly')).toBeNull();
  });

  it('"antonequeen" → null', () => {
    expect(parseClaim('antonequeen')).toBeNull();
  });

  it('"butonequeen" → null', () => {
    expect(parseClaim('butonequeen')).toBeNull();
  });
});

describe('parseClaim — wrong order → null (Invariant 23)', () => {
  it('"queens one" → null', () => {
    expect(parseClaim('queens one')).toBeNull();
  });

  it('"king two" → null', () => {
    expect(parseClaim('king two')).toBeNull();
  });
});

describe('parseClaim — no-space variant → null (Invariant 24)', () => {
  it('"1queen" → null', () => {
    expect(parseClaim('1queen')).toBeNull();
  });

  it('"2kings" → null', () => {
    expect(parseClaim('2kings')).toBeNull();
  });

  it('"onequeen" → null', () => {
    expect(parseClaim('onequeen')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseClaim — purity / no regex lastIndex leak (Invariant 25)
// ---------------------------------------------------------------------------
describe('parseClaim — purity (Invariant 25)', () => {
  it('two calls with the same input produce deep-equal output', () => {
    const inputs = [
      'one queen',
      'Two kings',
      '',
      'Hello world',
      'uh, one ace.',
    ];
    for (const input of inputs) {
      expect(parseClaim(input)).toEqual(parseClaim(input));
    }
  });

  it('no lastIndex leak — CLAIM_REGEX does not have /g flag', () => {
    // Ensure regex doesn't have global flag (which would cause lastIndex drift)
    expect(CLAIM_REGEX.global).toBe(false);
  });

  it('repeated calls with same string give same result (property test)', () => {
    const transcript = 'one queen';
    const results = Array.from({ length: 10 }, () => parseClaim(transcript));
    for (const r of results) {
      expect(r).toEqual({ count: 1, rank: 'Queen' });
    }
  });
});
