# Requirements Document

## Introduction

MCP (Model Context Protocol) debug server for the Hearsay voice-bluffing card game, packaged as a Kiro Power. Exposes 7 read/inspect/force-transition tools over stdio (default) or localhost-bound HTTP transport. Lets Kiro agents and the developer introspect live sessions, replay rounds, inspect AI reasoning, dump demo transcripts, and force the FSM into specific states during development — all without modifying any existing game-engine, AI, or UI code.

This spec is additive: a new `powers/hearsay-debug/` directory (sibling of `src/`) with its own `package.json`, `tsconfig.json`, and Vitest config. It imports read-only from `src/lib/game/fsm.ts`, `src/lib/game/types.ts`, `src/lib/game/toClientView.ts`, `src/lib/session/store.ts`, and `src/lib/ai/types.ts`. It never modifies those files.

## Glossary

- **MCP**: Model Context Protocol — Anthropic-backed open standard for LLM agents to invoke structured tools on local/remote servers
- **Kiro Power**: A distributable MCP + steering bundle for the Kiro IDE; minimum shape is `POWER.md` + optional `mcp.json` + optional `steering/`
- **Tool**: An MCP-registered function callable by the Kiro agent; registered via `server.registerTool(name, config, handler)`
- **stdio transport**: Default MCP transport where Kiro spawns the server as a child process and communicates over stdin/stdout
- **HEARSAY_DEBUG**: Environment variable flag; when set to exactly `'1'`, enables dev-only tools (`forceTransition`, `inspectAIDecision`, full-view `readGameState`)
- **FSM**: The pure-TypeScript finite state machine in `src/lib/game/fsm.ts`; its `reduce(session, event)` function is consumed read-only by `forceTransition`
- **Session**: Top-level game state object stored in Vercel KV under `hearsay:session:{id}` keys
- **ClientSession**: Wire-safe projection of Session produced by `toClientView()` — strips `actualCardIds`, `llmReasoning`, opponent hand
- **ToolSuccess / ToolError**: Structured envelope returned by every tool handler; never throws at the MCP protocol level
- **ToolErrorCode**: One of `SESSION_NOT_FOUND`, `ROUND_NOT_FOUND`, `TURN_NOT_FOUND`, `INVALID_TRANSITION`, `PERMISSION_DENIED`, `KV_ERROR`, `INVALID_INPUT`
- **Principled debugging line**: The ethical boundary between inspection tools (allowed) and cheat tools (forbidden) — see §Principled Debugging Line below

## Requirements

### Requirement 1: MCP Server Scaffold and Lifecycle

**User Story:** As a developer, I want the debug server to boot as a well-formed MCP server with correct metadata, so that Kiro auto-discovers and connects to it.

#### Acceptance Criteria

1. WHEN the server starts, IT SHALL create an `McpServer` instance with `name: 'hearsay-debug'` and `version` matching `powers/hearsay-debug/package.json`. *(design §6.1)*
2. WHEN the server starts, IT SHALL register exactly 7 tools: `readGameState`, `listSessions`, `inspectAIDecision`, `forceTransition`, `replayRound`, `listFSMEvents`, `dumpTranscript`. *(design §5 tool catalog)*
3. WHEN the server starts with no flags, IT SHALL default to stdio transport. All diagnostic logs SHALL go to stderr; stdout is reserved for MCP framing. *(design §6.1)*
4. WHEN the server starts with HTTP transport enabled via `HEARSAY_DEBUG_HTTP` env, IT SHALL parse the host portion and REFUSE to bind if the host is not one of `127.0.0.1`, `::1`, or `localhost`. It SHALL throw at startup with a clear error — never silently fall back to `0.0.0.0`. *(design §6.1)*
5. WHEN the server receives SIGTERM or SIGINT, IT SHALL call `server.close()` and exit with code 0. *(design §6.2)*
6. THE server SHALL use `server.registerTool(name, { title, description, inputSchema, outputSchema? }, handler)` — NOT the legacy `server.tool()` form. *(design §3 MCP SDK citation)*

### Requirement 2: Debug Permission Gating

**User Story:** As a developer, I want dev-only tools gated behind `HEARSAY_DEBUG=1`, so that production deployments never expose force-transition or AI reasoning inspection.

#### Acceptance Criteria

