'use client';

import type { ClientSession } from '../../../lib/game/types';
import { TargetTag } from './TargetTag';
import { RoundPill } from './RoundPill';
import { StrikeCounter } from './StrikeCounter';
import { RoundsWonGavels } from './RoundsWonGavels';

interface TopBarProps {
  session: ClientSession;
}

/**
 * HUD top bar. Left: `<TargetTag/>`. Center: `<RoundPill/>`. Right: strike
 * counter stacked above rounds-won gavels. Matches `.top-bar` in variant-d.
 */
export function TopBar({ session }: TopBarProps) {
  const round = session.rounds[session.currentRoundIdx];
  const roundNumber = (round?.roundNumber ?? 1) as 1 | 2 | 3;
  const targetRank = round?.targetRank ?? 'Queen';
  const strikes = session.self.strikes;
  const roundsWon = session.self.roundsWon;
  const opponentRoundsWon = session.opponent.roundsWon;
  const roundsLost = opponentRoundsWon;

  return (
    <div
      className="top-bar"
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        right: '16px',
        zIndex: 25,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: '20px',
        alignItems: 'center',
      }}
    >
      <TargetTag rank={targetRank} />
      <RoundPill roundNumber={roundNumber} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <StrikeCounter strikes={strikes} />
        <RoundsWonGavels
          roundsWon={roundsWon}
          roundsLost={roundsLost}
          currentRound={roundNumber}
        />
      </div>
    </div>
  );
}
