# Hearsay

> A voice-bluffing card game where the AI's voice betrays its lies — and yours might too.

**[▶ Play the live demo](https://hearsay-hazel.vercel.app)** · Built for [ElevenHacks](https://elevenhacks.xyz) Hack #5 (AWS Kiro partner week, Apr 16–23 2026).

---

## The pitch

1 human vs 1 AI. 20 cards (5 Queens, 5 Kings, 5 Aces, 5 Jacks — no wilds). Best-of-3 rounds. Play 1–2 cards face-down, voice your claim (*"One Queen."*), opponent accepts or calls *"Liar!"* Three strikes and you're out.

**Voice IS gameplay.** The AI's ElevenLabs TTS voice parameters shift per persona × truth-state — the honest read and the lying read sound *different*, and you have to learn to hear the tell. Meanwhile, your own voice leaks clues back via ElevenLabs Scribe STT metadata (latency, filler words, pauses, speech rate) that feed the AI's lie-detection heuristic.

Four personas with escalating difficulty: **Novice** (obvious tells, bad reader), **Reader** (balanced), **Misdirector** (inverts the mapping — faking tells on honest claims), **Silent** (minimal tells, strong reader). Five session-jokers carried across rounds. Probing unlocked via the Stage Whisper joker.

## Spec-driven methodology (for judges)

This project is built spec-first in [Kiro](https://kiro.dev). Every feature has a requirements/design/tasks trilogy under `.kiro/specs/`, so the design rationale is visible in the repo, not just in the commit history.

- **`.kiro/steering/`** — always-loaded product + tech + structure context (5 files). Every Kiro chat reads these.
- **`.kiro/specs/game-engine/`** — finalized after a 3-iteration review loop ([`design.md`](.kiro/specs/game-engine/design.md) · [`requirements.md`](.kiro/specs/game-engine/requirements.md) · [`tasks.md`](.kiro/specs/game-engine/tasks.md)). 16 Vitest invariants, 21 EARS requirements, 13 implementation tasks with checkpoints, full invariant-to-task traceability.
- **8 more specs in flight** — voice-tell-taxonomy, ai-opponent, strikes-penalty-system, joker-system, ai-personas, probe-phase, tension-music-system, deck-and-claims.
- **`.kiro/hooks/`** — on-save-run-tests + on-commit-append-changelog (Day 2+).
- **`game-debug` MCP server** (Day 5) — lets the Kiro agent inspect live sessions during development.

## Stack

- **[Next.js 16](https://nextjs.org)** App Router · TypeScript · Tailwind 4
- **[ElevenLabs JS SDK](https://elevenlabs.io)** — Flash v2.5 TTS (per-request `voiceSettings` modulation per persona × truth-state), Scribe STT (word-level timestamps → lie-score heuristic), Music API (tension-adaptive score), Sound Effects API (§1.5 elimination-beat stingers)
- **[Google Gemini 2.5 Flash](https://ai.google.dev)** — hybrid AI decisioning: deterministic math baseline → LLM orchestrator → deterministic fallback on 2 s timeout or invalid JSON
- **[Vercel](https://vercel.com)** — deploy + live URL
- **pnpm** · **Vitest**

## Status (Day 1 — 2026-04-17)

- [x] Public repo, MIT license, `.kiro/` committed
- [x] Vercel live: [hearsay-hazel.vercel.app](https://hearsay-hazel.vercel.app)
- [x] ElevenLabs TTS round-trip (`/api/ping-voice` — Flash v2.5 with per-request voice settings override)
- [x] `.kiro/steering/` — 5 files committed
- [x] `.kiro/specs/game-engine/` — spec trilogy finalized (iter 3 converged)
- [ ] Day 2 — voice system: 4-persona × 2-truth-state presets, STT heuristic, parse layer, tuning block
- [ ] Day 3 — LLM orchestrator + Reader persona end-to-end
- [ ] Day 4 — remaining personas + jokers + probe-phase + demo B-roll
- [ ] Day 5 — remaining jokers + autopsy + Music API + game-debug MCP + tests
- [ ] Day 6–8 — polish, demo video (60–90 s), social posts, submit by Apr 23 17:00 UK

## Run it locally

```bash
pnpm install
cp .env.local.example .env.local   # add ELEVENLABS_API_KEY + GEMINI_API_KEY
pnpm dev                            # → http://localhost:3000
pnpm test                           # Vitest (spec invariants)
```

## License

MIT — see [LICENSE](LICENSE).

---

> ⚠️ **DO NOT gitignore `.kiro/`** — hackathon submission requires the `.kiro/` folder in the public repo so judges can evaluate the Implementation pillar. Guard comment lives at the top of `.gitignore`.
