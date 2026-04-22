// =============================================================================
// CardTile — single card in the deckbuilder picker grid.
// Clicking the art adds one copy to the deck (primary action, matches
// Dreamborn). A small "ⓘ" icon in the top-right opens the full-size
// inspect preview (secondary action, won't collide with the add click).
// [−] N [+] stepper below handles decrement + quantity readout.
// Variant editing lives on the deck row (DeckBuilder.DeckRow), not here.
// The tile always shows the default (regular) art so the browser is a
// stable reference catalog regardless of what's in the deck.
// =============================================================================

import type { CardDefinition } from "@lorcana-sim/engine";
import { getBoardCardImage } from "../utils/cardImage.js";

interface Props {
  def: CardDefinition;
  /** Current quantity of this card in the deck (0..maxCopies). */
  qty: number;
  /** Maximum copies allowed for this card. */
  maxCopies: number;
  /** Called when the user changes the quantity (± 1 via stepper). */
  onSetQty: (qty: number) => void;
  /** Called when the user clicks the art to inspect. */
  onInspect: () => void;
}

export default function CardTile({
  def, qty, maxCopies, onSetQty, onInspect,
}: Props) {
  const inDeck = qty > 0;
  const atMax = qty >= maxCopies;
  // Dalmatian Puppy and Microbots both have maxCopies=99. Render as ∞ — nobody's
  // actually building a 99-copy deck, and the "any number" flavor reads better.
  const maxLabel = maxCopies >= 99 ? "∞" : String(maxCopies);

  // Browser tile always shows def.imageUrl (= the default / regular variant).
  // Variant selection belongs to the deck entry and renders on the deck row.
  const displayImageUrl = def.imageUrl ?? "";

  return (
    <div className={`relative rounded-md overflow-hidden border transition-colors ${
      inDeck ? "border-amber-500/60 shadow-md shadow-amber-900/20" : "border-gray-800 hover:border-gray-600"
    }`}>
      {/* Art — click adds one copy (primary action). Inspect moved to
          the ⓘ button below to match Dreamborn's click-to-add pattern. */}
      <div className="relative">
        <button
          className={`block w-full aspect-[5/7] bg-gray-900 group ${
            atMax ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          onClick={() => { if (!atMax) onSetQty(qty + 1); }}
          title={atMax ? `Max ${maxLabel} copies` : `Add ${def.fullName}`}
          aria-label={`Add ${def.fullName}`}
        >
          {displayImageUrl ? (
            <img
              {...getBoardCardImage(displayImageUrl)}
              alt={def.fullName}
              className={`w-full h-full object-cover transition-[filter] ${
                atMax ? "brightness-50" : "group-hover:brightness-110"
              }`}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs p-2 text-center">
              {def.fullName}
            </div>
          )}
        </button>
        {/* Inspect (ⓘ) — absolute sibling, not nested in the add button.
             Click lands here first (z-index above the art). */}
        <button
          onClick={onInspect}
          className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center rounded-full bg-black/70 backdrop-blur-sm text-gray-200 hover:text-white hover:bg-black/90 transition-colors shadow"
          title="View card"
          aria-label="Inspect card"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM10 8a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Zm-1-3a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Qty stepper — [−] N/max [+]. Matches DeckBuilder row editor pattern. */}
      <div className="flex items-center bg-gray-950 border-t border-gray-800">
        <button
          onClick={(e) => { e.stopPropagation(); if (qty > 0) onSetQty(qty - 1); }}
          disabled={qty === 0}
          className={`flex-1 py-1.5 text-sm font-bold transition-colors ${
            qty === 0
              ? "text-gray-800 cursor-not-allowed"
              : "text-gray-400 hover:bg-gray-800 hover:text-gray-200 active:scale-95"
          }`}
          title="Decrease quantity"
        >
          −
        </button>
        <div className={`px-2 py-1 text-[11px] font-mono font-bold tabular-nums text-center min-w-[24px] ${
          inDeck ? "text-amber-400" : "text-gray-600"
        }`}>
          {qty}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (!atMax) onSetQty(qty + 1); }}
          disabled={atMax}
          className={`flex-1 py-1.5 text-sm font-bold transition-colors ${
            atMax
              ? "text-gray-800 cursor-not-allowed"
              : "text-gray-400 hover:bg-gray-800 hover:text-gray-200 active:scale-95"
          }`}
          title={atMax ? `Max ${maxLabel} copies` : "Increase quantity"}
        >
          +
        </button>
      </div>
    </div>
  );
}
