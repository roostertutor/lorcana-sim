import React from "react";
import Icon from "./Icon.js";

interface Props {
  count: number;
  onClick: () => void;
}

/**
 * Floating "active effects" pill. Follows the RevealPill visual vocabulary —
 * backdrop-blur rounded pill with a short label + icon. Lives in the
 * bottom-right status stack. Conditional: parent only renders it when
 * `count > 0`.
 *
 * Tap opens the existing Active Effects modal (`setShowEffects(true)`).
 */
export default function ActiveEffectsPill({ count, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex items-center gap-2 pl-2 pr-3 py-1.5 bg-amber-950/95 hover:bg-amber-900 active:scale-95 text-white rounded-xl shadow-2xl border border-amber-500/60 backdrop-blur-sm transition-all"
      title="Tap to view active effects"
    >
      <div className="w-5 h-5 rounded-full bg-amber-600/80 flex items-center justify-center">
        <Icon name="clock" className="w-3 h-3 text-amber-100" />
      </div>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[9px] uppercase tracking-wider text-amber-300 font-bold">
          Effects · {count}
        </span>
        <span className="text-[11px] font-semibold">
          {count === 1 ? "1 active" : `${count} active`}
        </span>
      </div>
    </button>
  );
}
