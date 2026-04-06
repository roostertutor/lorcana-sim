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
  onHide: () => void;
  onResolveChoice: (choice: string | string[] | number) => void;
}

export default function PendingChoiceModal({
  pendingChoice,
  gameState,
  definitions,
  multiSelectTargets,
  onMultiSelectChange,
  onHide,
  onResolveChoice,
}: Props) {
  function getName(instanceId: string): string {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
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
    return (
      <div
        className={`flex flex-col items-center cursor-pointer transition-opacity overflow-hidden ${isDimmed ? "opacity-40" : ""}`}
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
          <div className="grid grid-cols-4 gap-1.5 pb-1">
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
                      <div className="bg-red-900/80 rounded-full p-1.5 shadow">
                        {/* swap / arrows-right-left icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-red-300" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0 4.5-4.5M3 16.5h13.5m0-13.5L21 7.5m0 0-4.5 4.5M21 7.5H7.5" />
                        </svg>
                      </div>
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

    // Order picker (choose_order) — player clicks cards in their preferred bottom-of-deck order
    if (pendingChoice.type === "choose_order") {
      const ids = pendingChoice.validTargets ?? [];
      const total = ids.length;
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-medium mb-0.5">{pendingChoice.prompt}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">
              Click cards in order — #1 goes deepest, #{total} sits on top
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 pb-1">
            {ids.map((id) => {
              const posIndex = multiSelectTargets.indexOf(id);
              const isOrdered = posIndex !== -1;
              return (
                <div key={id} className="relative">
                  <CardThumb
                    id={id}
                    isSelected={isOrdered}
                    isDimmed={false}
                    onClick={() =>
                      onMultiSelectChange((prev) =>
                        isOrdered ? prev.filter((t) => t !== id) : [...prev, id],
                      )
                    }
                  />
                  {isOrdered && (
                    <div className="absolute top-1 right-1 pointer-events-none">
                      <span className="text-[10px] font-black text-white bg-indigo-600 w-4 h-4 rounded-full flex items-center justify-center shadow">
                        {posIndex + 1}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
            disabled={multiSelectTargets.length !== total}
            onClick={() => onResolveChoice(multiSelectTargets)}
          >
            Confirm order ({multiSelectTargets.length}/{total})
          </button>
        </div>
      );
    }

    // Multi-select (choose_cards, choose_discard)
    const needsMultiSelect =
      pendingChoice.type === "choose_cards" ||
      pendingChoice.type === "choose_discard";

    if (needsMultiSelect) {
      const requiredCount = pendingChoice.count ?? 1;
      const ids = pendingChoice.validTargets ?? [];
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-medium mb-0.5">{pendingChoice.prompt}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Select {requiredCount} card(s)</div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 pb-1">
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
        <div className="space-y-4">
          <div className="text-gray-200 text-sm">{pendingChoice.prompt}</div>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("accept")}
            >
              Use ability
            </button>
            <button
              className="px-4 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("decline")}
            >
              Skip
            </button>
          </div>
        </div>
      );
    }

    // CRD 7.7.4: trigger ordering — pick which ability to resolve first
    if (pendingChoice.type === "choose_trigger") {
      const indices = pendingChoice.validTargets ?? [];
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-bold mb-0.5">Triggered Abilities</div>
            <div className="text-gray-400 text-xs">{pendingChoice.prompt}</div>
          </div>
          <div className="flex flex-col gap-2">
            {indices.map((idxStr) => {
              const trigger = gameState.triggerStack[parseInt(idxStr, 10)];
              if (!trigger) return null;
              const sourceCard = gameState.cards[trigger.sourceInstanceId];
              const def = sourceCard ? definitions[sourceCard.definitionId] : undefined;
              const cardName = def?.fullName ?? trigger.sourceInstanceId;
              const abilityName = trigger.ability.storyName ?? "Ability";
              return (
                <button
                  key={idxStr}
                  className="flex items-center gap-3 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-indigo-500 rounded-lg transition-colors text-left"
                  onClick={() => onResolveChoice(idxStr)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{cardName}</div>
                    <div className="text-xs text-indigo-300 italic truncate">{abilityName}</div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              );
            })}
          </div>
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
    const hasValidTargets = validSet.size > 0;
    const selected = multiSelectTargets[0] ?? null;
    return (
      <div className="space-y-3">
        <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
        <div className="grid grid-cols-4 gap-1.5 pb-1">
          {displayCards.map((id) => {
            const selectable = validSet.has(id);
            const isSelected = selected === id;
            return (
              <CardThumb
                key={id}
                id={id}
                isSelected={isSelected}
                isDimmed={!selectable}
                onClick={() => {
                  if (!selectable) return;
                  onMultiSelectChange(isSelected ? [] : [id]);
                }}
              />
            );
          })}
        </div>
        <div className="flex gap-2 items-center">
          {hasValidTargets && (
            <button
              className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
              disabled={!selected}
              onClick={() => selected && onResolveChoice([selected])}
            >
              Confirm
            </button>
          )}
          {pendingChoice.optional && (
            <button
              className="px-3 py-2 text-xs bg-red-800/80 hover:bg-red-700 text-gray-200 rounded-lg border border-red-700 transition-colors"
              onClick={() => onResolveChoice([])}
            >
              {hasValidTargets ? "Skip" : "OK"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop — clicking peeks at the board by hiding the modal */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
        onClick={onHide}
        title="Click to peek at the board"
      />

      {/* Panel — bottom sheet on mobile, centered card on sm+ */}
      <div className="relative z-10 w-full sm:max-w-lg sm:mx-4
                      max-h-[82vh] overflow-y-auto
                      bg-gray-950 border border-gray-700
                      rounded-t-2xl sm:rounded-2xl
                      p-5 pb-[max(env(safe-area-inset-bottom,0px),20px)]
                      shadow-2xl">
        {/* Panel header row: drag handle (mobile) + hide button */}
        <div className="flex items-center justify-between mb-3">
          <div className="w-10 h-1 bg-gray-700 rounded-full sm:hidden" />
          <div className="hidden sm:block" /> {/* spacer */}
          <button
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800/60 hover:bg-gray-700/60 rounded-full border border-gray-700 transition-colors"
            onClick={onHide}
            title="Hide modal to review the board"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.578-3.007-9.964-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Peek
          </button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}
