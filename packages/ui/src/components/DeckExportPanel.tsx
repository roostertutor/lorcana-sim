// =============================================================================
// DeckExportPanel — off-screen styled render of a deck, for PNG export via
// html-to-image. Renders card thumbnails grouped by type with a quantity
// overlay on each. Depends on Ravensburger's CDN serving CORS headers for
// image fetches (html-to-image inlines external images as data URLs during
// canvas rasterization, which requires `Access-Control-Allow-Origin`).
// If Ravensburger ever stops sending CORS, images will render as empty
// placeholders — structure + text still exports.
// =============================================================================

import { forwardRef } from "react";
import type { CardDefinition, DeckEntry, InkColor } from "@lorcana-sim/engine";
import { deckInkColors, resolveEntryImageUrl } from "../utils/deckRules.js";

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
        // Fixed width — lots more horizontal room for a 5-card grid than
        // the previous text version needed. 800px still shareable on
        // Discord / Twitter without needing to zoom.
        width: "800px",
        background: "#030712", // gray-950
        color: "#e5e7eb", // gray-200
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Header: brand + deck name + meta */}
      <div style={{ borderBottom: "1px solid #1f2937", paddingBottom: "12px", marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
          ⬡ Lorcana Sim
        </div>
        <div style={{ fontSize: "24px", fontWeight: 900, color: "#fbbf24", marginTop: "4px", lineHeight: 1.2 }}>
          {deckName || "Untitled Deck"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
            {totalCards} cards
          </span>
          {inks.length > 0 && (
            <>
              <span style={{ color: "#4b5563" }}>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {inks.map((c) => (
                  <img
                    key={c}
                    src={`/icons/ink/${c}.svg`}
                    alt={c}
                    style={{ width: "14px", height: "14px" }}
                  />
                ))}
                <span style={{ marginLeft: "2px" }}>
                  {inks.map((c) => titleCase(c)).join(" · ")}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Grouped card grid. Each unique card is one thumbnail with a
          quantity badge — a 4×Elsa deck shows one Elsa thumb with "×4"
          rather than four separate thumbs, which compresses a 60-card
          deck into ~16-24 unique tiles. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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
                  marginBottom: "6px",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "6px",
                  borderBottom: "1px solid #1f2937",
                  paddingBottom: "3px",
                }}
              >
                <span>{titleCase(t)}s</span>
                <span style={{ color: "#374151", fontFamily: "ui-monospace, monospace" }}>{groupCount}</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, 1fr)",
                  gap: "6px",
                }}
              >
                {list.map(({ e, def }) => {
                  const imgUrl = resolveEntryImageUrl(e, def!).replace("/digital/normal/", "/digital/small/");
                  return (
                    <div
                      key={e.definitionId}
                      style={{
                        position: "relative",
                        aspectRatio: "5 / 7",
                        background: "#111827",
                        borderRadius: "6px",
                        overflow: "hidden",
                        border: "1px solid #1f2937",
                      }}
                    >
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={def!.fullName}
                          crossOrigin="anonymous"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "9px",
                            color: "#4b5563",
                            padding: "4px",
                            textAlign: "center",
                          }}
                        >
                          {def!.fullName}
                        </div>
                      )}
                      {/* Quantity badge — bottom-right so it never hides
                           the card's cost pip in the top-left of the art */}
                      <div
                        style={{
                          position: "absolute",
                          bottom: "2px",
                          right: "2px",
                          background: "#030712",
                          color: "#fbbf24",
                          fontWeight: 900,
                          fontSize: "11px",
                          fontFamily: "ui-monospace, monospace",
                          padding: "0 5px",
                          minWidth: "18px",
                          height: "18px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "9999px",
                          border: "1px solid #fbbf24",
                          lineHeight: 1,
                        }}
                      >
                        ×{e.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ marginTop: "18px", paddingTop: "12px", borderTop: "1px solid #1f2937", fontSize: "10px", color: "#4b5563", textAlign: "center", letterSpacing: "0.05em" }}>
        Made with Lorcana Sim · lorcanasim.app
      </div>
    </div>
  );
});

export default DeckExportPanel;
