'use client';

import type { ClientSession } from '../../../lib/game/types';
import type { GamePhase } from '../../../hooks/useGameSession';
import { PERSONA_DISPLAY_NAMES } from '../../../lib/persona/displayNames';
import { Room } from './Room';
import { RoundTable } from './RoundTable';
import { Opponent } from './Opponent';
import { ClaimBubble } from './ClaimBubble';
import { Pile } from './Pile';

interface SceneProps {
  session: ClientSession;
  phase: GamePhase;
  /** Characters already revealed by the parent's `useTypewriter`. */
  claimBubbleText: string;
  /** True once the typewriter has finished the full string. */
  claimBubbleIsDone: boolean;
}

/**
 * Perspective container that composes the full courtroom scene. Each child is
 * absolutely positioned per variant-d-across-table.html.
 */
export function Scene({ session, phase, claimBubbleText, claimBubbleIsDone }: SceneProps) {
  const round = session.rounds[session.currentRoundIdx];
  const opponentPersona = session.opponent.personaIfAi ?? 'Reader';
  const displayName = PERSONA_DISPLAY_NAMES[opponentPersona].toUpperCase();
  const claimBubbleVisible =
    phase === 'playing-ai-audio' || phase === 'awaiting-player-response';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <Room />
      <Opponent
        handSize={session.opponent.handSize}
        displayName={displayName}
        persona={opponentPersona}
      />
      <RoundTable />
      <ClaimBubble
        displayedText={claimBubbleText}
        isDone={claimBubbleIsDone}
        visible={claimBubbleVisible}
      />
      {round && (
        <Pile pileSize={round.pileSize} />
      )}
    </div>
  );
}
