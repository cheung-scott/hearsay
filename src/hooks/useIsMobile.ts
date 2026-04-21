'use client';

import { useEffect, useState } from 'react';

/**
 * Day-5 Wave-5 playtest fix — viewport-width sentinel for mobile layouts.
 *
 * Returns `true` when `window.innerWidth < breakpoint` (default 640px, the
 * Tailwind `sm` edge). Listens for resize/orientation changes and updates
 * live. SSR-safe: returns `false` on first render so server HTML matches
 * desktop layout; hydrates to the real value on mount.
 *
 * Usage:
 *   const isMobile = useIsMobile();
 *   <div style={{ width: isMobile ? '90vw' : '720px' }} />
 */
export function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [breakpoint]);

  return isMobile;
}
