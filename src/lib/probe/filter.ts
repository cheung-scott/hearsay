// Reasoning filter (probe-phase spec §5).
//
// The information-security gatekeeper between server-only `llmReasoning` and
// client-visible `revealedReasoning`. Pure, deterministic, never throws.
//
// Lanes (priority order):
//   1. llm-heuristic-layer — structured `[heuristic: ...]`-prefixed input.
//      Forward-compatible with the ai-opponent §11 Q6 extension; re-uses
//      the numeric + persona scrub to guarantee invariants across every lane.
//   2. regex-scrub        — sanitize verbose prose (§5.2 pipeline).
//   3. fallback-static    — persona-agnostic template chosen by mathProb.
//
// Invariants (§5.4):
//   - output never contains any char in `[0-9%]`
//   - output never contains any canonical persona literal (case-insensitive)
//   - output is always non-empty, ≤ 120 chars
//   - filter is pure and never throws

import type { Persona } from '../game/types';
import type { ProbeFilter, ProbeFilterSource } from './types';

// ---------------------------------------------------------------------------
// Scrub patterns (§5.2)
// ---------------------------------------------------------------------------

const NUMERIC_PATTERNS: RegExp[] = [
  /\b\d+(?:\.\d+)?%/g,              // "34%" / "0.5%"
  /\b0?\.\d{1,3}\b/g,               // "0.34" / ".34"
  /\b\d{2,3}\.\d+\b/g,              // "12.34" — decimals ≥ 2 digits before point
  /\bprob(?:ability)?\s*:\s*[\d.]+/gi, // "prob: 0.34" / "probability: 0.5"
];

const PERSONA_IDENTIFIERS: RegExp[] = [
  /\b(?:Novice|Reader|Misdirector|Silent)\b/gi,
  /\bpersona\b/gi,
];

const DEBUG_ARTIFACTS: RegExp[] = [
  /\bmathProb\b/gi,
  /\blieScore\b/gi,
  /\bvoiceMeta\b/gi,
  /```[\s\S]*?```/g, // code fences that sometimes wrap math dumps
];

// Matches ANY remaining digit or percent char; guarantees invariant I2 even
// when the enumerated patterns miss a novel shape (e.g. "1/3", "7 of 10").
const ANY_DIGIT_OR_PERCENT = /[0-9%]/g;

// Hard output ceiling (§5.2 step 6).
const MAX_OUTPUT_LENGTH = 120;

// Minimum viable regex-scrub output; below this we fall through to static (§5.2).
const MIN_SCRUBBED_LENGTH = 8;

// Default decay for filter-lane selector; the actual 4s window is enforced by
// `buildActiveProbe` in reveal.ts — this file only sees raw string inputs.

// ---------------------------------------------------------------------------
// Heuristic-layer extraction (lane 1, §5.1)
// ---------------------------------------------------------------------------

/**
 * Structured marker convention for v1 (forward-compat with ai-opponent Q6):
 *   "[heuristic: the claim felt too casual]"
 * The LLM (when extended) wraps a 1-sentence vibes-only payload in the marker;
 * everything outside the marker is ignored for this lane.
 *
 * Returns the inner payload, or `null` if no marker is present.
 */
function extractHeuristicLayer(raw: string): string | null {
  const match = /\[heuristic\s*:\s*([^\]]+)\]/i.exec(raw);
  if (!match) return null;
  const inner = match[1]?.trim();
  if (!inner) return null;
  return inner;
}

// ---------------------------------------------------------------------------
// Regex scrub pipeline (lane 2, §5.2)
// ---------------------------------------------------------------------------

function scrub(input: string): string {
  let s = input;
  for (const r of NUMERIC_PATTERNS) s = s.replace(r, '');
  for (const r of PERSONA_IDENTIFIERS) s = s.replace(r, '');
  for (const r of DEBUG_ARTIFACTS) s = s.replace(r, '');
  // Belt-and-braces: strip any residual digits or percent chars so I2 holds
  // even for patterns the enumerated regexes missed.
  s = s.replace(ANY_DIGIT_OR_PERCENT, '');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  // Truncate to first sentence (split on end-punct + whitespace).
  const firstSentence = s.split(/[.!?]\s/)[0] ?? s;
  s = firstSentence.trim();
  // Hard cap.
  if (s.length > MAX_OUTPUT_LENGTH) {
    s = s.slice(0, MAX_OUTPUT_LENGTH).trim();
  }
  return s;
}

// ---------------------------------------------------------------------------
// Static fallback (lane 3, §5.3)
// ---------------------------------------------------------------------------

function staticFallback(mathProb: number): string {
  if (Number.isFinite(mathProb) && mathProb >= 0.7) {
    return '*Something feels off about this one.*';
  }
  if (Number.isFinite(mathProb) && mathProb <= 0.3) {
    return '*The numbers look fine.*';
  }
  return '*Hard to say.*';
}

// ---------------------------------------------------------------------------
// Public filter
// ---------------------------------------------------------------------------

/**
 * Project a raw `llmReasoning` string into a client-safe snippet. Pure +
 * never-throwing — all error paths route to the static fallback.
 *
 * `persona` is currently informational (we scrub literals regardless) but is
 * retained in the signature so a future lane can condition template selection
 * on persona without a signature break.
 */
export const probeFilter: ProbeFilter = (rawLlmReasoning, _persona, mathProb) => {
  try {
    // Lane 3 short-circuit: nothing to filter.
    if (typeof rawLlmReasoning !== 'string' || rawLlmReasoning.length === 0) {
      return {
        revealedReasoning: staticFallback(mathProb),
        filterSource: 'fallback-static',
      };
    }

    // Lane 1: structured heuristic marker.
    const heuristic = extractHeuristicLayer(rawLlmReasoning);
    if (heuristic !== null) {
      const scrubbed = scrub(heuristic);
      if (scrubbed.length >= 1) {
        return {
          revealedReasoning: scrubbed,
          filterSource: 'llm-heuristic-layer',
        };
      }
      // Heuristic was entirely numbers / personas → fall through to static.
      return {
        revealedReasoning: staticFallback(mathProb),
        filterSource: 'fallback-static',
      };
    }

    // Lane 2: regex scrub on full prose.
    const scrubbed = scrub(rawLlmReasoning);
    if (scrubbed.length >= MIN_SCRUBBED_LENGTH) {
      return { revealedReasoning: scrubbed, filterSource: 'regex-scrub' };
    }

    // Lane 3: static fallback.
    return {
      revealedReasoning: staticFallback(mathProb),
      filterSource: 'fallback-static',
    };
  } catch {
    // Defense in depth — filter must never throw (§5.4, invariant I6).
    return {
      revealedReasoning: staticFallback(mathProb),
      filterSource: 'fallback-static',
    };
  }
};

// Internal exports for white-box testing (test file imports these directly).
export const __internal = {
  NUMERIC_PATTERNS,
  PERSONA_IDENTIFIERS,
  DEBUG_ARTIFACTS,
  MAX_OUTPUT_LENGTH,
  MIN_SCRUBBED_LENGTH,
  extractHeuristicLayer,
  scrub,
  staticFallback,
} as const;

/** Expose for the reveal.ts helper to satisfy tests without importing ProbeFilterSource twice. */
export type { ProbeFilterSource };
