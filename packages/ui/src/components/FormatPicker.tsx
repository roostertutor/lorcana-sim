// =============================================================================
// FormatPicker — compact dropdown for the deck's declared GameFormat.
//
// Populated from the engine's registry via listFormatOptions() so when a new
// rotation lands (or one retires), the dropdown updates without any UI edit.
// Matches the visual pattern of the group-by picker in DeckBuilder:
//   button shows current selection → click opens a menu below → pick + close.
//
// Core = indigo accent, Infinity = orange accent — Hearthstone-style tiering;
// both avoid the six Lorcana ink colors so format chips never visually collide
// with ink indicators. Declared format drives the CardPicker / autocomplete
// filters and legality validation upstream.
// =============================================================================

import { useState } from "react";
import type { GameFormat } from "@lorcana-sim/engine";
import { FORMAT_FAMILY_ACCENT, formatDisplayName, listFormatOptions } from "../utils/deckRules.js";

interface Props {
  value: GameFormat;
  onChange: (next: GameFormat) => void;
  /** When true, the picker renders as a read-only chip instead of a dropdown —
   *  e.g. when the format is derived from a saved deck's stamp and the user
   *  can only change it by going into the deckbuilder. */
  readOnly?: boolean;
  /** Label shown above the button (e.g. "Format"). Omit for no label. */
  label?: string;
}

export default function FormatPicker({ value, onChange, readOnly = false, label }: Props) {
  const [open, setOpen] = useState(false);
  const options = listFormatOptions();
  const accent = FORMAT_FAMILY_ACCENT[value.family];
  const displayName = formatDisplayName(value);

  if (readOnly) {
    return (
      <div className="flex flex-col gap-0.5">
        {label && (
          <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
            {label}
          </span>
        )}
        <span
          className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold ${accent.badgeBg} ${accent.text} ${accent.border} border`}
          title={`Deck stamped as ${displayName}`}
        >
          {displayName}
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-0.5">
      {label && (
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
          {label}
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors border ${accent.badgeBg} ${accent.text} ${accent.border} hover:brightness-125`}
        title="Change the format this deck is built for"
      >
        <span>{displayName}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={3}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-outside backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 top-full left-0 mt-1 rounded-md border border-gray-700 bg-gray-950 shadow-xl overflow-hidden min-w-[140px]">
            {options.map((opt) => {
              const isCurrent = opt.family === value.family && opt.rotation === value.rotation;
              const optAccent = FORMAT_FAMILY_ACCENT[opt.family];
              return (
                <button
                  key={`${opt.family}-${opt.rotation}`}
                  onClick={() => {
                    onChange({ family: opt.family, rotation: opt.rotation });
                    setOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                    isCurrent
                      ? `${optAccent.badgeBg} ${optAccent.text}`
                      : `text-gray-300 hover:bg-gray-800`
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${opt.family === "core" ? "bg-indigo-400" : "bg-orange-400"}`} />
                  {opt.displayName}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
