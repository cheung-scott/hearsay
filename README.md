# Hearsay

> A voice-bluffing card game where the AI's voice betrays its lies — and yours might too.

**[▶ Play the live demo](https://hearsay-hazel.vercel.app)** · Built for [ElevenHacks](https://elevenhacks.xyz) Hack #5 (AWS Kiro partner week, Apr 16–23 2026).

---

## The pitch

1 human vs 1 AI. 20 cards (5 Queens, 5 Kings, 5 Aces, 5 Jacks — no wilds). Best-of-3 rounds. Play 1–2 cards face-down, voice your claim (*"One Queen."*), opponent accepts or calls *"Liar!"* Three strikes and you're out.

**Voice IS gameplay.** The AI's ElevenLabs TTS voice parameters shift per persona × truth-state — the honest read and the lying read sound *different*, and you have to learn to hear the tell. Meanwhile, your own voice leaks clues back via ElevenLabs Scribe STT metadata (latency, filler words, pauses, speech rate) that feed the AI's lie-detection heuristic.

Four personas with escalating difficulty:

- **Novice** — obvious tells, weak reader
- **Reader** — balanced
- **Misdirector** — inverts the mapping, faking tells on honest claims
- **Silent** — minimal tells, strong reader

Five session-jokers carried across rounds. Probing unlocked via the Stage Whisper joker.

## Engineering approach

Built **spec-first in [Kiro](https://kiro.dev)**. Every feature ships with a requirements / design / tasks trilogy under `.kiro/specs/`, so the design rationale is auditable in the repo, not just in commit messages.

- **`.kiro/steering/`** — always-loaded product + tech + structure context (5 files) read by every Kiro chat.
- **`.kiro/specs/game-engine/`** — finalized after a 3-iteration review loop ([`design.md`](.kiro/specs/game-engine/design.md) · [`requirements.md`](.kiro/specs/game-engine/requirements.md) · [`tasks.md`](.kiro/specs/game-engine/tasks.md)). 16 Vitest invariants, 21 EARS requirements, 13 implementation tasks with checkpoints, full invariant-to-task traceability.
- **Eight specs in flight** — voice-tell-taxonomy · ai-opponent · strikes-penalty-system · joker-system · ai-personas · probe-phase · tension-music-system · deck-and-claims.
- **`.kiro/hooks/`** — on-save-run-tests + on-commit-append-changelog.
- **`game-debug` MCP server** lets the Kiro agent inspect live game sessions during development.

## AI orchestration

Decisioning uses a three-tier fallback chain rather than a naive one-shot LLM call:

1. **Deterministic math baseline** — a pure-function lie-score computed from voice-metadata features. Always runs first, never blocks.
2. **LLM orchestrator** — Gemini 2.5 Flash re-weights the baseline with persona context and returns a JSON decision. 2-second timeout.
3. **Deterministic fallback** — if the LLM times out or returns invalid JSON, the baseline decision stands.

This is a small case of cost- and latency-aware model routing: call the frontier model only when the cheap path's confidence is ambiguous, and never let the LLM block gameplay.

## Stack

- **[Next.js 16](https://nextjs.org)** App Router · TypeScript · Tailwind 4
- **[ElevenLabs JS SDK](https://elevenlabs.io)** — Flash v2.5 TTS (per-request `voiceSettings` modulation per persona × truth-state), Scribe STT (word-level timestamps → lie-score heuristic), Music API (tension-adaptive score), Sound Effects API (elimination-beat stingers)
- **[Google Gemini 2.5 Flash](https://ai.google.dev)** — hybrid AI orchestrator (see above)
- **[Vercel](https://vercel.com)** — deploy + live URL
- **pnpm** · **Vitest**

## Run it locally

```bash
pnpm install
cp .env.local.example .env.local   # add ELEVENLABS_API_KEY + GEMINI_API_KEY
pnpm dev                            # → http://localhost:3000
pnpm test                           # Vitest (spec invariants)
```

## License

MIT — see [LICENSE](LICENSE).
