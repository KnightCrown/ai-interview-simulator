"use client";

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Reactive mobile-viewport detector. Returns false during SSR / first paint to
 * avoid hydration mismatches; flips to the live `matchMedia` value once mounted.
 *
 * Use this only for behavior that genuinely needs JS branching (e.g. setting an
 * initial overlay state, swapping animated UI for a static lightbox). For pure
 * layout decisions, prefer Tailwind's responsive utilities (`md:`, `lg:`).
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  return isMobile;
}
