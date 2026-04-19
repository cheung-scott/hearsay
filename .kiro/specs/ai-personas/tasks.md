# ai-personas — Tasks

## Task inventory

- [ ] 1. Create `src/lib/persona/accentColors.ts` — new accent-color module
- [ ] 2. Create `src/lib/persona/accentColors.test.ts` — accent-color invariant tests
- [ ] 3. Add voice-ID drift-check assertions to `src/lib/voice/presets.test.ts`
- [ ] 4. Add display-name drift-check assertions to `src/lib/persona/displayNames.test.ts`
- [ ] 5. Add math-table drift-check assertions to `src/lib/ai/math.test.ts`
- [ ] 6. Add dialogue-variant count assertions to `src/lib/ai/constants.test.ts`
- [ ] 7. Checkpoint — run full test suite
- [ ] 8. Add brain-isolation static assertion to `src/lib/voice/presets.test.ts`
- [ ]* 9. Add exact-value snapshot assertions for all locked tables

---

## Task details

### 1. Create `src/lib/persona/accentColors.ts` — new accent-color module

_Requirements: 4.1, 4.2_

Create `src/lib/persona/accentColors.ts` with a single named export:

```ts
import type { Persona } from '../game/types';

export const PERSONA_ACCENT_COLORS: Record<Persona, string> = {
  Novice:      '#8ca880',
  Reader:      '#b57c3a',
  Misdirector: '#6b4a9e',
  Silent:      '#1e2a3a',
};
```

Include a comment block documenting the color rationale per design.md §7.3 (olive/amber/violet/navy). No other exports. No runtime logic.

**Files:** `src/lib/persona/accentColors.ts` (NEW)
**Constraint:** This spec introduces ZERO changes to `src/lib/game/types.ts` or `src/lib/game/fsm.ts`.

---

### 2. Create `src/lib/persona/accentColors.test.ts` — accent-color invariant tests

_Requirements: 1.2, 4.2, 4.3_

Create `src/lib/persona/accentColors.test.ts` covering:

- **I6 — format:** Every value matches `/^#[0-9a-f]{6}$/i`; all four pairwise distinct (`new Set(values).size === 4`).
- **I6 — exact values:** Assert each persona maps to its locked hex from design.md §7.3.
- **I7 (partial) — exhaustive coverage:** `Object.keys(PERSONA_ACCENT_COLORS).sort()` equals `['Misdirector', 'Novice', 'Reader', 'Silent']`.

Run `pnpm vitest run src/lib/persona/accentColors.test.ts` — all tests must pass.

**Files:** `src/lib/persona/accentColors.test.ts` (NEW)

---

### 3. Add voice-ID drift-check assertions to `src/lib/voice/presets.test.ts`

_Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_

Add new `describe` blocks to the existing `src/lib/voice/presets.test.ts`:

- **I2 — distinctness:** `new Set([...Object.values(PERSONA_VOICE_IDS), CLERK_VOICE_ID]).size === 5`.
- **I3 — format:** Every voice ID (4 personas + Clerk) matches `/^[A-Za-z0-9]{20}$/`. Reject empty, `'TBD'`, whitespace.
- **I7 (partial) — exhaustive coverage:** `Object.keys(PERSONA_VOICE_IDS).sort()` equals the canonical four. Also check `Object.keys(VOICE_PRESETS).sort()`.
- **I10 — Clerk non-membership:** `('Clerk' as any) in PERSONA_VOICE_IDS === false`, `('Clerk' as any) in VOICE_PRESETS === false`.
- **Exact-value lock (req 2.1, 2.2):** Assert each `PERSONA_VOICE_IDS[p]` matches the locked ID from design.md §6.1. Assert `CLERK_VOICE_ID === 'Al9pMcZxV70KAzzehiTE'`.

Import `CLERK_VOICE_ID` (add to existing import if needed).

Run `pnpm vitest run src/lib/voice/presets.test.ts` — all tests must pass.

**Files:** `src/lib/voice/presets.test.ts` (MODIFY — add assertions only)

---

### 4. Add display-name drift-check assertions to `src/lib/persona/displayNames.test.ts`

_Requirements: 1.2, 3.1, 3.2_

Add to the existing `src/lib/persona/displayNames.test.ts`:

