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
  loadProgress,
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

// ---------------------------------------------------------------------------
// §1.5 Elimination-Beat constants
// ---------------------------------------------------------------------------

/** 400ms linear ramp for silent-beat duck (spec §1.5 LOCK). */
const SILENT_BEAT_DUCK_MS = 400;
/** Dead-air duration before cards flip on every challenge reveal. */
const SILENT_BEAT_DURATION_MS = 2000;
/** Delay between stinger end and per-persona final-words clip. */
const FINAL_WORDS_DELAY_MS = 1000;

/** Maps AI persona → pre-generated final-words clip path. */
const FINAL_WORDS_URLS: Record<Persona, string> = {
  Novice:      '/sfx/final-words/novice.mp3',
  Reader:      '/sfx/final-words/reader.mp3',
  Misdirector: '/sfx/final-words/misdirector.mp3',
  Silent:      '/sfx/final-words/silent.mp3',
};

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
  const holdToSpeak = useHoldToSpeak();

  // -------------------------------------------------------------------------
  // Gauntlet progression (Option B — localStorage)
  // -------------------------------------------------------------------------
  const [progress, setProgress] = useState<GauntletProgress>(() => loadProgress());
  // Ref guard: tracks session id for which we've already saved a gauntlet win,
  // to ensure the save-on-win effect fires exactly once per session_over.
  const gauntletWinFiredRef = useRef<string | null>(null);

  // Derive the preferred persona for the next CreateSession call.
  const preferredPersona = nextPersona(progress) ?? undefined;

  // Typewriter: 110 ms per char per DESIGN-DECISIONS.md §8.
  const { displayedText, isDone } = useTypewriter(state.lastClaimText ?? '', 110);

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

  // When a new TTS audio URL arrives, play it and register a combined onEnded
  // callback (markAudioEnded for FSM phase advance + restoreFromOutput for music).
  useEffect(() => {
    if (state.lastClaimAudioUrl) {
      audioPlayer.onEnded(() => {
        markAudioEnded();
        if (musicEnabled) music.restoreFromOutput();
      });
      audioPlayer.play(state.lastClaimAudioUrl);
    }
    // audioPlayer and markAudioEnded are stable refs — intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastClaimAudioUrl]);

  // Auto-trigger AI's turn when it's their move. Without this, rounds where
  // activePlayer starts as 'ai' hang in 'awaiting-ai' forever because the
  // server chains AI judgment inside PlayerClaim but has no AI-first pathway.
  useEffect(() => {
    if (state.phase === 'awaiting-ai') {
      dispatch({ type: 'AiAct' }).catch(() => { /* error surfaces via state.error */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

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
  // session.opponent.personaIfAi — Scene does the lookup. This import is
  // retained for future top-bar merge (§10.5 pending).
  void PERSONA_DISPLAY_NAMES;

  // -------------------------------------------------------------------------
  // §1.5 Elimination-Beat: stinger + final-words on session_over
  // -------------------------------------------------------------------------
  // Track whether we've already fired the elimination-beat sequence for the
  // current session so we don't replay on re-renders.
  const eliminationFiredRef = useRef<string | null>(null);

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
    if (session.sessionWinner === 'player') {
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
    if (session.sessionWinner !== 'player') return;
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
  }, [state.phase, state.session?.id, state.session?.sessionWinner]);

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
    // Duck music for the silent beat (400ms linear ramp per spec §1.5 LOCK).
    if (musicEnabledRef.current) {
      musicRef.current.duckForOutput({ fadeMs: SILENT_BEAT_DUCK_MS });
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
            await music.prime().catch(() => { /* music will be silently disabled */ });
            await dispatch({ type: 'CreateSession', preferredPersona });
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
    const winner = state.session.sessionWinner;
    const playerWon = winner === 'player';

    // Gauntlet-complete override: all 4 opponents beaten → COURT ADJOURNED screen.
    if (isGauntletComplete(progress)) {
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
            color: playerWon ? 'var(--amber-hi)' : 'var(--coral)',
          }}
        >
          {playerWon ? 'CASE DISMISSED' : 'GUILTY'}
        </h1>
        <button
          onClick={async () => {
            // Prime AudioContext inside the user gesture (autoplay policy).
            await music.prime().catch(() => { /* music will be silently disabled */ });
            await dispatch({ type: 'CreateSession', preferredPersona });
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
          NEW TRIAL
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
        onAccept={() => { dispatch({ type: 'PlayerRespond', action: 'accept' }).catch(() => {}); }}
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
    </div>
  );
}
