// =============================================================================
// DeckBuilder — row-based visual deck editor with autocomplete add-card search
// Each card is a row (name + cost + ink + qty +/- + remove).
// Paste import / export for bulk input & sharing.
// =============================================================================

import React, { useState, useMemo, useRef, useEffect } from "react";
import type { CardDefinition, DeckEntry } from "@lorcana-sim/engine";
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

interface Props {
  entries: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  onChange: (entries: DeckEntry[]) => void;
}

export default function DeckBuilder({ entries, definitions, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [showImportExport, setShowImportExport] = useState<"import" | "export" | null>(null);
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
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

  function removeCard(definitionId: string) {
    onChange(entries.filter((e) => e.definitionId !== definitionId));
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

  // ── Cost curve — bucket deck by cost (1..7, 8+) ──
  const costCurve = useMemo(() => {
    const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    for (const row of sortedRows) {
      const bucket = row.def!.cost >= 8 ? 8 : Math.max(1, row.def!.cost);
      buckets[bucket] = (buckets[bucket] ?? 0) + row.entry.count;
    }
    const max = Math.max(1, ...Object.values(buckets));
    return { buckets, max };
  }, [sortedRows]);

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

      {/* Card count summary */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">
          {totalCards} cards, {entries.length} unique
        </span>
        {totalCards !== 60 && totalCards > 0 && (
          <span className={totalCards < 60 ? "text-yellow-500" : "text-red-400"}>
            {totalCards < 60 ? `${60 - totalCards} more for legal deck` : `${totalCards - 60} over legal deck`}
          </span>
        )}
        {totalCards === 60 && (
          <span className="text-green-400">✓ Legal deck size</span>
        )}
      </div>

      {/* Cost curve — inline bar chart */}
      {sortedRows.length > 0 && (
        <div className="flex items-end gap-1 h-10 px-0.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((cost) => {
            const count = costCurve.buckets[cost] ?? 0;
            const pct = (count / costCurve.max) * 100;
            return (
              <div key={cost} className="flex-1 flex flex-col items-center gap-0.5">
                <div className="flex-1 w-full flex items-end">
                  <div
                    className={`w-full rounded-t-sm transition-all ${count > 0 ? "bg-amber-600/70" : "bg-gray-800"}`}
                    style={{ height: count > 0 ? `${pct}%` : "2px" }}
                    title={`Cost ${cost === 8 ? "8+" : cost}: ${count} card${count === 1 ? "" : "s"}`}
                  />
                </div>
                <div className="text-[9px] font-mono text-gray-600">{cost === 8 ? "8+" : cost}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rows */}
      {sortedRows.length > 0 ? (
        <div className="space-y-1">
          {sortedRows.map(({ entry, def }) => (
            <DeckRow
              key={entry.definitionId}
              entry={entry}
              def={def!}
              onIncrement={() => adjustQty(entry.definitionId, 1)}
              onDecrement={() => adjustQty(entry.definitionId, -1)}
              onRemove={() => removeCard(entry.definitionId)}
            />
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
  onRemove: () => void;
}

function DeckRow({ entry, def, onIncrement, onDecrement, onRemove }: RowProps) {
  const max = getMaxCopies(def);
  const atMax = entry.count >= max;

  return (
    <div className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors">
      {/* Cost */}
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-800 text-white text-xs font-black shrink-0">
        {def.cost}
      </span>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-200 truncate">{def.fullName}</div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
          <span className="capitalize">{def.cardType}</span>
          {def.cardType === "character" && def.strength != null && (
            <>
              <span>&middot;</span>
              <span>{def.strength}/{def.willpower}</span>
              {def.lore != null && (
                <>
                  <span>&middot;</span>
                  <span>{def.lore}◆</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Ink dots */}
      <div className="flex gap-0.5 shrink-0">
        {def.inkColors.map((c) => (
          <span key={c} className={`w-2 h-2 rounded-full ${INK_COLOR_CLASS[c]?.split(" ")[0] ?? "bg-gray-600"}`} />
        ))}
      </div>

      {/* Qty controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-xs font-bold transition-colors active:scale-95"
          onClick={onDecrement}
          title="Decrease quantity"
        >
          −
        </button>
        <span className="w-5 text-center text-sm font-mono font-bold text-amber-400">
          {entry.count}
        </span>
        <button
          className={`w-6 h-6 rounded text-xs font-bold transition-colors active:scale-95 ${
            atMax
              ? "bg-gray-900 text-gray-700 cursor-not-allowed"
              : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200"
          }`}
          onClick={onIncrement}
          disabled={atMax}
          title={atMax ? `Max ${max} copies` : "Increase quantity"}
        >
          +
        </button>
      </div>

      {/* Remove */}
      <button
        className="w-6 h-6 rounded text-gray-700 hover:text-red-400 hover:bg-red-950/40 transition-colors active:scale-95"
        onClick={onRemove}
        title="Remove card"
      >
        ✕
      </button>
    </div>
  );
}
