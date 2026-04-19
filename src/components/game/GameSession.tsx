'use client';

import '@/styles/game-theme.css';
import { useEffect, useRef, useState } from 'react';
import { useGameSession } from '@/hooks/useGameSession';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useHoldToSpeak } from '@/hooks/useHoldToSpeak';
import { useTypewriter } from '@/hooks/useTypewriter';
import { useMusicBed } from '@/hooks/useMusicBed';
import { deriveTensionLevel } from '@/lib/music/tension';
import { hasAllTracks } from '@/lib/music/tracks';
import { PERSONA_DISPLAY_NAMES } from '@/lib/persona/displayNames';
import type { ClientSession, Session, MusicTrack } from '@/lib/game/types';
import { Scene } from './Scene/Scene';
import { TopBar } from './Hud/TopBar';
import { PlayerControls } from './PlayerControls/PlayerControls';
import { OverlayEffects } from './Scene/OverlayEffects';

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
  const holdToSpeak = useHoldToSpeak();

  // Typewriter: 110 ms per char per DESIGN-DECISIONS.md §8.
  const { displayedText, isDone } = useTypewriter(state.lastClaimText ?? '', 110);

  // -------------------------------------------------------------------------
  // Music bed (tension-music-system spec §6.5)
  // -------------------------------------------------------------------------

  // Local musicState — populated by pregen result. Lives on ClientSession.musicState
  // shape but kept in component state because the field is NOT projected by
  // toClientView (per types.ts L320 — populated client-side).
  const [musicDisabled, setMusicDisabled] = useState(false);
  const [userMuted] = useState(false); // mute toggle UX is owned by ui-gameplay phase 2
  const [pregenTracks, setPregenTracks] = useState<MusicTrack[]>([]);
  const pregenFiredRef = useRef<string | null>(null);

  // Derive a Session-shaped object for the tension function. The hook lives in
  // a ClientSession world, so we synthesize the minimal shape it needs.
  const tensionSessionLike: Session = state.session
    ? ({
        id: state.session.id,
        status: state.session.status,
        player: state.session.self,
        ai: { ...state.session.opponent, hand: [] },
        deck: [],
        rounds: [],
        currentRoundIdx: state.session.currentRoundIdx,
        musicTracks: [],
      } as Session)
    : ({
        id: '',
        status: 'setup',
        player: { hand: [], takenCards: [], roundsWon: 0, strikes: 0, jokers: [] },
        ai: { hand: [], takenCards: [], roundsWon: 0, strikes: 0, jokers: [] },
        deck: [],
        rounds: [],
        currentRoundIdx: 0,
        musicTracks: [],
      } as Session);

  // Prefer pregen response tracks (fresh URLs) over the session snapshot,
  // which started empty pre-pregen. The next session refetch will reconcile.
  const sessionMusicTracks =
    pregenTracks.length > 0 ? pregenTracks : (state.session?.musicTracks ?? []);

  const tracksReady = hasAllTracks(sessionMusicTracks);
  const musicEnabled = !musicDisabled && !userMuted && tracksReady;

  const music = useMusicBed({
    tracks: sessionMusicTracks,
    currentTensionLevel: deriveTensionLevel(tensionSessionLike),
    enabled: musicEnabled,
  });

  // Fire pregen once per fresh session.
  useEffect(() => {
    if (!state.session?.id) return;
    if (pregenFiredRef.current === state.session.id) return;
    pregenFiredRef.current = state.session.id;

    fetch('/api/music/pregen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.session.id }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { tracks: MusicTrack[] }) => {
        if (data.tracks?.length) {
          setPregenTracks(data.tracks);
        } else {
          setMusicDisabled(true);
        }
      })
      .catch(() => setMusicDisabled(true));
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
  const wasPlayingRef = useRef(false);
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
            await dispatch({ type: 'CreateSession' });
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
  // Render: session-over → NEW TRIAL CTA
  // -------------------------------------------------------------------------
  if (state.phase === 'session-over') {
    const winner = state.session.sessionWinner;
    const playerWon = winner === 'player';

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
            await dispatch({ type: 'CreateSession' });
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
  // Render: active gameplay
  // -------------------------------------------------------------------------
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--wall)',
      }}
    >
      <OverlayEffects />
      <Scene
        session={state.session}
        phase={state.phase}
        claimBubbleText={displayedText}
        claimBubbleIsDone={isDone}
      />
      <TopBar session={state.session} />
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
        onLiar={() => { dispatch({ type: 'PlayerRespond', action: 'challenge' }).catch(() => {}); }}
      />
    </div>
  );
}
