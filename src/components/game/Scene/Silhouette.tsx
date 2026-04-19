'use client';

interface SilhouetteProps {
  /** Eye-glow color. Defaults to `var(--amber)` (Reader/Prosecutor). */
  personaAccent?: string;
}

/**
 * Dark body silhouette with glowing eyes. The `.silhouette-block` wrapper
 * carries the `breathe` animation so the whole figure rises/falls. Eyes blink
 * on a `blink` cycle.
 */
export function Silhouette({ personaAccent = 'var(--amber)' }: SilhouetteProps) {
  return (
    <div
      className="silhouette-block"
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        width: '160px',
        animation: 'breathe 4.5s ease-in-out infinite',
      }}
    >
      {/* Body */}
      <div
        className="silhouette"
        style={{
          position: 'relative',
          width: '160px',
          height: '240px',
          filter: 'drop-shadow(0 18px 32px rgba(0,0,0,0.9))',
        }}
      >
        {/* Head — pseudo-element equivalent rendered as a child div */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '72px',
            height: '76px',
            background: 'linear-gradient(160deg, #140a06 0%, #050302 100%)',
            border: '3px solid var(--amber-dim)',
            boxShadow: 'inset 8px -8px 0 rgba(0,0,0,0.5)',
          }}
        />
        {/* Torso */}
        <div
          style={{
            position: 'absolute',
            top: '68px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '150px',
            height: '180px',
            background: 'linear-gradient(160deg, #140a06 0%, #050302 100%)',
            border: '3px solid var(--amber-dim)',
            borderBottom: 'none',
            boxShadow: 'inset 12px -8px 0 rgba(0,0,0,0.5)',
          }}
        />
        {/* Eyes */}
        <div
          className="eyes"
          style={{
            position: 'absolute',
            top: '30px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '44px',
            display: 'flex',
            justifyContent: 'space-between',
            zIndex: 3,
          }}
        >
          <div
            className="eye"
            style={{
              width: '5px',
              height: '5px',
              background: personaAccent,
              boxShadow: `0 0 10px ${personaAccent}, 0 0 18px ${personaAccent}`,
              animation: 'blink 5.2s infinite',
            }}
          />
          <div
            className="eye"
            style={{
              width: '5px',
              height: '5px',
              background: personaAccent,
              boxShadow: `0 0 10px ${personaAccent}, 0 0 18px ${personaAccent}`,
              animation: 'blink 5.2s infinite',
            }}
          />
        </div>
      </div>
    </div>
  );
}
