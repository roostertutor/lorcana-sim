import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query — returns whether it currently matches,
 * re-renders on viewport changes (resize / orientation flip).
 *
 * Use when a component needs to KNOW about viewport state in JS — i.e.
 * to conditionally render a child (`x ? <A/> : <B/>`), gate a prop
 * (don't pass `onOpenSandbox` when the sidebar is visible), or pick a
 * runtime branch (different DnD strategy on touch vs pointer).
 *
 * Prefer Tailwind responsive classes (`md:hidden`, `landscape-phone:!block`)
 * for pure visual show/hide — they ship as CSS, no JS rerender, no SSR
 * mismatch.
 *
 * SSR-safe: returns `false` during the first server render (no `window`)
 * and the initial client render, then flips to the real value after mount.
 * Components relying on the value for first-paint correctness should use
 * a layout effect or render fallback for the first frame.
 *
 * Examples:
 *   const isDesktop = useMediaQuery("(min-width: 768px)");
 *   const sidebarVisible = useMediaQuery(
 *     "(min-width: 768px) and not ((orientation: landscape) and (max-height: 500px))"
 *   );
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    // Sync once on mount in case the SSR/init value drifted before the
    // listener was wired up.
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
