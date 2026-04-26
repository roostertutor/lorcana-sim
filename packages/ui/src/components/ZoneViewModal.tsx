import React, { useState } from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import GameCard from "./GameCard.js";
import CardInspectModal from "./CardInspectModal.js";
import Icon from "./Icon.js";
import ModalFrame from "./ModalFrame.js";

interface ZoneViewModalProps {
  title: string;
  cardIds: string[];
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  onClose: () => void;
  /** Uniform face-down for all cards (deck viewer). Overridden by perCardFaceDown. */
  faceDown?: boolean;
  /** Per-card face-down set — cards in this set render face-down, others face-up. */
  faceDownIds?: Set<string>;
  /** Per-card action buttons (e.g. "Ink" on discard cards when Moana is active). */
  cardActions?: Map<string, { label: string; color: string; onClick: () => void }>;
}

export default function ZoneViewModal({ title, cardIds, gameState, definitions, onClose, faceDown, faceDownIds, cardActions }: ZoneViewModalProps) {
  // Zoom: tapping a card opens a full-detail inspect modal layered on top
  // of this viewer. Face-down cards skip inspect (don't leak hidden info).
  const [inspectId, setInspectId] = useState<string | null>(null);
  const isInspectFaceDown = inspectId !== null
    && ((faceDownIds ? faceDownIds.has(inspectId) : faceDown) ?? false);
  return (
    <ModalFrame onClose={onClose}>
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
            <Icon name="x-mark" className="w-4 h-4" />
          </button>
        </div>

        {/* Card grid */}
        <div className="overflow-y-auto p-4">
          {cardIds.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-600 text-sm italic">
              No cards in discard
            </div>
          ) : (
            <div className="grid grid-cols-4 landscape-phone:grid-cols-7 gap-1.5">
              {cardIds.map((id) => {
                const instance = gameState.cards[id];
                const def = instance ? definitions[instance.definitionId] : undefined;
                const zone = (instance?.zone === "play" ? "play" : "hand") as "play" | "hand";
                const action = cardActions?.get(id);
                const faceDownHere = faceDownIds ? faceDownIds.has(id) : faceDown;
                return (
                  <div key={id} className="flex flex-col items-center overflow-hidden" title={def?.fullName}>
                    <div className="scale-[0.78] origin-top">
                      <GameCard
                        instanceId={id}
                        gameState={gameState}
                        definitions={definitions}
                        isSelected={false}
                        onClick={() => { if (!faceDownHere) setInspectId(id); }}
                        zone={zone}
                        faceDown={faceDownHere}
                      />
                    </div>
                    {action && (
                      <button
                        className={`mt-0.5 px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${action.color}`}
                        onClick={action.onClick}
                      >
                        {action.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {inspectId && !isInspectFaceDown && (() => {
        const action = cardActions?.get(inspectId);
        const actions = action
          ? [{
              label: action.label,
              color: action.color,
              onClick: (_e: React.MouseEvent) => { action.onClick(); setInspectId(null); },
            }]
          : [];
        return (
          <CardInspectModal
            instanceId={inspectId}
            gameState={gameState}
            definitions={definitions}
            actions={actions}
            onClose={() => setInspectId(null)}
          />
        );
      })()}
    </ModalFrame>
  );
}
