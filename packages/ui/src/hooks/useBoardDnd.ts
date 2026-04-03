import { useState } from "react";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import type { PlayerID, GameState, GameAction } from "@lorcana-sim/engine";

export const DROP_PLAY_ZONE = "drop:playzone";
export const DROP_INKWELL  = "drop:inkwell";
export const dropCardId = (instanceId: string) => `drop:card:${instanceId}`;

export function useBoardDnd(params: {
  myId: PlayerID;
  gameState: GameState | null;
  legalActions: GameAction[];
  dispatch: (action: GameAction) => void;
  isEnabled: boolean;
}) {
  const { myId, gameState, legalActions, dispatch, isEnabled } = params;
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
      const action = legalActions.find(
        (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && !a.shiftTargetInstanceId,
      );
      if (action) dispatch(action);
      return;
    }

    if (overId === DROP_INKWELL) {
      const action = legalActions.find(
        (a) => a.type === "PLAY_INK" && a.instanceId === draggingId,
      );
      if (action) dispatch(action);
      return;
    }

    if (overId.startsWith("drop:card:")) {
      const targetId = overId.slice("drop:card:".length);

      // Shift: drag from hand onto own play zone character
      const shiftAction = legalActions.find(
        (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && a.shiftTargetInstanceId === targetId,
      );
      if (shiftAction) { dispatch(shiftAction); return; }

      // Challenge: drag own ready character onto exerted opponent character
      const challengeAction = legalActions.find(
        (a) => a.type === "CHALLENGE" && a.attackerInstanceId === draggingId && a.defenderInstanceId === targetId,
      );
      if (challengeAction) { dispatch(challengeAction); return; }
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setActiveZone(null);
  }

  function isValidPlayZoneDrop(draggingId: string): boolean {
    return legalActions.some(
      (a) => a.type === "PLAY_CARD" && a.instanceId === draggingId && !a.shiftTargetInstanceId,
    );
  }

  function isValidInkwellDrop(draggingId: string): boolean {
    return legalActions.some((a) => a.type === "PLAY_INK" && a.instanceId === draggingId);
  }

  function isValidCardDrop(draggingId: string, targetId: string): boolean {
    return legalActions.some(
      (a) =>
        (a.type === "PLAY_CARD" && a.instanceId === draggingId && a.shiftTargetInstanceId === targetId) ||
        (a.type === "CHALLENGE" && a.attackerInstanceId === draggingId && a.defenderInstanceId === targetId),
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
    isValidCardDrop,
  };
}
