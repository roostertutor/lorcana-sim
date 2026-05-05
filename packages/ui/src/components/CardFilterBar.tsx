// =============================================================================
// CardFilterBar — filter chips + name search for the deckbuilder card picker.
// Desktop: inline chips above the grid. Mobile: "Filters" button opens a
// slide-up sheet; name search stays inline on both (you use it most).
// =============================================================================

import React from "react";
import type { InkColor, CardType, CardDefinition } from "@lorcana-sim/engine";
import { INK_COLOR_CLASS } from "../utils/deckRules.js";

export type CostBucket = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // 8 represents "8+"
export type Rarity = CardDefinition["rarity"];

export interface CardFilters {
  costs: Set<CostBucket>;
  inks: Set<InkColor>;
  types: Set<CardType>;
  /** Advanced filter — rarity. 9 values, bounded. */
  rarities: Set<Rarity>;
  /** Advanced filter — traits. Many values (40+); UI uses a search +
   *  add-chip pattern, not a full chip row. */
  traits: Set<string>;
  query: string;
}

export const EMPTY_FILTERS: CardFilters = {
  costs: new Set(),
  inks: new Set(),
  types: new Set(),
  rarities: new Set(),
  traits: new Set(),
  query: "",
};

export function hasAnyFilter(f: CardFilters): boolean {
  return f.costs.size > 0
    || f.inks.size > 0
    || f.types.size > 0
    || f.rarities.size > 0
    || f.traits.size > 0
    || f.query.trim().length > 0;
}

// Use shared INK_COLOR_CLASS (extracted from the ink SVG fills) so chip
// backgrounds match the gem icons visually. Previous Tailwind color-scale
// values (purple-600, red-600, blue-600) were noticeably off from the
// Lorcana brand palette — especially Amethyst rendering as bright violet
// instead of deep Lorcana purple.
const INK_COLORS: Array<{ key: InkColor; label: string; bg: string }> = [
  { key: "amber", label: "Amber", bg: INK_COLOR_CLASS.amber },
  { key: "amethyst", label: "Amethyst", bg: INK_COLOR_CLASS.amethyst },
  { key: "emerald", label: "Emerald", bg: INK_COLOR_CLASS.emerald },
  { key: "ruby", label: "Ruby", bg: INK_COLOR_CLASS.ruby },
  { key: "sapphire", label: "Sapphire", bg: INK_COLOR_CLASS.sapphire },
  { key: "steel", label: "Steel", bg: INK_COLOR_CLASS.steel },
];

const CARD_TYPES: Array<{ key: CardType; label: string }> = [
  { key: "character", label: "Character" },
  { key: "action", label: "Action" },
  { key: "item", label: "Item" },
  { key: "location", label: "Location" },
];

const COST_BUCKETS: CostBucket[] = [1, 2, 3, 4, 5, 6, 7, 8];

// Rarity labels — order matches printing progression (common → epic).
const RARITIES: Array<{ key: Rarity; label: string }> = [
  { key: "common", label: "Common" },
  { key: "uncommon", label: "Uncommon" },
  { key: "rare", label: "Rare" },
  { key: "super_rare", label: "Super Rare" },
  { key: "legendary", label: "Legendary" },
  { key: "enchanted", label: "Enchanted" },
  { key: "iconic", label: "Iconic" },
  { key: "epic", label: "Epic" },
  // Sub-rarities (formerly grouped as "Special"). Split per Ravensburger's
  // special_rarity_id discriminator so users can filter D100/D23/promo/
  // challenge separately.
  { key: "promo", label: "Promo" },
  { key: "challenge", label: "Challenge" },
  { key: "D23", label: "D23 Expo" },
  { key: "D100", label: "Disney 100" },
];

interface Props {
  filters: CardFilters;
  onChange: (f: CardFilters) => void;
  /** Total count of cards matching current filters, shown in the header. */
  matchCount: number;
  /** Sorted list of every trait across the definitions — used by the
   *  advanced-filter trait search. Computed once in the parent so we
   *  don't walk the whole card pool on every filter tweak. */
  allTraits: string[];
}

