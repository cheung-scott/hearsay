'use client';

import '@/styles/game-theme.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameSession } from '@/hooks/useGameSession';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useHoldToSpeak } from '@/hooks/useHoldToSpeak';
import { useTypewriter } from '@/hooks/useTypewriter';
import { useMusicBed } from '@/hooks/useMusicBed';
import { deriveTensionLevel } from '@/lib/music/tension';
import { hasAllTracks } from '@/lib/music/tracks';
import { PERSONA_DISPLAY_NAMES } from '@/lib/persona/displayNames';
import type { ClientSession, MusicTrack, Persona } from '@/lib/game/types';
import {
  saveProgress,
  clearProgress,
  nextPersona,
  isGauntletComplete,
  GAUNTLET_ORDER,
} from '@/lib/game/progress';
import type { GauntletProgress } from '@/lib/game/progress';
import { Scene } from './Scene/Scene';
import { TopBar } from './Hud/TopBar';
import { PlayerControls } from './PlayerControls/PlayerControls';
import { OverlayEffects } from './Scene/OverlayEffects';
// Day-5 Wave-2 UI stubs — scaffold-first / parallel-fill pattern.
// Each returns null until its parallel-fill agent implements. Props contracts
// are frozen below; agents MUST NOT modify the stub interfaces.
import { JokerTray } from './PlayerControls/JokerTray';
import { JokerPicker } from './Scene/JokerPicker';
import { ProbeReveal } from './Scene/ProbeReveal';
import { AutopsyOverlay } from './Scene/AutopsyOverlay';
import { ClerkTutorial } from './Scene/ClerkTutorial';
import { useTutorial } from '@/hooks/useTutorial';
import {
  YouPlayedBanner,
  SpeechParseBanner,
  ChallengeOutcomeBanner,
  type ChallengeOutcome,
} from './Scene/OutcomeBanners';

// ---------------------------------------------------------------------------
// §1.5 Elimination-Beat constants
// ---------------------------------------------------------------------------

/** 400ms linear ramp for silent-beat duck (spec §1.5 LOCK). */
const SILENT_BEAT_DUCK_MS = 400;
/** Dead-air duration before cards flip on every challenge reveal. */
const SILENT_BEAT_DURATION_MS = 2000;
/** Breather after an AI accept/liar verdict before the next AI claim can fire. */
const NEXT_AI_CLAIM_BREATHER_MS = 1400;
/** Delay between stinger end and per-persona final-words clip. */
const FINAL_WORDS_DELAY_MS = 1000;

/** Maps AI persona → pre-generated final-words clip path. */
const FINAL_WORDS_URLS: Record<Persona, string> = {
  Novice:      '/sfx/final-words/novice.mp3',
  Reader:      '/sfx/final-words/reader.mp3',
  Misdirector: '/sfx/final-words/misdirector.mp3',
  Silent:      '/sfx/final-words/silent.mp3',
};

function deriveVerdictWinner(session: ClientSession): 'player' | 'ai' | undefined {
  if (session.self.strikes >= 3) return 'ai';
  if (session.opponent.strikes >= 3) return 'player';
  if (session.sessionWinner) return session.sessionWinner;
  if (session.self.roundsWon >= 2) return 'player';
  if (session.opponent.roundsWon >= 2) return 'ai';
  return undefined;
}

function progressIncludingCurrentWin(
  progress: GauntletProgress,
  session: ClientSession,
): GauntletProgress {
  const persona = session.opponent.personaIfAi;
  if (
    deriveVerdictWinner(session) !== 'player' ||
    !persona ||
    !GAUNTLET_ORDER.includes(persona) ||
    progress.defeated.includes(persona)
  ) {
    return progress;
  }

  return { defeated: [...progress.defeated, persona] };
}

function latestClaimBy(session: ClientSession): 'player' | 'ai' | null {
  const startIdx = Math.min(session.currentRoundIdx, session.rounds.length - 1);
  for (let i = startIdx; i >= 0; i--) {
    const history = session.rounds[i]?.claimHistory;
    if (history && history.length > 0) {
      return history[history.length - 1].by;
    }
  }
  return null;
}

export interface GameSessionProps {
  /** Optional hydration — if provided, populates initial state (for testing). */
  initialSession?: ClientSession;
}

/**
 * "use client" root. Owns all gameplay state via useGameSession.
 * No direct FSM or API imports — only hooks and components.
 *
 * Responsibilities:
 * - Mount / CreateSession on idle (or when initialSession provided)
 * - Wire useHoldToSpeak audioBlob → PlayerClaim dispatch
 * - Wire TTS audio URL → useAudioPlayer → markAudioEnded
 * - Compose Scene + TopBar + PlayerControls + OverlayEffects
 */
