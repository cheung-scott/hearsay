# Implementation Plan: Game Debug MCP Server (Kiro Power)

## Overview

MCP debug server for the Hearsay game engine, packaged as a Kiro Power at `powers/hearsay-debug/`. Implementation follows dependency order: scaffold → schemas → FSM event catalog → individual tools (with co-located tests) → server entry + registration → Power packaging → smoke tests. All code is read-only toward `src/lib/**` — if a task would touch Hearsay source, flag and stop.

## Tasks

- [ ] 1. Scaffold the Power package
  - [ ] 1.1 Create `powers/hearsay-debug/package.json`
    - `name: "hearsay-debug"`, `version: "0.1.0"`, `license: "MIT"`
    - Scripts: `"dev": "tsx watch src/index.ts"`, `"dev:http": "HEARSAY_DEBUG_HTTP=127.0.0.1:7850 tsx src/index.ts"`, `"test": "vitest run"`
    - Dependencies: `@modelcontextprotocol/sdk`, `@vercel/kv`, `zod`
    - DevDependencies: `tsx`, `vitest`, `typescript`
    - Shared deps (`@vercel/kv`, `zod`) may reference root workspace versions via `workspace:*` if pnpm workspace is configured; otherwise pin to same versions as root `package.json`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.1, 13.4, 14.1, 14.4_

  - [ ] 1.2 Create `powers/hearsay-debug/tsconfig.json`
    - Extend or reference `../../tsconfig.json` for shared compiler settings
    - Configure path aliases for importing from `../../src/lib/game/*`, `../../src/lib/session/*`, `../../src/lib/ai/*`
    - Target: ES2022+ / NodeNext module resolution (MCP SDK requires ESM-compatible output)
    - `outDir: "dist"`, `rootDir: "src"`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.5_

  - [ ] 1.3 Create `powers/hearsay-debug/vitest.config.ts`
    - Configure Vitest for the Power's `src/` directory
    - Set up path aliases matching `tsconfig.json`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.6, 14.3_

  - [ ] 1.4 Create `powers/hearsay-debug/.gitignore`
    - Ignore `dist/`, `node_modules/`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.1_

  - [ ] 1.5 Run `pnpm install` in `powers/hearsay-debug/` to verify the package scaffolds correctly
    - Read-only toward `src/lib/**`
    - _Requirements: 13.1_

- [ ] 2. Implement Zod schemas, error types, and permission loader
  - [ ] 2.1 Create `powers/hearsay-debug/src/schemas.ts`
    - Define all 7 Zod input schemas: `ReadGameStateInput`, `ListSessionsInput`, `InspectAIDecisionInput`, `ForceTransitionInput`, `ReplayRoundInput`, `ListFSMEventsInput`, `DumpTranscriptInput` — exactly as specified in design §4.1
    - Define `ToolSuccess<T>` and `ToolError` interfaces with `ToolErrorCode` union type
    - Define `DebugPermissions` interface and `loadPermissions()` function that reads `process.env.HEARSAY_DEBUG` with strict `=== '1'` check, cached at call time
    - Define `MCPServerConfig` interface
    - Read-only toward `src/lib/**`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 10.1, 10.2, 10.3, 11.3_

