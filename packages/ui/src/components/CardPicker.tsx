// =============================================================================
// CardPicker — browsable grid of cards with filters + qty pills.
// Grid of CardTiles, filter bar on top (inline chips desktop, sheet mobile).
// Clicking a tile's art opens a full-size inspect modal. Qty pills on each
// tile let users set deck count directly without typing.
// =============================================================================

import React from "react";
import type { CardDefinition, DeckEntry, InkColor } from "@lorcana-sim/engine";
import CardTile from "./CardTile.js";
import CardFilterBar, { EMPTY_FILTERS, type CardFilters, type CostBucket, hasAnyFilter } from "./CardFilterBar.js";
import { getMaxCopies, countById } from "../utils/deckRules.js";

interface Props {
  entries: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  onChange: (entries: DeckEntry[]) => void;
}

export default function CardPicker({ entries, definitions, onChange }: Props) {
  const [filters, setFilters] = React.useState<CardFilters>(EMPTY_FILTERS);
  const [inspectId, setInspectId] = React.useState<string | null>(null);

  const qtyById = React.useMemo(() => countById(entries), [entries]);

  // Filtered + sorted card list. Sort by (setId asc, number asc).
  const visibleCards = React.useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const hasCostFilter = filters.costs.size > 0;
    const hasInkFilter = filters.inks.size > 0;
    const hasTypeFilter = filters.types.size > 0;

    const result: CardDefinition[] = [];
    for (const def of Object.values(definitions)) {
      if (q && !def.fullName.toLowerCase().includes(q)) continue;
      if (hasCostFilter) {
        const bucket: CostBucket = (def.cost >= 8 ? 8 : Math.max(1, def.cost)) as CostBucket;
        if (!filters.costs.has(bucket)) continue;
      }
      if (hasInkFilter && !def.inkColors.some((c: InkColor) => filters.inks.has(c))) continue;
      if (hasTypeFilter && !filters.types.has(def.cardType)) continue;
      result.push(def);
    }
    result.sort((a, b) => {
      const setDiff = a.setId.localeCompare(b.setId);
      if (setDiff !== 0) return setDiff;
      return a.number - b.number;
    });
    return result;
  }, [definitions, filters]);

  function setCardQty(def: CardDefinition, newQty: number) {
    const max = getMaxCopies(def);
    const clamped = Math.max(0, Math.min(max, newQty));
    const existingIdx = entries.findIndex((e) => e.definitionId === def.id);

    if (clamped === 0) {
      if (existingIdx < 0) return;
      onChange(entries.filter((_, i) => i !== existingIdx));
      return;
    }
    if (existingIdx < 0) {
      onChange([...entries, { definitionId: def.id, count: clamped }]);
    } else {
      const next = [...entries];
      next[existingIdx] = { ...next[existingIdx]!, count: clamped };
      onChange(next);
    }
  }

  const inspectDef = inspectId ? definitions[inspectId] : null;

  // Moxfield-style search-first UX: don't render tiles until the user picks
  // at least one filter or types a search query. Avoids mounting 2652 cards
  // worth of DOM on entry and nudges users toward the filter workflow which
  // is how most real deckbuilding happens anyway.
  const filterActive = hasAnyFilter(filters);
  // Cap the grid at MAX_VISIBLE for the rare case where a filter still
  // matches thousands (e.g. one ink color returns ~450). Keeps mount cost
  // bounded even in worst-case filter combinations.
  const MAX_VISIBLE = 200;
  const shownCards = filterActive ? visibleCards.slice(0, MAX_VISIBLE) : [];
  const truncated = filterActive && visibleCards.length > MAX_VISIBLE;

  return (
    <div className="space-y-3">
      <CardFilterBar
        filters={filters}
        onChange={setFilters}
        matchCount={visibleCards.length}
      />

      {!filterActive ? (
        <div className="text-center py-12 text-sm text-gray-500 border border-dashed border-gray-800 rounded-lg space-y-1">
          <div>Pick a filter or type a card name to browse.</div>
          <div className="text-xs text-gray-600">{Object.keys(definitions).length.toLocaleString()} cards available.</div>
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-600 border border-dashed border-gray-800 rounded-lg">
          No cards match these filters.
        </div>
      ) : (
        // Bounded scroll area so the capped grid doesn't push the deck
        // editor below the fold. Filter bar above stays fixed with this.
        <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 rounded-lg">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              contentVisibility: "auto",
              containIntrinsicSize: "0 200px",
            }}
          >
            {shownCards.map((def) => (
              <CardTile
                key={def.id}
                def={def}
                qty={qtyById.get(def.id) ?? 0}
                maxCopies={getMaxCopies(def)}
                onSetQty={(n) => setCardQty(def, n)}
                onInspect={() => setInspectId(def.id)}
              />
            ))}
          </div>
          {truncated && (
            <div className="text-center text-xs text-gray-500 py-3">
              Showing first {MAX_VISIBLE.toLocaleString()} of{" "}
              <span className="text-gray-300 font-mono">{visibleCards.length.toLocaleString()}</span>.
              Use filters to narrow the list.
            </div>
          )}
        </div>
      )}

      {/* Inspect modal — full-size card image, click anywhere to close */}
      {inspectDef && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setInspectId(null)}
        >
          {inspectDef.imageUrl ? (
            <img
              src={inspectDef.imageUrl}
              alt={inspectDef.fullName}
              className="max-h-[95vh] max-w-[95vw] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="bg-gray-900 p-6 rounded-xl text-gray-300 text-sm" onClick={(e) => e.stopPropagation()}>
              No image available for {inspectDef.fullName}
            </div>
          )}
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-gray-950/80 hover:bg-gray-800 text-gray-300 hover:text-white text-xl transition-colors flex items-center justify-center"
            onClick={() => setInspectId(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
