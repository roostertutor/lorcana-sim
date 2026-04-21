import { useState } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import type { PlayerID, GameState, GameAction } from "@lorcana-sim/engine";

export const DROP_PLAY_ZONE = "drop:playzone";
export const DROP_INKWELL  = "drop:inkwell";
export const DROP_QUEST    = "drop:quest";
export const dropCardId = (instanceId: string) => `drop:card:${instanceId}`;

export function useBoardDnd(params: {
  myId: PlayerID;
  gameState: GameState | null;
  legalActions: GameAction[];
  dispatch: (action: GameAction) => void;
  isEnabled: boolean;
  /**
   * Called when a card is dragged into the play zone but has MULTIPLE legal
   * play variants (e.g. Belle - Apprentice Inventor with both 3-ink play
   * and viaGrantedFreePlay banish-item available). Stance B: never silently
   * commit — surface the existing card popover so the user picks the path.
   * Caller is expected to open the popover anchored at `rect`.
   *
   * Rect is dnd-kit's `ClientRect` (structurally compatible with DOMRect
   * for positioning; lacks the `x`/`y` aliases and `toJSON`, which we
   * don't use).
   */
  onAmbiguousPlay?: (instanceId: string, rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }) => void;
}) {
  const { myId, gameState, legalActions, dispatch, isEnabled, onAmbiguousPlay } = params;
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<"hand" | "play" | null>(null);

  function handleDragStart(event: DragStartEvent) {
    if (!isEnabled) return;
    setActiveId(event.active.id as string);
    setActiveZone((event.active.data.current as { zone?: "hand" | "play" })?.zone ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setActiveZone(null);
    if (!over || !gameState || !isEnabled) return;

    const draggingId = active.id as string;
    const overId = over.id as string;

    if (overId === DROP_PLAY_ZONE) {
      // Collect every "simple" play path for this card (excludes shift/sing/
      // singer-group, which drop onto other cards not the play zone).
      const playActions = legalActions.filter(
        (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && !a.shiftTargetInstanceId && !a.singerInstanceId && !a.singerInstanceIds,
      );
      if (playActions.length === 0) return;
      if (playActions.length === 1) { dispatch(playActions[0]!); return; }
      // Multiple legal variants (e.g. Belle: normal 3-ink play AND
      // viaGrantedFreePlay banish-item). Stance B — surface the existing
      // card popover instead of silently picking the first match. Caller
      // anchors the popover at the drag-initial rect (the card's home
      // position in hand, since dnd-kit visually translates via DragOverlay
      // while the source element stays put).
      if (onAmbiguousPlay) {
        const initial = active.rect.current.initial;
        if (initial) {
          onAmbiguousPlay(draggingId, initial);
          return;
        }
      }
      // Fallback: old behavior if no handler wired (preserves a single path).
      dispatch(playActions[0]!);
      return;
    }

    if (overId === DROP_INKWELL) {
      const action = legalActions.find(
        (a) => a.type === "PLAY_INK" && a.instanceId === draggingId,
      );
      if (action) dispatch(action);
      return;
    }

    if (overId === DROP_QUEST) {
      const action = legalActions.find(
        (a) => a.type === "QUEST" && a.instanceId === draggingId,
      );
      if (action) dispatch(action);
      return;
    }

    if (overId.startsWith("drop:card:")) {
      const targetId = overId.slice("drop:card:".length);

      // Shift: drag from hand onto own play zone character. Alt-cost shifts
      // (Diablo, Flotsam) dispatch the same way — the engine surfaces a
      // pendingChoice to collect cost targets after the action fires.
      const shiftAction = legalActions.find(
        (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && a.shiftTargetInstanceId === targetId,
      );
      if (shiftAction) { dispatch(shiftAction); return; }

      // Sing: drag song from hand onto own ready character that can sing it
      const singAction = legalActions.find(
        (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && a.singerInstanceId === targetId,
      );
      if (singAction) { dispatch(singAction); return; }

      // Challenge: drag own ready character onto exerted opponent character
      const challengeAction = legalActions.find(
        (a) => a.type === "CHALLENGE" && a.attackerInstanceId === draggingId && a.defenderInstanceId === targetId,
      );
      if (challengeAction) { dispatch(challengeAction); return; }

      // Move: drag own ready character onto own location (CRD 4.7)
      const moveAction = legalActions.find(
        (a) => a.type === "MOVE_CHARACTER" && a.characterInstanceId === draggingId && a.locationInstanceId === targetId,
      );
      if (moveAction) { dispatch(moveAction); return; }
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setActiveZone(null);
  }

  function isValidPlayZoneDrop(draggingId: string): boolean {
    return legalActions.some(
      (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && !a.shiftTargetInstanceId && !a.singerInstanceId && !a.singerInstanceIds,
    );
  }

  function isValidInkwellDrop(draggingId: string): boolean {
    return legalActions.some((a) => a.type === "PLAY_INK" && a.instanceId === draggingId);
  }

  function isValidQuestDrop(draggingId: string): boolean {
    return legalActions.some((a) => a.type === "QUEST" && a.instanceId === draggingId);
  }

  function isValidCardDrop(draggingId: string, targetId: string): boolean {
    return legalActions.some(
      (a) =>
        (a.type === "PLAY_CARD" && a.instanceId === draggingId && a.shiftTargetInstanceId === targetId) ||
        (a.type === "PLAY_CARD" && a.instanceId === draggingId && a.singerInstanceId === targetId) ||
        (a.type === "CHALLENGE" && a.attackerInstanceId === draggingId && a.defenderInstanceId === targetId) ||
        (a.type === "MOVE_CHARACTER" && a.characterInstanceId === draggingId && a.locationInstanceId === targetId),
    );
  }

  return {
    activeId,
    activeZone,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    isValidPlayZoneDrop,
    isValidInkwellDrop,
    isValidQuestDrop,
    isValidCardDrop,
  };
}
