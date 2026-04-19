// =============================================================================
// DeckBuilder — row-based visual deck editor with autocomplete add-card search
// Each card is a row (name + cost + ink + qty +/- + remove).
// Paste import / export for bulk input & sharing.
// =============================================================================

import React, { useState, useMemo, useRef, useEffect } from "react";
import type { CardDefinition, DeckEntry, InkColor, CardVariantType } from "@lorcana-sim/engine";
import { parseDecklist, serializeDecklist } from "@lorcana-sim/engine";
import { getMaxCopies } from "../utils/deckRules.js";

const INK_COLOR_CLASS: Record<string, string> = {
  amber: "bg-amber-600 text-amber-100",
  amethyst: "bg-purple-600 text-purple-100",
  emerald: "bg-emerald-600 text-emerald-100",
  ruby: "bg-red-600 text-red-100",
  sapphire: "bg-blue-600 text-blue-100",
  steel: "bg-gray-500 text-gray-100",
};

// Compact variant labels for the inline per-row tag. Omit "regular" since
// that's the implicit default and we only show the tag when variant is set.
const VARIANT_LABELS: Record<string, string> = {
  regular: "Reg",
  enchanted: "Ench",
  iconic: "Icon",
  epic: "Epic",
  promo: "Promo",
  special: "Spec",
};

interface Props {
  entries: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  onChange: (entries: DeckEntry[]) => void;
}

type GroupMode = "cost" | "type" | "none";
const GROUP_STORAGE_KEY = "deck-group-mode";

function useGroupMode(): [GroupMode, (m: GroupMode) => void] {
  const [mode, setMode] = useState<GroupMode>(() => {
    if (typeof window === "undefined") return "type";
    const saved = localStorage.getItem(GROUP_STORAGE_KEY);
    return saved === "type" || saved === "none" || saved === "cost" ? saved : "type";
  });
  const update = (m: GroupMode) => {
    setMode(m);
    if (typeof window !== "undefined") localStorage.setItem(GROUP_STORAGE_KEY, m);
  };
  return [mode, update];
}

