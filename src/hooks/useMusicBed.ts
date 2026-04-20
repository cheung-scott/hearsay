// useMusicBed — client hook for the tension music bed.
//
// Spec: .kiro/specs/tension-music-system/design.md §6.
//
// Responsibilities:
//   - Lazily create one AudioContext + two <audio>+GainNode pairs.
//   - prime() must await audioContext.resume() inside the user-gesture tick
//     (iOS Safari starts AudioContext suspended).
//   - duckForInput / duckForOutput / restore — anchored ramps over DUCK_FADE_MS.
//   - Cross-fade primary↔secondary on currentTensionLevel change (CROSSFADE_MS).
//   - DuckState machine handles concurrent input + output ducks without re-ramp.
//   - When `enabled === false`: no AudioContext is created; all API calls no-op.
//   - iOS Safari resume fallback on visibilitychange + pointerdown-once.
//
// What this hook does NOT do (intentional):
//   - Modify useAudioPlayer (one-shot onEnded re-registration is the caller's
//     responsibility via a wasPlayingRef pattern — see <GameSession>).
//   - Persist state to ClientSession (musicState lives on ClientSession but is
//     populated by the caller; the hook just reads `enabled`).

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MusicTrack } from '@/lib/game/types';
import {
  type TensionLevel,
  DUCK_FADE_MS,
  DUCK_GAIN,
  BASE_GAIN,
  CROSSFADE_MS,
} from '@/lib/music/tension';
import { getTrackUrl } from '@/lib/music/tracks';

export interface UseMusicBedArgs {
  tracks: MusicTrack[] | undefined;
  currentTensionLevel: TensionLevel;
  enabled: boolean;
  /**
   * R15.2 — fires when a track URL fails to load (404, network error, decode
   * fail). Caller typically flips `enabled` to false and surfaces the
   * music-disabled state. Without this, a 404 would silently produce a non-
   * playing primary and the spec invariant goes uncaught.
   */
  onTrackLoadError?: () => void;
}

export interface UseMusicBedAPI {
  /** MUST be called inside a user-gesture handler. Awaits ctx.resume() then primes both elements. Idempotent. */
  prime: () => Promise<void>;
  /** Lower volume for STT input (hold-to-speak press). */
  duckForInput: () => void;
  /** Lower volume for TTS output playback. Optional fadeMs override. */
  duckForOutput: (opts?: { fadeMs?: number }) => void;
  /** Restore full volume. Honors concurrent-duck state. */
  restoreFromInput: () => void;
  /** Restore full volume. Honors concurrent-duck state. */
  restoreFromOutput: () => void;
  /** Stop playback entirely (called on unmount). */
  stop: () => void;
  /** True only after a successful prime(). */
  isRunning: boolean;
}

type DuckState = 'idle' | 'ducked-for-input' | 'ducked-for-output' | 'ducked-for-both';

interface AudioPair {
  audio: HTMLAudioElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
}

interface AudioGraph {
  ctx: AudioContext;
  primary: AudioPair;
  secondary: AudioPair;
  /** Captured to remove on stop() so toggling enabled doesn't leak listeners. */
  errorListener: EventListener;
}

function buildAudioPair(ctx: AudioContext, dest: AudioNode): AudioPair {
  const audio = new Audio();
  audio.crossOrigin = 'anonymous';
  audio.loop = true;
  audio.preload = 'auto';
  const gain = ctx.createGain();
  gain.gain.value = 0; // start silent until cross-fade or initial set
  const source = ctx.createMediaElementSource(audio);
  source.connect(gain).connect(dest);
  return { audio, gain, source };
}

function anchoredRamp(gain: GainNode, target: number, fadeMs: number, ctx: AudioContext): void {
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + fadeMs / 1000);
}

