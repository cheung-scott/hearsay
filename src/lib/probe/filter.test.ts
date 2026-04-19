// filter.test.ts — probe-phase invariants I1-I7 (§9).
//
// Every assertion here is a spec invariant. Seeds include known-bad LLM
// outputs plus random fuzz so novel digit/persona shapes trip the belt-and-
// braces `ANY_DIGIT_OR_PERCENT` net.

import { describe, it, expect } from 'vitest';

import { probeFilter, __internal } from './filter';
import type { Persona } from '../game/types';

const PERSONAS: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];
const MATH_PROBS = [0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95];
const PERSONA_LITERALS = ['Novice', 'Reader', 'Misdirector', 'Silent'];

// ---------------------------------------------------------------------------
// Fuzz corpus — deterministic (indexed) so failures are reproducible.
// ---------------------------------------------------------------------------

const KNOWN_BAD: string[] = [
  'I think the probability is 0.34 that this is a bluff.',
  '34% chance this claim is honest.',
  'prob: 0.5 — that looks too clean.',
  'probability: 0.72 — challenging.',
  'As the Reader persona, I note they stammered slightly.',
  'The Silent persona would challenge this one.',
  'Novice instinct says accept.',
  'Misdirector would play this the same way.',
  'mathProb=0.42 and lieScore=0.7 suggest a bluff.',
  'voiceMeta.lieScore is elevated.',
  '```\nmathProb: 0.34\n```',
  '12.34 is the weighted average of the tells.',
  'Hesitation at 0.3s mark, speed 180wpm.',
  'Thirty-four percent chance.',
  '1/3 of the time this is honest.',
  '7 of 10 similar claims were lies.',
];

const EDGE_CASES: (string | undefined)[] = [
  undefined,
  '',
  ' ',
  '...',
  'abc',
  'A'.repeat(500),
  '\u{1F600}\u{1F601}\u{1F602}',
  '\x00\x01\x02 hidden',
  '0123456789',
  '%%%%%%',
  'persona persona persona',
];

// Deterministic pseudo-random corpus — no Math.random in tests (game-engine §3.2 spirit).
function makeFuzzCorpus(n: number): string[] {
  const chunks = [
    'the ',
    'claim ',
    'felt ',
    'off ',
    'too clean ',
    'hesitation ',
    'pause ',
    'stammered ',
    'numbers ',
    'Reader ',
    'prob 0.34 ',
    '34% ',
    'probability: 0.5 ',
    'Novice ',
    'Silent ',
    'Misdirector ',
    'mathProb ',
    'lieScore 0.7 ',
    '12.34 ',
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // xorshift-ish deterministic picker
    let x = (i * 2654435761) >>> 0;
    let s = '';
    for (let j = 0; j < 8; j++) {
      x = (x ^ (x << 13)) >>> 0;
      x = (x ^ (x >>> 17)) >>> 0;
      x = (x ^ (x << 5)) >>> 0;
      const c = chunks[x % chunks.length];
      if (c !== undefined) s += c;
    }
    out.push(s.trim());
  }
  return out;
}

const FUZZ = makeFuzzCorpus(60);

// ---------------------------------------------------------------------------
// I1 — Non-empty output for every (persona × mathProb × llmReasoning).
// ---------------------------------------------------------------------------