export function GameSession({ initialSession }: GameSessionProps) {
  const { state, dispatch, selectedCardIds, toggleCardSelection, markAudioEnded } =
    useGameSession(initialSession);

  const audioPlayer = useAudioPlayer();
  // One-shot player for the strike-3 elimination stinger.
  const stingerPlayer = useAudioPlayer();
  // One-shot player for per-persona final-words clips.
  const finalWordsPlayer = useAudioPlayer();
  // One-shot player for the §1.5 silent-beat whoosh (courtroom hush / inhale).
  // Hoisted separately from stingerPlayer so the pre-reveal whoosh and the
  // strike-3 elimination sting can't overwrite each other if they ever race.
  const silentBeatPlayer = useAudioPlayer();
  // One-shot player for the verdict gavel strike on session-over.
  const gavelPlayer = useAudioPlayer();
  // One-shot player for the AI's spoken accept/liar verdict on the player's
  // claim. Fires on every /api/turn PlayerClaim response when an aiResponse
  // payload is present. Hoisted separately so it never collides with the
  // main claim-TTS audioPlayer or the §1.5 stinger/gavel/silent-beat players.
  const responsePlayer = useAudioPlayer();
  const lastResponseAudioUrlRef = useRef<string | undefined>(undefined);
  const holdToSpeak = useHoldToSpeak();

  // -------------------------------------------------------------------------
  // Gauntlet progression (Option B — localStorage)
  // -------------------------------------------------------------------------
  // Hackathon build (2026-04-22): always reset the gauntlet AND the tutorial
  // flag on mount so a hard-refresh always lands on the tutorial against the
  // Defendant. Full gauntlet persistence returns post-event.
  const [progress, setProgress] = useState<GauntletProgress>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        clearProgress();
        localStorage.removeItem('hearsay-tutorial-seen');
      } catch {
        // localStorage unavailable — silently proceed with in-memory defaults.
      }
    }
    return { defeated: [] };
  });
  // Ref guard: tracks session id for which we've already saved a gauntlet win,
  // to ensure the save-on-win effect fires exactly once per session_over.
  const gauntletWinFiredRef = useRef<string | null>(null);

  // Derive the preferred persona for the next CreateSession call.
  const preferredPersona = nextPersona(progress) ?? undefined;

  const resetToStartScreen = useCallback(async () => {
    clearProgress();
    const reset: GauntletProgress = { defeated: [] };
    setProgress(reset);
    gauntletWinFiredRef.current = null;
    try {
      localStorage.removeItem('hearsay-tutorial-seen');
    } catch {
      // localStorage unavailable — reset in memory only.
    }
    await dispatch({ type: 'ResetSession' });
  }, [dispatch]);

  // Typewriter: 110 ms per char per DESIGN-DECISIONS.md §8.
  const { displayedText, isDone } = useTypewriter(state.lastClaimText ?? '', 110);

  // -------------------------------------------------------------------------
  // Playtest-fix HUD: YouPlayed readback + ChallengeOutcome banner.
  // -------------------------------------------------------------------------
  // Track prev strikes to detect who just took a strike after a response.
  const prevStrikesRef = useRef<{ player: number; ai: number }>({ player: 0, ai: 0 });
  const [outcome, setOutcome] = useState<ChallengeOutcome | null>(null);
  const outcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the last response action the player (or implicitly AI) took, so we
  // can disambiguate "no strike changed" between ACCEPT and a caught-truth no-op.
  const lastRespondActionRef = useRef<'accept' | 'challenge' | null>(null);
  // Who made the most recent claim (player or ai) — informs outcome wording
  // (ai-wrong-call vs caught-lie when the challenger side flips).
  const lastClaimByRef = useRef<'player' | 'ai' | null>(null);

  const showOutcomeForMs = useCallback((o: ChallengeOutcome, ms = 2200) => {
    if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
    setOutcome(o);
    outcomeTimerRef.current = setTimeout(() => {
      setOutcome(null);
      outcomeTimerRef.current = null;
    }, ms);
  }, []);

  // Clean up the timer on unmount.
  useEffect(() => {
    return () => {
      if (outcomeTimerRef.current) clearTimeout(outcomeTimerRef.current);
    };
  }, []);

  // Reset strike baseline when a new session starts.
  useEffect(() => {
    if (!state.session) {
      prevStrikesRef.current = { player: 0, ai: 0 };
      return;
    }
    // When we see a fresh session id for the first time, sync the baseline
    // without firing a banner.
    // (No persistence between sessions — each new session zeroes strikes.)
  }, [state.session?.id]);

  // Detect strike deltas and show outcome banner.
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    const nowPlayer = s.self.strikes;
    const nowAi = s.opponent.strikes;
    const prev = prevStrikesRef.current;

    if (nowPlayer !== prev.player || nowAi !== prev.ai) {
      const playerGained = nowPlayer > prev.player;
      const aiGained = nowAi > prev.ai;
      const claimBy = latestClaimBy(s) ?? lastClaimByRef.current;
      if (claimBy) lastClaimByRef.current = claimBy;

      // Fix (2026-04-22): outcome disambiguation now uses lastClaimByRef
      // (who made the claim that got resolved) rather than
      // lastRespondActionRef (which stays stale when the player doesn't
      // respond — e.g. when the AI auto-chains a challenge on the server
      // after a PlayerClaim). Rule: the struck party is the one who made
      // the losing play — if the last claim was theirs and they lost, they
      // were caught lying; if the last claim was the opponent's and they
      // lost, they wrongly challenged the opponent's honest claim.
      if (playerGained && !aiGained) {
        // Player took a strike.
        if (claimBy === 'player') {
          // Player lied; AI caught them.
          showOutcomeForMs('player-caught');
        } else {
          // Player challenged AI's honest claim and was wrong.
          showOutcomeForMs('false-accusation');
        }
      } else if (aiGained && !playerGained) {
        // AI took a strike.
        if (claimBy === 'ai') {
          // AI lied; player caught them.
          showOutcomeForMs('caught-lie');
        } else {
          // AI challenged player's honest claim and was wrong.
          showOutcomeForMs('ai-wrong-call');
        }
      }
      prevStrikesRef.current = { player: nowPlayer, ai: nowAi };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.self.strikes, state.session?.opponent.strikes]);

  // Track who made the most recent claim — read from claimHistory tail.
  useEffect(() => {
    const s = state.session;
    if (!s) return;
    const round = s.rounds[s.currentRoundIdx];
    if (!round || round.claimHistory.length === 0) return;
    const last = round.claimHistory[round.claimHistory.length - 1];
    lastClaimByRef.current = last.by;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session?.rounds, state.session?.currentRoundIdx]);

  // Most recent player claim text for the YouPlayed readback.
  const lastPlayerClaimText: string | null = (() => {
    const s = state.session;
    if (!s) return null;
    const round = s.rounds[s.currentRoundIdx];
    if (!round) return null;
    // Walk claimHistory from tail → find latest 'player' claim.
    for (let i = round.claimHistory.length - 1; i >= 0; i--) {
      const c = round.claimHistory[i];
      if (c.by === 'player' && c.claimText) return c.claimText;
    }
    return null;
  })();

  // Show YouPlayed readback only while it's the AI's turn to respond/claim
  // (i.e. player just finished speaking) — not during the next player turn.
  const youPlayedVisible =
    state.phase === 'awaiting-ai' ||
    state.phase === 'playing-ai-audio' ||
    state.phase === 'awaiting-player-response';

  // -------------------------------------------------------------------------
  // Music bed (tension-music-system spec §6.5)
  // -------------------------------------------------------------------------

  // Local music UI state. `musicDisabled` mirrors the ClientSession.musicState
  // shape but lives in component state (not projected by toClientView per
  // types.ts L320 — populated client-side).
  const [musicDisabled, setMusicDisabled] = useState(false);
  const [userMuted] = useState(false); // mute toggle UX is owned by ui-gameplay phase 2
  const [pregenTracks, setPregenTracks] = useState<MusicTrack[]>([]);
  const pregenFiredRef = useRef<string | null>(null);
  // Hoisted so the per-session reset effect can clear it; the audioPlayer
  // false→true transition effect below also writes it.
  const wasPlayingRef = useRef(false);

  // deriveTensionLevel takes the narrowest shape it actually reads, so no
  // synthesis-cast needed: ClientSession.{status, self, opponent} satisfies it.
  const tensionInput = state.session
    ? {
        status: state.session.status,
        player: { strikes: state.session.self.strikes },
        ai: { strikes: state.session.opponent.strikes },
      }
    : ({ status: 'setup' as const, player: { strikes: 0 }, ai: { strikes: 0 } });

  // Prefer pregen response tracks (fresh URLs) over the session snapshot,
  // which started empty pre-pregen. The next session refetch will reconcile.
  const sessionMusicTracks =
    pregenTracks.length > 0 ? pregenTracks : (state.session?.musicTracks ?? []);

  const tracksReady = hasAllTracks(sessionMusicTracks);
  const musicEnabled = !musicDisabled && !userMuted && tracksReady;

  // R15.2 — track URL load failure flips music-disabled.
  const handleTrackLoadError = () => setMusicDisabled(true);

  const music = useMusicBed({
    tracks: sessionMusicTracks,
    currentTensionLevel: deriveTensionLevel(tensionInput),
    enabled: musicEnabled,
    onTrackLoadError: handleTrackLoadError,
  });

  // Fire pregen once per fresh session, and reset all carried-over per-session
  // music state so NEW TRIAL after session-over starts cleanly. AbortController
  // covers the rapid CreateSession-twice race where an in-flight fetch resolves
  // for a stale session id.
  useEffect(() => {
    const id = state.session?.id;
    if (!id) return;
    if (pregenFiredRef.current === id) return;

    // Per-session reset — prevents NEW TRIAL inheriting prior session's tracks
    // or sticky musicDisabled flag.
    pregenFiredRef.current = id;
    setPregenTracks([]);
    setMusicDisabled(false);
    wasPlayingRef.current = false;

    const ac = new AbortController();
    fetch('/api/music/pregen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
      signal: ac.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { tracks: MusicTrack[] }) => {
        // Stale-response guard — ignore if the user has since started a newer session.
        if (pregenFiredRef.current !== id) return;
        if (data.tracks?.length) {
          setPregenTracks(data.tracks);
        } else {
          setMusicDisabled(true);
        }
      })
      .catch(err => {
        if (err?.name === 'AbortError') return;
        if (pregenFiredRef.current !== id) return;
        setMusicDisabled(true);
      });

    return () => { ac.abort(); };
  }, [state.session?.id]);

  // Wire input ducking from useHoldToSpeak.
  useEffect(() => {
    if (!musicEnabled) return;
    if (holdToSpeak.state === 'recording') {
      music.duckForInput();
    } else if (holdToSpeak.state === 'idle' || holdToSpeak.state === 'stopped') {
      music.restoreFromInput();
    }
    // music API is stable; intentionally narrow deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdToSpeak.state, musicEnabled]);

  // Track isPlaying transitions so we can duck on false→true (spec §6.5).
  // restoreFromOutput is hooked into the combined onEnded below — useAudioPlayer's
  // onEnded is one-shot/self-clearing, so we must register markAudioEnded AND
  // restoreFromOutput as a single callback per turn (last writer wins otherwise).
  // wasPlayingRef is hoisted above (per-session reset effect needs to clear it).
  useEffect(() => {
    if (audioPlayer.isPlaying && !wasPlayingRef.current && musicEnabled) {
      music.duckForOutput();
    }
    wasPlayingRef.current = audioPlayer.isPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPlayer.isPlaying, musicEnabled]);

  // -------------------------------------------------------------------------
  // Tutorial — hoisted above audio effects so claim-audio can gate on tutorial.
  // While the overlay is visible, we refuse to play the AI's claim audio OR
  // fire the next AiAct so the Defendant waits for the player to read/dismiss.
  // -------------------------------------------------------------------------
  const tutorial = useTutorial(state.session);

  // When a new TTS audio URL arrives, play it and register a combined onEnded
  // callback (markAudioEnded for FSM phase advance + restoreFromOutput for music).
  // Gated on !tutorial.active so the claim voiceline doesn't overlap the
  // Clerk's tutorial popup. `lastClaimAudioUrlPlayedRef` prevents re-play when
  // tutorial.active toggles while lastClaimAudioUrl is unchanged.
  const lastClaimAudioUrlPlayedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state.lastClaimAudioUrl || tutorial.active) return;
    if (lastClaimAudioUrlPlayedRef.current === state.lastClaimAudioUrl) return;
    lastClaimAudioUrlPlayedRef.current = state.lastClaimAudioUrl;
    audioPlayer.onEnded(() => {
      markAudioEnded();
      if (musicEnabled) music.restoreFromOutput();
    });
    audioPlayer.play(state.lastClaimAudioUrl);
    // audioPlayer and markAudioEnded are stable refs — intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastClaimAudioUrl, tutorial.active]);

  // When the AI's spoken accept/liar verdict arrives from /api/turn PlayerClaim
  // (Gemini → ElevenLabs pipe), play it on the dedicated responsePlayer so it
  // doesn't overwrite the main claim-TTS audioPlayer if one happens to be
  // mid-playback. Ref guard ensures we don't replay the same URL on re-renders
  // (data: URLs are stable per response, so this is reliable).
  //
  // Also keeps `responseAudioPending` true until onEnded fires and the
  // post-verdict breather elapses, which gates the auto-AiAct effect below.
  const [responseAudioPending, setResponseAudioPending] = useState(false);
  const responseFlowReadyUrlRef = useRef<string | undefined>(undefined);
  const responseFlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseResponseFlowAfterBreather = useCallback((url: string) => {
    if (responseFlowTimerRef.current) {
      clearTimeout(responseFlowTimerRef.current);
    }
    responseFlowTimerRef.current = setTimeout(() => {
      responseFlowTimerRef.current = null;
      if (lastResponseAudioUrlRef.current !== url) return;
      responseFlowReadyUrlRef.current = url;
      setResponseAudioPending(false);
    }, NEXT_AI_CLAIM_BREATHER_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (responseFlowTimerRef.current) clearTimeout(responseFlowTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const url = state.lastAiResponseAudioUrl;
    if (!url) return;
    if (lastResponseAudioUrlRef.current === url) return;
    lastResponseAudioUrlRef.current = url;
    responseFlowReadyUrlRef.current = undefined;
    if (responseFlowTimerRef.current) {
      clearTimeout(responseFlowTimerRef.current);
      responseFlowTimerRef.current = null;
    }
    setResponseAudioPending(true);
    responsePlayer.onEnded(() => releaseResponseFlowAfterBreather(url));
    try {
      responsePlayer.play(url);
    } catch {
      // Audio playback failure is non-fatal; the outcome banner + session
      // state already convey the verdict. Keep the same breather so pacing
      // remains consistent.
      releaseResponseFlowAfterBreather(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastAiResponseAudioUrl, releaseResponseFlowAfterBreather]);

  // Auto-trigger AI's turn when it's their move. Without this, rounds where
  // activePlayer starts as 'ai' hang in 'awaiting-ai' forever because the
  // server chains AI judgment inside PlayerClaim but has no AI-first pathway.
  //
  // Gated on:
  //   - tutorial.active — Clerk tutorial overlay is showing.
  //   - responseAudioPending / audioPlayer.isPlaying / responsePlayer.isPlaying
  //     — any audio is currently playing.
  //   - aiActCooldown — a 500ms breather AFTER audio ends, so the AI's next
  //     claim doesn't slam straight into the trailing edge of the prior
  //     verdict / claim. Gives natural rhythm + guards against mis-timed
  //     `isPlaying` state transitions.
  const [aiActCooldown, setAiActCooldown] = useState(false);
  useEffect(() => {
    if (audioPlayer.isPlaying) {
      setAiActCooldown(true);
      return;
    }
    if (!aiActCooldown) return;
    const t = setTimeout(() => setAiActCooldown(false), 500);
    return () => clearTimeout(t);
    // aiActCooldown self-reference OK — gated on the return above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPlayer.isPlaying]);

  useEffect(() => {
    const responseUrl = state.lastAiResponseAudioUrl;
    const responseFlowReady =
      !responseUrl || responseFlowReadyUrlRef.current === responseUrl;

    if (
      state.phase === 'awaiting-ai' &&
      !tutorial.active &&
      !responseAudioPending &&
      responseFlowReady &&
      !audioPlayer.isPlaying &&
      !responsePlayer.isPlaying &&
      !aiActCooldown
    ) {
      dispatch({ type: 'AiAct' }).catch(() => { /* error surfaces via state.error */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.phase,
    state.lastAiResponseAudioUrl,
    tutorial.active,
    responseAudioPending,
    audioPlayer.isPlaying,
    responsePlayer.isPlaying,
    aiActCooldown,
  ]);

  // When holdToSpeak audioBlob transitions from null to non-null, AND we're
  // in recording phase with cards selected, dispatch PlayerClaim.
  useEffect(() => {
    const blob = holdToSpeak.audioBlob;
    if (
      blob !== null &&
      state.phase === 'recording' &&
      selectedCardIds.size > 0 &&
      state.session !== null
    ) {
      const currentRound = state.session.rounds[state.session.currentRoundIdx];
      const rank = currentRound?.targetRank ?? 'Queen';
      const count = selectedCardIds.size;
      const claimText = `${count} ${rank}${count > 1 ? 's' : ''}`;

      const selectedCards = state.session.self.hand.filter(c =>
        selectedCardIds.has(c.id),
      );

      dispatch({
        type: 'PlayerClaim',
        cards: selectedCards,
        audio: blob,
        claimText,
      }).catch(() => {
        // Errors are surfaced via state.error
      });
    }
    // selectedCardIds changes identity on every toggle — use .size as proxy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdToSpeak.audioBlob]);

  // Persona display name is threaded through Scene → Opponent via
  // session.opponent.personaIfAi — Scene does the lookup.
  void PERSONA_DISPLAY_NAMES;

  // -------------------------------------------------------------------------
  // §1.5 Elimination-Beat: stinger + final-words on session_over
  // -------------------------------------------------------------------------
  // Track whether we've already fired the elimination-beat sequence for the
  // current session so we don't replay on re-renders.
  const eliminationFiredRef = useRef<string | null>(null);
  // Separate once-per-session guard for the verdict gavel. Unlike the
  // eliminationFiredRef path this fires on ANY session-over (strike-3 OR
  // hand-empty), so it uses its own guard.
  const gavelFiredRef = useRef<string | null>(null);

  // Gavel strike on verdict — fires exactly once when phase first becomes
  // session-over for a given session id. Silently no-ops if the MP3 is
  // missing (useAudioPlayer fires onEnded on play() rejection).
  useEffect(() => {
    const session = state.session;
    if (!session) return;
    if (state.phase !== 'session-over') return;
    if (gavelFiredRef.current === session.id) return;
    gavelFiredRef.current = session.id;
    try {
      gavelPlayer.play('/sfx/gavel.mp3');
    } catch {
      /* file missing — non-fatal */
    }
    // gavelPlayer is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.session?.id]);

  useEffect(() => {
    const session = state.session;
    if (!session) return;
    if (state.phase !== 'session-over') return;
    // Only fire once per session.
    if (eliminationFiredRef.current === session.id) return;

    // Check if the session ended via strike-3 (at least one side has strikes >= 3).
    const strikeElimination =
      session.self.strikes >= 3 || session.opponent.strikes >= 3;

    if (!strikeElimination) return;

    eliminationFiredRef.current = session.id;

    // Step 1: play the stinger.
    stingerPlayer.play('/sfx/stinger.mp3');

    // Step 2: if AI was eliminated (player won), schedule per-persona final-words
    // ~1s after the stinger ends. We use onEnded for reliable chaining.
    if (deriveVerdictWinner(session) === 'player') {
      const persona = session.opponent.personaIfAi;
      if (persona) {
        const finalWordsUrl = FINAL_WORDS_URLS[persona];
        stingerPlayer.onEnded(() => {
          setTimeout(() => {
            finalWordsPlayer.play(finalWordsUrl);
          }, FINAL_WORDS_DELAY_MS);
        });
      }
    }
    // If AI won (player eliminated), no final-words — stinger IS the sign-off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.session?.id]);

  // -------------------------------------------------------------------------
  // Gauntlet save-on-win (fires exactly once per session_over with ref guard)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const session = state.session;
    if (!session) return;
    if (state.phase !== 'session-over') return;
    if (deriveVerdictWinner(session) !== 'player') return;
    // Ref guard: only fire once per session id.
    if (gauntletWinFiredRef.current === session.id) return;

    const persona = session.opponent.personaIfAi;
    if (!persona) return;
    // Only count personas that belong to the gauntlet order and haven't been recorded yet.
    if (!GAUNTLET_ORDER.includes(persona)) return;

    // Mark as fired before any state updates so concurrent re-renders don't double-fire.
    gauntletWinFiredRef.current = session.id;

    setProgress((prev) => {
      if (prev.defeated.includes(persona)) return prev; // idempotent
      const updated: GauntletProgress = { defeated: [...prev.defeated, persona] };
      saveProgress(updated);
      return updated;
    });
    // gauntletWinFiredRef, saveProgress, GAUNTLET_ORDER are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.phase,
    state.session?.id,
    state.session?.sessionWinner,
    state.session?.self.strikes,
    state.session?.opponent.strikes,
    state.session?.self.roundsWon,
    state.session?.opponent.roundsWon,
  ]);

  // -------------------------------------------------------------------------
  // §1.5 Elimination-Beat: silent-beat before reveal
  // -------------------------------------------------------------------------
  // Intercept the "Liar!" challenge to enforce ~2s dead air BEFORE the server
  // resolves and cards visually flip. Music ducks immediately on click, then
  // the dispatch fires after SILENT_BEAT_DURATION_MS. restoreFromOutput is
  // called once the server responds (existing TTS-ended path handles it for
  // ongoing play; for session_over there's no TTS so we restore in handleLiar).
  const silentBeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep music API stable ref for use inside setTimeout callback.
  const musicRef = useRef(music);
  useEffect(() => { musicRef.current = music; });
  const musicEnabledRef = useRef(musicEnabled);
  useEffect(() => { musicEnabledRef.current = musicEnabled; });

  const handleLiar = useCallback(() => {
    // Record action for outcome-banner disambiguation.
    lastRespondActionRef.current = 'challenge';
    // Duck music for the silent beat (400ms linear ramp per spec §1.5 LOCK).
    if (musicEnabledRef.current) {
      musicRef.current.duckForOutput({ fadeMs: SILENT_BEAT_DUCK_MS });
    }

    // Fire the silent-beat whoosh SFX (courtroom hush / inhale) during the
    // dead-air window so it feels intentional, not broken. Silently no-ops if
    // the MP3 hasn't been generated yet (useAudioPlayer fires onEnded on
    // play() rejection — no state machine deadlocks here, this is a pure
    // one-shot with no onEnded consumer).
    try {
      silentBeatPlayer.play('/sfx/silent-beat.mp3');
    } catch {
      /* file missing or decode error — non-fatal, dead-air still works */
    }

    // Cancel any in-flight timer (rapid double-click guard).
    if (silentBeatTimerRef.current) {
      clearTimeout(silentBeatTimerRef.current);
    }

    // After the dead-air window, dispatch the challenge. The server resolves
    // RevealComplete and returns the updated session; cards will then flip
    // via normal React re-render. Music restore happens:
    //   - Via the existing markAudioEnded + restoreFromOutput path (if TTS follows)
    //   - Or immediately here if no TTS follows (session_over / accepted-claim path)
    silentBeatTimerRef.current = setTimeout(() => {
      silentBeatTimerRef.current = null;
      dispatch({ type: 'PlayerRespond', action: 'challenge' })
        .then(() => {
          // The server returns synchronously. If no TTS audio URL was set,
          // the existing restoreFromOutput path won't fire — restore manually
          // so the duck doesn't persist.
          if (musicEnabledRef.current) {
            musicRef.current.restoreFromOutput();
          }
        })
        .catch(() => {
          // Error is surfaced via state.error — restore music anyway.
          if (musicEnabledRef.current) musicRef.current.restoreFromOutput();
        });
    }, SILENT_BEAT_DURATION_MS);
  // dispatch is stable (useCallback with [] deps in useGameSession).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // -------------------------------------------------------------------------
  // Render: idle / no session → Start CTA
  // -------------------------------------------------------------------------
  if (state.session === null) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--wall)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          fontFamily: '"Press Start 2P", monospace',
          color: 'var(--bone)',
        }}
      >
        <OverlayEffects />
        <h1 style={{ fontSize: '28px', margin: 0, letterSpacing: '4px' }}>HEARSAY</h1>
        <p style={{ fontSize: '11px', color: 'var(--bone-dim)' }}>
          THE COURT OF HEARSAY
        </p>
        {state.error && (
          <p style={{ fontSize: '10px', color: 'var(--coral)' }}>{state.error}</p>
        )}
        <button
          onClick={async () => {
            // Prime AudioContext inside the user gesture (autoplay policy).
            try {
              await music.prime();
            } catch {
              // music will be silently disabled
            }
            try {
              await dispatch({ type: 'CreateSession', preferredPersona });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('[CTA] CreateSession dispatch threw:', err);
            }
          }}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '12px',
            letterSpacing: '3px',
            background: 'var(--persona-prosecutor)',
            color: 'var(--wall)',
            border: 'none',
            padding: '16px 32px',
            cursor: 'pointer',
            boxShadow: '4px 4px 0 0 var(--shadow)',
          }}
        >
          BEGIN TRIAL
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: session-over → gauntlet-complete final win screen OR NEW TRIAL CTA
  // -------------------------------------------------------------------------
  if (state.phase === 'session-over') {
    const winner = deriveVerdictWinner(state.session);
    const playerWon = winner === 'player';
    const verdictProgress = progressIncludingCurrentWin(progress, state.session);
    // Diagnostic log to catch playtest reports of "CASE DISMISSED after losing".
    // Logs the raw session-end state so we can verify sessionWinner matches
    // strikes/roundsWon on the client before the render branch is taken.
    // eslint-disable-next-line no-console
    console.log('[SESSION-OVER]', {
      sessionWinner: state.session.sessionWinner,
      verdictWinner: winner,
      playerStrikes: state.session.self.strikes,
      aiStrikes: state.session.opponent.strikes,
      playerRoundsWon: state.session.self.roundsWon,
      aiRoundsWon: state.session.opponent.roundsWon,
      persona: state.session.opponent.personaIfAi,
    });

    // Gauntlet-complete override: all 4 opponents beaten → COURT ADJOURNED screen.
    if (isGauntletComplete(verdictProgress)) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--wall)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '24px',
            fontFamily: '"Press Start 2P", monospace',
            color: 'var(--bone)',
          }}
        >
          <OverlayEffects />
          <h1
            style={{
              fontSize: '20px',
              margin: 0,
              color: 'var(--amber-hi)',
              letterSpacing: '3px',
              textAlign: 'center',
            }}
          >
            CASE DISMISSED
          </h1>
          <p
            style={{
              fontSize: '10px',
              color: 'var(--amber-hi)',
              letterSpacing: '2px',
              margin: 0,
              textAlign: 'center',
            }}
          >
            COURT ADJOURNED
          </p>
          <button
            data-testid="gauntlet-start-over"
            onClick={async () => {
              clearProgress();
              const reset: GauntletProgress = { defeated: [] };
              setProgress(reset);
              await music.prime().catch(() => { /* music will be silently disabled */ });
              await dispatch({ type: 'CreateSession', preferredPersona: 'Novice' });
            }}
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '11px',
              letterSpacing: '3px',
              background: 'var(--felt)',
              color: 'var(--bone)',
              border: '2px solid var(--amber-dim)',
              padding: '14px 28px',
              cursor: 'pointer',
              boxShadow: '4px 4px 0 0 var(--shadow)',
            }}
          >
            START OVER
          </button>
        </div>
      );
    }

    // Subtitle copy differs by outcome + by gauntlet position (verdict stays
    // the same, but mid-gauntlet phrasing previews the next opponent).
    const nextUp = playerWon ? nextPersona(verdictProgress) : nextPersona(progress);
    const subtitle = playerWon
      ? (nextUp
          ? `${PERSONA_DISPLAY_NAMES[nextUp]} rises next.`
          : 'The court adjourns.')
      : 'The jury has spoken.';
    const ctaLabel = playerWon
      ? (nextUp ? 'NEXT CASE' : 'NEW TRIAL')
      : 'RETRIAL';
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--wall)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          fontFamily: '"Press Start 2P", monospace',
          color: 'var(--bone)',
        }}
      >
        <OverlayEffects />
        {/* Verdict plate — amber border + drop shadow, stronger stage feel. */}
        <div
          style={{
            padding: '24px 44px',
            border: `3px solid ${playerWon ? 'var(--amber-hi)' : 'var(--coral)'}`,
            background: 'rgba(10,16,8,0.75)',
            boxShadow: '6px 6px 0 0 var(--shadow), 0 0 32px rgba(0,0,0,0.55)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '8px',
              letterSpacing: '3px',
              color: 'var(--bone-dim)',
              marginBottom: '12px',
              textTransform: 'uppercase',
            }}
          >
            VERDICT
          </div>
          <h1
            data-testid="session-verdict"
            style={{
              fontSize: '26px',
              margin: 0,
              letterSpacing: '4px',
              color: playerWon ? 'var(--amber-hi)' : 'var(--coral)',
            }}
          >
            {playerWon ? 'CASE DISMISSED' : 'GUILTY'}
          </h1>
          <p
            style={{
              fontSize: '9px',
              letterSpacing: '2px',
              color: 'var(--bone-dim)',
              marginTop: '14px',
              marginBottom: 0,
              textTransform: 'uppercase',
            }}
          >
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            if (!playerWon) {
              await resetToStartScreen();
              return;
            }

            if (!nextUp) {
              await resetToStartScreen();
              return;
            }

            if (verdictProgress !== progress) {
              saveProgress(verdictProgress);
              setProgress(verdictProgress);
            }

            // Best-effort AudioContext priming should never block case advance.
            void music.prime().catch(() => {
              // music will be silently disabled
            });
            try {
              await dispatch({ type: 'CreateSession', preferredPersona: nextUp });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('[CTA] CreateSession dispatch threw:', err);
            }
          }}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '11px',
            letterSpacing: '3px',
            background: 'var(--felt)',
            color: 'var(--bone)',
            border: '2px solid var(--amber-dim)',
            padding: '14px 28px',
            cursor: 'pointer',
            boxShadow: '4px 4px 0 0 var(--shadow)',
          }}
        >
          {ctaLabel}
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // §1.5 Strike-2 CSS dim: progressive intensification
  // -------------------------------------------------------------------------
  // On strike 2, apply a CSS filter to the root gameplay container to dim
  // ambient lighting and heighten tension. (Strike-3 viewport crack is a
  // spec stretch item — skipped per Day-5 time pressure.)
  const maxStrikes = Math.max(
    state.session?.self.strikes ?? 0,
    state.session?.opponent.strikes ?? 0,
  );
  const strike2DimStyle: React.CSSProperties =
    maxStrikes >= 2
      ? { filter: 'brightness(0.85) contrast(1.1)' }
      : {};

  // -------------------------------------------------------------------------
  // Render: active gameplay
  // -------------------------------------------------------------------------
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--wall)',
        ...strike2DimStyle,
      }}
    >
      <OverlayEffects />
      {/* H-I1: surface dispatch errors during active gameplay (previously silent) */}
      {state.error && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'rgba(0,0,0,0.75)',
            color: 'var(--coral)',
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '9px',
            padding: '8px 14px',
            letterSpacing: '1px',
            pointerEvents: 'none',
          }}
        >
          {state.error}
        </div>
      )}
      <Scene
        session={state.session}
        phase={state.phase}
        claimBubbleText={displayedText}
        claimBubbleIsDone={isDone}
      />
      <TopBar session={state.session} progress={progress} />
      <PlayerControls
        session={state.session}
        phase={state.phase}
        selectedIds={selectedCardIds}
        toggleSelection={toggleCardSelection}
        holdSpeakState={holdToSpeak.state}
        waveformData={holdToSpeak.waveformData}
        onStartSpeak={() => { holdToSpeak.start().catch(() => {}); }}
        onStopSpeak={() => { holdToSpeak.stop(); }}
        onAccept={() => {
          lastRespondActionRef.current = 'accept';
          showOutcomeForMs('accepted', 1500);
          dispatch({ type: 'PlayerRespond', action: 'accept' }).catch(() => {});
        }}
        onLiar={handleLiar}
      />

      {/* Day-5 Wave-2 joker / probe / autopsy UI — all stubs until agents fill. */}

      {/* JokerTray — always-visible bottom-bar tray of held jokers. */}
      {state.session?.self.jokerSlots && state.session.self.jokerSlots.length > 0 && (
        <JokerTray
          jokerSlots={state.session.self.jokerSlots}
          activeEffects={
            state.session.rounds[state.session.currentRoundIdx]?.activeJokerEffects ?? []
          }
          onActivate={(joker) => {
            void dispatch({ type: 'UseJoker', joker }).catch(() => {});
          }}
        />
      )}

      {/* JokerPicker — modal on joker-offer phase (round winner picks 1-of-3). */}
      {state.phase === 'joker-offer' && state.session?.currentOffer && (
        <JokerPicker
          offer={state.session.currentOffer}
          onPick={(joker) => {
            void dispatch({ type: 'PickJoker', joker }).catch(() => {});
          }}
        />
      )}

      {/* ProbeReveal — overlay when the current round has an active probe. */}
      {state.session?.rounds[state.session.currentRoundIdx]?.currentProbe && (
        <ProbeReveal
          probe={state.session.rounds[state.session.currentRoundIdx]!.currentProbe!}
        />
      )}

      {/* AutopsyOverlay — overlay when Earful has populated autopsy. */}
      {state.session?.autopsy && (
        <AutopsyOverlay autopsy={state.session.autopsy} />
      )}

      {/* STT readback + outcome banner — playtest fixes. */}
      <YouPlayedBanner text={lastPlayerClaimText} visible={youPlayedVisible} />
      <SpeechParseBanner
        parse={state.lastPlayerSpeechParse}
        visible={youPlayedVisible}
      />
      <ChallengeOutcomeBanner outcome={outcome} />

      {/* ClerkTutorial — 7-step annotated walkthrough, first session only.
          The hoisted `tutorial` prop is what we also use to gate AiAct above. */}
      <ClerkTutorial session={state.session} tutorial={tutorial} />
    </div>
  );
}
