// =============================================================================
// CardTile — single card in the deckbuilder picker grid.
// Card art on top (click to inspect), [−] N/max [+] stepper below.
// When the card has multiple visual printings AND qty > 0, a variant chip
// row appears under the stepper so the user can pick enchanted / promo / etc.
// =============================================================================

import type { CardDefinition, CardVariantType } from "@lorcana-sim/engine";

// Compact labels for the variant chip row (fits 2–3 chips comfortably on a
// 120-ish-wide tile). Regular is the implicit default, so we don't show a
// chip for it when it would be the only one.
const VARIANT_LABELS: Record<CardVariantType, string> = {
  regular: "Reg",
  enchanted: "Ench",
  iconic: "Icon",
  epic: "Epic",
  promo: "Promo",
  special: "Spec",
};

interface Props {
  def: CardDefinition;
  /** Current quantity of this card in the deck (0..maxCopies). */
  qty: number;
  /** Maximum copies allowed for this card. */
  maxCopies: number;
  /** Current variant selection on the deck entry (undefined = default). */
  variant?: CardVariantType;
  /** Called when the user changes the quantity (± 1 via stepper). */
  onSetQty: (qty: number) => void;
  /** Called when the user picks a variant chip. */
  onSetVariant: (variant: CardVariantType) => void;
  /** Called when the user clicks the art to inspect. */
  onInspect: () => void;
}

export default function CardTile({
  def, qty, maxCopies, variant, onSetQty, onSetVariant, onInspect,
}: Props) {
  const inDeck = qty > 0;
  const atMax = qty >= maxCopies;
  // Dalmatian Puppy and Microbots both have maxCopies=99. Render as ∞ — nobody's
  // actually building a 99-copy deck, and the "any number" flavor reads better.
  const maxLabel = maxCopies >= 99 ? "∞" : String(maxCopies);

  // Image: if the entry has a selected variant, use that variant's art. Else
  // fall back to def.imageUrl (which == variants[0].imageUrl by construction).
  const variantMatch = variant
    ? def.variants?.find((v) => v.type === variant)
    : undefined;
  const displayImageUrl = variantMatch?.imageUrl ?? def.imageUrl ?? "";

  // Variant chips are only worth showing when the card has ≥2 printings.
  const hasVariantPicker = (def.variants?.length ?? 0) >= 2;

  return (
    <div className={`relative rounded-md overflow-hidden border transition-colors ${
      inDeck ? "border-amber-500/60 shadow-md shadow-amber-900/20" : "border-gray-800 hover:border-gray-600"
    }`}>
      {/* Art — click to inspect. Cost pip + ink-color frame are already in
          the Ravensburger card image; no overlays needed. */}
      <button
        className="block w-full aspect-[5/7] bg-gray-900 cursor-pointer group"
        onClick={onInspect}
        title={def.fullName}
      >
        {displayImageUrl ? (
          <img
            src={displayImageUrl.replace("/digital/normal/", "/digital/small/")}
            alt={def.fullName}
            className="w-full h-full object-cover group-hover:brightness-110 transition-[filter]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs p-2 text-center">
            {def.fullName}
          </div>
        )}
      </button>

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
        <div className={`px-2 py-1 text-[11px] font-mono font-bold tabular-nums text-center min-w-[44px] ${
          inDeck ? "text-amber-400" : "text-gray-600"
        }`}>
          {qty}<span className="text-gray-600">/{maxLabel}</span>
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

      {/* Variant chip row — only when the card has ≥2 printings AND the card
          is actually in the deck. Pre-deck selection would require ephemeral
          state; punt until someone asks for it. */}
      {hasVariantPicker && inDeck && (
        <div className="flex items-stretch bg-gray-900 border-t border-gray-800 overflow-x-auto">
          {def.variants!.map((v) => {
            const active = (variant ?? "regular") === v.type;
            return (
              <button
                key={v.type}
                onClick={(e) => { e.stopPropagation(); onSetVariant(v.type); }}
                className={`flex-1 min-w-0 py-0.5 px-1 text-[9px] font-bold uppercase tracking-wider truncate transition-colors ${
                  active
                    ? "bg-amber-600 text-white"
                    : "text-gray-500 hover:bg-gray-800 hover:text-gray-200"
                }`}
                title={v.label ?? `${VARIANT_LABELS[v.type]} (${v.setId} #${v.number})`}
              >
                {VARIANT_LABELS[v.type]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
