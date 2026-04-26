import React from "react";
import TopToast from "./TopToast.js";

type Theme = "yellow" | "gray";

interface Props {
  text: string;
  theme: Theme;
}

const THEMES: Record<Theme, { bg: string; border: string; text: string }> = {
  yellow: {
    bg: "bg-yellow-950/90",
    border: "border-yellow-700/60",
    text: "text-yellow-400",
  },
  gray: {
    bg: "bg-gray-900/90",
    border: "border-gray-700/60",
    text: "text-gray-400",
  },
};

/**
 * Passive top-of-screen status pill — "Opponent is thinking…", "Waiting for
 * opponent…", future loading / connection / system messages. Pulses to
 * signal liveness. Pointer-events-none so it never intercepts taps on the
 * board underneath.
 *
 * For the interactive Challenge / Shift / Sing-Together / Move toasts that
 * carry Cancel + Confirm buttons, see ModeToast.
 */
export default function InfoToast({ text, theme }: Props) {
  const t = THEMES[theme];
  return (
    <TopToast className="pointer-events-none">
      <div className={`${t.bg} border ${t.border} rounded-full px-4 py-1.5 shadow-lg`}>
        <span className={`${t.text} text-xs font-medium animate-pulse`}>{text}</span>
      </div>
    </TopToast>
  );
}
