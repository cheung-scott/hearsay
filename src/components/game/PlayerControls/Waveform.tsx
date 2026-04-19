'use client';

import { useEffect, useRef } from 'react';

interface WaveformProps {
  /** Live analyser frequency data. Null when not recording. */
  data: Uint8Array | null;
}

/**
 * Canvas bar-waveform renderer. Redraws whenever `data` changes. Uses amber
 * `var(--amber-hi)` bars on a transparent background. 200×40px.
 */
export function Waveform({ data }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!data || data.length === 0) return;

    const barWidth = canvas.width / data.length;
    // Resolve the CSS variable at runtime — fallback to a literal amber.
    const barColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--amber-hi')
        .trim() || '#ffc760';

    ctx.fillStyle = barColor;

    for (let i = 0; i < data.length; i++) {
      const normalized = data[i] / 255; // 0..1
      const barHeight = normalized * canvas.height;
      ctx.fillRect(
        i * barWidth,
        canvas.height - barHeight,
        Math.max(barWidth - 1, 1),
        barHeight,
      );
    }
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={40}
      style={{ display: 'block' }}
      aria-hidden
    />
  );
}
