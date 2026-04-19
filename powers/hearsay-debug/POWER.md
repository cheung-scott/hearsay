---
name: hearsay-debug
version: 0.1.0
description: Debug + inspect the Hearsay voice-bluffing game engine from Kiro.
mcpServers:
  - hearsay-debug
---

# Hearsay Debug Power

Read-only inspection + dev-gated force-transition for Hearsay sessions. All seven tools route through the production FSM reducer or Vercel KV store — no cheat vectors, no parallel gameplay logic.

## Tools (7)

1. `readGameState` — current session state (client projection or full session; `view: 'full'` requires `HEARSAY_DEBUG=1`).
2. `listSessions` — enumerate active sessions in Vercel KV (scans `hearsay:session:*`).
3. `inspectAIDecision` — full AI reasoning for a given turn (`llmReasoning` + `ttsSettings`). Requires `HEARSAY_DEBUG=1`.
4. `forceTransition` — dispatch a raw FSM event through `reduce(session, event)`. Respects all FSM guards. Requires `HEARSAY_DEBUG=1`.
5. `replayRound` — walk through a round's claim history as `PublicClaim` entries. Read-only.
6. `listFSMEvents` — catalog of every `GameEvent` variant (type, required fields, description).
7. `dumpTranscript` — narrative or JSON playback of a session. Never emits raw card IDs.

## Permissions

- `HEARSAY_DEBUG=1` gates `forceTransition`, `inspectAIDecision`, and `view='full'` on `readGameState`.
- The flag is read once at server start and cached; mutating `process.env` after boot does nothing.
- Production deployments must never set this flag.

## Principled debugging line

This Power deliberately ships **inspection tools only**. The forbidden list (rejected at spec review):

- `revealActualCardIds`
- `setOpponentToAlwaysLose` / `setStrikes`
- `muteLLMSoAiIsDeterministic`
- `clientInjectAiDecision`
- Any tool that bypasses FSM guards or writes to KV outside `reduce`

See `.kiro/specs/game-debug/design.md` §1.4 and §5.7 for the full rationale.

## Onboarding

1. Install via Kiro → **Add power from GitHub**, pasting this repo's URL — or via project-scope `.kiro/mcp.json` pointing at this Power.
2. Ensure `KV_URL` + `KV_REST_API_TOKEN` are set in the shell (same env as the Hearsay app).
3. Set `HEARSAY_DEBUG=1` only when you want `forceTransition` / `inspectAIDecision` / full-view reads.
4. `pnpm install` at the repo root, then Kiro auto-spawns the server via the `mcp.json` in this directory.

## Transport

- `stdio` by default. Kiro spawns the server as a child process and talks over stdin/stdout. All logs go to stderr; stdout is reserved for MCP framing.
- Optional `HTTP` via `HEARSAY_DEBUG_HTTP=127.0.0.1:7850 pnpm dev:http` — bound to loopback only. Non-loopback hosts throw at startup; there is no `0.0.0.0` fallback.

## License

MIT.
