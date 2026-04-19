import { useState, useEffect, useRef } from 'react';

export function useTypewriter(
  text: string,
  charDelayMs: number,
  onDone?: () => void,
): { displayedText: string; isDone: boolean } {
  const [displayedText, setDisplayedText] = useState('');
  const [isDone, setIsDone] = useState(false);
  // Latch: reset to false when text changes; set to true after onDone fires.
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    // Reset on every text change.
    setDisplayedText('');
    setIsDone(false);
    firedRef.current = false;

    if (text.length === 0) {
      setIsDone(true);
      if (!firedRef.current) {
        firedRef.current = true;
        onDone?.();
      }
      return;
    }

    let index = 0;

    const interval = setInterval(() => {
      index += 1;
      setDisplayedText(text.slice(0, index));

      if (index >= text.length) {
        clearInterval(interval);
        setIsDone(true);
        if (!firedRef.current) {
          firedRef.current = true;
          onDone?.();
        }
      }
    }, charDelayMs);

    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, charDelayMs]);

  return { displayedText, isDone };
}
