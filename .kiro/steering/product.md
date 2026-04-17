# Product — Hearsay

Voice-bluffing card game, 1 human vs 1 AI. Inspired by Liar's Bar (bluff mechanic) + Balatro (run / modifier structure). Built for ElevenHacks Hack #5 (AWS Kiro partner week, Apr 16-23 2026).

## Core thesis

**Voice IS gameplay.** Two asymmetric voice channels drive every decision:

- **AI → player:** ElevenLabs TTS voice parameters (`stability`, `style`, `speed`) shift per persona × truth-state. The honest read and the lying read sound *different*. Player has to hear the tell.
- **Player → AI:** ElevenLabs Scribe STT metadata (latency, filler words, pause count, speech rate) feed a deterministic lie-score heuristic. AI combines with card-counting math probability.

This is the signature mechanic — zero precedent across 180 enumerated prior ElevenHacks submissions.

## Game mechanics (locked)

- **Deck:** 20 cards = 5 Queens + 5 Kings + 5 Aces + 5 Jacks. **No wild cards** — every card is exactly its rank. Forced-lie scenarios (no target rank in hand) are the norm, not the exception.
- **Deal:** 5 cards to each player.
- **Session:** best-of-3 rounds. Win 2 rounds = session win. Hit 3 strikes = instant session loss (rendered as 3 red ✗ boxes, baseball-style, cumulative across session).
- **Round:** target rank picked randomly from Q/K/A/J at round start. Players alternate turns.
- **Turn:** play 1-2 cards face-down + voice a claim ("One Queen." / "Two Queens.").
- **Response:** opponent accepts OR calls "Liar!".
- **Challenge reveal:**
  - Caught lying → liar takes pile + strike +1
  - Wrongly accused → challenger takes pile + strike +1
- **Round win:** hand empty via accepted or truthful claim.
- **Between rounds:** round winner picks 1 of 3 offered jokers (carry for session).

## AI personas (4, escalating difficulty)

1. **Novice** — obvious TTS tells AND bad reader. Starter.
2. **Reader** — balanced. Subtle tells, moderate reading. Default MVP persona.
3. **Misdirector** — **inverts the mapping.** Fakes tells on HONEST claims, stays steady when LYING. Punishes players who learn "shaky voice = lying."
4. **Silent** — minimal AI tells + strong reader. Asymmetric: "I read you, you can't read me."

## Session-Jokers (5 in MVP)

| Joker | Effect |
|---|---|
| **Poker Face** | AI's voice-heuristic input is suppressed for 1 claim of your choice (math-only judging) |
| **Stage Whisper** | Unlocks probing: speak 1 free-form probe before next AI claim; AI answers via LLM + TTS with voice tells active |
| **Earful** | After any challenge won by you, AI reveals which voice-tell preset was active |
| **Cold Read** | Next AI claim: math-weight amplified, voice-weight reduced — easier to catch big lies |
| **Second Wind** | One-time: next strikes-penalty against you is cancelled |

## Edge cases (all in MVP)

- **Unparseable voice input:** STT transcript fails regex `(one|two|1|2) (queen|king|ace|jack)s?`. UI shows retry prompt; button-based claim fallback always visible. 2 parse failures → auto-play random card + random-count claim.
- **Wrong rank claimed:** UI flags "This round is Queens. Try again." Doesn't count as timeout retry.
- **Caught on final card:** liar takes pile → hand non-empty → round continues (no exploit).
- **Wrongly-challenged-on-honest-final-card:** hand empty + last claim honest → round won immediately.
- **Forced lie:** 0 target-rank cards in hand → must lie. Expected to happen often.
- **Active-player timeout (30s):** auto-play 1 random card + claim "One [target]".
- **Responder timeout (30s):** auto-accept.

## Out of scope

Multiplayer, authentication, database persistence beyond `localStorage`, mobile app, real prosodic voice analysis (pitch / emotion / stress), real-time barge-in, voice cloning of player, custom DAW audio mixing.

## Signature differentiators (for judges)

1. Dynamic TTS voice-param modulation per truth-state × persona (Case 47's 1st-place winning trick applied in a novel domain)
2. STT metadata → lie detection heuristic (novel bidirectional voice game)
3. Zero precedent across 180 enumerated prior hackathon submissions
4. 9 Kiro specs + steering + hooks + custom MCP server = visible spec-driven methodology

## Canonical design reference

Full architecture (data model, state machine, AI pipeline, voice presets, Kiro spec inventory, build sequence, risk register): [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) — iter 5 converged clean.
