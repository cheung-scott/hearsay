'use client';

import { useIsMobile } from '../../../hooks/useIsMobile';

interface AcceptLiarButtonsProps {
  /** When false the component returns null (only visible in `awaiting-player-response`). */
  visible: boolean;
  onAccept: () => void;
  onLiar: () => void;
}

/**
 * Accept + Liar! button pair. Returns null when not `visible`. §10.4 originally
 * locked `bottom: 8%` — but the player's hand fan (rotateX(-22deg) at
 * bottom: -20px with 150px cards) visibly overlaps that zone. Moved to
 * `bottom: 22%` (desktop) / `26%` (mobile) so the buttons sit in the dead
 * space between opponent and hand. Grouped as a centered pair (24px gap) so
 * they read as a single binary choice. Matches `.actions` / `.btn` /
 * `.btn-challenge` class names.
 */
export function AcceptLiarButtons({ visible, onAccept, onLiar }: AcceptLiarButtonsProps) {
  const isMobile = useIsMobile();
  if (!visible) return null;

  return (
    <div
      className="actions"
      style={{
        position: 'absolute',
        bottom: isMobile ? '26%' : '22%',
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
