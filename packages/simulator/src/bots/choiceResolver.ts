// =============================================================================
// SMART CHOICE RESOLVER
// Replaces random choice resolution in GreedyBot.
// Uses position evaluation to pick the best target for pending choices.
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { applyAction } from "@lorcana-sim/engine";
import { computeDeckProbabilities } from "../probabilities.js";
import { evaluatePosition } from "../evaluator.js";
import type { BotWeights } from "../types.js";
import { shouldMulligan } from "../mulligan.js";

/**
 * Resolve a pending choice intelligently using position evaluation.
 *
 * - choose_may: always accept (all Set 1 "may" effects are free benefits)
 * - choose_discard: discard cheapest cards from validTargets
 * - choose_target / others: try each valid target, pick the one that
 *   maximizes position score. For optional targets, also evaluate "skip".
 */
export function resolveChoiceIntelligently(
  state: GameState,
  playerId: PlayerID,
  definitions: Record<string, CardDefinition>,
  weights: BotWeights
): GameAction {
  const choice = state.pendingChoice!;

  // CRD 2.2.2: Mulligan — heuristic partial mulligan
  if (choice.type === "choose_mulligan") {
    const hand = choice.validTargets ?? [];
    const doMulligan = shouldMulligan(state, playerId, definitions);
    if (!doMulligan) {
      // Keep all — return empty array
      return { type: "RESOLVE_CHOICE", playerId, choice: [] };
    }
    // Return all non-inkable cards first, then lowest-cost inkable cards
    // to keep the highest-value inkable cards in hand
    const scored = hand.map(id => {
      const inst = state.cards[id];
      const def = inst ? definitions[inst.definitionId] : undefined;
      return { id, cost: def?.cost ?? 0, inkable: def?.inkable ?? false };
    });
    // Sort: put back non-inkable first, then lowest cost — keep at most 3 (keep 4+)
    scored.sort((a, b) => {
      if (a.inkable !== b.inkable) return a.inkable ? 1 : -1; // non-inkable first
      return a.cost - b.cost; // then lowest cost first
    });
    // Return bottom half of the hand (worst cards)
    const returnCount = Math.floor(hand.length / 2);
    return { type: "RESOLVE_CHOICE", playerId, choice: scored.slice(0, returnCount).map(s => s.id) };
  }

  // CRD 6.1.4: "may" choices — always accept (free benefit in Set 1)
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "accept" };
  }

  // choose_order: bot uses the original order (validTargets as-is)
  if (choice.type === "choose_order") {
    return { type: "RESOLVE_CHOICE", playerId, choice: choice.validTargets ?? [] };
  }

  // choose_discard: sort validTargets by card cost ascending, discard cheapest N
  if (choice.type === "choose_discard") {
    const targets = choice.validTargets ?? [];
    const count = choice.count ?? 1;

    const sorted = [...targets].sort((a, b) => {
      const instA = state.cards[a];
      const instB = state.cards[b];
      if (!instA || !instB) return 0;
      const defA = definitions[instA.definitionId];
      const defB = definitions[instB.definitionId];
      return (defA?.cost ?? 0) - (defB?.cost ?? 0);
    });

    return {
      type: "RESOLVE_CHOICE",
      playerId,
      choice: sorted.slice(0, count),
    };
  }

  // For all other choice types: evaluate each valid target option
  const targets = choice.validTargets ?? [];

  if (targets.length === 0) {
    if (!choice.optional) {
      console.warn("[choiceResolver] required choice has no valid targets — returning empty");
    }
    return { type: "RESOLVE_CHOICE", playerId, choice: [] };
  }

  const probs = computeDeckProbabilities(state, playerId, definitions);
  let bestAction: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [targets[0]!] };
  let bestScore = -Infinity;

  // Evaluate each single-target option
  for (const target of targets) {
    const action: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [target] };
    const result = applyAction(state, action, definitions);
    if (!result.success) continue;
    const { score } = evaluatePosition(result.newState, playerId, probs, weights);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  // For optional targets, also evaluate skipping (empty array)
  if (choice.optional) {
    const skipAction: GameAction = { type: "RESOLVE_CHOICE", playerId, choice: [] };
    const skipResult = applyAction(state, skipAction, definitions);
    if (skipResult.success) {
      const { score } = evaluatePosition(skipResult.newState, playerId, probs, weights);
      if (score >= bestScore) {
        bestAction = skipAction;
      }
    }
  }

  return bestAction;
}
