'use client';

/**
 * Day-5 Wave-5 — Live Clerk tutorial overlay.
 *
 * Renders a 7-step annotated walkthrough on the player's first session.
 * Uses pre-generated MP3s at /sfx/tutorial/step-{1..7}.mp3 (NOT live TTS).
 * The localStorage flag `hearsay-tutorial-seen` gates returning players.
 *
 * POSITIONING: the bubble is contextual per step — it anchors near its
 * arrow target so the player sees label-then-element. Steps without
 * targets (1, 5, 7) render centred.
 *
 * Props are FROZEN — do not rename fields.
 *
 * TODO: Swap the placeholder sprite div for:
 *   <img src="/images/personas/clerk.png" alt="The Clerk" />
 *   once Scott generates the Clerk portrait asset.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientSession } from '@/lib/game/types';
import { useTutorial, type TutorialState } from '@/hooks/useTutorial';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { ClerkSprite } from './ClerkSprite';

export interface ClerkTutorialProps {
  /** Current client session — tutorial observes state transitions. */
  session: ClientSession | null;
  /** Optional callback when tutorial completes or is skipped. */
  onComplete?: () => void;
  /**
   * Optional externally-owned tutorial state. If provided, the component uses
   * it instead of creating its own `useTutorial(session)`. Lets parents hoist
   * the hook so they can also gate game logic on `tutorial.active`.
   */
  tutorial?: TutorialState;
}

// ---------------------------------------------------------------------------
// Step text (FINAL LOCKED LINES)
// ---------------------------------------------------------------------------

const STEP_TEXT: Record<number, string> = {
  1: 'Court is in session. Before your trial, let me brief you on the rules.',
  2: 'The rank called each round is here.',
  3: 'Tap one or two cards from your hand. A HOLD TO SPEAK button will appear — press and hold it, then call "one queen" or "two queens" (or whatever rank the court is demanding). The rank is locked each round, but the cards you actually play can be anything. Tell the truth, or bluff. The defendant will listen to your voice and decide whether to believe you.',
  4: 'Win by emptying your hand, or by catching him in three lies. If YOU get caught bluffing, you take a strike — three strikes and you lose the session.',
  5: 'The defendant just made his claim. Listen for the tells. Do you believe him?',
  6: 'Well played. Keep winning rounds to advance through the court.',
  7: 'Court is now in recess. Good luck.',
};

// ---------------------------------------------------------------------------
// Per-step DOM targets (for arrow rendering + contextual bubble placement).
// Order matters: first selector that matches wins.
// ---------------------------------------------------------------------------

const STEP_TARGET_SELECTOR: Record<number, string | null> = {
  1: null, // centred — no arrow
  2: "[data-testid='target-rank-tag'], .target-tag",
  3: "[data-testid='hold-to-speak']",
  4: "[data-testid='strikes-row'], .strikes",
  5: null, // centred — claim bubble already on screen
  6: "[data-testid='joker-tray']",
  7: null, // centred
};

// ---------------------------------------------------------------------------
// Per-step bubble anchor. "center" puts it centred on the viewport; otherwise
// we anchor near the target's side and let the arrow span the gap. The
// anchor strings are resolved at render time from the measured target rect.
// ---------------------------------------------------------------------------

type BubbleAnchor =
  | { kind: 'center' }
  | { kind: 'below-target' }
  | { kind: 'above-target' };

const STEP_ANCHOR: Record<number, BubbleAnchor> = {
  1: { kind: 'center' },
  2: { kind: 'below-target' },   // TargetTag sits at top-left of HUD
  3: { kind: 'above-target' },   // HoldToSpeak button sits at ~bottom 30%
  4: { kind: 'below-target' },   // StrikeCounter sits at top-right of HUD
  5: { kind: 'center' },
  6: { kind: 'above-target' },   // JokerTray sits at bottom-left
  7: { kind: 'center' },
};

// ---------------------------------------------------------------------------
// Bubble dimensions (approximate — used to lay out anchor + arrow).
// ---------------------------------------------------------------------------

const BUBBLE_MAX_WIDTH = 320;
const BUBBLE_GAP_PX = 18; // gap between bubble and target edge

// ---------------------------------------------------------------------------
// Arrow SVG helper
// ---------------------------------------------------------------------------

interface ArrowProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

