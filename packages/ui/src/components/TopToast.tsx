import React from "react";

interface Props {
  children: React.ReactNode;
  /** Tailwind classes appended after positioning. Use this for
   *  `pointer-events-none` (info-only toasts) or for layout when stacking
   *  multiple toast pills horizontally (`flex items-center gap-2`). */
  className?: string;
}

/**
 * Top-of-screen floating toast/banner positioned below the device safe area.
 *
 * Replaces the four sites that used a bare `fixed top-4 left-1/2 -translate-x-1/2 z-50`
 * pattern. Those sat behind the iPhone Dynamic Island in portrait — info
 * toasts had their text obscured, and interactive toasts (Sing Together
 * Confirm, mode-toast Cancel buttons) had their tap targets eaten.
 *
 * `top: calc(1rem + env(safe-area-inset-top))` keeps the visual 16px gap
 * we had before, just measured from the safe area instead of the viewport
 * edge. On non-notched devices `env()` resolves to 0, so behavior is
 * identical to the old `top-4`.
 */
export default function TopToast({ children, className = "" }: Props) {
  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-50 ${className}`}
      style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
    >
      {children}
    </div>
  );
}
