'use client';

interface AcceptLiarButtonsProps {
  /** When false the component returns null (only visible in `awaiting-player-response`). */
  visible: boolean;
  onAccept: () => void;
  onLiar: () => void;
}

/**
 * Accept + Liar! button pair. Returns null when not `visible`. Positioned at
 * `bottom: 8%` per §10.4 locked default (overrides variant-d `bottom: 14px`).
 * Matches `.actions` / `.btn` / `.btn-challenge` class names.
 */
export function AcceptLiarButtons({ visible, onAccept, onLiar }: AcceptLiarButtonsProps) {
  if (!visible) return null;

  return (
    // §10.4: group Accept + Liar as a centered pair (24px gap) so they read as
    // a single binary choice rather than two unrelated edge-anchored actions.
    // Vertical position (`bottom: 8%`) stays locked per §10.4.
    <div
      className="actions"
      style={{
        position: 'absolute',
        bottom: '8%',
        left: 0,
        right: 0,
        zIndex: 26,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        gap: '24px',
      }}
    >
      <button
        className="btn"
        onClick={onAccept}
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '12px',
          letterSpacing: '2px',
          background: 'rgba(13,31,23,0.92)',
          color: 'var(--amber)',
          border: '3px solid var(--amber)',
          padding: '14px 26px',
          cursor: 'pointer',
          boxShadow: '4px 4px 0 0 var(--shadow)',
          textTransform: 'uppercase',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget;
          el.style.transform = 'translate(-2px, -2px)';
          el.style.boxShadow = '6px 6px 0 0 var(--shadow)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget;
          el.style.transform = '';
          el.style.boxShadow = '4px 4px 0 0 var(--shadow)';
        }}
      >
        ACCEPT
      </button>

      <button
        className="btn btn-challenge"
        onClick={onLiar}
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '12px',
          letterSpacing: '2px',
          background: 'rgba(13,31,23,0.92)',
          color: 'var(--coral)',
          border: '3px solid var(--coral)',
          padding: '14px 26px',
          cursor: 'pointer',
          boxShadow: '4px 4px 0 0 var(--shadow)',
          textTransform: 'uppercase',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget;
          el.style.transform = 'translate(-2px, -2px)';
          el.style.boxShadow = '6px 6px 0 0 var(--shadow)';
        }}
        onMouseLeave={e => {
          const el = e.currentTarget;
          el.style.transform = '';
          el.style.boxShadow = '4px 4px 0 0 var(--shadow)';
        }}
      >
        LIAR!
      </button>
    </div>
  );
}
