# Hearsay

A voice-bluffing card game where the AI's voice betrays its lies — and yours might too.

Built for [ElevenHacks](https://elevenhacks.xyz) Hack #5 (AWS Kiro partner week, Apr 16-23 2026).

## The pitch

1 human vs 1 AI. 20 cards (5 Queens, 5 Kings, 5 Aces, 5 Jacks, no wilds). Best-of-3 rounds. Play 1-2 cards face-down, voice your claim ("One Queen."), opponent accepts or calls "Liar!". Three strikes and you're out.

**Voice IS gameplay.** The AI's ElevenLabs TTS voice parameters shift per persona × truth-state — the honest read and the lying read sound *different*, and you have to learn to hear the tell. Meanwhile, your own voice leaks clues back via ElevenLabs Scribe STT metadata (latency, fillers, pauses) that feed the AI's lie-detection heuristic.

Four personas with escalating difficulty: Novice, Reader, Misdirector, Silent. Five session-Jokers. Probing unlocked via Stage Whisper.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind 4
- **ElevenLabs** JS SDK — Flash v2.5 TTS, Scribe STT, Music API
- **Google Gemini 2.5 Flash** — AI decisioning (hybrid: deterministic math baseline + LLM orchestrator + deterministic fallback on 2s timeout)
- **Kiro** — spec-driven development (9 specs + steering + hooks + custom MCP server)
- **Vercel** — deploy
- **pnpm**, **Vitest**

## Architecture

Full design at [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (coming). Built spec-first with Kiro — see `.kiro/` for the spec trilogy, steering files, hooks, and the custom `game-debug` MCP server.

## License

MIT — see [LICENSE](LICENSE).

## ⚠️ DO NOT gitignore `.kiro/`

The `.kiro/` folder is a hackathon submission requirement. It contains specs, steering, hooks, and MCP server that judges inspect for the Implementation pillar. Do not add it to `.gitignore`.
