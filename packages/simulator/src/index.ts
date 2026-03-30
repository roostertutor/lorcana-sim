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
  MulliganThresholds,
  SimGameConfig,
  CardGameStats,
  GameResult,
  StoredGameResult,
  StoredResultSet,
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
export { RampCindyCowBot } from "./bots/RampCindyCowBot.js";

// Weight presets
export { AggroWeights, ControlWeights, MidrangeWeights, RushWeights } from "./bots/presets.js";

// Probability + position evaluation
export { computeDeckProbabilities } from "./probabilities.js";
export type { DeckProbabilities } from "./probabilities.js";
export { evaluatePosition } from "./evaluator.js";
export type { PositionFactors } from "./evaluator.js";

// Mulligan
export { shouldMulligan, performMulligan, DEFAULT_MULLIGAN } from "./mulligan.js";

// Result storage
export { saveResults, loadResults } from "./storage.js";

// Optimization
export { findOptimalWeights, sweepWeightSpace } from "./optimizer.js";

// RL
export {
  CARD_FEATURE_SIZE,
  STATE_FEATURE_SIZE,
  ACTION_FEATURE_SIZE,
  NETWORK_INPUT_SIZE,
  cardToFeatures,
  cardFeaturesToArray,
  stateToFeatures,
  actionToFeatures,
  collectAllEffects,
  collectAllKeywords,
  NeuralNetwork,
  relu,
  softmax,
  RLPolicy,
  trainPolicy,
  trainWithCurriculum,
} from "./rl/index.js";
export type {
  NetworkJSON,
  EpisodeStep,
  RLPolicyJSON,
  TrainingConfig,
  TrainingResult,
  RewardWeights,
  CardRewardContribution,
} from "./rl/index.js";
export {
  inferRewardWeights,
  cardRewardContribution,
  makeWeightedReward,
} from "./rl/index.js";
