# Tech stack — Hearsay

| Layer | Choice | Rationale |
|---|---|---|
| Frontend framework | **Next.js 16** (App Router) + TypeScript + Tailwind 4 | One-language TS for solo build velocity; App Router for streaming TTS/SSE; scaffolded 2026-04-17 (version bumped from architecture's "Next 14" target — App Router contract unchanged) |
| UI components | shadcn/ui (to install as needed) | Polished defaults without bespoke component work |
| Backend | Next.js API routes (same repo) | Zero-infra overhead for API layer |
| AI decisioning | **Gemini 2.5 Flash** (`@google/genai`, free tier) with deterministic math grounding + deterministic fallback on 2s LLM timeout or invalid JSON | Natural varied behavior; $0 cost; latency/failure safety net |
| Voice TTS (live gameplay) | **ElevenLabs JS SDK** (`@elevenlabs/elevenlabs-js`), model `eleven_flash_v2_5` | ~75ms latency — fastest ElevenLabs model, fits turn-by-turn gameplay |
| Voice TTS (§1.5 elimination beat ONLY) | **ElevenLabs Eleven v3** | Emotional tags (`[gasps]`, `[laughs]`, `[whispers]`, `[sighs]`, `[breathing heavily]`) that Flash v2.5 ignores — used for 4 pre-gen per-persona final-words clips only. Not for live gameplay. |
| Voice STT | **ElevenLabs Scribe** (word-level timestamps) | Native lie-heuristic signal (latency, fillers, pauses, speech rate) without custom VAD |
| SFX (§1.5) | **ElevenLabs Sound Effects API** (`POST /v1/sound-generation`, model `eleven_text_to_sound_v2`, 40 credits/sec) | Pre-gen strike-3 stinger + silent-beat mechanical SFX. Cached as static MP3s. Never runtime. |
| Music | **ElevenLabs Music API** (min 3s duration, tension-adaptive, 3 pre-gen tracks per session via `Promise.all`) + client-side **Web Audio `GainNode` ducking** | Extends ElevenLabs surface area beyond TTS; GainNode ducks to silence 400ms on every reveal (§1.5 silent beat) + 800ms fade on `session_over` |
| Voice Design (Day 2 stretch) | **ElevenLabs Voice Generation API** | Design 4 persona voices from character descriptions at Day 2 tuning time. A/B vs preset library; keep whichever sounds better per persona. 5th ElevenLabs API surface = stronger "creative use" signal for judging priority #2. Design is one-time; generated voice IDs are free to reuse. |
| Session state | In-memory `Map<sessionId, Session>` on server + `localStorage` on client (jokers / streak) | No DB — simplifies deploy, session is ephemeral by design |
| Deploy | **Vercel** (`hearsay-hazel.vercel.app`) | <60s live URL; auto-deploy on push to main |
| Testing | **Vitest** + Testing Library | Next.js-native, fast, no Jest config overhead |
| IDE | **Kiro** (partner requirement) | Spec-driven methodology visible to judges |
| Package manager | **pnpm** | Fast installs; symlink-based node_modules |

**Total runtime cost:** $0 — Gemini Flash free tier (1500 req/day), ElevenLabs Creator tier (claimed Apr 17 — 100k credits + PVC + 192kbps + commercial use), Vercel hobby tier, Kiro Pro+ free April (2000 credits).

## Key integration decisions

**Hybrid AI pipeline.** Every AI decision flows through three stages:

1. **Deterministic math baseline** (<1ms) — `claimMathProbability()` for judgment, `PERSONA_BLUFF_BIAS` for own play. Always runs; provides grounding context + fallback path.
2. **LLM orchestrator** (Gemini Flash, ~500–1500ms) — receives math baseline + voice meta + persona + context; returns structured JSON with action + dialogue + innerThought. Schema-validated.
3. **Deterministic fallback** — auto-triggers if LLM times out >2s, returns non-JSON, or fails schema validation. Same heuristic as step 1, no LLM needed.

**Why hybrid:** pure deterministic = predictable / boring. Pure LLM = unreliable latency + occasional nonsense outputs. Hybrid = natural varied behavior with hard SLA on turn time.

**Voice parameter modulation.** Per-request `voice_settings` override on ElevenLabs Flash v2.5. Each (persona × truthState) combo has a locked `VoiceSettings` preset. Day 1 spike validates this API surface works as documented. Fallback (risk #1): 2 cloned voice IDs per persona (PVC unlocked via Creator tier), swap IDs instead of settings.

**STT metadata pipeline.** Scribe returns word-level timestamps. Heuristic computes:
- `latencyMs` (turn start → first non-silence frame)
- `fillerCount` (regex match on um/uh/er/like/so/you know/kinda/i mean)
- `pauseCount` (inter-word gaps >400ms excluding initial latency)
- `speechRateWpm`

Weighted combo → `lieScore` ∈ [0, 1]. Fed to AI judging pipeline + optionally shown to player during autopsy.

**Music API pre-generation.** 3 tracks per session (calm / tense / critical), pre-generated CONCURRENTLY via `Promise.all` at session start. Serial generation would take up to 30s; concurrent caps at ~10s. Display "Generating game..." during wait. Runtime just streams cached tracks based on `tensionLevel` (derived from strikes).

## Environment variables

```
ELEVENLABS_API_KEY=           # server-side only (never expose to client)
GEMINI_API_KEY=               # server-side only
```

Stored in `.env.local` (gitignored); wired into Vercel project env for production.

## What NOT to use

- No DB / ORM (in-memory + localStorage is enough — session state is ephemeral)
- No real-time frameworks (WebSocket / Socket.io) — HTTP + SSE suffices for turn-based
- No auth / user accounts — anonymous sessions only
- No custom audio mixing beyond ElevenLabs outputs
- No pitch / emotion / stress detection — text-derived metadata from Scribe is enough

## Canonical stack reference

See [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) §2 (stack) and §7 (AI pipeline) for full detail + rationale.
