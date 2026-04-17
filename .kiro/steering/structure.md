# Project structure — Hearsay

## Top-level layout

```
hearsay/
├── .kiro/                       # Spec-driven dev artifacts (COMMITTED — NOT gitignored)
│   ├── steering/                # High-signal context docs loaded into every Kiro chat
│   │   ├── product.md           # What we're building
│   │   ├── tech.md              # Stack + integration decisions
│   │   ├── structure.md         # This file
│   │   ├── voice-preset-conventions.md    # (Day 2) — persona × truthState presets
│   │   └── llm-prompt-conventions.md      # (Day 3) — Gemini prompt templates
│   ├── specs/                   # Feature specs (requirements / design / tasks per spec)
│   │   ├── game-engine/         # (Day 1) FSM, round/session transitions, win/lose
│   │   ├── deck-and-claims/     # (Day 1-2) 20-card deck, random target, claim validation
│   │   ├── voice-tell-taxonomy/ # (Day 2) TTS presets + STT heuristic + parse layer
│   │   ├── ai-opponent/         # (Day 3) Hybrid math + LLM + fallback
│   │   ├── strikes-penalty-system/ # (Day 3) 3-slot strikes, session-loss trigger
│   │   ├── joker-system/        # (Day 4) 5 jokers (Poker Face, Stage Whisper, Earful, Cold Read, Second Wind)
│   │   ├── ai-personas/         # (Day 4) 4 persona configs
│   │   ├── probe-phase/         # (Day 4) Stage Whisper flow, LLM probe + TTS with tells
│   │   └── tension-music-system/ # (Day 5) Music API integration, 3 pre-gen tracks
│   ├── hooks/                   # Kiro agent hooks
│   │   ├── on-save-run-tests.json    # (Day 1) — run vitest on src/ save
│   │   └── on-commit-append-changelog.json  # (Day 5) — auto CHANGELOG
│   ├── mcp.json                 # Registers game-debug MCP server for dev-time agent inspection
│   └── mcp-servers/
│       └── game-debug/          # (Day 5) Custom MCP — inspect_session / list / replay / dump_voice_meta_history
├── src/
│   ├── app/                     # Next.js 16 App Router
│   │   ├── page.tsx             # Landing + game entry
│   │   ├── layout.tsx           # Root layout
│   │   ├── globals.css          # Tailwind 4 base
│   │   └── api/                 # API routes
│   │       ├── game/
│   │       │   ├── start/route.ts        # Create session + pre-gen 3 music tracks
│   │       │   ├── claim/route.ts        # Player play + audio (STT + parse + lie score)
│   │       │   ├── challenge/route.ts    # Player challenge
│   │       │   ├── accept/route.ts       # Player accept
│   │       │   ├── ai-turn/route.ts      # AI → LLM → TTS (streams)
│   │       │   ├── probe/route.ts        # Stage Whisper probe
│   │       │   └── music/route.ts        # Tension track selection
│   │       └── ping-voice/route.ts       # (Day 1) TTS round-trip smoke test
│   ├── components/              # React UI
│   │   ├── ui/                  # shadcn/ui primitives
│   │   ├── Card.tsx             # Playing card render
│   │   ├── StrikeCounter.tsx    # 3-slot ✗ display per player
│   │   ├── VoiceClaim.tsx       # Mic record + button fallback
│   │   ├── JokerPicker.tsx      # Between-rounds 1-of-3 picker
│   │   └── RoundAutopsy.tsx     # Post-round reveal (innerThoughts, presets)
│   ├── lib/
│   │   ├── game/
│   │   │   ├── fsm.ts           # Pure-TS state machine (spec: game-engine)
│   │   │   ├── deck.ts          # 20-card deck, shuffle, deal
│   │   │   ├── claims.ts        # Parse + validate voice claims
│   │   │   ├── types.ts         # Session / Round / Claim / PlayerState / Card / etc.
│   │   │   └── toClientView.ts  # Strip server-only fields before wire
│   │   ├── ai/
│   │   │   ├── brain.ts         # Hybrid orchestrator (math → LLM → fallback)
│   │   │   ├── deterministic.ts # claimMathProbability + aiDecideOwnPlayFallback
│   │   │   ├── llm.ts           # Gemini Flash wrapper + JSON schema validation
│   │   │   ├── prompts.ts       # Prompt templates (judging + own play + probe)
│   │   │   └── personas.ts      # 4 persona configs (weights, thresholds, bluff bias)
│   │   ├── voice/
│   │   │   ├── tts.ts           # ElevenLabs Flash v2.5 wrapper
│   │   │   ├── stt.ts           # Scribe wrapper + metadata extraction
│   │   │   ├── presets.ts       # VOICE_PRESETS: Record<Persona, Record<TruthState, VoiceSettings>>
│   │   │   ├── heuristic.ts     # computeLieScore(m) → 0-1
│   │   │   └── music.ts         # Music API + 3-track pre-gen
│   │   └── session/
│   │       └── store.ts         # In-memory Map<sessionId, Session>
│   └── test/                    # Vitest specs mirror src/ tree
├── public/                      # Static assets (card SVGs, favicon)
├── .env.local                   # ELEVENLABS_API_KEY, GEMINI_API_KEY (gitignored)
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tailwind.config.ts           # (if needed — Tailwind 4 may not require config)
├── next.config.ts
├── vitest.config.ts             # (Day 1+ when tests added)
├── LICENSE                      # MIT
└── README.md                    # 1-paragraph pitch + live URL + hackathon context
```

## Conventions

**State isolation.** The only thing that crosses to the client is `ClientSession` via `toClientView()`. Server-side fields (`Claim.actualCardIds`, `Claim.llmReasoning`, `Claim.truthState`) must never appear in wire responses. Type-level guarantee via `ClientRound.claimHistory: PublicClaim[]` (not `Claim[]`).

**Pure FSM.** `src/lib/game/fsm.ts` is pure TypeScript. No I/O, no fetch, no Date.now() side effects (pass time in). Tested in isolation with Vitest.

**Hybrid AI contract.** Every AI call goes through `src/lib/ai/brain.ts` — never call `llm.ts` or `deterministic.ts` directly from API routes. Brain enforces the math-baseline → LLM → fallback chain + timeout.

**Voice preset locking.** `src/lib/voice/presets.ts` is the single source of truth for persona × truthState → VoiceSettings. Misdirector's inversion (low stability on "honest", high on "lying") must be preserved — there's a Vitest assertion for it. Any code that "normalizes" presets by acoustic property breaks Misdirector silently.

**Test file naming.** `src/lib/game/fsm.test.ts` sits next to `fsm.ts`. Vitest picks up `*.test.ts` automatically.

**What NOT to add:**
- No `pages/` directory (App Router only)
- No `_app.tsx` / `_document.tsx` (App Router only — use `layout.tsx`)
- No global state libraries (Zustand / Redux / Jotai) — server holds session state, client uses `localStorage` + React state
- No CSS-in-JS — Tailwind 4 only
- No fetch libraries (axios / SWR / React Query) — native `fetch` + Next.js streaming is sufficient
