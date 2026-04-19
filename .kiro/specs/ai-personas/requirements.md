# ai-personas — Requirements (EARS format)

## Provenance

Derived from `.kiro/specs/ai-personas/design.md` §4 (data model), §5 (decision-weight tables), §6 (voice-ID bindings), §7 (integration points), §9 (invariants I1–I10). Cross-referenced against shipped source: `src/lib/voice/presets.ts`, `src/lib/persona/displayNames.ts`, `src/lib/ai/math.ts`, `src/lib/ai/constants.ts`, `src/lib/game/types.ts`.

---

## 1. Persona Roster Integrity

### 1.1 Persona union lock
The system SHALL treat the `Persona` type union `'Novice' | 'Reader' | 'Misdirector' | 'Silent'` in `src/lib/game/types.ts` as the single source of truth for playable AI opponents. This spec introduces ZERO changes to `src/lib/game/types.ts` or `src/lib/game/fsm.ts`.

**Acceptance criteria:**
- No file in this spec's changeset modifies `src/lib/game/types.ts` or `src/lib/game/fsm.ts`.

### 1.2 Exhaustive Persona coverage (I7)
Every `Record<Persona, X>` table — `PERSONA_WEIGHTS`, `PERSONA_THRESHOLDS`, `PERSONA_BLUFF_BIAS`, `PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, `PERSONA_ACCENT_COLORS`, `VOICE_PRESETS`, `PERSONA_DESCRIPTIONS` — SHALL have `Object.keys(TABLE).sort()` equal to `['Misdirector', 'Novice', 'Reader', 'Silent']` at runtime.

**Acceptance criteria:**
- A Vitest assertion per table confirms the sorted key set matches the canonical four-element array.

### 1.3 Clerk non-membership (I10)
`CLERK_VOICE_ID` SHALL NOT appear as a key in any `Record<Persona, X>` table. The string `'Clerk'` SHALL NOT be a valid key in `PERSONA_WEIGHTS`, `VOICE_PRESETS`, `PERSONA_DISPLAY_NAMES`, or `PERSONA_ACCENT_COLORS`.

**Acceptance criteria:**
- A Vitest negative assertion confirms `('Clerk' as any) in TABLE === false` for each table.

---

## 2. Voice-ID Bindings

### 2.1 Voice-ID values locked
`PERSONA_VOICE_IDS` in `src/lib/voice/presets.ts` SHALL export the following hardcoded values (design.md §6.1):

| Persona | Voice ID |
|---|---|
| Novice | `Lrx118tn6NTNAXspnuEN` |
| Reader | `NxGA8X3YhTrnf3TRQf6Q` |
| Misdirector | `0Q0MDAMrmHYYHDqFoGUx` |
| Silent | `0XMldg7YUhIHRMJqiWHr` |

**Acceptance criteria:**
- Vitest snapshot or exact-match assertion per persona confirms the locked IDs.

### 2.2 Clerk voice-ID locked
`CLERK_VOICE_ID` SHALL equal `'Al9pMcZxV70KAzzehiTE'`.

**Acceptance criteria:**
- Vitest exact-match assertion confirms the value.

### 2.3 Voice-ID distinctness (I2)
The set `{ PERSONA_VOICE_IDS.Novice, PERSONA_VOICE_IDS.Reader, PERSONA_VOICE_IDS.Misdirector, PERSONA_VOICE_IDS.Silent, CLERK_VOICE_ID }` SHALL have cardinality 5 (all pairwise distinct).

**Acceptance criteria:**
- Vitest assertion confirms `new Set([...Object.values(PERSONA_VOICE_IDS), CLERK_VOICE_ID]).size === 5`.

### 2.4 Voice-ID format (I3)
Every voice ID (four personas + Clerk) SHALL match the regex `/^[A-Za-z0-9]{20}$/`. Empty strings, `'TBD'` placeholders, and whitespace-padded values SHALL be rejected.

**Acceptance criteria:**
- Vitest assertion per ID confirms regex match.

---

## 3. Display Names

### 3.1 Display-name values locked
`PERSONA_DISPLAY_NAMES` in `src/lib/persona/displayNames.ts` SHALL export:

| Persona | Display name |
|---|---|
| Novice | The Defendant |
| Reader | The Prosecutor |
| Misdirector | The Attorney |
| Silent | The Judge |

**Acceptance criteria:**
- Vitest exact-match assertion per persona (already partially present — extend with prefix + uniqueness).

### 3.2 Display-name format (I5)
All four values SHALL be non-empty strings, pairwise distinct, and each SHALL start with the prefix `"The "`.

**Acceptance criteria:**
- Vitest assertions: non-empty, `new Set(values).size === 4`, each `startsWith('The ')`.

---

## 4. Accent Colors

### 4.1 Accent-color module
The system SHALL export `PERSONA_ACCENT_COLORS: Record<Persona, string>` from a new file `src/lib/persona/accentColors.ts`.

**Acceptance criteria:**
- File exists, exports the named constant, TypeScript compiles without error.

### 4.2 Accent-color values
`PERSONA_ACCENT_COLORS` SHALL contain the following values (design.md §7.3):

| Persona | Accent hex |
|---|---|
| Novice | `#8ca880` |
| Reader | `#b57c3a` |
| Misdirector | `#6b4a9e` |
| Silent | `#1e2a3a` |

**Acceptance criteria:**
- Vitest exact-match assertion per persona.

