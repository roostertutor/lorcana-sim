// =============================================================================
// CardTextRender — structured HTML rendering of a CardDefinition.
// No art, no frame — just the gameplay-relevant fields as real text.
// Alternative to the rasterized card image for small overlays, choice pickers,
// triggered-ability lists, and anywhere else readability > decoration.
// =============================================================================

import type { CardDefinition, Ability, InkColor } from "@lorcana-sim/engine";
import Glyph from "./Glyph.js";
import { renderRulesText } from "../utils/rulesTextRender.js";

// Background colors match the primary fill of each ink's SVG icon
// (assets/icons/ink/) for visual consistency with gem indicators
// elsewhere. /30 alpha gives a subtle tint on the ink-chip badge
// without overpowering the text.
const INK_COLOR_STYLES: Record<InkColor, { bg: string; text: string; label: string }> = {
  amber: { bg: "bg-[#f4b223]/30", text: "text-amber-200", label: "Amber" },
  amethyst: { bg: "bg-[#7c4182]/30", text: "text-purple-200", label: "Amethyst" },
  emerald: { bg: "bg-[#329044]/30", text: "text-emerald-200", label: "Emerald" },
  ruby: { bg: "bg-[#d50037]/30", text: "text-red-200", label: "Ruby" },
  sapphire: { bg: "bg-[#0093c9]/30", text: "text-sky-200", label: "Sapphire" },
  steel: { bg: "bg-[#97a3ae]/30", text: "text-gray-200", label: "Steel" },
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function renderAbility(ability: Ability, i: number): JSX.Element {
  if (ability.type === "keyword") {
    const label = capitalize(ability.keyword);
    const value = ability.value != null ? ` +${ability.value}` : "";
    return (
      <div key={i} className="text-[10px]">
        <span className="font-bold text-amber-200">{label}{value}</span>
      </div>
    );
  }
  const storyName = (ability as { storyName?: string }).storyName;
  const rulesText = (ability as { rulesText?: string }).rulesText;
  return (
    <div key={i} className="text-[10px] leading-snug">
      {storyName && <span className="font-bold text-amber-200 uppercase tracking-wide">{storyName} — </span>}
      {rulesText && <span className="text-gray-300">{renderRulesText(rulesText, 10)}</span>}
    </div>
  );
}

interface Props {
  def: CardDefinition;
  /** Compact variant: smaller type, tighter spacing. Default: false (normal). */
  compact?: boolean;
}

export default function CardTextRender({ def, compact = false }: Props) {
  const isCharacter = def.cardType === "character";
  const isLocation = def.cardType === "location";
  const isItem = def.cardType === "item";
  const isAction = def.cardType === "action";

  const inkChipStyle = def.inkColors[0] ? INK_COLOR_STYLES[def.inkColors[0]] : null;

  return (
    <div className={`rounded-lg bg-gray-900 border border-gray-700 ${compact ? "p-2" : "p-3"} space-y-1.5`}>
      {/* Header row: cost | name + subtitle | ink color chip */}
      <div className="flex items-start gap-2">
        <div className="shrink-0 flex flex-col items-center">
          <div className="w-6 h-6 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center text-white font-black text-xs">
            {def.cost}
          </div>
          {def.inkable && (
            <div className="text-[7px] text-amber-300 font-bold mt-0.5">INK</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-black text-white truncate ${compact ? "text-xs" : "text-sm"}`}>{def.name}</div>
          {def.subtitle && (
            <div className="text-[10px] text-gray-400 italic truncate">{def.subtitle}</div>
          )}
        </div>
        {inkChipStyle && (
          <div className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${inkChipStyle.bg} ${inkChipStyle.text}`}>
            {inkChipStyle.label}
          </div>
        )}
      </div>

      {/* Stats line (characters) — glyphs replace STR/WILL/LORE labels for
           visual density. Each stat keeps its color tint via text-* on the
           wrapper span, which Glyph picks up via bg-current. */}
      {isCharacter && (
        <div className="flex items-center gap-3 text-[10px] border-y border-gray-800 py-1">
          <span className="inline-flex items-center gap-1 text-red-400"><Glyph name="strength" size={12} /><span className="text-white font-bold">{def.strength ?? 0}</span></span>
          <span className="inline-flex items-center gap-1 text-gray-300"><Glyph name="willpower" size={12} /><span className="text-white font-bold">{def.willpower ?? 0}</span></span>
          <span className="inline-flex items-center gap-1 text-amber-400"><Glyph name="lore" size={12} /><span className="text-white font-bold">{def.lore ?? 0}</span></span>
        </div>
      )}

      {/* Locations: move cost + willpower + lore */}
      {isLocation && (
        <div className="flex items-center gap-3 text-[10px] border-y border-gray-800 py-1">
          {def.moveCost != null && (
            <span className="inline-flex items-center gap-1 text-cyan-400"><Glyph name="move-cost" size={12} /><span className="text-white font-bold">{def.moveCost}</span></span>
          )}
          {def.willpower != null && (
            <span className="inline-flex items-center gap-1 text-gray-300"><Glyph name="willpower" size={12} /><span className="text-white font-bold">{def.willpower}</span></span>
          )}
          {def.lore != null && (
            <span className="inline-flex items-center gap-1 text-amber-400"><Glyph name="lore" size={12} /><span className="text-white font-bold">{def.lore}</span></span>
          )}
        </div>
      )}

      {/* Traits */}
      {def.traits.length > 0 && (
        <div className="text-[9px] text-gray-500 uppercase tracking-wider">
          {def.traits.join(" · ")}
        </div>
      )}

      {/* Abilities — structured rendering */}
      {def.abilities.length > 0 && (
        <div className="space-y-1 pt-0.5">
          {def.abilities.map(renderAbility)}
        </div>
      )}

      {/* Action effects — actions don't have abilities, their rulesText is the effect */}
      {(isAction || isItem) && def.rulesText && def.abilities.length === 0 && (
        <div className="text-[10px] text-gray-300 leading-snug pt-0.5">
          {renderRulesText(def.rulesText, 10)}
        </div>
      )}
    </div>
  );
}
