// =============================================================================
// WEIGHT OPTIMIZER
// Grid/random search over BotWeights space using simulation infrastructure.
// No ML — brute force. Architecture is compatible with future ML:
// a neural net would implement the same BotWeights interface via gradient descent.
// =============================================================================

import type { BotWeights, OptimizationConfig, SweepConfig, WeightSweepResult } from "./types.js";
import { ProbabilityBot } from "./bots/ProbabilityBot.js";
import { runGame } from "./runGame.js";
import { MidrangeWeights } from "./bots/presets.js";

/** Generate a random BotWeights with all static values in [0, 1]. */
function randomWeights(): BotWeights {
  return {
    loreAdvantage: Math.random(),
    boardAdvantage: Math.random(),
    handAdvantage: Math.random(),
    inkAdvantage: Math.random(),
    deckQuality: Math.random(),
    urgency: (state) => {
      const maxLore = Math.max(state.players.player1.lore, state.players.player2.lore);
      return Math.pow(maxLore / 20, 2);
    },
    threatLevel: (state) => {
      const oppLore = Math.max(state.players.player1.lore, state.players.player2.lore);
      return Math.pow(oppLore / 20, 2);
    },
  };
}

/** Evaluate win rate of a weight vector against the given opponent. */
function evalWinRate(
  weights: BotWeights,
  config: OptimizationConfig
): number {
  const bot = ProbabilityBot(weights);
  let wins = 0;
  for (let g = 0; g < config.gamesPerEval; g++) {
    const result = runGame({
      player1Deck: config.deck,
      player2Deck: config.opponentDeck,
      player1Strategy: bot,
      player2Strategy: config.opponent,
      definitions: config.definitions,
    });
    if (result.winner === "player1") wins++;
  }
  return wins / config.gamesPerEval;
}

/**
 * Find optimal BotWeights via random search.
 * "grid" and "genetic" strategies deferred — random search is sufficient
 * for initial analytics and is the simplest to validate.
 */
export function findOptimalWeights(config: OptimizationConfig): BotWeights {
  let bestWeights: BotWeights = MidrangeWeights;
  let bestWinRate = evalWinRate(bestWeights, config);

  for (let i = 0; i < config.iterations; i++) {
    const candidate = randomWeights();
    const winRate = evalWinRate(candidate, config);
    if (winRate > bestWinRate) {
      bestWinRate = winRate;
      bestWeights = candidate;
    }
  }

  return bestWeights;
}

/**
 * Evaluate a list of weight vectors, returning win rates for each.
 * Useful for visualizing the weight space in the UI.
 */
export function sweepWeightSpace(config: SweepConfig): WeightSweepResult[] {
  return config.weightSamples.map((weights) => {
    const bot = ProbabilityBot(weights);
    let wins = 0;
    for (let g = 0; g < config.gamesPerSample; g++) {
      const result = runGame({
        player1Deck: config.deck,
        player2Deck: config.opponentDeck,
        player1Strategy: bot,
        player2Strategy: config.opponent,
        definitions: config.definitions,
      });
      if (result.winner === "player1") wins++;
    }
    return {
      weights,
      winRate: wins / config.gamesPerSample,
      gamesPlayed: config.gamesPerSample,
    };
  });
}
