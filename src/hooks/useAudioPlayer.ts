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
      const audio = new Audio();
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        const cb = onEndedCallbackRef.current;
        onEndedCallbackRef.current = null;
        cb?.();
      });
      audioRef.current = audio;
    }

    audioRef.current.src = url;
    // Set isPlaying(true) optimistically, then on autoplay-policy rejection or
    // bad-URL error: clear isPlaying AND fire the onEnded callback so any
    // downstream state machines (e.g. typewriter, derivePhase) can advance
    // rather than deadlocking waiting for an 'ended' event that will never fire.
    setIsPlaying(true);
    audioRef.current.play().catch(() => {
      setIsPlaying(false);
      const cb = onEndedCallbackRef.current;
      onEndedCallbackRef.current = null;
      cb?.();
    });
  }, []);

  const onEnded = useCallback((cb: () => void) => {
    onEndedCallbackRef.current = cb;
  }, []);

  return { play, isPlaying, onEnded };
}