export default function CardFilterBar({ filters, onChange, matchCount, allTraits }: Props) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [traitQuery, setTraitQuery] = React.useState("");

  function toggle<K>(set: Set<K>, key: K): Set<K> {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  }

  function clear() {
    onChange(EMPTY_FILTERS);
    setTraitQuery("");
  }

  const traitSuggestions = React.useMemo(() => {
    const q = traitQuery.trim().toLowerCase();
    if (!q) return [];
    return allTraits
      .filter((t) => !filters.traits.has(t) && t.toLowerCase().includes(q))
      .slice(0, 8);
  }, [traitQuery, allTraits, filters.traits]);

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

  // Advanced filter content — rarity chips + trait search. Used in both the
  // desktop popover and the mobile sheet's advanced section.
  const advancedContent = (
    <>
      {/* Rarity chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Rarity</span>
        {RARITIES.map(({ key, label }) => {
          const active = filters.rarities.has(key);
          return (
            <button
              key={key}
              onClick={() => onChange({ ...filters, rarities: toggle(filters.rarities, key) })}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                active
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Trait search + selected chips — too many traits (40+) for a full row */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Trait</span>
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Type a trait (Princess, Hero, Villain…)"
              value={traitQuery}
              onChange={(e) => setTraitQuery(e.target.value)}
              autoCapitalize="words"
              autoComplete="off"
              aria-label="Filter by trait"
              className="w-full bg-gray-950 border border-gray-800 rounded-md px-2 py-1 text-[11px] text-gray-200 placeholder-gray-600 focus:border-amber-500 focus:outline-none"
            />
            {traitSuggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-gray-700 bg-gray-950 shadow-xl overflow-hidden max-h-48 overflow-y-auto">
                {traitSuggestions.map((t) => (
                  <button
                    key={t}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange({ ...filters, traits: new Set([...filters.traits, t]) });
                      setTraitQuery("");
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-800"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {filters.traits.size > 0 && (
          <div className="flex flex-wrap gap-1">
            {Array.from(filters.traits).sort().map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold"
              >
                {t}
                <button
                  onClick={() => {
                    const next = new Set(filters.traits);
                    next.delete(t);
                    onChange({ ...filters, traits: next });
                  }}
                  className="hover:bg-amber-500 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none"
                  aria-label={`Remove ${t} filter`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const activeCount = filters.costs.size + filters.inks.size + filters.types.size;
  const advancedCount = filters.rarities.size + filters.traits.size;
  const totalActive = activeCount + advancedCount;

  return (
    <div className="space-y-2">
      {/* Top row: search + filter toggle (mobile) + clear */}
      <div className="flex items-center gap-2 min-w-0">
        <input
          // type="search" gives mobile keyboards a "Search" key + the
          // browser-rendered ✕ clear control. autoCapitalize="words"
          // matches how card names are written ("Mickey Mouse").
          // min-w-0 lets flex-1 actually shrink the input below its
          // default intrinsic width on narrow phones — without it, the
          // input + Filters button + count overflow the viewport and
          // cause horizontal scroll on small mobile portrait screens.
          type="search"
          placeholder="Search card name..."
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          autoCapitalize="words"
          autoComplete="off"
          enterKeyHint="search"
          aria-label="Search card name"
          className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-amber-500 focus:outline-none"
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
          {totalActive > 0 && (
            <span className="ml-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-gray-950 text-[10px] font-black flex items-center justify-center">{totalActive}</span>
          )}
        </button>
        <div className="text-[10px] text-gray-500 whitespace-nowrap">
          {matchCount.toLocaleString()} card{matchCount === 1 ? "" : "s"}
        </div>
      </div>

      {/* Desktop: inline quick chips + Advanced popover trigger */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
        {filterChips}
        <div className="relative">
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-colors ${
              advancedCount > 0
                ? "bg-amber-600 text-white hover:bg-amber-500"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
          >
            Advanced
            {advancedCount > 0 && (
              <span className="min-w-[14px] h-3.5 px-1 rounded-full bg-white text-amber-700 text-[9px] font-black flex items-center justify-center">{advancedCount}</span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-2.5 h-2.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {advancedOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setAdvancedOpen(false)} />
              <div className="absolute z-50 top-full left-0 mt-1 rounded-lg border border-gray-700 bg-gray-950 shadow-2xl p-3 space-y-3 min-w-[320px]">
                {advancedContent}
              </div>
            </>
          )}
        </div>
        {totalActive > 0 && (
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
                {totalActive > 0 && (
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
            <div className="pt-3 border-t border-gray-800 space-y-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                Advanced
              </div>
              {advancedContent}
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
