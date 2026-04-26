import React from "react";
import type { PendingChoice, PlayerID, GameState, CardDefinition } from "@lorcana-sim/engine";
import { getEffectiveStrength, getEffectiveWillpower, getEffectiveLore, getGameModifiers } from "@lorcana-sim/engine";
import { buildLabelMap } from "../utils/buildLabelMap.js";
import { getBoardCardImage } from "../utils/cardImage.js";
import GameCard from "./GameCard.js";
import CardTextRender from "./CardTextRender.js";
import AbilityTextRender from "./AbilityTextRender.js";

// A/B toggle: structured text rendering vs. card art. Persisted across sessions.
const CARD_DISPLAY_KEY = "card-display-mode";
function useCardDisplayMode(): [("art" | "text"), (m: "art" | "text") => void] {
  const [mode, setMode] = React.useState<"art" | "text">(() => {
    if (typeof window === "undefined") return "art";
    return (localStorage.getItem(CARD_DISPLAY_KEY) as "art" | "text") ?? "art";
  });
  const update = React.useCallback((m: "art" | "text") => {
    setMode(m);
    if (typeof window !== "undefined") localStorage.setItem(CARD_DISPLAY_KEY, m);
  }, []);
  return [mode, update];
}

interface Props {
  pendingChoice: PendingChoice;
  myId: PlayerID;
  gameState: GameState;
  definitions: Record<string, CardDefinition>;
  multiSelectTargets: string[];
  onMultiSelectChange: React.Dispatch<React.SetStateAction<string[]>>;
  onHide: () => void;
  onResolveChoice: (choice: string | string[] | number) => void;
}

