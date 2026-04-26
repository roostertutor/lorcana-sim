// =============================================================================
// GameBoard — Visual game board with card components and analysis overlay
// Human plays P1, bot plays P2. Uses useGameSession + useAnalysis hooks.
// =============================================================================

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { CardDefinition, DeckEntry, PlayerID, GameState, GameModifiers } from "@lorcana-sim/engine";
import { parseDecklist, getGameModifiers, evaluateCondition, hasKeyword, getKeywordValue, isSong, getLoreThreshold } from "@lorcana-sim/engine";
import {
  GreedyBot,
  RandomBot,
  RLPolicy,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import { useGameSession, getSavedSnapshot } from "../hooks/useGameSession.js";
import type { ReplayData } from "../hooks/useGameSession.js";
import { useReplaySession } from "../hooks/useReplaySession.js";
import { useBoardDnd, DROP_PLAY_ZONE, DROP_INKWELL, DROP_QUEST, dropCardId } from "../hooks/useBoardDnd.js";
import { buildLabelMap } from "../utils/buildLabelMap.js";
import SandboxPanel from "../components/SandboxPanel.js";
import GameCard from "../components/GameCard.js";
import PendingChoiceModal from "../components/PendingChoiceModal.js";
import ReplayControls from "../components/ReplayControls.js";
import ZoneViewModal from "../components/ZoneViewModal.js";
import RevealPill from "../components/RevealPill.js";
import BoardMenu from "../components/BoardMenu.js";
import ActiveEffectsPill from "../components/ActiveEffectsPill.js";
import TopToast from "../components/TopToast.js";
import InfoToast from "../components/InfoToast.js";
import ModeToast from "../components/ModeToast.js";
import { getBoardCardImage } from "../utils/cardImage.js";
import CardInspectModal from "../components/CardInspectModal.js";
import Icon from "../components/Icon.js";

// -----------------------------------------------------------------------------
// Shared sizing tokens for the utility-strip tiles (deck / discard / inkwell)
//
// All four sites — InkwellZone strip container, InkwellZone fan cells, deck
// tile, discard tile — render the same 5:7 micro-card across the same
// breakpoint ladder. Centralizing means changing the tile dimensions in one
// place propagates everywhere. (5:7 ratios: 28×39 portrait, 56×78 sm,
// 64×89 lg, 25×35 landscape-phone.)
//
// Radius scales with width — ~4% of the tile width, matching the radius
// scaling we did on the play / hand cards. Smoother ladder than the prior
// `rounded-[1px] sm:rounded lg:rounded` (which jumped 1px → 4px → 4px).
//
// Fan overlap is the negative left-margin used when stacking inked cards
// in the inkwell strip. Pre-computed pixel values keep the visual overlap
// fraction (~43%) consistent across breakpoints.
// -----------------------------------------------------------------------------

/** Width + height for the utility-strip tile (deck / discard / inkwell cell). */
const TILE_DIMS =
  "w-7 h-[39px] sm:w-14 sm:h-[78px] lg:w-16 lg:h-[89px] " +
  "landscape-phone:!w-[25px] landscape-phone:!h-[35px]";

/** Height-only variant for the inkwell-strip outer container (which lays out
 *  multiple tile cells horizontally). */
const TILE_HEIGHT_ONLY =
  "h-[39px] sm:h-[78px] lg:h-[89px] landscape-phone:!h-[35px]";

/** Border-radius for tiles. ~4% of tile width at each breakpoint. */
const TILE_RADIUS =
  "rounded-[1px] sm:rounded-sm lg:rounded-[3px] landscape-phone:!rounded-[1px]";

/** Negative left margin for fanned inkwell tiles — preserves ~43% overlap
 *  fraction across all breakpoints. */
const TILE_FAN_OVERLAP =
  "-ml-3 sm:-ml-6 lg:-ml-7 landscape-phone:!-ml-[11px]";

// -----------------------------------------------------------------------------
// Bot options
// -----------------------------------------------------------------------------

const BOT_OPTIONS: { id: string; label: string; bot: () => BotStrategy }[] = [
  { id: "greedy", label: "Greedy", bot: () => GreedyBot },
  { id: "random", label: "Random", bot: () => RandomBot },
];

const SAMPLE_DECK = `4 Elsa - Snow Queen
4 Stitch - Rock Star
4 Rapunzel - Gifted with Healing
4 Pascal - Rapunzel's Companion
4 Hades - King of Olympus
4 Maleficent - Monstrous Dragon
4 Mickey Mouse - Brave Little Tailor
4 Cinderella - Ballroom Sensation
4 Aladdin - Heroic Outlaw
4 Simba - Returned King
4 Belle - Strange but Special
4 Moana - Of Motunui
4 Te Ka - Heartless
4 Dragon Fire
4 Be Prepared`;

interface Props {
  definitions: Record<string, CardDefinition>;
  sandboxMode?: boolean;
  initialDeck?: DeckEntry[];
  /** Solo mode: deck the bot plays with. Defaults to mirror (initialDeck)
   *  when omitted. Set by the lobby's opponent picker. */
  opponentDeck?: DeckEntry[];
  onBack?: () => void;
  multiplayerGame?: {
    gameId: string;
    myPlayerId: "player1" | "player2";
  };
  /** Pre-loaded replay data (for multiplayer replay viewer) */
  initialReplayData?: ReplayData;
}

// --- Lore tracker: visual pips ---
function LoreTracker({ lore, label, color }: { lore: number; label: string; color: "green" | "red" }) {
  const filled = Math.min(lore, 20);
  const colorClass = color === "green" ? "bg-green-500" : "bg-red-500";
  const dimClass = color === "green" ? "bg-green-900/40" : "bg-red-900/40";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-bold ${color === "green" ? "text-green-400" : "text-red-400"} w-6`}>
        {label}
      </span>
      <div className="flex gap-[2px]">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className={`w-[8px] h-3 rounded-[2px] transition-colors duration-200 ${
              i < filled ? colorClass : dimClass
            }`}
          />
        ))}
      </div>
      <span className={`text-xs font-mono font-bold ${color === "green" ? "text-green-300" : "text-red-300"} w-6 text-right`}>
        {lore}
      </span>
    </div>
  );
}

// --- Ink display: filled/total pips ---
function InkDisplay({ available, total }: { available: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">Ink</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full border transition-colors ${
              i < available
                ? "bg-blue-400 border-blue-300 shadow-sm shadow-blue-400/30"
                : "bg-blue-950 border-blue-800"
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] text-blue-300 font-mono">{available}/{total}</span>
    </div>
  );
}

// Collect board-wide continuous effects for the Active Effects pill/modal
// Board-wide effect types from static abilities that should surface in the pill
const BOARD_WIDE_EFFECTS = new Set([
  "cost_reduction", "enter_play_exerted", "inkwell_enters_exerted",
  "prevent_lore_gain", "prevent_lore_loss", "one_challenge_per_turn",
  "prevent_discard_from_hand", "modify_win_threshold", "skip_draw_step",
  "top_of_deck_visible", "ink_from_discard",
  "action_restriction", "damage_redirect", "forced_target", "forced_target_priority",
  "grant_keyword", "modify_stat_per_count", "one_challenge_per_turn_global",
  "skip_draw_step_self", "extra_ink_play",
  "all_hand_inkable", "prevent_damage_removal",
  "grant_activated_ability",
]);

function formatEffectDuration(d: string | undefined): string | undefined {
  if (!d) return undefined;
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

interface ActiveEffect {
  label: string;
  source: string;
  color: string;
  /** Source card's full name */
  sourceName?: string;
  /** Duration label (for timed effects) */
  duration?: string;
  /** Target card name (for per-card effects) */
  target?: string;
  /**
   * When a grouped effect represents N stacked timed entries (e.g. Lady's
   * PACK OF HER OWN fires 3× in a turn), stackCount = N > 1. Renders as
   * "×N" pill so the label stays the original verbose ability text instead
   * of being rewritten into a summed form.
   */
  stackCount?: number;
}

function getActiveEffects(
  state: GameState,
  _mods: GameModifiers,
  definitions: Record<string, CardDefinition>,
  myId: PlayerID,
): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  const oppId: PlayerID = myId === "player1" ? "player2" : "player1";

  const cardName = (instanceId: string) => {
    const inst = state.cards[instanceId];
    if (!inst) return "Unknown";
    return definitions[inst.definitionId]?.fullName ?? inst.definitionId;
  };

  // Strip song reminder preamble and ink symbols from ability text for pill display
  const trimPillText = (text: string) =>
    text.replace(/\(A character with cost \d+ or more can \{E\} to sing this song for free\.\)\n?/i, "")
        .replace(/\{[ISE]\}/g, "")
        .trim();

  // Look up the source card and try to find the specific ability that produced the effect.
  // effectHint: match abilities containing an effect with this type string.
  const sourceText = (sourceInstanceId: string | undefined, effectHint?: string): { name: string; text: string } | null => {
    if (!sourceInstanceId) return null;
    const inst = state.cards[sourceInstanceId];
    if (!inst) return null;
    const def = definitions[inst.definitionId];
    if (!def) return null;
    if (effectHint) {
      // Search activated/triggered abilities for one whose effects[] contains the hint type
      for (const ability of def.abilities) {
        const a = ability as any;
        if (a.type === "activated" || a.type === "triggered") {
          const match = a.effects?.some((e: any) => e.type === effectHint) ||
                        a.actionEffects?.some((e: any) => e.type === effectHint);
          if (match) {
            const text = a.storyName ? `${a.storyName} ${a.rulesText ?? ""}` : (a.rulesText ?? "");
            return { name: def.fullName, text: trimPillText(text) };
          }
        }
      }
      // Search actionEffects (for action cards like Keep the Ancient Ways)
      if ((def as any).actionEffects) {
        const match = (def as any).actionEffects.some((e: any) => e.type === effectHint);
        if (match) return { name: def.fullName, text: trimPillText(def.rulesText ?? "") };
      }
    }
    // Fallback: if card has only one non-keyword ability, use that
    const namedAbilities = def.abilities.filter((a: any) => a.type !== "keyword");
    if (namedAbilities.length === 1) {
      const a = namedAbilities[0] as any;
      const text = a.storyName ? `${a.storyName} ${a.rulesText ?? ""}` : (a.rulesText ?? "");
      return { name: def.fullName, text: trimPillText(text) };
    }
    return { name: def.fullName, text: trimPillText(def.rulesText ?? "") };
  };

  // Scan in-play cards for board-wide static abilities — quote their text
  for (const pid of [myId, oppId] as PlayerID[]) {
    const play = state.zones[pid].play;
    const side = pid === myId ? "You" : "Opp";
    for (const id of play) {
      const inst = state.cards[id];
      if (!inst) continue;
      const def = definitions[inst.definitionId];
      if (!def) continue;
      for (const ability of def.abilities) {
        if (ability.type !== "static") continue;
        const effectType = (ability as any).effect?.type;
        if (!effectType || !BOARD_WIDE_EFFECTS.has(effectType)) continue;
        if (ability.condition && !evaluateCondition(ability.condition, state, definitions, pid, id)) continue;
        const text = ability.storyName
          ? `${ability.storyName} ${ability.rulesText ?? ""}`
          : (ability.rulesText ?? effectType);
        effects.push({ label: trimPillText(text), source: `${side}: ${def.fullName}`, color: "text-amber-300", sourceName: def.fullName });
      }
    }
  }

  // One-shot cost reductions (player state — Lantern, Imperial Proclamation)
  for (const pid of [myId, oppId] as PlayerID[]) {
    for (const r of (state.players[pid]?.costReductions ?? [])) {
      const src = sourceText((r as any).sourceInstanceId, "grant_cost_reduction");
      const label = src ? src.text : `Next card costs ${r.amount} less`;
      const source = src ? `${pid === myId ? "You" : "Opp"}: ${src.name}` : `${pid === myId ? "You" : "Opp"}: one-shot`;
      effects.push({ label, source, color: "text-emerald-400", sourceName: src?.name });
    }
  }

  // Play restrictions (Pete Games Referee, Keep the Ancient Ways)
  for (const pid of [myId, oppId] as PlayerID[]) {
    for (const r of (state.players[pid]?.playRestrictions ?? [])) {
      const src = sourceText((r as any).sourceInstanceId, "restrict_play");
      const label = src ? src.text : `Can't play ${r.cardTypes.join("/")}s`;
      const source = src ? `${r.casterPlayerId === myId ? "You" : "Opp"}: ${src.name}` : `${r.casterPlayerId === myId ? "You" : "Opp"}`;
      effects.push({ label, source, color: "text-red-400", sourceName: src?.name });
    }
  }

  // Global timed effects (Restoring Atlantis, Kuzco BY INVITE ONLY, etc.)
  const globalEffects = (state as any).globalTimedEffects as { type: string; controllingPlayerId: string; expiresAt: string; sourceInstanceId?: string }[] | undefined;
  if (globalEffects) {
    for (const ge of globalEffects) {
      const who = ge.controllingPlayerId === myId ? "You" : "Opp";
      const src = sourceText(ge.sourceInstanceId, "grant_keyword");
      const label = src ? src.text : ge.type.replace(/_/g, " ");
      const source = src ? `${who}: ${src.name}` : who;
      effects.push({ label: label.trim(), source, color: "text-orange-400", sourceName: src?.name, duration: formatEffectDuration(ge.expiresAt) });
    }
  }

  // Delayed triggers (Candy Drift: "at end of turn, banish them")
  const delayedTriggers = (state as any).delayedTriggers as { targetInstanceId: string; firesAt: string; sourceInstanceId?: string; controllingPlayerId?: string }[] | undefined;
  if (delayedTriggers?.length) {
    for (const dt of delayedTriggers) {
      const src = sourceText(dt.sourceInstanceId, "create_delayed_trigger");
      const target = cardName(dt.targetInstanceId);
      const when = dt.firesAt === "end_of_turn" ? "end of turn" : "start of next turn";
      const label = src ? `${src.text} (on ${target})` : `${target}: trigger at ${when}`;
      const source = src ? src.name : "";
      effects.push({ label, source, color: "text-orange-400", sourceName: src?.name, target, duration: dt.firesAt === "end_of_turn" ? "End of turn" : "Start of next turn" });
    }
  }

  // Floating triggers (Steal from the Rich — global; Medallion Weights — attached to a card)
  const floatingTriggers = (state as any).floatingTriggers as { controllingPlayerId: string; attachedToInstanceId?: string; sourceInstanceId?: string }[] | undefined;
  if (floatingTriggers?.length) {
    for (const ft of floatingTriggers) {
      const src = sourceText(ft.sourceInstanceId);
      const who = ft.controllingPlayerId === myId ? "You" : "Opp";
      const attached = ft.attachedToInstanceId ? cardName(ft.attachedToInstanceId) : null;
      const label = src ? src.text : "Floating trigger";
      const source = src
        ? `${who}: ${src.name}${attached ? ` → ${attached}` : ""}`
        : `${who}${attached ? `: on ${attached}` : ""}`;
      effects.push({ label, source, color: "text-indigo-400", sourceName: src?.name });
    }
  }

  // Per-card timed effects (Tinker Bell grants Evasive, Elsa cant_action ready, etc.)
  //
  // Group by (target, type, sourceInstanceId). Lady - Decisive Dog's
  // PACK OF HER OWN firing 3× in a turn writes 3 identical `modify_strength`
  // timedEffects; without grouping those become 3 pill rows. Grouped, they
  // become ONE row with `stackCount: 3` rendered as a ×3 pill next to the
  // ability text — label stays the verbose ability-oracle text, the pill
  // just shows how many times it stacked.
  //
  // Per-instance, not cross-instance: 2 Ladies × 3 triggers each → two
  // rows of ×3 (one per Lady), not one row of ×6.
  //
  // Source-scoped: Medallion Weights + PACK OF HER OWN both buffing the
  // same Lady render as two separate rows since sourceInstanceId differs.
  for (const pid of [myId, oppId] as PlayerID[]) {
    for (const id of state.zones[pid].play) {
      const inst = state.cards[id];
      if (!inst || !inst.timedEffects?.length) continue;
      const target = cardName(id);
      // Group by (type, sourceInstanceId); target is fixed within this loop.
      type Group = { type: string; sourceInstanceId?: string; count: number; expiresAt: string; sample: any };
      const groups = new Map<string, Group>();
      for (const te of inst.timedEffects) {
        const teAny = te as any;
        const key = `${teAny.type}|${teAny.sourceInstanceId ?? "_nosrc"}`;
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
          existing.expiresAt = teAny.expiresAt; // keep latest
        } else {
          groups.set(key, { type: teAny.type, sourceInstanceId: teAny.sourceInstanceId, count: 1, expiresAt: teAny.expiresAt, sample: te });
        }
      }
      for (const g of groups.values()) {
        const src = sourceText(g.sourceInstanceId, g.type);
        const label = src ? `${src.text} (on ${target})` : `${g.type.replace(/_/g, " ")} on ${target}`;
        const source = src ? src.name : "";
        effects.push({
          label,
          source,
          color: "text-cyan-400",
          sourceName: src?.name,
          target,
          duration: formatEffectDuration(g.expiresAt),
          ...(g.count > 1 ? { stackCount: g.count } : {}),
        });
      }
    }
  }

  return effects;
}

