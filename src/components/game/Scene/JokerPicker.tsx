'use client';

/**
 * Day-5 Wave-2 SCAFFOLD STUB — implement in parallel-fill agent.
 *
 * Modal overlay shown when phase === 'joker-offer' (between rounds, round
 * winner picks 1-of-N). Click one → onPick(joker) dispatches PickJoker.
 *
 * Visual contract (for implementer):
 * - Modal / overlay with dark backdrop (no dismiss-without-picking; the spec
 *   requires a pick to advance the FSM)
 * - Render `offer.offered[]` as 3 (or fewer on exhaustion tail) joker cards
 * - Each card: joker name, flavour text, click handler
 * - Highlight on hover; firm CTA on click
 *
 * Props are frozen — the agent MUST NOT add new props without returning
 * NEEDS_SCOPE_EXPANSION.
 */

import { useRef } from 'react';
import type { JokerType, JokerOffer } from '@/lib/game/types';
import { JOKER_CATALOG } from '@/lib/jokers/catalog';

export interface JokerPickerProps {
  /** The current offer shown to the round winner. Spec: joker-system §6.2. */
  offer: JokerOffer;
  /** Callback fired when the winner picks. Wired to dispatch PickJoker. */
  onPick: (joker: JokerType) => void;
}

export function JokerPicker({ offer, onPick }: JokerPickerProps) {
  // Guard: only offered lengths 1-3 are valid per spec §7.1.1
  const offered = offer.offered.slice(0, 3);

  // Prevent double-fire: track whether a pick has been made
  const pickedRef = useRef(false);

  function handlePick(joker: JokerType) {
    if (pickedRef.current) return;
    pickedRef.current = true;
    onPick(joker);
  }

  return (
    <div
      data-testid="joker-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Court Recess — Pick a Power"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(2px)',
        // Intentionally NO onClick on the backdrop — spec forbids dismiss
        // without picking. pointer-events-all so gameplay is fully blocked.
        pointerEvents: 'all',
      }}
    >
      {/* Dialog panel */}
      <div
        role="document"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          padding: '32px 28px',
          background: 'var(--felt, #1e3a2f)',
          border: '4px solid var(--amber-hi, #ffc760)',
          boxShadow: '4px 4px 0 0 var(--shadow, #050302), 0 0 40px rgba(253,199,96,0.18)',
          maxWidth: '680px',
          width: '90vw',
        }}
      >
        {/* Headline */}
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '10px',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: 'var(--amber-hi, #ffc760)',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          COURT RECESS
          <br />
          <span style={{ color: 'var(--bone, #f4ecd8)', fontSize: '8px' }}>
            PICK A POWER
          </span>
        </div>

        {/* Card row — 1, 2, or 3 cards */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          {offered.map((jokerType) => (
            <JokerCard
              key={jokerType}
              jokerType={jokerType}
              onPick={handlePick}
            />
          ))}
        </div>

        {/* Instructional sub-label */}
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '6px',
            color: 'var(--bone-dim, #c9bfa3)',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            textAlign: 'center',
            opacity: 0.6,
          }}
        >
          Choose one — no going back
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal card sub-component
// ---------------------------------------------------------------------------

interface JokerCardProps {
  jokerType: JokerType;
  onPick: (joker: JokerType) => void;
}

function JokerCard({ jokerType, onPick }: JokerCardProps) {
  const joker = JOKER_CATALOG[jokerType];

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(jokerType);
    }
  }

  return (
    <button
      data-joker={jokerType}
      aria-label={`Pick ${joker.name}: ${joker.flavor}`}
      onClick={() => onPick(jokerType)}
      onKeyDown={handleKeyDown}
      style={{
        width: '120px',
        minHeight: '180px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '10px',
        padding: '12px 8px',
        fontFamily: '"Press Start 2P", monospace',
        cursor: 'pointer',
        background: 'rgba(13,31,23,0.92)',
        border: `4px solid var(${joker.accentVar}, var(--amber-hi, #ffc760))`,
        boxShadow: `4px 4px 0 0 var(--shadow, #050302)`,
        color: 'var(--bone, #f4ecd8)',
        textAlign: 'center',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
        outline: 'none',
        userSelect: 'none',
        // CSS hover is handled via inline style; for JS environments, we keep
        // it simple. For richer hover we use onMouseEnter/Leave.
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'scale(1.05)';
        el.style.background = 'rgba(30,58,47,0.98)';
        el.style.boxShadow = `4px 4px 0 0 var(--shadow, #050302), 0 0 18px 4px var(${joker.accentVar}, rgba(255,199,96,0.5))`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'scale(1)';
        el.style.background = 'rgba(13,31,23,0.92)';
        el.style.boxShadow = `4px 4px 0 0 var(--shadow, #050302)`;
      }}
      onFocus={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'scale(1.05)';
        el.style.boxShadow = `4px 4px 0 0 var(--shadow, #050302), 0 0 0 2px var(${joker.accentVar}, var(--amber-hi, #ffc760))`;
      }}
      onBlur={(e) => {
        const el = e.currentTarget;
        el.style.transform = 'scale(1)';
        el.style.boxShadow = `4px 4px 0 0 var(--shadow, #050302)`;
      }}
    >
      {/* Accent pip */}
      <span
        style={{
          display: 'block',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: `var(${joker.accentVar}, var(--amber-hi, #ffc760))`,
          flexShrink: 0,
          boxShadow: `0 0 8px var(${joker.accentVar}, rgba(255,199,96,0.6))`,
        }}
      />

      {/* Joker name — bold all-caps */}
      <span
        data-testid={`card-name-${jokerType}`}
        style={{
          fontSize: '7px',
          fontWeight: 'bold',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: `var(${joker.accentVar}, var(--amber-hi, #ffc760))`,
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {joker.name}
      </span>

      {/* Divider */}
      <span
        style={{
          display: 'block',
          width: '80%',
          height: '1px',
          background: `var(${joker.accentVar}, var(--amber-dim, #8b5a0f))`,
          opacity: 0.4,
          flexShrink: 0,
        }}
      />

      {/* Flavor text */}
      <span
        data-testid={`card-flavor-${jokerType}`}
        style={{
          fontFamily: 'VT323, monospace',
          fontSize: '14px',
          color: 'var(--bone-dim, #c9bfa3)',
          lineHeight: 1.3,
          letterSpacing: '0.3px',
          wordBreak: 'break-word',
          flexGrow: 1,
        }}
      >
        {joker.flavor}
      </span>
    </button>
  );
}
