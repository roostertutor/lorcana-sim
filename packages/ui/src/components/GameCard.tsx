// =============================================================================
// GameCard — Visual card component for board zones and hand
// =============================================================================

import React, { useMemo } from "react";
import type { CardDefinition, GameState, GameModifiers, KeywordAbility } from "@lorcana-sim/engine";
import { getGameModifiers, getEffectiveStrength, getEffectiveWillpower } from "@lorcana-sim/engine";
import Icon from "./Icon.js";
import type { IconName } from "./Icon.js";

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
  /** Show card back instead of face (opponent hand) */
  faceDown?: boolean;
  /** Pulse ring — valid target for pending challenge or shift */
  isTarget?: boolean;
  /** Solid ring — this card is the selected attacker/shifter */
  isAttacker?: boolean;
  /** Suppress 90° rotation for inkwell fan display */
  skipRotation?: boolean;
  /** Pre-computed game modifiers — if not passed, computed internally */
  gameModifiers?: GameModifiers | null;
}

export default function GameCard({ instanceId, gameState, definitions, isSelected, onClick, zone, faceDown, isTarget, isAttacker, skipRotation, gameModifiers: externalMods }: Props) {
  const instance = gameState.cards[instanceId];
  if (!instance) return null;
  const def = definitions[instance.definitionId];
  if (!def) return null;

  // Compute modifiers once per state change (uses external if provided, else computes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mods = useMemo(() => externalMods ?? getGameModifiers(gameState, definitions), [externalMods, gameState, definitions]);

  // CRD 5.5.4: locations never exert and never dry
  const isLocation = def.cardType === "location";

  // Mobile width: play cards shrink to fit 7 ready across; exerted cards use rotated width so
  // flex layout nudges neighbours rather than overlapping them. Hand cards stay full size.
  const isExerted = !isLocation && instance.isExerted;
  const mobileWidth = faceDown
    ? "w-[52px]"
    : zone === "play"
    ? "w-[52px]"
    : "w-[88px]";

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
  };

  // ── Face-down card back (opponent hand) ──
  if (faceDown) {
    return (
      <div
        className={`${mobileWidth} sm:w-[104px] lg:w-[120px] aspect-[5/7] rounded-md sm:rounded-xl overflow-hidden shrink-0`}
        onClick={onClick}
        tabIndex={0}
        onKeyDown={handleKey}
        role="button"
        aria-label="Opponent card"
      >
        <img
          src="/card-back-small.jpg"
          alt="Card back"
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  const inkColor = def.inkColors[0] ?? "steel";
  const theme = INK_THEME[inkColor] ?? DEFAULT_THEME;

  const isDrying = zone === "play" && !isLocation && instance.isDrying;
  const damage = zone === "play" ? instance.damage : 0;

  // Use engine's effective-stat helpers (reads timedEffects, NOT the dead temp*Modifier fields)
  const staticBonus = mods?.statBonuses.get(instanceId);
  const strength = def.strength != null
    ? getEffectiveStrength(instance, def, staticBonus?.strength ?? 0)
    : null;
  const willpowerModified = def.willpower != null
    ? getEffectiveWillpower(instance, def, staticBonus?.willpower ?? 0)
    : null;

  const hasModifiedStats = (strength != null && strength !== (def.strength ?? 0))
    || (willpowerModified != null && willpowerModified !== (def.willpower ?? 0));

  // Keyword badges — check both printed abilities and dynamically granted keywords
  const BADGE_KEYWORDS = ["alert", "bodyguard", "challenger", "evasive", "reckless", "resist", "rush", "singer", "support", "ward"] as const;
  type BadgeKeyword = typeof BADGE_KEYWORDS[number];
  const keywordAbilities = def.abilities.filter((a): a is KeywordAbility => a.type === "keyword");
  const printedKeywords = new Set(keywordAbilities.map(a => a.keyword));
  const keywordValues = new Map(keywordAbilities.filter(a => a.value != null).map(a => [a.keyword, a.value!]));
  // Merge: printed keywords + instance-granted (TimedEffect) + static-granted (gameModifiers)
  const staticGranted = mods?.grantedKeywords.get(instanceId) ?? [];
  const allKeywords = new Set([
    ...printedKeywords,
    ...(instance.grantedKeywords ?? []),
    ...staticGranted.map(g => g.keyword),
  ]);
  // Also pick up static-granted keyword values (e.g. Resist +2 from Judy)
  for (const g of staticGranted) {
    if (g.value != null && !keywordValues.has(g.keyword)) keywordValues.set(g.keyword, g.value);
  }
  const activeKeywordBadges = zone === "play"
    ? BADGE_KEYWORDS.filter(k => allKeywords.has(k))
    : [];
  const KEYWORD_STYLE: Record<BadgeKeyword, string> = {
    alert:      "bg-lime-500/90",
    bodyguard:  "bg-blue-600/90",
    challenger: "bg-amber-500/90",
    evasive:    "bg-sky-500/90",
    reckless:   "bg-orange-600/90",
    resist:     "bg-rose-700/90",
    rush:       "bg-green-600/90",
    singer:     "bg-yellow-500/90",
    support:    "bg-teal-600/90",
    ward:       "bg-purple-600/90",
  };
  const KEYWORD_LABEL: Record<BadgeKeyword, string> = {
    alert:      "AL",
    bodyguard:  "BG",
    challenger: "CH",
    evasive:    "EV",
    reckless:   "RK",
    resist:     "RS",
    rush:       "RU",
    singer:     "SG",
    support:    "SP",
    ward:       "WD",
  };
  const KEYWORD_ICON: Record<BadgeKeyword, IconName> = {
    alert:      "eye",
    bodyguard:  "shield-check",
    challenger: "bolt",
    evasive:    "arrow-up",
    reckless:   "exclamation-triangle",
    resist:     "minus-circle",
    rush:       "arrow-right",
    singer:     "musical-note",
    support:    "user-plus",
    ward:       "lock-closed",
  };

  const ringClass = isAttacker
    ? "border-orange-400 ring-2 ring-orange-400/60 scale-105 z-10"
    : isSelected
    ? "border-amber-400 ring-2 ring-amber-400/40 scale-105 z-10"
    : isTarget
    ? "border-red-400 ring-2 ring-red-400/50 animate-pulse z-10"
    : theme.border;

  const baseClass = `game-card relative border-2 rounded-md sm:rounded-xl ${mobileWidth} sm:w-[104px] lg:w-[120px] shrink-0 cursor-pointer
    transition-all duration-200 ${ringClass}
    ${isExerted && !skipRotation ? "rotate-90 opacity-80" : ""}
    hover:scale-105 hover:z-10 hover:shadow-lg hover:${theme.glow}`;

  // ── With image: card art fills the frame, overlays show only game state ──
  if (def.imageUrl) {
    // Lorcast provides three sizes: small (~9KB), normal (~47KB), large (~71KB).
    // Board cards are displayed at 88–120px CSS width — small is sufficient.
    const boardImageUrl = def.imageUrl.replace("/digital/normal/", "/digital/small/");
    return (
      <div className={`${baseClass} aspect-[5/7] overflow-hidden`} onClick={onClick} tabIndex={0} onKeyDown={handleKey} role="button" aria-label={`${def.fullName}${isExerted ? ", exerted" : ""}${damage > 0 ? `, ${damage} damage` : ""}`}>
        <img
          src={boardImageUrl}
          alt={def.fullName}
          loading="lazy"
          decoding="async"
          width={200}
          height={280}
          className="w-full h-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />

        {/* Modified stats strip — only when temp buff/debuff active */}
        {hasModifiedStats && strength != null && willpowerModified != null && (
          <div className="absolute bottom-4 left-0 right-0 flex items-center justify-between px-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black bg-orange-500/90 text-white shadow">
              {strength}
            </span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black bg-blue-500/90 text-blue-100 shadow">
              {willpowerModified}
            </span>
          </div>
        )}

        {/* Keyword badges — right-side icon column */}
        {activeKeywordBadges.length > 0 && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none items-end">
            {activeKeywordBadges.map(k => {
              // Support's "value" is the card's current STR at resolution — not a fixed number to display
              const val = k === "support" ? undefined : keywordValues.get(k);
              return (
                <div key={k} className={`h-4 flex items-center gap-0.5 rounded-full px-1 shadow ${KEYWORD_STYLE[k]}`}>
                  <Icon name={KEYWORD_ICON[k]} className="w-2.5 h-2.5 text-white shrink-0" />
                  {val != null && <span className="text-white text-[8px] font-black leading-none">{val}</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Boost / cards-under stack indicator — bottom-left count badge */}
        {zone === "play" && instance.cardsUnder.length > 0 && (
          <div className="absolute bottom-0.5 left-0.5 z-10 pointer-events-none">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-black bg-violet-600/90 text-violet-100 shadow border border-violet-400/50">
              {instance.cardsUnder.length}
            </span>
          </div>
        )}

        {/* Summoning sickness overlay — blue-cyan wash, like MTGO */}
        {isDrying && (
          <div className="absolute inset-0 rounded-md sm:rounded-xl bg-cyan-400/25 pointer-events-none" />
        )}

        {/* Damage counter — centered on card */}
        {damage > 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-red-100 text-[9px] font-black shadow-lg border border-red-400/50">{damage}</span>
          </div>
        )}
      </div>
    );
  }

  // ── No image: full text layout fallback ──
  return (
    <div
      className={`${baseClass} bg-gradient-to-b ${theme.gradFrom} ${theme.gradTo}`}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={handleKey}
      role="button"
      aria-label={`${def.fullName}${isExerted ? ", exerted" : ""}${damage > 0 ? `, ${damage} damage` : ""}`}
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

      {/* Art placeholder */}
      <div className={`mx-2 mt-1 h-[3px] rounded-full bg-gradient-to-r ${theme.gradFrom} ${theme.gradTo} opacity-60`} />

      {/* Name block */}
      <div className="px-2 mt-1.5">
        <div className="text-[11px] font-bold text-gray-100 leading-tight truncate">{def.name}</div>
        {def.subtitle && (
          <div className="text-[9px] text-gray-400 truncate leading-tight italic">{def.subtitle}</div>
        )}
      </div>

      {/* Traits */}
      {def.traits.length > 0 && (
        <div className="px-2 mt-0.5">
          <div className="text-[7px] text-gray-600 truncate uppercase tracking-wider">{def.traits.join(" · ")}</div>
        </div>
      )}

      {/* Bottom: stats */}
      <div className="px-2 pb-2 mt-auto">
        {/* Locations: willpower + lore + moveCost (no strength) */}
        {isLocation && willpowerModified != null && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-0.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-700/60 text-[10px] font-black text-blue-200">{willpowerModified}</span>
              {def.moveCost != null && (
                <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded bg-cyan-700/60 text-[10px] font-black text-cyan-200" title="Move cost">{def.moveCost}</span>
              )}
            </div>
            {def.lore != null && def.lore > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: def.lore }, (_, i) => <span key={i} className="text-amber-400 text-[10px]">&#9670;</span>)}
              </div>
            )}
          </div>
        )}
        {!isLocation && strength != null && willpowerModified != null && (
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-0.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded bg-orange-700/60 text-[10px] font-black text-orange-200 ${hasModifiedStats ? "ring-1 ring-orange-400" : ""}`}>{strength}</span>
              <span className="text-gray-600 text-[9px]">/</span>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black ${hasModifiedStats ? "bg-blue-600/80 text-blue-100 ring-1 ring-blue-400" : "bg-blue-700/60 text-blue-200"}`}>{willpowerModified}</span>
            </div>
            {def.lore != null && def.lore > 0 && (
              <div className="flex items-center gap-0.5">
                {Array.from({ length: def.lore }, (_, i) => <span key={i} className="text-amber-400 text-[10px]">&#9670;</span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keyword badges — top-right column */}
      {activeKeywordBadges.length > 0 && (
        <div className="absolute top-1 right-1 flex flex-col gap-0.5 items-end pointer-events-none">
          {activeKeywordBadges.map(k => (
            <span key={k} className={`text-[7px] font-black px-1 py-0.5 rounded leading-none ${KEYWORD_STYLE[k]} shadow`}>
              {KEYWORD_LABEL[k]}
            </span>
          ))}
        </div>
      )}

      {/* Summoning sickness overlay */}
      {isDrying && (
        <div className="absolute inset-0 rounded-xl bg-cyan-400/25 pointer-events-none" />
      )}

      {/* Damage counter — centered on card */}
      {damage > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-red-100 text-[9px] font-black shadow-lg border border-red-400/50">{damage}</span>
        </div>
      )}
    </div>
  );
}
