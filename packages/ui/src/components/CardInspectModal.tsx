import React from "react";
import type { CardDefinition, GameState, GameModifiers } from "@lorcana-sim/engine";
import { getEffectiveStrength, getEffectiveWillpower } from "@lorcana-sim/engine";
import Icon from "./Icon.js";
import ModalFrame from "./ModalFrame.js";
import Glyph, { type GlyphName } from "./Glyph.js";
import { getInspectCardImage } from "../utils/cardImage.js";
import CardPlaceholder from "./CardPlaceholder.js";
import { renderRulesText } from "../utils/rulesTextRender.js";

type CardBtn = { label: string; color: string; onClick: (e: React.MouseEvent) => void };

interface Props {
  instanceId: string;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  actions: CardBtn[];
  onClose: () => void;
  gameModifiers?: GameModifiers | null;
}

// Ink color → badge color class. Background hex matches the primary
// fill of each ink's SVG icon in assets/icons/ink/ so the inspect
// badges visibly match the gems shown elsewhere in the app.
const INK_COLOR_CLASS: Record<string, string> = {
  amber: "bg-[#f4b223] text-amber-950",
  amethyst: "bg-[#7c4182] text-purple-100",
  emerald: "bg-[#329044] text-emerald-950",
  ruby: "bg-[#d50037] text-red-50",
  sapphire: "bg-[#0093c9] text-sky-950",
  steel: "bg-[#97a3ae] text-gray-950",
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
    <ModalFrame onClose={onClose} placement="bottom-sheet-mobile">
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
              {...getInspectCardImage(def.imageUrl)}
              alt={def.fullName}
              className="rounded-xl shadow-lg max-h-[45vh] sm:max-h-[50vh] object-contain"
              draggable={false}
            />
          ) : def ? (
            // Hand-entered cards won't have an imageUrl until Ravensburger
            // publishes them and the image-sync script runs. Render a
            // stat-complete placeholder so the card is still identifiable.
            <CardPlaceholder
              data={{
                name: def.name,
                subtitle: def.subtitle,
                cardType: def.cardType,
                inkColors: def.inkColors,
                cost: def.cost,
                inkable: def.inkable,
                traits: def.traits,
                strength: def.strength,
                willpower: def.willpower,
                lore: def.lore,
                rulesText: def.rulesText,
                rarity: def.rarity,
                setId: def.setId,
                number: def.number,
              }}
              className="w-48 aspect-[5/7]"
            />
          ) : (
            <div className="w-48 aspect-[5/7] rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <span className="text-gray-500 text-sm text-center px-4">{instanceId}</span>
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

            {/* Stats row (characters/locations). Glyphs replace text labels
                 (STR / WIL / Lore / Move) for visual density — Shift stays as
                 text since there's no glyph for it. */}
            {(def.strength != null || def.willpower != null || def.lore != null || def.moveCost != null) && (
              <div className="flex items-center gap-3 text-xs">
                {def.strength != null && (
                  <StatPill
                    glyph="strength"
                    base={def.strength}
                    effective={effStrength}
                  />
                )}
                {def.willpower != null && (
                  <StatPill
                    glyph="willpower"
                    base={def.willpower}
                    effective={effWillpower}
                  />
                )}
                {def.lore != null && (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                    <Glyph name="lore" size={14} />
                    {def.lore}
                  </span>
                )}
                {def.moveCost != null && (
                  <span className="inline-flex items-center gap-1 text-cyan-400 font-bold">
                    <Glyph name="move-cost" size={14} />
                    {def.moveCost}
                  </span>
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

            {/* Rules text — inline {S}/{W}/{L}/{E}/{C}/{I} tokens get
                 swapped for glyphs by renderRulesText. */}
            {def.rulesText && (
              <div className="text-gray-300 text-xs leading-relaxed border-t border-gray-800 pt-2 whitespace-pre-line">
                {renderRulesText(def.rulesText, 14)}
              </div>
            )}

            {/* Flavor text */}
            {def.flavorText && (
              <div className="text-gray-600 text-[10px] italic">
                {def.flavorText}
              </div>
            )}

            {/* Active timed effects on this card — show source card's actual rules text.
                Multiple identical triggers (e.g. Pack of Her Own firing twice in a turn)
                are grouped with a ×N count to avoid visually duplicated rows. */}
            {instance && instance.timedEffects.length > 0 && (() => {
              const groups = new Map<string, { te: any; count: number }>();
              for (const te of instance.timedEffects) {
                const key = JSON.stringify({
                  src: te.sourceInstanceId ?? null,
                  story: te.sourceStoryName ?? null,
                  kw: te.keyword ?? null,
                  exp: te.expiresAt ?? null,
                });
                const existing = groups.get(key);
                if (existing) existing.count += 1;
                else groups.set(key, { te, count: 1 });
              }
              const uniqueEffects = Array.from(groups.values());
              return (
              <div className="border-t border-gray-800 pt-2 space-y-1.5">
                <div className="text-[9px] text-gray-600 uppercase tracking-wider font-bold">Active Effects</div>
                {uniqueEffects.map(({ te, count }: { te: any; count: number }, i: number) => {
                  const srcInst = te.sourceInstanceId ? gameState.cards[te.sourceInstanceId] : undefined;
                  const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
                  // Engine stamps `sourceStoryName` on TimedEffects created
                  // by gain_stats (covers Support's synthesized trigger AND
                  // explicit triggered abilities). Use it directly when
                  // present — no more guessing which ability produced this.
                  const stampedStoryName = te.sourceStoryName as string | undefined;
                  // Find a matching ability on the source card to pull
                  // rulesText for the stamped storyName.
                  const stampedAbility = stampedStoryName
                    ? srcDef?.abilities.find((a: any) => a.storyName === stampedStoryName) as { storyName: string; rulesText?: string } | undefined
                    : undefined;
                  // For TimedEffects without sourceStoryName (e.g. grant_keyword,
                  // damage_prevention — not yet wired engine-side), fall back
                  // to the legacy guess: pick the first non-keyword ability or
                  // the keyword on the timed effect itself.
                  const fallbackAbility = !stampedStoryName
                    ? srcDef?.abilities.find((a: any) =>
                        a.type !== "keyword" && (a.rulesText || a.storyName)
                      ) as { storyName?: string; rulesText?: string } | undefined
                    : undefined;
                  let srcText: string;
                  if (stampedStoryName && stampedAbility) {
                    srcText = `${stampedStoryName} — ${stampedAbility.rulesText ?? ""}`;
                  } else if (stampedStoryName) {
                    // Synthesized keyword (e.g. "Support") with no matching
                    // ability entry on the card — display the storyName alone.
                    srcText = stampedStoryName;
                  } else if (fallbackAbility) {
                    srcText = fallbackAbility.storyName
                      ? `${fallbackAbility.storyName} — ${fallbackAbility.rulesText ?? ""}`
                      : (fallbackAbility.rulesText ?? "");
                  } else if (te.keyword) {
                    srcText = capitalize(te.keyword);
                  } else if (srcDef) {
                    const sourceKws = srcDef.abilities
                      .filter((a: any) => a.type === "keyword" && a.keyword)
                      .map((a: any) => capitalize(a.keyword as string));
                    srcText = sourceKws.length > 0
                      ? sourceKws.join(", ")
                      : (srcDef.rulesText ?? "");
                  } else {
                    srcText = "";
                  }
                  const srcName = srcDef?.fullName ?? "Unknown";
                  const duration = formatDuration(te.expiresAt);
                  return (
                    <div key={i} className="rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-bold text-indigo-300 truncate">{srcName}</span>
                          {count > 1 && (
                            <span className="text-[9px] font-bold text-amber-300 bg-amber-900/40 rounded px-1 shrink-0">×{count}</span>
                          )}
                        </div>
                        <span className="text-[9px] text-gray-600 shrink-0">{duration}</span>
                      </div>
                      {srcText && (
                        <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{srcText.trim()}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              );
            })()}
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
    </ModalFrame>
  );
}

// Stat pill: shows base → effective when modified. Glyph (strength /
// willpower / etc.) replaces the prior text label for visual density.
function StatPill({ glyph, base, effective }: { glyph: GlyphName; base: number; effective: number | null }) {
  const modified = effective != null && effective !== base;
  const color = modified
    ? (effective! > base ? "text-green-400" : "text-red-400")
    : "text-gray-300";
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${color}`}>
      <Glyph name={glyph} size={14} /> {effective ?? base}
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