- **I5 — prefix + uniqueness:** Every value `startsWith('The ')`. `new Set(Object.values(PERSONA_DISPLAY_NAMES)).size === 4`.
- **I7 (partial) — exhaustive coverage:** `Object.keys(PERSONA_DISPLAY_NAMES).sort()` equals the canonical four (already present — confirm, don't duplicate).
- **I10 (partial) — Clerk non-membership:** `('Clerk' as any) in PERSONA_DISPLAY_NAMES === false`.

The existing test already asserts exact courtroom names (req 3.1) — do not duplicate, just add the missing prefix/uniqueness/Clerk checks.

Run `pnpm vitest run src/lib/persona/displayNames.test.ts` — all tests must pass.

**Files:** `src/lib/persona/displayNames.test.ts` (MODIFY — add assertions only)

---

### 5. Add math-table drift-check assertions to `src/lib/ai/math.test.ts`

_Requirements: 1.2, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

Add new `describe` blocks to the existing `src/lib/ai/math.test.ts`. Import `PERSONA_THRESHOLDS` and `PERSONA_BLUFF_BIAS` (add to existing import).

- **I1 — weights sum:** Already present (invariant 1 block) — confirm, don't duplicate.
- **I4 — ordering monotone:**
  - Bluff-bias: `Novice(0.10) < Reader(0.35) < Silent(0.55) ≤ Misdirector(0.60)`.
  - Threshold: `Silent(0.45) < Misdirector(0.50) ≤ Reader(0.55) < Novice(0.70)`.
- **I7 (partial) — exhaustive coverage:** `Object.keys(PERSONA_WEIGHTS).sort()`, `Object.keys(PERSONA_THRESHOLDS).sort()`, `Object.keys(PERSONA_BLUFF_BIAS).sort()` each equal the canonical four.
- **I8 — balance sanity:** With `mathProb = 0.5`, `voiceLie = 0.5`, compute `combined = w.math * 0.5 + w.voice * 0.5` per persona. Assert `combined === 0.5` for all. Count personas where `combined >= threshold` — assert exactly 2 (Misdirector + Silent).
- **I10 (partial) — Clerk non-membership:** `('Clerk' as any) in PERSONA_WEIGHTS === false`, same for THRESHOLDS and BLUFF_BIAS.
- **Exact-value lock (req 5.2, 5.3, 5.4):** Assert each persona's weight/threshold/bluff-bias matches the locked values from design.md §5.

Run `pnpm vitest run src/lib/ai/math.test.ts` — all tests must pass.

**Files:** `src/lib/ai/math.test.ts` (MODIFY — add assertions only)

---

### 6. Add dialogue-variant count assertions to `src/lib/ai/constants.test.ts`

_Requirements: 1.2, 6.1_

Add a new `describe` block to the existing `src/lib/ai/constants.test.ts`. Import `templateHonest` and `templateLie` from `./constants`.

- **I9 — variant count:** For every `(persona, truthState)` pair, invoke the template function with rng stubs returning `0.0`, `0.25`, `0.5`, `0.75`. Collect 4 outputs; assert `new Set(outputs).size === 4` (four distinct strings).
- **I7 (partial) — exhaustive coverage:** `Object.keys(PERSONA_DESCRIPTIONS).sort()` equals the canonical four.

Run `pnpm vitest run src/lib/ai/constants.test.ts` — all tests must pass.

**Files:** `src/lib/ai/constants.test.ts` (MODIFY — add assertions only)

---

### 7. Checkpoint — run full test suite

_Requirements: all_

Run `pnpm vitest run` across the entire project. All existing tests plus all new/modified tests from tasks 1–6 must pass. Zero regressions.

**Files:** none (verification only)

---

### 8. Add brain-isolation static assertion to `src/lib/voice/presets.test.ts`

_Requirements: 7.1_

Add a test that reads `src/lib/ai/brain.ts` as a string (via `fs.readFileSync`) and asserts it does NOT contain import references to `PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, or `PERSONA_ACCENT_COLORS`. This is a static-analysis guard — the brain must stay presentation-free.

Run `pnpm vitest run src/lib/voice/presets.test.ts` — all tests must pass.

**Files:** `src/lib/voice/presets.test.ts` (MODIFY — add one describe block)

---

### 9. _(Optional)_ Add exact-value snapshot assertions for all locked tables

_Requirements: 2.1, 2.2, 3.1, 4.2, 5.2, 5.3, 5.4_

Add a single `describe('locked-table snapshots')` block in a new file `src/lib/persona/lockedTables.test.ts` that imports all six `Record<Persona, X>` tables + `CLERK_VOICE_ID` and asserts them against inline snapshots (`toMatchInlineSnapshot`). This provides a single-file "canary" if any locked value drifts.

This task is optional — the per-file exact-match assertions in tasks 2–6 already cover the same ground. This is a convenience aggregation.

**Files:** `src/lib/persona/lockedTables.test.ts` (NEW, optional)
