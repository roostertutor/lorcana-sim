// =============================================================================
// RANDOM BOT
// Picks a uniformly random legal action each turn.
// Used for stress testing and invariant checks — not analytics.
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { getAllLegalActions } from "@lorcana-sim/engine";
import type { BotStrategy } from "../types.js";
import { getMultiPickRange } from "./multiPick.js";

function resolveChoiceRandom(state: GameState, playerId: PlayerID): GameAction {
  const choice = state.pendingChoice!;

  // CRD 2.1.3.2 / 2.2.1: play-draw — always go first. Going first is +EV in
  // virtually every matchup in Lorcana; not worth randomizing.
  if (choice.type === "choose_play_order") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "first" };
  }

  // CRD 2.2.2: Mulligan — keep all (random bot skips mulligan)
  if (choice.type === "choose_mulligan") {
    return { type: "RESOLVE_CHOICE", playerId, choice: [] };
  }

  // CRD 7.7.4: trigger ordering — pick a random trigger to resolve first
  if (choice.type === "choose_trigger") {
    const targets = choice.validTargets ?? [];
    const pick = targets[Math.floor(Math.random() * targets.length)] ?? "0";
    return { type: "RESOLVE_CHOICE", playerId, choice: pick };
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

  // choose_players_subset (Beyond the Horizon): random subset of selectable
  // players. Each player is independently included with 50% probability.
  if (choice.type === "choose_players_subset") {
    const all = choice.selectablePlayerIds ?? [];
    const subset = all.filter(() => Math.random() < 0.5);
    return { type: "RESOLVE_CHOICE", playerId, choice: subset };
  }

  const targets = choice.validTargets ?? [];
  if (targets.length > 0) {
    // Multi-pick (Dig a Little Deeper, Look at This Family): the engine
    // expects min(maxToHand, validTargets) IDs back. Pick a random size in
    // the legal range, then a random subset of that size — single-pick would
    // underfill mandatory effects.
    const { minSize, maxSize } = choice.type === "choose_from_revealed"
      ? getMultiPickRange(choice)
      : { minSize: 1, maxSize: 1 };
    const size = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
    if (size === 0) return { type: "RESOLVE_CHOICE", playerId, choice: [] };
    if (size === 1) {
      const idx = Math.floor(Math.random() * targets.length);
      return { type: "RESOLVE_CHOICE", playerId, choice: [targets[idx]!] };
    }
    // Reservoir-style random subset of size N from `targets`.
    const pool = [...targets];
    const picked: string[] = [];
    for (let i = 0; i < size && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool[idx]!);
      pool.splice(idx, 1);
    }
    return { type: "RESOLVE_CHOICE", playerId, choice: picked };
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