1. WHEN the server starts, IT SHALL read `process.env.HEARSAY_DEBUG` exactly once and cache the result for the server's lifetime. The check SHALL use strict `=== '1'` comparison. *(design §4.3)*
2. WHEN `HEARSAY_DEBUG` is unset, empty, or any value other than `'1'`, THE server SHALL deny `forceTransition` and `inspectAIDecision` calls with `ToolError { code: 'PERMISSION_DENIED' }`. *(design §4.3, invariant I3, I7)*
3. WHEN `HEARSAY_DEBUG` is unset, `readGameState` with `view: 'full'` SHALL also return `PERMISSION_DENIED`. The `view: 'client'` mode SHALL remain available regardless. *(design §5.1)*
4. A running server SHALL NOT be unlockable at runtime by mutating `process.env` — permissions are captured at process start. *(design §4.3)*

### Requirement 3: Tool — readGameState

**User Story:** As a Kiro agent, I want to read the current state of a game session, so that I can inspect cards, rounds, strikes, and phase.

#### Acceptance Criteria

1. WHEN called with `{ sessionId, view: 'client' }`, THE tool SHALL return the output of `toClientView(session, 'player')` — no `actualCardIds`, no `llmReasoning`, opponent hand replaced with `handSize`. *(design §5.1, invariant I1)*
2. WHEN called with `{ sessionId, view: 'full' }` and `HEARSAY_DEBUG=1`, THE tool SHALL return the full `Session` object including `actualCardIds` and `llmReasoning`. *(design §5.1)*
3. WHEN called with `{ sessionId, view: 'full' }` and `HEARSAY_DEBUG` is not `'1'`, THE tool SHALL return `ToolError { code: 'PERMISSION_DENIED' }`. *(design §5.1)*
4. WHEN the sessionId does not exist in KV, THE tool SHALL return `ToolError { code: 'SESSION_NOT_FOUND' }`. *(design §5.1)*
5. THE `view` parameter SHALL default to `'client'` when omitted. *(design §4.1 ReadGameStateInput)*

### Requirement 4: Tool — listSessions

**User Story:** As a developer, I want to enumerate active sessions in KV, so that I can pick one to inspect.

#### Acceptance Criteria

1. THE tool SHALL scan Vercel KV using `kv.keys('hearsay:session:*')` directly from `@vercel/kv` — it SHALL NOT use or extend `src/lib/session/store.ts`. *(design §5 tool 2, §7.1)*
2. THE tool SHALL return only keys matching the `hearsay:session:*` prefix; it SHALL ignore unrelated KV keys. *(invariant I4)*
3. THE tool SHALL accept an optional `limit` parameter (default 20, max 100) and return at most that many session summaries. *(design §4.1 ListSessionsInput)*
4. WHEN KV contains more sessions than `limit`, THE tool SHALL handle pagination correctly. *(invariant I4)*
5. WHEN KV throws a network or auth error, THE tool SHALL return `ToolError { code: 'KV_ERROR' }`. *(design §8)*

### Requirement 5: Tool — inspectAIDecision

**User Story:** As a developer, I want to inspect the AI's full reasoning for a specific turn, so that I can debug AI behavior post-mortem.

#### Acceptance Criteria

1. THE tool SHALL require `HEARSAY_DEBUG=1`; without it, return `ToolError { code: 'PERMISSION_DENIED' }`. *(design §5.2, invariant I7)*
2. WHEN called with valid `{ sessionId, turnIndex }`, THE tool SHALL flatten `session.rounds.flatMap(r => r.claimHistory)` and index by `turnIndex` (0-based across all rounds). *(design §5.2)*
3. THE tool SHALL return the full `Claim` object including `by`, `claimedRank`, `actualCardIds`, `truthState`, `llmReasoning`, `ttsSettings`, `claimText`, `timestamp`. *(design §5.2)*
4. WHEN `turnIndex` is out of range, THE tool SHALL return `ToolError { code: 'TURN_NOT_FOUND' }`. *(design §5.2)*
5. WHEN the stored `Claim` lacks `mathProb` (it is NOT persisted on `Claim`), THE tool SHALL attempt to re-derive it via `claimMathProbability(ctx)` against a rebuilt `DecisionContext`. If re-derivation fails, the field SHALL be omitted rather than faked. *(design §5 tool 3 implementation note)*

### Requirement 6: Tool — forceTransition

**User Story:** As a developer, I want to dispatch a raw FSM event through the real reducer, so that I can force the game into specific states for testing without bypassing invariant guards.

#### Acceptance Criteria

