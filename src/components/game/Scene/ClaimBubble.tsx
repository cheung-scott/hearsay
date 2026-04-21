'use client';

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
  if (!visible) return null;

  return (
    <>
      {/* Speech-trail dots — anchored between the opponent's head and the
          bubble so the dots "lead" from the character toward the speech. */}
      <div
        className="speech-trail"
        style={{
          position: 'absolute',
          top: '21%',
          left: '56%',
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

      {/* Main bubble — anchored next to the opponent's head (right side of
          the portrait) so it reads as a speech bubble emerging from him,
          not a floating HUD card in the corner. */}
      <div
        className="claim-bubble"
        style={{
          position: 'absolute',
          top: '20%',
          left: '64%',
          zIndex: 12,
          background: 'var(--navy)',
          border: '3px solid var(--amber)',
          padding: '14px 22px',
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '15px',
          letterSpacing: '2px',
          color: 'var(--amber)',
          boxShadow: '4px 4px 0 0 var(--shadow), 0 0 36px rgba(253,162,0,0.5)',
          whiteSpace: 'nowrap',
          minHeight: '48px',
          display: 'flex',
          alignItems: 'center',
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
              background: 'var(--amber)',
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
