// =============================================================================
// POSITION EVALUATOR
// Scores a game state from one player's perspective using weighted factors.
// Used by ProbabilityBot to rank candidate actions.
// =============================================================================

import type { GameState, PlayerID } from "@lorcana-sim/engine";
import { getZone } from "@lorcana-sim/engine";
import type { BotWeights } from "./types.js";
import type { DeckProbabilities } from "./probabilities.js";

export interface PositionFactors {
  /** Lore delta normalized to [-1, 1] */
  loreAdvantage: number;
  /** Board presence delta, normalized via tanh */
  boardAdvantage: number;
  /** Hand size delta, normalized via tanh */
  handAdvantage: number;
  /** Available ink delta, normalized via tanh */
  inkAdvantage: number;
  /** Expected value of remaining deck draws, [0, 1] */
  deckQuality: number;
  /** Opponent's proximity to winning, [0, 1] */
  threatLevel: number;
  /** How close either player is to winning, [0, 1] */
  urgency: number;
}

const LORE_THRESHOLD = 20; // evaluator never calls getLoreThreshold — just for scoring math

export function evaluatePosition(
  state: GameState,
  playerId: PlayerID,
  probabilities: DeckProbabilities,
  weights: BotWeights
): { score: number; factors: PositionFactors } {
  const opponentId: PlayerID = playerId === "player1" ? "player2" : "player1";
  const myPlayer = state.players[playerId];
  const oppPlayer = state.players[opponentId];

  // Lore advantage: delta normalized to [-1, 1]
  const loreAdv = (myPlayer.lore - oppPlayer.lore) / LORE_THRESHOLD;

  // Board advantage: characters in play, exerted chars count half
  const myPlay = getZone(state, playerId, "play");
  const oppPlay = getZone(state, opponentId, "play");

  let myBoardScore = 0;
  for (const id of myPlay) {
    const inst = state.cards[id];
    if (!inst) continue;
    myBoardScore += inst.isExerted ? 0.5 : 1.0;
  }

  let oppBoardScore = 0;
  for (const id of oppPlay) {
    const inst = state.cards[id];
    if (!inst) continue;
    oppBoardScore += inst.isExerted ? 0.5 : 1.0;
  }

  const boardAdv = Math.tanh((myBoardScore - oppBoardScore) / 3);

  // Hand advantage
  const myHandSize = getZone(state, playerId, "hand").length;
  const oppHandSize = getZone(state, opponentId, "hand").length;
  const handAdv = Math.tanh((myHandSize - oppHandSize) / 4);

  // Ink advantage
  const inkAdv = Math.tanh((myPlayer.availableInk - oppPlayer.availableInk) / 5);

  // Deck quality: avg cost remaining normalized (higher avg cost = more powerful late-game draws)
  const avgCost = probabilities.avgCostRemaining();
  const deckQualityScore = Math.min(avgCost / 7, 1);

  // Urgency: how close either player is to the threshold (exponential ramp)
  const maxLore = Math.max(myPlayer.lore, oppPlayer.lore);
  const urgencyScore = Math.pow(maxLore / LORE_THRESHOLD, 2);

  // Threat: opponent's proximity to winning
  const threatScore = Math.pow(oppPlayer.lore / LORE_THRESHOLD, 2);

  const factors: PositionFactors = {
    loreAdvantage: loreAdv,
    boardAdvantage: boardAdv,
    handAdvantage: handAdv,
    inkAdvantage: inkAdv,
    deckQuality: deckQualityScore,
    threatLevel: threatScore,
    urgency: urgencyScore,
  };

  const score =
    factors.loreAdvantage * weights.loreAdvantage +
    factors.boardAdvantage * weights.boardAdvantage +
    factors.handAdvantage * weights.handAdvantage +
    factors.inkAdvantage * weights.inkAdvantage +
    factors.deckQuality * weights.deckQuality +
    factors.urgency * weights.urgency(state) +
    factors.threatLevel * weights.threatLevel(state);

  return { score, factors };
}
