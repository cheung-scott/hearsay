'use client';

import type { ClientSession } from '../../../lib/game/types';
import type { GamePhase } from '../../../hooks/useGameSession';
import type { HoldState } from './HoldToSpeak';
import { PlayerHand } from './PlayerHand';
import { HoldToSpeak } from './HoldToSpeak';
import { AcceptLiarButtons } from './AcceptLiarButtons';
import { YouWillCallBanner } from './YouWillCallBanner';

interface PlayerControlsProps {
  session: ClientSession;
  phase: GamePhase;
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  holdSpeakState: HoldState;
  waveformData: Uint8Array | null;
  onStartSpeak: () => void;
  onStopSpeak: () => void;
  onAccept: () => void;
  onLiar: () => void;
}

/**
 * Bottom-of-viewport layer composing the player's hand, hold-to-speak button,
 * and accept/liar buttons. z-index 30 keeps all controls above the scene.
 */
export function PlayerControls({
  session,
  phase,
  selectedIds,
  toggleSelection,
  holdSpeakState,
  waveformData,
  onStartSpeak,
  onStopSpeak,
  onAccept,
  onLiar,
}: PlayerControlsProps) {
  const interactive = phase === 'recording';
  const acceptLiarVisible = phase === 'awaiting-player-response';
  const round = session.rounds[session.currentRoundIdx];
  const targetRank = round?.targetRank ?? 'Queen';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'none',
      }}
    >
      {/* All interactive children re-enable pointer events */}
      <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto' }}>
        <PlayerHand
          hand={session.self.hand}
          selectedIds={selectedIds}
          onToggle={toggleSelection}
          interactive={interactive}
        />
        {/* Live claim preview — clarifies that the rank you call is locked to
            the target rank (playtest fix). */}
        <YouWillCallBanner
          visible={phase === 'recording'}
          selectedCount={selectedIds.size}
          targetRank={targetRank}
        />
        <HoldToSpeak
          phase={phase}
          state={holdSpeakState}
          waveformData={waveformData}
          onStart={onStartSpeak}
          onStop={onStopSpeak}
        />
        <AcceptLiarButtons
          visible={acceptLiarVisible}
          onAccept={onAccept}
          onLiar={onLiar}
        />
      </div>
    </div>
  );
}
