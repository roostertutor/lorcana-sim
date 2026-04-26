import React from "react";

export type PillTheme = "indigo" | "amber";
export type PillSize = "default" | "compact";

interface Props {
  theme: PillTheme;
  onClick: () => void;
  title?: string;
  /** "default": full-width pill with padding for label + thumbnails (~140px wide).
   *  "compact": small chip with reduced padding for icon + count (~40px wide). */
  size?: PillSize;
  children: React.ReactNode;
}

const THEMES: Record<PillTheme, { bg: string; hoverBg: string; border: string }> = {
  indigo: {
    bg: "bg-indigo-950/95",
    hoverBg: "hover:bg-indigo-900",
    border: "border-indigo-500/60",
  },
  amber: {
    bg: "bg-amber-950/95",
    hoverBg: "hover:bg-amber-900",
    border: "border-amber-500/60",
  },
};

const SIZE_CLASS: Record<PillSize, string> = {
  default: "gap-2 pl-2 pr-3 py-1.5 rounded-xl",
  compact: "gap-1 px-1.5 py-1 rounded-lg",
};

/**
 * Shared shell for the bottom-right floating status pills (RevealPill,
 * ActiveEffectsPill). Owns the outer shape (rounded, backdrop-blur,
 * shadow, border) and theme coloring; callers supply the inner content
 * (thumbnails, labels, icons) via children.
 *
 * `size="compact"` gives a small icon-and-count chip that minimises the
 * footprint over hand cards in the bottom-right corner — used now that
 * the modal carries the descriptive info on tap.
 *
 * `pointer-events-auto` is set so the pill remains clickable when nested
 * inside a `pointer-events-none` floating stack.
 */
export default function Pill({ theme, onClick, title, size = "default", children }: Props) {
  const t = THEMES[theme];
  return (
    <button
      onClick={onClick}
      className={`pointer-events-auto flex items-center ${SIZE_CLASS[size]} ${t.bg} ${t.hoverBg} active:scale-95 text-white shadow-2xl border ${t.border} backdrop-blur-sm transition-all`}
      title={title}
    >
      {children}
    </button>
  );
}
