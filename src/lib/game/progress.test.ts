// @vitest-environment jsdom
//
// Unit tests for the gauntlet progress module (Option B localStorage).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadProgress,
  saveProgress,
  clearProgress,
  nextPersona,
  currentCaseNumber,
  isGauntletComplete,
  GAUNTLET_ORDER,
  GAUNTLET_LENGTH,
  __PROGRESS_INTERNAL,
} from './progress';

const KEY = __PROGRESS_INTERNAL.LOCALSTORAGE_KEY;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// loadProgress
// ---------------------------------------------------------------------------

describe('loadProgress', () => {
  it('returns { defeated: [] } when localStorage is empty', () => {
    expect(loadProgress()).toEqual({ defeated: [] });
  });

  it('returns { defeated: [] } when stored JSON is invalid', () => {
    localStorage.setItem(KEY, 'not-json{{{');
    expect(loadProgress()).toEqual({ defeated: [] });
  });

  it('returns { defeated: [] } when stored object has wrong shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ defeated: 'not-an-array' }));
    expect(loadProgress()).toEqual({ defeated: [] });
  });

  it('returns { defeated: [] } when defeated array contains invalid persona strings', () => {
    localStorage.setItem(KEY, JSON.stringify({ defeated: ['Hacker', 'INVALID'] }));
    expect(loadProgress()).toEqual({ defeated: [] });
  });

  it('returns the stored progress when it is valid', () => {
    const stored = { defeated: ['Novice', 'Reader'] };
    localStorage.setItem(KEY, JSON.stringify(stored));
    expect(loadProgress()).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
// saveProgress + loadProgress round-trip
// ---------------------------------------------------------------------------

describe('saveProgress / loadProgress round-trip', () => {
  it('persists and reloads a partial defeat list', () => {
    const progress = { defeated: ['Novice' as const] };
    saveProgress(progress);
    expect(loadProgress()).toEqual(progress);
  });

  it('persists and reloads a full defeat list', () => {
    const progress = { defeated: [...GAUNTLET_ORDER] as typeof GAUNTLET_ORDER[number][] };
    saveProgress(progress);
    expect(loadProgress()).toEqual(progress);
  });

  it('overwrites a previous save', () => {
    saveProgress({ defeated: ['Novice'] });
    saveProgress({ defeated: ['Novice', 'Reader'] });
    expect(loadProgress()).toEqual({ defeated: ['Novice', 'Reader'] });
  });
});

// ---------------------------------------------------------------------------
// clearProgress
// ---------------------------------------------------------------------------

describe('clearProgress', () => {
  it('removes the stored progress so loadProgress returns default', () => {
    saveProgress({ defeated: ['Novice'] });
    clearProgress();
    expect(loadProgress()).toEqual({ defeated: [] });
  });

  it('is idempotent when nothing was stored', () => {
    expect(() => clearProgress()).not.toThrow();
    expect(loadProgress()).toEqual({ defeated: [] });
  });
});

// ---------------------------------------------------------------------------
// nextPersona
// ---------------------------------------------------------------------------

describe('nextPersona', () => {
  it('returns Novice when no personas have been defeated', () => {
    expect(nextPersona({ defeated: [] })).toBe('Novice');
  });

  it('returns Reader after Novice is defeated', () => {
    expect(nextPersona({ defeated: ['Novice'] })).toBe('Reader');
  });

  it('returns Misdirector after Novice + Reader defeated', () => {
    expect(nextPersona({ defeated: ['Novice', 'Reader'] })).toBe('Misdirector');
  });

  it('returns Silent after first three defeated', () => {
    expect(nextPersona({ defeated: ['Novice', 'Reader', 'Misdirector'] })).toBe('Silent');
  });

  it('returns null when all 4 personas are defeated', () => {
    expect(nextPersona({ defeated: ['Novice', 'Reader', 'Misdirector', 'Silent'] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// currentCaseNumber
// ---------------------------------------------------------------------------

describe('currentCaseNumber', () => {
  it('returns 1 when no personas defeated', () => {
    expect(currentCaseNumber({ defeated: [] })).toBe(1);
  });

  it('returns 2 after 1 defeat', () => {
    expect(currentCaseNumber({ defeated: ['Novice'] })).toBe(2);
  });

  it('returns GAUNTLET_LENGTH (4) when all 4 are defeated (clamped, not 5)', () => {
    // complete state: defeated.length = 4, Math.min(5, 4) = 4
    expect(currentCaseNumber({ defeated: ['Novice', 'Reader', 'Misdirector', 'Silent'] })).toBe(GAUNTLET_LENGTH);
  });

  it('returns 4 (not 5) when gauntlet is complete — clamped', () => {
    const complete = { defeated: [...GAUNTLET_ORDER] as typeof GAUNTLET_ORDER[number][] };
    const caseNum = currentCaseNumber(complete);
    expect(caseNum).toBeLessThanOrEqual(GAUNTLET_LENGTH);
    expect(caseNum).toBe(GAUNTLET_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// isGauntletComplete
// ---------------------------------------------------------------------------

describe('isGauntletComplete', () => {
  it('returns false when defeated is empty', () => {
    expect(isGauntletComplete({ defeated: [] })).toBe(false);
  });

  it('returns false when only 3 personas defeated', () => {
    expect(isGauntletComplete({ defeated: ['Novice', 'Reader', 'Misdirector'] })).toBe(false);
  });

  it('returns true when all 4 personas are defeated', () => {
    expect(isGauntletComplete({ defeated: ['Novice', 'Reader', 'Misdirector', 'Silent'] })).toBe(true);
  });

  it('returns true when defeated.length exceeds GAUNTLET_LENGTH (defensive)', () => {
    // Defensive: should not happen in practice but must handle gracefully.
    expect(
      isGauntletComplete({
        defeated: ['Novice', 'Reader', 'Misdirector', 'Silent', 'Novice'],
      }),
    ).toBe(true);
  });
});
