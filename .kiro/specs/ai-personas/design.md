---
inclusion: fileMatch
fileMatchPattern: "src/lib/ai/math.ts|src/lib/ai/constants.ts|src/lib/voice/presets.ts|src/lib/persona/**/*.ts"
---

# ai-personas — Design

## Provenance

Authored by Claude Code (Opus 4.7 drafter, 2026-04-19) as a v1 draft extending `.kiro/specs/ai-opponent/design.md` iter-5 lock (2026-04-16). Canonical prose sources: `Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md` §7.3 (persona tuning tables) + `.kiro/steering/voice-preset-conventions.md` §"Voice ID selection (Day 2)" + `.kiro/steering/product.md` §"AI personas". Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via the §12 seeded prompt.

This spec codifies the **persona data tables** that `ai-opponent` consumes — voice-ID bindings, display-name mapping, accent-color tokens, and the Clerk narrator binding. The math tables (weights / thresholds / bluff-bias) and dialogue variants already shipped in `ai-opponent` for all four personas (not just Reader — see §2 reconciliation note); this spec locks them as the canonical allocation and adds the voice / display / accent layer.

**Scope of this spec:**
- `PERSONA_VOICE_IDS: Record<Persona, string>` — ElevenLabs voice ID per playable persona (lock existing values as source-of-truth)
- `CLERK_VOICE_ID: string` — tutorial narrator voice ID (non-Persona, singleton)
- `PERSONA_DISPLAY_NAMES: Record<Persona, string>` — courtroom-archetype display strings (Defendant / Prosecutor / Attorney / Judge)
- `PERSONA_ACCENT_COLORS: Record<Persona, string>` — UI accent-color token per persona (Tailwind-compatible CSS hex)
- Affirmation of the locked `PERSONA_WEIGHTS`, `PERSONA_THRESHOLDS`, `PERSONA_BLUFF_BIAS` values in `src/lib/ai/math.ts` — this spec enumerates them with rationale; it does not re-open the numbers
- Dialogue-variant table (persona × truth-state × count × variant-idx) — documentation-only expansion of the pattern already in `src/lib/ai/constants.ts`; no code mutation