function InkwellZone({
  inkwellIds, availableInk, inksUsed, canStillInk, isYourTurn,
  isValidTarget, droppable = false, gameState, definitions, gameModifiers,
}: {
  inkwellIds: string[];
  availableInk: number;
  inksUsed: number;
  canStillInk: boolean;
  isYourTurn: boolean;
  isValidTarget: boolean;
  droppable?: boolean;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  gameModifiers: GameModifiers | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppable ? DROP_INKWELL : "inkwell-display-only" });
  const total = inkwellIds.length;

  const borderClass = isOver && isValidTarget
    ? "border-blue-400 bg-blue-950/20 shadow-lg shadow-blue-400/20"
    : isValidTarget
    ? "border-blue-600/50 animate-pulse"
    : canStillInk
    ? "border-blue-800/50"
    : "border-transparent";

  // Quota pips: filled = used this turn, empty = still available
  const filledPips = inksUsed;
  const emptyPips = canStillInk ? 1 : 0;

  return (
    <div ref={setNodeRef} className={`rounded-lg border-2 transition-all duration-150 ${borderClass} relative h-full`}>

      {/* Card strip — h-[39px] keeps 28:39 ≈ 5:7 parity with the official
          Lorcana card aspect (2.5"×3.5" = 5:7). Previously h-10 (40px) gave
          a 7:10 ratio that cropped card-back edges ~2% vertically via the
          object-cover img on the deck tile. Landscape-phone uses 25×35
          (smaller 5:7) to make room for larger live play cards. */}
      <div className={`${TILE_HEIGHT_ONLY} flex flex-nowrap items-start px-1 -mt-px`} style={{ clipPath: "inset(0 -9999px 0 0)" }}>
        {total === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <span className="text-[9px] text-gray-700 italic">No cards inked</span>
          </div>
        ) : (
          inkwellIds.map((id, i) => {
            const isFaceUp = i >= total - inksUsed;
            const isAvailable = i >= total - availableInk;
            return (
              <div
                key={id}
                style={{ zIndex: i }}
                className={`shrink-0 ${TILE_DIMS} relative transition-all duration-200 ${i > 0 ? TILE_FAN_OVERLAP : ""}`}
              >
                <div className="absolute top-0 left-0 origin-top-left scale-[0.538] pointer-events-none">
                  <div className={`transition-all duration-200 ${!isAvailable ? "rotate-90 grayscale brightness-75" : ""}`}>
                    <GameCard
                      instanceId={id}
                      gameState={gameState}
                      definitions={definitions}
                      gameModifiers={gameModifiers}
                      isSelected={false}
                      onClick={() => {}}
                      zone="play"
                      faceDown={!isFaceUp}
                      skipRotation
                      naturalSize
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}

      </div>
    </div>
  );
}

function UtilityStrip({
  deckCount, deckTopId, onDeckClick, deckTopVisible,
  inkwellIds, availableInk, inksUsed, canStillInk, isYourTurn, isValidInkwellTarget, droppable,
  discardCount, discardTopId, onDiscardClick,
  gameState, definitions, gameModifiers, playerId,
}: {
  deckCount: number; deckTopId: string | undefined; onDeckClick?: () => void; deckTopVisible?: boolean;
  inkwellIds: string[]; availableInk: number; inksUsed: number; canStillInk: boolean;
  isYourTurn: boolean; isValidInkwellTarget: boolean; droppable?: boolean;
  discardCount: number; discardTopId: string | undefined; onDiscardClick: () => void;
  gameState: GameState; definitions: Record<string, CardDefinition>;
  gameModifiers: GameModifiers | null;
  playerId?: PlayerID;
}) {
  return (
    <div className="shrink-0 flex items-stretch gap-1 mt-1 landscape-phone:!mt-0">
      {/* Deck tile */}
      <button
        onClick={onDeckClick}
        disabled={!onDeckClick}
        className={`relative ${TILE_DIMS} ${TILE_RADIUS} shrink-0 overflow-hidden disabled:cursor-default hover:enabled:brightness-110 transition-all border border-gray-800/40`}
      >
        {deckTopId && deckTopVisible ? (
          (() => {
            const inst = gameState.cards[deckTopId];
            const imgUrl = inst ? definitions[inst.definitionId]?.imageUrl : undefined;
            return imgUrl
              ? <img {...getBoardCardImage(imgUrl)} alt="Deck top" className="w-full h-full object-cover" draggable={false} />
              : <img src="/card-back-small.jpg" alt="Deck" className="w-full h-full object-cover" draggable={false} />;
          })()
        ) : deckTopId ? (
          <img src="/card-back-small.jpg" alt="Deck" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full border border-dashed border-gray-700/40 rounded" />
        )}
        <span className="absolute bottom-0.5 right-0.5 text-[8px] sm:text-[10px] sm:px-1 font-mono leading-none bg-black/60 text-gray-300 px-0.5 rounded">{deckCount}</span>
      </button>

      {/* Inkwell — flex-1 */}
      <div className="flex-1 min-w-0">
        <InkwellZone
          inkwellIds={inkwellIds}
          availableInk={availableInk}
          inksUsed={inksUsed}
          canStillInk={canStillInk}
          isYourTurn={isYourTurn}
          isValidTarget={isValidInkwellTarget}
          droppable={droppable ?? false}
          gameState={gameState}
          definitions={definitions}
          gameModifiers={gameModifiers}
        />
      </div>

      {/* Discard tile — glow when a card is playable from discard or inkable from discard */}
      <button
        onClick={onDiscardClick}
        disabled={discardCount === 0}
        className={`relative ${TILE_DIMS} ${TILE_RADIUS} shrink-0 overflow-hidden disabled:cursor-default hover:enabled:brightness-110 transition-all border ${
          discardCount > 0 && (
            // Play from discard (Lilo Escape Artist, Pride Lands)
            Object.values(gameState.cards).some(
              (c: any) => c.zone === "discard" && c.ownerId === (gameState as any).currentPlayer &&
                definitions[c.definitionId]?.abilities?.some((a: any) =>
                  a.activeZones?.includes("discard") && a.effects?.some((e: any) => e.type === "play_for_free")
                )
            ) ||
            // Ink from discard (Moana Curious Explorer)
            (playerId && gameModifiers?.inkFromDiscard.has(playerId))
          ) ? "border-teal-500/60 ring-1 ring-teal-500/30" : "border-gray-800/40"
        }`}
      >
        {discardTopId ? (
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 origin-top-left scale-[0.538] pointer-events-none">
              <GameCard
                instanceId={discardTopId}
                gameState={gameState}
                definitions={definitions}
                gameModifiers={gameModifiers}
                isSelected={false}
                onClick={() => {}}
                zone="play"
                naturalSize
              />
            </div>
          </div>
        ) : (
          <div className="w-full h-full border border-dashed border-gray-700/40 rounded" />
        )}
        <span className="absolute bottom-0.5 right-0.5 text-[8px] sm:text-[10px] sm:px-1 font-mono leading-none bg-black/60 text-gray-300 px-0.5 rounded">{discardCount}</span>
      </button>
    </div>
  );
}

export default function GameBoard({ definitions, sandboxMode, initialDeck, opponentDeck, onBack, multiplayerGame, initialReplayData }: Props) {
  const session = useGameSession();

  // Replay mode — null = live mode; non-null = reviewing a completed game
  const [replayData, setReplayData] = useState<ReplayData | null>(initialReplayData ?? null);
  const replaySession = useReplaySession(replayData, definitions);

  // Multiplayer replay — solo mode populates `session.completedGame` from
  // local action history when the game ends, but MP doesn't track action
  // history client-side (server is authoritative). Fetch the saved replay
  // from the server when an MP game ends so the same Review / Download
  // affordances work in both modes. `mpReplay` is the MP equivalent of
  // `session.completedGame`; downstream code reads `completedReplay`
  // (preferring the local one).
  const [mpReplay, setMpReplay] = useState<ReplayData | null>(null);

  const [p1DeckText, setP1DeckText] = useState(SAMPLE_DECK);
  const [p2DeckText, setP2DeckText] = useState(SAMPLE_DECK);
  const [botId, setBotId] = useState("greedy");
  const [rlPolicy, setRlPolicy] = useState<BotStrategy | null>(null);
  const [rlPolicyName, setRlPolicyName] = useState<string | null>(null);
  const [multiSelectTargets, setMultiSelectTargets] = useState<string[]>([]);
  const [choiceModalHidden, setChoiceModalHidden] = useState(false);
  const [cardsUnderViewerId, setCardsUnderViewerId] = useState<string | null>(null);
  const [challengeAttackerId, setChallengeAttackerId] = useState<string | null>(null);
  const [shiftCardId, setShiftCardId] = useState<string | null>(null);
  const [singCardId, setSingCardId] = useState<string | null>(null);
  // Sing Together (CRD 8.12): multi-select mode — user picks any number of
  // eligible singers whose combined effective cost ≥ singTogetherCost, then
  // confirms. Engine doesn't enumerate these actions in legalActions (N-choose-K
  // combinatorial blowup), so the UI constructs singerInstanceIds and dispatches.
  const [singTogetherCardId, setSingTogetherCardId] = useState<string | null>(null);
  const [singTogetherSelected, setSingTogetherSelected] = useState<string[]>([]);
  const [moveCharId, setMoveCharId] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [discardViewerId, setDiscardViewerId] = useState<"player" | "opponent" | null>(null);
  const [deckViewerOpen, setDeckViewerOpen] = useState(false);
  const [inspectCardId, setInspectCardId] = useState<string | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);

  // Track viewport width/orientation so the hand fan can scrunch tight enough
  // for 10+ cards to stay fully visible on portrait phones without clipping
  // the leftmost card. Recomputed on resize/rotation; the fallback (static)
  // tier below kicks in during SSR or before the listener attaches.
  const [viewportMetrics, setViewportMetrics] = useState<{ vw: number; isLandscapePhone: boolean }>(() => {
    if (typeof window === "undefined") return { vw: 390, isLandscapePhone: false };
    return {
      vw: window.innerWidth,
      isLandscapePhone: window.innerHeight <= 500 && window.innerWidth > window.innerHeight,
    };
  });
  useEffect(() => {
    const update = () => setViewportMetrics({
      vw: window.innerWidth,
      isLandscapePhone: window.innerHeight <= 500 && window.innerWidth > window.innerHeight,
    });
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Dismiss the card action popover when the user clicks outside it (e.g.
  // empty board space, scoreboard, utility strip) or presses Escape. Clicks
  // on another card are handled by handleClick which toggles/swaps inspectCardId;
  // clicks on the popover itself stopPropagation so won't reach this listener.
  // Disabled while the full Card Inspect modal is open — that modal has its
  // own backdrop-click close handler, and otherwise the global pointerdown
  // here treats modal taps (scrolling content, etc.) as "outside" clicks
  // and dismisses both modal AND popover.
  useEffect(() => {
    if (!inspectCardId || inspectModalOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-card-popover]")) return;
      if (target.closest(".game-card")) return;
      setInspectCardId(null);
      setInspectModalOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInspectCardId(null);
        setInspectModalOpen(false);
      }
    };
    // Delay one tick so the click that opened the popover doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [inspectCardId, inspectModalOpen]);
  const [autoPassP2, setAutoPassP2] = useState(true);
  // `lastRevealedHand` (from reveal_hand effects, e.g. Ursula-Deceiver) has
  // no sequenceId on the engine side, so a second Ursula revealing the same
  // hand produces an identical content key. We detect new reveal events by
  // OBJECT REFERENCE — the engine creates a fresh lastRevealedHand object
  // on every reveal_hand action, and state-spread preserves references for
  // non-reveal_hand actions in between, so reference equality cleanly
  // distinguishes "new reveal" from "persisted stale reveal". Same
  // actionCount-based freshness check as lastRevealedCards to hide the
  // overlay once subsequent actions advance past it.
  // Collapsed-to-pill (not dismissed): user closed the full modal but can
  // re-expand via the bottom-right RevealPill until the turn anchor expires.
  const [revealHandCollapsedToPill, setRevealHandCollapsedToPill] = useState(false);
  const [revealHandActionCount, setRevealHandActionCount] = useState<number | null>(null);
  // Turn number at which the current reveal fired. When gameState.turnNumber
  // moves past this, both the modal AND the pill clear — matches "no note-
  // taking" intent: you see the info once, you can re-open it during the
  // same turn, but it's gone at the next turn boundary.
  const [revealHandTurnAnchor, setRevealHandTurnAnchor] = useState<number | null>(null);
  const currentRevealedHand = session.gameState?.lastRevealedHand;
  // Forward-advance gate: undo reconstructs state from scratch, giving a
  // fresh object reference for lastRevealedHand even when the content matches
  // what the user already dismissed. Object-ref equality alone mis-fires on
  // undo. Gate "new reveal" detection on session.actionCount advancing
  // forward — undo decrements the count, so the effect correctly leaves the
  // dismissed flag in place.
  const prevHandRevealRef = useRef<{ playerId: PlayerID; cardIds: string[] } | undefined>(undefined);
  const prevHandRevealActionCount = useRef<number>(-1);
  useEffect(() => {
    const refChanged = currentRevealedHand !== prevHandRevealRef.current;
    const advanced = session.actionCount > prevHandRevealActionCount.current;
    if (currentRevealedHand && refChanged && advanced) {
      setRevealHandActionCount(session.actionCount);
      setRevealHandTurnAnchor(session.gameState?.turnNumber ?? null);
      setRevealHandCollapsedToPill(false);
    } else if (!currentRevealedHand) {
      setRevealHandActionCount(null);
      setRevealHandTurnAnchor(null);
    }
    prevHandRevealRef.current = currentRevealedHand;
    prevHandRevealActionCount.current = session.actionCount;
  }, [currentRevealedHand, session.actionCount, session.gameState?.turnNumber]);
  // Revealed cards (search/look-at-top) — track which reveal collapsed to pill
  // by key. Same two-state model as the hand reveal: closing the modal leaves
  // a clickable pill; the whole thing auto-clears at the next turn boundary.
  const [revealCardsCollapsedKey, setRevealCardsCollapsedKey] = useState<string | null>(null);
  const [revealCardsTurnAnchor, setRevealCardsTurnAnchor] = useState<number | null>(null);
  // Include sequenceId so back-to-back reveals of the same cards produce
  // distinct keys during normal play. Engine increments sequenceId on every
  // reveal-producing action.
  const currentRevealCardsKey = (() => {
    const rc = session.gameState?.lastRevealedCards;
    return rc ? `${rc.sequenceId}:${rc.instanceIds.join(",")}` : null;
  })();
  // "Fresh reveal" tracking: a reveal is considered fresh only if it JUST
  // appeared on this action. The engine persists lastRevealedCards across
  // non-reveal actions (doc: "NOT cleared by actions with no reveals"),
  // which means after dismissing + doing N actions + undoing, state.lastRev
  // still has the old reveal content — which made the overlay resurrect
  // for a reveal the user saw many actions ago.
  //
  // Solution: track (a) the actionCount at which the current reveal key
  // first appeared and (b) clear the dismiss-tracker on each key change so
  // undo → re-quest (same seqId after state rewind) still shows fresh.
  // Overlay only shows when the current actionCount matches the "birth"
  // actionCount of this reveal key.
  const [revealActionCount, setRevealActionCount] = useState<number | null>(null);
  const prevRevealKey = useRef<string | null>(null);
  const prevRevealActionCount = useRef<number>(-1);
  useEffect(() => {
    if (currentRevealCardsKey !== prevRevealKey.current) {
      const advanced = session.actionCount > prevRevealActionCount.current;
      if (currentRevealCardsKey !== null && advanced) {
        // New reveal event arriving via forward play — lock in its birth
        // actionCount and clear any stale dismiss. Skip this branch on undo
        // (actionCount retreats): state reconstruction changes the key ref
        // even when content matches, and the user's prior collapse stands.
        setRevealActionCount(session.actionCount);
        setRevealCardsTurnAnchor(session.gameState?.turnNumber ?? null);
        setRevealCardsCollapsedKey(null);
      } else if (currentRevealCardsKey === null) {
        setRevealActionCount(null);
        setRevealCardsTurnAnchor(null);
      }
      prevRevealKey.current = currentRevealCardsKey;
    }
    prevRevealActionCount.current = session.actionCount;
  }, [currentRevealCardsKey, session.actionCount, session.gameState?.turnNumber]);
  // Reveal is "visible" (as modal or pill) only while the anchor turn is the
  // current turn. On next turn-advance, anchor no longer matches → hidden.
  const revealCardsVisible =
    currentRevealCardsKey !== null
    && session.actionCount === revealActionCount
    && revealCardsTurnAnchor != null
    && session.gameState?.turnNumber === revealCardsTurnAnchor;
  const showRevealCardsModal =
    revealCardsVisible && revealCardsCollapsedKey !== currentRevealCardsKey;
  const showRevealCardsPill =
    revealCardsVisible && revealCardsCollapsedKey === currentRevealCardsKey;
  // Hand-reveal visibility follows the same modal/pill split.
  const revealHandVisible =
    currentRevealedHand != null
    && currentRevealedHand.cardIds.length > 0
    && session.actionCount === revealHandActionCount
    && revealHandTurnAnchor != null
    && session.gameState?.turnNumber === revealHandTurnAnchor;
  const showRevealHandModal = revealHandVisible && !revealHandCollapsedToPill;
  const showRevealHandPill = revealHandVisible && revealHandCollapsedToPill;

  const p1Parse = useMemo(() => parseDecklist(p1DeckText, definitions), [p1DeckText, definitions]);
  const p2Parse = useMemo(() => parseDecklist(p2DeckText, definitions), [p2DeckText, definitions]);

  // Compute static-effect state for UI indicators (damage immunity, cant-be-challenged,
  // granted traits, etc.). Recomputes when gameState changes (i.e. after every action).
  const gameModifiers = useMemo<GameModifiers | null>(
    () => session.gameState ? getGameModifiers(session.gameState, definitions) : null,
    [session.gameState, definitions]
  );

// Derived early — needed by hooks that must live above the early return
  const myId = multiplayerGame?.myPlayerId ?? "player1";

  // Reset sandbox: clear session + start fresh
  const handleResetBoard = useCallback(() => {
    session.reset();
    session.startGame({
      player1Deck: [],
      player2Deck: [],
      definitions,
      botStrategy: GreedyBot,
      player1IsHuman: true,
      player2IsHuman: false,
    });
  }, [session, definitions]);

  // Cancel any pending 2-step interaction mode
  const cancelMode = React.useCallback(() => {
    setChallengeAttackerId(null);
    setShiftCardId(null);
    setSingCardId(null);
    setSingTogetherCardId(null);
    setSingTogetherSelected([]);
    setMoveCharId(null);
  }, []);

  // Valid challenge targets for the selected attacker
  const challengeTargets = useMemo(() => {
    if (!challengeAttackerId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "CHALLENGE" && a.attackerInstanceId === challengeAttackerId)
        .map(a => (a as { defenderInstanceId: string }).defenderInstanceId)
    );
  }, [challengeAttackerId, session.legalActions]);

  // Valid shift targets for the selected hand card
  const shiftTargets = useMemo(() => {
    if (!shiftCardId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "PLAY_CARD" && (a as { instanceId: string }).instanceId === shiftCardId && (a as { shiftTargetInstanceId?: string }).shiftTargetInstanceId)
        .map(a => (a as { shiftTargetInstanceId: string }).shiftTargetInstanceId)
    );
  }, [shiftCardId, session.legalActions]);

  // Valid location targets for the selected character (CRD 4.7)
  const moveTargets = useMemo(() => {
    if (!moveCharId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "MOVE_CHARACTER" && (a as { characterInstanceId: string }).characterInstanceId === moveCharId)
        .map(a => (a as { locationInstanceId: string }).locationInstanceId)
    );
  }, [moveCharId, session.legalActions]);

  // Valid singers for the selected song card — instanceIds of characters that can sing it
  const singTargets = useMemo(() => {
    if (!singCardId) return new Set<string>();
    return new Set(
      session.legalActions
        .filter(a => a.type === "PLAY_CARD" && (a as { instanceId: string }).instanceId === singCardId && (a as { singerInstanceId?: string }).singerInstanceId)
        .map(a => (a as { singerInstanceId: string }).singerInstanceId)
    );
  }, [singCardId, session.legalActions]);

  // CRD 8.12 Sing Together: effective cost of a single singer (mirrors
  // validator.ts:300-313). Singer keyword overrides printed cost; location
  // bonus (Atlantica Concert Hall), timed sing bonus (Naveen's Ukulele), and
  // static per-character sing bonus (Record Player HIT PARADE) all stack.
  const singerEffectiveCost = useCallback((singerInstanceId: string): number => {
    const gs = session.gameState;
    if (!gs || !gameModifiers) return 0;
    const s = gs.cards[singerInstanceId];
    if (!s) return 0;
    const sDef = definitions[s.definitionId];
    if (!sDef || sDef.cardType !== "character") return 0;
    let cost = sDef.cost;
    // CRD 8.11.1: Singer N counts as cost N. Static-granted Singer (Mickey
    // Mouse Amber Champion FRIENDLY CHORUS) lives in modifiers.grantedKeywords
    // — mirrors engine validator.canSingTogether so the UI's local Sing
    // Together gating doesn't underestimate when the keyword comes from a
    // static ability rather than the printed card.
    const sStaticGrants = gameModifiers.grantedKeywords.get(singerInstanceId);
    const sHasGrantedSinger = (sStaticGrants ?? []).some(g => g.keyword === "singer");
    if (hasKeyword(s, sDef, "singer") || sHasGrantedSinger) {
      cost = getKeywordValue(s, sDef, "singer", sStaticGrants);
    }
    if (s.atLocationInstanceId) {
      cost += gameModifiers.singCostBonusHere.get(s.atLocationInstanceId) ?? 0;
    }
    cost += (s.timedEffects ?? [])
      .filter(t => t.type === "sing_cost_bonus")
      .reduce((sum, t) => sum + (t.amount ?? 0), 0);
    cost += gameModifiers.singCostBonusCharacters.get(singerInstanceId) ?? 0;
    return cost;
  }, [session.gameState, definitions, gameModifiers]);

  // Total effective cost of every ready, non-drying singer currently in my
  // play zone. Used to gate the Sing Together button AND hand-card dimming:
  // a song is only sing-together feasible if this total ≥ its singTogetherCost.
  const totalReadySingerCost = useMemo(() => {
    const gs = session.gameState;
    if (!gs) return 0;
    let total = 0;
    for (const id of gs.zones[myId]?.play ?? []) {
      const inst = gs.cards[id];
      if (!inst) continue;
      const d = definitions[inst.definitionId];
      if (!d || d.cardType !== "character") continue;
      if (inst.isExerted || inst.isDrying) continue;
      total += singerEffectiveCost(id);
    }
    return total;
  }, [session.gameState, myId, definitions, singerEffectiveCost]);

  // Eligible singers for Sing Together mode: ready, non-drying, owned
  // characters in play. Action-restriction edge cases (e.g. Ariel On Human
  // Legs) are caught by engine validation on Confirm — we don't filter them
  // here to keep the hot path simple.
  const singTogetherEligible = useMemo(() => {
    const set = new Set<string>();
    const gs = session.gameState;
    if (!gs || !singTogetherCardId) return set;
    for (const id of gs.zones[myId]?.play ?? []) {
      const inst = gs.cards[id];
      if (!inst) continue;
      const d = definitions[inst.definitionId];
      if (!d || d.cardType !== "character") continue;
      if (inst.isExerted || inst.isDrying) continue;
      set.add(id);
    }
    return set;
  }, [session.gameState, singTogetherCardId, myId, definitions]);

  // Running total cost of currently-selected singers (for the Confirm toast)
  const singTogetherTotalCost = useMemo(
    () => singTogetherSelected.reduce((sum, id) => sum + singerEffectiveCost(id), 0),
    [singTogetherSelected, singerEffectiveCost]
  );
  const singTogetherRequiredCost = useMemo(() => {
    if (!singTogetherCardId || !session.gameState) return 0;
    const inst = session.gameState.cards[singTogetherCardId];
    if (!inst) return 0;
    const def = definitions[inst.definitionId];
    return def?.singTogetherCost ?? 0;
  }, [singTogetherCardId, session.gameState, definitions]);

  // Per-card action buttons — derived from legalActions
  type CardBtn = { label: string; color: string; onClick: (e: React.MouseEvent) => void };
  const cardButtons = useMemo(() => {
    const map = new Map<string, CardBtn[]>();
    const gs = session.gameState;
    if (!gs) return map; // wait for game
    const add = (id: string, btn: CardBtn) => {
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(btn);
    };
    const isYourTurn = gs.currentPlayer === myId;
    if (!isYourTurn || session.pendingChoice || session.isGameOver) return map;

    const challengeAdded = new Set<string>();
    const shiftAdded = new Set<string>();
    const singerAdded = new Set<string>();
    const moveAdded = new Set<string>();

    for (const action of session.legalActions) {
      switch (action.type) {
        case "PLAY_INK":
          add(action.instanceId, {
            label: "Ink", color: "bg-blue-700 hover:bg-blue-600 text-blue-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        case "PLAY_CARD":
          if (action.shiftTargetInstanceId) {
            if (!shiftAdded.has(action.instanceId)) {
              shiftAdded.add(action.instanceId);
              add(action.instanceId, {
                label: "Shift", color: "bg-purple-700 hover:bg-purple-600 text-purple-100",
                onClick: (e) => { e.stopPropagation(); cancelMode(); setShiftCardId(action.instanceId); },
              });
            }
          } else if (action.singerInstanceId) {
            if (!singerAdded.has(action.instanceId)) {
              singerAdded.add(action.instanceId);
              add(action.instanceId, {
                label: "Sing", color: "bg-yellow-700 hover:bg-yellow-600 text-yellow-100",
                onClick: (e) => { e.stopPropagation(); cancelMode(); setSingCardId(action.instanceId); },
              });
            }
          } else if ((action as any).viaGrantedFreePlay) {
            // Free-play variant (Pudge/Belle/Scrooge). Engine surfaces a
            // pendingChoice after the click for cards with an alt cost (Belle
            // banish, Scrooge exert 4) — PendingChoiceModal handles the pick.
            add(action.instanceId, {
              label: "Play Free",
              color: "bg-teal-700 hover:bg-teal-600 text-teal-100",
              onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
            });
          } else {
            add(action.instanceId, {
              label: "Play", color: "bg-emerald-700 hover:bg-emerald-600 text-emerald-100",
              onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
            });
          }
          break;
        case "QUEST":
          add(action.instanceId, {
            label: "Quest", color: "bg-amber-600 hover:bg-amber-500 text-amber-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        case "CHALLENGE":
          if (!challengeAdded.has(action.attackerInstanceId)) {
            challengeAdded.add(action.attackerInstanceId);
            add(action.attackerInstanceId, {
              label: "Challenge", color: "bg-red-700 hover:bg-red-600 text-red-100",
              onClick: (e) => { e.stopPropagation(); cancelMode(); setChallengeAttackerId(action.attackerInstanceId); },
            });
          }
          break;
        case "MOVE_CHARACTER": {
          if (!moveAdded.has(action.characterInstanceId)) {
            moveAdded.add(action.characterInstanceId);
            add(action.characterInstanceId, {
              label: "Move", color: "bg-cyan-700 hover:bg-cyan-600 text-cyan-100",
              onClick: (e) => { e.stopPropagation(); cancelMode(); setMoveCharId(action.characterInstanceId); },
            });
          }
          break;
        }
        case "BOOST_CARD": {
          add(action.instanceId, {
            label: "Boost", color: "bg-violet-700 hover:bg-violet-600 text-violet-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        }
        case "ACTIVATE_ABILITY": {
          const def = gs.cards[action.instanceId]
            ? definitions[gs.cards[action.instanceId]!.definitionId]
            : undefined;
          const abilityName = def?.abilities[action.abilityIndex]?.type === "activated"
            ? (def.abilities[action.abilityIndex] as { storyName?: string }).storyName ?? "Activate"
            : "Activate";
          add(action.instanceId, {
            label: abilityName, color: "bg-indigo-700 hover:bg-indigo-600 text-indigo-100",
            onClick: (e) => { e.stopPropagation(); session.dispatch(action); },
          });
          break;
        }
      }
    }

    // Sing Together (CRD 8.12): getAllLegalActions doesn't enumerate
    // multi-singer variants, so add the button ourselves for any hand song
    // whose singTogetherCost is covered by the player's currently-ready
    // singers' total effective cost. Gating on total cost (not just "≥1
    // singer") avoids teasing a button you can't actually confirm.
    const myHand = gs.zones[myId]?.hand ?? [];
    for (const songId of myHand) {
      const songInst = gs.cards[songId];
      if (!songInst) continue;
      const songDef = definitions[songInst.definitionId];
      if (!songDef || !isSong(songDef) || songDef.singTogetherCost === undefined) continue;
      if (totalReadySingerCost < songDef.singTogetherCost) continue;
      add(songId, {
        label: "Sing Together",
        color: "bg-yellow-700 hover:bg-yellow-600 text-yellow-100",
        onClick: (e) => {
          e.stopPropagation();
          cancelMode();
          setSingTogetherCardId(songId);
          setSingTogetherSelected([]);
        },
      });
    }
    return map;
  }, [session.legalActions, session.pendingChoice, session.isGameOver, session.gameState, session, myId, definitions, cancelMode, totalReadySingerCost]);

  function handlePolicyUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const policy = RLPolicy.fromJSON(json);
        policy.epsilon = 0;
        setRlPolicy(policy);
        setRlPolicyName(file.name);
      } catch {
        setRlPolicy(null);
        setRlPolicyName(null);
      }
    };
    reader.readAsText(file);
  }

  const canStart =
    p1Parse.entries.length > 0 &&
    p2Parse.entries.length > 0 &&
    p1Parse.errors.length === 0 &&
    p2Parse.errors.length === 0;

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [session.actionLog.length]);

  // Disable pull-to-refresh, overscroll bounce, and long-press callout while the game board is mounted
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    // Suppress right-click context menu in production (keeps the game feel).
    // Allowed in local dev so you can inspect elements normally.
    const onContextMenu = (e: MouseEvent) => { if (!import.meta.env.DEV) e.preventDefault(); };
    body.style.webkitUserSelect = "none";
    (body.style as any)["-webkit-touch-callout"] = "none";
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
      body.style.webkitUserSelect = "";
      (body.style as any)["-webkit-touch-callout"] = "";
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  // Auto-start when entering multiplayer mode — state arrives via Realtime
  useEffect(() => {
    if (!multiplayerGame) return;
    session.startGame({
      player1Deck: [],
      player2Deck: [],
      definitions,
      botStrategy: GreedyBot,
      player1IsHuman: multiplayerGame.myPlayerId === "player1",
      player2IsHuman: multiplayerGame.myPlayerId === "player2",
      multiplayer: multiplayerGame,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerGame]);

  // MP game-over → fetch the server-side replay so Review / Download in
  // the victory modal work the same as in solo mode. Server saves the
  // replay automatically (per a751923) — we just GET /game/:id/replay.
  // One-shot: gated on `mpReplay` being null so it doesn't refetch on
  // every render. Solo mode never enters this branch (multiplayerGame
  // is undefined).
  useEffect(() => {
    if (!multiplayerGame || !session.gameState?.isGameOver || mpReplay) return;
    let cancelled = false;
    void import("../lib/serverApi.js").then(({ getGameReplay }) =>
      getGameReplay(multiplayerGame.gameId).then((replay) => {
        if (cancelled || !replay) return;
        setMpReplay({
          seed: replay.seed,
          p1Deck: replay.p1Deck,
          p2Deck: replay.p2Deck,
          actions: replay.actions,
          winner: replay.winner as PlayerID | null,
          turnCount: replay.turnCount,
        });
      }),
    );
    return () => { cancelled = true; };
  }, [multiplayerGame, session.gameState?.isGameOver, mpReplay]);

  // Solo mode: auto-start with deck from lobby, bot plays P2. Re-fires whenever
  // session.gameState transitions to null (initial mount + after "Play Again"
  // in the victory modal, which calls session.reset()). Bails if a game is
  // already running or if the user is reviewing a replay.
  useEffect(() => {
    if (!onBack || sandboxMode || multiplayerGame) return;
    if (session.gameState || replayData) return;
    session.startGame({
      player1Deck: initialDeck ?? [],
      // opponentDeck overrides the historical mirror behavior. Falls back
      // to initialDeck when no opponent was picked in the lobby.
      player2Deck: opponentDeck ?? initialDeck ?? [],
      definitions,
      botStrategy: GreedyBot,
      player1IsHuman: true,
      player2IsHuman: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.gameState, replayData]);

  // Sandbox: restore from sessionStorage (HMR survival) or start fresh
  useEffect(() => {
    if (!sandboxMode) return;
    if (session.restoreFromSnapshot(definitions, GreedyBot)) return;
    session.startGame({
      player1Deck: [],
      player2Deck: [],
      definitions,
      botStrategy: GreedyBot, // never invoked — P2 auto-passes
      player1IsHuman: true,
      player2IsHuman: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode]);

  // Sandbox: auto-resolve play-order election AND mulligan (skip the pre-game
  // ceremony entirely). CRD 2.1.3.2 play-draw fires first at game start (new
  // in engine feat 9af2c06) and must resolve before mulligan can begin —
  // handle both in the same effect so the second firing (post-play-order
  // resolution) still catches the mulligan choice on the next render tick.
  useEffect(() => {
    if (!sandboxMode) return;
    const pc = session.gameState?.pendingChoice;
    if (pc?.type === "choose_play_order") {
      session.resolveChoice("first");
    } else if (pc?.type === "choose_mulligan") {
      session.resolveChoice([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode, session.gameState?.pendingChoice]);

  // Sandbox: auto-pass P2 turns when autoPassP2 is on
  useEffect(() => {
    if (!sandboxMode || !autoPassP2) return;
    const gs = session.gameState;
    if (!gs || gs.isGameOver || gs.pendingChoice) return;
    const opId: PlayerID = myId === "player1" ? "player2" : "player1";
    if (gs.currentPlayer !== opId) return;
    session.dispatch({ type: "PASS_TURN", playerId: opId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxMode, autoPassP2, session.gameState]);

  // Restore modal whenever a new choice arrives
  useEffect(() => {
    const pc = session.gameState?.pendingChoice;
    if (pc && pc.choosingPlayerId === myId) {
      setChoiceModalHidden(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.gameState?.pendingChoice]);


  function handleStart() {
    setReplayData(null);
    const botOption = BOT_OPTIONS.find((b) => b.id === botId) ?? BOT_OPTIONS[0]!;
    session.startGame({
      player1Deck: p1Parse.entries,
      player2Deck: p2Parse.entries,
      definitions,
      botStrategy: botOption.bot(),
      player1IsHuman: true,
      player2IsHuman: false,
    });
  }

  const handleDownloadReplay = useCallback(() => {
    // Prefer locally-tracked replay (solo) over server-fetched (MP). They're
    // structurally identical ReplayData; either works for the JSON export.
    const data = session.completedGame ?? mpReplay;
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [session.completedGame, mpReplay]);

  const handleUploadReplay = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as ReplayData;
        if (typeof data.seed !== "number" || !Array.isArray(data.actions) || !Array.isArray(data.p1Deck) || !Array.isArray(data.p2Deck)) return;
        setReplayData(data);
      } catch {
        // Invalid file — silently ignore
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-uploaded
  }, []);

  const getCardName = (instanceId: string): string => {
    if (!session.gameState) return "Unknown";
    const instance = session.gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  };

  // buildLabelMap is imported from utils — wrap with local getName
  const getLabelMap = (ids: string[]) => buildLabelMap(ids, getCardName);

  // ── Drag & Drop — must be declared BEFORE any early return (Rules of Hooks) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const dnd = useBoardDnd({
    myId,
    gameState: session.gameState,
    legalActions: session.legalActions,
    dispatch: session.dispatch,
    isEnabled: !!(
      session.gameState &&
      session.gameState.currentPlayer === myId &&
      !session.pendingChoice &&
      !session.isGameOver
    ),
    // Stance B for alt-cost ambiguity: Belle (normal play vs. banish item)
    // and Scrooge (normal vs. exert-4-matching) surface both "Play" and
    // "Play Free" buttons in the card popover on tap. Drag used to silently
    // pick the first match (normal-ink), losing the free-play benefit.
    // Now: open the popover at the card's home position so the user sees
    // both options — same UX as tapping, just triggered by the drag.
    onAmbiguousPlay: (instanceId, rect) => {
      setInspectCardId(instanceId);
      const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
      const POPOVER_EST_HEIGHT = 160;
      const placement = rect.bottom + POPOVER_EST_HEIGHT > window.innerHeight - 8 ? "above" : "below";
      const top = placement === "below" ? rect.bottom + 6 : rect.top - 6;
      setPopoverPos({ top, left, placement });
    },
  });

  // Track the drop target currently under the cursor during a drag — used to
  // show the action label ("Challenge" / "Shift" / "Sing" / "Move" / "Play" /
  // "Ink") on the DragOverlay instead of on the target card (which the
  // DragOverlay would otherwise obscure).
  const [hoveredDropId, setHoveredDropId] = useState<string | null>(null);
  const dragActionLabel = useMemo(() => {
    if (!dnd.activeId || !hoveredDropId) return null;
    if (hoveredDropId === DROP_PLAY_ZONE) return "Play";
    if (hoveredDropId === DROP_INKWELL) return "Ink";
    if (hoveredDropId === DROP_QUEST) return "Quest";
    if (hoveredDropId.startsWith("drop:card:")) {
      const targetId = hoveredDropId.slice("drop:card:".length);
      const d = dnd.activeId;
      if (session.legalActions.some(a => a.type === "PLAY_CARD" && a.instanceId === d && a.shiftTargetInstanceId === targetId)) return "Shift";
      if (session.legalActions.some(a => a.type === "PLAY_CARD" && a.instanceId === d && a.singerInstanceId === targetId)) return "Sing";
      if (session.legalActions.some(a => a.type === "CHALLENGE" && a.attackerInstanceId === d && a.defenderInstanceId === targetId)) return "Challenge";
      if (session.legalActions.some(a => a.type === "MOVE_CHARACTER" && a.characterInstanceId === d && a.locationInstanceId === targetId)) return "Move";
    }
    return null;
  }, [dnd.activeId, hoveredDropId, session.legalActions]);

  // =========================================================================
  // SETUP MODE
  // =========================================================================
  if (!session.gameState && !replayData && (sandboxMode || onBack || !!multiplayerGame)) {
    return null; // waiting for auto-start effect
  }
  if (!session.gameState && !replayData) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-amber-400">Play</h2>
        <p className="text-gray-400 text-sm">
          Play a visual game against a bot. Enter decklists below (or use the sample deck).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 1 Deck (You)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p1DeckText}
              onChange={(e) => setP1DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p1Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p1Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p1Parse.entries.length > 0 && p1Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p1Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Player 2 Deck (Bot)
            </label>
            <textarea
              className="w-full h-48 bg-gray-900 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 focus:border-amber-500 focus:outline-none"
              value={p2DeckText}
              onChange={(e) => setP2DeckText(e.target.value)}
              placeholder="4 Card Name&#10;4 Other Card..."
            />
            {p2Parse.errors.length > 0 && (
              <div className="mt-1 text-red-400 text-xs space-y-0.5">
                {p2Parse.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            {p2Parse.entries.length > 0 && p2Parse.errors.length === 0 && (
              <div className="mt-1 text-green-400 text-xs">
                {p2Parse.entries.reduce((s, e) => s + e.count, 0)} cards parsed
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Bot:</label>
          <select
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:border-amber-500 focus:outline-none"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
          >
            {BOT_OPTIONS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Analysis policy:</label>
          <label className="cursor-pointer px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:border-amber-500 transition-colors">
            {rlPolicyName ?? "Upload .json"}
            <input type="file" accept=".json" className="hidden" onChange={handlePolicyUpload} />
          </label>
          {rlPolicy && (
            <span className="text-green-400 text-xs">RL estimate active</span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-medium transition-colors"
            disabled={!canStart}
            onClick={handleStart}
          >
            Start Game
          </button>
          <label className="cursor-pointer px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded font-medium text-sm text-gray-300 transition-colors">
            Load Replay
            <input type="file" accept=".json" className="hidden" onChange={handleUploadReplay} />
          </label>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PLAYING MODE
  // =========================================================================

  const { legalActions, pendingChoice, actionLog, isGameOver, winner } = session;
  // In replay mode, show the replay state instead of the live game state.
  // replaySession.state may be null while states are being built — fall back to session.gameState.
  // Cast to GameState: the null guard below prevents any actual null from reaching the render.
  const gameState = ((replayData ? replaySession.state : null) ?? session.gameState) as GameState;
  // Guard: if we somehow have no state yet (replay still loading), render nothing
  if (!gameState) return null;

  const opponentId = myId === "player1" ? "player2" : "player1";
  const activeEffects = gameModifiers ? getActiveEffects(gameState, gameModifiers, definitions, myId) : [];

  const p1 = gameState.players[myId];
  const p2 = gameState.players[opponentId];
  const p1Zones = gameState.zones[myId];
  const p2Zones = gameState.zones[opponentId];

  const recentLog = actionLog.slice(-30);
  const isYourTurn = gameState.currentPlayer === myId;
  const inksUsed = p1.inkPlaysThisTurn ?? (p1.hasPlayedInkThisTurn ? 1 : 0);
  const canStillInk = isYourTurn && !pendingChoice && !isGameOver && legalActions.some(a => a.type === "PLAY_INK");

  // Hand card playability — set of card IDs that have at least one legal action
  // (PLAY_CARD, PLAY_INK). Lets GameCard dim unplayable cards.
  // Not a useMemo — this runs after an early return guard, so hooks aren't allowed here.
  const playableHandIds = new Set<string>();
  for (const a of legalActions) {
    if (a.type === "PLAY_CARD" && (a as any).instanceId) playableHandIds.add((a as any).instanceId);
    if (a.type === "PLAY_INK" && (a as any).instanceId) playableHandIds.add((a as any).instanceId);
  }
  // Sing Together (CRD 8.12): engine doesn't enumerate multi-singer actions
  // in legalActions (N-choose-K blowup), so a song that's only playable via
  // Sing Together would dim incorrectly. Mark a hand song as playable iff
  // the total effective cost of currently-ready, non-drying singers covers
  // its singTogetherCost — matches the button-gating logic.
  if (isYourTurn) {
    for (const id of gameState.zones[myId]?.hand ?? []) {
      const inst = gameState.cards[id];
      if (!inst) continue;
      const d = definitions[inst.definitionId];
      if (d && isSong(d) && d.singTogetherCost !== undefined && totalReadySingerCost >= d.singTogetherCost) {
        playableHandIds.add(id);
      }
    }
  }

  // Helpers for readability in JSX
  function isDraggableEnabled(isOpponent: boolean) {
    return !isOpponent && isYourTurn && !pendingChoice && !isGameOver;
  }

  // ── Disambiguation labels for the active pending choice ───────────────────

  const choiceTargetIds = pendingChoice?.validTargets ?? pendingChoice?.revealedCards ?? [];
  const choiceLabels = getLabelMap(choiceTargetIds); // id → "Name (N)" or "Name"

  // Helper: render card + its action buttons, wrapped in DnD primitives
  // Render a single in-play card cell with the exerted-rotation sizing kludge
  function renderPlayCell(id: string, isOpponent: boolean) {
    const exerted = gameState!.cards[id]?.isExerted ?? false;
    const isLocation = definitions[gameState!.cards[id]?.definitionId ?? ""]?.cardType === "location";
    // Locations are always rotated 90° in play, same as exerted characters —
    // reserve their rotated footprint so the visual overhang doesn't get
    // clipped by parent edges (e.g. when a location is the only card in play).
    const needsRotatedSlot = exerted || isLocation;
    // Landscape-phone uses explicit 63×45 (landscape-oriented for the
    // rotate-90'd card inside) to match the 45×63 ready-card parity. 63×45
    // is 5:7 rotated. Explicit pixel sizing bypasses the h-full resolution
    // bug — no ancestor in this branch has an explicit height, so h-full
    // resolved to auto and max-h never triggered.
    return (
      <div key={id} className={`shrink-0 ${needsRotatedSlot ? "w-[73px] h-[52px] sm:w-[146px] sm:h-[104px] lg:w-[168px] lg:h-[120px] landscape-phone:!w-[63px] landscape-phone:!h-[45px] flex items-center justify-center overflow-hidden" : ""}`}>
        {renderCardWithActions(id, "play", isOpponent)}
      </div>
    );
  }

  // Render the play area: locations (each with its hosted characters in a colored box),
  // wandering characters, then items/actions on the right.
  function renderPlayArea(playIds: string[], isOpponent: boolean) {
    const locationIds = playIds.filter(id => definitions[gameState!.cards[id]?.definitionId ?? ""]?.cardType === "location");
    const characterIds = playIds.filter(id => definitions[gameState!.cards[id]?.definitionId ?? ""]?.cardType === "character");
    const otherIds = playIds.filter(id => {
      const t = definitions[gameState!.cards[id]?.definitionId ?? ""]?.cardType;
      return t !== "location" && t !== "character";
    });
    // Group characters by their atLocationInstanceId
    const wandering: string[] = [];
    const byLocation = new Map<string, string[]>();
    for (const cid of characterIds) {
      const at = gameState!.cards[cid]?.atLocationInstanceId;
      if (at && locationIds.includes(at)) {
        if (!byLocation.has(at)) byLocation.set(at, []);
        byLocation.get(at)!.push(cid);
      } else {
        wandering.push(cid);
      }
    }
    return (
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 md:gap-2 pb-1 md:px-1">
        {/* Locations row — each with its hosted characters bordered together */}
        {locationIds.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end content-end">
            {locationIds.map(locId => {
              const hosted = byLocation.get(locId) ?? [];
              return (
                <div key={locId} className="flex items-end gap-1 md:gap-2 p-1 md:p-1.5 rounded-lg border border-cyan-700/50 bg-cyan-950/20">
                  {renderPlayCell(locId, isOpponent)}
                  {hosted.map(cid => renderPlayCell(cid, isOpponent))}
                </div>
              );
            })}
          </div>
        )}
        {/* Wandering characters + items/actions row */}
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-1 md:gap-2">
          <div className="flex flex-wrap gap-1 md:gap-2 items-end content-end">
            {wandering.map(id => renderPlayCell(id, isOpponent))}
          </div>
          {otherIds.length > 0 && (
            <div className="flex flex-wrap gap-1 md:gap-2 items-end content-end md:justify-end">
              {otherIds.map(id => renderPlayCell(id, isOpponent))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCardWithActions(id: string, zone: "play" | "hand", isOpponent = false, index = 0, total = 1, faceDown = false) {
    const isChallTarget = challengeTargets.has(id);
    const isShiftTarget = shiftTargets.has(id);
    const isSingTarget = singTargets.has(id);
    const isMoveTarget = moveTargets.has(id);
    const isSingTogetherTarget = singTogetherEligible.has(id);
    const isSingTogetherSelected = singTogetherSelected.includes(id);
    const isAttacker = id === challengeAttackerId || id === shiftCardId || id === moveCharId || id === singTogetherCardId;
    const choiceLabel = choiceLabels.get(id);
    const plainName = getCardName(id);
    const disambigBadge = choiceLabel && choiceLabel !== plainName
      ? choiceLabel.slice(plainName.length).trim()
      : null;

    // Whether this card can be a DnD drop target (shift, sing, challenge, move).
    // The action label itself is computed once at the top level for the
    // DragOverlay — no need to compute per-card here.
    const isDropTarget = !!dnd.activeId && dnd.isValidCardDrop(dnd.activeId, id);

    // Fan effect for hand cards — overlap + subtle rotation.
    const isHandCard = zone === "hand";
    const midpoint = (total - 1) / 2;
    const normalizedPos = total > 1 ? (index - midpoint) / midpoint : 0; // -1..1
    // Dynamic fan compression: compute the tightest overlap that still leaves
    // every card fully visible, accounting for the ±6° per-card rotation that
    // extends the outer cards' top corners by sin(6°) × cardHeight beyond
    // their laid-out box (~26px total side overhang for a standard 88×123
    // card). Floor at 22px overlap so small hands fan naturally; ceiling at
    // cardWidth−18 so each card keeps ≥18px visible regardless of hand size.
    // Recomputes on viewport resize/rotation via `viewportMetrics`.
    //
    // Replaced a tiered model (≤6:32, ≤9:50, 10+:dynamic) that misjudged
    // 7–9 cards on iPhone 13 portrait: 8 cards at 50px overlap ≈ 354px +
    // 26px rotation = 380px visual, clipping a 374px container by ~6px on
    // the leftmost card. Dynamic formula now compresses starting at total=5.
    let overlapPx = 22;
    if (total >= 2 && isHandCard) {
      const cardW = viewportMetrics.isLandscapePhone ? 72 : 88;
      const cardH = cardW * (7 / 5); // aspect-[5/7]
      const rotOverhang = Math.sin((6 * Math.PI) / 180) * cardH;
      // Hand strip content width ≈ viewport − (parent px + hand px) ≈ vw − 16.
      // On md+ the hand wraps to multiple rows instead of fanning, so this
      // branch is effectively mobile-only.
      const containerW = Math.max(200, viewportMetrics.vw - 16) - 2 * rotOverhang;
      const needed = cardW - (containerW - cardW) / (total - 1);
      overlapPx = Math.max(22, Math.min(cardW - 18, needed));
    }
    const handStyle: React.CSSProperties | undefined = isHandCard ? {
      marginLeft: index > 0 ? `-${overlapPx}px` : "0",
      transform: `rotate(${normalizedPos * 6}deg)`,
      transformOrigin: isOpponent ? "top center" : "bottom center",
      zIndex: index,
      transition: "transform 0.15s ease",
    } : undefined;

    function handleClick() {
      // Face-down cards (opponent's hand, face-down cards under a Location)
      // must not open the popover / inspect modal — doing so would leak the
      // real definitionId via CardInspectModal, defeating the face-down
      // render. Drag was already blocked via isDraggableEnabled; this closes
      // the click path. ZoneViewModal already has the same guard for its
      // face-down grid (`onClick={() => { if (!faceDownHere) setInspectId(id); }}`).
      if (faceDown) return;
      if (isOpponent && challengeAttackerId && isChallTarget) {
        session.dispatch({ type: "CHALLENGE", playerId: myId, attackerInstanceId: challengeAttackerId, defenderInstanceId: id });
        setChallengeAttackerId(null);
        return;
      }
      if (!isOpponent && shiftCardId && isShiftTarget) {
        // Both ink-cost and alt-cost shift dispatch the same way — the engine
        // surfaces a pendingChoice for alt-cost targets after the action fires.
        const shiftAction = legalActions.find(a => a.type === "PLAY_CARD" && a.instanceId === shiftCardId && a.shiftTargetInstanceId === id);
        if (shiftAction) session.dispatch(shiftAction);
        setShiftCardId(null);
        return;
      }
      if (!isOpponent && singCardId && isSingTarget) {
        const singAction = legalActions.find(a => a.type === "PLAY_CARD" && a.instanceId === singCardId && a.singerInstanceId === id);
        if (singAction) session.dispatch(singAction);
        setSingCardId(null);
        return;
      }
      // Sing Together multi-select: tapping an eligible singer toggles it
      // in/out of the selection. Confirm/Cancel lives in the top toast.
      if (!isOpponent && singTogetherCardId && isSingTogetherTarget) {
        setSingTogetherSelected(prev =>
          prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
        return;
      }
      if (!isOpponent && moveCharId && isMoveTarget) {
        session.dispatch({ type: "MOVE_CHARACTER", playerId: myId, characterInstanceId: moveCharId, locationInstanceId: id });
        setMoveCharId(null);
        return;
      }
      if (challengeAttackerId || shiftCardId || singCardId || singTogetherCardId || moveCharId) { cancelMode(); return; }
      // Toggle: tap same card → deselect; tap different card → select it
      setInspectCardId(prev => prev === id ? null : id);
      if (inspectModalOpen) setInspectModalOpen(false);
    }

    return (
      <DraggableCard key={id} instanceId={id} zone={zone} isEnabled={isDraggableEnabled(isOpponent)}>
        <div
          className="snap-start shrink-0 flex flex-col items-center gap-1 px-0.5"
          style={handStyle}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const left = Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2));
            // Hand cards sit at the bottom of the screen — flip the popover above
            // the card when there's not enough room below.
            const POPOVER_EST_HEIGHT = 160;
            const placement = rect.bottom + POPOVER_EST_HEIGHT > window.innerHeight - 8 ? "above" : "below";
            const top = placement === "below" ? rect.bottom + 6 : rect.top - 6;
            setPopoverPos({ top, left, placement });
          }}
        >
          <DroppableCardTarget id={id} isValidTarget={isDropTarget} activeId={dnd.activeId}>
            <div className="relative">
              <GameCard
                instanceId={id}
                gameState={gameState}
                definitions={definitions}
                gameModifiers={gameModifiers}
                isSelected={isSingTogetherSelected}
                isTarget={isChallTarget || isShiftTarget || isSingTarget || isMoveTarget || isDropTarget || (isSingTogetherTarget && !isSingTogetherSelected)}
                isAttacker={isAttacker}
                onClick={handleClick}
                zone={zone}
                faceDown={faceDown}
                onCardsUnderClick={(cid) => setCardsUnderViewerId(cid)}
                isPlayable={zone === "hand" && !isOpponent && isYourTurn ? playableHandIds.has(id) : undefined}
              />
              {disambigBadge && (
                <span className="absolute top-1 right-1 text-[10px] font-black bg-white/90 text-gray-900 px-1.5 py-0.5 rounded shadow pointer-events-none">
                  {disambigBadge}
                </span>
              )}
            </div>
          </DroppableCardTarget>
        </div>
      </DraggableCard>
    );
  }

  const fmtMsg = (msg: string) => msg
    .replace(/\bplayer1\b/g, "P1").replace(/\bplayer2\b/g, "P2")
    .replace(/^(P1|P2)\s+/, ""); // strip leading "P1 "/"P2 " — the colored prefix already shows it

  // Log entries — rendered inline; caller wraps with appropriate height class
  const logEntries = recentLog.map((entry, i) => (
    <div key={i} className="text-gray-500">
      <span className="text-gray-700">T{entry.turn}</span>{" "}
      <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
        {entry.playerId === "player1" ? "P1" : "P2"}
      </span>{" "}
      {fmtMsg(entry.message)}
    </div>
  ));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => { setInspectCardId(null); setInspectModalOpen(false); dnd.handleDragStart(e); }}
      onDragOver={(e) => setHoveredDropId((e.over?.id as string) ?? null)}
      onDragEnd={(e) => { setHoveredDropId(null); dnd.handleDragEnd(e); }}
      onDragCancel={() => { setHoveredDropId(null); dnd.handleDragCancel(); }}
    >
    <div
      className="h-dvh overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_220px] lg:grid-cols-[1fr_280px] landscape-phone:!grid-cols-1 gap-0 md:gap-4 lg:gap-5 landscape-phone:!gap-0"
      style={{
        // iPhone Dynamic Island / notch — keep content inside the safe area
        // on top/sides. viewport-fit=cover in index.html opts in; these
        // insets are 0 on platforms without a notch.
        //
        // Bottom safe-area (home-indicator): previously unpadded to maximize
        // vertical budget. Users reported that dragging a hand card upward
        // in landscape PWA occasionally triggered the iOS home gesture
        // because the initial touch started inside the system gesture
        // zone. Padding the bottom moves the hand up out of that zone.
        // env() resolves to 0 in browsers without notches / home indicator
        // (no budget impact); in PWA standalone it's ~21-34px.
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        // Kill the 300ms tap delay and double-tap-to-zoom on the board. Pinch
        // zoom remains available (for accessibility — stat-delta badges and
        // keyword icons are ~8-12px) because we use `manipulation`, not
        // `none`. DraggableCard keeps its own touch-action for drag isolation.
        touchAction: "manipulation",
      }}
    >
      {/* ======================= Main game area ======================= */}
      <div className="min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden px-3 md:pl-4 md:pr-0 pt-3 pb-3 landscape-phone:!px-2 landscape-phone:!pt-0.5 landscape-phone:!pb-0.5 landscape-phone:!gap-0.5">


        {/* Replay mode banner */}
        {replayData && (
          <div className="shrink-0 rounded-xl px-3 py-2 flex items-center gap-3 bg-indigo-950/60 border border-indigo-700/40">
            <span className="text-indigo-300 text-xs font-bold uppercase tracking-wider">Replay</span>
            <span className="text-gray-500 text-xs">Turn {replaySession.state?.turnNumber ?? "–"}</span>
            <div className="ml-auto flex items-center gap-2">
              <label className="cursor-pointer px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-xs text-gray-300 transition-colors">
                Load replay
                <input type="file" accept=".json" className="hidden" onChange={handleUploadReplay} />
              </label>
              <button
                className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 transition-colors"
                onClick={() => setReplayData(null)}
              >
                Exit replay
              </button>
            </div>
          </div>
        )}

        {/* ---- Opponent hand — hoisted OUT of the opponent zone so that
               the opponent/player zones compete for equal flex-1 vertical
               space and end up with equal effective play-area heights.
               Only the hand strip heights differ between players.
               Always rendered (even when empty) so zones below don't shift
               when the opponent plays their last card or draws their first. ---- */}
        <div className="shrink-0 h-6 sm:h-16 landscape-phone:!h-5 overflow-hidden flex flex-nowrap items-end justify-center -mx-3 px-2 md:mx-0">
          {p2Zones.hand.length === 0 ? (
            <span className="text-gray-700 text-xs italic self-center">Empty hand</span>
          ) : (
            p2Zones.hand.map((id, i) => renderCardWithActions(id, "hand", true, i, p2Zones.hand.length, true))
          )}
        </div>

        {/* ---- Opponent zone ---- */}
        <div className={`flex-1 min-h-0 flex flex-col -mx-3 px-2 md:mx-0 rounded-xl bg-gradient-to-b from-red-950/10 to-transparent border p-2 transition-colors duration-300 landscape-phone:!p-0.5 landscape-phone:!gap-1 landscape-phone:!rounded-md ${!isYourTurn ? "border-red-600/50" : "border-gray-800/30"}`}>
          {/* Opponent utility strip */}
          <UtilityStrip
            deckCount={p2Zones.deck.length}
            deckTopId={p2Zones.deck[p2Zones.deck.length - 1]}
            deckTopVisible={gameModifiers?.topOfDeckVisible.has(opponentId)}
            inkwellIds={p2Zones.inkwell}
            availableInk={p2.availableInk}
            inksUsed={p2.inkPlaysThisTurn ?? (p2.hasPlayedInkThisTurn ? 1 : 0)}
            canStillInk={false}
            isYourTurn={false}
            isValidInkwellTarget={false}
            discardCount={p2Zones.discard.length}
            discardTopId={p2Zones.discard[p2Zones.discard.length - 1]}
            onDiscardClick={() => setDiscardViewerId("opponent")}
            gameState={gameState}
            definitions={definitions}
            gameModifiers={gameModifiers}
            playerId={opponentId}
          />
          {/* Opponent play zone */}
          {p2Zones.play.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-gray-700 text-xs italic">No cards in play</span>
            </div>
          ) : (
            renderPlayArea(p2Zones.play, true)
          )}
        </div>

        {/* ---- Play zone divider (also drop target for quest) ---- */}
        <div className="shrink-0 flex items-center gap-2 py-0.5 landscape-phone:!py-0">
          {/* Undo — left side */}
          <div className="w-16 flex justify-start">
            {session.canUndo && !replayData && (
              <button
                className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs bg-gray-700/40 hover:bg-gray-700/60 text-gray-400 hover:text-gray-200 rounded sm:rounded-md border border-gray-600/40 font-medium transition-colors"
                onClick={() => { session.undo(); cancelMode(); }}
                title="Undo last action"
              >
                <Icon name="arrow-uturn-left" className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            )}
          </div>

          <DroppableQuestDivider
            isValidTarget={!!dnd.activeId && dnd.isValidQuestDrop(dnd.activeId)}
            activeId={dnd.activeId}
            myLore={p1.lore}
            opponentLore={p2.lore}
            loreThreshold={getLoreThreshold(gameState, definitions, myId)}
          />

          {/* Pass / Cancel — right side */}
          <div className="w-16 flex justify-end">
            {(challengeAttackerId || shiftCardId || moveCharId || singTogetherCardId) ? (
              <button
                className={`px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs rounded sm:rounded-md border font-medium transition-colors
                  ${challengeAttackerId
                    ? "bg-red-900/40 hover:bg-red-900/60 text-red-400 border-red-700/40"
                    : moveCharId
                      ? "bg-cyan-900/40 hover:bg-cyan-900/60 text-cyan-400 border-cyan-700/40"
                      : singTogetherCardId
                        ? "bg-yellow-900/40 hover:bg-yellow-900/60 text-yellow-400 border-yellow-700/40"
                        : "bg-purple-900/40 hover:bg-purple-900/60 text-purple-400 border-purple-700/40"}`}
                onClick={cancelMode}
              >
                Cancel
              </button>
            ) : isYourTurn && !pendingChoice && !isGameOver ? (
              <button
                className="px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs bg-green-700/30 hover:bg-green-700/50 text-green-400 rounded sm:rounded-md border border-green-600/40 font-medium transition-colors"
                onClick={() => session.dispatch({ type: "PASS_TURN", playerId: myId })}
              >
                Pass
              </button>
            ) : null}
          </div>
        </div>

        {/* ---- Player zone ---- */}
        <div className={`flex-1 min-h-0 flex flex-col -mx-3 px-2 md:mx-0 rounded-xl bg-gradient-to-t from-green-950/10 to-transparent border p-2 transition-colors duration-300 landscape-phone:!p-0.5 landscape-phone:!gap-1 landscape-phone:!rounded-md ${isYourTurn ? "border-green-600/50" : "border-gray-800/30"}`}>
          {/* Play zone — droppable for card play */}
          <DroppablePlayZone
            isValidTarget={!!dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId)}
            activeId={dnd.activeId}
            dropLabel="Play"
            className="flex-1 min-h-0 flex flex-col"
          >
            {/* Player play zone */}
            {p1Zones.play.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-700 text-xs italic">
                  {dnd.activeId && dnd.isValidPlayZoneDrop(dnd.activeId) ? "Drop here to play" : "No cards in play"}
                </span>
              </div>
            ) : (
              renderPlayArea(p1Zones.play, false)
            )}
          </DroppablePlayZone>

          {/* Player utility strip */}
          <UtilityStrip
            deckCount={p1Zones.deck.length}
            deckTopId={p1Zones.deck[p1Zones.deck.length - 1]}
            deckTopVisible={gameModifiers?.topOfDeckVisible.has(myId)}
            onDeckClick={() => setDeckViewerOpen(true)}
            inkwellIds={p1Zones.inkwell}
            availableInk={p1.availableInk}
            inksUsed={inksUsed}
            canStillInk={canStillInk}
            isYourTurn={isYourTurn}
            isValidInkwellTarget={!!dnd.activeId && dnd.isValidInkwellDrop(dnd.activeId)}
            droppable
            discardCount={p1Zones.discard.length}
            discardTopId={p1Zones.discard[p1Zones.discard.length - 1]}
            onDiscardClick={() => setDiscardViewerId("player")}
            gameState={gameState}
            definitions={definitions}
            gameModifiers={gameModifiers}
            playerId={myId}
          />
        </div>

        {/* ---- Player hand — hoisted OUT of the player zone so that the
               opponent/player zones compete for equal flex-1 vertical space
               and end up with equal effective play-area heights. Only the
               hand strip heights differ between players. ---- */}
        <div className="shrink-0 mt-1 -mx-3 px-2 md:mx-0 landscape-phone:!mt-0">
          {/* min-h matches the natural single-row card height (md card 146px,
              lg card 168px + padding) so empty hand and filled-single-row
              hand are the same height — no board shift when a card is drawn
              into an empty hand. max-h still allows wrapping to 2 rows for
              rare large hands (which will shift, but that's acceptable). */}
          <div className="h-20 overflow-hidden flex flex-nowrap items-start justify-center md:h-auto md:overflow-hidden md:flex-wrap md:max-h-[260px] lg:max-h-[355px] md:p-1 md:min-h-[160px] lg:min-h-[180px] landscape-phone:!h-[60px] landscape-phone:!flex-nowrap landscape-phone:!max-h-[60px] landscape-phone:!min-h-[60px] landscape-phone:!p-0">
            {p1Zones.hand.length === 0 ? (
              <span className="text-gray-700 text-xs italic self-center">Empty hand</span>
            ) : (
              p1Zones.hand.map((id, i) => renderCardWithActions(id, "hand", false, i, p1Zones.hand.length))
            )}
          </div>
        </div>

        {/* Replay controls — shown when reviewing a completed game */}
        {replayData && (
          <ReplayControls
            session={replaySession}
            onTakeOver={(state) => {
              // Fork: install the replay state as a fresh live baseline so
              // subsequent undos reconstruct from here, not from the original
              // game's seed+actions (which would land back on the victory
              // screen).
              setReplayData(null);
              session.forkFrom(state);
            }}
          />
        )}

      </div>

      {/* ======================= Sidebar (Sandbox or Game Log) ======================= */}
      <div className="hidden md:flex landscape-phone:!hidden flex-col min-h-0 pt-3 pb-3 pr-4 gap-4">
        {sandboxMode ? (
          <>
            <div className="shrink-0">
              <SandboxPanel
                session={session}
                gameState={gameState}
                definitions={definitions}
                myId={myId}
                autoPassP2={autoPassP2}
                onAutoPassP2Change={setAutoPassP2}
                onResetBoard={handleResetBoard}
              />
            </div>
            <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-gray-900/60 border border-gray-800/50 p-3 gap-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold shrink-0">
                Game Log ({actionLog.length})
              </div>
              <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 select-text">
                {logEntries}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-gray-900/60 border border-gray-800/50 p-3 gap-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold shrink-0">
              Game Log ({actionLog.length})
            </div>
            <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 select-text">
              {logEntries}
            </div>
          </div>
        )}
      </div>



      {/* ======================= Mobile: Sandbox drawer =======================
          Shown on < md AND on landscape-phone — same reasoning as the log
          drawer (sidebar is hidden in landscape-phone). */}
      <div className={`fixed inset-0 z-40 md:hidden landscape-phone:!block transition-opacity duration-200 ${showAnalysis ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAnalysis(false)} />
        <div
          className={`absolute top-0 right-0 bottom-0 w-[280px] max-w-[85vw] flex flex-col
                      bg-gray-950 border-l border-gray-800 shadow-2xl
                      transition-transform duration-200 ${showAnalysis ? "translate-x-0" : "translate-x-full"}`}
          style={{
            // Safe-area insets so the header clears the Dynamic Island
            // (portrait top) and notch-side (landscape). Bottom pad keeps
            // content above the home-indicator on PWA standalone.
            paddingTop: "env(safe-area-inset-top)",
            paddingRight: "env(safe-area-inset-right)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
            {/* X on the left: keeps the close button clear of the status bar
                / battery icon (landscape top-right) and the kebab (which
                occupies the viewport top-right corner). */}
            <button onClick={() => setShowAnalysis(false)} className="text-gray-500 hover:text-gray-300 active:scale-95 shrink-0">
              <Icon name="x-mark" className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-gray-300">Sandbox</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <SandboxPanel
              session={session}
              gameState={gameState}
              definitions={definitions}
              myId={myId}
              autoPassP2={autoPassP2}
              onAutoPassP2Change={setAutoPassP2}
              onResetBoard={handleResetBoard}
            />
            <div className="space-y-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                Game Log ({actionLog.length})
              </div>
              <div className="h-48 overflow-y-auto rounded-lg border border-gray-800/30 p-2 bg-gray-950/50 text-[11px] font-mono space-y-0.5 select-text">
                {logEntries}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ======================= Mobile: Log drawer =======================
          Shown on < md (portrait mobile) AND on landscape-phone (which is
          usually md+ wide but has no visible sidebar — sidebar is hidden
          by landscape-phone:!hidden). */}
      <div className={`fixed inset-0 z-40 md:hidden landscape-phone:!block transition-opacity duration-200 ${showLog ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLog(false)} />
        <div
          className={`absolute top-0 right-0 bottom-0 w-[280px] max-w-[85vw] flex flex-col
                      bg-gray-950 border-l border-gray-800 shadow-2xl
                      transition-transform duration-200 ${showLog ? "translate-x-0" : "translate-x-full"}`}
          style={{
            // Safe-area insets so the header clears the Dynamic Island
            // (portrait top) and notch-side (landscape). Bottom pad keeps
            // content above the home-indicator on PWA standalone.
            paddingTop: "env(safe-area-inset-top)",
            paddingRight: "env(safe-area-inset-right)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
            {/* X on the left: keeps the close button clear of the status bar
                / battery icon (landscape top-right) and the kebab (which
                occupies the viewport top-right corner). */}
            <button onClick={() => setShowLog(false)} className="text-gray-500 hover:text-gray-300 active:scale-95 shrink-0">
              <Icon name="x-mark" className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-gray-300">Game Log ({actionLog.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5 select-text">
            {recentLog.map((entry, i) => (
              <div key={i} className="text-gray-500">
                <span className="text-gray-700">T{entry.turn}</span>{" "}
                <span className={entry.playerId === "player1" ? "text-green-600" : "text-red-600"}>
                  {entry.playerId === "player1" ? "P1" : "P2"}
                </span>{" "}
                {fmtMsg(entry.message)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ======================= Floating mode toasts =======================
          All use TopToast wrapper for safe-area-aware positioning (without
          it the toasts sat behind the Dynamic Island, with mode-toast
          Cancel/Confirm buttons unreachable). InfoToast = passive pulse
          for "Opponent thinking" / "Waiting." ModeToast = interactive
          pill for the 2-step click modes (Challenge/Shift/Sing/Move). */}
      {pendingChoice && pendingChoice.choosingPlayerId !== myId && (
        <InfoToast text="Opponent is thinking…" theme="yellow" />
      )}
      {/* Multiplayer: waiting for opponent's turn (no pending choice, not your turn) */}
      {multiplayerGame && !pendingChoice && !isGameOver && !isYourTurn && (
        <InfoToast text="Waiting for opponent…" theme="gray" />
      )}
      {!pendingChoice && !isGameOver && isYourTurn && (challengeAttackerId || shiftCardId || singCardId || singTogetherCardId || moveCharId) && (
        <TopToast className="flex items-center gap-2">
          {challengeAttackerId && (
            <ModeToast label="Challenge" hint="tap a highlighted opponent card" theme="red" onCancel={cancelMode} />
          )}
          {shiftCardId && (
            <ModeToast label="Shift" hint="tap a highlighted character" theme="purple" onCancel={cancelMode} />
          )}
          {singCardId && (
            <ModeToast label="Sing" hint="tap a highlighted character to sing" theme="yellow" onCancel={cancelMode} />
          )}
          {singTogetherCardId && (() => {
            const canConfirm = singTogetherSelected.length > 0 && singTogetherTotalCost >= singTogetherRequiredCost;
            return (
              <ModeToast label="Sing Together" hint="tap singers to add/remove" theme="yellow" onCancel={cancelMode}>
                <span className={`font-mono ${canConfirm ? "text-green-400" : "text-yellow-500"}`}>
                  {singTogetherTotalCost}/{singTogetherRequiredCost}
                </span>
                <button
                  className={`px-2 py-0.5 rounded font-bold active:scale-95 ${
                    canConfirm
                      ? "bg-green-700 hover:bg-green-600 text-green-100"
                      : "bg-gray-800 text-gray-600 cursor-not-allowed"
                  }`}
                  disabled={!canConfirm}
                  onClick={() => {
                    if (!canConfirm || !singTogetherCardId) return;
                    session.dispatch({
                      type: "PLAY_CARD",
                      playerId: myId,
                      instanceId: singTogetherCardId,
                      singerInstanceIds: [...singTogetherSelected],
                    });
                    cancelMode();
                  }}
                >
                  Confirm
                </button>
              </ModeToast>
            );
          })()}
          {moveCharId && (
            <ModeToast label="Move" hint="tap a highlighted location" theme="cyan" onCancel={cancelMode} />
          )}
        </TopToast>
      )}

      {/* ======================= DragOverlay ======================= */}
      <DragOverlay>
        {dnd.activeId && gameState ? (
          <div className="pointer-events-none relative">
            <div className="opacity-80 scale-110 rotate-3">
              <GameCard
                instanceId={dnd.activeId}
                gameState={gameState}
                definitions={definitions}
                gameModifiers={gameModifiers}
                isSelected={false}
                onClick={() => {}}
                zone={dnd.activeZone ?? "hand"}
              />
            </div>
            {dragActionLabel && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                {/* Colors mirror the mode-toast vocabulary so click-mode and
                    drag-mode feel like the same action with the same color. */}
                <span className={`px-2 py-1 rounded text-[11px] font-bold shadow-lg border ${
                  dragActionLabel === "Challenge" ? "bg-red-950/95 text-red-200 border-red-700" :
                  dragActionLabel === "Shift"     ? "bg-purple-950/95 text-purple-200 border-purple-700" :
                  dragActionLabel === "Sing"      ? "bg-yellow-950/95 text-yellow-200 border-yellow-700" :
                  dragActionLabel === "Move"      ? "bg-cyan-950/95 text-cyan-200 border-cyan-700" :
                  dragActionLabel === "Ink"       ? "bg-blue-950/95 text-blue-200 border-blue-700" :
                  dragActionLabel === "Quest"     ? "bg-amber-950/95 text-amber-200 border-amber-700" :
                  /* Play */                        "bg-black/90 text-green-300 border-green-700/60"
                }`}>
                  {dragActionLabel}
                </span>
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>

      {/* ======================= Board Menu (kebab + connection dot) =======================
          Replaces the scoreboard's button row. Houses chrome-level actions
          (Log, Sandbox tools, Resign, Back/Concede). Lore lives in the play
          divider; Active Effects lives in the bottom-right pill stack.
          Auto-hides when a drawer / effects modal / game-over overlay is up
          so the kebab doesn't overlap the drawer's X button (both at the
          viewport top-right corner). */}
      {(!sandboxMode || onBack) && (
        <BoardMenu
          sandboxMode={!!sandboxMode}
          isGameOver={isGameOver}
          connectionStatus={session.connectionStatus ?? null}
          hidden={showLog || showAnalysis || showEffects || isGameOver}
          onOpenLog={() => setShowLog(true)}
          {...(sandboxMode ? { onOpenSandbox: () => setShowAnalysis(true) } : {})}
          {...(multiplayerGame && !isGameOver
            ? {
                onResign: () => {
                  void import("../lib/serverApi.js").then(({ resignGame }) =>
                    resignGame(multiplayerGame.gameId),
                  );
                },
              }
            : {})}
          {...(onBack
            ? {
                onBackOrConcede: () => {
                  session.reset();
                  onBack();
                },
                backLabel: sandboxMode ? "back" : "concede",
              }
            : {})}
        />
      )}

      {/* ======================= Pending Choice Modal ======================= */}
      {pendingChoice && pendingChoice.choosingPlayerId === myId && !choiceModalHidden && (
        <PendingChoiceModal
          pendingChoice={pendingChoice}
          myId={myId}
          gameState={gameState}
          definitions={definitions}
          multiSelectTargets={multiSelectTargets}
          onMultiSelectChange={setMultiSelectTargets}
          onHide={() => setChoiceModalHidden(true)}
          onResolveChoice={(choice) => {
            session.resolveChoice(choice);
            setMultiSelectTargets([]);
          }}
        />
      )}

      {/* Floating restore pill — shown when modal is hidden */}
      {pendingChoice && pendingChoice.choosingPlayerId === myId && choiceModalHidden && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-indigo-700 hover:bg-indigo-600 active:scale-95 text-white text-xs font-semibold rounded-full shadow-lg border border-indigo-500 transition-all"
            onClick={() => setChoiceModalHidden(false)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
            View Choice
          </button>
        </div>
      )}
    </div>

      {/* ======================= Game Over Modal ======================= */}
      {isGameOver && !replayData && (() => {
        // Bo3 match state (embedded by server on game-over)
        const matchNextGameId = (gameState as Record<string, unknown>)._matchNextGameId as string | null | undefined;
        const matchScore = (gameState as Record<string, unknown>)._matchScore as { p1: number; p2: number } | undefined;
        const hasNextGame = !!matchNextGameId;
        const myScore = matchScore ? (myId === "player1" ? matchScore.p1 : matchScore.p2) : 0;
        const oppScore = matchScore ? (myId === "player1" ? matchScore.p2 : matchScore.p1) : 0;
        const myLore = gameState.players[myId]?.lore ?? 0;
        const oppId: PlayerID = myId === "player1" ? "player2" : "player1";
        const oppLore = gameState.players[oppId]?.lore ?? 0;
        const turnCount = gameState.turnNumber;

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-950 border border-amber-500/30 rounded-2xl p-8 text-center space-y-4 shadow-2xl mx-4 w-full max-w-sm">
            <div className="text-4xl font-black text-amber-400 tracking-tight">
              {winner === myId ? "Victory!" : winner ? "Defeat" : "Draw"}
            </div>
            <div className="text-sm text-gray-400">
              {winner === myId ? "You won the game" : winner ? (multiplayerGame ? "Your opponent won" : "The bot won") : "The game ended in a draw"}
            </div>
            {/* Final game stats — lore totals + turn count */}
            <div className="flex items-center justify-center gap-6 py-2 border-y border-gray-800/60">
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">You</div>
                <div className="text-2xl font-black text-green-400 font-mono">{myLore}</div>
              </div>
              <div className="text-gray-700 text-lg">–</div>
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Opp</div>
                <div className="text-2xl font-black text-red-400 font-mono">{oppLore}</div>
              </div>
              <div className="h-8 w-px bg-gray-800" />
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Turns</div>
                <div className="text-2xl font-black text-gray-300 font-mono">{turnCount}</div>
              </div>
            </div>
            {/* Bo3 match score */}
            {matchScore && (
              <div className="text-lg font-bold text-gray-200">
                Match: <span className="text-green-400">{myScore}</span> – <span className="text-red-400">{oppScore}</span>
                {!hasNextGame && <span className="text-xs text-gray-500 ml-2">(final)</span>}
              </div>
            )}
            {/* Unified button layout — same shape across solo / MP / Bo3.
                Slot 1: contextual primary CTA (Play Again / Next Game),
                  may be absent in MP end-of-match (no rematch UI yet —
                  see HANDOFF.md for client-side rematch trigger).
                Slot 2: Back to Lobby — always present. Promoted to amber
                  primary styling when slot 1 is absent (MP end-of-match).
                Slot 3: Review Game / Download Replay — when replay data
                  exists. Solo: from session.completedGame. MP: from the
                  mpReplay fetch effect above. */}
            <div className="flex flex-col items-center gap-2 pt-1 w-full">
              {(() => {
                const completedReplay = session.completedGame ?? mpReplay;
                const primaryStyle = "w-full px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-amber-600/20";
                const secondaryStyle = "w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors border border-gray-700";
                const tertiaryReviewStyle = "w-full px-4 py-2 bg-indigo-700/50 hover:bg-indigo-700/70 text-indigo-200 rounded-lg font-medium transition-colors border border-indigo-600/40 text-sm";
                const tertiaryDownloadStyle = "w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors border border-gray-700 text-sm";

                const hasPrimary = (multiplayerGame && hasNextGame) || !multiplayerGame;
                const backToLobby = () => {
                  session.reset();
                  setReplayData(null);
                  onBack?.();
                };
                return (
                  <>
                    {/* Primary slot */}
                    {multiplayerGame && hasNextGame && (
                      <button
                        className={primaryStyle}
                        onClick={() => {
                          const nextId = matchNextGameId!;
                          localStorage.setItem("mp-game", JSON.stringify({ gameId: nextId, myPlayerId: myId }));
                          session.reset();
                          window.location.href = `/game/${nextId}`;
                        }}
                      >
                        Next Game
                      </button>
                    )}
                    {!multiplayerGame && (
                      <button
                        className={primaryStyle}
                        onClick={() => { session.reset(); setReplayData(null); }}
                      >
                        Play Again
                      </button>
                    )}

                    {/* Secondary slot — Back to Lobby. Promoted to primary
                        styling when there's no other primary CTA. */}
                    <button
                      className={hasPrimary ? secondaryStyle : primaryStyle}
                      onClick={backToLobby}
                    >
                      Back to Lobby
                    </button>

                    {/* Tertiary row — Review + Download, when replay exists */}
                    {completedReplay && (
                      <div className="grid grid-cols-2 gap-2 w-full">
                        <button
                          className={tertiaryReviewStyle}
                          onClick={() => setReplayData(completedReplay)}
                        >
                          Review
                        </button>
                        <button
                          className={tertiaryDownloadStyle}
                          onClick={handleDownloadReplay}
                        >
                          Download
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ======================= Card action popover (fixed near card) =======================
          Buttons scale down on mobile to stay proportional to the smaller
          card width (52px play / 88px hand) vs desktop (104-120px). */}
      {inspectCardId && popoverPos && (
        <div
          data-card-popover
          className="fixed z-50 flex flex-col items-stretch gap-1 pointer-events-auto sm:min-w-[120px]"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            transform: popoverPos.placement === "above" ? "translate(-50%, -100%)" : "translateX(-50%)",
          }}
          onClick={e => e.stopPropagation()}
        >
          {(cardButtons.get(inspectCardId) ?? []).map((btn, i) => (
            <button
              key={i}
              className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold whitespace-nowrap shadow-lg transition-colors active:scale-95 ${btn.color}`}
              onClick={(e) => { btn.onClick(e); setInspectCardId(null); }}
            >
              {btn.label}
            </button>
          ))}
          {/* Inspect + close sit on a small horizontal row at the bottom */}
          <div className="flex items-center justify-end gap-1">
            <button
              className="shrink-0 p-1 sm:p-1.5 text-gray-400 hover:text-gray-200 bg-gray-800/90 hover:bg-gray-700 rounded-md sm:rounded-lg shadow-lg transition-colors"
              onClick={() => setInspectModalOpen(true)}
              title="Inspect card"
            >
              <Icon name="magnifying-glass" className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              className="shrink-0 p-1 sm:p-1.5 text-gray-500 hover:text-gray-300 bg-gray-800/90 hover:bg-gray-700 rounded-md sm:rounded-lg shadow-lg transition-colors"
              onClick={() => { setInspectCardId(null); setInspectModalOpen(false); }}
            >
              <Icon name="x-mark" className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ======================= Card Inspect Modal (full image) ======================= */}
      {inspectCardId && inspectModalOpen && (
        <CardInspectModal
          instanceId={inspectCardId}
          gameState={gameState}
          definitions={definitions}
          actions={[]}
          onClose={() => setInspectModalOpen(false)}
          gameModifiers={gameModifiers}
        />
      )}

      {/* ======================= Discard Zone Viewer ======================= */}
      {discardViewerId && (() => {
        const isPlayer = discardViewerId === "player";
        const discardCards = isPlayer ? p1Zones.discard : p2Zones.discard;
        const inkActions = new Map<string, { label: string; color: string; onClick: () => void }>();
        if (isPlayer) {
          for (const a of legalActions) {
            if (a.type === "PLAY_INK" && discardCards.includes(a.instanceId)) {
              inkActions.set(a.instanceId, {
                label: "Ink",
                color: "bg-blue-700 hover:bg-blue-600 text-blue-100",
                onClick: () => { session.dispatch(a); setDiscardViewerId(null); },
              });
            }
          }
        }
        return (
          <ZoneViewModal
            title={isPlayer ? "Your Discard" : "Opponent's Discard"}
            cardIds={discardCards}
            gameState={gameState}
            definitions={definitions}
            onClose={() => setDiscardViewerId(null)}
            cardActions={inkActions.size > 0 ? inkActions : undefined}
          />
        );
      })()}

      {/* ======================= Revealed Hand Viewer (auto-triggered by reveal_hand effect) ======================= */}
      {/* Closing the modal collapses to the RevealPill (bottom-right) rather
          than dismissing outright — user can re-open during the same turn. */}
      {showRevealHandModal && gameState?.lastRevealedHand && (
        <ZoneViewModal
          title={`${gameState.lastRevealedHand.playerId === myId ? "Your" : "Opponent's"} Revealed Hand`}
          cardIds={gameState.lastRevealedHand.cardIds}
          gameState={gameState}
          definitions={definitions}
          onClose={() => setRevealHandCollapsedToPill(true)}
        />
      )}

      {/* ======================= Revealed Cards Viewer (search/look-at-top with reveal) ======================= */}
      {showRevealCardsModal && gameState?.lastRevealedCards && (() => {
        const rc = gameState.lastRevealedCards!;
        const srcInst = gameState.cards[rc.sourceInstanceId];
        const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
        const sourceName = srcDef?.fullName ?? "Card";
        return (
          <ZoneViewModal
            title={`Revealed by ${sourceName}`}
            cardIds={rc.instanceIds}
            gameState={gameState}
            definitions={definitions}
            onClose={() => setRevealCardsCollapsedKey(currentRevealCardsKey)}
          />
        );
      })()}

      {/* ======================= Status Pill Stack =======================
          Bottom-right floating stack, independent of the mid-screen
          "View Choice" pill (bottom-center). Contains:
          - Active Effects pill (conditional on gameModifiers producing any)
          - Reveal Hand pill (collapsed reveal viewer)
          - Reveal Cards pill (collapsed reveal viewer)
          RevealPills clear at next turn boundary via the
          `revealHandTurnAnchor` / `revealCardsTurnAnchor` gate; Active
          Effects is always live state. */}
      {(showRevealHandPill || showRevealCardsPill || activeEffects.length > 0) && (
        <div
          className="fixed right-4 z-40 flex flex-col items-end gap-2 pointer-events-none"
          style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          {activeEffects.length > 0 && (
            <ActiveEffectsPill count={activeEffects.length} onClick={() => setShowEffects(true)} />
          )}
          {showRevealHandPill && gameState?.lastRevealedHand && (
            <RevealPill
              title={`${gameState.lastRevealedHand.playerId === myId ? "Your" : "Opponent's"} hand`}
              cardIds={gameState.lastRevealedHand.cardIds}
              gameState={gameState}
              definitions={definitions}
              onClick={() => setRevealHandCollapsedToPill(false)}
            />
          )}
          {showRevealCardsPill && gameState?.lastRevealedCards && (() => {
            const rc = gameState.lastRevealedCards!;
            const srcInst = gameState.cards[rc.sourceInstanceId];
            const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
            const sourceName = srcDef?.fullName ?? "Card";
            return (
              <RevealPill
                title={sourceName}
                cardIds={rc.instanceIds}
                gameState={gameState}
                definitions={definitions}
                onClick={() => setRevealCardsCollapsedKey(null)}
              />
            );
          })()}
        </div>
      )}

      {/* ======================= Deck Viewer (your deck only) ======================= */}
      {deckViewerOpen && (
        <ZoneViewModal
          title="Your Deck"
          cardIds={p1Zones.deck}
          faceDown
          gameState={gameState}
          definitions={definitions}
          onClose={() => setDeckViewerOpen(false)}
        />
      )}
      {/* ======================= Cards Under Viewer ======================= */}
      {cardsUnderViewerId && gameState.cards[cardsUnderViewerId] && (() => {
        const parentInst = gameState.cards[cardsUnderViewerId]!;
        const parentDef = definitions[parentInst.definitionId];
        const underIds = parentInst.cardsUnder ?? [];
        const faceDownSet = new Set(underIds.filter(id => gameState.cards[id]?.isFaceDown));
        return (
          <ZoneViewModal
            title={`Cards Under ${parentDef?.fullName ?? "?"}`}
            cardIds={underIds}
            gameState={gameState}
            definitions={definitions}
            onClose={() => setCardsUnderViewerId(null)}
            faceDownIds={faceDownSet.size > 0 ? faceDownSet : undefined}
          />
        );
      })()}
      {/* ======================= Active Effects Modal ======================= */}
      {showEffects && activeEffects.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowEffects(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-4 max-w-sm w-full sm:w-[90vw] shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Active Effects</span>
              <button className="text-gray-500 hover:text-gray-300" onClick={() => setShowEffects(false)}>
                <Icon name="x-mark" className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {activeEffects.map((e, i) => (
                <div key={i} className="rounded-lg bg-gray-900 border border-gray-800 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-indigo-300 truncate">{e.sourceName ?? e.source}</span>
                      {/* Stack count pill — shows when a grouped timed effect
                          represents N stacked entries (Lady × 3 PACK OF HER
                          OWN triggers → ×3). Preserves the verbose oracle
                          label while surfacing the repetition count.
                          Matches the existing ×N pill convention in
                          CardInspectModal.tsx:284 (amber on amber-900/40)
                          so the stack-count badge reads consistently
                          across the scoreboard's global view AND the
                          card-level filtered view. */}
                      {e.stackCount && e.stackCount > 1 && (
                        <span className="text-[9px] font-bold text-amber-300 bg-amber-900/40 rounded px-1 shrink-0">
                          ×{e.stackCount}
                        </span>
                      )}
                    </span>
                    {e.duration && <span className="text-[9px] text-gray-600 shrink-0">{e.duration}</span>}
                    {e.target && <span className="text-[9px] text-gray-500 shrink-0">{e.target}</span>}
                  </div>
                  <div className="text-[10px] text-gray-400 leading-snug mt-0.5">{e.label}</div>
                  {e.sourceName && e.source !== e.sourceName && (
                    <div className="text-[9px] text-gray-600 mt-0.5">{e.source}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DndContext>
  );
}

// =============================================================================
// DnD primitive components — defined outside GameBoard to avoid re-creation
// but closed over via props, not module scope.
// =============================================================================

function DraggableCard({
  instanceId,
  zone,
  isEnabled,
  children,
}: {
  instanceId: string;
  zone: "hand" | "play";
  isEnabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: instanceId,
    disabled: !isEnabled,
    data: { zone },
  });
  // touch-action required by @dnd-kit PointerSensor/TouchSensor: without it the
  // browser claims a touch gesture for native panning before the 8px activation
  // distance fires, and drag never starts in Chrome device mode / real mobile.
  // - play zone: "none" — cards are in fixed slots, no panning needed, full drag
  // - hand zone: "pan-x" — hand is horizontal (flex-nowrap); allow horizontal
  //   pan so the browser can scroll the hand if it ever becomes overflow-x-auto
  //   (currently overflow-hidden, but pan-x keeps behavior correct if that
  //   changes) while still letting a vertical drag lift a card into play.
  const touchAction = zone === "hand" ? "pan-x" : "none";
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.3 : 1, touchAction }}>
      {children}
    </div>
  );
}

function DroppableCardTarget({
  id,
  isValidTarget,
  activeId,
  children,
}: {
  id: string;
  isValidTarget: boolean;
  activeId: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver: _isOver } = useDroppable({ id: dropCardId(id) });
  // The red border+ring+pulse on valid targets is rendered by GameCard via
  // the isTarget prop (tracks 90°-rotated cards correctly). The action label
  // ("Challenge" / "Sing" / etc.) rides on the DragOverlay. All we do here
  // is dim non-target cards during drag, so invalid targets recede visually.
  const dim = activeId && !isValidTarget ? "brightness-50" : "";
  return (
    <div ref={setNodeRef} className={`relative transition-all duration-150 ${dim}`}>
      {children}
    </div>
  );
}

function DroppablePlayZone({
  isValidTarget,
  activeId,
  dropLabel,
  children,
  className = "",
}: {
  isValidTarget: boolean;
  activeId: string | null;
  dropLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_PLAY_ZONE });
  const ring = isOver && isValidTarget
    ? "ring-2 ring-green-400 ring-inset shadow-green-400/20 shadow-lg"
    : isValidTarget
    ? "ring-1 ring-green-600/40 ring-inset animate-pulse"
    : activeId
    ? "opacity-70"
    : "";
  return (
    <div ref={setNodeRef} className={`relative rounded-lg transition-all duration-150 ${ring} ${className}`}>
      {children}
      {isOver && isValidTarget && dropLabel && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <span className="px-2 py-1 rounded bg-black/80 text-green-300 text-xs font-bold shadow-lg">
            {dropLabel}
          </span>
        </div>
      )}
    </div>
  );
}

function DroppableQuestDivider({
  isValidTarget,
  activeId,
  myLore,
  opponentLore,
  loreThreshold,
}: {
  isValidTarget: boolean;
  activeId: string | null;
  /** Your lore total — rendered in green on the pill. */
  myLore: number;
  /** Opponent's lore total — rendered in red on the pill. */
  opponentLore: number;
  /** Win threshold (usually 20, but cards can change it) — only shown as a tiny badge. */
  loreThreshold: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_QUEST });
  // When a valid quester is being dragged, thicken the divider and shift
  // its color to amber (lore) so the player sees it as a real target.
  // Otherwise it stays the thin gray divider the board has always had.
  const lineBase = isValidTarget
    ? `${isOver ? "bg-amber-400" : "bg-amber-500/70 animate-pulse"}`
    : "bg-gradient-to-r from-transparent via-gray-700/50 to-transparent";
  const lineHeight = isValidTarget ? "h-0.5" : "h-px";
  // Lore pill: always-visible game state. When a valid quester is dragged,
  // the pill pulses amber to signal the drop target. When `isOver`, a `+1`
  // overlay confirms the drop will gain lore.
  const pillBorder = isValidTarget
    ? (isOver ? "border-amber-300 bg-amber-900/60" : "border-amber-500/70 bg-amber-950/40 animate-pulse")
    : "border-gray-800/50 bg-gray-900/60";
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 flex items-center gap-2 py-0.5 transition-colors duration-150 ${activeId && !isValidTarget ? "opacity-70" : ""}`}
    >
      <div className={`flex-1 rounded-full transition-all ${lineHeight} ${lineBase}`} />

      {/* Lore pill — always present. Acts as both the scoreboard and the
          quest drop target. Tiny threshold `/20` badge on the right keeps
          the win condition visible without taking a full pip bar. */}
      <div
        className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all duration-150 ${pillBorder}`}
        title={`You ${myLore} · Opp ${opponentLore} (first to ${loreThreshold})`}
      >
        <span className="text-green-400 font-mono text-xs sm:text-sm font-black leading-none tabular-nums">
          {myLore}
        </span>
        <span className="text-gray-600 text-[10px] leading-none">♦</span>
        <span className="text-gray-700 text-[9px] leading-none">–</span>
        <span className="text-red-400 font-mono text-xs sm:text-sm font-black leading-none tabular-nums">
          {opponentLore}
        </span>
        <span className="text-gray-600 text-[10px] leading-none">♦</span>
      </div>

      <div className={`flex-1 rounded-full transition-all ${lineHeight} ${lineBase}`} />
    </div>
  );
}

function DroppableInkwell({
  isValidTarget,
  children,
}: {
  isValidTarget: boolean;
  activeId: string | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_INKWELL });
  return (
    <div ref={setNodeRef} className={`relative transition-colors duration-150 ${isOver && isValidTarget ? "brightness-125" : ""}`}>
      {children}
      {isOver && isValidTarget && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <span className="px-2 py-1 rounded bg-blue-950/90 text-blue-200 border border-blue-700/60 text-[10px] font-bold shadow-lg">
            Ink
          </span>
        </div>
      )}
    </div>
  );
}
