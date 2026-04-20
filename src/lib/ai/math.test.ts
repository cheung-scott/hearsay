import { describe, it, expect } from 'vitest';
import type { DecisionContext, OwnPlayContext } from './types';
import type { Card, Rank, PublicClaim, Persona } from '../game/types';
import {
  PERSONA_WEIGHTS,
  PERSONA_THRESHOLDS,
  PERSONA_BLUFF_BIAS,
  claimMathProbability,
  aiDecideOnClaimFallback,
  aiDecideOwnPlayFallback,
} from './math';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCard(rank: Rank, id: string): Card {
  return { id, rank };
}

function makeDecisionCtx(overrides: Partial<DecisionContext>): DecisionContext {
  const defaultClaim: PublicClaim & { voiceMeta?: undefined } = {
    by: 'player',
    count: 1,
    claimedRank: 'Queen',
    claimText: undefined,
    timestamp: 0,
  };
  return {
    persona: 'Reader',
    targetRank: 'Queen',
    myHand: [
      makeCard('Queen', 'q0'),
      makeCard('Queen', 'q1'),
      makeCard('King', 'k0'),
      makeCard('King', 'k1'),
      makeCard('Ace', 'a0'),
    ],
    myJokers: [],
    opponentJokers: [],
    opponentHandSize: 5,
    roundHistory: [],
    claim: defaultClaim,
    pileSize: 0,
    strikesMe: 0,
    strikesPlayer: 0,
    ...overrides,
  };
}

