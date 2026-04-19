---
inclusion: fileMatch
fileMatchPattern: "powers/hearsay-debug/**/*.ts|powers/hearsay-debug/POWER.md"
date: 2026-04-19
---

# game-debug — Design

## Provenance

Authored by Claude Code 2026-04-19 as the TypeScript-level codification of the `game-debug` spec — a **Model Context Protocol (MCP) server** exposing read + forced-state inspection tools for the Hearsay game engine, distributed as a **Kiro Power** (the AWS-Kiro plugin convention). Kiro Spec mode will generate `requirements.md` + `tasks.md` from this design via the seeded prompt in §12. Tasks will be executed by Claude Code with Sonnet 4.6 implementation subagents + Opus 4.7 review subagent.

Hearsay is a voice-bluffing card game (1 human vs 1 AI) built for ElevenHacks Hack #5 (AWS Kiro partner week). This spec is explicitly a **companion tool** — not gameplay. It lets Kiro agents (and the developer) introspect live sessions, replay rounds, inspect AI reasoning, and force the FSM into awkward states during development. The judging angle: **95 % of hackathon entrants use Kiro; only a tiny fraction package their own Powers.** Shipping a signed, installable Power demonstrates full Kiro-surface fluency.

Iter-1 review (2026-04-19) applied: 6 findings fixed (0 critical, 1 high, 5 medium). MCP SDK call shape Context7-verified.

**Scope of this spec:**
- MCP server (`@modelcontextprotocol/sdk` TypeScript SDK) with 7 inspection / debug tools
- stdio transport (local-only), optional 127.0.0.1-bound HTTP
- Read-only access to the existing `src/lib/session/store.ts` (Vercel KV) and `src/lib/game/types.ts`
- `HEARSAY_DEBUG=1` env-flag gating for dev-only tools (`forceTransition`, `inspectAIDecision`)
- Kiro Power packaging (`powers/hearsay-debug/` with `POWER.md`, `mcp.json`, `package.json`, `src/`)

**NOT in this spec** (out of scope — see §9):
- Any modification to existing game-engine / AI / UI code
- Gameplay cheat tools (`revealActualCardIds`, `setOpponentToAlwaysLose`, etc. — see §1 ethical line)
- MCP client / prompt / resource surfaces beyond what the 7 tools need
- Authentication / multi-tenant packaging (local-dev only)
- Observability tooling beyond a basic stdout logger

---

## 1. Overview

### 1.1 Purpose

Two concurrent jobs:

1. **Debugging & demo capture (developer-facing).** During the 7-day hackathon, the author has to chase FSM bugs, AI reasoning regressions, and voice-layer desyncs across a live Next.js dev server. The MCP server lets Kiro (or Claude Code) read any session's current state, replay the event sequence of a round, dump the full narrative transcript for a demo video, and — critically — **inspect the AI's `llmReasoning` + `claimMathProbability`** which are stripped from every wire response by `toClientView`. Server-side full-fidelity data, only exposed when the MCP server is running locally.

2. **Hackathon differentiation (judges-facing).** Distributing the server as a Kiro Power (with POWER.md + installable GitHub URL) proves the project leans into the whole Kiro plugin surface — not just the specs + steering + chat that most entrants use. Stronger signature than another spec file.

### 1.2 In-scope

- Seven MCP tools (table in §5):
  - `readGameState` — current `ClientSession` projection
  - `listSessions` — active session IDs in KV
  - `inspectAIDecision` — full `AiDecision` / `AiPlay` including `llmReasoning`
  - `forceTransition` — dispatch a raw `GameEvent` through the FSM reducer
  - `replayRound` — re-emit the event sequence for one round
  - `listFSMEvents` — FSM schema introspection (for judges / learners)
  - `dumpTranscript` — human-readable narrative of all claims + judgments
- stdio transport as default (Kiro convention); opt-in HTTP bound to 127.0.0.1 only
- `HEARSAY_DEBUG=1` flag gating `forceTransition` + `inspectAIDecision`
- Kiro Power packaging (POWER.md + mcp.json + install URL)
- MIT license (matches hackathon requirement + Kiro Powers convention)

### 1.3 Out-of-scope (this spec is not gameplay)

This server is an observability layer. It **never** participates in live gameplay. It does not:

- Replace the `ai-opponent` brain, the `game-engine` FSM, or the Vercel KV store
- Mutate sessions in production deployments (gated by `HEARSAY_DEBUG`)
- Serve any wire path the browser client depends on
- Implement any gameplay UX

### 1.4 The principled debugging line (LOAD-BEARING — judging angle)

The tool catalog in §5 draws a hard ethical line. **Debugging / inspection tools are allowed. Tools that let the user win without playing are forbidden.**

Concretely:

| Allowed (in this spec) | Forbidden (NOT in this spec) |
|---|---|
| Read current session state | Reveal opponent's hand (`actualCardIds`) to the browser client |
| Inspect past `AiDecision.llmReasoning` | Live-edit `AiDecision.action` before the FSM sees it |
| Force an FSM event (through the real reducer + guards) | Bypass FSM guards (e.g. force `ClaimAccepted` in `claim_phase`) |
| Replay a round's event history | Replay with tampered events that set opponent strikes to 3 |
| Dump the transcript for a demo video | Auto-pilot the AI to always lose |

**Key invariant:** `forceTransition` dispatches through `reduce(session, event)` — the same pure function the production API routes call. It **bypasses the UI, but NOT the FSM's invariant guards.** An invalid event throws `InvalidTransitionError` exactly as in production. This is stated in §5 and tested as I2.