1. THE tool SHALL require `HEARSAY_DEBUG=1`; without it, return `ToolError { code: 'PERMISSION_DENIED' }` and leave the session in KV unchanged. *(design §5.3, invariant I3)*
2. WHEN called with a valid event, THE tool SHALL dispatch it through `reduce(session, event)` — the same pure function the production API routes call. *(design §5.3, invariant I2)*
3. WHEN `reduce` throws `InvalidTransitionError`, THE tool SHALL return `ToolError { code: 'INVALID_TRANSITION', message, details }` — it SHALL NOT catch-and-apply. *(design §5.3, invariant I2)*
4. WHEN `dryRun` is `true`, THE tool SHALL NOT call `store.set`. It SHALL return `{ before: ClientSession, after: ClientSession, applied: false }`. *(design §5.3, invariant I9)*
5. WHEN `dryRun` is `false` (default) and `reduce` succeeds, THE tool SHALL call `store.set(sessionId, next)` and return `{ before, after, applied: true }`. *(design §5.3)*
6. THE write sequence SHALL be atomic: `load → reduce → (throw or set)`. If `reduce` throws, KV is never touched. If `store.set` throws after `reduce` succeeds, the tool SHALL surface `KV_ERROR` and the old session persists. *(design §8)*
7. THE `dryRun` parameter SHALL default to `false` when omitted. *(design §4.1 ForceTransitionInput)*

### Requirement 7: Tool — replayRound

**User Story:** As a developer or demo-video narrator, I want to walk through a round's claim history step-by-step, so that I can scrub through gameplay without starting a live session.

#### Acceptance Criteria

1. WHEN called with `{ sessionId, roundIndex }`, THE tool SHALL return an array of entries, one per recorded claim in `round.claimHistory`, each containing `{ claim: PublicClaim, timestamp }`. *(design §5.4)*
2. THE tool SHALL be read-only — it SHALL NOT write to KV or re-run `reduce`. *(design §5.4)*
3. WHEN `roundIndex >= session.rounds.length`, THE tool SHALL return `ToolError { code: 'ROUND_NOT_FOUND' }`. *(design §5.4)*

### Requirement 8: Tool — listFSMEvents

**User Story:** As a Kiro agent or developer, I want to see the schema of all valid FSM events, so that I can construct valid `forceTransition` payloads without reading source code.

#### Acceptance Criteria

1. THE tool SHALL accept an empty input `{}` and return a static JSON description of the `GameEvent` discriminated union. *(design §5.5)*
2. EACH event entry SHALL include `type`, `required` fields, and a human-readable `description`. *(design §5.5)*
3. THE event catalog SHALL be hand-curated in `powers/hearsay-debug/src/fsmEvents.ts` — no runtime TS-to-JSON-schema dependency. *(design §5.5)*
4. THE hand-curated catalog SHALL cover every `GameEvent` variant defined in `src/lib/game/types.ts`. Drift SHALL be caught by a test (see invariant I6 mapping). *(design §5.5, §9 I6)*

### Requirement 9: Tool — dumpTranscript

**User Story:** As a demo-video narrator, I want a human-readable play-by-play of a session, so that I can generate narration subtitles or bug reports.

#### Acceptance Criteria

1. WHEN called with `format: 'narrative'`, THE tool SHALL emit a human-readable transcript including round headers, claim text, truthState, challenge outcomes, and strike changes. *(design §5.6)*
2. WHEN called with `format: 'json'`, THE tool SHALL return a structured JSON array with one entry per claim + challenge outcome. *(design §5.6)*
3. THE narrative format SHALL never emit a raw card ID (regex `/[QKAJ][a-z]+-\d/` produces no matches in the output). *(invariant I8)*
4. THE narrative format SHALL include `truthState` on every claim line. *(invariant I8)*
5. THE `format` parameter SHALL default to `'narrative'` when omitted. *(design §4.1 DumpTranscriptInput)*

### Requirement 10: Zod Input Validation

**User Story:** As a developer, I want all tool inputs validated via Zod before the handler runs, so that malformed requests produce clear error messages.

#### Acceptance Criteria

1. EACH tool's input SHALL be validated against its Zod schema defined in `powers/hearsay-debug/src/schemas.ts`. *(design §4.1)*
2. WHEN Zod validation fails, THE tool SHALL return `ToolError { code: 'INVALID_INPUT', details }` where `details` includes the Zod issue array. *(design §8)*
3. THE Zod schemas SHALL enforce: `sessionId` is a non-empty string; `view` is `'client' | 'full'` defaulting to `'client'`; `limit` is an integer 1–100 defaulting to 20; `turnIndex` is a non-negative integer; `roundIndex` is a non-negative integer; `dryRun` is boolean defaulting to `false`; `format` is `'narrative' | 'json'` defaulting to `'narrative'`. *(design §4.1)*

