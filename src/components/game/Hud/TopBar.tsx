'use client';

import type { ClientSession } from '../../../lib/game/types';
import { JOKER_CATALOG } from '../../../lib/jokers/catalog';
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
 *
 * Wave-5 A1: Below the main row, renders an "ACTIVE POWERS" chip row when
 * `round.activeJokerEffects` is non-empty — one chip per unique joker type.
 */
export function TopBar({ session }: TopBarProps) {
  const round = session.rounds[session.currentRoundIdx];
  const roundNumber = (round?.roundNumber ?? 1) as 1 | 2 | 3;
  const targetRank = round?.targetRank ?? 'Queen';
  const strikes = session.self.strikes;
  const roundsWon = session.self.roundsWon;
  const opponentRoundsWon = session.opponent.roundsWon;
  const roundsLost = opponentRoundsWon;

  // Dedupe active joker effects by type.
  const activeEffects = round?.activeJokerEffects ?? [];
  const uniqueActiveTypes = Array.from(new Set(activeEffects.map(e => e.type)));

  return (
    <div
      className="top-bar"
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        right: '16px',
        zIndex: 25,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Main HUD row */}
      <div
        style={{
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

      {/* Active powers row — only rendered when effects are present */}
      {uniqueActiveTypes.length > 0 && (
        <>
          <style>{`
            @keyframes topBarActivePulse {
              0%, 100% { box-shadow: 2px 2px 0 0 var(--shadow, #0a1008); }
              50% { box-shadow: 2px 2px 0 0 var(--shadow, #0a1008), 0 0 8px 2px currentColor; }
            }
          `}</style>
          <div
            data-testid="active-powers-row"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: '6px',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                color: 'var(--bone, #e8dcc8)',
                opacity: 0.6,
                userSelect: 'none',
              }}
            >
              ACTIVE
            </span>
            {uniqueActiveTypes.map(type => {
              const joker = JOKER_CATALOG[type];
              return (
                <span
                  key={type}
                  data-testid={`active-joker-chip-${type}`}
                  data-accent-var={joker.accentVar}
                  style={{
                    fontFamily: '"Press Start 2P", monospace',
                    fontSize: '6px',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    color: `var(${joker.accentVar}, var(--amber, #fda200))`,
                    background: 'rgba(13,31,23,0.7)',
                    border: `2px solid var(${joker.accentVar}, var(--amber, #fda200))`,
                    padding: '2px 5px',
                    boxShadow: '2px 2px 0 0 var(--shadow, #0a1008)',
                    animation: 'topBarActivePulse 1.5s ease-in-out infinite',
                    userSelect: 'none',
                    lineHeight: 1.4,
                  }}
                >
                  {joker.name.toUpperCase()}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