export function useMusicBed(args: UseMusicBedArgs): UseMusicBedAPI {
  const { tracks, currentTensionLevel, enabled, onTrackLoadError } = args;

  // Stable ref for the error callback so the audio-element listener captures
  // the latest function without re-binding.
  const onTrackLoadErrorRef = useRef(onTrackLoadError);
  useEffect(() => { onTrackLoadErrorRef.current = onTrackLoadError; });

  const graphRef = useRef<AudioGraph | null>(null);
  const duckStateRef = useRef<DuckState>('idle');
  const lastLevelRef = useRef<TensionLevel | null>(null);
  const crossfadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);

  const [isRunning, setIsRunning] = useState(false);

  const ensureGraph = useCallback((): AudioGraph | null => {
    if (!enabled) return null;
    if (graphRef.current) return graphRef.current;

    if (typeof window === 'undefined') return null;
    const Ctor: typeof AudioContext | undefined =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor();
    const primary = buildAudioPair(ctx, ctx.destination);
    const secondary = buildAudioPair(ctx, ctx.destination);

    // R15.2 — wire load-error fallback on both elements. Captured on the graph
    // so stop() can remove it (toggling `enabled` would otherwise leak listeners
    // on each rebuild).
    const errorListener: EventListener = () => onTrackLoadErrorRef.current?.();
    primary.audio.addEventListener('error', errorListener);
    secondary.audio.addEventListener('error', errorListener);

    graphRef.current = { ctx, primary, secondary, errorListener };
    return graphRef.current;
  }, [enabled]);

  // --- prime ---------------------------------------------------------------
  const prime = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const graph = ensureGraph();
    if (!graph) return;

    // iOS Safari starts ctx in 'suspended'. resume() MUST be called inside the
    // user-gesture tick — that's the contract this method requires of callers.
    if (graph.ctx.state === 'suspended') {
      try { await graph.ctx.resume(); } catch { /* swallow — visibility fallback handles */ }
    }

    // Prime both elements by attempting play()/pause() inside the gesture.
    // Without this, Safari rejects later programmatic .play() with
    // NotAllowedError. play() on an empty src is a tolerated no-op.
    const initialUrl = getTrackUrl(tracks, currentTensionLevel);
    if (initialUrl && !graph.primary.audio.src) {
      graph.primary.audio.src = initialUrl;
    }
    await graph.primary.audio.play().catch(() => { /* empty-src or autoplay race */ });
    await graph.secondary.audio.play().catch(() => { /* primer attempt */ });
    try { graph.secondary.audio.pause(); } catch { /* noop */ }

    if (initialUrl) {
      anchoredRamp(graph.primary.gain, BASE_GAIN, DUCK_FADE_MS, graph.ctx);
      lastLevelRef.current = currentTensionLevel;
    }

    setIsRunning(true);
  }, [enabled, ensureGraph, tracks, currentTensionLevel]);

  // --- ducking -------------------------------------------------------------
  const applyDuck = useCallback(
    (fadeMs: number) => {
      const graph = graphRef.current;
      if (!graph || !isRunning) return;
      anchoredRamp(graph.primary.gain, DUCK_GAIN, fadeMs, graph.ctx);
    },
    [isRunning],
  );

  const applyRestore = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !isRunning) return;
    anchoredRamp(graph.primary.gain, BASE_GAIN, DUCK_FADE_MS, graph.ctx);
  }, [isRunning]);

  const duckForInput = useCallback(() => {
    if (!enabled) return;
    const cur = duckStateRef.current;
    if (cur === 'idle') {
      duckStateRef.current = 'ducked-for-input';
      applyDuck(DUCK_FADE_MS);
    } else if (cur === 'ducked-for-output') {
      duckStateRef.current = 'ducked-for-both';
      // already at DUCK_GAIN — no re-ramp
    }
    // ducked-for-input / ducked-for-both: no change
  }, [enabled, applyDuck]);

  const duckForOutput = useCallback(
    (opts?: { fadeMs?: number }) => {
      if (!enabled) return;
      const fadeMs = opts?.fadeMs ?? DUCK_FADE_MS;
      const cur = duckStateRef.current;
      if (cur === 'idle') {
        duckStateRef.current = 'ducked-for-output';
        applyDuck(fadeMs);
      } else if (cur === 'ducked-for-input') {
        duckStateRef.current = 'ducked-for-both';
      }
    },
    [enabled, applyDuck],
  );

  const restoreFromInput = useCallback(() => {
    if (!enabled) return;
    const cur = duckStateRef.current;
    if (cur === 'ducked-for-input') {
      duckStateRef.current = 'idle';
      applyRestore();
    } else if (cur === 'ducked-for-both') {
      duckStateRef.current = 'ducked-for-output';
      // still ducked for TTS — no ramp
    }
  }, [enabled, applyRestore]);

  const restoreFromOutput = useCallback(() => {
    if (!enabled) return;
    const cur = duckStateRef.current;
    if (cur === 'ducked-for-output') {
      duckStateRef.current = 'idle';
      applyRestore();
    } else if (cur === 'ducked-for-both') {
      duckStateRef.current = 'ducked-for-input';
    }
  }, [enabled, applyRestore]);

  // --- cross-fade on tension-level change ----------------------------------
  // Also fires on initial track-availability after prime (lastLevelRef === null).
  useEffect(() => {
    if (!enabled || !isRunning) return;
    const graph = graphRef.current;
    if (!graph) return;
    if (lastLevelRef.current === currentTensionLevel) return;

    const newUrl = getTrackUrl(tracks, currentTensionLevel);
    if (!newUrl) return; // missing track — keep current bed

    // Cancel any in-flight crossfade timer.
    if (crossfadeTimerRef.current) {
      clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }

    // First track ever: just load + ramp primary up. No cross-fade.
    if (lastLevelRef.current === null) {
      graph.primary.audio.src = newUrl;
      graph.primary.audio.play().catch(() => { /* autoplay race */ });
      anchoredRamp(graph.primary.gain, BASE_GAIN, DUCK_FADE_MS, graph.ctx);
      lastLevelRef.current = currentTensionLevel;
      return;
    }

    graph.secondary.audio.src = newUrl;
    graph.secondary.audio.play().catch(() => { /* autoplay race — give up silently */ });

    // Honor active duck state: if a voice moment is in flight, the incoming
    // secondary should land at DUCK_GAIN, not BASE_GAIN — otherwise the
    // 800ms cross-fade would audibly ride over the duck.
    const targetForSecondary =
      duckStateRef.current === 'idle' ? BASE_GAIN : DUCK_GAIN;

    // Dual ramp over CROSSFADE_MS.
    const now = graph.ctx.currentTime;
    graph.primary.gain.gain.cancelScheduledValues(now);
    graph.primary.gain.gain.setValueAtTime(graph.primary.gain.gain.value, now);
    graph.primary.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_MS / 1000);

    graph.secondary.gain.gain.cancelScheduledValues(now);
    graph.secondary.gain.gain.setValueAtTime(graph.secondary.gain.gain.value, now);
    graph.secondary.gain.gain.linearRampToValueAtTime(targetForSecondary, now + CROSSFADE_MS / 1000);

    crossfadeTimerRef.current = setTimeout(() => {
      const g = graphRef.current;
      if (!g) return;
      g.primary.audio.pause();
      // Swap labels — secondary is now primary.
      const oldPrimary = g.primary;
      g.primary = g.secondary;
      g.secondary = oldPrimary;
      crossfadeTimerRef.current = null;

      // Post-swap reconciliation: if the duck state changed DURING the crossfade
      // (e.g. user released hold mid-fade), the new primary may now be at the
      // wrong gain. Re-derive the target and correct via short ramp.
      const targetNow = duckStateRef.current === 'idle' ? BASE_GAIN : DUCK_GAIN;
      if (Math.abs(g.primary.gain.gain.value - targetNow) > 0.01) {
        anchoredRamp(g.primary.gain, targetNow, DUCK_FADE_MS, g.ctx);
      }
    }, CROSSFADE_MS);

    lastLevelRef.current = currentTensionLevel;
  }, [enabled, isRunning, tracks, currentTensionLevel]);

  // --- iOS Safari visibility/resume fallback -------------------------------
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const handler = () => {
      const graph = graphRef.current;
      if (!graph) return;
      if (document.visibilityState === 'visible' && graph.ctx.state === 'suspended') {
        graph.ctx.resume().catch(() => {
          // resume() can reject without a fresh gesture on recent Safari.
          // Wire a one-shot pointer fallback that retries.
          const retry = () => {
            graph.ctx.resume().catch(() => { /* give up — gameplay continues */ });
          };
          document.addEventListener('pointerdown', retry, { once: true });
        });
      }
    };
    visibilityHandlerRef.current = handler;
    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      visibilityHandlerRef.current = null;
    };
  }, [enabled]);

  // --- stop / unmount ------------------------------------------------------
  const stop = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (crossfadeTimerRef.current) {
      clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    // Pair the addEventListener from ensureGraph — prevents listener leak on
    // enabled toggle cycles.
    try {
      graph.primary.audio.removeEventListener('error', graph.errorListener);
      graph.secondary.audio.removeEventListener('error', graph.errorListener);
    } catch { /* noop */ }
    try { graph.primary.audio.pause(); } catch { /* noop */ }
    try { graph.secondary.audio.pause(); } catch { /* noop */ }
    graph.ctx.close().catch(() => { /* noop */ });
    graphRef.current = null;
    setIsRunning(false);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disabling at runtime tears down. (Re-enabling requires a fresh prime gesture.)
  useEffect(() => {
    if (!enabled) {
      stop();
    }
  }, [enabled, stop]);

  return {
    prime,
    duckForInput,
    duckForOutput,
    restoreFromInput,
    restoreFromOutput,
    stop,
    isRunning,
  };
}