- [ ] 3. Implement hand-curated FSM event catalog
  - [ ] 3.1 Create `powers/hearsay-debug/src/fsmEvents.ts`
    - Hand-curate a JSON-serializable description of every `GameEvent` variant from `src/lib/game/types.ts`
    - Each entry: `{ type: string, required: string[], description: string }`
    - Must cover ALL event types in the `GameEvent` union: `SetupComplete`, `ClaimMade`, `ClaimAccepted`, `ChallengeCalled`, `RevealComplete`, `RoundSettled`, `JokerPicked`, `JokerOfferSkippedSessionOver`, `Timeout` (both kinds), `JokerOffered`, `JokerOfferEmpty`, `UseJoker`, `ProbeStart`, `ProbeComplete`, `ProbeExpired`
    - Export as a typed constant for use by `listFSMEvents` tool and the I6 drift test
    - Read-only toward `src/lib/**` — do NOT import the union at runtime; hand-curate from reading the source
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 4. Implement tool — readGameState
  - [ ] 4.1 Create `powers/hearsay-debug/src/tools/readGameState.ts`
    - Import `store.get` from `../../src/lib/session/store` (read-only)
    - Import `toClientView` from `../../src/lib/game/toClientView` (read-only)
    - Implement: load session → if null return `SESSION_NOT_FOUND` → if `view === 'full'` check permissions → if `view === 'client'` project via `toClientView(session, 'player')` → return `ToolSuccess`
    - Return MCP-shaped `{ content: [{ type: 'text', text }] }`
    - Read-only toward `src/lib/**`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 11.1, 11.2_

  - [ ] 4.2 Create `powers/hearsay-debug/src/tools/__tests__/readGameState.test.ts`
    - **Invariant I1:** `readGameState({ view: 'client' })` output is round-trip equivalent to `toClientView(session, 'player')` — no `actualCardIds`, no `llmReasoning`, opponent hand replaced with `handSize`
    - Test `view: 'full'` with `HEARSAY_DEBUG=1` returns full session
    - Test `view: 'full'` without `HEARSAY_DEBUG=1` returns `PERMISSION_DENIED`
    - Test missing session returns `SESSION_NOT_FOUND`
    - Mock `@vercel/kv` with in-memory Map — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 5. Implement tool — listSessions
  - [ ] 5.1 Create `powers/hearsay-debug/src/tools/listSessions.ts`
    - Import `kv` directly from `@vercel/kv` — NOT from `src/lib/session/store.ts`
    - Implement: `kv.keys('hearsay:session:*')` scan → extract session IDs → for each, `kv.get` to build summary `{ id, status, currentRoundIdx }` → respect `limit` → return `ToolSuccess`
    - Read-only toward `src/lib/**`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 11.1_

  - [ ] 5.2 Create `powers/hearsay-debug/src/tools/__tests__/listSessions.test.ts`
    - **Invariant I4:** returns only `hearsay:session:*` keys; ignores unrelated KV keys
    - Test pagination when >20 sessions exist
    - Test `limit` parameter respected
    - Test KV error surfaces as `KV_ERROR`
    - Mock `@vercel/kv` — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 4.2, 4.4, 4.5_

- [ ] 6. Checkpoint — run `pnpm vitest run` in `powers/hearsay-debug/`
  - Verify all tests from tasks 4 and 5 pass. Ask the user if questions arise.

- [ ] 7. Implement tool — inspectAIDecision
  - [ ] 7.1 Create `powers/hearsay-debug/src/tools/inspectAIDecision.ts`
    - Require `permissions.allowInspectAIDecision` → else `PERMISSION_DENIED`
    - Load session → flatten `rounds.flatMap(r => r.claimHistory)` → index by `turnIndex`
    - If out-of-range → `TURN_NOT_FOUND`
    - Return full `Claim` object including `llmReasoning`, `ttsSettings`, `actualCardIds`
    - If `mathProb` not on Claim, attempt re-derivation via `claimMathProbability`; omit if re-derivation fails
    - Read-only toward `src/lib/**`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 11.1_

  - [ ] 7.2 Create `powers/hearsay-debug/src/tools/__tests__/inspectAIDecision.test.ts`
    - **Invariant I7:** with `HEARSAY_DEBUG` unset → `PERMISSION_DENIED`; with it set → returns full `Claim` including `llmReasoning`
    - Test `TURN_NOT_FOUND` for out-of-range index
    - Test flattening across multiple rounds
    - Mock `@vercel/kv` — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 5.1, 5.4_

