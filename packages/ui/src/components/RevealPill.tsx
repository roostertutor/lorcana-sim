import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import Icon from "./Icon.js";

interface Props {
  title: string;
  cardIds: string[];
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  onClick: () => void;
  /** Uniform face-down (hide content — e.g. opponent peeked their own cards). */
  faceDown?: boolean;
}

/**
 * Collapsed "recent reveal" chip.
 *
 * Lives in the bottom-right utility stack after the user dismisses the full
 * ZoneViewModal for a reveal (or inking-adjacent reveal). Clicking re-opens
 * the modal. The parent clears the pill when `gameState.turnNumber` advances
 * past the reveal's anchor turn — so revealed info doesn't persist across
 * turn boundaries, matching the "no note-taking IRL" expectation.
 */
export default function RevealPill({
  title,
  cardIds,
  gameState,
  definitions,
  onClick,
  faceDown = false,
}: Props) {
  const previews = cardIds.slice(0, 3);
  const count = cardIds.length;
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto flex items-center gap-2 pl-2 pr-3 py-1.5 bg-indigo-950/95 hover:bg-indigo-900 active:scale-95 text-white rounded-xl shadow-2xl border border-indigo-500/60 backdrop-blur-sm transition-all"
      title="Click to view — clears at end of turn"
    >
      {/* Fanned thumbnail stack */}
      <div className="flex -space-x-3 pl-2">
        {previews.map((id, i) => {
          const inst = gameState.cards[id];
          const def = inst ? definitions[inst.definitionId] : undefined;
          const img = !faceDown ? def?.imageUrl : undefined;
          const rot = (i - (previews.length - 1) / 2) * 8;
          return (
            <div
              key={id}
              className="w-5 h-7 rounded-sm border border-indigo-300/60 shadow overflow-hidden bg-gradient-to-br from-indigo-800 to-indigo-950"
              style={{ transform: `rotate(${rot}deg)`, zIndex: 10 - i }}
            >
              {img && (
                <img
                  src={img}
                  className="w-full h-full object-cover"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[9px] uppercase tracking-wider text-indigo-300 font-bold">
          Revealed · {count}
        </span>
        <span className="text-[11px] font-semibold max-w-[140px] truncate">{title}</span>
      </div>
      <Icon name="eye" className="w-3.5 h-3.5 text-indigo-300" />
    </button>
  );
}
