import type { Rank } from './types';

// Count-word → integer map for claim parsing.
export const WORD_TO_NUM: Record<string, 1 | 2> = {
  one: 1, two: 2, '1': 1, '2': 2,
};

// Claim parse regex — architecture §5.2 verbatim.
// Matches: "one queen", "ONE queen", "1 queen", "two kings", "1 queen!", "uh, one queen.".
// Word-boundaries prevent "one queenly" or "butonequeen".
// Trailing "s?" accepts both singular ("One queen") and plural ("Two queens") forms.
export const CLAIM_REGEX = /\b(one|two|1|2)\s+(queen|king|ace|jack)s?\b/i;

/**
 * Parse a player's voice transcript into a structured claim. Returns null if
 * the transcript doesn't contain a valid claim phrase.
 *
 * Pure. No I/O. Stateless regex (uses .match(), not .exec()).
 */
export function parseClaim(transcript: string): { count: 1 | 2; rank: Rank } | null {
  const m = transcript.toLowerCase().match(CLAIM_REGEX);
  if (!m) return null;
  const count = WORD_TO_NUM[m[1]];
  const rank = (m[2][0].toUpperCase() + m[2].slice(1)) as Rank;
  return { count, rank };
}