function makeOwnPlayCtx(overrides: Partial<OwnPlayContext>): OwnPlayContext {
  return {
    persona: 'Reader',
    targetRank: 'Queen',
    myHand: [
      makeCard('Queen', 'q0'),
      makeCard('Queen', 'q1'),
      makeCard('King', 'k0'),
      makeCard('King', 'k1'),
      makeCard('Ace', 'a0'),
    ],
    myJokers: [],
    opponentJokers: [],
    opponentHandSize: 5,
    roundHistory: [],
    pileSize: 0,
    strikesMe: 0,
    strikesPlayer: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Invariant 1 — Persona weights sum to 1.0
// ---------------------------------------------------------------------------

describe('invariant 1: persona weights sum to 1.0', () => {
  it('weights sum to 1.0 for all personas', () => {
    const personas = ['Novice', 'Reader', 'Misdirector', 'Silent'] as const;
    for (const p of personas) {
      const { math, voice } = PERSONA_WEIGHTS[p];
      expect(math + voice).toBe(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 2 — Math probability bounds [0.15, 0.95]
// ---------------------------------------------------------------------------

describe('invariant 2: math probability bounds', () => {
  it('output always in [0.15, 0.95] across hand/count/history sweep', () => {
    const ranks: Rank[] = ['Queen', 'King', 'Ace', 'Jack'];

    // Various hand compositions
    const hands: Card[][] = [
      // 0 Queens
      [makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0'), makeCard('Jack', 'j1')],
      // 1 Queen
      [makeCard('Queen', 'q0'), makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0')],
      // 2 Queens
      [makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0')],
      // 3 Queens
      [makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('Queen', 'q2'), makeCard('King', 'k0'), makeCard('Ace', 'a0')],
      // All Queens (5)
      [makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('Queen', 'q2'), makeCard('Queen', 'q3'), makeCard('Queen', 'q4')],
    ];

    const counts: Array<1 | 2> = [1, 2];

    const histories: PublicClaim[][] = [
      [],
      [{ by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 }],
      [{ by: 'player', count: 2, claimedRank: 'Queen', timestamp: 0 }],
      [{ by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 0 }, { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 1 }],
    ];

    for (const hand of hands) {
      for (const count of counts) {
        for (const rank of ranks) {
          for (const roundHistory of histories) {
            const claim: PublicClaim = { by: 'player', count, claimedRank: rank, timestamp: 0 };
            const ctx = makeDecisionCtx({ myHand: hand, claim, roundHistory });
            const prob = claimMathProbability(ctx);
            expect(prob).toBeGreaterThanOrEqual(0.15);
            expect(prob).toBeLessThanOrEqual(0.95);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 3 — Math probability key cases
// ---------------------------------------------------------------------------

describe('invariant 3: math probability key cases', () => {
  it('remainingSupport < claim.count → 0.95 (impossible claim)', () => {
    // AI has 5 Queens in hand → outsideOwnHand = 5 - 5 = 0
    // roundHistory includes current claim (count 1) so alreadyClaimed = 1
    // remainingSupport = 0 - 1 = -1 < 1 → 0.95
    const hand = [
      makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('Queen', 'q2'),
      makeCard('Queen', 'q3'), makeCard('Queen', 'q4'),
    ];
    const claim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 };
    const ctx = makeDecisionCtx({ myHand: hand, claim, roundHistory: [claim] });
    expect(claimMathProbability(ctx)).toBe(0.95);
  });

  it('remainingSupport >= 3 * claim.count → 0.15 (abundant support)', () => {
    // AI has 0 Queens → outsideOwnHand = 5 - 0 = 5
    // roundHistory is empty (no prior Queen claims, current claim not in history for this test)
    // alreadyClaimed = 0 → remainingSupport = 5
    // count = 1 → 3 * 1 = 3 → 5 >= 3 → 0.15
    const hand = [
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'),
      makeCard('Jack', 'j0'), makeCard('Jack', 'j1'),
    ];
    const claim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 };
    const ctx = makeDecisionCtx({ myHand: hand, claim, roundHistory: [] });
    expect(claimMathProbability(ctx)).toBe(0.15);
  });

  it('mid-range: increasing remainingSupport produces monotonically decreasing probability', () => {
    // We'll vary how many Queens are already claimed in roundHistory
    // AI has 0 Queens → outsideOwnHand = 5
    // claim.count = 1
    // We use roundHistory (prior claims, not current) to adjust alreadyClaimed
    // and also include current claim (count=1) in roundHistory per the contract
    //
    // remainingSupport = 5 - alreadyClaimed
    // For mid-range: remainingSupport must satisfy claim.count <= rs < 3*claim.count
    // i.e. 1 <= rs < 3 → rs ∈ {1, 2}
    //
    // rs=2: alreadyClaimed = 3 (2 prior + 1 current)
    // rs=1: alreadyClaimed = 4 (3 prior + 1 current)
    const hand = [
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'),
      makeCard('Jack', 'j0'), makeCard('Jack', 'j1'),
    ];
    const claim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 100 };

    // rs=2 case: prior history has 2 Queen claims (total), current adds 1 → alreadyClaimed=3, rs=2
    const priorClaims2: PublicClaim[] = [
      { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 10 },
      { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 20 },
    ];
    const ctx2 = makeDecisionCtx({ myHand: hand, claim, roundHistory: [...priorClaims2, claim] });
    const prob2 = claimMathProbability(ctx2);

    // rs=1 case: prior history has 3 Queen claims (total), current adds 1 → alreadyClaimed=4, rs=1
    const priorClaims1: PublicClaim[] = [
      { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 10 },
      { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 20 },
      { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 30 },
    ];
    const ctx1 = makeDecisionCtx({ myHand: hand, claim, roundHistory: [...priorClaims1, claim] });
    const prob1 = claimMathProbability(ctx1);

    // Both mid-range: strictly between 0.15 and 0.70
    expect(prob1).toBeGreaterThan(0.15);
    expect(prob1).toBeLessThan(0.70);
    expect(prob2).toBeGreaterThan(0.15);
    expect(prob2).toBeLessThan(0.70);

    // Monotonic: lower remainingSupport (rs=1) → higher probability than rs=2
    expect(prob1).toBeGreaterThan(prob2);
  });
});

// ---------------------------------------------------------------------------
// Invariant 4 — Fallback judgment is deterministic
// ---------------------------------------------------------------------------

describe('invariant 4: fallback judgment is deterministic', () => {
  it('identical DecisionContext produces the same action on every call', () => {
    const claim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 };
    const ctx = makeDecisionCtx({ claim, roundHistory: [claim] });

    const result1 = aiDecideOnClaimFallback(ctx);
    const result2 = aiDecideOnClaimFallback(ctx);

    expect(result1.action).toBe(result2.action);
    expect(result1.mathProb).toBe(result2.mathProb);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5 — Fallback own-play branches
// ---------------------------------------------------------------------------

describe('invariant 5: fallback own-play branches', () => {
  it('branch A: targets in hand + rng > bluffBias → honest', () => {
    // Reader bluffBias = 0.35; rng returning 0.99 > 0.35 → branch 1
    const hand = [
      makeCard('Queen', 'q0'), makeCard('Queen', 'q1'),
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'),
    ];
    const ctx = makeOwnPlayCtx({ persona: 'Reader', targetRank: 'Queen', myHand: hand });
    const rng = () => 0.99;
    const result = aiDecideOwnPlayFallback(ctx, rng);
    expect(result.truthState).toBe('honest');
    for (const c of result.cardsToPlay) {
      expect(c.rank).toBe('Queen');
    }
  });

  it('branch B: mixed hand + rng <= bluffBias → lying with 2 cards', () => {
    // Reader bluffBias = 0.35; rng returning 0.0 → 0.0 > 0.35 is false → branch 1 fails
    // targets.length >= 1 && nonTargets.length >= 1 → branch 2
    const hand = [
      makeCard('Queen', 'q0'),
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0'),
    ];
    const ctx = makeOwnPlayCtx({ persona: 'Reader', targetRank: 'Queen', myHand: hand });
    const rng = () => 0.0;
    const result = aiDecideOwnPlayFallback(ctx, rng);
    expect(result.truthState).toBe('lying');
    expect(result.claim.count).toBe(2);
    expect(result.cardsToPlay).toHaveLength(2);
    // One target + one non-target
    const hasTarget = result.cardsToPlay.some(c => c.rank === 'Queen');
    const hasNonTarget = result.cardsToPlay.some(c => c.rank !== 'Queen');
    expect(hasTarget).toBe(true);
    expect(hasNonTarget).toBe(true);
  });

  it('branch C: all-target hand → honest (even when rng fails bluff-bias check)', () => {
    // All 5 cards are Queens → nonTargets.length === 0, so branch 2 cannot activate
    // Branch 1 fails (rng=0.0 ≤ bluffBias), branch 2 fails (nonTargets empty), branch 3 triggers
    const hand = [
      makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('Queen', 'q2'),
      makeCard('Queen', 'q3'), makeCard('Queen', 'q4'),
    ];
    const ctx = makeOwnPlayCtx({ persona: 'Reader', targetRank: 'Queen', myHand: hand });
    const rng = () => 0.0;
    const result = aiDecideOwnPlayFallback(ctx, rng);
    expect(result.truthState).toBe('honest');
    for (const c of result.cardsToPlay) {
      expect(c.rank).toBe('Queen');
    }
  });

  it('branch D: zero targets → forced lie with 1 card', () => {
    // No Queens in hand at all → branch 4
    const hand = [
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'),
      makeCard('Jack', 'j0'), makeCard('Jack', 'j1'),
    ];
    const ctx = makeOwnPlayCtx({ persona: 'Reader', targetRank: 'Queen', myHand: hand });
    const result = aiDecideOwnPlayFallback(ctx);
    expect(result.truthState).toBe('lying');
    expect(result.claim.count).toBe(1);
    expect(result.cardsToPlay).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Invariant 6 — Fallback own-play card conservation
// ---------------------------------------------------------------------------

describe('invariant 6: fallback own-play card conservation', () => {
  const scenarios: Array<{ label: string; hand: Card[]; rng?: () => number }> = [
    {
      label: 'branch A (honest)',
      hand: [makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('King', 'k0'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0')],
      rng: () => 0.99,
    },
    {
      label: 'branch B (lying mixed)',
      hand: [makeCard('Queen', 'q0'), makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0')],
      rng: () => 0.0,
    },
    {
      label: 'branch C (all-targets, honest)',
      hand: [makeCard('Queen', 'q0'), makeCard('Queen', 'q1'), makeCard('Queen', 'q2'), makeCard('Queen', 'q3'), makeCard('Queen', 'q4')],
      rng: () => 0.0,
    },
    {
      label: 'branch D (forced lie)',
      hand: [makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'), makeCard('Jack', 'j0'), makeCard('Jack', 'j1')],
      rng: undefined,
    },
  ];

  for (const { label, hand, rng } of scenarios) {
    it(`cardsToPlay ⊆ myHand by identity — ${label}`, () => {
      const ctx = makeOwnPlayCtx({ persona: 'Reader', targetRank: 'Queen', myHand: hand });
      const result = rng ? aiDecideOwnPlayFallback(ctx, rng) : aiDecideOwnPlayFallback(ctx);

      // cardsToPlay.length === claim.count
      expect(result.cardsToPlay).toHaveLength(result.claim.count);

      // Every card in cardsToPlay must be === (identity) to some card in myHand
      for (const played of result.cardsToPlay) {
        const found = hand.some(h => h === played);
        expect(found).toBe(true);
      }

      // truthState === 'honest' iff every played card has rank === targetRank
      const allMatch = result.cardsToPlay.every(c => c.rank === ctx.targetRank);
      if (result.truthState === 'honest') {
        expect(allMatch).toBe(true);
      } else {
        expect(allMatch).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Invariant 10 — Voice lie-score absence = neutral 0.5
// ---------------------------------------------------------------------------

describe('invariant 10: voice lie-score absence = neutral 0.5', () => {
  it('undefined voiceMeta and lieScore=0.5 produce the same action and mathProb', () => {
    const claim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 0 };

    const ctxNoVoice = makeDecisionCtx({ claim: { ...claim, voiceMeta: undefined }, roundHistory: [claim] });
    const ctxNeutralVoice = makeDecisionCtx({
      claim: {
        ...claim,
        voiceMeta: {
          lieScore: 0.5,
          latencyMs: 0,
          fillerCount: 0,
          pauseCount: 0,
          speechRateWpm: 120,
          parsed: null,
        },
      },
      roundHistory: [claim],
    });

    const r1 = aiDecideOnClaimFallback(ctxNoVoice);
    const r2 = aiDecideOnClaimFallback(ctxNeutralVoice);

    expect(r1.action).toBe(r2.action);
    expect(r1.mathProb).toBe(r2.mathProb);
  });
});

// ---------------------------------------------------------------------------
// Invariant 12 — alreadyClaimed includes current claim
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ai-personas spec invariants (design.md §9 — I4, I7 partial, I8, I10 partial)
// ---------------------------------------------------------------------------

const PERSONAS_CANONICAL: Persona[] = ['Novice', 'Reader', 'Misdirector', 'Silent'];

describe('ai-personas I4 — persona difficulty monotone ordering (design.md §5)', () => {
  it('bluff-bias: Novice < Reader < Silent ≤ Misdirector', () => {
    expect(PERSONA_BLUFF_BIAS.Novice).toBeLessThan(PERSONA_BLUFF_BIAS.Reader);
    expect(PERSONA_BLUFF_BIAS.Reader).toBeLessThan(PERSONA_BLUFF_BIAS.Silent);
    expect(PERSONA_BLUFF_BIAS.Silent).toBeLessThanOrEqual(PERSONA_BLUFF_BIAS.Misdirector);
  });

  it('threshold: Silent < Misdirector ≤ Reader < Novice', () => {
    expect(PERSONA_THRESHOLDS.Silent).toBeLessThan(PERSONA_THRESHOLDS.Misdirector);
    expect(PERSONA_THRESHOLDS.Misdirector).toBeLessThanOrEqual(PERSONA_THRESHOLDS.Reader);
    expect(PERSONA_THRESHOLDS.Reader).toBeLessThan(PERSONA_THRESHOLDS.Novice);
  });
});

describe('ai-personas I7 partial — exhaustive persona coverage (math tables)', () => {
  it.each([
    ['PERSONA_WEIGHTS', PERSONA_WEIGHTS],
    ['PERSONA_THRESHOLDS', PERSONA_THRESHOLDS],
    ['PERSONA_BLUFF_BIAS', PERSONA_BLUFF_BIAS],
  ] as const)('%s has exactly the four canonical Persona keys', (_name, table) => {
    expect(Object.keys(table).sort()).toEqual(['Misdirector', 'Novice', 'Reader', 'Silent']);
  });
});

describe('ai-personas — exact locked values (design.md §5.1, §5.2, §5.3)', () => {
  it('PERSONA_WEIGHTS matches locked table', () => {
    expect(PERSONA_WEIGHTS.Novice).toEqual({ math: 0.7, voice: 0.3 });
    expect(PERSONA_WEIGHTS.Reader).toEqual({ math: 0.4, voice: 0.6 });
    expect(PERSONA_WEIGHTS.Misdirector).toEqual({ math: 0.5, voice: 0.5 });
    expect(PERSONA_WEIGHTS.Silent).toEqual({ math: 0.3, voice: 0.7 });
  });

  it('PERSONA_THRESHOLDS matches locked table', () => {
    expect(PERSONA_THRESHOLDS.Novice).toBe(0.70);
    expect(PERSONA_THRESHOLDS.Reader).toBe(0.55);
    expect(PERSONA_THRESHOLDS.Misdirector).toBe(0.50);
    expect(PERSONA_THRESHOLDS.Silent).toBe(0.45);
  });

  it('PERSONA_BLUFF_BIAS matches locked table', () => {
    expect(PERSONA_BLUFF_BIAS.Novice).toBe(0.10);
    expect(PERSONA_BLUFF_BIAS.Reader).toBe(0.35);
    expect(PERSONA_BLUFF_BIAS.Misdirector).toBe(0.60);
    expect(PERSONA_BLUFF_BIAS.Silent).toBe(0.55);
  });
});

describe('ai-personas I8 — neutral-signal challenge distribution (design.md §9)', () => {
  it('with mathProb=0.5 and voiceLie=0.5, combined score is 0.5 for all personas', () => {
    for (const p of PERSONAS_CANONICAL) {
      const { math: wm, voice: wv } = PERSONA_WEIGHTS[p];
      const combined = wm * 0.5 + wv * 0.5;
      expect(combined).toBe(0.5);
    }
  });

  it('exactly Misdirector and Silent challenge on neutral signal (2 of 4)', () => {
    const challengers: Persona[] = [];
    for (const p of PERSONAS_CANONICAL) {
      const { math: wm, voice: wv } = PERSONA_WEIGHTS[p];
      const combined = wm * 0.5 + wv * 0.5;
      if (combined >= PERSONA_THRESHOLDS[p]) challengers.push(p);
    }
    expect(challengers.sort()).toEqual(['Misdirector', 'Silent']);
  });
});

describe('ai-personas I10 partial — Clerk non-membership in math tables', () => {
  it.each([
    ['PERSONA_WEIGHTS', PERSONA_WEIGHTS],
    ['PERSONA_THRESHOLDS', PERSONA_THRESHOLDS],
    ['PERSONA_BLUFF_BIAS', PERSONA_BLUFF_BIAS],
  ] as const)('"Clerk" is not a key in %s', (_name, table) => {
    expect('Clerk' in (table as Record<string, unknown>)).toBe(false);
  });
});

describe('invariant 12: alreadyClaimed includes current claim', () => {
  it('current claim in roundHistory shifts result from 0.15 to mid-range or 0.95', () => {
    // Setup: AI has 0 Queens → outsideOwnHand = 5 - 0 = 5
    // claim.count = 1
    //
    // WITHOUT current claim in roundHistory: alreadyClaimed = 0, rs = 5 >= 3 → 0.15 (abundant)
    // WITH current claim in roundHistory: alreadyClaimed = 1 (the current claim itself),
    //   rs = 5 - 1 = 4 >= 3*1 = 3 → still 0.15... need more claims to push it to mid-range.
    //
    // Let's use a scenario where excluding the current claim gives 0.15 but including gives mid-range:
    // AI has 0 Queens, prior roundHistory already has 3 Queen claims counted (excluding current)
    // → If we don't include current (count=1): alreadyClaimed=3, rs=5-3=2 → mid-range
    //   But that's mid-range either way. Let's be precise:
    //
    // Scenario: AI has 0 Queens. Prior claims = 2 Queen-count-1 claims.
    // WITHOUT current (count=1): alreadyClaimed = 2, rs = 3 → rs >= 3*1=3 → 0.15 (abundant)
    // WITH current (count=1): alreadyClaimed = 3, rs = 2 → 1 <= 2 < 3 → mid-range
    //
    // This proves the function is including the current claim in roundHistory.

    const hand = [
      makeCard('King', 'k0'), makeCard('King', 'k1'), makeCard('Ace', 'a0'),
      makeCard('Jack', 'j0'), makeCard('Jack', 'j1'),
    ];

    const currentClaim: PublicClaim = { by: 'player', count: 1, claimedRank: 'Queen', timestamp: 100 };
    const priorClaims: PublicClaim[] = [
      { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 10 },
      { by: 'ai', count: 1, claimedRank: 'Queen', timestamp: 20 },
    ];

    // Without current claim in roundHistory (incorrect caller behaviour):
    const ctxWithout = makeDecisionCtx({
      myHand: hand,
      claim: currentClaim,
      roundHistory: priorClaims,
    });
    const probWithout = claimMathProbability(ctxWithout);
    expect(probWithout).toBe(0.15); // rs=3 → abundant → 0.15

    // With current claim in roundHistory (correct caller behaviour per §6):
    const ctxWith = makeDecisionCtx({
      myHand: hand,
      claim: currentClaim,
      roundHistory: [...priorClaims, currentClaim],
    });
    const probWith = claimMathProbability(ctxWith);
    // rs = 5 - 3 = 2 → 1 <= 2 < 3 → mid-range
    expect(probWith).toBeGreaterThan(0.15);
    expect(probWith).toBeLessThan(0.95);

    // The two results must differ, proving the current claim is factored in
    expect(probWith).not.toBe(probWithout);
  });
});