describe('I1 — probe filter always returns non-empty output', () => {
  const inputs = [
    undefined,
    '',
    'The probability is 0.34',
    'As the Reader persona, I think this is a lie.',
    ...KNOWN_BAD,
    ...EDGE_CASES,
  ];

  for (const persona of PERSONAS) {
    for (const mathProb of MATH_PROBS) {
      for (let i = 0; i < inputs.length; i++) {
        const raw = inputs[i];
        it(`persona=${persona} mathProb=${mathProb} input[${i}]`, () => {
          const { revealedReasoning } = probeFilter(raw, persona, mathProb);
          expect(revealedReasoning.length).toBeGreaterThanOrEqual(1);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// I2 — No probability numbers leak (no [0-9%] anywhere in output).
// ---------------------------------------------------------------------------

describe('I2 — no digit or percent character in filter output', () => {
  const seeds = [...KNOWN_BAD, ...FUZZ];
  it.each(seeds)('input %#: %s', (raw) => {
    const { revealedReasoning } = probeFilter(raw, 'Reader', 0.5);
    expect(revealedReasoning).toMatch(/^[^0-9%]*$/);
  });
});

// ---------------------------------------------------------------------------
// I3 — No persona identifier leaks (case-insensitive).
// ---------------------------------------------------------------------------

describe('I3 — no canonical persona literal in filter output', () => {
  const seeds = [
    ...PERSONA_LITERALS.map((p) => `${p} thinks this is a bluff.`),
    ...PERSONA_LITERALS.map((p) => `As the ${p.toLowerCase()} persona, accept.`),
    'THE SILENT PERSONA WOULD CHALLENGE.',
    'Misdirector-style move, honestly.',
  ];
  for (const raw of seeds) {
    it(`strips personas from: ${raw}`, () => {
      const { revealedReasoning } = probeFilter(raw, 'Reader', 0.5);
      const lower = revealedReasoning.toLowerCase();
      for (const p of PERSONA_LITERALS) {
        expect(lower).not.toContain(p.toLowerCase());
      }
    });
  }
});

// ---------------------------------------------------------------------------
// I4 — Length cap.
// ---------------------------------------------------------------------------

describe('I4 — output length <= 120', () => {
  const seeds = [
    ...KNOWN_BAD,
    ...FUZZ,
    'x'.repeat(200),
    'word '.repeat(50).trim(),
  ];
  it.each(seeds)('input %#', (raw) => {
    const { revealedReasoning } = probeFilter(raw, 'Reader', 0.5);
    expect(revealedReasoning.length).toBeLessThanOrEqual(__internal.MAX_OUTPUT_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// I5 — Purity.
// ---------------------------------------------------------------------------

describe('I5 — filter is pure (same input → same output)', () => {
  const seeds = [undefined, '', 'just a vibe check', ...KNOWN_BAD.slice(0, 6)];
  it.each(seeds)('stable for input %#', (raw) => {
    const a = probeFilter(raw, 'Reader', 0.5);
    const b = probeFilter(raw, 'Reader', 0.5);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// I6 — Never throws.
// ---------------------------------------------------------------------------

describe('I6 — filter never throws', () => {
  it.each(EDGE_CASES)('tolerates edge input %#', (raw) => {
    expect(() => probeFilter(raw, 'Reader', 0.5)).not.toThrow();
    const out = probeFilter(raw, 'Reader', 0.5);
    expect(out.filterSource).toBeDefined();
    expect(out.revealedReasoning.length).toBeGreaterThanOrEqual(1);
  });

  it('tolerates non-finite mathProb', () => {
    const cases = [NaN, Infinity, -Infinity];
    for (const m of cases) {
      const out = probeFilter(undefined, 'Reader', m);
      expect(out.revealedReasoning.length).toBeGreaterThanOrEqual(1);
      expect(out.filterSource).toBe('fallback-static');
    }
  });
});

// ---------------------------------------------------------------------------
// I7 — Missing llmReasoning → fallback-static.
// ---------------------------------------------------------------------------

describe('I7 — undefined llmReasoning routes to fallback-static', () => {
  for (const persona of PERSONAS) {
    for (const mathProb of MATH_PROBS) {
      it(`persona=${persona} mathProb=${mathProb}`, () => {
        const out = probeFilter(undefined, persona, mathProb);
        expect(out.filterSource).toBe('fallback-static');
        expect(out.revealedReasoning.length).toBeGreaterThanOrEqual(1);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Lane selection — orthogonal checks.
// ---------------------------------------------------------------------------

describe('lane selection', () => {
  it('lane 1 fires on `[heuristic: ...]` marker', () => {
    const out = probeFilter(
      '[heuristic: the pauses felt staged] extra stuff ignored',
      'Reader',
      0.5,
    );
    expect(out.filterSource).toBe('llm-heuristic-layer');
    expect(out.revealedReasoning).toContain('staged');
  });

  it('lane 1 scrubs digits + personas from the heuristic payload', () => {
    const out = probeFilter(
      '[heuristic: Reader voice at 34% cadence]',
      'Reader',
      0.5,
    );
    expect(out.revealedReasoning).toMatch(/^[^0-9%]*$/);
    expect(out.revealedReasoning.toLowerCase()).not.toContain('reader');
  });

  it('lane 1 degrades to static when heuristic payload is entirely scrubbed', () => {
    const out = probeFilter('[heuristic: 34% Reader]', 'Reader', 0.8);
    expect(out.filterSource).toBe('fallback-static');
    expect(out.revealedReasoning).toBe('*Something feels off about this one.*');
  });

  it('lane 2 fires on plain prose', () => {
    const out = probeFilter(
      'Something about the cadence felt rehearsed more than natural.',
      'Reader',
      0.5,
    );
    expect(out.filterSource).toBe('regex-scrub');
    expect(out.revealedReasoning.length).toBeGreaterThan(0);
  });

  it('lane 3 fires on empty scrub residue', () => {
    const out = probeFilter('0.34 34% Silent', 'Reader', 0.9);
    expect(out.filterSource).toBe('fallback-static');
    expect(out.revealedReasoning).toBe('*Something feels off about this one.*');
  });

  it('lane 3 templates by mathProb', () => {
    expect(probeFilter(undefined, 'Reader', 0.9).revealedReasoning).toBe(
      '*Something feels off about this one.*',
    );
    expect(probeFilter(undefined, 'Reader', 0.2).revealedReasoning).toBe(
      '*The numbers look fine.*',
    );
    expect(probeFilter(undefined, 'Reader', 0.5).revealedReasoning).toBe(
      '*Hard to say.*',
    );
  });
});