- [ ] 8. Implement tool — forceTransition
  - [ ] 8.1 Create `powers/hearsay-debug/src/tools/forceTransition.ts`
    - Require `permissions.allowForceTransition` → else `PERMISSION_DENIED`
    - Load session → Zod-parse `event` against known `GameEvent` union → if invalid `INVALID_INPUT`
    - Call `reduce(session, event)` — if throws `InvalidTransitionError` → `INVALID_TRANSITION`
    - If `dryRun === true`: return `{ before, after, applied: false }` — do NOT call `store.set`
    - Else: `store.set(sessionId, next)` → return `{ before, after, applied: true }`
    - Atomic: load → reduce → (throw or set). If `store.set` throws → `KV_ERROR`, old session persists
    - Read-only toward `src/lib/**`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 11.1_

  - [ ] 8.2 Create `powers/hearsay-debug/src/tools/__tests__/forceTransition.test.ts`
    - **Invariant I2:** rejects events that `reduce` rejects (e.g. `ClaimAccepted` in `claim_phase` → `INVALID_TRANSITION`)
    - **Invariant I3:** returns `PERMISSION_DENIED` when `HEARSAY_DEBUG !== '1'`; session in KV unchanged
    - **Invariant I9:** `dryRun: true` never calls `store.set` — verified with a spy on the store module
    - Test valid event applies and persists
    - Test `INVALID_INPUT` for malformed event
    - Mock `@vercel/kv` and `reduce` — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Implement tool — replayRound
  - [ ] 9.1 Create `powers/hearsay-debug/src/tools/replayRound.ts`
    - Load session → validate `roundIndex < session.rounds.length` → else `ROUND_NOT_FOUND`
    - For each claim in `round.claimHistory`, produce `{ claim: PublicClaim, timestamp }`
    - Read-only — never writes to KV, never re-runs `reduce`
    - Read-only toward `src/lib/**`
    - _Requirements: 7.1, 7.2, 7.3, 11.1_

  - [ ]* 9.2 Create `powers/hearsay-debug/src/tools/__tests__/replayRound.test.ts`
    - Test valid round returns correct claim sequence
    - Test `ROUND_NOT_FOUND` for out-of-range index
    - Test output contains only `PublicClaim` fields (no `actualCardIds`)
    - Mock `@vercel/kv` — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 7.1, 7.3_

- [ ] 10. Implement tool — listFSMEvents
  - [ ] 10.1 Create `powers/hearsay-debug/src/tools/listFSMEvents.ts`
    - Import the hand-curated catalog from `../fsmEvents.ts`
    - Return the catalog as `ToolSuccess` — no session lookup, no KV, no permissions
    - Read-only toward `src/lib/**`
    - _Requirements: 8.1, 8.2, 11.1_

  - [ ]* 10.2 Create `powers/hearsay-debug/src/tools/__tests__/listFSMEvents.test.ts`
    - Test returns all event types from the catalog
    - Test each entry has `type`, `required`, and `description` fields
    - Read-only toward `src/lib/**`
    - _Requirements: 8.1, 8.2_

- [ ] 11. Implement tool — dumpTranscript
  - [ ] 11.1 Create `powers/hearsay-debug/src/tools/dumpTranscript.ts`
    - Load session → iterate rounds and claims
    - `narrative` format: emit human-readable lines with round headers, claim text, truthState, challenge outcomes, strike changes. Never emit raw card IDs.
    - `json` format: structured array with one entry per claim + challenge outcome
    - Read-only toward `src/lib/**`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 11.1_

  - [ ] 11.2 Create `powers/hearsay-debug/src/tools/__tests__/dumpTranscript.test.ts`
    - **Invariant I8:** narrative format never emits a raw card ID (regex `/[QKAJ][a-z]+-\d/` produces no matches), but DOES emit `truthState` on every claim
    - Test `json` format returns structured array
    - Test missing session returns `SESSION_NOT_FOUND`
    - Mock `@vercel/kv` — no real KV calls
    - Read-only toward `src/lib/**`
    - _Requirements: 9.3, 9.4_

- [ ] 12. Checkpoint — run `pnpm vitest run` in `powers/hearsay-debug/`
  - Verify all tests from tasks 4–11 pass. Ask the user if questions arise.

