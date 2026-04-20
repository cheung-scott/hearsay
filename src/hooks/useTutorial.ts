/**
 * Day-5 Wave-5 — live Clerk tutorial state machine.
 *
 * Tracks the 7-step Clerk tutorial overlay. Observes ClientSession
 * transitions and reveals steps when gameplay triggers fire. Reads/writes
 * localStorage flag `hearsay-tutorial-seen` so returning players skip.
 *
 * STATE MACHINE (fixed — do NOT regress):
 *   Step 1: shown immediately at session start. User advance → step 2.
 *   Step 2: shown immediately. User advance → step 3.
 *   Step 3: shown immediately. User advance → step 4.
 *   Step 4: shown immediately. User advance → step 5 PENDING (hidden).
 *   Step 5: shown ONLY after first AI claim lands in claimHistory.
 *            User advance → step 6 PENDING (hidden).
 *   Step 6: shown ONLY after player wins their first round.
 *            User advance → step 7 (shown immediately).
 *   Step 7: shown immediately. User advance → step 0 + localStorage flag.
 *
 * While `pending === true`, `active === false` so the game plays freely.
 *
 * Return shape is FROZEN — do not rename fields.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClientSession } from '@/lib/game/types';

export type TutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TutorialState {
  /** 0 = inactive (already seen or skipped); 1-7 = current step. */
  step: TutorialStep;
  /** True while tutorial overlay should render. */
  active: boolean;
  /** Advance to the next step (user clicked "Got it →" or audio ended). */
  advance: () => void;
  /** Skip entire tutorial (set localStorage flag). */
  skip: () => void;
}

const STORAGE_KEY = 'hearsay-tutorial-seen';

export function useTutorial(session: ClientSession | null): TutorialState {
  // Step 0 = inactive; 1-7 = current step. Initial 0 → useEffect flips to 1
  // on first mount if localStorage flag is absent.
  const [step, setStep] = useState<TutorialStep>(0);
  // True when `step` is set but the gameplay trigger has not yet fired —
  // keeps overlay hidden so the game can play through.
  const [pending, setPending] = useState<boolean>(false);
  const initializedRef = useRef(false);
  // Trigger fire guards — each fires at most once per session instance.
  const step5TriggeredRef = useRef(false);
  const step6TriggeredRef = useRef(false);

  // SSR-safe init: check localStorage in useEffect (never at render).
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    try {
      const seen = typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY)
        : null;
      if (!seen) {
        setStep(1);
        setPending(false);
      }
    } catch {
      // Private mode / blocked — fall through; tutorial stays inactive.
    }
  }, []);

  // Observe session state. Fires step 5/6 triggers when their gameplay
  // conditions are met, *only* if the user has already advanced past the
  // prior step (step is waiting in "pending" state).
  useEffect(() => {
    if (!session) return;

    // Step 5 trigger: first AI claim appears in any round.
    if (!step5TriggeredRef.current) {
      const hasAiClaim = session.rounds.some(
        r => r.claimHistory.some(c => c.by === 'ai'),
      );
      if (hasAiClaim) {
        step5TriggeredRef.current = true;
        // Reveal step 5 only if user has advanced to it (step === 5 && pending).
        setStep(prev => {
          if (prev === 5) {
            setPending(false);
            return 5;
          }
          return prev;
        });
      }
    }

    // Step 6 trigger: player wins any round.
    if (!step6TriggeredRef.current) {
      const playerWonARound = session.rounds.some(r => r.winner === 'player');
      if (playerWonARound) {
        step6TriggeredRef.current = true;
        setStep(prev => {
          if (prev === 6) {
            setPending(false);
            return 6;
          }
          return prev;
        });
      }
    }
  }, [session]);

  const advance = useCallback(() => {
    setStep(prev => {
      if (prev === 0) return 0;
      if (prev >= 7) {
        // Terminal — mark as seen and deactivate.
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, '1');
          }
        } catch {
          // Swallow — fail closed.
        }
        setPending(false);
        return 0;
      }
      const next = (prev + 1) as TutorialStep;
      // Steps 5 and 6 are gated on gameplay triggers. If the trigger has
      // already fired, reveal immediately; otherwise go into pending state.
      if (next === 5) {
        setPending(!step5TriggeredRef.current);
      } else if (next === 6) {
        setPending(!step6TriggeredRef.current);
      } else {
        setPending(false);
      }
      return next;
    });
  }, []);

  const skip = useCallback(() => {
    // Jump to step 7 (final "Good luck" line) and reveal immediately.
    setStep(prev => (prev >= 1 && prev <= 6 ? 7 : prev));
    setPending(false);
  }, []);

  // Active = currently visible. Hidden while pending (between steps waiting
  // for gameplay triggers) and when step is 0 (inactive / done).
  const active = step >= 1 && step <= 7 && !pending;

  return { step, active, advance, skip };
}
