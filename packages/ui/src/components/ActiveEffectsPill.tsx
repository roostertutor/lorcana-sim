import React from "react";
import Icon from "./Icon.js";
import Pill from "./Pill.js";

interface Props {
  count: number;
  onClick: () => void;
}

/**
 * Compact "active effects" chip. Lives in the bottom-right status stack
 * alongside RevealPill. Conditional — parent only renders it when
 * `count > 0`. Shows just a clock icon + count; tap opens the existing
 * Active Effects modal which carries the descriptive content (effect
 * names, sources, durations).
 *
 * Compact form is a deliberate choice to minimise pill footprint over
 * the hand cards in the bottom-right corner — see GameBoard's pill
 * stack comment for the layout reasoning.
 */
export default function ActiveEffectsPill({ count, onClick }: Props) {
  return (
    <Pill theme="amber" size="compact" onClick={onClick} title={`${count} active effect${count !== 1 ? "s" : ""} — tap to view`}>
      <Icon name="clock" className="w-3 h-3 text-amber-300" />
      <span className="text-[10px] font-black text-amber-100 leading-none tabular-nums">
        {count}
      </span>
    </Pill>
  );
}