The tool surface is small on purpose — every additional tool is a potential cheat vector. If a future spec needs one, it must justify the line.

---

## 2. Key concepts

- **MCP (Model Context Protocol).** Anthropic-backed open standard for LLM agents to invoke structured tools on local / remote servers. Kiro embeds an MCP client; this spec builds a server that Kiro talks to.
- **Tool registration.** Each tool is registered via `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)`. Input validated by Zod; output is a `content` array (usually `[{ type: 'text', text: JSON.stringify(result) }]`). The second argument is a config object (not a raw Zod schema). Cited SDK pattern — see §3 citation.
- **stdio transport.** Default for local tools. The MCP client (Kiro) spawns the server as a child process and talks over stdin/stdout. No network binding, no auth needed.
- **Streamable HTTP transport.** Optional remote mode. We bind to `127.0.0.1` only — enough for curl-from-localhost debugging without exposing the server to the LAN.
- **Kiro Power.** A distributable MCP + steering bundle. Minimum shape: `POWER.md` (required, with frontmatter + agent instructions) in repo root; `mcp.json` if the Power uses MCP servers; optional `steering/` directory. Installed by pasting a GitHub repo URL into Kiro's "Add power from GitHub" panel.
- **Principled debugging.** See §1.4 — the ethical line between inspection and cheating. Load-bearing for judges.
- **HEARSAY_DEBUG env flag.** Single bit gate. Unset (or `0`) → dev-only tools (`forceTransition`, `inspectAIDecision`) refuse with `ToolPermissionDenied`. Set to `1` → allowed. Production deployments never set it.

---

## 3. Architecture

```
                ┌───────────────────────────┐
                │  Kiro IDE (MCP client)    │
                └────────────┬──────────────┘
                             │  stdio (default) OR
                             │  Streamable HTTP @ 127.0.0.1 (opt-in)
                             ▼
           ┌─────────────────────────────────────────┐
           │  hearsay-debug MCP server               │
           │  (powers/hearsay-debug/src/index.ts)    │
           │                                         │
           │  ┌───────────────────────────────────┐  │
           │  │ tool registry (§5)                │  │
           │  │  - readGameState                  │  │
           │  │  - listSessions                   │  │
           │  │  - inspectAIDecision  (DEV only)  │  │
           │  │  - forceTransition    (DEV only)  │  │
           │  │  - replayRound                    │  │
           │  │  - listFSMEvents                  │  │
           │  │  - dumpTranscript                 │  │
           │  └─────────────┬─────────────────────┘  │
           │                │ consumes               │
           └────────────────┼────────────────────────┘
                            │
          ┌─────────────────┼───────────────────┐
          ▼                                     ▼
 ┌──────────────────┐             ┌──────────────────────┐
 │  session store   │             │  pure FSM reducer    │
 │  (read-only)     │             │  (read-only import)  │
 │                  │             │                      │
 │ src/lib/session/ │             │ src/lib/game/fsm.ts  │
 │  store.ts        │             │  reduce(s, e)        │
 │    get / delete  │             │  + toClientView      │
 │    (@vercel/kv)  │             │                      │
 └──────────────────┘             └──────────────────────┘
          │                                     │
          ▼                                     ▼
  ┌───────────────┐                     ┌──────────────────┐
  │ Vercel KV     │                     │ src/lib/game/    │
  │ (Upstash      │                     │   types.ts       │
  │  Redis)       │                     │ src/lib/ai/      │
  └───────────────┘                     │   types.ts       │
                                        └──────────────────┘
```

**Key architectural choices:**

1. **Read-only imports from `src/lib/**`.** The Power is a sibling of the Next.js app (`powers/hearsay-debug/`) and imports types + `reduce` + `toClientView` + `store.get/set/delete` via relative path (`../../src/lib/...`) or a workspace alias configured in the Power's `tsconfig.json`. It never modifies these files.
2. **Store read is never mutating by default.** Only `forceTransition` writes back to KV (gated by `HEARSAY_DEBUG`). Every other tool is pure read.
3. **FSM reducer is re-used as-is.** The existing pure `reduce()` enforces all invariants. We get free correctness — forced transitions can never silently desync the session.
4. **Transport is injected.** `index.ts` picks stdio vs HTTP from argv / env, wires the appropriate transport, then `await server.connect(transport)`.

**MCP SDK citation.** Based on Context7 `/modelcontextprotocol/typescript-sdk` (High source reputation, 223 snippets). The high-level API is `McpServer` (imported from `@modelcontextprotocol/sdk/server/mcp.js`) + `StdioServerTransport` (from `@modelcontextprotocol/sdk/server/stdio.js`). Tool registration uses `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)` — the current documented API per `github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md`. (Legacy `server.tool()` still works but `registerTool` is the canonical form.) Handler returns `{ content: [{ type: 'text', text }] }`.

---

## 4. Data model

All types live in `powers/hearsay-debug/src/schemas.ts`. Consumed-types are re-imported from the Hearsay app; tool-local types are defined here.

### 4.1 Tool input / output shapes (Zod-level)