### 4.3 Accent-color format (I6)
Every value SHALL match `/^#[0-9a-f]{6}$/i`; all four SHALL be pairwise distinct.

**Acceptance criteria:**
- Vitest regex assertion per value + `new Set(values).size === 4`.

---

## 5. Decision-Weight Tables (Ratification)

### 5.1 PERSONA_WEIGHTS sum (I1)
For every Persona `p`, `PERSONA_WEIGHTS[p].math + PERSONA_WEIGHTS[p].voice` SHALL equal `1.0` (within `Number.EPSILON` tolerance).

**Acceptance criteria:**
- Vitest assertion per persona (already present in `math.test.ts` — ratified here as canonical).

### 5.2 PERSONA_WEIGHTS locked values
`PERSONA_WEIGHTS` SHALL contain: Novice `{0.7, 0.3}`, Reader `{0.4, 0.6}`, Misdirector `{0.5, 0.5}`, Silent `{0.3, 0.7}`.

**Acceptance criteria:**
- Vitest exact-match assertion per persona.

### 5.3 PERSONA_THRESHOLDS locked values
`PERSONA_THRESHOLDS` SHALL contain: Novice `0.70`, Reader `0.55`, Misdirector `0.50`, Silent `0.45`.

**Acceptance criteria:**
- Vitest exact-match assertion per persona.

### 5.4 PERSONA_BLUFF_BIAS locked values
`PERSONA_BLUFF_BIAS` SHALL contain: Novice `0.10`, Reader `0.35`, Misdirector `0.60`, Silent `0.55`.

**Acceptance criteria:**
- Vitest exact-match assertion per persona.

### 5.5 Persona ordering — difficulty monotone (I4)
Bluff-bias: `Novice < Reader < Silent ≤ Misdirector`. Threshold: `Silent < Misdirector ≤ Reader < Novice`.

**Acceptance criteria:**
- Vitest chained inequality assertions for both orderings.

### 5.6 Balance sanity — neutral-signal challenge distribution (I8)
With `mathProb = 0.5` and `voiceLie = 0.5`, the combined score for every persona equals `0.5`. Exactly 2 of 4 personas (Misdirector + Silent) have `threshold ≤ 0.5` and therefore challenge on neutral signal; Novice + Reader accept.

**Acceptance criteria:**
- Vitest assertion: compute combined score per persona, count those where `combined >= threshold`, assert count === 2 and the challengers are Misdirector and Silent.

---

## 6. Dialogue Variants (Documentation-Only Ratification)

### 6.1 Dialogue-variant count (I9)
For every `(persona, truthState)` pair, invoking `templateHonest` / `templateLie` with rng stubs returning `0.0, 0.25, 0.5, 0.75` SHALL produce four distinct strings.

**Acceptance criteria:**
- Vitest assertion: for each persona × truthState, collect 4 outputs with the 4 rng values, assert `new Set(outputs).size === 4`.

### 6.2 No dialogue-bank mutation
This spec SHALL NOT modify `src/lib/ai/constants.ts`. Dialogue variants are documentation-only in design.md §5.4.

**Acceptance criteria:**
- No file in this spec's changeset modifies `src/lib/ai/constants.ts`.

---

## 7. Integration Constraints

### 7.1 Brain isolation
`src/lib/ai/brain.ts` SHALL NOT import `PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, or `PERSONA_ACCENT_COLORS`. The brain's concern is decision-making; presentation is the caller's concern.

**Acceptance criteria:**
- Grep/static analysis confirms no such imports exist in `brain.ts`.

### 7.2 No new type additions
This spec SHALL NOT add fields to `DecisionContext`, `OwnPlayContext`, `AiDecision`, `AiPlay`, or any type in `src/lib/ai/types.ts` or `src/lib/game/types.ts`.

**Acceptance criteria:**
- No file in this spec's changeset modifies `src/lib/ai/types.ts` or `src/lib/game/types.ts`.

---

## Requirement ↔ Invariant traceability

| Invariant | Requirement(s) |
|---|---|
| I1 (weights sum) | 5.1 |
| I2 (voice-ID distinct) | 2.3 |
| I3 (voice-ID format) | 2.4 |
| I4 (ordering monotone) | 5.5 |
| I5 (display-name format) | 3.2 |
| I6 (accent-color format) | 4.3 |
| I7 (exhaustive coverage) | 1.2 |
| I8 (balance sanity) | 5.6 |
| I9 (dialogue-variant count) | 6.1 |
| I10 (Clerk non-membership) | 1.3 |

---

## Design questions for Scott

1. **Accent color UX validation (design.md §11 Q5):** The hex tokens in §7.3 are rationale-driven but unvalidated against final visual design or WCAG contrast for specific uses. `Silent` (`#1e2a3a`) on dark background (`#0b0b0e`) has contrast ≈ 1.8 — acceptable for borders/highlights but not text. Should `ui-gameplay` spec owner sign off before these ship to prod?

2. **Dialogue-variant expansion (design.md §11 Q2):** Currently 4 variants per (persona, truthState). Design.md defaults to "NO for v1" — confirm this holds, or should we plan for 8-variant expansion post-hackathon?

3. **Voice-ID env-var override (design.md §11 Q3):** Design.md explicitly defers `process.env.HEARSAY_PERSONA_VOICE_OVERRIDE_<PERSONA>` to a future spec. Confirm no last-minute swap mechanism is needed for judging day.
