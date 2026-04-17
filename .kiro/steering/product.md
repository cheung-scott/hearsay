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

## Presentation: Elimination Beat (§1.5, theme layer — non-mechanic)

Losing = elimination, not death. **Non-firearm, non-gore** — dodges ElevenLabs Prohibited Use Policy + AWS/Kiro enterprise judging panel risk. Theme-only layer; zero changes to state machine, data model, AI pipeline, specs 1-9 — iter-5 lock preserved.

- **Silent-beat-before-reveal:** every challenge triggers ~2s of dead air. Music ducks via Web Audio `GainNode` (400ms linear ramp), one mechanical SFX fills the silence, then cards flip. The "Buckshot Roulette held breath" — demo's cinematic center of gravity.
- **Strike-3 elimination stinger:** non-firearm SFX (flatline / deep bell / glass shatter / cell-door clang). Pre-generated once via ElevenLabs Sound Effects API (`POST /v1/sound-generation`), cached as `public/sfx/elimination-stinger.mp3`.
- **Per-persona final-words** — 4 static MP3 clips, pre-generated once via **Eleven v3** (supports emotional tags `[gasps]`, `[laughs]`, `[whispers]`, `[sighs]`). Non-violent content. Files: `public/sfx/final-words/{persona}.mp3`.

| Persona | Final-words clip |
|---|---|
| Novice | `[gasps] No— no, wait—[breathing heavily]` |
| Reader | `[whispers] ...huh.` |
| Misdirector | `[laughs darkly] ...well played. [sighs]` |
| Silent | `[long exhale]...` |

**Strike counter upgrade:** 3 empty boxes → smoke-wisped tally-mark SVGs (no red ✗ in final UI). Lighting dims via CSS filter on strike 2. Viewport crack + red bleed effect on strike 3 is a stretch (skip if Day 5 compressed).

**Framing rules:**
- Use "eliminated", "final hand", "lights out" — never "died", "killed", "murdered"
- Never generate gunshot SFX (TOS risk + judge sensitivity)
- Never generate runtime LLM final-words dialogue (adds prompt paths + Kiro code-gen risk #14)
- Never rename `session_over` / `sessionWinner` / `strikes` — labels are display-layer only, typed contracts stay locked

Full spec: `ARCHITECTURE-DRAFT.md` §1.5 + §6.4 + §9 spec 9.

## Out of scope

Multiplayer, authentication, database persistence beyond `localStorage`, mobile app, real prosodic voice analysis (pitch / emotion / stress), real-time barge-in, voice cloning of player, custom DAW audio mixing.

**Explicitly cut during §1.5 pivot risk analysis:** gunshot SFX, literal death framing, LLM-generated runtime final-words, 4th music track "death", state-machine renames, persistent deathcards, cold-open / flashback demo video structure.

## Signature differentiators (for judges)

1. Dynamic TTS voice-param modulation per truth-state × persona (Case 47's 1st-place winning trick applied in a novel domain)
2. STT metadata → lie detection heuristic (novel bidirectional voice game)
3. Zero precedent across 180 enumerated prior hackathon submissions
4. 9 Kiro specs + steering + hooks + custom MCP server = visible spec-driven methodology

## Canonical design reference

Full architecture (data model, state machine, AI pipeline, voice presets, Kiro spec inventory, build sequence, risk register): [`Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md`](../../../Documents/Obsidian_Vault/Projects/ElevenHacks-Kiro/ARCHITECTURE-DRAFT.md) — iter 5 converged clean.
