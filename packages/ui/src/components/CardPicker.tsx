// =============================================================================
// CardPicker — browsable grid of cards with filters + qty pills.
// Grid of CardTiles, filter bar on top (inline chips desktop, sheet mobile).
// Clicking a tile's art opens a full-size inspect modal. Qty pills on each
// tile let users set deck count directly without typing.
// =============================================================================

import React from "react";
import type { CardDefinition, DeckEntry, InkColor, CardVariantType } from "@lorcana-sim/engine";
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

  function setCardVariant(def: CardDefinition, variant: CardVariantType) {
    const existingIdx = entries.findIndex((e) => e.definitionId === def.id);
    if (existingIdx < 0) return; // variant picker is only shown when qty > 0
    const next = [...entries];
    // "regular" is the implicit default — store undefined so decklist text
    // stays clean for entries on the default printing.
    next[existingIdx] = {
      ...next[existingIdx]!,
      variant: variant === "regular" ? undefined : variant,
    };
    onChange(next);
  }

  const inspectDef = inspectId ? definitions[inspectId] : null;

  return (
    <div className="space-y-3">
      <CardFilterBar
        filters={filters}
        onChange={setFilters}
        matchCount={visibleCards.length}
      />

      {visibleCards.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-600 border border-dashed border-gray-800 rounded-lg">
          {hasAnyFilter(filters) ? "No cards match these filters." : "No cards available."}
        </div>
      ) : (
        // Bounded scroll area so the 2652-card grid doesn't push the deck
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
            {visibleCards.map((def) => {
              const entry = entries.find((e) => e.definitionId === def.id);
              return (
                <CardTile
                  key={def.id}
                  def={def}
                  qty={qtyById.get(def.id) ?? 0}
                  maxCopies={getMaxCopies(def)}
                  variant={entry?.variant}
                  onSetQty={(n) => setCardQty(def, n)}
                  onSetVariant={(v) => setCardVariant(def, v)}
                  onInspect={() => setInspectId(def.id)}
                />
              );
            })}
          </div>
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
