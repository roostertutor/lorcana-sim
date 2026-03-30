// =============================================================================
// RL MODULE — Barrel exports
// =============================================================================

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
} from "./autoTag.js";

export { NeuralNetwork, relu, softmax } from "./network.js";
export type { NetworkJSON } from "./network.js";

export { RLPolicy } from "./policy.js";
export type { EpisodeStep, RLPolicyJSON } from "./policy.js";

export { trainPolicy } from "./trainer.js";
export type { TrainingConfig, TrainingResult } from "./trainer.js";

export { inferRewardWeights, cardRewardContribution, makeWeightedReward } from "./rewardWeights.js";
export type { RewardWeights, CardRewardContribution } from "./rewardWeights.js";
