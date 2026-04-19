# probe-phase — Requirements

Derived from `.kiro/specs/probe-phase/design.md` (authoritative, LOCKED — do NOT modify).

## EARS notation key

- **Ubiquitous:** The system shall …
- **Event-driven:** When \<trigger\>, the system shall …
- **State-driven:** While \<condition\>, the system shall …
- **Unwanted:** If \<unwanted condition\>, the system shall …
- **Optional:** Where \<feature is included\>, the system shall …

---

## 1. Probe types and data model

### 1.1
The system shall define `ProbeRequest`, `ProbeResponse`, `ProbeFilter`, `ActiveProbe`, `RevealedProbe`, and `ProbeFilterSource` types in `src/lib/probe/types.ts`, importing game-engine types (`Persona`, `Rank`, `Session`) from `src/lib/game/types.ts` — never duplicating them.

### 1.2
The `ProbeRequest` interface shall have the LOCKED shape: `{ whisperId: string; targetAiId: 'ai'; roundIdx: number; triggeredAtTurn: number; now: number; mathProb?: number }` — byte-for-byte aligned with joker-system §7.2 (orchestrator reconciliation 2026-04-19).

### 1.3
The `ActiveProbe` interface shall contain exactly 10 fields: `whisperId`, `targetAiId`, `roundIdx`, `triggeredAtTurn`, `revealedReasoning`, `filterSource`, `startedAt`, `decayMs`, `expiresAt`, `rawLlmReasoning`. The `rawLlmReasoning` field is SERVER-ONLY and shall never cross the wire.

### 1.4
The `RevealedProbe` interface shall contain exactly 5 fields: `whisperId`, `revealedReasoning`, `filterSource`, `decayMs`, `expiresAt` — the client-safe projection of `ActiveProbe`.

### 1.5
The `ProbeFilterSource` type shall be the discriminated union `'llm-heuristic-layer' | 'regex-scrub' | 'fallback-static'`.

---

## 2. Pseudo-state derivation (LOCKED)

### 2.1
The probe shall be a pseudo-state per game-engine §1.1. NO `Round.status: 'probing'` value shall be introduced anywhere. The phase-gate derivation shall be `round.activeProbe !== undefined`, producing the kebab-case phase name `'probe-reveal'`.

### 2.2
`Round.activeProbe?: ActiveProbe` is the ONLY persisted addition for probe state. This field is pre-landed in commit `29f6a34` — tasks shall import and extend, NOT re-declare.

### 2.3
`ClientRound.currentProbe?: RevealedProbe` is the client projection of `Round.activeProbe`. Pre-landed — tasks shall populate it at runtime via the filter pipeline.

---

## 3. Reasoning filter — information security

### 3.1
The system shall implement a `probeFilter` function in `src/lib/probe/filter.ts` with signature `(rawLlmReasoning: string | undefined, persona: Persona, mathProb: number) => { revealedReasoning: string; filterSource: ProbeFilterSource }`.

### 3.2
The filter shall implement 3 lanes in priority order: (1) `llm-heuristic-layer` — if a structured `heuristicLayer` field is present, use it after numeric scrub; (2) `regex-scrub` — sanitize the full `innerThought` prose; (3) `fallback-static` — emit a pre-authored template chosen by `mathProb` signal.

### 3.3
The filter output shall NEVER contain any digit character (`[0-9]`) or the `%` character. This invariant applies across ALL 3 filter lanes, including the `llm-heuristic-layer` lane. _(Maps to design invariant I2.)_

### 3.4
The filter output shall NEVER contain any of the 4 canonical persona literals (`Novice`, `Reader`, `Misdirector`, `Silent`) — case-insensitive match. _(Maps to design invariant I3.)_

### 3.5
The filter output shall always be non-empty (≥ 1 character). _(Maps to design invariant I1.)_

### 3.6
The filter output shall be ≤ 120 characters. _(Maps to design invariant I4.)_

### 3.7
The filter shall be pure — no I/O, no `Math.random()`, no `Date.now()`. Same input shall always produce the same output. _(Maps to design invariant I5.)_

### 3.8
The filter shall never throw. Malformed, empty, null-like, very long, unicode-only, or control-character inputs shall route to the static-fallback lane. _(Maps to design invariant I6.)_

