// =============================================================================
// DeckExportPanel — off-screen styled render of a deck, for PNG export via
// html-to-image. Text-only deck list (no external card art, to avoid CORS
// issues with the Ravensburger image CDN). Dark brand-matched styling so
// exports feel like "the app" when shared to Discord / Twitter.
// =============================================================================

import { forwardRef } from "react";
import type { CardDefinition, DeckEntry, InkColor } from "@lorcana-sim/engine";
import { INK_COLOR_CLASS, deckInkColors } from "../utils/deckRules.js";

interface Props {
  deckName: string;
  entries: DeckEntry[];
  definitions: Record<string, CardDefinition>;
}

const TYPE_ORDER = ["character", "action", "item", "location"] as const;

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DeckExportPanel = forwardRef<HTMLDivElement, Props>(function DeckExportPanel(
  { deckName, entries, definitions },
  ref,
) {
  // Group by type, sort each group by cost → name.
  const rows = entries
    .map((e) => ({ e, def: definitions[e.definitionId] }))
    .filter((r) => r.def);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.def!.cardType;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const [, list] of groups) {
    list.sort((a, b) => {
      const costDiff = a.def!.cost - b.def!.cost;
      if (costDiff !== 0) return costDiff;
      return a.def!.fullName.localeCompare(b.def!.fullName);
    });
  }
  const totalCards = entries.reduce((s, e) => s + e.count, 0);
  const inks = deckInkColors(entries, definitions);

  return (
    <div
      ref={ref}
      style={{
        // Fixed width for predictable output dimensions.
        width: "600px",
        background: "#030712", // gray-950
        color: "#e5e7eb", // gray-200
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Header: brand + deck name + meta */}
      <div style={{ borderBottom: "1px solid #1f2937", paddingBottom: "12px", marginBottom: "12px" }}>
        <div style={{ fontSize: "11px", color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
          ⬡ Lorcana Sim
        </div>
        <div style={{ fontSize: "22px", fontWeight: 900, color: "#fbbf24", marginTop: "4px", lineHeight: 1.2 }}>
          {deckName || "Untitled Deck"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
            {totalCards} cards
          </span>
          {inks.length > 0 && (
            <>
              <span style={{ color: "#4b5563" }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {inks.map((c) => (
                  <span
                    key={c}
                    className={INK_COLOR_CLASS[c as InkColor]}
                    style={{
                      display: "inline-block",
                      width: "10px",
                      height: "10px",
                      borderRadius: "9999px",
                    }}
                  />
                ))}
                <span style={{ marginLeft: "4px" }}>
                  {inks.map((c) => titleCase(c)).join(" · ")}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Grouped deck list */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
        {TYPE_ORDER.filter((t) => groups.has(t)).map((t) => {
          const list = groups.get(t)!;
          const groupCount = list.reduce((s, r) => s + r.e.count, 0);
          return (
            <div key={t}>
              <div
                style={{
                  fontSize: "10px",
                  color: "#6b7280",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  marginBottom: "4px",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "6px",
                  borderBottom: "1px solid #1f2937",
                  paddingBottom: "2px",
                }}
              >
                <span>{titleCase(t)}s</span>
                <span style={{ color: "#374151", fontFamily: "ui-monospace, monospace" }}>{groupCount}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {list.map(({ e, def }) => (
                  <div
                    key={e.definitionId}
                    style={{
                      fontSize: "12px",
                      display: "flex",
                      alignItems: "baseline",
                      gap: "6px",
                      lineHeight: 1.3,
                    }}
                  >
                    <span style={{ color: "#fbbf24", fontFamily: "ui-monospace, monospace", fontWeight: 700, width: "14px", textAlign: "right" }}>
                      {e.count}
                    </span>
                    <span style={{ color: "#6b7280", fontFamily: "ui-monospace, monospace", width: "14px", textAlign: "center" }}>
                      {def!.cost}
                    </span>
                    <span style={{ color: "#e5e7eb", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {def!.fullName}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #1f2937", fontSize: "10px", color: "#4b5563", textAlign: "center", letterSpacing: "0.05em" }}>
        Made with Lorcana Sim · lorcanasim.app
      </div>
    </div>
  );
});

export default DeckExportPanel;
