// =============================================================================
// PROBABILITY BOT
// Deck-aware evaluator bot. For each legal action, applies it to a scratch
// state and picks the action that maximizes the position score.
// "Perfect information about your own deck" — not cheating, it's what
// skilled players do.
// =============================================================================

import type { CardDefinition, GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { applyAction, getAllLegalActions } from "@lorcana-sim/engine";
import { computeDeckProbabilities } from "../probabilities.js";
import { evaluatePosition } from "../evaluator.js";
import type { BotStrategy, BotWeights } from "../types.js";

function resolveChoiceRandom(state: GameState, playerId: PlayerID): GameAction {
  const choice = state.pendingChoice!;

  // CRD 6.1.4: "may" choices — always accept (same as greedy for now)
  if (choice.type === "choose_may") {
    return { type: "RESOLVE_CHOICE", playerId, choice: "accept" };
  }

  const targets = choice.validTargets ?? [];
  if (targets.length > 0) {
    const idx = Math.floor(Math.random() * targets.length);
    return { type: "RESOLVE_CHOICE", playerId, choice: [targets[idx]!] };
  }
  return { type: "RESOLVE_CHOICE", playerId, choice: [] };
}

/** Short fingerprint for bot naming. */
function weightFingerprint(weights: BotWeights): string {
  return [
    weights.loreAdvantage,
    weights.boardAdvantage,
    weights.handAdvantage,
    weights.inkAdvantage,
    weights.deckQuality,
  ]
    .map((v) => v.toFixed(1))
    .join("-");
}

export function ProbabilityBot(weights: BotWeights): BotStrategy {
  return {
    name: `probability-${weightFingerprint(weights)}`,
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

      const probs = computeDeckProbabilities(state, playerId, definitions);

      let bestAction = legal[0]!;
      let bestScore = -Infinity;

      for (const action of legal) {
        const result = applyAction(state, action, definitions);
        if (!result.success) continue;
        const { score } = evaluatePosition(result.newState, playerId, probs, weights);
        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
        }
      }

      return bestAction;
    },
  };
}