```ts
import { z } from 'zod';

// ---- INPUT SCHEMAS ----

export const ReadGameStateInput = z.object({
  sessionId: z.string().min(1),
  view: z.enum(['client', 'full']).default('client'),
});

export const ListSessionsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const InspectAIDecisionInput = z.object({
  sessionId: z.string().min(1),
  turnIndex: z.number().int().min(0).describe('0-based claim index across all rounds'),
});

export const ForceTransitionInput = z.object({
  sessionId: z.string().min(1),
  event: z.record(z.unknown()).describe('A GameEvent object — see listFSMEvents for schema'),
  dryRun: z.boolean().default(false),
});

export const ReplayRoundInput = z.object({
  sessionId: z.string().min(1),
  roundIndex: z.number().int().min(0).max(2),
});

export const ListFSMEventsInput = z.object({}); // no args

export const DumpTranscriptInput = z.object({
  sessionId: z.string().min(1),
  format: z.enum(['narrative', 'json']).default('narrative'),
});
```

### 4.2 Output envelope

Every tool returns `{ content: [{ type: 'text', text: string }] }` per MCP SDK convention. The `text` field is JSON.stringify(payload) for structured tools, or a human-readable transcript for `dumpTranscript` (`format: 'narrative'`).

```ts
export interface ToolSuccess<T> { ok: true;  data: T;  }
export interface ToolError      { ok: false; code: ToolErrorCode; message: string; details?: unknown; }

export type ToolErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'ROUND_NOT_FOUND'
  | 'TURN_NOT_FOUND'
  | 'INVALID_TRANSITION'      // FSM guard rejected — forceTransition did NOT bypass
  | 'PERMISSION_DENIED'       // HEARSAY_DEBUG unset for a dev-only tool
  | 'KV_ERROR'
  | 'INVALID_INPUT';          // Zod validation failed before handler ran
```

### 4.3 Debug permission config

```ts
export interface DebugPermissions {
  /** Reads env HEARSAY_DEBUG at server-start; cached for server lifetime. */
  allowForceTransition: boolean;
  allowInspectAIDecision: boolean;
}

export function loadPermissions(): DebugPermissions {
  const allowed = process.env.HEARSAY_DEBUG === '1';
  return {
    allowForceTransition: allowed,
    allowInspectAIDecision: allowed,
  };
}
```

Captured at process start — a running server cannot be unlocked at runtime by mutating `process.env`. Discourages session-cookie-style reuse of a long-lived server.

### 4.4 MCP server config

```ts
export interface MCPServerConfig {
  name: 'hearsay-debug';
  version: string;           // mirrors powers/hearsay-debug/package.json version
  transport: 'stdio' | 'http';
  httpPort?: number;          // only when transport === 'http', bound to 127.0.0.1
  instructions: string;      // McpServer config — short usage hint shown to the agent
}
```

---

## 5. Tool catalog

All tools register via `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)`. Handlers are async and return `{ content: [{ type: 'text', text }] }`.

| # | Name | Input | Output | Permission | Purpose |
|---|---|---|---|---|---|
| 1 | `readGameState` | `{ sessionId, view }` | `ClientSession` (view=`client`) or full `Session` (view=`full`, dev-only) | safe (client view) / dev-only (full) | Inspect current session — cards, rounds, strikes, phase. Default is `client` view (matches wire projection). |
| 2 | `listSessions` | `{ limit }` | `Array<{ id: string; status: Session['status']; currentRoundIdx: number; updatedAtHint?: number }>` | safe | Enumerate KV sessions for the developer to pick one. Uses `SCAN` under `hearsay:session:*` prefix. Implementation note: `listSessions` bypasses `store.ts` and imports `kv` directly from `@vercel/kv` (read-only `keys` scan). Does not extend the store.ts public surface. |
| 3 | `inspectAIDecision` | `{ sessionId, turnIndex }` | Full `Claim` incl. `llmReasoning`, `ttsSettings`; `mathProb` sourced from `AiDecision` (ai/types.ts L63) — see implementation note below | **dev-only** | Post-mortem inspect why the AI accepted / challenged a specific turn. Requires `HEARSAY_DEBUG=1` because `llmReasoning` leaks AI reasoning normally hidden from player. Implementation note: `mathProb` is NOT persisted on `Claim` (types.ts §Claim interface — only `llmReasoning`, `ttsSettings`); it lives on `AiDecision` (ai/types.ts L63). If the stored `Claim` lacks it, `inspectAIDecision` re-runs `claimMathProbability(ctx)` against the rebuilt `DecisionContext`. If re-derivation fails for any reason, the field is omitted rather than faked. |
| 4 | `forceTransition` | `{ sessionId, event, dryRun }` | `{ before: ClientSession; after: ClientSession; applied: boolean }` | **dev-only** | Dispatch a raw `GameEvent` through `reduce(session, event)` + persist (unless `dryRun`). **Respects all FSM guards** — e.g. `ClaimAccepted` during `claim_phase` throws `InvalidTransitionError`. |
| 5 | `replayRound` | `{ sessionId, roundIndex }` | `Array<{ event: PublicClaim; projectedState: ClientSession }>` — one entry per recorded claim | safe | Walk through a round's claim history, rebuilding observable state at each step. Read-only; never writes to KV. |
| 6 | `listFSMEvents` | `{}` | JSON schema of the `GameEvent` discriminated union, extracted from `src/lib/game/types.ts` | safe | Teach the agent / user what events exist, with required fields. Enables `forceTransition` self-documenting. |
| 7 | `dumpTranscript` | `{ sessionId, format }` | Narrative string (`format=narrative`) or structured JSON (`format=json`) | safe | Human-readable play-by-play for demo video narration / bug reports. Never reveals `actualCardIds` (client projection), but DOES reveal `claimText` + `truthState` in narrative form (both are server-derived and post-round public). |

