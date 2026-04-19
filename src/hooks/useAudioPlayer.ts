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
    audioRef.current.play().catch(() => {
      setIsPlaying(false);
    });
    setIsPlaying(true);
  }, []);

  const onEnded = useCallback((cb: () => void) => {
    onEndedCallbackRef.current = cb;
  }, []);

  return { play, isPlaying, onEnded };
}
