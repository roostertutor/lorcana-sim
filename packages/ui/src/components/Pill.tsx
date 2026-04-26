import React from "react";

export type PillTheme = "indigo" | "amber";

interface Props {
  theme: PillTheme;
  onClick: () => void;
  title?: string;
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

/**
 * Shared shell for the bottom-right floating status pills (RevealPill,
 * ActiveEffectsPill). Owns the outer shape (rounded-xl, backdrop-blur,
 * shadow, border) and theme coloring; callers supply the inner content
 * (thumbnails, labels, icons) via children.
 *
 * `pointer-events-auto` is set so the pill remains clickable when nested
 * inside a `pointer-events-none` floating stack.
 */
export default function Pill({ theme, onClick, title, children }: Props) {
  const t = THEMES[theme];
  return (
    <button
      onClick={onClick}
      className={`pointer-events-auto flex items-center gap-2 pl-2 pr-3 py-1.5 ${t.bg} ${t.hoverBg} active:scale-95 text-white rounded-xl shadow-2xl border ${t.border} backdrop-blur-sm transition-all`}
      title={title}
    >
      {children}
    </button>
  );
}
