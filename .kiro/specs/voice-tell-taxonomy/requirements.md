# Requirements Document

## Introduction

Voice-tell taxonomy for Hearsay: the constants and heuristic that make voice-based bluffing work. This spec owns the `VOICE_PRESETS` constant (4 personas × 2 truth-states = 8 `VoiceSettings` objects), the `computeLieScore` pure function (STT metadata → 0..1 lie-score), the `FILLER_REGEX` pattern, and the `PERSONA_VOICE_IDS` constant shape. All requirements are derived from the authoritative `design.md` §1–§5.

## Glossary

- **VOICE_PRESETS**: The `Record<Persona, Record<TruthState, VoiceSettings>>` constant in `src/lib/voice/presets.ts` — 8 locked voice-parameter objects that drive every AI TTS call
- **VoiceSettings**: Interface with 4 numeric fields (`stability`, `similarity_boost`, `style`, `speed`) matching the ElevenLabs `voiceSettings` payload
- **Persona**: Union type `'Novice' | 'Reader' | 'Misdirector' | 'Silent'` — the 4 AI difficulty tiers
- **TruthState**: Union type `'honest' | 'lying'` — whether the AI's current claim is truthful
- **computeLieScore**: Pure function `(LieScoreInput) → number` in `src/lib/voice/heuristic.ts` — weighted sum of 4 STT-derived signals
- **LieScoreInput**: Interface with 4 numeric fields (`latencyMs`, `fillerCount`, `pauseCount`, `speechRateWpm`) consumed by `computeLieScore`
- **FILLER_REGEX**: Global case-insensitive regex in `src/lib/voice/heuristic.ts` matching 8 filler words/phrases at word boundaries
- **VoiceMeta**: Interface in `src/lib/game/types.ts` carrying STT metadata + derived `lieScore` for a player's voice claim
- **PERSONA_VOICE_IDS**: `Record<Persona, string>` constant in `src/lib/voice/presets.ts` — ElevenLabs voice ID per persona (values filled at Day-2 tuning)
- **Stability_Delta**: `|VOICE_PRESETS[persona].honest.stability − VOICE_PRESETS[persona].lying.stability|` — the primary measure of how audible a persona's tell is

## Requirements

### Requirement 1: Voice Type Definitions

**User Story:** As a developer, I want shared voice-related type definitions, so that presets, heuristic, and downstream consumers share a single contract.

#### Acceptance Criteria

1. THE types module SHALL export `Persona` as a union of exactly `'Novice' | 'Reader' | 'Misdirector' | 'Silent'`. *(design §1)*
2. THE types module SHALL export `TruthState` as a union of exactly `'honest' | 'lying'`. *(design §1)*
3. THE types module SHALL export `VoiceSettings` with exactly 4 numeric fields: `stability` ∈ [0,1], `similarity_boost` ∈ [0,1], `style` ∈ [0,1], `speed` ∈ [0.8, 1.2]. *(design §1)*
4. THE types module SHALL export `VoiceMeta` with fields `latencyMs`, `fillerCount`, `pauseCount`, `speechRateWpm`, `lieScore`, and `parsed`. *(design §1)*
5. THE voice layer SHALL export `LieScoreInput` with exactly 4 numeric fields: `latencyMs`, `fillerCount`, `pauseCount`, `speechRateWpm`. May be co-located with `computeLieScore` in `src/lib/voice/heuristic.ts` OR moved to `src/lib/game/types.ts` — either location satisfies the contract. *(design §3)*

### Requirement 2: VOICE_PRESETS Shape Completeness

**User Story:** As a TTS caller, I want VOICE_PRESETS to be structurally complete and range-valid, so that every `(persona, truthState)` lookup succeeds with safe ElevenLabs parameters.

#### Acceptance Criteria

1. THE VOICE_PRESETS constant SHALL contain entries for all 4 Personas, each with both `honest` and `lying` keys — 8 VoiceSettings objects total. *(design §2, invariant 1)*
2. FOR ALL VoiceSettings objects in VOICE_PRESETS, `stability`, `similarity_boost`, and `style` SHALL be in [0, 1] and `speed` SHALL be in [0.8, 1.2]. *(design §2, invariant 1)*
3. FOR ALL VoiceSettings objects in VOICE_PRESETS, all 4 fields (`stability`, `similarity_boost`, `style`, `speed`) SHALL be present and numeric. *(design §2, invariant 1)*

### Requirement 3: Misdirector Inversion

**User Story:** As a game designer, I want Misdirector's voice presets to invert the normal tell pattern, so that players who learn "shaky = lying" from Novice/Reader are punished.

#### Acceptance Criteria