export default function DeckBuilder({ entries, definitions, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [showImportExport, setShowImportExport] = useState<"import" | "export" | null>(null);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useGroupMode();
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalCards = entries.reduce((s, e) => s + e.count, 0);

  // ── Search results for add-card ──
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.values(definitions)
      .filter((d) => d.fullName.toLowerCase().includes(q))
      .sort((a, b) => {
        // Exact prefix match first, then shorter names (more relevant)
        const aStart = a.fullName.toLowerCase().startsWith(q) ? 0 : 1;
        const bStart = b.fullName.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.fullName.length - b.fullName.length;
      })
      .slice(0, 10);
  }, [query, definitions]);

  useEffect(() => { setHighlightedIdx(0); }, [query]);

  // ── Entry operations ──
  function addCard(def: CardDefinition) {
    const max = getMaxCopies(def);
    const existing = entries.findIndex((e) => e.definitionId === def.id);
    if (existing >= 0) {
      const current = entries[existing]!;
      if (current.count >= max) return;
      const next = [...entries];
      next[existing] = { ...current, count: current.count + 1 };
      onChange(next);
    } else {
      onChange([...entries, { definitionId: def.id, count: 1 }]);
    }
    setQuery("");
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  function adjustQty(definitionId: string, delta: number) {
    const idx = entries.findIndex((e) => e.definitionId === definitionId);
    if (idx < 0) return;
    const current = entries[idx]!;
    const def = definitions[definitionId];
    const max = def ? getMaxCopies(def) : 4;
    const newCount = Math.max(0, Math.min(max, current.count + delta));
    if (newCount === 0) {
      onChange(entries.filter((_, i) => i !== idx));
    } else {
      const next = [...entries];
      next[idx] = { ...current, count: newCount };
      onChange(next);
    }
  }

  function cycleVariant(definitionId: string) {
    const idx = entries.findIndex((e) => e.definitionId === definitionId);
    if (idx < 0) return;
    const def = definitions[definitionId];
    if (!def?.variants || def.variants.length < 2) return;
    const current = entries[idx]!;
    // Treat undefined as "regular" — matches the default-display convention.
    const types = def.variants.map((v) => v.type);
    const currentType: CardVariantType = current.variant ?? "regular";
    const currentIdx = types.indexOf(currentType);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % types.length;
    const nextType = types[nextIdx]!;
    // Store undefined for "regular" to keep the persisted metadata minimal.
    const next = [...entries];
    next[idx] = {
      ...current,
      variant: nextType === "regular" ? undefined : nextType,
    };
    onChange(next);
  }

  // ── Import / Export ──
  function handleImport() {
    const parsed = parseDecklist(importText, definitions);
    if (parsed.errors.length > 0) {
      setImportErrors(parsed.errors);
      return;
    }
    // Merge with existing (or replace — choosing replace for clarity)
    onChange(parsed.entries);
    setShowImportExport(null);
    setImportText("");
    setImportErrors([]);
  }

  function openExport() {
    setShowImportExport("export");
  }

  // ── Sorted row view — sort by cost asc, then name ──
  const sortedRows = useMemo(() => {
    return [...entries]
      .map((entry) => ({
        entry,
        def: definitions[entry.definitionId],
      }))
      .filter((r) => r.def)
      .sort((a, b) => {
        const costDiff = (a.def!.cost ?? 0) - (b.def!.cost ?? 0);
        if (costDiff !== 0) return costDiff;
        return a.def!.fullName.localeCompare(b.def!.fullName);
      });
  }, [entries, definitions]);

  // ── Grouped view — bucket sortedRows per groupMode ──
  const groupedRows = useMemo(() => {
    if (groupMode === "none") {
      return sortedRows.length > 0
        ? [{ label: null, count: sortedRows.reduce((s, r) => s + r.entry.count, 0), rows: sortedRows }]
        : [];
    }
    const buckets = new Map<string, typeof sortedRows>();
    const order: string[] = [];
    for (const row of sortedRows) {
      let key: string;
      if (groupMode === "cost") {
        const c = row.def!.cost;
        key = c >= 8 ? "8+" : String(c);
      } else {
        // type
        key = row.def!.cardType;
      }
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(row);
    }
    // Stable order: cost asc for cost-grouping; canonical type order for
    // type-grouping (characters first — they're the bulk of most decks).
    if (groupMode === "cost") {
      order.sort((a, b) => {
        const an = a === "8+" ? 8 : Number(a);
        const bn = b === "8+" ? 8 : Number(b);
        return an - bn;
      });
    } else {
      const TYPE_ORDER = ["character", "action", "item", "location"];
      order.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
    }
    return order.map((key) => {
      const rows = buckets.get(key)!;
      const count = rows.reduce((s, r) => s + r.entry.count, 0);
      const label = groupMode === "cost"
        ? `Cost ${key}`
        : key.charAt(0).toUpperCase() + key.slice(1) + (rows.length === 1 ? "" : "s");
      return { label, count, rows };
    });
  }, [sortedRows, groupMode]);

  return (
    <div className="space-y-3">
      {/* Add card search */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5
                         text-sm text-gray-200 placeholder-gray-600
                         focus:border-amber-500 focus:outline-none"
              placeholder="Add a card — type name..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={(e) => {
                if (!showDropdown || searchResults.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightedIdx((i) => Math.min(i + 1, searchResults.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightedIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const def = searchResults[highlightedIdx];
                  if (def) addCard(def);
                } else if (e.key === "Escape") {
                  setShowDropdown(false);
                }
              }}
            />
          </div>
          <button
            className="btn-ghost text-xs py-2 px-3"
            onClick={() => setShowImportExport("import")}
            title="Import from decklist text"
          >
            Import
          </button>
          {entries.length > 0 && (
            <button
              className="btn-ghost text-xs py-2 px-3"
              onClick={openExport}
              title="Export as decklist text"
            >
              Export
            </button>
          )}
        </div>

        {showDropdown && searchResults.length > 0 && (
          <div className="absolute z-30 top-full left-0 right-0 mt-1 rounded-lg border border-gray-700 bg-gray-900 shadow-xl overflow-hidden max-h-80 overflow-y-auto">
            {searchResults.map((d, i) => {
              const existing = entries.find((e) => e.definitionId === d.id);
              const max = getMaxCopies(d);
              const atMax = existing && existing.count >= max;
              return (
                <button
                  key={d.id}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                    i === highlightedIdx ? "bg-gray-800" : "hover:bg-gray-800"
                  } ${atMax ? "opacity-50" : ""}`}
                  onMouseEnter={() => setHighlightedIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); if (!atMax) addCard(d); }}
                  disabled={!!atMax}
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-white text-xs font-black shrink-0">
                    {d.cost}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">{d.fullName}</div>
                    <div className="text-[10px] text-gray-500 capitalize">{d.cardType}</div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    {d.inkColors.map((c) => (
                      <span key={c} className={`w-2 h-2 rounded-full ${INK_COLOR_CLASS[c]?.split(" ")[0] ?? "bg-gray-600"}`} />
                    ))}
                  </div>
                  {existing && (
                    <span className="text-xs text-amber-400 font-mono shrink-0">{existing.count}/{max}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Card count summary + group-by toggle */}
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-gray-500">
          {totalCards} cards, {entries.length} unique
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {totalCards !== 60 && totalCards > 0 && (
            <span className={totalCards < 60 ? "text-yellow-500" : "text-red-400"}>
              {totalCards < 60 ? `${60 - totalCards} to 60` : `${totalCards - 60} over 60`}
            </span>
          )}
          {totalCards === 60 && (
            <span className="text-green-400">✓ 60</span>
          )}
          {sortedRows.length > 0 && (
            <div className="relative flex items-center gap-1 text-[10px] text-gray-600">
              <span>Group:</span>
              {/* Custom dropdown — avoids the iOS native wheel picker AND
                   keeps horizontal footprint small (only the current option
                   shown). Opens a styled menu below on click. */}
              <button
                onClick={() => setGroupMenuOpen((v) => !v)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-gray-800 bg-gray-900 text-gray-300 hover:bg-gray-800 hover:border-gray-700 transition-colors"
                title="Change how deck rows are grouped"
              >
                <span className="font-medium">
                  {groupMode === "none" ? "None" : groupMode.charAt(0).toUpperCase() + groupMode.slice(1)}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-2.5 h-2.5 transition-transform ${groupMenuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {groupMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setGroupMenuOpen(false)} />
                  <div className="absolute z-50 top-full right-0 mt-1 rounded-md border border-gray-700 bg-gray-950 shadow-xl overflow-hidden min-w-[72px]">
                    {(["type", "cost", "none"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setGroupMode(m); setGroupMenuOpen(false); }}
                        className={`w-full text-left px-2 py-1 text-[10px] font-medium transition-colors ${
                          groupMode === m
                            ? "bg-amber-600 text-white"
                            : "text-gray-300 hover:bg-gray-800"
                        }`}
                      >
                        {m === "none" ? "None" : m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rows — grouped into sections per groupMode, or flat when mode=none */}
      {sortedRows.length > 0 ? (
        <div className="space-y-2">
          {groupedRows.map((group) => (
            <div key={group.label ?? "flat"} className="space-y-1">
              {group.label && (
                <div className="flex items-center gap-2 px-1 pt-1 text-[10px] uppercase tracking-wider font-bold text-gray-500">
                  <span>{group.label}</span>
                  <span className="text-gray-700 font-mono">{group.count}</span>
                </div>
              )}
              {group.rows.map(({ entry, def }) => (
                <DeckRow
                  key={entry.definitionId}
                  entry={entry}
                  def={def!}
                  onIncrement={() => adjustQty(entry.definitionId, 1)}
                  onDecrement={() => adjustQty(entry.definitionId, -1)}
                  onCycleVariant={() => cycleVariant(entry.definitionId)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-gray-600 border border-dashed border-gray-800 rounded-lg">
          Search above to add cards, or click Import to paste a decklist
        </div>
      )}

      {/* Import / Export modal */}
      {showImportExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
             onClick={() => { setShowImportExport(null); setImportErrors([]); }}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 max-w-lg w-full space-y-3"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-200">
                {showImportExport === "import" ? "Import Decklist" : "Export Decklist"}
              </h3>
              <button
                className="text-gray-500 hover:text-gray-300"
                onClick={() => { setShowImportExport(null); setImportErrors([]); }}
              >
                ✕
              </button>
            </div>

            {showImportExport === "import" ? (
              <>
                <p className="text-xs text-gray-500">
                  Paste a decklist below. Replaces current cards.
                </p>
                <textarea
                  className="w-full h-56 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono
                             text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
                  placeholder={"4 HeiHei - Boat Snack\n4 Stitch - New Dog\n..."}
                  value={importText}
                  onChange={(e) => { setImportText(e.target.value); setImportErrors([]); }}
                  spellCheck={false}
                />
                {importErrors.length > 0 && (
                  <div className="bg-red-950/40 border border-red-800 rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
                    {importErrors.map((err, i) => (
                      <p key={i} className="text-red-400 text-xs font-mono">{err}</p>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    className="btn-ghost text-xs py-2 px-3"
                    onClick={() => { setShowImportExport(null); setImportErrors([]); }}
                  >
                    Cancel
                  </button>
                  <button
                    className="py-2 px-4 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500
                               text-white rounded-lg text-xs font-bold transition-colors"
                    onClick={handleImport}
                    disabled={!importText.trim()}
                  >
                    Import
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  Copy this text to share or save elsewhere.
                </p>
                <textarea
                  readOnly
                  className="w-full h-56 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono
                             text-gray-200 focus:outline-none focus:border-amber-500 resize-none"
                  value={serializeDecklist(entries, definitions)}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    className="btn-ghost text-xs py-2 px-3"
                    onClick={() => {
                      navigator.clipboard.writeText(serializeDecklist(entries, definitions));
                    }}
                  >
                    Copy
                  </button>
                  <button
                    className="py-2 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-colors"
                    onClick={() => setShowImportExport(null)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DeckRow — one card entry with qty controls
// =============================================================================

interface RowProps {
  entry: DeckEntry;
  def: CardDefinition;
  onIncrement: () => void;
  onDecrement: () => void;
  onCycleVariant: () => void;
}

function DeckRow({ entry, def, onIncrement, onDecrement, onCycleVariant }: RowProps) {
  const max = getMaxCopies(def);
  const atMax = entry.count >= max;
  // Only used in the + button's disabled tooltip — the N/max display is
  // dropped from the inline stepper to reclaim horizontal space. Users hit
  // the disabled + to discover the cap on the rare non-4 cards.
  const maxLabel = max >= 99 ? "∞" : String(max);
  // Primary ink icon — most Lorcana characters are mono-ink; dual-ink shows
  // the first color here. The full ink set is still visible in the browser
  // grid / card inspect, so row density takes priority.
  const primaryInk = def.inkColors[0] as InkColor | undefined;
  const hasVariantPicker = (def.variants?.length ?? 0) >= 2;
  // Tag label: the current variant's short name. Renders only for cards
  // with ≥2 printings. Clicking cycles through all variant types.
  const variantLabel = hasVariantPicker
    ? VARIANT_LABELS[entry.variant ?? "regular"]
    : null;

  return (
    <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors">
      {/* Cost */}
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 text-white text-xs font-black shrink-0">
        {def.cost}
      </span>

      {/* Ink icon — single colored gem, not the dot pair */}
      {primaryInk && (
        <img
          src={`/icons/ink/${primaryInk}.svg`}
          alt={primaryInk}
          title={def.inkColors.join(" / ")}
          className="w-4 h-4 shrink-0"
        />
      )}

      {/* Name — takes all remaining space, truncates. Variant tag (when
           card has ≥2 printings) sits at the end of the name line and
           cycles through available variants on click. */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="text-sm text-gray-200 truncate">{def.fullName}</span>
        {variantLabel && (
          <button
            onClick={onCycleVariant}
            className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded transition-colors ${
              entry.variant
                ? "bg-amber-600 text-white hover:bg-amber-500"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
            title={`Variant: ${variantLabel}. Click to cycle.`}
          >
            {variantLabel}
          </button>
        )}
      </div>

      {/* Qty stepper — [−] N/max [+]. No trailing × because − at qty 1
           already removes the entry (via adjustQty clamping to 0). */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-sm font-bold transition-colors active:scale-95"
          onClick={onDecrement}
          title={entry.count === 1 ? "Remove card" : "Decrease quantity"}
        >
          −
        </button>
        <span className="px-1.5 text-[11px] font-mono font-bold tabular-nums text-amber-400 min-w-[18px] text-center">
          {entry.count}
        </span>
        <button
          className={`w-6 h-6 rounded text-sm font-bold transition-colors active:scale-95 ${
            atMax
              ? "bg-gray-900 text-gray-700 cursor-not-allowed"
              : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200"
          }`}
          onClick={onIncrement}
          disabled={atMax}
          title={atMax ? `Max ${maxLabel} copies` : "Increase quantity"}
        >
          +
        </button>
      </div>
    </div>
  );
}