export default function PendingChoiceModal({
  pendingChoice,
  myId,
  gameState,
  definitions,
  multiSelectTargets,
  onMultiSelectChange,
  onHide,
  onResolveChoice,
}: Props) {
  // State for choose_amount picker (must be top-level per rules of hooks)
  const [chooseAmountValue, setChooseAmountValue] = React.useState(0);
  const chooseAmountMax = (pendingChoice as any).max ?? 0;
  // A/B toggle for card display style in choose_may + choose_trigger.
  const [displayMode, setDisplayMode] = useCardDisplayMode();
  React.useEffect(() => {
    if (pendingChoice.type === "choose_amount") {
      setChooseAmountValue((pendingChoice as any).max ?? 0);
    }
  }, [pendingChoice]);

  function getName(instanceId: string): string {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  }

  // Build context-aware hints from game state for richer prompts.
  // Shows resolved values, card names from lastResolvedTarget/Source, etc.
  //
  // Gating: the snapshots (lastResolvedTarget, lastResolvedSource,
  // lastDamageDealtAmount) persist across effect chains in engine state and
  // are often stale relative to the current pending choice. Only surface a
  // hint when the pending effect (or its follow-ups / options / reject branch)
  // actually references the matching DynamicAmount/target-type — determined by
  // token-scanning the serialized effect JSON.
  function getContextHints(): string[] {
    const hints: string[] = [];
    const pc = pendingChoice as any;
    // Serialize every effect-bearing field on the pending choice so token
    // checks catch DynamicAmount references regardless of where they live.
    const effectJson = JSON.stringify({
      pendingEffect: pc.pendingEffect,
      followUpEffects: pc.followUpEffects,
      options: pc.options,
      rejectEffect: pc.rejectEffect,
    });
    const referencesTarget = effectJson.includes('"last_resolved_target"') ||
                             effectJson.includes('last_resolved_target_strength') ||
                             effectJson.includes('last_resolved_target_lore');
    const referencesSource = effectJson.includes('"last_resolved_source"') ||
                             effectJson.includes('last_resolved_source_strength');
    const referencesDamage = effectJson.includes('"last_damage_dealt"');

    // Last resolved target info (Hades: "Choose a Mickey Mouse to play",
    // isUpTo: show actual consumed amount, cost-side strength snapshot)
    const lrt = (gameState as any).lastResolvedTarget;
    if (referencesTarget && lrt?.name) {
      hints.push(`Target: ${lrt.fullName ?? lrt.name}${lrt.strength != null ? ` (${lrt.strength} STR)` : ""}${lrt.lore != null ? ` (${lrt.lore} lore)` : ""}`);
      if (lrt.delta != null) hints.push(`Amount: ${lrt.delta}`);
    }
    // Last resolved source (cost-side: "exerted character's strength")
    const lrs = (gameState as any).lastResolvedSource;
    if (referencesSource && lrs?.name && lrs.name !== lrt?.name) {
      hints.push(`Source: ${lrs.fullName ?? lrs.name}${lrs.strength != null ? ` (${lrs.strength} STR)` : ""}`);
    }
    // Last damage dealt (Mulan/Namaari: "deal the same amount of damage")
    const ldd = (gameState as any).lastDamageDealtAmount;
    if (referencesDamage && typeof ldd === "number" && ldd > 0) {
      hints.push(`Damage dealt: ${ldd}`);
    }
    // Draw to hand size
    if (pendingChoice.type === "choose_may") {
      const pe = pc.pendingEffect;
      if (pe?.type === "draw" && pe.untilHandSize != null) {
        const target = typeof pe.untilHandSize === "number"
          ? `${pe.untilHandSize} cards`
          : "opponent's hand size";
        hints.push(`Draw until: ${target}`);
      }
    }
    return hints;
  }

  const contextHints = getContextHints();

  /**
   * Unified selection state for card thumbs across every branch.
   * - `idle`          — default, clickable, full brightness.
   * - `unselectable`  — dim heavily, no badge (not in `validTargets`).
   * - `checked`       — dim + centered green check (generic single/multi-select).
   * - `swap`          — dim + centered red swap icon (mulligan put-back).
   * - `ordered`       — dim + centered indigo index badge (choose_order picker).
   */
  type SelectionState =
    | { kind: "idle" }
    | { kind: "unselectable" }
    | { kind: "checked" }
    | { kind: "swap" }
    | { kind: "ordered"; index: number };

  // Renders a card image + selection overlay. Wraps in a scaled container for modal size.
  function CardThumb({
    id,
    selection = { kind: "idle" },
    onClick: handleClick,
  }: {
    id: string;
    selection?: SelectionState;
    onClick: () => void;
  }) {
    const zone = (gameState.cards[id]?.zone === "play" ? "play" : "hand") as "play" | "hand";
    const dimClass =
      selection.kind === "unselectable"
        ? "brightness-[0.35]"
        : selection.kind === "idle"
        ? ""
        : "brightness-50";
    return (
      // aspect-[5/7] forces the layout box to a card-shaped rectangle keyed
      // off grid-cell width. Without this, `transform: scale(0.78)` below
      // shrinks only the visual — the layout box keeps GameCard's full
      // natural height (~168px), making CardThumb 35px taller than the
      // dashed empty-slot placeholder (which IS aspect-[5/7]) in the
      // choose_order preview strip. With aspect-[5/7] + overflow-hidden
      // the wrapper clamps to ~134px tall while the scaled visual at
      // ~131px tall fits inside cleanly (origin-top keeps it anchored).
      <div className="relative flex flex-col items-center cursor-pointer overflow-hidden aspect-[5/7]">
        {/* scale wrapper so cards fit comfortably in the modal */}
        <div className={`scale-[0.78] origin-top transition ${dimClass}`}>
          <GameCard
            instanceId={id}
            gameState={gameState}
            definitions={definitions}
            isSelected={false}
            onClick={handleClick}
            zone={zone}
          />
        </div>
        {/* Centered selection badge — pointer-events-none so clicks pass through
            to the underlying GameCard's own onClick. */}
        {selection.kind === "checked" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-emerald-600/95 rounded-full p-1.5 shadow-lg ring-2 ring-emerald-300/60">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          </div>
        )}
        {selection.kind === "swap" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-red-900/90 rounded-full p-1.5 shadow-lg ring-2 ring-red-400/60">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-red-200" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0 4.5-4.5M3 16.5h13.5m0-13.5L21 7.5m0 0-4.5 4.5M21 7.5H7.5" />
              </svg>
            </div>
          </div>
        )}
        {selection.kind === "ordered" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-indigo-600/95 w-8 h-8 rounded-full flex items-center justify-center shadow-lg ring-2 ring-indigo-300/60">
              <span className="text-sm font-black text-white">{selection.index}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderContent() {
    // CRD 2.1.3.2 / 2.2.1 — play-draw election. Handled BEFORE the generic
    // opponent-perspective block because choose_play_order has no validTargets,
    // and the generic fallback would render a broken disabled "Confirm (as
    // opponent)" button. This branch handles both the chooser's view (two big
    // buttons) and the opponent-side sandbox view (waiting state) explicitly.
    if (pendingChoice.type === "choose_play_order") {
      const isChooser = (pendingChoice as any).choosingPlayerId === myId;
      // _matchScore is embedded by the server on game-over transitions; if
      // present with any wins, we're in a Bo3 continuation (game 2 or 3).
      // Double-cast via unknown because GameState's index signature doesn't
      // overlap with Record<string, unknown> under exactOptionalPropertyTypes.
      const matchScore = (gameState as unknown as Record<string, unknown>)._matchScore as
        | { p1: number; p2: number }
        | undefined;
      const isBo3Continuation = !!matchScore && (matchScore.p1 + matchScore.p2 > 0);
      const myScore = matchScore ? (myId === "player1" ? matchScore.p1 : matchScore.p2) : 0;
      const oppScore = matchScore ? (myId === "player1" ? matchScore.p2 : matchScore.p1) : 0;

      if (!isChooser) {
        // Sandbox only — in MP, the outer GameBoard gate prevents this modal
        // from rendering for the non-chooser (they see the floating "Opponent
        // is thinking…" toast instead). This branch exists so sandbox / dual-
        // perspective contexts don't fall through to the generic opponent
        // fallback.
        return (
          <div className="space-y-3">
            <div className="text-orange-300 text-sm font-bold">Opponent is choosing play order…</div>
            <div className="text-gray-300 text-sm">
              {isBo3Continuation
                ? `They lost the previous game (${oppScore}–${myScore} in the match) and are picking whether to be the starting player.`
                : "They won the coin flip and are picking whether to be the starting player."}
            </div>
          </div>
        );
      }

      // Chooser's view — two prominent buttons.
      const headline = isBo3Continuation
        ? `Game ${matchScore!.p1 + matchScore!.p2 + 1} — your choice`
        : "You won the coin flip";
      const subtitle = isBo3Continuation
        ? `Match: ${myScore}–${oppScore}. You lost the last game, so you choose who starts.`
        : "Choose whether to be the starting player.";
      return (
        <div className="space-y-4">
          <div>
            <div className="text-amber-300 text-sm font-bold mb-1">{headline}</div>
            <div className="text-gray-400 text-xs">{subtitle}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              className="flex flex-col items-center gap-1 px-4 py-4 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-amber-600/20 active:scale-[0.98]"
              onClick={() => onResolveChoice("first")}
            >
              <span className="text-base">Go First</span>
              <span className="text-[10px] font-normal opacity-80 uppercase tracking-wider">On the play</span>
            </button>
            <button
              className="flex flex-col items-center gap-1 px-4 py-4 bg-sky-700 hover:bg-sky-600 text-white rounded-lg font-bold transition-colors shadow-lg shadow-sky-700/20 active:scale-[0.98]"
              onClick={() => onResolveChoice("second")}
            >
              <span className="text-base">Go Second</span>
              <span className="text-[10px] font-normal opacity-80 uppercase tracking-wider">On the draw · draw turn 1</span>
            </button>
          </div>
          <div className="text-[10px] text-gray-500 text-center">
            Going first skips turn-1 draw. Going second draws normally.
          </div>
        </div>
      );
    }

    // Cross-player perspective: when the choosingPlayer is the OPPONENT
    // (Tiana opponent_may_pay_to_avoid, Ursula's Plan opponent-chosen targets),
    // show a waiting indicator. In the headless analytics sim the bot auto-
    // resolves; in the testbench the human controls both sides, so we still
    // show the prompt but with a perspective label.
    const chooser = (pendingChoice as any).choosingPlayerId;
    if (chooser && chooser !== myId && pendingChoice.type !== "choose_mulligan") {
      const isOpponentMay = pendingChoice.type === "choose_may";
      return (
        <div className="space-y-4">
          <div className="text-orange-300 text-sm font-bold">
            Opponent{isOpponentMay ? "'s Decision" : " is choosing..."}
          </div>
          <div className="text-gray-300 text-sm">{pendingChoice.prompt}</div>
          {contextHints.length > 0 && (
            <div className="text-[10px] text-gray-500">{contextHints.join(" · ")}</div>
          )}
          {isOpponentMay && (
            <div className="flex gap-2">
              <button
                className="px-4 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors"
                onClick={() => onResolveChoice("accept")}
              >
                Accept (as opponent)
              </button>
              <button
                className="px-4 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
                onClick={() => onResolveChoice("decline")}
              >
                Decline (as opponent)
              </button>
            </div>
          )}
          {!isOpponentMay && pendingChoice.validTargets && (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
              {(pendingChoice.validTargets ?? []).map((id: string) => {
                const isSel = multiSelectTargets[0] === id;
                return (
                  <CardThumb
                    key={id}
                    id={id}
                    selection={isSel ? { kind: "checked" } : { kind: "idle" }}
                    onClick={() => onMultiSelectChange(isSel ? [] : [id])}
                  />
                );
              })}
            </div>
          )}
          {!isOpponentMay && (
            <button
              className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
              disabled={!multiSelectTargets[0]}
              onClick={() => multiSelectTargets[0] && onResolveChoice([multiSelectTargets[0]])}
            >
              Confirm (as opponent)
            </button>
          )}
        </div>
      );
    }

    // Choose amount (isUpTo: "remove up to 3 damage", "move up to 2 counters")
    if (pendingChoice.type === "choose_amount") {
      const min = (pendingChoice as any).min ?? 0;
      const max = chooseAmountMax;
      return (
        <div className="space-y-4">
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          <div className="flex items-center justify-center gap-3">
            <button
              className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-lg font-bold disabled:opacity-30"
              disabled={chooseAmountValue <= min}
              onClick={() => setChooseAmountValue(a => Math.max(min, a - 1))}
            >
              −
            </button>
            <span className="text-2xl font-black text-white w-10 text-center">{chooseAmountValue}</span>
            <button
              className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-lg font-bold disabled:opacity-30"
              disabled={chooseAmountValue >= max}
              onClick={() => setChooseAmountValue(a => Math.min(max, a + 1))}
            >
              +
            </button>
          </div>
          <button
            className="w-full px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition-colors"
            onClick={() => onResolveChoice(chooseAmountValue)}
          >
            Confirm ({chooseAmountValue})
          </button>
        </div>
      );
    }

    // CRD 2.2.2: Mulligan
    if (pendingChoice.type === "choose_mulligan") {
      const hand = pendingChoice.validTargets ?? [];
      const onThePlay = gameState.firstPlayerId != null && gameState.firstPlayerId === myId;
      const onTheDraw = gameState.firstPlayerId != null && gameState.firstPlayerId !== myId;
      return (
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="text-indigo-200 text-sm font-bold">Opening Hand — Mulligan</div>
              {onThePlay && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-600/90 text-white">
                  On the play
                </span>
              )}
              {onTheDraw && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-600/90 text-white">
                  On the draw
                </span>
              )}
            </div>
            <div className="text-gray-400 text-xs">{pendingChoice.prompt}</div>
          </div>
          {/* Mulligan always has exactly 7 cards — single row on sm+ looks
              cleaner than a 4+3 grid. Mobile portrait (< sm) stays 4-col
              because 7 cards at 88px × scale-0.78 ≈ 69px each needs 480px+,
              which doesn't fit iPhone-class widths. */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
            {hand.map((id) => {
              const selected = multiSelectTargets.includes(id);
              return (
                <CardThumb
                  key={id}
                  id={id}
                  selection={selected ? { kind: "swap" } : { kind: "idle" }}
                  onClick={() =>
                    onMultiSelectChange((prev) =>
                      selected ? prev.filter((t) => t !== id) : [...prev, id],
                    )
                  }
                />
              );
            })}
          </div>
          <button
            className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
            onClick={() => onResolveChoice(multiSelectTargets)}
          >
            {multiSelectTargets.length > 0
              ? `Put back ${multiSelectTargets.length}, draw ${multiSelectTargets.length}`
              : "Keep All"}
          </button>
        </div>
      );
    }

    // Order picker (choose_order) — player clicks cards in their preferred
    // bottom-of-deck order. Three affordances make the abstract "click-order
    // = sequence" mental model concrete:
    //   1. Helper subtitle frames clicks as gameplay events ("first tap goes
    //      to the bottom", "last tap will be drawn first") instead of slot
    //      numbers.
    //   2. A preview strip below the picker shows the final deck
    //      arrangement being built — empty placeholder slots indicate what's
    //      missing; clicking a placed card in the preview removes it.
    //   3. Reset button lets the player clear all placements without
    //      individually deselecting each card.
    if (pendingChoice.type === "choose_order") {
      const ids = pendingChoice.validTargets ?? [];
      const total = ids.length;
      const placedCount = multiSelectTargets.length;
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-medium mb-0.5">{pendingChoice.prompt}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">
              Tap in order — first tap → bottom of deck (drawn last). Last tap → drawn first of these.
            </div>
          </div>

          {/* Picker grid — every valid target is shown; clicking adds to or
              removes from the order queue. Placed cards display their slot
              number via the "ordered" CardThumb badge. */}
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
            {ids.map((id) => {
              const posIndex = multiSelectTargets.indexOf(id);
              const isOrdered = posIndex !== -1;
              return (
                <CardThumb
                  key={id}
                  id={id}
                  selection={isOrdered ? { kind: "ordered", index: posIndex + 1 } : { kind: "idle" }}
                  onClick={() =>
                    onMultiSelectChange((prev) =>
                      isOrdered ? prev.filter((t) => t !== id) : [...prev, id],
                    )
                  }
                />
              );
            })}
          </div>

          {/* Final-order preview strip — left = bottom of deck (drawn last),
              right = top of placed stack (drawn first of these). Empty slots
              show as dashed boxes with their slot number, so the user can
              see how many cards are still missing without counting badges. */}
          <div className="rounded-lg p-2 bg-gray-900/60 border border-gray-800/50">
            <div className="flex items-center justify-between text-[9px] text-gray-500 uppercase tracking-wider mb-1.5 px-0.5">
              <span>← Drawn last</span>
              <span>Drawn first →</span>
            </div>
            {/* Preview strip uses the same grid layout as the picker above
                 so source-cards and destination-slots match in size — flex
                 with flex-1 children stretched the slots to 1/N of the
                 modal width regardless of N, which made 3-card reveals
                 render slots much bigger than the picker source cards. */}
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
              {Array.from({ length: total }, (_, i) => {
                const cardId = multiSelectTargets[i];
                return cardId ? (
                  <CardThumb
                    key={i}
                    id={cardId}
                    selection={{ kind: "ordered", index: i + 1 }}
                    onClick={() => onMultiSelectChange((prev) => prev.filter((t) => t !== cardId))}
                  />
                ) : (
                  <div
                    key={i}
                    className="aspect-[5/7] rounded border-2 border-dashed border-gray-700/50 flex items-center justify-center text-gray-700 text-xs font-mono"
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Confirm + Reset. Reset only renders when there's something to
              clear (placedCount > 0), so the row collapses to a single
              full-width Confirm in the initial empty state. */}
          <div className="flex gap-2">
            <button
              className="flex-1 px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
              disabled={placedCount !== total}
              onClick={() => onResolveChoice(multiSelectTargets)}
            >
              Confirm order ({placedCount}/{total})
            </button>
            {placedCount > 0 && (
              <button
                className="px-3 py-2 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded-lg font-medium transition-colors border border-gray-700"
                onClick={() => onMultiSelectChange([])}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      );
    }

    // Multi-select (choose_cards, choose_discard)
    const needsMultiSelect =
      pendingChoice.type === "choose_cards" ||
      pendingChoice.type === "choose_discard";

    if (needsMultiSelect) {
      const requiredCount = pendingChoice.count ?? 1;
      const validIds = pendingChoice.validTargets ?? [];
      const validSet = new Set(validIds);
      // For choose_discard: if the hand was revealed AS PART OF THE SAME ability
      // chain, show the full hand (non-targets dimmed). Must be fresh — every
      // revealed cardId must still be in the owner's hand, otherwise we'd show
      // a stale snapshot from an earlier card.
      let displayIds: string[] = validIds;
      if (pendingChoice.type === "choose_discard") {
        const revealed = gameState.lastRevealedHand;
        if (revealed) {
          const currentHand = new Set(gameState.zones[revealed.playerId].hand);
          const stillFresh = revealed.cardIds.every((id) => currentHand.has(id));
          // Use the revealed hand if fresh AND either (a) we have a valid target
          // in that same hand, or (b) there are no valid targets at all (stuck case)
          const anyValidInRevealed = validIds.some((id) => {
            const inst = gameState.cards[id];
            return inst?.ownerId === revealed.playerId;
          });
          if (stillFresh && (anyValidInRevealed || validIds.length === 0)) {
            displayIds = revealed.cardIds;
          }
        }
      }
      const noValidTargets = validIds.length === 0;
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-medium mb-0.5">{pendingChoice.prompt}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">
              {noValidTargets ? "No valid targets" : `Select ${requiredCount} card(s)`}
            </div>
          </div>
          {displayIds.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
              {displayIds.map((id) => {
                const selectable = validSet.has(id);
                const selected = multiSelectTargets.includes(id);
                const selection: SelectionState = !selectable
                  ? { kind: "unselectable" }
                  : selected
                  ? { kind: "checked" }
                  : { kind: "idle" };
                return (
                  <CardThumb
                    key={id}
                    id={id}
                    selection={selection}
                    onClick={() => {
                      if (!selectable) return;
                      onMultiSelectChange((prev) =>
                        selected ? prev.filter((t) => t !== id) : [...prev, id],
                      );
                    }}
                  />
                );
              })}
            </div>
          )}
          <div className="flex gap-2">
            {!noValidTargets && (
              <button
                className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
                disabled={multiSelectTargets.length !== requiredCount}
                onClick={() => onResolveChoice(multiSelectTargets)}
              >
                Confirm ({multiSelectTargets.length}/{requiredCount})
              </button>
            )}
            {noValidTargets && (
              <button
                className="px-4 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors"
                onClick={() => onResolveChoice([])}
              >
                Skip
              </button>
            )}
          </div>
        </div>
      );
    }

    // May (accept/decline)
    if (pendingChoice.type === "choose_may") {
      const srcId = (pendingChoice as { sourceInstanceId?: string }).sourceInstanceId;
      const srcInst = srcId ? gameState.cards[srcId] : undefined;
      const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;
      const srcImg = srcDef?.imageUrl;
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            {srcDef && displayMode === "text" ? (
              <div className="shrink-0 w-[200px]">
                <CardTextRender def={srcDef} />
              </div>
            ) : srcImg ? (
              <img
                {...getBoardCardImage(srcImg)}
                alt={srcDef?.fullName ?? ""}
                className="shrink-0 w-[140px] aspect-[5/7] rounded-lg object-cover shadow-lg"
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <div className="flex-1 min-w-0">
              <div className="text-gray-200 text-sm">{pendingChoice.prompt}</div>
              {contextHints.length > 0 && (
                <div className="text-[10px] text-gray-500 mt-0.5">{contextHints.join(" · ")}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("accept")}
            >
              Use ability
            </button>
            <button
              className="px-4 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
              onClick={() => onResolveChoice("decline")}
            >
              Skip
            </button>
          </div>
        </div>
      );
    }

    // CRD 7.7.4: trigger ordering — pick which ability to resolve first
    if (pendingChoice.type === "choose_trigger") {
      const indices = pendingChoice.validTargets ?? [];
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-bold mb-0.5">Triggered Abilities</div>
            <div className="text-gray-400 text-xs">{pendingChoice.prompt}</div>
          </div>
          <div className="flex flex-col gap-2">
            {indices.map((idxStr) => {
              const trigger = gameState.triggerStack[parseInt(idxStr, 10)];
              if (!trigger) return null;
              const sourceCard = gameState.cards[trigger.sourceInstanceId];
              const def = sourceCard ? definitions[sourceCard.definitionId] : undefined;
              const cardName = def?.fullName ?? trigger.sourceInstanceId;
              const abilityName = trigger.ability.storyName ?? "Ability";
              const rulesText = (trigger.ability as { rulesText?: string }).rulesText;
              const cardImg = def?.imageUrl;
              return (
                <button
                  key={idxStr}
                  className="flex items-center gap-3 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-indigo-500 rounded-lg transition-colors text-left"
                  onClick={() => onResolveChoice(idxStr)}
                >
                  {displayMode === "text" ? (
                    <div className="flex-1 min-w-0">
                      <AbilityTextRender
                        ability={trigger.ability}
                        cardName={cardName}
                        compact
                      />
                    </div>
                  ) : (
                    <>
                      {cardImg && (
                        <img
                          {...getBoardCardImage(cardImg)}
                          alt={cardName}
                          className="shrink-0 w-[96px] aspect-[5/7] rounded-md object-cover shadow"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{cardName}</div>
                        <div className="text-xs text-indigo-300 italic truncate">{abilityName}</div>
                        {rulesText && (
                          <div className="text-[10px] text-gray-400 leading-snug mt-1 line-clamp-3">{rulesText}</div>
                        )}
                      </div>
                    </>
                  )}
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // Option picker — quote the source card's ability/action text and split
    // the options by bulleted list (Lorcana's standard "Choose one:\n• A\n• B"
    // format), falling back to " or " split, falling back to "Option N".
    if (pendingChoice.type === "choose_option" && pendingChoice.options) {
      const srcId = (pendingChoice as any).sourceInstanceId;
      const srcInst = srcId ? gameState.cards[srcId] : undefined;
      const srcDef = srcInst ? definitions[srcInst.definitionId] : undefined;

      // "choose" can live in THREE places:
      //   1. srcDef.abilities[].effects — triggered/activated abilities (characters, items)
      //   2. srcDef.actionEffects — action cards (Pull the Lever!, Wrong Lever!, Trust In Me)
      //   3. srcDef.rulesText — always present as human-readable copy
      //
      // Only #1 carries a storyName; actions have none. The source's fullName
      // + rulesText is enough for the header on every shape.
      const chooseAbility = srcDef?.abilities.find((a: any) =>
        (a.type === "triggered" || a.type === "activated") &&
        a.effects?.some((e: any) => e.type === "choose")
      ) as { storyName?: string; rulesText?: string } | undefined;
      const abilityStoryName = chooseAbility?.storyName;
      // Prefer the ability-scoped rulesText when we found one — it's narrower
      // than the whole-card rulesText and avoids pulling in text from other
      // abilities on multi-ability cards. Action cards have no chooseAbility,
      // so we fall back to srcDef.rulesText which is their only text.
      const rulesText = chooseAbility?.rulesText ?? srcDef?.rulesText ?? "";

      // Extract per-option labels by trying text shapes in order:
      //   1. Bulleted list: "Choose one:\n• A\n• B" → split on lines starting with •
      //   2. " or " split: "Do X, or do Y" → comma-or and plain-or
      //   3. Fallback: generic "Option 1"/"Option 2"
      function extractOptionTexts(text: string, count: number): string[] {
        // Try bullet format. Lorcana uses • (U+2022) as its canonical bullet.
        const bulletLines = text
          .split(/\n/)
          .map(s => s.trim())
          .filter(s => s.startsWith("•"))
          .map(s => s.replace(/^•\s*/, "").trim());
        if (bulletLines.length === count) return bulletLines;
        // Try " or " split on everything after an optional "Choose one:" prefix.
        const afterChoose = text.replace(/^.*?choose one:?\s*/i, "").trim();
        const orParts = afterChoose.split(/\s*,?\s+or\s+/i);
        if (orParts.length === count) {
          return orParts.map(p => p.replace(/^(when you play this character, |choose and )/i, "").trim());
        }
        // Fallback
        return Array.from({ length: count }, (_, i) => `Option ${i + 1}`);
      }

      const optionTexts = extractOptionTexts(rulesText, pendingChoice.options.length);
      const headerLine = abilityStoryName
        ? `${abilityStoryName} — ${srcDef?.fullName ?? "Choose one"}`
        : (srcDef?.fullName ?? "Choose one");
      return (
        <div className="space-y-3">
          <div>
            <div className="text-yellow-300 text-sm font-bold">{headerLine}</div>
            <div className="text-gray-500 text-[10px] uppercase tracking-wider mt-0.5">Choose one</div>
          </div>
          {/* Full-width stacked buttons — each option can be long (see Wrong
              Lever's second branch). Numbered badge keeps orientation; option
              text is the primary content, left-aligned for readability. */}
          <div className="flex flex-col gap-1.5">
            {pendingChoice.options.map((_: any, i: number) => (
              <button
                key={i}
                className="flex items-start gap-2.5 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-700/80 text-gray-100 rounded-lg border border-gray-700 hover:border-indigo-500 text-left transition-colors"
                onClick={() => onResolveChoice(i)}
              >
                <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-700/80 text-white text-[10px] font-black flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span className="flex-1 text-xs leading-snug">{optionTexts[i]}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Single or multi-target (choose_target) / choose_from_revealed display
    const displayCards = pendingChoice.revealedCards ?? pendingChoice.validTargets ?? [];
    const validSet = new Set(pendingChoice.validTargets ?? []);
    const hasValidTargets = validSet.size > 0;
    // For choose_from_revealed backed by a look_at_top effect, the max number
    // of picks lives on pendingEffect.maxToHand (not pendingChoice.count).
    // For choose_target multi-pick, pendingChoice.count is used.
    const pendingEffect = (pendingChoice as any).pendingEffect;
    const maxToHand: number | undefined =
      pendingEffect?.type === "look_at_top" ? pendingEffect.maxToHand : undefined;
    const rawCap = maxToHand ?? (pendingChoice as any).count ?? 1;
    // Can't pick more than exist among valid targets (mandatory "put 2" with only
    // 1 valid match collapses to exactly 1).
    const targetCount = Math.max(1, Math.min(rawCap, Math.max(validSet.size, 1)));
    const isMultiTarget = targetCount > 1;
    // CRD 6.1.3 "up to N": engine accepts 1..N when non-optional with valid
    // targets, 0..N when optional. Confirm needs ≥1; the Skip button below
    // handles 0-submit on optional choices. Old UI forced exactly N for
    // non-optional, so Stopped Chaos (return up to 2) couldn't submit 1.

    // Split into "mine" and "opponent's" groups. When grouping is meaningful
    // (both sides represented), render them under labeled sections; otherwise
    // render as a flat grid. choose_from_revealed is always single-zone
    // (your deck) so skip grouping there.
    const isRevealedFlow = !!pendingChoice.revealedCards;
    const mineIds: string[] = [];
    const oppIds: string[] = [];
    for (const id of displayCards) {
      const inst = gameState.cards[id];
      if (!isRevealedFlow && inst?.ownerId === myId) mineIds.push(id);
      else if (!isRevealedFlow && inst) oppIds.push(id);
      else mineIds.push(id); // revealed flow: treat all as "yours"
    }
    const showGrouped = !isRevealedFlow && mineIds.length > 0 && oppIds.length > 0;

    const renderCard = (id: string) => {
      const selectable = validSet.has(id);
      const isSelected = isMultiTarget ? multiSelectTargets.includes(id) : multiSelectTargets[0] === id;
      const selection: SelectionState = !selectable
        ? { kind: "unselectable" }
        : isSelected
        ? { kind: "checked" }
        : { kind: "idle" };
      return (
        <CardThumb
          key={id}
          id={id}
          selection={selection}
          onClick={() => {
            if (!selectable) return;
            if (isMultiTarget) {
              onMultiSelectChange((prev) =>
                prev.includes(id) ? prev.filter((t) => t !== id) : prev.length < targetCount ? [...prev, id] : prev,
              );
            } else {
              onMultiSelectChange(isSelected ? [] : [id]);
            }
          }}
        />
      );
    };

    // Aggregate-sum caps (CardTarget.chosen totalXAtMost/AtLeast). Mirrors the
    // engine validator (validateResolveChoice) — same helpers, same arithmetic.
    // Leviathan IT'S A MACHINE: "banish any number of chosen opposing characters
    // with total {S} 10 or less" surfaces totalStrengthAtMost: 10 here.
    // The engine enforces server-side; this is UX so players don't submit a
    // doomed selection.
    //
    // Effective-stat call signature matches the engine validator (`95432e4`):
    // both the per-instance static bonus (from gameModifiers.statBonuses) AND
    // the full modifiers bundle are passed so static buffs like Lawrence -
    // Jealous Manservant's PAYBACK ("+4 {S} while no damage") count toward
    // the sum. Earlier the UI called `getEffectiveStrength(inst, def)` with
    // both optional params defaulting, silently dropping every static bonus —
    // a 4-S undamaged Lawrence summed as 0, the UI showed an under-cap total,
    // then the engine rejected the resolve at submit time.
    const pc = pendingChoice;
    const hasAggregateCap =
      pc.totalStrengthAtMost !== undefined || pc.totalStrengthAtLeast !== undefined ||
      pc.totalWillpowerAtMost !== undefined || pc.totalWillpowerAtLeast !== undefined ||
      pc.totalCostAtMost !== undefined || pc.totalCostAtLeast !== undefined ||
      pc.totalLoreAtMost !== undefined || pc.totalLoreAtLeast !== undefined ||
      pc.totalDamageAtMost !== undefined || pc.totalDamageAtLeast !== undefined;

    let sumStrength = 0, sumWillpower = 0, sumCost = 0, sumLore = 0, sumDamage = 0;
    if (hasAggregateCap) {
      // Compute modifiers once per render — full static-effect pass is cheap
      // but not free. React.useMemo is overkill here because the sum loop is
      // already gated on hasAggregateCap + runs only for open choice modals.
      const mods = getGameModifiers(gameState, definitions);
      for (const id of multiSelectTargets) {
        const inst = gameState.cards[id];
        if (!inst) continue;
        const def = definitions[inst.definitionId];
        if (!def) continue;
        const bonus = mods.statBonuses.get(id);
        sumStrength  += getEffectiveStrength (inst, def, bonus?.strength  ?? 0, mods);
        sumWillpower += getEffectiveWillpower(inst, def, bonus?.willpower ?? 0, mods);
        sumLore      += getEffectiveLore     (inst, def, bonus?.lore      ?? 0, mods);
        sumCost      += def.cost; // no modifier pipeline for cost — printed is effective
        sumDamage    += inst.damage;
      }
    }

    // Per-cap UX lines: "Selected {S}: 7 / 10". Red when violated.
    type CapLine = { label: string; current: number; limit: number; kind: "at_most" | "at_least"; ok: boolean };
    const capLines: CapLine[] = [];
    const pushCap = (label: string, current: number, atMost: number | undefined, atLeast: number | undefined) => {
      if (atMost !== undefined) {
        capLines.push({ label, current, limit: atMost, kind: "at_most", ok: current <= atMost });
      }
      if (atLeast !== undefined) {
        capLines.push({ label, current, limit: atLeast, kind: "at_least", ok: current >= atLeast });
      }
    };
    pushCap("Total {S}", sumStrength, pc.totalStrengthAtMost, pc.totalStrengthAtLeast);
    pushCap("Total {W}", sumWillpower, pc.totalWillpowerAtMost, pc.totalWillpowerAtLeast);
    pushCap("Total cost", sumCost, pc.totalCostAtMost, pc.totalCostAtLeast);
    pushCap("Total {L}", sumLore, pc.totalLoreAtMost, pc.totalLoreAtLeast);
    pushCap("Total damage", sumDamage, pc.totalDamageAtMost, pc.totalDamageAtLeast);

    // Any violation blocks Confirm (engine would reject anyway — this just
    // prevents the round-trip for UX cleanliness).
    const aggregateViolated = capLines.some((c) => !c.ok);

    return (
      <div className="space-y-3">
        <div>
          <div className="text-yellow-300 text-sm font-medium">{pendingChoice.prompt}</div>
          {isMultiTarget && (
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">
              Select up to {targetCount} ({multiSelectTargets.length}/{targetCount})
            </div>
          )}
          {contextHints.length > 0 && (
            <div className="text-[10px] text-gray-500 mt-0.5">{contextHints.join(" · ")}</div>
          )}
          {capLines.length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5">
              {capLines.map((c, i) => (
                <div
                  key={i}
                  className={`text-[11px] font-medium ${c.ok ? "text-emerald-300" : "text-red-400"}`}
                >
                  <span className="text-gray-400">Selected {c.label}:</span>{" "}
                  <span className="tabular-nums">{c.current}</span>
                  <span className="text-gray-500"> {c.kind === "at_most" ? "/" : "≥"} </span>
                  <span className="tabular-nums">{c.limit}</span>
                  {!c.ok && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider">
                      {c.kind === "at_most" ? "over cap" : "below floor"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {showGrouped ? (
          <div className="space-y-2">
            {mineIds.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-green-500 font-bold mb-1">Your characters</div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
                  {mineIds.map(renderCard)}
                </div>
              </div>
            )}
            {oppIds.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-red-500 font-bold mb-1">Opponent's characters</div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
                  {oppIds.map(renderCard)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pb-1">
            {displayCards.map(renderCard)}
          </div>
        )}
        <div className="flex gap-2 items-center">
          {hasValidTargets && (
            <button
              className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
              disabled={
                aggregateViolated
                  ? true
                  : isMultiTarget
                  // "up to N" — either mandatory (≥1 required) or optional:
                  // cap already enforced on selection; just need ≥1 for Confirm.
                  // Explicit 0-submit (skip) lives on a separate path when
                  // optional is true and no selection exists.
                  ? multiSelectTargets.length === 0
                  : !multiSelectTargets[0]
              }
              onClick={() => onResolveChoice(multiSelectTargets)}
            >
              {isMultiTarget ? `Confirm (${multiSelectTargets.length}/${targetCount})` : "Confirm"}
            </button>
          )}
          {pendingChoice.optional && (
            <button
              className="px-3 py-2 text-xs bg-red-800/80 hover:bg-red-700 text-gray-200 rounded-lg border border-red-700 transition-colors"
              onClick={() => onResolveChoice([])}
            >
              {hasValidTargets ? "Skip" : "OK"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop — clicking peeks at the board by hiding the modal */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-pointer"
        onClick={onHide}
        title="Click to peek at the board"
      />

      {/* Panel — bottom sheet on mobile, centered card on sm+.
          Widened to max-w-2xl on sm+ so all 7-col target-picker grids
          (mulligan + every choose_target / choose_order / reveal-style
          modal) fit without horizontal overflow. Step up to max-w-3xl at
          lg+ because GameCard's lg:w-[120px] size makes each scaled thumb
          94px wide (120 × 0.78) — at max-w-2xl the 7-col grid gives only
          85px per column, clipping the cards on desktop. */}
      <div className="relative z-10 w-full sm:max-w-2xl lg:max-w-3xl sm:mx-4
                      max-h-[82vh] overflow-y-auto
                      bg-gray-950 border border-gray-700
                      rounded-t-2xl sm:rounded-2xl
                      p-5 pb-[max(env(safe-area-inset-bottom,0px),20px)]
                      shadow-2xl">
        {/* Panel header row: A/B toggle + hide button */}
        <div className="flex items-center justify-between mb-3 gap-2">
          <div /> {/* spacer */}
          {/* A/B toggle: art vs structured text rendering. Only visible on surfaces
              that render card previews (choose_may + choose_trigger). */}
          {(pendingChoice.type === "choose_may" || pendingChoice.type === "choose_trigger") && (
            <div className="flex items-center text-[10px] rounded-full border border-gray-700 bg-gray-900 overflow-hidden">
              <button
                onClick={() => setDisplayMode("art")}
                className={`px-2 py-1 transition-colors ${displayMode === "art" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                Art
              </button>
              <button
                onClick={() => setDisplayMode("text")}
                className={`px-2 py-1 transition-colors ${displayMode === "text" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
              >
                Text
              </button>
            </div>
          )}
          <button
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-800/60 hover:bg-gray-700/60 rounded-full border border-gray-700 transition-colors"
            onClick={onHide}
            title="Hide modal to review the board"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.578-3.007-9.964-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Peek
          </button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}
