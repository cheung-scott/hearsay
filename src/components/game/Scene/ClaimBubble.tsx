'use client';

import { useIsMobile } from '../../../hooks/useIsMobile';

interface ClaimBubbleProps {
  /**
   * Characters already revealed by the parent's `useTypewriter` call.
   * Each character is wrapped in a `.claim-char` span with `char-pop` animation.
   */
  displayedText: string;
  /** True once the typewriter has finished revealing the full string. */
  isDone: boolean;
  /**
   * When false the entire component returns null. Parent derives this from
   * the current phase (visible during `playing-ai-audio` and
   * `awaiting-player-response`).
   */
  visible: boolean;
}

/** Returns null when not visible — parent controls phase-gated rendering. */
export function ClaimBubble({ displayedText, isDone, visible }: ClaimBubbleProps) {
  const isMobile = useIsMobile();
  if (!visible) return null;

  return (
    <>
      {/* Speech-trail dots — hidden on mobile (bubble sits below the character
          instead of beside, so a left-to-right dot trail no longer makes sense).
          On desktop, dots lead from the character toward the speech bubble. */}
      {!isMobile && (
      <div
        className="speech-trail"
        style={{
          position: 'absolute',
          top: '28%',
          left: 'calc(50% + 60px)',
          width: '100px',
          height: '20px',
          pointerEvents: 'none',
          zIndex: 11,
        }}
      >
        {/* Dot 1 */}
        <div
          style={{
            position: 'absolute',
            left: '18px',
            top: '2px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--amber)',
            boxShadow: '0 0 8px var(--amber)',
            opacity: 0.6,
            animation: 'dot-pulse 1.3s infinite',
          }}
        />
        {/* Dot 2 */}
        <div
          style={{
            position: 'absolute',
            left: '54px',
            top: '10px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--amber)',
            boxShadow: '0 0 8px var(--amber)',
            opacity: 0.6,
            animation: 'dot-pulse 1.3s infinite 0.4s',
          }}
        />
        {/* Dot 3 */}
        <div
          style={{
            position: 'absolute',
            left: '90px',
            top: '4px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--amber)',
            boxShadow: '0 0 8px var(--amber)',
            opacity: 0.6,
            animation: 'dot-pulse 1.3s infinite 0.8s',
          }}
        />
        {/* Dot 4 */}
        <div
          style={{
            position: 'absolute',
            left: '108px',
            top: '14px',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--amber)',
            boxShadow: '0 0 8px var(--amber)',
            opacity: 0.6,
            animation: 'dot-pulse 1.3s infinite 1.2s',
          }}
        />
      </div>
      )}

      {/* Main bubble — DESKTOP: pinned 20px past the right edge of the 240px
          portrait at mouth height so it reads as speech emerging from him.
          MOBILE: centred below the smaller portrait, max 86vw wide, wraps
          text so long claims don't overflow a narrow viewport. */}
      <div
        className="claim-bubble"
        style={{
          position: 'absolute',
          top: isMobile ? '44%' : '27%',
          left: isMobile ? '50%' : 'calc(50% + 140px)',
          transform: isMobile ? 'translateX(-50%)' : undefined,
          maxWidth: isMobile ? '86vw' : undefined,
          zIndex: 12,
          background: 'var(--navy)',
          border: '3px solid var(--amber-hi, #ffc760)',
          padding: isMobile ? '10px 14px' : '14px 22px',
          fontFamily: '"Press Start 2P", monospace',
          fontSize: isMobile ? '10px' : '15px',
          letterSpacing: isMobile ? '1px' : '2px',
          lineHeight: 1.4,
          color: 'var(--amber-hi, #ffc760)',
          boxShadow: '4px 4px 0 0 var(--shadow), 0 0 36px rgba(253,162,0,0.5)',
          whiteSpace: isMobile ? 'normal' : 'nowrap',
          minHeight: '40px',
          display: 'flex',
          alignItems: 'center',
          textAlign: isMobile ? 'center' : 'left',
          textShadow: '0 1px 0 rgba(0,0,0,0.8)',
        }}
      >
        {displayedText.split('').map((ch, i) => (
          <span
            key={i}
            className="claim-char"
            style={{ display: 'inline-block', animation: 'char-pop 0.15s ease-out' }}
          >
            {ch === ' ' ? '\u00A0' : ch}
          </span>
        ))}
        {/* Cursor — hidden after typewriter completes */}
        {!isDone && (
          <span
            className="cursor"
            style={{
              display: 'inline-block',
              width: '10px',
              height: '18px',
              background: 'var(--amber-hi, #ffc760)',
              marginLeft: '4px',
              verticalAlign: 'middle',
              animation: 'blink-cursor 0.9s infinite',
            }}
          />
        )}
      </div>
    </>
  );
}
