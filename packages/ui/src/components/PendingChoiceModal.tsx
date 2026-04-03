import React from "react";
import type { PendingChoice, PlayerID, GameState, CardDefinition } from "@lorcana-sim/engine";
import { buildLabelMap } from "../utils/buildLabelMap.js";
import GameCard from "./GameCard.js";

interface Props {
  pendingChoice: PendingChoice;
  myId: PlayerID;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  multiSelectTargets: string[];
  onMultiSelectChange: React.Dispatch<React.SetStateAction<string[]>>;
  onResolveChoice: (choice: string[] | number | "accept" | "decline") => void;
}

export default function PendingChoiceModal({
  pendingChoice,
  gameState,
  definitions,
  multiSelectTargets,
  onMultiSelectChange,
  onResolveChoice,
}: Props) {
  function getName(instanceId: string): string {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  }

  const isDismissible =
    pendingChoice.type === "choose_may" || pendingChoice.optional === true;

  function handleBackdropClick() {
    if (pendingChoice.type === "choose_may") {
      onResolveChoice("decline");
    } else if (pendingChoice.optional) {
      onResolveChoice([]);
    }
    // required choices: no-op
  }

  // Renders a card image + name label. Wraps in a scaled container for modal size.
  function CardThumb({
    id,
    isSelected: sel,
    isDimmed,
    onClick: handleClick,
  }: {
    id: string;
    isSelected?: boolean;
    isDimmed?: boolean;
    onClick: () => void;
  }) {
    const zone = (gameState.cards[id]?.zone === "play" ? "play" : "hand") as "play" | "hand";
    const name = getName(id);
    return (
      <div
        className={`flex flex-col items-center gap-1 shrink-0 cursor-pointer transition-opacity ${isDimmed ? "opacity-40" : ""}`}
        onClick={handleClick}
      >
        {/* scale wrapper so cards fit comfortably in the modal */}
        <div className="scale-[0.78] origin-top">
          <GameCard
            instanceId={id}
            gameState={gameState}
            definitions={definitions}
            isSelected={!!sel}
            onClick={handleClick}
            zone={zone}
          />
        </div>
        <span className="text-[10px] text-gray-400 text-center max-w-[80px] leading-tight truncate">{name}</span>
      </div>
    );
  }

  function renderContent() {
    // CRD 2.2.2: Mulligan
    if (pendingChoice.type === "choose_mulligan") {
      const hand = pendingChoice.validTargets ?? [];
      return (
        <div className="space-y-3">
          <div>
            <div className="text-indigo-200 text-sm font-bold mb-0.5">Opening Hand — Mulligan</div>
            <div className="text-gray-400 text-xs">{pendingChoice.prompt}</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {hand.map((id) => {
              const selected = multiSelectTargets.includes(id);
              return (
                <div key={id} className="relative">
                  <CardThumb
                    id={id}
                    isSelected={false}
                    isDimmed={selected}
                    onClick={() =>
                      onMultiSelectChange((prev) =>
                        selected ? prev.filter((t) => t !== id) : [...prev, id],
                      )
                    }
                  />
                  {selected && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-xs font-black text-red-300 bg-red-900/80 px-1.5 py-0.5 rounded">PUT BACK</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
            onClick={() => onResolveChoice(multiSelectTargets)}
          >
            {multiSelectTargets.length > 0
              ? `Put back ${multiSelectTargets.length}, draw ${multiSelectTargets.length}`
              : "Keep All"}
          </button>
        </div>
      );
    }

    // Multi-select (choose_cards, choose_discard, choose_from_revealed)
    const needsMultiSelect =
      pendingChoice.type === "choose_cards" ||
      pendingChoice.type === "choose_discard" ||
      pendingChoice.type === "choose_from_revealed";

    if (needsMultiSelect) {
      const requiredCount = pendingChoice.count ?? 1;
      const ids = pendingChoice.validTargets ?? [];
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-medium mb-0.5">{pendingChoice.prompt}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Select {requiredCount} card(s)</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ids.map((id) => {
              const selected = multiSelectTargets.includes(id);
              return (
                <CardThumb
                  key={id}
                  id={id}
                  isSelected={selected}
                  onClick={() =>
                    onMultiSelectChange((prev) =>
                      selected ? prev.filter((t) => t !== id) : [...prev, id],
                    )
                  }
                />
              );
            })}
          </div>
          <button
            className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
            disabled={multiSelectTargets.length !== requiredCount}
            onClick={() => onResolveChoice(multiSelectTargets)}
          >
            Confirm ({multiSelectTargets.length}/{requiredCount})
          </button>
        </div>
      );
    }

    // May (accept/decline)
    if (pendingChoice.type === "choose_may") {
      return (
        <div className="space-y-3">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex gap-2">
            <button
              className="px-5 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("accept")}
            >
              Accept
            </button>
            <button
              className="px-5 py-2 text-sm bg-red-700 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("decline")}
            >
              Decline
            </button>
          </div>
          <div className="text-[10px] text-gray-600">Tap outside to decline</div>
        </div>
      );
    }

    // Option picker
    if (pendingChoice.type === "choose_option" && pendingChoice.options) {
      return (
        <div className="space-y-3">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex flex-wrap gap-2">
            {pendingChoice.options.map((_, i) => (
              <button
                key={i}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 font-medium transition-colors"
                onClick={() => onResolveChoice(i)}
              >
                Option {i + 1}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Single target (choose_target) / choose_from_revealed display
    const displayCards = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
    const validSet = new Set(pendingChoice.validTargets ?? []);
    return (
      <div className="space-y-3">
        <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {displayCards.map((id) => {
            const selectable = validSet.has(id);
            return (
              <CardThumb
                key={id}
                id={id}
                isDimmed={!selectable}
                onClick={() => selectable && onResolveChoice([id])}
              />
            );
          })}
          {pendingChoice.optional && (
            <button
              className="self-center shrink-0 px-3 py-1.5 text-xs bg-red-800/80 hover:bg-red-700
                         text-gray-200 rounded-lg border border-red-700 transition-colors"
              onClick={() => onResolveChoice([])}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={isDismissible ? handleBackdropClick : undefined}
      />

      {/* Panel — bottom sheet on mobile, centered card on sm+ */}
      <div className="relative z-10 w-full sm:max-w-lg sm:mx-4
                      max-h-[82vh] overflow-y-auto
                      bg-gray-950 border border-gray-700
                      rounded-t-2xl sm:rounded-2xl
                      p-5 pb-[max(env(safe-area-inset-bottom,0px),20px)]
                      shadow-2xl">
        {/* Drag handle (mobile only) */}
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-4 sm:hidden" />
        {renderContent()}
      </div>
    </div>
  );
}
