import { useState, useRef, useCallback, useEffect } from 'react';

export function useAudioPlayer(): {
  play: (url: string) => void;
  isPlaying: boolean;
  onEnded: (cb: () => void) => void;
} {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // One-shot callback ref — cleared after firing.
  const onEndedCallbackRef = useRef<(() => void) | null>(null);

  // Ensure audio element is created lazily and cleaned up on unmount.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const play = useCallback((url: string) => {
    if (!audioRef.current) {
      try {
        const audio = new Audio();
        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          const cb = onEndedCallbackRef.current;
          onEndedCallbackRef.current = null;
          cb?.();
        });
        audioRef.current = audio;
      } catch {
        // Environment (test / SSR) can't construct Audio — fire onEnded so
        // downstream state machines don't deadlock.
        setIsPlaying(false);
        const cb = onEndedCallbackRef.current;
        onEndedCallbackRef.current = null;
        cb?.();
        return;
      }
    }

    audioRef.current.src = url;
    // Set isPlaying(true) optimistically, then on autoplay-policy rejection or
    // bad-URL error: clear isPlaying AND fire the onEnded callback so any
    // downstream state machines (e.g. typewriter, derivePhase) can advance
    // rather than deadlocking waiting for an 'ended' event that will never fire.
    setIsPlaying(true);
    // Some jsdom mocks return undefined from play() rather than a Promise —
    // guard so we don't throw "Cannot read properties of undefined".
    let p: Promise<void> | undefined;
    try {
      p = audioRef.current.play() as Promise<void> | undefined;
    } catch {
      p = undefined;
    }
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        setIsPlaying(false);
        const cb = onEndedCallbackRef.current;
        onEndedCallbackRef.current = null;
        cb?.();
      });
    }
  }, []);

  const onEnded = useCallback((cb: () => void) => {
    onEndedCallbackRef.current = cb;
  }, []);

  return { play, isPlaying, onEnded };
}