1. THE VOICE_PRESETS.Misdirector.honest.stability SHALL be less than VOICE_PRESETS.Misdirector.lying.stability — the honest read sounds MORE nervous. *(design §2, invariant 2 — LOCKED)*
2. THE VOICE_PRESETS.Misdirector.honest.style SHALL be greater than VOICE_PRESETS.Misdirector.lying.style — the honest read is MORE expressive. *(design §2, invariant 2 — LOCKED)*

### Requirement 4: Novice Audibility

**User Story:** As a new player, I want Novice's lying voice to be obviously different from honest, so that the demo is immediately readable.

#### Acceptance Criteria

1. THE VOICE_PRESETS.Novice.lying.stability SHALL be less than or equal to 0.25. *(design §2, invariant 3)*
2. THE VOICE_PRESETS.Novice.lying.style SHALL be greater than or equal to 0.55. *(design §2, invariant 3)*

### Requirement 5: Silent Subtlety

**User Story:** As an expert player, I want Silent's honest-vs-lying difference to be minimal, so that Silent is the hardest persona to read.

#### Acceptance Criteria

1. THE absolute difference between VOICE_PRESETS.Silent.honest.stability and VOICE_PRESETS.Silent.lying.stability SHALL be less than 0.25. *(design §2, invariant 4)*

### Requirement 6: Persona Difficulty Ordering

**User Story:** As a game designer, I want persona tell-loudness to follow Novice > Reader > Silent ordering, so that difficulty escalates predictably.

#### Acceptance Criteria

1. THE Reader Stability_Delta SHALL be greater than the Silent Stability_Delta. *(design §2, invariant 5)*
2. THE Reader Stability_Delta SHALL be less than the Novice Stability_Delta. *(design §2, invariant 5)*

### Requirement 7: Preset Reference Stability

**User Story:** As a developer, I want VOICE_PRESETS to be a singleton, so that no accidental mutation or re-creation occurs across module imports.

#### Acceptance Criteria

1. WHEN VOICE_PRESETS is imported from two separate modules, THE system SHALL return the same object reference (no accidental deep-copy or mutation). *(design §4, invariant 6)*

### Requirement 8: computeLieScore Range

**User Story:** As the AI judging pipeline, I want computeLieScore to always return a value in [0, 1], so that downstream weight math is safe.

#### Acceptance Criteria

1. FOR ALL finite non-negative LieScoreInput values, THE computeLieScore function SHALL return a value in [0, 1] inclusive. *(design §3, invariant 7)*
2. FOR ALL finite non-negative LieScoreInput values, THE computeLieScore function SHALL never return NaN. *(design §3, invariant 7)*

### Requirement 9: computeLieScore Boundary Values

**User Story:** As a developer, I want computeLieScore to produce exact 0.0 and 1.0 at the boundary inputs, so that the weighted sum is verifiably correct.

#### Acceptance Criteria

1. WHEN all four inputs are at or above saturation thresholds (latencyMs ≥ 2000, fillerCount ≥ 3, pauseCount ≥ 3, speechRateWpm < 120 OR > 220), THE computeLieScore function SHALL return exactly 1.0. *(design §3, invariant 8)*
2. WHEN all four inputs are at zero/neutral (latencyMs = 0, fillerCount = 0, pauseCount = 0, speechRateWpm = 150), THE computeLieScore function SHALL return exactly 0.0. *(design §3, invariant 8)*

### Requirement 10: Latency Dominance

**User Story:** As a game designer, I want latency to be the strongest lie signal, so that hesitation at turn start is the most reliable tell.

#### Acceptance Criteria

1. WHEN only latencyMs is at saturation (2000) and all other inputs are zero/neutral, THE computeLieScore function SHALL return exactly 0.40. *(design §3, invariant 9)*

### Requirement 11: Rate Binary Behavior

**User Story:** As a developer, I want the speech-rate component to be binary (0 or 1), so that normal-range speech contributes no signal and abnormal speech contributes a fixed 10% penalty.

#### Acceptance Criteria

1. WHEN speechRateWpm is in [120, 220] inclusive, THE rate component SHALL contribute exactly 0 to the lie score. *(design §3, invariant 10)*
2. WHEN speechRateWpm is outside [120, 220], THE rate component SHALL contribute exactly 0.10 to the lie score. *(design §3, invariant 10)*

### Requirement 12: computeLieScore Monotonicity

**User Story:** As a game designer, I want increasing any single nervousness signal to never decrease the lie score, so that the heuristic behaves intuitively.

#### Acceptance Criteria

1. FOR ALL LieScoreInput pairs where exactly one field is increased and all others are held constant, THE computeLieScore output SHALL not decrease. *(design §3, invariant 11)*