### 3.9
When `rawLlmReasoning` is `undefined` (AI deterministic-fallback path where `AiDecision.llmReasoning` is not populated), the filter shall return `filterSource: 'fallback-static'` with a non-empty `revealedReasoning`. _(Maps to design invariant I7.)_

### 3.10
The filter shall NEVER mutate the AI's LLM prompt. It runs post-hoc on stored `llmReasoning`, never during the LLM call. _(Per `.kiro/steering/llm-prompt-conventions.md`.)_

### 3.11
The regex-scrub lane shall: (1) strip numeric patterns, (2) strip persona identifiers, (3) strip debug-artifact tokens (`mathProb`, `lieScore`, `voiceMeta`, code blocks), (4) collapse whitespace, (5) truncate to first sentence, (6) hard-cap at 120 characters. If the result is empty or < 8 characters, fall through to `fallback-static`.

### 3.12
The static-fallback lane shall select a template based on `mathProb`: `≥ 0.7` → `"*Something feels off about this one.*"`, `≤ 0.3` → `"*The numbers look fine.*"`, else → `"*Hard to say.*"`.

---

## 4. Probe lifecycle

### 4.1
When the player activates a Stage Whisper probe via `POST /api/game/probe`, the system shall validate ALL of the following entry conditions before proceeding: (a) `session.status === 'round_active'`, (b) `round.status === 'response_phase'`, (c) `round.activeJokerEffects` contains at least one `{ type: 'stage_whisper' }` entry, (d) `round.claimHistory.length > 0`, (e) `round.claimHistory[-1].by === 'ai'`, (f) `round.activeProbe === undefined`. _(Maps to design invariant I8.)_

### 4.2
When all entry conditions are met, the system shall: (1) read the last claim from `round.claimHistory`, (2) call `probeFilter(claim.llmReasoning, persona, mathProb)`, (3) build an `ActiveProbe` with `decayMs = 4000`, (4) fire a `ProbeStart` event on the FSM setting `round.activeProbe`, (5) return the `ClientSession` with `currentProbe` populated.

### 4.3
While `round.activeProbe !== undefined` (probe-reveal pseudo-state), the system shall reject `PlayerRespond` events with `400 INVALID_PHASE` — defense in depth alongside UI gating.

### 4.4
When the player dismisses the probe early, the system shall fire a `ProbeComplete` event (owned by joker-system, consumed here) clearing `round.activeProbe`.

### 4.5
When the decay timer elapses (`Date.now() >= expiresAt`), the caller shall fire a `ProbeExpired` event (owned by probe-phase) clearing `round.activeProbe`.

### 4.6
Both `ProbeComplete` and `ProbeExpired` shall clear `round.activeProbe` identically. `round.status` shall NEVER be changed by probe events — probe is a pseudo-state. _(Maps to design invariant I11.)_

---

## 5. Concurrent probe rejection

### 5.1
If `round.activeProbe` is already set when a second probe request arrives, the system shall reject with `409 PROBE_ACTIVE`. _(Maps to design invariant I9.)_

### 5.2
Two Stage Whispers in joker inventory: the first probe fires; the second is rejected while the first is active. After the first completes, the second can fire. _(Maps to design invariant I12.)_

---

## 6. Wire security — rawLlmReasoning

### 6.1
`toClientView` shall strip `rawLlmReasoning` when projecting `Round.activeProbe` → `ClientRound.currentProbe`. The pre-landed strip in `toClientView.ts` already destructures out `activeProbe` — the probe-phase worktree shall populate `currentProbe` from the filtered `ActiveProbe` fields. _(Maps to design invariant I10.)_

### 6.2
`JSON.stringify()` of any `ClientSession` shall never contain the raw `llmReasoning` string, any digit from the raw reasoning, or any persona literal that was present in the raw reasoning.

---

## 7. FSM reducer additions

### 7.1
The `ProbeStart` event handler in `fsm.ts` shall set `round.activeProbe = event.probe`. It shall NOT mutate `round.status`.

### 7.2
The `ProbeComplete` event handler (consumed from joker-system) shall clear `round.activeProbe = undefined`. It shall validate that `round.activeProbe?.whisperId === event.whisperId`; mismatch → `InvalidTransitionError`.

### 7.3
The `ProbeExpired` event handler shall clear `round.activeProbe = undefined`. Same whisperId validation as `ProbeComplete`.

