---
inclusion: fileMatch
fileMatchPattern: "src/lib/ai/llm.ts|src/lib/ai/brain.ts|src/lib/ai/**/*.ts"
---

# Hearsay — LLM Prompt Conventions

Applies when editing AI brain/LLM code. Codifies prompt structure, fallback rules, and the locked contract with the deterministic math layer.

## Model

**Google Gemini 2.5 Flash** via `@google/genai` SDK.

- Free tier: 1500 req/day. Expected load: ~200/day dev + ~500 total judge plays = plenty of headroom.
- JSON-mode: use the `responseJsonSchema` field inside `config` (i.e. `config.responseJsonSchema`) to enforce output shape. Do NOT rely on "please output JSON" in the prompt text alone. Note: the legacy `@google/generative-ai` SDK called this field `responseSchema` — the current `@google/genai` SDK uses `responseJsonSchema`.

## Pipeline (hybrid — never pure-LLM)

```
Step 1: Deterministic math (ALWAYS runs, <1ms)
  ├─ For judging: claimMathProbability(ctx) → 0..1
  └─ For own play: persona bluff-bias lookup

Step 2: LLM orchestrator (~500-1500ms typical, 2000ms timeout)
  ├─ Context includes Step 1's output as "DETERMINISTIC GROUNDING"
  └─ Returns structured JSON validated against TS type

Step 3: Deterministic fallback (triggered by LLM timeout >2s OR invalid JSON)
  └─ aiDecideOnClaimFallback() / aiDecideOwnPlayFallback()
```

## Hard requirements

- **JSON-mode enforced at SDK level.** Invalid JSON → retry once → fallback.
- **Schema validation.** Every response validated against TS types (`LLMJudgmentOutput` / `LLMOwnPlayOutput`).
- **2-second timeout.** After 2000ms wall time, abort fetch via AbortController, invoke deterministic fallback.
- **Always pass deterministic grounding.** Math baseline + voice lie-score in the prompt context so LLM decisions are anchored, not hallucinated.
- **In-character voice.** Prompts lead with `You are {{persona}}: {{personaDescription}}.` Never break character.
- **No runtime elimination-beat LLM.** Final words are static pre-gen clips (see `voice-preset-conventions.md`). Do NOT generate death/elimination dialogue at runtime — adds 8 prompt paths × Kiro code-gen risk.

## Prompt template — judging opponent's claim

```
You are {{persona}}: {{personaDescription}}.
Liar's Bar-style bluff game, best-of-3 rounds.
This round's target: {{targetRank}}.
Your hand: {{handDescription}}.
Pile face-down: {{pileSize}} cards. Claim history this round: {{publicClaims}}.
Opponent hand size: {{playerHandSize}}. Opponent jokers: {{opponentJokers}}.
Strikes: you {{strikesMe}}/3, them {{strikesPlayer}}/3.

DETERMINISTIC GROUNDING:
- Math probability opponent's claim is a lie: {{mathProb}} (0=honest, 1=impossible)
- Opponent voice lie-score: {{voiceLie}} (0=calm, 1=nervous)

Decide: accept the claim, or call "Liar!"
Stay in-character for {{persona}}.

Return JSON: {"action": "accept"|"challenge", "innerThought": "<one sentence>"}
```

## Prompt template — own play

```
You are {{persona}}: {{personaDescription}}.
Target this round: {{targetRank}}. Your hand: {{hand}}.
Strikes: you {{strikesMe}}/3, them {{strikesPlayer}}/3.
Round history: {{publicClaims}}.

Play 1-2 cards face-down, claim a count of {{targetRank}}.
Stay in-character. {{persona}} bluff-bias: {{bluffBias}}.

Return JSON: {
  "cardsToPlay": ["cardId1", "cardId2"?],
  "claimCount": 1 | 2,
  "claimText": "<short spoken line>",
  "truthState": "honest" | "lying",
  "innerThought": "<one sentence>"
}
```

## Prompt template — Stage Whisper probe response (Day 4-5)

```
You are {{persona}}: {{personaDescription}}.
The player has asked you a probing question during their Stage Whisper joker.
Their question: "{{probeText}}"

Your actual hand: {{hand}} (HIDDEN from player)
Your intended truthState for next claim: {{pendingTruthState}}

Answer in 1-2 sentences. Stay in-character. Your voice tells will still be driven
by your hidden truthState (honest=calm, lying=nervous — or inverted if Misdirector).
Don't reveal your hand. Deflect, joke, or give non-specific reassurance.

Return JSON: {"responseText": "<spoken line 1-2 sentences>", "innerThought": "<one sentence>"}
```

## Persona description strings (reusable)

```ts
const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  Novice:      "a new player who bluffs poorly and reads opponents carelessly. Your voice leaks obvious tells when you lie.",
  Reader:      "balanced and observant. You read opponents carefully. Your voice leaks subtle tells when you lie.",
  Misdirector: "a manipulator who fakes nervousness when telling the truth and stays calm when lying. Confident, theatrical, tricky.",
  Silent:      "minimal giveaways. Stoic and observant. Strong reader of others, very subtle tells of your own.",
};
```

## Deterministic fallback contract

When the LLM fails (timeout / invalid JSON / network error), `brain.ts` invokes the fallback functions from `math.ts`:

- `aiDecideOnClaimFallback(ctx: DecisionContext): { action: 'accept' | 'challenge' }` — combines math probability with voice lie-score via persona weights.
- `aiDecideOwnPlayFallback(ctx: OwnPlayContext): AiPlay` — uses persona bluff-bias to decide honest vs lie play.

These MUST always return a valid decision in <1ms. No I/O. No async.

## Logging

In dev mode, log every LLM call with:
- Input context (redacted if sensitive)
- Raw LLM response
- Parsed response (or parse error)
- Latency (ms)
- Cache hit/miss
- Fallback triggered? (reason)

Use Pino or plain `console.log` behind a `DEBUG_LLM=1` env guard. Never log in production path.

## No banter, no freeform output

LLM output is strictly structured JSON. No chit-chat, no "Here's my thinking:" prefixes, no markdown. If Gemini starts wrapping in code fences, strip them in the parse layer but flag it as a prompt regression.

## Temperature

- Judging: `temperature: 0.7` (some variance in persona voice, but grounded)
- Own play: `temperature: 0.8` (more creative claim text, but bluff-bias still anchors truthState)
- Probe response: `temperature: 0.9` (more theatrical)

Top-k / top-p: leave at SDK defaults unless testing shows specific issues.
