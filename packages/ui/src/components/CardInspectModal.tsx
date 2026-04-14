import React from "react";
import type { CardDefinition, GameState, GameModifiers } from "@lorcana-sim/engine";
import { getEffectiveStrength, getEffectiveWillpower } from "@lorcana-sim/engine";
import Icon from "./Icon.js";

type CardBtn = { label: string; color: string; onClick: (e: React.MouseEvent) => void };

interface Props {
  instanceId: string;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  actions: CardBtn[];
  onClose: () => void;
  gameModifiers?: GameModifiers | null;
}

// Ink color → badge color class
const INK_COLOR_CLASS: Record<string, string> = {
  amber: "bg-amber-600 text-amber-100",
  amethyst: "bg-purple-600 text-purple-100",
  emerald: "bg-emerald-600 text-emerald-100",
  ruby: "bg-red-600 text-red-100",
  sapphire: "bg-blue-600 text-blue-100",
  steel: "bg-gray-500 text-gray-100",
};

export default function CardInspectModal({ instanceId, gameState, definitions, actions, onClose, gameModifiers }: Props) {
  const instance = gameState.cards[instanceId];
  const def = instance ? definitions[instance.definitionId] : undefined;

  // Current effective stats (clamped)
  const staticBonus = gameModifiers?.statBonuses.get(instanceId);
  const effStrength = instance && def && def.strength != null
    ? getEffectiveStrength(instance, def, staticBonus?.strength ?? 0)
    : null;
  const effWillpower = instance && def && def.willpower != null
    ? getEffectiveWillpower(instance, def, staticBonus?.willpower ?? 0)
    : null;

  // Keywords: printed + granted
  const printedKeywords = def?.abilities
    .filter((a): a is { type: "keyword"; keyword: string; value?: number } => a.type === "keyword")
    .map((a) => a.value != null ? `${capitalize(a.keyword)} +${a.value}` : capitalize(a.keyword)) ?? [];
  const grantedKws = instance?.grantedKeywords?.map((k) => capitalize(k)) ?? [];
  const timedKws = (instance?.timedEffects ?? [])
    .filter((te: any) => te.type === "grant_keyword" && te.keyword)
    .map((te: any) => capitalize(te.keyword));
  const staticKws = gameModifiers?.grantedKeywords.get(instanceId)?.map((g: any) => capitalize(g.keyword)) ?? [];
  // Merge and deduplicate
  const allKeywords = [...new Set([...printedKeywords, ...grantedKws, ...timedKws, ...staticKws])];

  // Traits: printed + granted
  const traits = [...(def?.traits ?? [])];
  const grantedTraits = gameModifiers?.grantedTraits.get(instanceId);
  if (grantedTraits) {
    for (const t of grantedTraits) {
      if (!traits.includes(t)) traits.push(t);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      // Only close when the actual backdrop is tapped, not when a scroll or
      // momentum touch bubbles up from inside content. stopPropagation on
      // the inner content handles descendant clicks but iOS touch momentum
      // can still synthesize clicks on the backdrop.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm shadow-2xl pb-[env(safe-area-inset-bottom,16px)] max-h-[90dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 transition-colors z-10"
          onClick={onClose}
        >
          <Icon name="x-mark" className="w-5 h-5" />
        </button>

        {/* Card image */}
        <div className="flex justify-center pt-4 px-4">
          {def?.imageUrl ? (
            <img
              src={def.imageUrl}
              alt={def.fullName}
              className="rounded-xl shadow-lg max-h-[45vh] sm:max-h-[50vh] object-contain"
              draggable={false}
            />
          ) : (
            <div className="w-48 aspect-[5/7] rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <span className="text-gray-500 text-sm text-center px-4">{def?.fullName ?? instanceId}</span>
            </div>
          )}
        </div>

        {/* Card info */}
        {def && (
          <div className="px-4 pt-3 space-y-2">
            {/* Name + cost */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-white font-bold text-sm truncate">{def.fullName}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span className="capitalize">{def.cardType}</span>
                  <span>&middot;</span>
                  <span>{def.rarity.replace("_", " ")}</span>
                  <span>&middot;</span>
                  <span>Set {def.setId} #{def.number}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {def.inkColors.map((c) => (
                  <span key={c} className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${INK_COLOR_CLASS[c] ?? "bg-gray-600 text-gray-200"}`}>
                    {c}
                  </span>
                ))}
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-700 text-white text-xs font-black">
                  {def.cost}
                </span>
              </div>
            </div>

            {/* Traits */}
            {traits.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {traits.map((t, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-300">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Stats row (characters/locations) */}
            {(def.strength != null || def.willpower != null || def.lore != null || def.moveCost != null) && (
              <div className="flex items-center gap-3 text-xs">
                {def.strength != null && (
                  <StatPill
                    label="STR"
                    base={def.strength}
                    effective={effStrength}
                  />
                )}
                {def.willpower != null && (
                  <StatPill
                    label="WIL"
                    base={def.willpower}
                    effective={effWillpower}
                  />
                )}
                {def.lore != null && (
                  <span className="text-amber-400 font-bold">Lore: {def.lore}</span>
                )}
                {def.moveCost != null && (
                  <span className="text-cyan-400 font-bold">Move: {def.moveCost}</span>
                )}
                {def.shiftCost != null && (
                  <span className="text-purple-400 font-bold">Shift: {def.shiftCost}</span>
                )}
              </div>
            )}

            {/* Keywords */}
            {allKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {allKeywords.map((kw, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] text-slate-200 font-medium">
                    {kw}
                  </span>
                ))}
              </div>
            )}

            {/* In-play state */}
            {instance && instance.zone === "play" && (
              <div className="flex flex-wrap gap-2 text-[10px]">
                {instance.damage > 0 && (
                  <span className="text-red-400 font-bold">Damage: {instance.damage}</span>
                )}
                {instance.isExerted && (
                  <span className="text-yellow-400 font-bold">Exerted</span>
                )}
                {instance.isDrying && (
                  <span className="text-cyan-400 font-bold">Drying</span>
                )}
                {instance.cardsUnder.length > 0 && (
                  <span className="text-gray-400">{instance.cardsUnder.length} card{instance.cardsUnder.length !== 1 ? "s" : ""} under</span>
                )}
              </div>
            )}

            {/* Rules text */}
            {def.rulesText && (
              <div className="text-gray-300 text-xs leading-relaxed border-t border-gray-800 pt-2 whitespace-pre-line">
                {def.rulesText}
              </div>
            )}

            {/* Flavor text */}
            {def.flavorText && (
              <div className="text-gray-600 text-[10px] italic">
                {def.flavorText}
              </div>
            )}

            {/* Active timed effects on this card — show source card's actual rules text */}
            {instance && instance.timedEffects.length > 0 && (
              <div className="border-t border-gray-800 pt-2 space-y-1.5">
                <div className="text-[9px] text-gray-600 uppercase tracking-wider font-bold">Active Effects</div>
                {instance.timedEffects.map((te: any, i: number) => {
                  const srcInst = te.sourceInstanceId ? gameState.cards[te.sourceInstanceId] : undefined;
                  const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
                  // Find the ability on the source card that produced this effect
                  const srcAbility = srcDef?.abilities.find((a: any) =>
                    a.type !== "keyword" && (a.rulesText || a.storyName)
                  ) as { storyName?: string; rulesText?: string } | undefined;
                  const srcText = srcAbility
                    ? (srcAbility.storyName ? `${srcAbility.storyName} — ${srcAbility.rulesText ?? ""}` : (srcAbility.rulesText ?? ""))
                    : (srcDef?.rulesText ?? "");
                  const srcName = srcDef?.fullName ?? "Unknown";
                  const duration = formatDuration(te.expiresAt);
                  return (
                    <div key={i} className="rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-indigo-300 truncate">{srcName}</span>
                        <span className="text-[9px] text-gray-600 shrink-0">{duration}</span>
                      </div>
                      {srcText && (
                        <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{srcText.trim()}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
            {actions.map((btn, i) => (
              <button
                key={i}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors active:scale-95 ${btn.color}`}
                onClick={(e) => { btn.onClick(e); onClose(); }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* No actions: just padding */}
        {actions.length === 0 && <div className="pb-4" />}
      </div>
    </div>
  );
}

// Stat pill: shows base → effective when modified
function StatPill({ label, base, effective }: { label: string; base: number; effective: number | null }) {
  const modified = effective != null && effective !== base;
  const color = modified
    ? (effective! > base ? "text-green-400" : "text-red-400")
    : "text-gray-300";
  return (
    <span className={`font-bold ${color}`}>
      {label} {effective ?? base}
      {modified && <span className="text-gray-600 text-[9px] ml-0.5">({base})</span>}
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDuration(d: string): string {
  switch (d) {
    case "end_of_turn": return "This turn";
    case "end_of_owner_next_turn": return "Until their next turn";
    case "until_caster_next_turn": return "Until your next turn";
    case "end_of_next_turn": return "Until next turn";
    case "while_in_play": return "While in play";
    case "permanent": return "Permanent";
    case "once": return "Once";
    default: return d.replace(/_/g, " ");
  }
}
