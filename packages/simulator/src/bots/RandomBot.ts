// =============================================================================
// RANDOM BOT
// Picks a uniformly random legal action each turn.
// Used for stress testing and invariant checks — not analytics.
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { getAllLegalActions } from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";

function resolveChoiceRandom(state: GameState, playerId: PlayerID): GameAction {
  const choice = state.pendingChoice!;

  // CRD 2.2.2: Mulligan — keep all (random bot skips mulligan)
  if (choice.type === "choose_mulligan") {
    return { type: "RESOLVE_CHOICE", playerId, choice: [] };
  }

  // CRD 6.1.4: "may" choices — 50% accept, 50% decline
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: Math.random() < 0.5 ? "accept" : "decline" };
  }

  // choose_order: return all targets in a random order
  if (choice.type === "choose_order") {
    const shuffled = [...(choice.validTargets ?? [])].sort(() => Math.random() - 0.5);
    return { type: "RESOLVE_CHOICE", playerId, choice: shuffled };
  }

  const targets = choice.validTargets ?? [];
  if (targets.length > 0) {
    const idx = Math.floor(Math.random() * targets.length);
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[idx]!] };
  }
  return { type: "RESOLVE_CHOICE", playerId, choice: [] };
}

export const RandomBot: BotStrategy = {
  name: "random",
  type: "algorithm",
  decideAction(
    state: GameState,
    playerId: PlayerID,
    definitions: Record<string, CardDefinition>
  ): GameAction {
    if (state.pendingChoice && state.pendingChoice.choosingPlayerId === playerId) {
      return resolveChoiceRandom(state, playerId);
    }

    const legal = getAllLegalActions(state, playerId, definitions);
    if (legal.length === 0) return { type: "PASS_TURN", playerId };

    const idx = Math.floor(Math.random() * legal.length);
    return legal[idx]!;
  },
};