### 5.1 Tool detail — `readGameState`

- **Input:** `{ sessionId: string; view: 'client' | 'full' }`
- **Behavior:**
  1. `store.get(sessionId)` → if null, return `ToolError { code: 'SESSION_NOT_FOUND' }`.
  2. If `view === 'client'`: project via `toClientView(session, 'player')` — exactly the shape the browser sees.
  3. If `view === 'full'`: require `permissions.allowInspectAIDecision === true` (full view reveals `Claim.actualCardIds` + `Claim.llmReasoning`). If not allowed → `PERMISSION_DENIED`.
  4. Return `ToolSuccess<ClientSession | Session>`.

### 5.2 Tool detail — `inspectAIDecision`

- **Input:** `{ sessionId: string; turnIndex: number }` — `turnIndex` flattens across rounds (round 0 turn 0, 1, 2, …; round 1 continues counting).
- **Behavior:**
  1. Require `permissions.allowInspectAIDecision === true` → else `PERMISSION_DENIED`.
  2. `store.get(sessionId)` → `SESSION_NOT_FOUND` if null.
  3. Flatten `session.rounds.flatMap(r => r.claimHistory)` and index by `turnIndex`. If out-of-range → `TURN_NOT_FOUND`.
  4. Return the full `Claim` object incl. `by`, `claimedRank`, `actualCardIds`, `truthState`, `llmReasoning`, `ttsSettings`, `claimText`, `timestamp`.
- **Why gated:** `llmReasoning` is the AI's internal thought — revealing it mid-session would let the player peek at judgments. Only safe post-session or in pure dev contexts.

### 5.3 Tool detail — `forceTransition`

- **Input:** `{ sessionId: string; event: GameEvent; dryRun: boolean }`.
- **Behavior:**
  1. Require `permissions.allowForceTransition === true` → else `PERMISSION_DENIED`.
  2. `store.get(sessionId)` → `SESSION_NOT_FOUND` if null.
  3. Zod-parse `event` against the known `GameEvent` union. If invalid → `INVALID_INPUT`.
  4. Call `reduce(session, event)` — if it throws `InvalidTransitionError`, return `ToolError { code: 'INVALID_TRANSITION', message, details }` (we **do not** catch-and-apply).
  5. If `dryRun === true`: do not write to KV. Return `{ before: toClientView(session), after: toClientView(next), applied: false }`.
  6. Else `store.set(sessionId, next)`. Return `{ before, after, applied: true }`.
- **Guard preservation (load-bearing):** Step 4 is where the ethical line lives. `reduce` is the production reducer; its guards are the production guards. The Power CANNOT bypass them.

### 5.4 Tool detail — `replayRound`