- [ ] 13. Implement server entry point and tool registration
  - [ ] 13.1 Create `powers/hearsay-debug/src/index.ts`
    - Import `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
    - Import `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`
    - Create server with `{ name: 'hearsay-debug', version: PACKAGE_JSON_VERSION }` and `{ instructions: '...' }`
    - Call `loadPermissions()` once at startup — cache for server lifetime
    - Register all 7 tools via `server.registerTool(name, { title, description, inputSchema }, handler)` — NOT `server.tool()`
    - Implement `pickTransport()`: default stdio; if `HEARSAY_DEBUG_HTTP` env set, parse host and REFUSE to bind if host ∉ `{'127.0.0.1', '::1', 'localhost'}` — throw at startup, never silently fall back to `0.0.0.0`
    - `await server.connect(transport)`
    - Log to stderr: `[hearsay-debug] connected via ${transport}; permissions=${JSON.stringify(permissions)}`
    - Handle SIGTERM/SIGINT: `server.close()` then `process.exit(0)`
    - Read-only toward `src/lib/**`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4_

- [ ] 14. Create Kiro Power packaging files
  - [ ] 14.1 Create `powers/hearsay-debug/POWER.md`
    - Frontmatter: `name`, `version`, `description`, `mcpServers` list
    - Body: tool list (all 7 by name + one-line description), permissions section, onboarding steps
    - Tool names MUST match exactly the names registered in `src/index.ts`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.2, 16.1_

  - [ ] 14.2 Create `powers/hearsay-debug/mcp.json`
    - Configure `hearsay-debug` server: `command: "node"`, `args: ["${workspaceFolder}/powers/hearsay-debug/dist/index.js"]`
    - Env passthrough: `HEARSAY_DEBUG`, `KV_URL`, `KV_REST_API_TOKEN`
    - Read-only toward `src/lib/**`
    - _Requirements: 13.3_

  - [ ] 14.3 Create `powers/hearsay-debug/README.md`
    - Install + usage docs; cite design.md as authoritative spec
    - Include: what it does, prerequisites (KV env vars), install via Kiro Powers panel, available tools, permission model
    - Read-only toward `src/lib/**`
    - _Requirements: 13.7_

- [ ] 15. POWER.md metadata drift test
  - [ ] 15.1 Create `powers/hearsay-debug/src/powerMd.test.ts`
    - **Invariant I6:** parse `POWER.md`, verify it references exactly 7 tools whose names match the registered tool list exported from `src/index.ts`
    - Read-only toward `src/lib/**`
    - _Requirements: 16.1_

- [ ] 16. stdio smoke test (end-to-end)
  - [ ] 16.1 Create `powers/hearsay-debug/src/index.test.ts`
    - **Invariant I5:** spawn the compiled server binary as a child process, send a `tools/call` request for `listFSMEvents` with `{}`, receive a well-formed response with the event-union schema
    - Requires compiled output — run `pnpm build` (or `tsx` direct) before this test
    - Read-only toward `src/lib/**`
    - _Requirements: 15.1, 15.2_

- [ ] 17. Final checkpoint — run full test suite
  - Run `pnpm vitest run` in `powers/hearsay-debug/`. All invariant tests I1–I9 must pass. Ask the user if questions arise.

- [ ]* 18. Manual install and smoke-test in Kiro
  - Install the Power via Kiro's "Add power from GitHub" panel or project-scope `.kiro/mcp.json`
  - Verify Kiro auto-connects and lists all 7 tools
  - Call `listFSMEvents` from Kiro chat and verify response
  - Call `readGameState` with a live session ID and verify response
  - This is a non-automated acceptance gate — requires human verification
  - Read-only toward `src/lib/**`
  - _Requirements: 1.1, 1.2, 13.2, 13.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 6, 12, and 17 ensure incremental validation
- All 9 design invariants are covered:
  - I1 (readGameState client view): Task 4.2
  - I2 (forceTransition rejects invalid events): Task 8.2
  - I3 (forceTransition permission gate): Task 8.2
  - I4 (listSessions key filtering + pagination): Task 5.2
  - I5 (stdio smoke test): Task 16.1
  - I6 (POWER.md metadata drift): Task 15.1
  - I7 (inspectAIDecision permission gate): Task 7.2
  - I8 (dumpTranscript no raw card IDs): Task 11.2
  - I9 (forceTransition dryRun no store.set): Task 8.2
- Every task starts with "read-only toward `src/lib/**`" — if a task would touch Hearsay source, flag and stop
- No new dependencies beyond `@modelcontextprotocol/sdk` + `tsx` (dev) — `zod`, `vitest`, `@vercel/kv`, `typescript` are already in the root project
