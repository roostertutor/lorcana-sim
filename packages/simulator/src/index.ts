// =============================================================================
// SIMULATOR PUBLIC API
// Everything analytics (or tests) needs, exported from one place.
// Imports from engine only — never from analytics or ui.
// =============================================================================

// Types
export type {
  BotType,
  BotStrategy,
  BotWeights,
  SimGameConfig,
  CardGameStats,
  GameResult,
  SimConfig,
  WeightSweepResult,
  OptimizationConfig,
  SweepConfig,
  OverrideRule,
  PersonalBotConfig,
} from "./types.js";

// Simulation runners
export { runGame } from "./runGame.js";
export { runSimulation } from "./runSimulation.js";

// Bots
export { RandomBot } from "./bots/RandomBot.js";
export { GreedyBot } from "./bots/GreedyBot.js";
export { ProbabilityBot } from "./bots/ProbabilityBot.js";
export { createPersonalBot } from "./bots/PersonalBot.js";

// Weight presets
export { AggroWeights, ControlWeights, MidrangeWeights, RushWeights } from "./bots/presets.js";

// Probability + position evaluation
export { computeDeckProbabilities } from "./probabilities.js";
export type { DeckProbabilities } from "./probabilities.js";
export { evaluatePosition } from "./evaluator.js";
export type { PositionFactors } from "./evaluator.js";

// Optimization
export { findOptimalWeights, sweepWeightSpace } from "./optimizer.js";