**NOT in this spec** (handled elsewhere):
- Clerk narrator dialogue content, tutorial flow, or Clerk-to-player TTS calls (`tutorial-flow` track — not yet spec'd)
- Persona portrait / illustration generation (`visual-design` track — `design-previews/` folder)
- Pre-generated audio clips (per-persona final-words MP3s live in `voice-preset-conventions.md` §"Elimination-beat static clips", not here)
- `VOICE_PRESETS` values (owned by `voice-tell-taxonomy` spec §2 — re-read-only)
- FSM events, claim reducers, strikes (owned by `game-engine`)
- LLM prompt template text (owned by `.kiro/steering/llm-prompt-conventions.md`)
- Joker-driven per-persona overrides (owned by `joker-system` spec; e.g. Cold Read amplifying math weight is applied at call-site, not in this table)

---

## 1. Overview

### 1.1 Purpose

`ai-opponent` shipped hybrid decisioning (math + LLM + fallback) with **all four personas' numeric tables already populated** (math.ts §3.1, constants.ts dialogue banks). What is still missing to run a full courtroom demo is the **presentation layer per persona**: which voice speaks, what the player sees in the HUD, what accent color tints the UI when it's that persona's turn, and which voice narrates the tutorial.

This spec nails those down and locks them as the authoritative reference across `ui-gameplay`, `tutorial-flow`, and any future persona-swap feature.

### 1.2 In-scope deliverables

| Deliverable | Type | Location (additions to existing files) |
|---|---|---|
| `PERSONA_VOICE_IDS` | `Record<Persona, string>` | `src/lib/voice/presets.ts` (already present — lock values) |
| `CLERK_VOICE_ID` | `string` | `src/lib/voice/presets.ts` (already present — lock value) |
| `PERSONA_DISPLAY_NAMES` | `Record<Persona, string>` | `src/lib/persona/displayNames.ts` (already present — lock values) |
| `PERSONA_ACCENT_COLORS` | `Record<Persona, string>` | `src/lib/persona/accentColors.ts` (**NEW sibling file**, single named export) |
| Dialogue-variant enumeration | documentation table | this spec §5 (no code mutation) |
| Invariant tests | Vitest | `src/lib/persona/accentColors.test.ts` (new), plus additions to existing `presets.test.ts`, `displayNames.test.ts`, `math.test.ts` |

### 1.3 Out of scope

Listed above under "NOT in this spec" — restated for emphasis:
- Clerk narration script / tutorial state machine
- Portrait art assets
- LLM prompt mutations
- Any `ai-opponent` spec re-opening

### 1.4 Why this is a separate spec

Three reasons:
1. **Different cadence of change.** Voice IDs may need re-designing (Voice Design A/B per Day-2 tuning block); accent colors may need UX pass. Decoupling from `ai-opponent` math lets those iterate without re-locking the math.
2. **Different consumers.** `ai-opponent` consumes math; `ui-gameplay` consumes display names + accent colors; `voice-tell-taxonomy` consumes voice IDs. One table per consumer boundary.
3. **Different invariants.** The math invariants (weights sum to 1.0, probability bounds) are already tested. The persona-presentation invariants (uniqueness of voice IDs, all-personas-have-accent, Clerk ID distinct from player personas) are independent — and currently untested.

---

## 2. Persona roster (canonical)

The **internal `Persona` union type** is locked by `src/lib/game/types.ts` line 17:

```ts
export type Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent';
```

These four strings ARE the four playable AI opponents. **Do not add Clerk to this union** — Clerk is a narrator singleton (tutorial-only, no gameplay role, no hand, no decisioning), bound via a separate `CLERK_VOICE_ID` constant outside the `Record<Persona, ...>` tables.

### 2.1 Courtroom display mapping

The player never sees the strings `Novice` / `Reader` / `Misdirector` / `Silent` in-game. `PERSONA_DISPLAY_NAMES` maps internal → courtroom:

| Internal `Persona` | Display name | Courtroom archetype |
|---|---|---|
| `Novice` | The Defendant | Obvious-tells starter — nervous young male |
| `Reader` | The Prosecutor | Balanced MVP persona — measured older male (Gus Fring register) |
| `Misdirector` | The Attorney | Inverted tells — theatrical RP narrative-spinner |
| `Silent` | The Judge | Minimal tells — elderly RP gravelly dispassionate |

### 2.2 Reconciliation note — Reader vs 4-persona roster

The task-brief framing implied "`ai-opponent` covers Reader end-to-end; this spec covers the other three." That framing is **partially outdated** as of 2026-04-19:

- The ROADMAP referenced in `ai-opponent/design.md` Day-4 slice explicitly says *"persona-specific tuning overrides (ai-personas spec, Day 5) may override constants defined here"* and *"the fallback math tables for all four personas are required now because the fallback must work for any persona when triggered."*
- Inspection of `src/lib/ai/math.ts` (read-only) confirms `PERSONA_WEIGHTS`, `PERSONA_THRESHOLDS`, `PERSONA_BLUFF_BIAS` already cover all four personas with locked values.
- Inspection of `src/lib/ai/constants.ts` confirms dialogue variants and fallback inner-thoughts exist for all four personas.
- Inspection of `src/lib/voice/presets.ts` confirms `PERSONA_VOICE_IDS` and `CLERK_VOICE_ID` already hold real ElevenLabs voice IDs as of 2026-04-18 Voice Design tuning pass.

**What this means for scope:** this spec is **declarative** — it ratifies and locks the existing tables as the source-of-truth for persona presentation, adds the one missing piece (`PERSONA_ACCENT_COLORS`), and enumerates invariant tests that currently don't exist. It does NOT propose changes to existing tables; any proposed tuning requires a separate amendment (flagged in §11).

---

## 3. Architecture

### 3.1 Relationship to `ai-opponent`

```
┌─────────────────────────────────────────────────────────────┐
│ ai-opponent spec                                             │
│ ─────────────────                                            │
│  src/lib/ai/math.ts       — PERSONA_WEIGHTS, THRESHOLDS,     │
│                             BLUFF_BIAS, claimMathProbability │
│  src/lib/ai/constants.ts  — PERSONA_DESCRIPTIONS, dialogue   │
│                             variants, fallback thoughts      │
│  src/lib/ai/brain.ts      — orchestrator                     │
│  src/lib/ai/llm.ts        — Gemini wrapper                   │
│  src/lib/ai/types.ts      — DecisionContext, AiDecision, ... │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ imports `persona` key (string literal)
                      │ — does NOT import presentation tables
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ ai-personas spec (THIS SPEC)                                 │
│ ────────────────                                             │
│  src/lib/voice/presets.ts  — PERSONA_VOICE_IDS, CLERK_VOICE_ID│
│  src/lib/persona/displayNames.ts — PERSONA_DISPLAY_NAMES     │
│  src/lib/persona/accentColors.ts — PERSONA_ACCENT_COLORS (NEW)│
└─────────────────────┬───────────────────────────────────────┘
                      │
       ┌──────────────┴─────────────┬──────────────────────────┐
       ▼                            ▼                          ▼
  ui-gameplay                  voice-tell-taxonomy        tutorial-flow
  (HUD, accents,               (TTS call uses             (Clerk intro,
   autopsy panel)               PERSONA_VOICE_IDS +        uses CLERK_VOICE_ID)
                                VOICE_PRESETS)
```

**Critical property:** `ai-opponent/brain.ts` never imports `PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, or `PERSONA_ACCENT_COLORS`. The brain's concern is decision-making; presentation is the caller's concern. This keeps the brain pure-testable without ElevenLabs mocking.

### 3.2 Data-flow at runtime

1. API route `/api/game/ai-turn` has `session.ai.personaIfAi: Persona` in hand.
2. Calls `brain.aiDecideOwnPlay(ctx)` → returns `AiPlay { claimText, truthState, ... }`.
3. Looks up `PERSONA_VOICE_IDS[persona]` for voice ID.
4. Looks up `VOICE_PRESETS[persona][truthState]` for `voiceSettings` (from `voice-tell-taxonomy`).
5. Calls ElevenLabs Flash v2.5 with `{ voiceId, voiceSettings, text: claimText }`.
6. Streams audio back; client renders `PERSONA_DISPLAY_NAMES[persona]` in HUD with `PERSONA_ACCENT_COLORS[persona]` as border/highlight token.

No step in this pipeline needs FSM changes; `ai-personas` is a pure data-layer spec.

---

## 4. Data model

### 4.1 Types (all re-exported from `src/lib/game/types.ts` — not duplicated)

```ts
import type { Persona } from '../game/types';
// Persona = 'Novice' | 'Reader' | 'Misdirector' | 'Silent'
```

### 4.2 New constant shapes

```ts
// src/lib/voice/presets.ts — additions (already present as of 2026-04-18)
export const PERSONA_VOICE_IDS: Record<Persona, string>;
export const CLERK_VOICE_ID: string;

// src/lib/persona/displayNames.ts — additions (already present)
export const PERSONA_DISPLAY_NAMES: Record<Persona, string>;

// src/lib/persona/accentColors.ts — NEW FILE
export const PERSONA_ACCENT_COLORS: Record<Persona, string>;
```

**Type contract:**
- `PERSONA_VOICE_IDS[p]` — non-empty ElevenLabs voice ID string (length 20, base64-like per ElevenLabs format)
- `CLERK_VOICE_ID` — same format; MUST be a distinct value from every entry in `PERSONA_VOICE_IDS`
- `PERSONA_DISPLAY_NAMES[p]` — non-empty human-readable string, courtroom archetype with definite article ("The …")
- `PERSONA_ACCENT_COLORS[p]` — CSS hex color string matching regex `/^#[0-9a-f]{6}$/i`; intended for use with Tailwind arbitrary-value syntax `bg-[var(--persona-accent)]` or inline style

### 4.3 Source-of-truth for voice IDs

**Decision: hardcoded in `src/lib/voice/presets.ts`, NOT env vars.**

Rationale (also logged in §11 resolution):
- The voices are **designed once** via ElevenLabs Voice Design tuning block (Day 2); regenerating them produces different acoustic characters. Treating IDs as "config" implies they're swappable, which undermines the `VOICE_PRESETS` (persona × truthState) invariants — those presets are tuned **against specific voice identities** (a baritone's `stability: 0.80` is not a tenor's `stability: 0.80`).
- The existing `presets.ts` comment block (`// VOICE CASTING`) documents each ID's character and the A/B tuning provenance. Env vars would lose that audit trail.
- The ElevenLabs API *key* (`ELEVENLABS_API_KEY`) remains an env var per `tech.md`; only the **voice IDs** are hardcoded.

**Escape hatch:** a one-line override via `process.env.HEARSAY_PERSONA_VOICE_OVERRIDE_<PERSONA>` MAY be added in a future spec if live-demo reveals a voice needs last-minute swap. Not in this spec.

---

## 5. Decision-weight tables (ratified from `ai-opponent/math.ts`)

These tables are **locked as-shipped** in `src/lib/ai/math.ts`. Reproduced here for cross-reference and to enumerate the per-persona design rationale that is implicit in `ai-opponent/design.md` §3.1.

### 5.1 `PERSONA_WEIGHTS` (math vs voice weighting for judging)

| Persona | `math` | `voice` | Rationale |
|---|---|---|---|
| Novice | 0.70 | 0.30 | Poor reader of opponents — defaults to hand-math because can't reliably parse voice signal |
| Reader | 0.40 | 0.60 | Balanced, leans toward voice because voice is the signature mechanic; MVP demo persona |
| Misdirector | 0.50 | 0.50 | Balanced — wins via own voice *inversion*, not via reading opponent; symmetric weight is fair |
| Silent | 0.30 | 0.70 | Strong reader — "I read you, you can't read me"; trusts voice heuristic heavily |

**Invariant (carried from ai-opponent invariant 1):** `weights.math + weights.voice === 1.0` for all four personas. See §9 invariant I1.

### 5.2 `PERSONA_THRESHOLDS` (combined-score threshold to trigger challenge)

| Persona | Threshold | Rationale |
|---|---|---|
| Novice | 0.70 | High threshold → rarely challenges, conservative. Starter persona; should die to player aggression, not to its own over-challenging. |
| Reader | 0.55 | Mid — challenges on strong signal |
| Misdirector | 0.50 | Mid — slightly trigger-happy (theatrical) |
| Silent | 0.45 | Low threshold → quickest to call "Liar!"; the expert hunter |

### 5.3 `PERSONA_BLUFF_BIAS` (P(lie | targets available) for own-play)

| Persona | Bluff bias | Rationale |
|---|---|---|
| Novice | 0.10 | Almost always plays honest when possible — naive |
| Reader | 0.35 | Moderate bluff rate; demo-friendly variety |
| Misdirector | 0.60 | Bluffs more often than not — the whole persona is about deception |
| Silent | 0.55 | High bluff rate; taciturn but ruthless |

**Ordering invariant:** Novice < Reader < Silent ≤ Misdirector. Novice must be lowest (starter difficulty). Misdirector must be highest-or-tied (archetype demand). See §9 invariant I4.

### 5.4 Dialogue-variant table (ratified from `ai-opponent/constants.ts`)

`templateHonest(persona, count, rank, rng)` and `templateLie(persona, count, rank, rng)` currently return one of **4 variants** per (persona, truthState) pair, indexed by `Math.floor(rng() * 4)`. Ratified variant counts:

| Persona | Honest variants | Lying variants | Character cue examples (excerpted) |
|---|---|---|---|
| Novice | 4 | 4 | `"Um… {count} {rank}, I think."` / `"I, um, have {count} {rank}."` — fillers regardless of truth |
| Reader | 4 | 4 | `"{count} {rank}."` / `"Claiming {count} {rank}."` — measured, short |
| Misdirector | 4 | 4 | `"*nervous laugh* …{count} {rank}."` (honest) / `"Oh, {count} {rank}, obviously."` (lying) — inverted affect |
| Silent | 4 | 4 | `"{count} {rank}."` / `"{count}."` / `"There."` — minimal verbosity |

Future dialogue-bank expansion (e.g. to 8 variants) is a **non-breaking change** provided the rng index formula updates to match. Not in this spec's scope; noted in §11 open questions.

---

## 6. Voice-ID bindings

### 6.1 `PERSONA_VOICE_IDS` (locked 2026-04-18)

| Persona | Voice ID | Voice Design handle | Character brief |
|---|---|---|---|
| Novice | `Lrx118tn6NTNAXspnuEN` | hearsay-defendant | Working-class London nervous young male; heavy fillers on lies; training-wheels opponent |
| Reader | `NxGA8X3YhTrnf3TRQf6Q` | hearsay-prosecutor | American neutral, late-50s male; Gus Fring register — soft-spoken, over-articulated; demo-video carrier |
| Misdirector | `0Q0MDAMrmHYYHDqFoGUx` | hearsay-attorney | British RP, 40s male; theatrical; halting-when-truthful, smooth-when-lying |
| Silent | `0XMldg7YUhIHRMJqiWHr` | hearsay-judge | British RP, 70s male; deep gravelly, dispassionate; Act-4 climax voice |

These values were selected via the Day-2 tuning A/B protocol in `voice-preset-conventions.md` §"Voice ID selection (Day 2)", with Path-B (Voice Design) winning over Path-A (preset library) for all four personas. Voice Design is one-time-cost, so the locked IDs are free to reuse indefinitely.

### 6.2 `CLERK_VOICE_ID` (tutorial narrator)

```
CLERK_VOICE_ID = 'Al9pMcZxV70KAzzehiTE'   // hearsay-clerk
```

Character brief: British RP, 40s female; warm-bureaucratic, procedural. Used by the tutorial-flow track to welcome the player ("The court will see you now…") before handing off to the trial. **Clerk has no gameplay role** — no `Persona` union membership, no `PERSONA_WEIGHTS` entry, no `VOICE_PRESETS` entry, no inclusion in the 4-persona iteration helpers.

### 6.3 Distinct-IDs invariant

All five voice IDs (four personas + Clerk) MUST be pairwise distinct. See §9 invariant I2.

---

## 7. Integration points

### 7.1 Shared-state additions

No new FSM events. No additions to `src/lib/game/types.ts` (the `Persona` union stays as-is). No additions to `src/lib/ai/types.ts`.

**Additions (all are tables already present or proposed sibling file):**

| File | Symbol | Status | Owner |
|---|---|---|---|
| `src/lib/voice/presets.ts` | `PERSONA_VOICE_IDS` (named export) | **present** — this spec locks it | ai-personas |
| `src/lib/voice/presets.ts` | `CLERK_VOICE_ID` (named export) | **present** — this spec locks it | ai-personas |
| `src/lib/persona/displayNames.ts` | `PERSONA_DISPLAY_NAMES` (named export) | **present** — this spec locks it | ai-personas |
| `src/lib/persona/accentColors.ts` | `PERSONA_ACCENT_COLORS` (named export) | **NEW sibling file** | ai-personas |

**Explicit non-additions to pre-existing contracts:**
- No new fields on `DecisionContext` / `OwnPlayContext` / `AiDecision` / `AiPlay`
- No new `AiSource` enum values
- No new `JokerType` values (persona-joker interactions are `joker-system`'s concern)
- No new `VoiceSettings` keys
- No new `TruthState` values
- No mutation of existing `PERSONA_WEIGHTS` / `THRESHOLDS` / `BLUFF_BIAS` / `VOICE_PRESETS` / `PERSONA_DESCRIPTIONS` tables

This is deliberately a thin extension — ratification of existing shape, plus one small additive file (`accentColors.ts`).

### 7.2 Cross-spec references

| Consumer | Imports from this spec | Used for |
|---|---|---|
| `voice-tell-taxonomy` / `src/lib/voice/tts.ts` | `PERSONA_VOICE_IDS`, `CLERK_VOICE_ID` | `elevenlabs.textToSpeech({ voiceId, voiceSettings })` |
| `ui-gameplay` (HUD) | `PERSONA_DISPLAY_NAMES`, `PERSONA_ACCENT_COLORS` | Render opponent-name pill + border-accent styling |
| `ui-gameplay` (autopsy) | `PERSONA_DISPLAY_NAMES` | Header of `RoundAutopsy.tsx` |
| `tutorial-flow` (future) | `CLERK_VOICE_ID`, `PERSONA_DISPLAY_NAMES` | Clerk's intro + references to "the four defendants you may face" |
| `ai-opponent` (unchanged) | — | Does NOT import from this spec; stays pure |

### 7.3 Accent color allocation

Proposed values (§11 Q5 flags this for UX review — hex tokens are rationale-driven but unvalidated against final visual design):

| Persona | Accent hex | Justification |
|---|---|---|
| Novice / Defendant | `#8ca880` | Muted olive green — "nervous, organic, defensive" |
| Reader / Prosecutor | `#b57c3a` | Amber / tobacco — "measured authority, Gus Fring warmth" |
| Misdirector / Attorney | `#6b4a9e` | Deep violet — "theatrical, courtroom-theatre" |
| Silent / Judge | `#1e2a3a` | Near-black navy — "weight, finality, Act 4" |

Tokens are 6-hex (no alpha) so they compose trivially with Tailwind `ring-[#…]`, `border-[#…]`, `bg-[#…]/20` opacity helpers. None of these values collide with existing `globals.css` base palette (verified: base Tailwind 4 defaults do not include these specific hexes).

**Accessibility check:** `Silent` (`#1e2a3a`) on the game's dark-mode background (`#0b0b0e` per design-previews) has contrast ratio ≈ 1.8 — below WCAG AA for text, but **accent colors are used only for borders / highlights, never as text background**, so this is acceptable. Invariant I6 codifies the usage constraint.

---

## 8. Error handling

### 8.1 Unknown persona key

All four tables (`PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, `PERSONA_ACCENT_COLORS`, `VOICE_PRESETS`) are `Record<Persona, X>` — TypeScript guarantees exhaustive coverage at compile time. If a stringly-typed value escapes the `Persona` union (e.g. from a corrupted localStorage session), the lookup returns `undefined` and downstream code must treat it as a runtime error.

**Recommended downstream behavior** (not enforced by this spec — documented for consumers):

1. Voice lookup (`tts.ts`): if `PERSONA_VOICE_IDS[p]` is undefined, fall back to `PERSONA_VOICE_IDS.Reader` (MVP persona) and log a single warning. Never fall back to `CLERK_VOICE_ID` — that's the tutorial voice and would break immersion.
2. Display lookup (`ui`): if `PERSONA_DISPLAY_NAMES[p]` is undefined, render `"Unknown Opponent"` and log.
3. Accent lookup (`ui`): if `PERSONA_ACCENT_COLORS[p]` is undefined, render the default `--accent-neutral` token (defined in `globals.css`) — accent being slightly off is a cosmetic degradation, not a game-breaker.

These fallbacks MAY be codified in a `safePersonaLookup(persona, table, fallback)` helper in a future spec. Not in scope here.

### 8.2 Voice-ID 404 from ElevenLabs

Orthogonal concern — an ElevenLabs API call with a deleted or unknown voice ID returns HTTP 404. Handled by `voice-tell-taxonomy`'s `tts.ts` retry / error layer, not here. This spec guarantees the IDs are **correctly typed and present in the table**; it cannot guarantee the ElevenLabs account still has the voice.

---

## 9. Invariants (Vitest — MANDATORY)

Each invariant is a concrete, asserting test. Tests are spread across `src/lib/voice/presets.test.ts`, `src/lib/persona/displayNames.test.ts`, `src/lib/persona/accentColors.test.ts` (NEW), and `src/lib/ai/math.test.ts` (additions to existing file).

**I1. `PERSONA_WEIGHTS` sum.** For every `Persona p`, `PERSONA_WEIGHTS[p].math + PERSONA_WEIGHTS[p].voice === 1.0` (with Number.EPSILON tolerance). (Lives in `math.test.ts` — may already be present; ratified here.)

**I2. Voice-ID distinctness.** The set `{ PERSONA_VOICE_IDS.Novice, PERSONA_VOICE_IDS.Reader, PERSONA_VOICE_IDS.Misdirector, PERSONA_VOICE_IDS.Silent, CLERK_VOICE_ID }` has cardinality 5. (No two personas share a voice; Clerk's voice is not reused.) Lives in `presets.test.ts`.

**I3. Voice-ID format.** Every entry matches `/^[A-Za-z0-9]{20}$/` (ElevenLabs voice-ID shape). Rejects empty strings, placeholder `'TBD'` values, trimmed whitespace. Lives in `presets.test.ts`.

**I4. Persona ordering (difficulty monotone).** Bluff-bias: `PERSONA_BLUFF_BIAS.Novice < PERSONA_BLUFF_BIAS.Reader < PERSONA_BLUFF_BIAS.Silent ≤ PERSONA_BLUFF_BIAS.Misdirector`. Threshold: `PERSONA_THRESHOLDS.Silent < PERSONA_THRESHOLDS.Misdirector ≤ PERSONA_THRESHOLDS.Reader < PERSONA_THRESHOLDS.Novice`. (Lives in `math.test.ts`; asserts the narrative "Novice is starter, Silent/Misdirector are hunters".)

**I5. Display-name non-empty + unique.** All four `PERSONA_DISPLAY_NAMES` values are non-empty strings, pairwise distinct, and each starts with the prefix `"The "` (courtroom archetype format). (Lives in `displayNames.test.ts`; partial coverage present, add prefix+uniqueness assertions.)

**I6. Accent-color format.** Every `PERSONA_ACCENT_COLORS` value matches `/^#[0-9a-f]{6}$/i`; pairwise distinct. (Lives in new `accentColors.test.ts`.)

**I7. Exhaustive `Persona` coverage (compile-time).** TypeScript guarantees `Record<Persona, X>` completeness, but add a runtime test that `Object.keys(TABLE).sort()` equals `['Misdirector', 'Novice', 'Reader', 'Silent']` for each of `PERSONA_WEIGHTS`, `PERSONA_THRESHOLDS`, `PERSONA_BLUFF_BIAS`, `PERSONA_VOICE_IDS`, `PERSONA_DISPLAY_NAMES`, `PERSONA_ACCENT_COLORS`, `VOICE_PRESETS`, `PERSONA_DESCRIPTIONS`. This protects against future `Persona` union expansion being missed in one table. (Distributed across the test files.)

**I8. Balance sanity.** For every persona, with `mathProb = 0.5` and `voiceLie = 0.5` (neutral-neutral), `w.math * 0.5 + w.voice * 0.5 === 0.5`, which means:
- For Novice (threshold 0.70): 0.5 < 0.70 → accepts a neutral-signal claim
- For Reader (threshold 0.55): 0.5 < 0.55 → accepts
- For Misdirector (threshold 0.50): 0.5 ≥ 0.50 → challenges (edge-case — acceptable for an aggressive archetype)
- For Silent (threshold 0.45): 0.5 ≥ 0.45 → challenges

Sum of `challenge-on-neutral` count across the four personas is exactly 2 of 4 (Misdirector + Silent). This is the canonical "neutral-signal challenge distribution" — asserted as a regression catch for accidental threshold drift. (Lives in `math.test.ts`.)

**I9. Dialogue-variant count.** For every (persona, truthState) pair, the `templateHonest` / `templateLie` variant arrays (if exposed via a test-only export) have length exactly 4. If internal-only, assert via call-frequency: invoking `templateHonest(persona, 1, 'Queen', rngStub)` with `rngStub` returning `0.0, 0.25, 0.5, 0.75` respectively produces four distinct strings. (Lives in `constants.test.ts` additions — may partially overlap with existing tests.)

**I10. Clerk non-membership.** There is no `PERSONA_WEIGHTS.Clerk`, `VOICE_PRESETS.Clerk`, `PERSONA_DISPLAY_NAMES.Clerk`, or `PERSONA_ACCENT_COLORS.Clerk` — TypeScript already enforces this via the union, but add a negative test: `('Clerk' as any) in PERSONA_WEIGHTS === false`. Protects against someone "helpfully" adding Clerk to the union. (Lives in `presets.test.ts`.)

---

## 10. File layout

```
src/lib/voice/
  presets.ts            — [existing] adds/locks PERSONA_VOICE_IDS, CLERK_VOICE_ID
  presets.test.ts       — [existing] add I2, I3, I7 (partial), I10

src/lib/persona/
  displayNames.ts       — [existing] locked as-is
  displayNames.test.ts  — [existing] add I5 (prefix + uniqueness)
  accentColors.ts       — [NEW FILE] PERSONA_ACCENT_COLORS export + comment block
  accentColors.test.ts  — [NEW FILE] I6, I7 (partial)

src/lib/ai/
  math.ts               — [existing] locked as-is (no mutation)
  math.test.ts          — [existing] add I1 (if absent), I4, I7 (partial), I8
  constants.ts          — [existing] locked as-is
  constants.test.ts     — [existing] add I9
```

**Net new files: 2** (`accentColors.ts`, `accentColors.test.ts`). Net new tests: ~8-10 assertions across 6 existing test files + 1 new test file. Total implementation effort: one-sitting, ~2 hours including invariant writing + running `pnpm test`.

---

## 11. Open questions

Flagged with recommended defaults. Any spec consumer that disagrees should amend before Kiro generates `requirements.md`.

**Q1. Should `ai-personas` re-open any math table?**
*Default: NO.* The `PERSONA_WEIGHTS` / `THRESHOLDS` / `BLUFF_BIAS` values shipped with `ai-opponent` and are covered by the invariant test suite. Re-opening risks destabilizing the demo. If Day-5 playtest reveals a persona feels off, handle via a **separate amendment spec** with its own provenance + review loop — not a quiet number-tune here.

**Q2. Should dialogue-variant banks expand beyond 4 lines per (persona, truthState)?**
*Default: NO for v1.* 4 variants × 4 personas × 2 truth-states × 2 counts = 64 lines already; LLM-path fills most production calls anyway. Expansion can happen per-persona post-hackathon if desired; it's a non-breaking change.

**Q3. Should voice IDs come from env vars instead of hardcoded?**
*Default: NO — hardcoded.* See §4.3 for rationale (voice identity ↔ tuned VOICE_PRESETS coupling). Revisit only if judging-day reveals an urgent swap need; in that case, commit a new ID and comment-annotate. Env-var override stub is noted as a possible future amendment, not implemented.

**Q4. Is the task-brief's Defendant/Prosecutor/Attorney/Judge persona list authoritative over the Novice/Reader/Misdirector/Silent union?**
*Default: NO — internal union stays.* `src/lib/game/types.ts` line 17 is the lock; courtroom names are display-layer via `PERSONA_DISPLAY_NAMES`. Renaming the internal union would ripple through `game-engine`, `ai-opponent`, `voice-tell-taxonomy`, every test, and the architecture draft — high cost, zero gameplay benefit. Display names can evolve independently of internal keys. **This is the central reconciliation of the spec; flagged explicitly so the answer isn't buried.**

**Q5. Are the proposed accent colors the final visual language?**
*Default: TENTATIVE — pending UX pass.* The hex tokens in §7.3 are rationale-driven (olive/amber/violet/navy mapping to persona temperament) but have not been validated against final design-previews or WCAG contrast for specific uses beyond border/highlight. Recommended action: `ui-gameplay` spec owner or visual-design track should review before the tokens ship to prod. If changed, update `accentColors.ts` only; no type changes needed.

**Q6. Should Clerk eventually get gameplay mechanics (e.g. narrate round-transitions with quips)?**
*Default: OUT OF SCOPE here.* If Clerk graduates from tutorial-only to in-game narrator, propose via `tutorial-flow` spec (future) or a dedicated `narrator-system` spec. Adding Clerk to the `Persona` union at that point would still be wrong — give Clerk a separate `Narrator` union if needed.

**Q7. Should there be a `PERSONA_PORTRAIT_PATHS` constant in this spec?**
*Default: NO.* Persona portrait art is the `visual-design` track's concern (see `design-previews/*.html`). A portrait-path table would belong in a `src/lib/persona/portraits.ts` file spec'd separately. Keeping scope tight avoids entangling art production with data-layer lock.

---

## 12. Seed prompt for Kiro

Paste-ready. Assumes Kiro Spec mode is positioned on `.kiro/specs/ai-personas/design.md` and asked to generate `requirements.md` + `tasks.md`.

---

````
You are Kiro in Spec mode. Read `.kiro/specs/ai-personas/design.md` in full. Generate
`requirements.md` (EARS format) and `tasks.md` (numbered checklist with one-line descriptions
and file touch-points).

The design spec covers: persona data tables (voice IDs, display names, accent colors,
Clerk narrator binding) that extend ai-opponent's already-shipped math/dialogue layer.
Internal Persona union stays 'Novice' | 'Reader' | 'Misdirector' | 'Silent' (locked by
game-engine/types.ts line 17); courtroom names are display-layer only.

For `requirements.md`, produce one EARS-format requirement per §9 invariant (I1–I10) plus
one per §4.2 data-model constant (PERSONA_VOICE_IDS, CLERK_VOICE_ID, PERSONA_DISPLAY_NAMES,
PERSONA_ACCENT_COLORS). Group requirements by file touched. Do not invent requirements
not grounded in design §§4, 5, 6, 7, 9.

For `tasks.md`, produce a numbered checklist:
  1. Create `src/lib/persona/accentColors.ts` with PERSONA_ACCENT_COLORS export per §7.3 hex table.
  2. Create `src/lib/persona/accentColors.test.ts` with I6 and I7-partial assertions.
  3. Add I2, I3, I7-partial, I10 to existing `src/lib/voice/presets.test.ts`.
  4. Add I5 (prefix + uniqueness) to existing `src/lib/persona/displayNames.test.ts`.
  5. Add I1 (if absent), I4, I7-partial, I8 to existing `src/lib/ai/math.test.ts`.
  6. Add I9 variant-count assertion to existing `src/lib/ai/constants.test.ts`.
  7. Run `pnpm test` and confirm all new assertions pass with zero mutations to
     `PERSONA_WEIGHTS`, `PERSONA_THRESHOLDS`, `PERSONA_BLUFF_BIAS`, `PERSONA_VOICE_IDS`,
     `CLERK_VOICE_ID`, `PERSONA_DISPLAY_NAMES`, `VOICE_PRESETS`, `PERSONA_DESCRIPTIONS`,
     or `templateHonest` / `templateLie` internals.

Do NOT propose changes to any locked table. Do NOT add Clerk to the Persona union.
Do NOT generate src/* code beyond the two new files in task 1 and task 2. Flag any
tension with §11 open questions for the human to resolve before execution.

Design sections covered by this generation:
  §1 Overview, §2 Persona roster, §3 Architecture, §4 Data model,
  §5 Decision-weight tables, §6 Voice-ID bindings, §7 Integration points,
  §8 Error handling, §9 Invariants, §10 File layout, §11 Open questions.

Review mode: Claude Code Opus 4.7 review subagent will audit the generated tasks against
this design spec before execution. Match the structure of
`.kiro/specs/ai-opponent/requirements.md` / `tasks.md` for consistency.
````

---