- **Input:** `{ sessionId: string; roundIndex: 0 | 1 | 2 }`.
- **Behavior:**
  1. `store.get(sessionId)` → `SESSION_NOT_FOUND` if null.
  2. If `roundIndex >= session.rounds.length` → `ROUND_NOT_FOUND`.
  3. For each `claim` in `round.claimHistory`, produce an entry `{ claim: PublicClaim, timestamp }`. (We don't re-run `reduce` — we just surface the recorded sequence.)
- **Why useful:** A demo-video recording pass can scrub round 2 turn-by-turn without starting a live session.

### 5.5 Tool detail — `listFSMEvents`

- **Input:** `{}`.
- **Behavior:** Return a static JSON description of the `GameEvent` union (derived at build time from `types.ts` — either hand-curated or generated via a build script; we'll hand-curate to avoid a TS-to-JSON-schema dep). Each event entry:
  ```json
  {
    "type": "ClaimMade",
    "required": ["claim", "now"],
    "description": "Active player plays 1-2 cards and voices a claim. Transitions claim_phase → response_phase."
  }
  ```
- **Why useful:** Kiro agents / humans using `forceTransition` need to know the event shape without reading the source.

### 5.6 Tool detail — `dumpTranscript`

- **Input:** `{ sessionId: string; format: 'narrative' | 'json' }`.
- **Behavior:**
  1. Load session.
  2. `narrative` format: emit lines like:
     ```
     Round 1 · target Queens
     Player: "One Queen." [honest]
     AI (Reader) accepted.
     AI: "Two Kings." [lying]  ← decision: mathProb=0.62, source=llm
     Player called Liar! → caught-lie, AI +1 strike.
     ```
     (Reveals `truthState` + `mathProb` + `source` — all server-derived, post-session non-sensitive.)
  3. `json` format: structured array with one entry per claim + challenge outcome.
- **Why demo-facing:** Day 6 demo video benefits from a canonical transcript for narration subtitles.

### 5.7 Forbidden tools (explicit non-catalog — §1.4 line)

Not implemented, not planned:

- `revealActualCardIds` — would let the player see the AI's hand
- `setOpponentToAlwaysLose` / `setStrikes` — would tamper with challenge outcomes
- `muteLLMSoAiIsDeterministic` — would remove the reasoning layer for an in-progress game
- `clientInjectAiDecision` — would let the user override the AI's action

If a future PR introduces one of these, the spec review must reject it. The line is a judging asset, not just a code rule.

---

## 6. Transport and server lifecycle

### 6.1 Startup

Entry point: `powers/hearsay-debug/src/index.ts`.

```ts
// pseudo-code, not the implementation
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools';
import { loadPermissions } from './schemas';

const server = new McpServer(
  { name: 'hearsay-debug', version: PACKAGE_JSON_VERSION },
  { instructions: 'Inspect Hearsay game sessions, replay rounds, dump transcripts. forceTransition and inspectAIDecision require HEARSAY_DEBUG=1.' }
);

const permissions = loadPermissions();
registerTools(server, permissions);

const transport = pickTransport(); // stdio by default; HTTP if --http arg or HEARSAY_DEBUG_HTTP=127.0.0.1:PORT
// Binding contract: pickTransport MUST parse the host portion and REFUSE to bind
// if host ∉ {'127.0.0.1', '::1', 'localhost'}; throws at startup with a clear error
// — never silently falls back to 0.0.0.0.
await server.connect(transport);
// log to stderr (stdout is reserved for stdio transport framing)
console.error(`[hearsay-debug] connected via ${transport.kind}; permissions=${JSON.stringify(permissions)}`);
```

**stdout discipline:** stdio transport uses stdout for MCP framing. All logs go to stderr.

### 6.2 Shutdown

- On SIGTERM / SIGINT: call `server.close()`, then exit 0.
- No persistent resources to release — KV connection is per-call via `@vercel/kv`'s stateless client.

### 6.3 Reconnection

MCP stdio transport: Kiro respawns on crash. The server is stateless per-call — a fresh process sees the same KV sessions.

MCP HTTP transport (opt-in): the SDK's Streamable HTTP exposes `/mcp` with session resumption via `mcp-session-id` header. We enable the default session store. Sessions expire after 30 minutes of idle.

### 6.4 Dev harness

`powers/hearsay-debug/package.json` scripts:
- `dev` — `tsx watch src/index.ts` (stdio)
- `dev:http` — `HEARSAY_DEBUG_HTTP=127.0.0.1:7850 tsx src/index.ts` (HTTP-local)
- `test` — `vitest run`

---

## 7. Integration points

This spec is almost entirely additive. Integration surface is kept small on purpose.

### 7.1 Shared-state additions

| Change | Location | Type |
|---|---|---|
| **Read-only import of `reduce` + `toClientView`** | `powers/hearsay-debug/src/tools/*.ts` | Type / function consumption, NO modification |
| **Read-only import of `session/store.ts` (get / set / delete) + `kv` directly from `@vercel/kv` for `listSessions` scan only** | `powers/hearsay-debug/src/tools/*.ts` | Uses existing Vercel KV store; `set` called ONLY by `forceTransition` (dev-gated); `listSessions` calls `kv.keys('hearsay:session:*')` (Upstash-compatible) directly — `store.ts` exposes no `scan` surface and is not modified |
| **`src/lib/game/types.ts` is source of truth for FSM event schemas** | surfaced via `listFSMEvents` | NO modification — schemas hand-curated + drift-test'd (see §9 I6) |
| **New `powers/` directory** | repo root | New directory; sibling of `src/`. Monorepo-style with its own `package.json` + `tsconfig.json`. |
| **POWER.md + mcp.json + README.md at `powers/hearsay-debug/`** | new files | Required Kiro Power layout (§10) |
| **Optional: dev-only `/api/debug/*` endpoint for HTTP-mode auth bridge** | would-be `src/app/api/debug/[tool]/route.ts` | **NOT added in this spec.** stdio transport is sufficient; HTTP mode is direct on 127.0.0.1 to avoid touching the Next.js API surface. Flagged as a future option if remote Kiro instances need it. |

### 7.2 What this spec does NOT touch

- `src/lib/game/fsm.ts` — imported, never modified
- `src/lib/game/types.ts` — imported, never modified
- `src/lib/session/store.ts` — imported, never modified (the `set` call uses the existing export)
- `src/lib/ai/**` — not imported directly; we read `Claim.llmReasoning` off persisted sessions, not the live brain
- `src/app/api/**` — no new endpoints
- `src/components/**` — no UI

### 7.3 Kiro registration

Two surface options:

1. **Project-scope MCP config** (`.kiro/mcp.json`): points to the compiled server so Kiro auto-connects when the project opens. Requires `HEARSAY_DEBUG=1` in the developer's shell; Kiro spawns the server as a child.
2. **Power install** (distribution path): user pastes the GitHub URL `https://github.com/<author>/hearsay-debug-power` into Kiro's "Add power from GitHub" panel. Kiro reads `POWER.md` + `mcp.json` from the repo root and auto-configures.

The Power is published as a separate repo (or monorepo subdirectory surfaced at that path — see §11).

---

## 8. Error handling

Each tool maps failure modes to `ToolErrorCode` (§4.2). The MCP handler wraps the `ToolSuccess | ToolError` envelope into `{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }` and **does not throw** — the MCP SDK treats thrown handlers as protocol-level errors, which we want only for truly unexpected bugs.

| Failure mode | Surface | Recovery hint |
|---|---|---|
| KV returns null for sessionId | `SESSION_NOT_FOUND` | Caller should `listSessions` to pick a valid ID |
| KV throws (network / auth) | `KV_ERROR` | Check `KV_URL` / `KV_REST_API_TOKEN` env — identical to main app's env |
| Zod parse fails on input | `INVALID_INPUT` | Error `details` includes the Zod issue array |
| FSM guard rejects the event | `INVALID_TRANSITION` | Error `message` echoes `InvalidTransitionError.message` — `event 'X' not valid in state 'Y'` |
| Dev-only tool with `HEARSAY_DEBUG` unset | `PERMISSION_DENIED` | Instruct user to set `HEARSAY_DEBUG=1` and restart the Power |
| MCP client disconnects mid-tool-call | Handler cleanup runs (none to run — stateless); no partial KV writes because `forceTransition` writes atomically after `reduce` succeeds | None |
| Round out-of-range in `replayRound` / `dumpTranscript` | `ROUND_NOT_FOUND` | Caller should read `currentRoundIdx` first |

**Atomicity of `forceTransition`:** the sequence is `load → reduce → (throw or set)`. If `reduce` throws, we never touch KV. If `store.set` throws *after* `reduce` succeeds, we surface `KV_ERROR` and the old session persists — no half-apply.

---

## 9. Testing invariants (Vitest, target 6-10)

All live in `powers/hearsay-debug/src/**/*.test.ts`.

| # | Invariant | Why |
|---|---|---|
| **I1** | `readGameState({ view: 'client' })` output is round-trip equivalent to `toClientView(session, 'player')` — no `actualCardIds`, no `llmReasoning`, opponent hand replaced with `handSize`. | Prevents leaking server-only fields through the MCP surface even when `HEARSAY_DEBUG` is set. |
| **I2** | `forceTransition` rejects events that `reduce` rejects. E.g. `ClaimAccepted` in `claim_phase` → `INVALID_TRANSITION`. | The ethical-line guarantee (§1.4). Direct FSM pass-through. |
| **I3** | `forceTransition` returns `PERMISSION_DENIED` when `HEARSAY_DEBUG !== '1'` even if the event is valid. Session in KV is unchanged. | Dev-only gate integrity. |
| **I4** | `listSessions` returns only keys matching `hearsay:session:*`; ignores unrelated KV keys. Handles KV pagination when >20 sessions exist. | Prevents accidentally enumerating non-Hearsay state. |
| **I5** | MCP server stdio round-trip works end-to-end: spawn the compiled binary, send a `tools/call` request for `listFSMEvents` with `{}`, receive a well-formed response with the event-union schema. | Smoke test — proves the Power actually boots. |
| **I6** | `POWER.md` exists at the repo root and its frontmatter references exactly 7 tools whose names match the registered tool list in `src/index.ts`. | Metadata integrity — no silent drift between docs and code. Test runs at `pnpm test` in the Power repo. |
| **I7** | `inspectAIDecision` with `HEARSAY_DEBUG` unset returns `PERMISSION_DENIED`; with it set returns the full `Claim` including `llmReasoning`. | Gate integrity for the second dev-only tool. |
| **I8** | `dumpTranscript` (narrative format) never emits a raw card ID (regex `/[QKAJ][a-z]+-\d/` produces no matches), but DOES emit `truthState` on every claim. | Projection discipline for demo-video output. |
| **I9** | `forceTransition({ dryRun: true })` never calls `store.set`. Verified with a spy on the store module. | Read-only guarantee of dry-run mode. |

Target: 9 tests across `tools/*.test.ts` + `index.test.ts` + `powerMd.test.ts`. No pixel tests, no real-LLM tests, no real-Vercel-KV tests (use `vi.mock('@vercel/kv')` and an in-memory Map).

---

## 10. File layout

```
powers/hearsay-debug/
├── POWER.md                       # REQUIRED by Kiro Powers convention
├── README.md                      # Install + usage docs, cites this design.md
├── mcp.json                       # Kiro Power MCP-server config (name matches package.json)
├── package.json                   # name: "hearsay-debug", version, MIT license, scripts, deps
├── tsconfig.json                  # references ../../tsconfig.json for shared settings
├── .gitignore                     # dist/, node_modules/
├── src/
│   ├── index.ts                   # Server entry; transport selection; registers tools
│   ├── schemas.ts                 # Zod input schemas, ToolSuccess / ToolError, DebugPermissions
│   ├── fsmEvents.ts               # Hand-curated GameEvent schema for listFSMEvents
│   ├── powerMdMeta.ts             # Parsed POWER.md frontmatter (for I6)
│   ├── tools/
│   │   ├── readGameState.ts       # Tool 1
│   │   ├── listSessions.ts        # Tool 2
│   │   ├── inspectAIDecision.ts   # Tool 3
│   │   ├── forceTransition.ts     # Tool 4
│   │   ├── replayRound.ts         # Tool 5
│   │   ├── listFSMEvents.ts       # Tool 6
│   │   └── dumpTranscript.ts      # Tool 7
│   ├── tools/__tests__/*.test.ts  # Per-tool unit tests — I1, I2, I3, I4, I7, I8, I9
│   ├── index.test.ts              # stdio smoke test — I5
│   └── powerMd.test.ts            # Metadata drift test — I6
└── vitest.config.ts               # test config
```

**Line counts target:** `src/index.ts` ~80 lines; each tool file ~50-100 lines; total Power ~1000 lines of TS. Sized to fit a single Day-6 implementation session.

### 10.1 POWER.md shape (draft — flag in §11)

```markdown
---
name: hearsay-debug
version: 0.1.0
description: Debug + inspect the Hearsay voice-bluffing game engine from Kiro.
mcpServers:
  - hearsay-debug
---

# Hearsay Debug Power

Read-only inspection + dev-gated force-transition for Hearsay sessions.

## Tools (7)

1. readGameState — current session state (client projection or full, HEARSAY_DEBUG=1 required for full)
2. listSessions — all active sessions in Vercel KV
3. inspectAIDecision — AI reasoning for a given turn (HEARSAY_DEBUG=1 required)
4. forceTransition — dispatch a raw FSM event (HEARSAY_DEBUG=1 required, respects all guards)
5. replayRound — walk through a round's claim history
6. listFSMEvents — schema of the GameEvent discriminated union
7. dumpTranscript — narrative or JSON playback

## Permissions

- `HEARSAY_DEBUG=1` gates `forceTransition` + `inspectAIDecision` + full-view `readGameState`.
- Production deployments must never set this flag.

## Onboarding

1. Clone this Power next to the Hearsay repo, or install via Kiro → Add power from GitHub.
2. Ensure `KV_URL` + `KV_REST_API_TOKEN` are set (same as the Hearsay app).
3. Run `pnpm install` + `pnpm build`.
4. Kiro auto-connects via `mcp.json`.
```

### 10.2 mcp.json shape

```json
{
  "mcpServers": {
    "hearsay-debug": {
      "command": "node",
      "args": ["${workspaceFolder}/powers/hearsay-debug/dist/index.js"],
      // Relative paths are unsafe — Kiro may spawn from an arbitrary cwd.
      // Use an absolute path resolved from the workspace root via ${workspaceFolder}
      // (Kiro Powers convention), or a bin-shim entry in package.json invoked via
      // `npx hearsay-debug-mcp` if the Power is published to npm.
      // Fallback pattern: "command": "npx", "args": ["hearsay-debug-mcp"]
      "env": {
        "HEARSAY_DEBUG": "${HEARSAY_DEBUG}",
        "KV_URL": "${KV_URL}",
        "KV_REST_API_TOKEN": "${KV_REST_API_TOKEN}"
      }
    }
  }
}
```

Namespaces to `power-hearsay-debug-hearsay-debug` per Kiro convention on install.

**Note on `HEARSAY_DEBUG` env expansion:** Shell-style default expansion (`${HEARSAY_DEBUG:-0}`) is NOT universally supported by MCP `mcp.json` env substitution — it may pass the literal string `${HEARSAY_DEBUG:-0}` to the child process. Using `"${HEARSAY_DEBUG}"` instead and relying on `loadPermissions` (§4.3) which checks strict `=== '1'`: unset or empty is treated as disabled.

---

## 11. Open questions

Flag these in `requirements.md` under `## Design questions for Scott` so they surface for review:

1. **AWS Kiro Powers convention — POWER.md frontmatter fields.** Inferred from Kiro docs search (2026-04-19). Verified: `POWER.md` required in repo root; `mcp.json` required if using MCP servers; install via GitHub URL in the Powers panel; Kiro auto-namespaces server names on install (e.g. `supabase-local` → `power-supabase-supabase-local`). **Unverified fields:** exact required frontmatter keys (the `name` / `version` / `description` / `mcpServers` set in §10.1 is conservative). If Kiro's schema diverges, update `powerMd.test.ts` accordingly.
   - Sources cited: [Install powers — Kiro docs](https://kiro.dev/docs/powers/installation/) · [Create powers — Kiro docs](https://kiro.dev/docs/powers/create/)
2. **Install URL format.** Two paths exist: (a) paste a GitHub repo URL into "Add power from GitHub", (b) use the one-click MCP install URL `https://kiro.dev/launch/mcp/add?name={encoded}&config={encoded}`. This spec defaults to (a) — simpler, no URL encoding. Revisit if (b) becomes preferred.
3. **Publishing strategy.** Options: (i) GitHub release of `powers/hearsay-debug/` as its own repo; (ii) monorepo subdirectory with a symlink commit; (iii) Kiro marketplace listing once that launches. Recommend (i) for hackathon submission — simplest URL to paste into judging notes. Main Hearsay repo keeps the source at `powers/hearsay-debug/` for co-evolution.
4. **Monorepo placement.** Keeping the Power inside the Hearsay repo (`powers/hearsay-debug/`) simplifies shared-types imports but complicates Power install (GitHub URL points at a subpath — Kiro supports "repository URL" input; subpath support is less clear). Fallback: mirror-publish to `hearsay-debug-power` as a standalone repo with a README pointing back to Hearsay for context.
5. **FSM event schema source of truth.** §5.5 hand-curates the `listFSMEvents` response. Alternative: use `ts-json-schema-generator` at build time. Hand-curated is chosen for zero runtime dep + simplicity; drift risk mitigated by I6-style test asserting the curated list covers every `GameEvent` variant (`zod` union or enum of `event.type` literals).
6. **HTTP transport default binding.** Spec locks `127.0.0.1` only. Open: whether to include an optional `HEARSAY_DEBUG_HTTP_ALLOW_LAN=1` opt-out for (e.g.) running Kiro on a phone. Recommend NO — hackathon scale doesn't need it, and the blast radius of a misconfigured opt-out is full game-state read.
7. **`inspectAIDecision` vs. session-state embed.** `llmReasoning` is already on `Claim.llmReasoning` in the persisted session. `inspectAIDecision` is a thin wrapper on `readGameState({ view: 'full' })` + index. Open: collapse into a flag on `readGameState`, or keep as a distinct tool. Kept distinct because the tool *name* is load-bearing for the demo ("look, I can inspect the AI's reasoning"). Discoverability > DRY.
8. **Steering/structure.md placement drift.** `steering/structure.md` L27-29 still references the older `.kiro/mcp-servers/` placement — propose a follow-up commit updating steering to match `powers/` (Kiro Powers convention). This spec supersedes that placement; the steering doc should be updated in a separate commit to avoid spec churn.

---

## 12. Seed prompt for Kiro (canonical form, paste-ready)

Per `reference_kiro_spec_workflow.md` canonical template. Paste into Kiro Spec mode to generate `requirements.md` + `tasks.md`.

```
Generate requirements.md and tasks.md for the `game-debug` spec.

Canonical sources already in repo:

- `.kiro/specs/game-debug/design.md` — authoritative MCP server architecture, 7-tool catalog, ethical line, Kiro Power packaging contract + 9 Vitest invariants (do NOT modify)
- `.kiro/specs/game-engine/design.md` — FSM reducer + GameEvent union consumed read-only by `forceTransition` tool
- `.kiro/specs/ai-opponent/design.md` §§2-5 — AiDecision shape consumed read-only by `inspectAIDecision` tool
- `.kiro/specs/ui-gameplay/design.md` §4.4 — Vercel KV session store that `listSessions` scans
- `.kiro/steering/product.md` / structure.md / tech.md — stack conventions (pnpm, Vitest, TS 5.x, Zod 3.x)
- MCP TypeScript SDK: `@modelcontextprotocol/sdk` — Context7-verified current API is `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)` (NOT the legacy `server.tool()` form)

requirements.md — EARS format. Derive acceptance criteria from design.md §4 (schemas + permissions), §5 (7 tool contracts), §6 (transport + lifecycle), §7 (integration points), §8 (error handling), §9 (invariants I1-I9). Aim ~22-28 criteria. Every design.md invariant (I1-I9) must map to at least one numbered requirement. Locked items that must NOT appear as pending:

- 7 tools locked: `readGameState`, `listSessions`, `inspectAIDecision`, `forceTransition`, `replayRound`, `listFSMEvents`, `dumpTranscript`
- MCP SDK API: `server.registerTool(name, config, handler)` — NOT `server.tool()`
- HTTP transport MUST bind to `127.0.0.1` / `::1` / `localhost` only (throws at startup on non-loopback host; no silent fallback to `0.0.0.0`)
- `forceTransition` + `inspectAIDecision` gated by `HEARSAY_DEBUG=1` env flag (strict `=== '1'`)
- Zero modifications to `src/lib/**` — the 5 imported surfaces (fsm, types, toClientView, session/store, ai/types) stay read-only
- Ethical line (§1.4 / §5.7): NO cheat tools — forbidden list includes `revealActualCardIds`, `setOpponentToAlwaysLose`, `muteLLMSoAiIsDeterministic`, `clientInjectAiDecision`, force-accept, setStrikes, auto-lose
- `listSessions` bypasses `src/lib/session/store.ts` public surface and imports `kv` directly from `@vercel/kv` for a `kv.keys('hearsay:session:*')` scan
- Kiro Power packaging convention: `powers/hearsay-debug/` subtree (NEW top-level sibling to `src/`) with `POWER.md` + `mcp.json` + `package.json` + `src/`

§11 open questions (Q1 POWER.md frontmatter format, Q2-Q7 open items, Q8 steering/structure.md drift from old `.kiro/mcp-servers/` placement) MUST appear under `## Design questions for Scott` at bottom — do NOT resolve unilaterally.

tasks.md — 12-16 granular tasks, tests-first where feasible. Each task:

- Links to specific requirement numbers via `_Requirements: X.Y, X.Z_`
- Names exact files (per design.md §10 file layout — `powers/hearsay-debug/{src/index.ts, src/schemas.ts, src/fsmEvents.ts, src/tools/*.ts, POWER.md, mcp.json, package.json, tsconfig.json, vitest.config.ts}` + co-located `*.test.ts`)
- Ordered by dependency: scaffold package (pnpm init + tsconfig + vitest config) → `schemas.ts` (Zod input + error + permissions) → `fsmEvents.ts` (hand-curated GameEvent catalog) → each of the 7 tools as a standalone task with its invariant test(s) → `index.ts` (stdio transport + `registerTool` registration) → `POWER.md` + `mcp.json` + `README.md` → I5 stdio smoke test (last — requires compiled output) → manual install + smoke-test in Kiro (non-automated acceptance gate)
- Checkpoints every 3-4 tasks for `pnpm vitest run`
- Optional-but-skippable tasks marked with `*` (truly-nice-to-haves only)
- Every task MUST state "read-only toward `src/lib/**`" — if a task would touch Hearsay source, flag and stop
- Do NOT introduce any dep that the Hearsay app doesn't already use, EXCEPT `@modelcontextprotocol/sdk` + `tsx` (dev)
- MIT license; matches hackathon submission requirement

Do NOT write implementation code. Do NOT modify design.md. If design.md seems wrong or contradictory, flag at bottom of requirements.md under `## Design questions for Claude Code`.

Output both files in `.kiro/specs/game-debug/`.
```

---

## Architecture consistency note

This spec adds a sibling top-level directory (`powers/`) and imports read-only from `src/lib/game/*` + `src/lib/session/*` + `src/lib/ai/types.ts`. It introduces no new game types, no new gameplay logic, and no modifications to existing files. The seven tools are observability hooks on top of the FSM reducer the `game-engine` spec already locked.

If a future revision of this spec adds a tool that touches gameplay state (e.g. one that writes to KV without going through `reduce`), that's a direct violation of §1.4 and must be rejected at review. The principled-debugging line is the judging asset; preserve it.
