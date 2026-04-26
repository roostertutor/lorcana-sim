import React from "react";
import Icon from "./Icon.js";

export type ModeToastTheme = "red" | "purple" | "yellow" | "cyan";

interface Props {
  /** Bold opening label (e.g. "Challenge", "Shift", "Sing", "Move"). */
  label: string;
  /** Hint shown only on sm+ ("— tap a highlighted opponent card"). Hidden
   *  on mobile to keep the pill compact; the label alone is enough once
   *  the player is in the mode. */
  hint: string;
  theme: ModeToastTheme;
  onCancel: () => void;
  /** Optional middle/end content rendered before the cancel button.
   *  Used by Sing Together to slot in a cost counter + Confirm button. */
  children?: React.ReactNode;
}

const THEMES: Record<
  ModeToastTheme,
  { bg: string; border: string; text: string; hint: string; icon: string }
> = {
  red: {
    bg: "bg-red-950/90",
    border: "border-red-700/60",
    text: "text-red-300",
    hint: "text-red-500",
    icon: "text-red-500 hover:text-red-300",
  },
  purple: {
    bg: "bg-purple-950/90",
    border: "border-purple-700/60",
    text: "text-purple-300",
    hint: "text-purple-500",
    icon: "text-purple-500 hover:text-purple-300",
  },
  yellow: {
    bg: "bg-yellow-950/90",
    border: "border-yellow-700/60",
    text: "text-yellow-300",
    hint: "text-yellow-600",
    icon: "text-yellow-600 hover:text-yellow-300",
  },
  cyan: {
    bg: "bg-cyan-950/90",
    border: "border-cyan-700/60",
    text: "text-cyan-300",
    hint: "text-cyan-600",
    icon: "text-cyan-600 hover:text-cyan-300",
  },
};

/**
 * Interactive mode toast — used for the 2-step click-mode flows
 * (Challenge / Shift / Sing / Sing Together / Move). Each carries a bold
 * label, an optional hint shown only at sm+, an optional middle slot for
 * extra controls (Sing Together's cost counter + Confirm), and a Cancel
 * button on the right.
 *
 * Renders just the inner pill — the parent is expected to wrap the row of
 * mode toasts in a single `<TopToast className="flex items-center gap-2">`
 * since only one mode is active at a time but the parent's `flex` layout
 * keeps the wrapper consistent.
 */
export default function ModeToast({ label, hint, theme, onCancel, children }: Props) {
  const t = THEMES[theme];
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-3 py-1 sm:px-4 sm:py-1.5 ${t.bg} border ${t.border} ${t.text} text-xs shadow-lg`}
    >
      <span className="font-bold">{label}</span>
      <span className={`hidden sm:inline ${t.hint}`}>— {hint}</span>
      {children}
      <button className={`${t.icon} font-bold active:scale-95`} onClick={onCancel}>
        <Icon name="x-mark" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
