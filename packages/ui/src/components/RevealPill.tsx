import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";
import Pill from "./Pill.js";
import { getThumbCardImage } from "../utils/cardImage.js";

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
 * Compact "recent reveal" chip — single mini thumbnail of the first
 * revealed card + count badge. Tapping re-opens the full ZoneViewModal,
 * which carries the descriptive content (source name, all revealed
 * cards, owner badges). The parent clears the pill at turn boundary so
 * revealed info doesn't persist across turns ("no note-taking" intent).
 *
 * Compact form (vs the prior fanned-thumbnails variant) is a deliberate
 * trade — minimises footprint over hand cards in the bottom-right
 * corner. The modal handles all the descriptive heavy-lifting.
 *
 * Multiple reveals in a turn render as a vertical stack of these chips
 * (one per reveal event) — distinguished visually by their thumbnails
 * (each shows the first card of THAT reveal). title is also passed via
 * the button's tooltip for hover/screen-reader disambiguation.
 */
export default function RevealPill({
  title,
  cardIds,
  gameState,
  definitions,
  onClick,
  faceDown = false,
}: Props) {
  const firstId = cardIds[0];
  const firstInst = firstId ? gameState.cards[firstId] : undefined;
  const firstDef = firstInst ? definitions[firstInst.definitionId] : undefined;
  const img = !faceDown && firstDef?.imageUrl ? getThumbCardImage(firstDef.imageUrl) : null;
  const count = cardIds.length;
  return (
    <Pill
      theme="indigo"
      size="compact"
      onClick={onClick}
      title={`Revealed by ${title}${count > 1 ? ` (${count} cards)` : ""} — tap to view`}
    >
      {/* Single mini thumbnail of the first revealed card. Acts as a
          visual handle distinguishing chips when multiple stacked. */}
      <div className="w-3 h-[17px] rounded-[1px] border border-indigo-300/60 shadow-sm overflow-hidden bg-gradient-to-br from-indigo-800 to-indigo-950">
        {img && (
          <img
            {...img}
            className="w-full h-full object-cover"
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </div>
      <span className="text-[10px] font-black text-indigo-100 leading-none tabular-nums">
        {count}
      </span>
    </Pill>
  );
}