function TutorialArrow({ fromX, fromY, toX, toY }: ArrowProps) {
  return (
    <svg
      data-testid="tutorial-arrow"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1001,
      }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="tutorial-arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L0,8 L10,4 z" fill="var(--amber-hi, #f5c842)" />
        </marker>
      </defs>
      <line
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke="var(--amber-hi, #f5c842)"
        strokeWidth="3"
        strokeDasharray="6 4"
        markerEnd="url(#tutorial-arrowhead)"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Preload all 7 tutorial MP3s at import time so first play() is instant.
// Guarded for SSR + test environments (no window).
// ---------------------------------------------------------------------------

let _preloaded = false;
function preloadTutorialAudio() {
  if (_preloaded) return;
  if (typeof window === 'undefined') return;
  _preloaded = true;
  try {
    for (let i = 1; i <= 7; i++) {
      const a = new Audio();
      a.preload = 'auto';
      a.src = `/sfx/tutorial/step-${i}.mp3`;
      // Touch a load — most browsers will start buffering on assignment,
      // but calling load() makes it explicit.
      a.load();
    }
  } catch {
    // Swallow — preload is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ClerkTutorial({ session, onComplete, tutorial }: ClerkTutorialProps) {
  // Unconditionally call the internal hook so React's hook order is stable;
  // ignore its return value when an external `tutorial` prop is provided.
  const internal = useTutorial(tutorial ? null : session);
  const { step, active, advance, skip } = tutorial ?? internal;
  const audio = useAudioPlayer();

  // Preload MP3s once on first mount.
  useEffect(() => {
    preloadTutorialAudio();
  }, []);

  // Track which step's audio has been kicked off so we don't double-play.
  const audioStepRef = useRef<number>(0);
  const [audioEnded, setAudioEnded] = useState(false);

  // Bubble anchor position (resolved per step after target measurement).
  const [bubblePos, setBubblePos] = useState<{
    top: number;
    left: number;
    transform?: string;
  } | null>(null);
  const [arrowCoords, setArrowCoords] = useState<{
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);

  const bubbleRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Audio: play step's MP3 when step changes + becomes active.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active || step === 0) return;
    if (audioStepRef.current === step) return;

    audioStepRef.current = step;
    setAudioEnded(false);

    audio.onEnded(() => {
      setAudioEnded(true);
    });
    audio.play(`/sfx/tutorial/step-${step}.mp3`);
  }, [step, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Reset audio guard whenever we go inactive (e.g. pending state between
  // steps, or skip), so the next activation replays audio cleanly.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active) {
      audioStepRef.current = 0;
      setAudioEnded(false);
    }
  }, [active]);

  // ---------------------------------------------------------------------------
  // Layout: resolve target, compute bubble anchor + arrow endpoints.
  // Re-runs on step change AND on window resize, AND retries briefly if the
  // target isn't in the DOM yet (newly-mounted elements).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!active) {
      setBubblePos(null);
      setArrowCoords(null);
      return;
    }

    const anchor = STEP_ANCHOR[step] ?? { kind: 'center' };
    const selector = STEP_TARGET_SELECTOR[step];

    const centerFallback = () => {
      setBubblePos({
        top: window.innerHeight / 2,
        left: window.innerWidth / 2,
        transform: 'translate(-50%, -50%)',
      });
      setArrowCoords(null);
    };

    const compute = (allowFallback: boolean) => {
      // Centred placement — no target needed.
      if (anchor.kind === 'center' || !selector) {
        centerFallback();
        return true;
      }

      // Target-anchored placement.
      const selectors = selector.split(',').map(s => s.trim());
      let target: Element | null = null;
      for (const sel of selectors) {
        target = document.querySelector(sel);
        if (target) break;
      }
      if (!target) {
        if (allowFallback) {
          // After retries exhaust, fall back to center so the bubble still
          // renders instead of being stuck off-screen / invisible.
          centerFallback();
          return true;
        }
        return false;
      }

      const tRect = target.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Desired bubble position relative to target.
      let top: number;
      let left: number;
      let transform = 'translateX(-50%)';

      const targetCenterX = tRect.left + tRect.width / 2;

      if (anchor.kind === 'below-target') {
        top = tRect.bottom + BUBBLE_GAP_PX;
        left = targetCenterX;
      } else {
        // above-target
        top = tRect.top - BUBBLE_GAP_PX;
        left = targetCenterX;
        transform = 'translate(-50%, -100%)';
      }

      // Clamp horizontally to keep bubble on-screen.
      const halfW = BUBBLE_MAX_WIDTH / 2;
      if (left - halfW < 16) left = halfW + 16;
      if (left + halfW > vw - 16) left = vw - halfW - 16;
      // Clamp vertically too.
      if (top < 16) top = 16;
      if (top > vh - 16) top = vh - 16;

      setBubblePos({ top, left, transform });

      // Arrow endpoints — derive from the bubble position we just set (no
      // need to measure the DOM; rAF-on-commit was unreliable under HMR /
      // backgrounded tabs). We know the bubble's center-x = `left` and its
      // edge closest to the target is `top` (below-target) or `top` again
      // when transform is translate(-50%,-100%) — the visual bottom edge.
      // Arrow starts at the bubble edge nearest the target and ends just
      // inside the target edge nearest the bubble.
      //   below-target: bubble is BELOW target → arrow goes UP from bubble.top
      //                 (= `top`) to target.bottom.
      //   above-target: bubble is ABOVE target (translateY -100%, so the
      //                 visual bottom edge aligns with the CSS `top` value)
      //                 → arrow goes DOWN from that edge to target.top.
      const fromX = left;
      const fromY = top;
      const toX = targetCenterX;
      const toY = anchor.kind === 'below-target'
        ? tRect.bottom - 4
        : tRect.top + 4;
      setArrowCoords({ fromX, fromY, toX, toY });
      return true;
    };

    // First attempt — fall back to center immediately if target missing so
    // the bubble renders right away (arrow may appear on a retry).
    compute(true);

    // Retry for up to 1s in case target mounts late — upgrades from
    // centre-fallback to proper target-anchored placement.
    let retries = 0;
    const interval = window.setInterval(() => {
      retries += 1;
      // Don't allow fallback on retries — let the real target take over if
      // / when it mounts. After retries exhaust we already have the fallback.
      if (compute(false) || retries > 10) {
        window.clearInterval(interval);
      }
    }, 100);

    // Re-compute on resize.
    const onResize = () => { compute(true); };
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [step, active]);

  // ---------------------------------------------------------------------------
  // onComplete callback when tutorial deactivates AND reaches terminal state.
  // ---------------------------------------------------------------------------
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current !== 0 && step === 0 && onComplete) {
      onComplete();
    }
    prevStepRef.current = step;
  }, [step, onComplete]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleAdvance = useCallback(() => {
    advance();
  }, [advance]);

  const handleSkip = useCallback(() => {
    skip();
  }, [skip]);

  // ---------------------------------------------------------------------------
  // Don't render when inactive (includes pending states).
  // ---------------------------------------------------------------------------
  if (!active || !bubblePos) return null;

  const stepText = STEP_TEXT[step] ?? '';
  const gotItEnabled = audioEnded || !audio.isPlaying;

  return (
    <>
      {/* Dim backdrop — pointer-events: none so gameplay stays interactive
          (the overlay is illustrative; AI-turn gating in GameSession is what
          actually pauses the game while tutorial is visible). */}
      <div
        data-testid="tutorial-backdrop"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          zIndex: 1000,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* SVG arrow overlay (only when we have coords) */}
      {arrowCoords && <TutorialArrow {...arrowCoords} />}

      {/* Speech bubble — positioned per step anchor. Mobile: cap at 92vw so the
          bubble never overflows the viewport regardless of the locked 320px max. */}
      <div
        ref={bubbleRef}
        data-testid="tutorial-bubble"
        style={{
          position: 'fixed',
          top: `${bubblePos.top}px`,
          left: `${bubblePos.left}px`,
          transform: bubblePos.transform ?? 'translateX(-50%)',
          maxWidth: `min(${BUBBLE_MAX_WIDTH}px, 92vw)`,
          background: 'var(--bone, #f0e8d0)',
          color: 'var(--wall, #1a1209)',
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '9px',
          lineHeight: '1.7',
          padding: '14px',
          border: '2px solid var(--amber-hi, #f5c842)',
          boxShadow: '4px 4px 0 0 var(--shadow, rgba(0,0,0,0.5))',
          letterSpacing: '0.5px',
          zIndex: 1002,
          pointerEvents: 'auto',
        }}
      >
        {/* Clerk sprite + step badge row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <ClerkSprite size={32} showLabel />
          <div
            style={{
              fontSize: '7px',
              color: 'var(--amber-hi, #c8a030)',
              letterSpacing: '1px',
            }}
          >
            THE CLERK · [{step}/7]
          </div>
        </div>

        <p
          data-testid="tutorial-step-text"
          style={{ margin: '0 0 14px 0' }}
        >
          {stepText}
        </p>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            data-testid="tutorial-skip"
            onClick={handleSkip}
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '7px',
              letterSpacing: '1px',
              background: 'transparent',
              color: 'var(--bone-dim, #8a7a55)',
              border: '1px solid var(--bone-dim, #8a7a55)',
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            Skip All
          </button>
          <button
            data-testid="tutorial-got-it"
            onClick={handleAdvance}
            disabled={!gotItEnabled}
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '8px',
              letterSpacing: '1px',
              background: gotItEnabled
                ? 'var(--persona-prosecutor, #8b1a1a)'
                : 'var(--bone-dim, #a09070)',
              color: 'var(--bone, #f0e8d0)',
              border: 'none',
              padding: '8px 14px',
              cursor: gotItEnabled ? 'pointer' : 'default',
              opacity: gotItEnabled ? 1 : 0.6,
              transition: 'opacity 0.2s',
            }}
          >
            {step === 7 ? 'Dismiss' : 'Got it →'}
          </button>
        </div>
      </div>
    </>
  );
}
