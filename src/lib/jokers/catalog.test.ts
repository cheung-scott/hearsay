import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOKER_CATALOG } from './catalog';
import type { JokerType } from '../game/types';

const JOKER_TYPES: JokerType[] = [
  'poker_face', 'stage_whisper', 'earful', 'cold_read', 'second_wind',
];

// ---------------------------------------------------------------------------
// I13 drift guard — parse product.md "Session-Jokers" table at test-time so
// catalog.ts flavors can never silently diverge from the product spec.
// ---------------------------------------------------------------------------

/** Map from the bold display name in product.md to our catalog key. */
const DISPLAY_TO_KEY: Record<string, JokerType> = {
  'Poker Face':    'poker_face',
  'Stage Whisper': 'stage_whisper',
  'Earful':        'earful',
  'Cold Read':     'cold_read',
  'Second Wind':   'second_wind',
};

/**
 * Parse the "Session-Jokers (5 in MVP)" markdown table from product.md.
 * Returns a map of JokerType → raw Effect column text (whitespace-trimmed
 * at cell boundary only; inner whitespace preserved verbatim).
 *
 * Row format: | **Display Name** | Effect text here |
 */
function parseProductMdFlavors(): Record<JokerType, string> {
  const productMdPath = resolve(__dirname, '../../../.kiro/steering/product.md');
  const raw = readFileSync(productMdPath, 'utf-8');

  const result = {} as Record<JokerType, string>;

  for (const [displayName, jokerType] of Object.entries(DISPLAY_TO_KEY)) {
    // Escape special regex chars in displayName (none here, but defensive)
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: | **Display Name** | <effect cell> |
    const re = new RegExp(`\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|\\s*([^|]+?)\\s*\\|`);
    const m = raw.match(re);
    if (!m) {
      throw new Error(`catalog.test.ts: Could not find row for "${displayName}" in product.md`);
    }
    result[jokerType] = m[1];
  }

  return result;
}

describe('JOKER_CATALOG', () => {
  // -------------------------------------------------------------------------
  // 1. I13 drift guard (primary) — catalog flavor must match product.md verbatim
  // -------------------------------------------------------------------------
  describe('I13 drift guard — flavor matches product.md character-for-character', () => {
    const productFlavors = parseProductMdFlavors();

    for (const type of JOKER_TYPES) {
      it(`${type} flavor matches product.md`, () => {
        expect(JOKER_CATALOG[type].flavor).toBe(productFlavors[type]);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. Catalog shape — exactly 5 entries with expected keys
  // -------------------------------------------------------------------------
  describe('catalog shape', () => {
    it('has exactly 5 entries', () => {
      expect(Object.keys(JOKER_CATALOG)).toHaveLength(5);
    });

    it('contains exactly the 5 expected JokerType keys', () => {
      const keys = new Set(Object.keys(JOKER_CATALOG));
      const expected = new Set<string>(['poker_face', 'stage_whisper', 'earful', 'cold_read', 'second_wind']);
      expect(keys).toEqual(expected);
    });

    it('each entry .type matches its catalog key', () => {
      for (const type of JOKER_TYPES) {
        expect(JOKER_CATALOG[type].type).toBe(type);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. accentVar format — must be a valid CSS custom property starting --joker-
  // -------------------------------------------------------------------------
  describe('accentVar format', () => {
    it('each accentVar matches /^--joker-[a-z_-]+$/', () => {
      for (const type of JOKER_TYPES) {
        expect(JOKER_CATALOG[type].accentVar).toMatch(/^--joker-[a-z_-]+$/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Flavor length cap — DEFERRED (spec drift flag)
  //
  // Three product.md flavors exceed 80 chars (poker_face: 88, stage_whisper: 112,
  // cold_read: 87). The standalone assertion is skipped pending Scott's resolution
  // of the cross-spec drift flagged at the top of .kiro/specs/joker-system/tasks.md.
  // Re-enable by changing `it.skip` → `it` once drift is resolved.
  // -------------------------------------------------------------------------
  it.skip('flavor strings are ≤ 80 chars — DEFERRED per drift flag in tasks.md', () => {
    // TODO: un-skip once Scott resolves the cross-spec drift:
    // (a) shorten product.md flavors to ≤80, OR
    // (b) raise the cap in design.md §4 + Requirement 1.2, OR
    // (c) resync product.md to design.md §5's courtroom flavors (all ≤80).
    // See: .kiro/specs/joker-system/tasks.md § "⚠ Spec drift flag"
    for (const type of JOKER_TYPES) {
      expect(JOKER_CATALOG[type].flavor.length).toBeLessThanOrEqual(80);
    }
  });

  // -------------------------------------------------------------------------
  // 5. v1 default fields — all 5 jokers ship with visibleOnActivate:true, cost.kind:'none'
  // -------------------------------------------------------------------------
  describe('v1 default fields', () => {
    it('all entries have visibleOnActivate === true', () => {
      for (const type of JOKER_TYPES) {
        expect(JOKER_CATALOG[type].visibleOnActivate).toBe(true);
      }
    });

    it('all entries have cost.kind === "none"', () => {
      for (const type of JOKER_TYPES) {
        expect(JOKER_CATALOG[type].cost.kind).toBe('none');
      }
    });
  });
});