### 7.4
If `ProbeComplete` or `ProbeExpired` fires when `round.activeProbe === undefined`, the reducer shall throw `InvalidTransitionError('round_active(no_pending_probe)', ...)`.

---

## 8. API route

### 8.1
The system shall implement `POST /api/game/probe` in `src/app/api/game/probe/route.ts`. The route accepts `{ sessionId }` for probe initiation and `{ sessionId, action: 'complete' }` for early dismissal.

### 8.2
The route shall return appropriate HTTP error codes: `400 PROBE_REJECTED_NO_JOKER`, `400 PROBE_REJECTED_INVALID_PHASE`, `400 PROBE_REJECTED_NO_CLAIM`, `409 PROBE_ACTIVE`, `404 PROBE_NOT_FOUND`.

### 8.3
On success, the route shall return the updated `ClientSession` with `currentProbe` populated (on initiation) or absent (on completion).

---

## 9. Event ownership

### 9.1
Probe-phase OWNS `ProbeStart` and `ProbeExpired` events.

### 9.2
`ProbeComplete` is OWNED by joker-system (§7.1.1). Probe-phase only CONSUMES it in the reveal-completion reducer slice.

---

## 10. Cross-spec integration

### 10.1
The `ProbeRequest` shape consumed from joker-system shall match the LOCKED interface in requirement 1.2 byte-for-byte. Any deviation shall be escalated to Scott before implementation.

### 10.2
The probe-phase filter reads `Claim.llmReasoning` (populated by `ai-opponent/brain.ts` on LLM-success path only). When `llmReasoning === undefined` (fallback paths), the filter degrades to `fallback-static` cleanly.

### 10.3
The `mathProb` value is passed via `ProbeRequest.mathProb` (read from `AiDecision.mathProb` at consumption time). It is NOT persisted on `Claim`.

### 10.4
The `'probe-reveal'` phase name follows ui-gameplay's kebab-case convention. The derivation rule is `round.activeProbe !== undefined`.

---

## 11. `buildActiveProbe` helper

### 11.1
The system shall implement a `buildActiveProbe` helper in `src/lib/probe/reveal.ts` that constructs an `ActiveProbe` from a `ProbeRequest`, the filter output, and a `now` timestamp. This helper is pure.

### 11.2
The helper shall set `decayMs = 4000` (default), `expiresAt = startedAt + decayMs`, and populate all 10 `ActiveProbe` fields.

---

## Design questions for Scott

### Q1 — Full spoken-probe round-trip vs v1 snippet-reveal
The steering entry describes a richer interaction (player speaks a probe → AI answers via LLM + TTS with voice tells). This spec implements the simpler v1 subset (reasoning-snippet reveal, zero additional LLM call). Ship v1 for Day-4 and escalate to full spoken-probe on Day 5? **Recommendation: yes.**

### Q2 — Second concurrent probe: reject or queue?
Current spec rejects with 409. Queue adds state complexity and surprise UX. **Recommendation: reject (v1).**

### Q3 — Probe during multi-AI turn
N/A for 1v1 MVP. `targetAiId: 'ai'` is enum-shaped for forward-compat. No action needed.

### Q4 — Voice-wrapped reveal
Should `revealedReasoning` go through TTS + persona voice preset? Adds immersion but also latency + cost. **Recommendation: v1 text-only; revisit Day-5 polish.**

### Q5 — ProbeRequest interface reconciliation — **RESOLVED 2026-04-19**
Reconciled with joker-system §7.2 per orchestrator. The locked shape is in requirement 1.2. `roundId` dropped in favor of `roundIdx: number`. `triggeredAtTurn` and `mathProb?` added during reconciliation.

### Q6 — ai-opponent `heuristicLayer` extension — **STILL PENDING**
`LLMJudgmentOutput.heuristicLayer?: string` enables the zero-regex filter lane (§5.1). ~5-minute LLM prompt addition. Lanes 2 + 3 remain as defense-in-depth. **Recommendation: extend ai-opponent.** Escalate to Scott before touching `src/lib/ai/`.

### Q7 — Filter aggressiveness
Current filter is conservative (strips numbers + personas + collapses to one sentence). Tradeoff: tight filter = sparse reveals. **Recommendation: ship conservative; loosen after user-testing.**

### Q8 — Persona display-name table
If a display-name table is introduced cross-spec, `PERSONA_IDENTIFIERS` in `filter.ts` must be updated. No display-name table exists today — do not add speculative strings.
