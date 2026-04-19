'use client';

import '@/styles/game-theme.css';
import { useEffect } from 'react';
import { useGameSession } from '@/hooks/useGameSession';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useHoldToSpeak } from '@/hooks/useHoldToSpeak';
import { useTypewriter } from '@/hooks/useTypewriter';
import { PERSONA_DISPLAY_NAMES } from '@/lib/persona/displayNames';
import type { ClientSession } from '@/lib/game/types';
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

  // When a new TTS audio URL arrives, play it and register the onEnded callback.
  useEffect(() => {
    if (state.lastClaimAudioUrl) {
      audioPlayer.onEnded(markAudioEnded);
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
          onClick={() => dispatch({ type: 'CreateSession' })}
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
          onClick={() => dispatch({ type: 'CreateSession' })}
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
