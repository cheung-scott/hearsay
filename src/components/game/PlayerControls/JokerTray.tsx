'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Always-visible bottom-bar tray of the player's held jokers. Click a held
 * slot → onActivate(joker) dispatches UseJoker (already wired in GameSession).
 *
 * Visual contract (for implementer):
 * - Render each slot as a small card showing joker name/icon
 * - Dim slots whose state !== 'held' (consumed slots stay visible for autopsy)
 * - Glow slots whose type appears in `activeEffects` (currently firing)
 * - Ignore clicks on consumed / actively-firing slots
 * - On a held-slot click: fire onActivate(slot.joker)
 *
 * Props are frozen — the agent MUST NOT add new props or modify this interface
 * without returning NEEDS_SCOPE_EXPANSION to the orchestrator.
 */

import type { JokerType, ActiveJokerEffect, JokerSlot } from '@/lib/game/types';
import { JOKER_CATALOG } from '@/lib/jokers/catalog';

export interface JokerTrayProps {
  /** Player's held + consumed joker slots. Spec: joker-system §4. */
  jokerSlots: JokerSlot[];
  /** Effects currently active on the round. Used to glow firing slots. */
  activeEffects: ActiveJokerEffect[];
  /** Callback fired when a held slot is clicked. Wired to dispatch UseJoker. */
  onActivate: (joker: JokerType) => void;
}

export function JokerTray({ jokerSlots, activeEffects, onActivate }: JokerTrayProps) {
  if (jokerSlots.length === 0) return null;

  const firingTypes = new Set(activeEffects.map(e => e.type));

  return (
    <>
      <style>{`
        @keyframes jokerPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.3); opacity: 0.7; }
        }
      `}</style>
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'row',
        gap: '8px',
        alignItems: 'flex-end',
      }}
    >
      {jokerSlots.slice(0, 3).map((slot) => {
        const joker = JOKER_CATALOG[slot.joker];
        const isConsumed = slot.state === 'consumed';
        const isFiring = firingTypes.has(slot.joker);
        const isClickable = !isConsumed && !isFiring;

        const glowStyle = isFiring
          ? '0 0 12px 3px rgba(253,162,0,0.75), 0 0 24px 6px rgba(253,162,0,0.35), 3px 3px 0 0 var(--shadow, #0a1008)'
          : '3px 3px 0 0 var(--shadow, #0a1008)';

        return (
          <button
            key={`${slot.joker}-${slot.acquiredAt}`}
            data-joker={slot.joker}
            data-state={slot.state}
            data-firing={isFiring ? 'true' : 'false'}
            disabled={!isClickable}
            onClick={isClickable ? () => onActivate(slot.joker) : undefined}
            style={{
              width: '48px',
              height: '64px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '4px',
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '6px',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: isConsumed ? 'var(--amber-dim, #7a5c1e)' : 'var(--bone, #e8dcc8)',
              background: isConsumed
                ? 'rgba(13,31,23,0.5)'
                : isFiring
                  ? 'rgba(253,162,0,0.12)'
                  : 'rgba(13,31,23,0.92)',
              border: isFiring
                ? `2px solid var(--amber-hi, #ffc760)`
                : `2px solid var(${joker.accentVar}, var(--amber, #fda200))`,
              borderColor: isFiring
                ? 'var(--amber-hi, #ffc760)'
                : `var(${joker.accentVar}, var(--amber, #fda200))`,
              opacity: isConsumed ? 0.3 : 1,
              filter: isConsumed ? 'grayscale(1)' : 'none',
              cursor: isClickable ? 'pointer' : 'not-allowed',
              boxShadow: glowStyle,
              transition: 'box-shadow 0.2s ease, opacity 0.2s ease',
              userSelect: 'none',
              outline: 'none',
              lineHeight: 1.2,
            }}
          >
            {/* Accent pip */}
            <span
              style={{
                display: 'block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: `var(${joker.accentVar}, var(--amber, #fda200))`,
                opacity: isConsumed ? 0.4 : 1,
                flexShrink: 0,
              }}
            />
            {/* Joker name — tiny all-caps monospace */}
            <span
              style={{
                textAlign: 'center',
                wordBreak: 'break-word',
                lineHeight: 1.3,
                whiteSpace: 'pre-wrap',
              }}
            >
              {joker.name}
            </span>
            {/* Consumed X badge */}
            {isConsumed && (
              <span
                style={{
                  fontSize: '8px',
                  color: 'var(--coral, #e05a3a)',
                  lineHeight: 1,
                }}
              >
                ✕
              </span>
            )}
            {/* Firing pulse indicator */}
            {isFiring && (
              <span
                style={{
                  display: 'block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--amber-hi, #ffc760)',
                  boxShadow: '0 0 8px var(--amber-hi, #ffc760)',
                  animation: 'jokerPulse 1s ease-in-out infinite',
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
    </>
  );
}
