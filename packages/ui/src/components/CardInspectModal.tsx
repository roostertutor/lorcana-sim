import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import Icon from "./Icon.js";

type CardBtn = { label: string; color: string; onClick: (e: React.MouseEvent) => void };

interface Props {
  instanceId: string;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  actions: CardBtn[];
  onClose: () => void;
}

export default function CardInspectModal({ instanceId, gameState, definitions, actions, onClose }: Props) {
  const instance = gameState.cards[instanceId];
  const def = instance ? definitions[instance.definitionId] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xs shadow-2xl pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 transition-colors z-10"
          onClick={onClose}
        >
          <Icon name="x-mark" className="w-5 h-5" />
        </button>

        {/* Card image */}
        <div className="flex justify-center pt-4 px-4">
          {def?.imageUrl ? (
            <img
              src={def.imageUrl}
              alt={def.fullName}
              className="rounded-xl shadow-lg max-h-[55vh] sm:max-h-[60vh] object-contain"
              draggable={false}
            />
          ) : (
            <div className="w-48 aspect-[5/7] rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <span className="text-gray-500 text-sm text-center px-4">{def?.fullName ?? instanceId}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
            {actions.map((btn, i) => (
              <button
                key={i}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors active:scale-95 ${btn.color}`}
                onClick={(e) => { btn.onClick(e); onClose(); }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* No actions: just padding */}
        {actions.length === 0 && <div className="pb-4" />}
      </div>
    </div>
  );
}
