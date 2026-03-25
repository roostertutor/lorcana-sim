// =============================================================================
// BOT WEIGHT PRESETS
// Named BotWeights configurations — not separate classes, just weight vectors.
// Same ProbabilityBot algorithm, different priorities.
// =============================================================================

import type { GameState } from "@lorcana-sim/engine";
import type { BotWeights } from "../types.js";

const loreRamp = (state: GameState): number => {
  const maxLore = Math.max(state.players.player1.lore, state.players.player2.lore);
  return Math.pow(maxLore / 20, 2);
};

/** Races to 20 lore as fast as possible. Ignores board and card advantage. */
export const AggroWeights: BotWeights = {
  loreAdvantage: 0.9,
  boardAdvantage: 0.3,
  handAdvantage: 0.1,
  inkAdvantage: 0.3,
  deckQuality: 0.1,
  urgency: (_state: GameState) => 0.8,
  threatLevel: (_state: GameState) => 0.2,
};

/** Prioritizes board control and card advantage. Races harder as lore climbs. */
export const ControlWeights: BotWeights = {
  loreAdvantage: 0.3,
  boardAdvantage: 0.9,
  handAdvantage: 0.8,
  inkAdvantage: 0.6,
  deckQuality: 0.7,
  urgency: loreRamp,
  threatLevel: (_state: GameState) => 0.9,
};

/** Balanced. Values lore and board equally. */
export const MidrangeWeights: BotWeights = {
  loreAdvantage: 0.6,
  boardAdvantage: 0.6,
  handAdvantage: 0.5,
  inkAdvantage: 0.5,
  deckQuality: 0.4,
  urgency: loreRamp,
  threatLevel: (_state: GameState) => 0.5,
};

/** Tries to end the game quickly with cheap characters and early questing. */
export const RushWeights: BotWeights = {
  loreAdvantage: 0.8,
  boardAdvantage: 0.4,
  handAdvantage: 0.2,
  inkAdvantage: 0.5,
  deckQuality: 0.2,
  urgency: (_state: GameState) => 0.9,
  threatLevel: (_state: GameState) => 0.1,
};
