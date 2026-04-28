import React, { useState } from "react";
import type { CardDefinition, GameState, PlayerID } from "@lorcana-sim/engine";
import GameCard from "./GameCard.js";
import CardInspectModal from "./CardInspectModal.js";
import Icon from "./Icon.js";
import ModalFrame from "./ModalFrame.js";

interface ZoneViewSection {
  /** Section header label (e.g. "Revealed by Vision of the Future",
   *  "Opponent's hand"). */
  title: string;
  cardIds: string[];
}

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
  /** Viewer's player ID. When provided AND the cards within a section span
   *  multiple owners (Let's Get Dangerous reveals from both decks), each
   *  card gets a small "You" / "Opp" badge so the viewer can tell whose
   *  card it is. Single-owner sections skip the badge to avoid noise. */
  myId?: PlayerID;
  /** Optional grouped layout — when provided, replaces the flat cardIds
   *  grid with per-section headers + grids. Each section's cardIds are
   *  scoped for owner-badge gating; sections are rendered in array order.
   *  When omitted, falls back to the flat grid (existing behavior used
   *  for deck/discard/cards-under viewers). The flat `cardIds` is still
   *  used for the header count. */
  sections?: ZoneViewSection[];
}

export default function ZoneViewModal({ title, cardIds, gameState, definitions, onClose, faceDown, faceDownIds, cardActions, myId, sections }: ZoneViewModalProps) {
  // Zoom: tapping a card opens a full-detail inspect modal layered on top
  // of this viewer. Face-down cards skip inspect (don't leak hidden info).
  const [inspectId, setInspectId] = useState<string | null>(null);
  const isInspectFaceDown = inspectId !== null
    && ((faceDownIds ? faceDownIds.has(inspectId) : faceDown) ?? false);

  // Render a single card cell (used by both flat and sectioned layouts).
  // `sectionShowsOwnerBadges` is computed per-section in the sectioned
  // layout; the flat layout passes the global owner-set check.
  function renderCardCell(id: string, sectionShowsOwnerBadges: boolean) {
    const instance = gameState.cards[id];
    const def = instance ? definitions[instance.definitionId] : undefined;
    const zone = (instance?.zone === "play" ? "play" : "hand") as "play" | "hand";
    const action = cardActions?.get(id);
    const faceDownHere = faceDownIds ? faceDownIds.has(id) : faceDown;
    const isMine = instance?.ownerId === myId;
    return (
      <div key={id} className="relative flex flex-col items-center overflow-hidden" title={def?.fullName}>
        {sectionShowsOwnerBadges && (
          <span
            className={`absolute top-0.5 left-0.5 z-10 text-[8px] font-bold px-1 py-0.5 rounded shadow pointer-events-none ${
              isMine
                ? "bg-green-700/90 text-green-100"
                : "bg-red-700/90 text-red-100"
            }`}
          >
            {isMine ? "You" : "Opp"}
          </span>
        )}
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
  }

  // Per-section owner-badge gating — only show when myId is set AND that
  // section's cards span multiple owners. Computed at render time below
  // for the sectioned layout; in flat mode, the global cardIds set drives
  // the same check.
  function sectionHasMultipleOwners(ids: string[]): boolean {
    if (myId == null) return false;
    const owners = new Set(ids.map(id => gameState.cards[id]?.ownerId).filter((p): p is PlayerID => p != null));
    return owners.size > 1;
  }
  const flatShowsOwnerBadges = sections == null && sectionHasMultipleOwners(cardIds);

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

        {/* Body — sectioned (with per-source headers) or flat grid */}
        <div className="overflow-y-auto p-4">
          {cardIds.length === 0 ? (
            // Zone-agnostic empty state — header above already names the
            // surface (Your Discard / Opponent's Hand / Cards Under X /
            // Revealed by Y), so the body doesn't repeat it. Previously
            // hardcoded "No cards in discard" which read wrong for the
            // deck/reveal/cards-under reuse paths.
            <div className="flex items-center justify-center h-24 text-gray-600 text-sm italic">
              No cards
            </div>
          ) : sections != null ? (
            <div className="space-y-4">
              {sections.map((section, i) => {
                const sectionMultiOwner = sectionHasMultipleOwners(section.cardIds);
                return (
                  <div key={i}>
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                        {section.title}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {section.cardIds.length} card{section.cardIds.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 landscape-phone:grid-cols-7 gap-1.5">
                      {section.cardIds.map(id => renderCardCell(id, sectionMultiOwner))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 landscape-phone:grid-cols-7 gap-1.5">
              {cardIds.map(id => renderCardCell(id, flatShowsOwnerBadges))}
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