### Requirement 11: Error Envelope Convention

**User Story:** As a Kiro agent, I want every tool to return a structured success/error envelope, so that I can programmatically handle failures.

#### Acceptance Criteria

1. EVERY tool handler SHALL return `{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }` where `envelope` is `ToolSuccess<T>` or `ToolError`. *(design §4.2, §8)*
2. Tool handlers SHALL NOT throw exceptions — thrown handlers are reserved for truly unexpected bugs at the MCP protocol level. *(design §8)*
3. THE `ToolErrorCode` type SHALL include exactly: `SESSION_NOT_FOUND`, `ROUND_NOT_FOUND`, `TURN_NOT_FOUND`, `INVALID_TRANSITION`, `PERMISSION_DENIED`, `KV_ERROR`, `INVALID_INPUT`. *(design §4.2)*

### Requirement 12: Read-Only Toward src/lib/**

**User Story:** As a developer, I want the Power to never modify existing Hearsay source files, so that the debug server is purely additive.

#### Acceptance Criteria

1. THE Power SHALL import `reduce`, `toClientView`, `store.get`, `store.set`, `store.delete`, and type definitions from `src/lib/**` — but SHALL NOT modify any file under `src/lib/`. *(design §7.2)*
2. THE Power SHALL NOT add any new API endpoints under `src/app/api/`. *(design §7.2)*
3. THE Power SHALL NOT modify any UI components under `src/components/`. *(design §7.2)*

### Requirement 13: Kiro Power Packaging

**User Story:** As a hackathon judge, I want the debug server distributed as a proper Kiro Power, so that it demonstrates full Kiro-surface fluency.

#### Acceptance Criteria

1. THE Power SHALL live at `powers/hearsay-debug/` — a new top-level directory sibling to `src/`. *(design §10)*
2. THE Power SHALL include `POWER.md` at its root with frontmatter referencing exactly 7 tools whose names match the registered tool list. *(design §10.1, invariant I6)*
3. THE Power SHALL include `mcp.json` configuring the `hearsay-debug` MCP server with `command: 'node'` and args pointing to the compiled entry point. *(design §10.2)*
4. THE Power SHALL include `package.json` with `name: 'hearsay-debug'`, MIT license, and scripts for `dev`, `dev:http`, and `test`. *(design §6.4)*
5. THE Power SHALL include `tsconfig.json` referencing the root `tsconfig.json` for shared settings. *(design §10)*
6. THE Power SHALL include `vitest.config.ts` for its own test suite. *(design §10)*
7. THE Power SHALL include `README.md` with install + usage docs. *(design §10)*

### Requirement 14: Dependency Constraints

**User Story:** As a developer, I want the Power to minimize new dependencies, so that the hackathon project stays lean.

#### Acceptance Criteria

1. THE Power SHALL NOT introduce any dependency that the Hearsay app doesn't already use, EXCEPT `@modelcontextprotocol/sdk` (MCP server SDK) and `tsx` (dev runner — already in root devDependencies). *(design §10, constraint)*
2. THE Power SHALL use `zod` for input validation — already available via the root project. *(design §4.1)*
3. THE Power SHALL use `vitest` for testing — already available via the root project. *(design §9)*
4. THE Power SHALL be licensed MIT, matching the hackathon submission requirement. *(design §10)*

### Requirement 15: stdio Smoke Test (End-to-End)

**User Story:** As a developer, I want an automated smoke test that proves the Power boots and responds to MCP requests, so that I catch packaging regressions.

#### Acceptance Criteria

1. THE test SHALL spawn the compiled server binary as a child process, send a `tools/call` request for `listFSMEvents` with `{}`, and verify a well-formed response containing the event-union schema. *(invariant I5)*
2. THE test SHALL run as part of `pnpm test` in the Power's directory. *(design §9)*

### Requirement 16: POWER.md Metadata Integrity

**User Story:** As a developer, I want a test that catches drift between POWER.md and the registered tool list, so that documentation stays in sync with code.

#### Acceptance Criteria

1. THE test SHALL verify that `POWER.md` exists at the Power's root and its content references exactly 7 tools whose names match the tool names registered in `src/index.ts`. *(invariant I6)*

---

## Invariant Cross-Reference

Every design.md §9 invariant maps to at least one numbered acceptance criterion:

| Invariant | Requirement(s) |
|---|---|
| I1 — `readGameState` client view matches `toClientView` | 3.1 |
| I2 — `forceTransition` rejects events that `reduce` rejects | 6.2, 6.3 |
| I3 — `forceTransition` returns `PERMISSION_DENIED` when `HEARSAY_DEBUG !== '1'` | 2.2, 6.1 |
| I4 — `listSessions` returns only `hearsay:session:*` keys; handles pagination | 4.2, 4.4 |
| I5 — stdio round-trip smoke test | 15.1 |
| I6 — POWER.md references exactly 7 tools matching registered list | 13.2, 16.1 |
| I7 — `inspectAIDecision` permission gate | 2.2, 5.1 |
| I8 — `dumpTranscript` narrative never emits raw card IDs, does emit truthState | 9.3, 9.4 |
| I9 — `forceTransition` dryRun never calls `store.set` | 6.4 |

---

## Principled Debugging Line

This section codifies the ethical boundary from design §1.4 and §5.7. Future PR reviewers SHALL use this as a rubric.

### Allowed tools (in this spec)

| Tool | Justification |
|---|---|
| Read current session state | Observability — same data the server already holds |
| Inspect past `AiDecision.llmReasoning` | Post-mortem debugging; gated by `HEARSAY_DEBUG=1` |
| Force an FSM event through the real reducer + guards | Reproduces states for testing; cannot bypass FSM invariants |
| Replay a round's event history | Read-only walkthrough for demo capture |
| Dump the transcript for a demo video | Narrative output; uses client projection (no raw card IDs) |

### Forbidden tools (NOT in this spec — reject at review)

| Forbidden tool | Why forbidden |
|---|---|
| `revealActualCardIds` | Would let the player see the AI's hand via the browser client |
| `setOpponentToAlwaysLose` / `setStrikes` | Would tamper with challenge outcomes |
| `muteLLMSoAiIsDeterministic` | Would remove the reasoning layer for an in-progress game |
| `clientInjectAiDecision` | Would let the user override the AI's action |
| Force-accept (bypass FSM guards) | Would allow invalid state transitions |
| Any tool that writes to KV without going through `reduce` | Would desync session state |

If a future PR introduces any tool from the forbidden list, the spec review MUST reject it. The principled-debugging line is a judging asset, not just a code rule.

---

## Design Questions for Scott

These are open questions from design.md §11. They are flagged here for review — NOT resolved unilaterally.

1. **POWER.md frontmatter fields (Q1).** The `name` / `version` / `description` / `mcpServers` set in design §10.1 is conservative and inferred from Kiro docs. Exact required frontmatter keys are unverified. If Kiro's schema diverges, `powerMd.test.ts` needs updating.

2. **Install URL format (Q2).** Two paths exist: (a) paste a GitHub repo URL into "Add power from GitHub", (b) use the one-click MCP install URL. This spec defaults to (a). Revisit if (b) becomes preferred.

3. **Publishing strategy (Q3).** Options: (i) GitHub release of `powers/hearsay-debug/` as its own repo; (ii) monorepo subdirectory with symlink; (iii) Kiro marketplace listing. Recommend (i) for hackathon submission.

4. **Monorepo placement (Q4).** Keeping the Power inside the Hearsay repo simplifies shared-types imports but complicates Power install (GitHub URL points at a subpath — Kiro subpath support is unclear). Fallback: mirror-publish to `hearsay-debug-power` standalone repo.

5. **FSM event schema source of truth (Q5).** Hand-curated catalog chosen over `ts-json-schema-generator` for zero runtime dep + simplicity. Drift risk mitigated by I6-style test. Confirm this is acceptable.

6. **HTTP transport LAN opt-out (Q6).** Spec locks `127.0.0.1` only. Open: whether to include `HEARSAY_DEBUG_HTTP_ALLOW_LAN=1` for running Kiro on a phone. Recommend NO — hackathon scale doesn't need it.

7. **`inspectAIDecision` vs. `readGameState` collapse (Q7).** `inspectAIDecision` is a thin wrapper on `readGameState({ view: 'full' })` + index. Kept distinct because the tool *name* is load-bearing for the demo. Confirm discoverability > DRY.

8. **Steering/structure.md placement drift (Q8).** `steering/structure.md` L27-29 still references the older `.kiro/mcp-servers/` placement. Propose a follow-up commit updating steering to match `powers/` (Kiro Powers convention). This spec supersedes that placement.
