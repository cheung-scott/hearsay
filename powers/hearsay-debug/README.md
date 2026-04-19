# hearsay-debug — Kiro Power

MCP debug server for the Hearsay voice-bluffing card game. Exposes 7 inspect / replay / force-transition tools over stdio or a loopback-bound HTTP transport.

Authoritative spec: [`.kiro/specs/game-debug/design.md`](../../.kiro/specs/game-debug/design.md).

## What it does

Distributed as a Kiro Power (POWER.md + mcp.json + installable GitHub URL). Lets Kiro agents and the developer:

- Read live session state from Vercel KV.
- Inspect the AI's `llmReasoning` for any past turn (dev-only).
- Force an FSM event through the real `reduce()` reducer, respecting every invariant guard (dev-only).
- Replay a round's claim history.
- List every `GameEvent` type with required fields.
- Dump a human-readable transcript for demo videos.

See `POWER.md` for the full tool list and permission model.

## Prerequisites

- `KV_URL` and `KV_REST_API_TOKEN` — the same Vercel KV creds used by the Hearsay Next.js app. Required by every tool except `listFSMEvents`.
- Optional: `HEARSAY_DEBUG=1` — unlocks `forceTransition`, `inspectAIDecision`, and `view='full'` on `readGameState`.
- Node 20+ and pnpm 9+.

## Install

### Via Kiro "Add power from GitHub"

Paste the GitHub URL of the repo hosting this Power into Kiro's Powers panel. Kiro reads `POWER.md` and the sibling `mcp.json`, registers the server, and auto-spawns it.

### Via project-scope `.kiro/mcp.json`

Project-local install (what the Hearsay repo itself uses during development):

```json
{
  "mcpServers": {
    "hearsay-debug": {
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "${workspaceFolder}/powers/hearsay-debug/src/index.ts"
      ],
      "env": {
        "HEARSAY_DEBUG": "${HEARSAY_DEBUG}",
        "KV_URL": "${KV_URL}",
        "KV_REST_API_TOKEN": "${KV_REST_API_TOKEN}"
      }
    }
  }
}
```

## Development

```
pnpm install            # at the repo root — resolves the Power via pnpm workspace
pnpm -C powers/hearsay-debug dev        # stdio, tsx watch
pnpm -C powers/hearsay-debug dev:http   # http://127.0.0.1:7850/mcp
pnpm -C powers/hearsay-debug test       # vitest (36 tests, all invariants I1-I9)
pnpm -C powers/hearsay-debug typecheck  # tsc --noEmit
```

Runtime is always `node --import tsx src/index.ts`. No build step is required or shipped — the Power imports read-only from the Hearsay app's TS source at runtime via tsx.

## Principled debugging line

This Power ships inspection tools only. Forbidden (would be rejected at review):

- `revealActualCardIds`
- `setOpponentToAlwaysLose` / `setStrikes`
- `muteLLMSoAiIsDeterministic`
- `clientInjectAiDecision`
- Anything that bypasses `reduce()` or writes to KV outside it.

Justification lives in design §1.4 / §5.7.

## License

MIT.
