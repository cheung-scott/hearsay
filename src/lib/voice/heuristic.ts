// Voice-tell-taxonomy spec §3 — STT metadata → 0..1 lie-score.
// Pure function. No I/O. Fully tested in heuristic.test.ts.

// Matches common filler words used in deception-research literature + everyday
// hesitation markers. Word-boundary anchored to avoid 'umbrella', 'soft',
// 'likewise', etc. Global + case-insensitive — callers typically use
// `text.match(FILLER_REGEX) ?? []` to count.
export const FILLER_REGEX = /\b(uh|um|er|like|so|you know|kinda|i mean)\b/gi;

export interface LieScoreInput {
  /** turn_start_event → first_non_silence_frame, in milliseconds. */
  latencyMs: number;
  /** FILLER_REGEX.global matches in the final transcript. */
  fillerCount: number;
  /** Inter-word gaps > 400ms, excluding the initial latency window. */
  pauseCount: number;
  /** Total words / (audio seconds / 60). */
  speechRateWpm: number;
}

/**
 * Weighted sum of four signals → `lieScore ∈ [0, 1]`:
 *   - latency:     40%  (saturation at 2000ms)
 *   - fillers:     30%  (saturation at 3 hits)
 *   - pauses:      20%  (saturation at 3)
 *   - rate-binary: 10%  (1 iff <120 or >220 wpm, else 0)
 *
 * Higher = more nervous-sounding = more likely lying. Callers combine with
 * `claimMathProbability` via persona weights in `ai-opponent` / `ai-personas`.
 */
export function computeLieScore(m: LieScoreInput): number {
  const lat = Math.min(m.latencyMs / 2000, 1);
  const fil = Math.min(m.fillerCount / 3, 1);
  const pau = Math.min(m.pauseCount / 3, 1);
  const rat = m.speechRateWpm < 120 || m.speechRateWpm > 220 ? 1 : 0;
  // Integer weights (4/3/2/1) summing to 10, divided once at the end. Avoids
  // the IEEE-754 drift where 0.4+0.3+0.2+0.1 === 0.9999999999999999 and
  // guarantees saturation → exactly 1.0 per spec §4 invariant 8.
  return (4 * lat + 3 * fil + 2 * pau + 1 * rat) / 10;
}
