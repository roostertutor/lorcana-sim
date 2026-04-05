import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import GameCard from "./GameCard.js";

interface ZoneViewModalProps {
  title: string;
  cardIds: string[];
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  onClose: () => void;
}

export default function ZoneViewModal({ title, cardIds, gameState, definitions, onClose }: ZoneViewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
          <span className="text-sm font-bold text-gray-200">{title}</span>
          <span className="text-xs text-gray-500 mr-auto ml-2">{cardIds.length} card{cardIds.length !== 1 ? "s" : ""}</span>
          <button
            className="text-gray-500 hover:text-gray-300 text-lg leading-none active:scale-95 transition-colors"
            onClick={onClose}
          >
            x
          </button>
        </div>

        {/* Card grid */}
        <div className="overflow-y-auto p-4">
          {cardIds.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-600 text-sm italic">
              No cards in discard
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {cardIds.map((id) => {
                const instance = gameState.cards[id];
                const def = instance ? definitions[instance.definitionId] : undefined;
                const zone = (instance?.zone === "play" ? "play" : "hand") as "play" | "hand";
                return (
                  <div key={id} className="flex flex-col items-center overflow-hidden" title={def?.fullName}>
                    <div className="scale-[0.78] origin-top">
                      <GameCard
                        instanceId={id}
                        gameState={gameState}
                        definitions={definitions}
                        isSelected={false}
                        onClick={() => {}}
                        zone={zone}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
