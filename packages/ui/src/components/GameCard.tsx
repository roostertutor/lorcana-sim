// =============================================================================
// GameCard — Visual card component for board zones and hand
// =============================================================================

import React from "react";
import type { CardDefinition, GameState } from "@lorcana-sim/engine";

// Ink color → gradient + border
const INK_THEME: Record<string, { border: string; gradFrom: string; gradTo: string; costBg: string; glow: string }> = {
  amber:    { border: "border-amber-500/70",   gradFrom: "from-amber-900/50",   gradTo: "to-amber-950/80",   costBg: "bg-amber-500",   glow: "shadow-amber-500/20" },
  amethyst: { border: "border-purple-500/70",  gradFrom: "from-purple-900/50",  gradTo: "to-purple-950/80",  costBg: "bg-purple-500",  glow: "shadow-purple-500/20" },
  emerald:  { border: "border-emerald-500/70", gradFrom: "from-emerald-900/50", gradTo: "to-emerald-950/80", costBg: "bg-emerald-500", glow: "shadow-emerald-500/20" },
  ruby:     { border: "border-red-500/70",     gradFrom: "from-red-900/50",     gradTo: "to-red-950/80",     costBg: "bg-red-500",     glow: "shadow-red-500/20" },
  sapphire: { border: "border-blue-500/70",    gradFrom: "from-blue-900/50",    gradTo: "to-blue-950/80",    costBg: "bg-blue-500",    glow: "shadow-blue-500/20" },
  steel:    { border: "border-gray-400/70",    gradFrom: "from-gray-700/50",    gradTo: "to-gray-900/80",    costBg: "bg-gray-400",    glow: "shadow-gray-400/20" },
};

const DEFAULT_THEME = INK_THEME.steel!;

interface Props {
  instanceId: string;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  isSelected: boolean;
  onClick: () => void;
  zone: "play" | "hand";
  /** Pulse ring — valid target for pending challenge or shift */
  isTarget?: boolean;
  /** Solid ring — this card is the selected attacker/shifter */
  isAttacker?: boolean;
}

export default function GameCard({ instanceId, gameState, definitions, isSelected, onClick, zone, isTarget, isAttacker }: Props) {
  const instance = gameState.cards[instanceId];
  if (!instance) return null;
  const def = definitions[instance.definitionId];
  if (!def) return null;

  const inkColor = def.inkColors[0] ?? "steel";
  const theme = INK_THEME[inkColor] ?? DEFAULT_THEME;

  const isExerted = zone === "play" && instance.isExerted;
  const isDrying = zone === "play" && instance.isDrying;
  const damage = zone === "play" ? instance.damage : 0;

  const strength = def.strength != null
    ? def.strength + (instance.tempStrengthModifier ?? 0)
    : null;
  const willpower = def.willpower != null
    ? (def.willpower ?? 0) + (instance.tempWillpowerModifier ?? 0) - damage
    : null;

  return (
    <div
      className={`game-card relative border-2 rounded-xl w-[88px] sm:w-[104px] lg:w-[120px] shrink-0 cursor-pointer
        transition-all duration-200 bg-gradient-to-b ${theme.gradFrom} ${theme.gradTo}
        ${isAttacker ? "border-orange-400 ring-2 ring-orange-400/60 scale-105 z-10" :
          isSelected ? "border-amber-400 ring-2 ring-amber-400/40 scale-105 z-10" :
          isTarget ? "border-red-400 ring-2 ring-red-400/50 animate-pulse z-10" :
          theme.border}
        ${isExerted ? "rotate-[15deg] opacity-70" : ""}
        hover:scale-105 hover:z-10 hover:shadow-lg hover:${theme.glow}`}
      onClick={onClick}
    >
      {/* Top bar: cost + type */}
      <div className="flex items-start justify-between px-2 pt-1.5">
        <div className={`w-6 h-6 rounded-full ${theme.costBg} flex items-center justify-center text-[11px] font-black text-white shadow-md`}>
          {def.cost}
        </div>
        <div className="text-[8px] text-gray-500 uppercase tracking-wide mt-1">
          {def.cardType}
        </div>
      </div>

      {/* Card art */}
      <div className="relative mx-1.5 mt-1 rounded-md overflow-hidden" style={{ aspectRatio: "5/7", maxHeight: "52%" }}>
        {def.imageUrl ? (
          <img
            src={def.imageUrl}
            alt={def.fullName}
            loading="lazy"
            decoding="async"
            width={480}
            height={680}
            className="w-full h-full object-cover object-top"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-b ${theme.gradFrom} ${theme.gradTo} opacity-60`} />
        )}
      </div>

      {/* Name block */}
      <div className="px-2 mt-1.5">
        <div className="text-[11px] font-bold text-gray-100 leading-tight truncate">
          {def.name}
        </div>
        {def.subtitle && (
          <div className="text-[9px] text-gray-400 truncate leading-tight italic">
            {def.subtitle}
          </div>
        )}
      </div>

      {/* Traits */}
      {def.traits.length > 0 && (
        <div className="px-2 mt-0.5">
          <div className="text-[7px] text-gray-600 truncate uppercase tracking-wider">
            {def.traits.join(" · ")}
          </div>
        </div>
      )}

      {/* Bottom section: stats or inkable */}
      <div className="px-2 pb-2 mt-auto">
        {/* Character stats */}
        {strength != null && willpower != null && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-0.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-700/60 text-[10px] font-black text-orange-200">
                {strength}
              </span>
              <span className="text-gray-600 text-[9px]">/</span>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black ${
                damage > 0 ? "bg-red-700/60 text-red-200" : "bg-blue-700/60 text-blue-200"
              }`}>
                {willpower}
              </span>
            </div>
            {def.lore != null && def.lore > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: def.lore }, (_, i) => (
                  <span key={i} className="text-amber-400 text-[10px]">&#9670;</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hand: inkable indicator */}
        {zone === "hand" && def.inkable && (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-400/80" />
            <span className="text-[8px] text-blue-400 uppercase tracking-wider">Inkable</span>
          </div>
        )}
      </div>

      {/* State badges — floating over card */}
      {(isExerted || isDrying || damage > 0) && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
          {isExerted && (
            <span className="text-[7px] bg-yellow-600 text-yellow-100 px-1.5 py-0.5 rounded-full font-bold shadow">EXR</span>
          )}
          {isDrying && (
            <span className="text-[7px] bg-cyan-600 text-cyan-100 px-1.5 py-0.5 rounded-full font-bold shadow">DRY</span>
          )}
          {damage > 0 && (
            <span className="text-[7px] bg-red-600 text-red-100 px-1.5 py-0.5 rounded-full font-bold shadow">-{damage}</span>
          )}
        </div>
      )}
    </div>
  );
}
