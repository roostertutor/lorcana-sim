// =============================================================================
// CardFilterBar — filter chips + name search for the deckbuilder card picker.
// Desktop: inline chips above the grid. Mobile: "Filters" button opens a
// slide-up sheet; name search stays inline on both (you use it most).
// =============================================================================

import React from "react";
import type { InkColor, CardType } from "@lorcana-sim/engine";

export type CostBucket = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // 8 represents "8+"

export interface CardFilters {
  costs: Set<CostBucket>;
  inks: Set<InkColor>;
  types: Set<CardType>;
  query: string;
}

export const EMPTY_FILTERS: CardFilters = {
  costs: new Set(),
  inks: new Set(),
  types: new Set(),
  query: "",
};

export function hasAnyFilter(f: CardFilters): boolean {
  return f.costs.size > 0 || f.inks.size > 0 || f.types.size > 0 || f.query.trim().length > 0;
}

const INK_COLORS: Array<{ key: InkColor; label: string; bg: string }> = [
  { key: "amber", label: "Amber", bg: "bg-amber-600" },
  { key: "amethyst", label: "Amethyst", bg: "bg-purple-600" },
  { key: "emerald", label: "Emerald", bg: "bg-emerald-600" },
  { key: "ruby", label: "Ruby", bg: "bg-red-600" },
  { key: "sapphire", label: "Sapphire", bg: "bg-blue-600" },
  { key: "steel", label: "Steel", bg: "bg-gray-500" },
];

const CARD_TYPES: Array<{ key: CardType; label: string }> = [
  { key: "character", label: "Character" },
  { key: "action", label: "Action" },
  { key: "item", label: "Item" },
  { key: "location", label: "Location" },
];

const COST_BUCKETS: CostBucket[] = [1, 2, 3, 4, 5, 6, 7, 8];

interface Props {
  filters: CardFilters;
  onChange: (f: CardFilters) => void;
  /** Total count of cards matching current filters, shown in the header. */
  matchCount: number;
}

export default function CardFilterBar({ filters, onChange, matchCount }: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);

  function toggle<K>(set: Set<K>, key: K): Set<K> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function clear() {
    onChange(EMPTY_FILTERS);
  }

  const filterChips = (
    <>
      {/* Cost */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Cost</span>
        {COST_BUCKETS.map((c) => {
          const active = filters.costs.has(c);
          return (
            <button
              key={c}
              onClick={() => onChange({ ...filters, costs: toggle(filters.costs, c) })}
              className={`w-7 h-7 rounded-full text-[11px] font-black transition-colors ${
                active
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              {c === 8 ? "8+" : c}
            </button>
          );
        })}
      </div>

      {/* Ink colors */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Ink</span>
        {INK_COLORS.map(({ key, label, bg }) => {
          const active = filters.inks.has(key);
          return (
            <button
              key={key}
              onClick={() => onChange({ ...filters, inks: toggle(filters.inks, key) })}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors flex items-center gap-1.5 ${
                active
                  ? `${bg} text-white`
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${active ? "bg-white/80" : bg}`} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Card types */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Type</span>
        {CARD_TYPES.map(({ key, label }) => {
          const active = filters.types.has(key);
          return (
            <button
              key={key}
              onClick={() => onChange({ ...filters, types: toggle(filters.types, key) })}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );

  const activeCount = filters.costs.size + filters.inks.size + filters.types.size;

  return (
    <div className="space-y-2">
      {/* Top row: search + filter toggle (mobile) + clear */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search card name..."
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-amber-500 focus:outline-none"
        />
        {/* Mobile-only filter sheet toggle */}
        <button
          onClick={() => setSheetOpen(true)}
          className="md:hidden px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs font-bold text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
          </svg>
          Filters
          {activeCount > 0 && (
            <span className="ml-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-gray-950 text-[10px] font-black flex items-center justify-center">{activeCount}</span>
          )}
        </button>
        <div className="text-[10px] text-gray-500 whitespace-nowrap">
          {matchCount.toLocaleString()} card{matchCount === 1 ? "" : "s"}
        </div>
      </div>

      {/* Desktop: inline chips */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
        {filterChips}
        {activeCount > 0 && (
          <button
            onClick={clear}
            className="text-[10px] text-gray-500 hover:text-gray-300 underline ml-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Mobile: slide-up sheet */}
      {sheetOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          <div className="relative w-full max-h-[75vh] overflow-y-auto bg-gray-950 border-t border-gray-700 rounded-t-2xl p-4 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-200">Filters</h3>
              <div className="flex items-center gap-2">
                {activeCount > 0 && (
                  <button
                    onClick={clear}
                    className="text-[11px] text-gray-500 hover:text-gray-300 underline"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setSheetOpen(false)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {filterChips}
            </div>
            <button
              onClick={() => setSheetOpen(false)}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold transition-colors"
            >
              Show {matchCount.toLocaleString()} card{matchCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
