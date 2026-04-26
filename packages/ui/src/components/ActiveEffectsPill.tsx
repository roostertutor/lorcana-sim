import React from "react";
import Icon from "./Icon.js";
import Pill from "./Pill.js";

interface Props {
  count: number;
  onClick: () => void;
}

/**
 * Floating "active effects" pill. Lives in the bottom-right status stack
 * alongside RevealPill. Conditional — parent only renders it when
 * `count > 0`. Tap opens the existing Active Effects modal.
 */
export default function ActiveEffectsPill({ count, onClick }: Props) {
  return (
    <Pill theme="amber" onClick={onClick} title="Tap to view active effects">
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
    </Pill>
  );
}