### Requirement 13: Filler Regex Correctness

**User Story:** As the STT pipeline, I want FILLER_REGEX to match exactly the 8 specified filler words/phrases at word boundaries, so that filler counting is accurate.

#### Acceptance Criteria

1. THE FILLER_REGEX SHALL match each of: `um`, `uh`, `er`, `like`, `so`, `you know`, `kinda`, `i mean` as whole words. *(design §3, invariant 12)*
2. THE FILLER_REGEX SHALL be case-insensitive. *(design §3, invariant 12)*
3. THE FILLER_REGEX SHALL NOT match substrings within other words (e.g., `umbrella`, `soft`, `likewise`). *(design §3, invariant 12)*

### Requirement 14: Neutral Score on Skip-Voice

**User Story:** As the API route layer, I want a skip-voice claim to receive a neutral lie score of 0.5, so that the AI decides on math alone when no voice data is available.

#### Acceptance Criteria

1. WHEN the player skips voice input (button-only claim), THE API route layer SHALL set `voiceMeta.lieScore` to 0.5. *(design §3.3, invariant 13 — caller contract)*

NOTE: This is a caller contract enforced at the API route level, not by `computeLieScore` itself. `computeLieScore` is never called in the skip-voice path. Verification is via code review of the claim route, not a unit test on the heuristic.

### Requirement 15: PERSONA_VOICE_IDS Shape

**User Story:** As a TTS caller, I want PERSONA_VOICE_IDS to have a string entry for every persona, so that voice-ID lookup never fails at runtime.

#### Acceptance Criteria

1. THE PERSONA_VOICE_IDS constant SHALL have a defined, non-empty string entry for every Persona. *(design §5)*
2. THE PERSONA_VOICE_IDS constant SHALL be typed as `Record<Persona, string>`. *(design §5)*

### Requirement 16: Weighted Sum Formula

**User Story:** As a developer, I want the lie score to follow a locked weight allocation (40% latency / 30% fillers / 20% pauses / 10% rate-binary), so that the heuristic's behaviour is verifiable and traceable to the design rationale.

#### Acceptance Criteria

1. THE computeLieScore function SHALL produce output equivalent to the weight allocation: 40% clamped-latency (`min(latencyMs/2000, 1)`) + 30% clamped-fillers (`min(fillerCount/3, 1)`) + 20% clamped-pauses (`min(pauseCount/3, 1)`) + 10% rate-binary (1 iff `speechRateWpm < 120 OR > 220`, else 0). *(design §3)*
2. Implementation MAY use any mathematically equivalent expression form. The integer-weight form `(4*lat + 3*fil + 2*pau + 1*rat) / 10` is PREFERRED because the literal `0.40*lat + 0.30*fil + 0.20*pau + 0.10*rat` form triggers IEEE-754 drift (saturated sum = `0.9999999999999999`, not `1.0`) and breaks Req 9.1. *(design §3, shipped impl in `src/lib/voice/heuristic.ts`)*

---

## Invariant Cross-Reference

Every design.md §4 invariant (1–13) maps to at least one numbered acceptance criterion:

| Invariant | Description | Requirement(s) |
| --- | --- | --- |
| 1 — Shape completeness | All 4 personas × 2 truth-states present, all fields valid range | 2.1, 2.2, 2.3 |
| 2 — Misdirector inversion (LOCKED) | honest.stability < lying.stability; honest.style > lying.style | 3.1, 3.2 |
| 3 — Novice audibility | Novice.lying.stability ≤ 0.25, style ≥ 0.55 | 4.1, 4.2 |
| 4 — Silent subtlety | Silent stability delta < 0.25 | 5.1 |
| 5 — Reader ordering | Novice delta > Reader delta > Silent delta | 6.1, 6.2 |
| 6 — Preset reference stability | Same object reference across imports | 7.1 |
| 7 — computeLieScore range | Output ∈ [0, 1], no NaN | 8.1, 8.2 |
| 8 — Boundary values | Saturated → 1.0, zero → 0.0 | 9.1, 9.2 |
| 9 — Latency dominance | Latency alone at saturation → 0.40 | 10.1 |
| 10 — Rate binary behavior | In-range → 0, out-of-range → 0.10 | 11.1, 11.2 |
| 11 — Monotonicity | Increasing any input never decreases output | 12.1 |
| 12 — Filler regex correctness | Matches 8 fillers, rejects substrings, case-insensitive | 13.1, 13.2, 13.3 |
| 13 — Skip-voice default (caller contract) | API route sets lieScore = 0.5 on skip-voice | 14.1 |
