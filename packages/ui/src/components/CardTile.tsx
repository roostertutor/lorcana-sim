// =============================================================================
// CardTile — single card in the deckbuilder picker grid.
// Renders card art + name + cost, plus qty pills (0..maxCopies) for setting
// deck count directly. Clicking the art opens an inspect preview.
// =============================================================================

import type { CardDefinition, InkColor } from "@lorcana-sim/engine";

const INK_DOT: Record<InkColor, string> = {
  amber: "bg-amber-500",
  amethyst: "bg-purple-500",
  emerald: "bg-emerald-500",
  ruby: "bg-red-500",
  sapphire: "bg-blue-500",
  steel: "bg-gray-400",
};

interface Props {
  def: CardDefinition;
  /** Current quantity of this card in the deck (0..maxCopies). */
  qty: number;
  /** Maximum copies allowed for this card. */
  maxCopies: number;
  /** Called when the user sets the quantity via a pip. */
  onSetQty: (qty: number) => void;
  /** Called when the user clicks the art to inspect. */
  onInspect: () => void;
}

export default function CardTile({ def, qty, maxCopies, onSetQty, onInspect }: Props) {
  const inDeck = qty > 0;
  // For cards like Dalmatian Puppy (99 copies), render a compact pill row
  // that can hold up to 6 entries (0-5); quantities above 5 are handled by
  // the deck editor row. For standard 0-4, render 5 pips.
  const pipCount = Math.min(maxCopies, 5);

  return (
    <div className={`relative rounded-md overflow-hidden border transition-colors ${
      inDeck ? "border-amber-500/60 shadow-md shadow-amber-900/20" : "border-gray-800 hover:border-gray-600"
    }`}>
      {/* Art — click to inspect */}
      <button
        className="block w-full aspect-[5/7] bg-gray-900 cursor-pointer group"
        onClick={onInspect}
        title={def.fullName}
      >
        {def.imageUrl ? (
          <img
            src={def.imageUrl.replace("/digital/normal/", "/digital/small/")}
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
        {/* Cost badge — top-left */}
        <div className="absolute top-1 left-1 w-6 h-6 rounded-full bg-gray-950/85 border border-gray-700 flex items-center justify-center text-white font-black text-[11px] shadow">
          {def.cost}
        </div>
        {/* Ink color dots — top-right */}
        <div className="absolute top-1 right-1 flex gap-0.5">
          {def.inkColors.map((c) => (
            <span key={c} className={`w-2 h-2 rounded-full ${INK_DOT[c]} ring-1 ring-gray-950/60`} />
          ))}
        </div>
        {/* "In deck" corner flag */}
        {inDeck && (
          <div className="absolute bottom-1 right-1 min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-gray-950 font-black text-[11px] flex items-center justify-center shadow">
            {qty}
          </div>
        )}
      </button>

      {/* Qty pip row — click a pip to set qty directly */}
      <div className="flex items-stretch bg-gray-950 border-t border-gray-800">
        {Array.from({ length: pipCount + 1 }, (_, i) => i).map((n) => (
          <button
            key={n}
            onClick={(e) => { e.stopPropagation(); onSetQty(n); }}
            className={`flex-1 py-1 text-[11px] font-mono font-bold transition-colors ${
              n === qty
                ? "bg-amber-600 text-white"
                : "text-gray-500 hover:bg-gray-800 hover:text-gray-200"
            }`}
            title={n === 0 ? "Remove from deck" : `Set quantity to ${n}`}
          >
            {n}
          </button>
        ))}
        {/* When maxCopies > 5, spillover indicator */}
        {maxCopies > 5 && qty > 5 && (
          <div className="px-1.5 flex items-center text-[10px] font-mono text-amber-300 bg-gray-900 border-l border-gray-800">
            ×{qty}
          </div>
        )}
      </div>
    </div>
  );
}
