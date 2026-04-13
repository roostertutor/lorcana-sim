// =============================================================================
// formatAction — converts GameAction → human-readable label
// Shared between Sandbox and GameBoard.
// =============================================================================

import type { CardDefinition, GameAction, GameState } from "@lorcana-sim/engine";

export function formatAction(
  action: GameAction,
  gameState: GameState,
  definitions: Record<string, CardDefinition>,
): string {
  const getCardName = (instanceId: string): string => {
    const instance = gameState.cards[instanceId];
    if (!instance) return "Unknown";
    const def = definitions[instance.definitionId];
    return def?.fullName ?? instance.definitionId;
  };

  switch (action.type) {
    case "PLAY_CARD": {
      const name = getCardName(action.instanceId);
      const instance = gameState.cards[action.instanceId];
      const def = instance ? definitions[instance.definitionId] : null;
      const cost = action.shiftTargetInstanceId
        ? (def?.shiftCost ?? def?.cost ?? "?")
        : (def?.cost ?? "?");

      if (action.shiftTargetInstanceId) {
        return `Shift ${name} onto ${getCardName(action.shiftTargetInstanceId)} (${cost} ink)`;
      }
      if (action.singerInstanceId) {
        return `Sing ${name} with ${getCardName(action.singerInstanceId)}`;
      }
      return `Play ${name} (${cost} ink)`;
    }
    case "PLAY_INK":
      return `Ink ${getCardName(action.instanceId)}`;
    case "QUEST": {
      const instance = gameState.cards[action.instanceId];
      const def = instance ? definitions[instance.definitionId] : null;
      const lore = def?.lore ?? "?";
      return `Quest with ${getCardName(action.instanceId)} (+${lore} lore)`;
    }
    case "CHALLENGE":
      return `Challenge ${getCardName(action.defenderInstanceId)} with ${getCardName(action.attackerInstanceId)}`;
    case "ACTIVATE_ABILITY":
      return `Use ${getCardName(action.instanceId)} ability`;
    case "PASS_TURN":
      return "Pass Turn";
    default:
      return action.type;
  }
}
