// =============================================================================
// RL TRAINER — Training loop (Actor-Critic with GAE)
// Runs episodes, computes rewards, updates policy.
// =============================================================================

import type { CardDefinition, PlayerID } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { createRng, cloneRng, rngNextInt } from "@lorcana-sim/engine";
import { runGame } from "../runGame.js";
import type { BotStrategy, GameResult } from "../types.js";
import { RLPolicy } from "./policy.js";
import { makeWeightedReward } from "./rewardWeights.js";
import type { RewardWeights } from "./rewardWeights.js";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface TrainingConfig {
  deck: DeckEntry[];
  opponentDeck: DeckEntry[];
  definitions: Record<string, CardDefinition>;
  opponent: BotStrategy;
  episodes: number;
  learningRate?: number;
  gamma?: number;
  epsilon?: number;
  minEpsilon?: number;
  decayRate?: number;
  maxTurns?: number;
  logInterval?: number;
  seed?: number;
  warmStart?: RLPolicy;
  /** Custom reward function. Default: win=1, loss=0, draw=0.5 */
  reward?: (result: GameResult) => number;
  /**
   * Reward weights inferred from deck composition via inferRewardWeights().
   * Supercedes `reward` if provided. Encodes deck archetype as a continuous vector.
   */
  rewardWeights?: RewardWeights;
  /** Callback for progress logging */
  onLog?: (episode: number, reward: number, epsilon: number, avgReward: number) => void;
  /**
   * "Practice games" opponent — run this many extra games per episode against a
   * simpler opponent and update the policy with reduced gradient weight.
   * Prevents catastrophic forgetting when fine-tuning against harder opponents:
   * the policy keeps its fundamentals while layering on new skills.
   */
  practiceOpponent?: BotStrategy;
  /** Practice games per training episode (default 2) */
  practiceGamesPerEpisode?: number;
  /** Gradient weight for practice updates relative to main training (default 0.5) */
  practiceWeight?: number;
}

export interface TrainingResult {
  policy: RLPolicy;
  rewardCurve: number[];
  totalEpisodes: number;
  finalEpsilon: number;
}

// -----------------------------------------------------------------------------
// TRAINING
// -----------------------------------------------------------------------------

/** Per-turn intermediate rewards derived from lore-gain deltas.
 *  Indexed by turnIndex. Small scale keeps shaping subordinate to terminal reward.
 *  Used as the perStepRewards argument to updateFromEpisode (A2C/GAE). */
function computePerStepRewards(result: GameResult, scale = 0.05): number[] {
  const loreByTurn = result.loreByTurn["player1"] ?? [];
  return loreByTurn.map((lore, t) => {
    const prev = t === 0 ? 0 : (loreByTurn[t - 1] ?? 0);
    return ((lore - prev) / 20) * scale;
  });
}

/** Default reward: win=1, loss=0, draw=0.5 */
function defaultReward(result: GameResult): number {
  if (result.winner === "player1") return 1;
  if (result.winner === "draw") return 0.5;
  return 0;
}

/**
 * Train an RL policy using Actor-Critic with GAE.
 * Player 1 is always the RL policy being trained.
 */
export function trainPolicy(config: TrainingConfig): TrainingResult {
  const {
    deck,
    opponentDeck,
    definitions,
    opponent,
    episodes,
    learningRate = 0.001,
    gamma = 0.99,
    minEpsilon = 0.05,
    decayRate = 0.9995,
    maxTurns = 30,
    logInterval = 1000,
    seed,
    warmStart,
    onLog,
    practiceOpponent,
    practiceGamesPerEpisode = 2,
    practiceWeight = 0.5,
  } = config;
  const reward = config.rewardWeights
    ? makeWeightedReward(config.rewardWeights)
    : config.reward ?? defaultReward;

  const trainingSeed = seed ?? Date.now();
  const trainingRng = createRng(trainingSeed);
  const explorationRng = cloneRng(trainingRng);
  const networkRng = cloneRng(trainingRng);

  const policy = warmStart ?? new RLPolicy(
    "rl-training",
    explorationRng,
    networkRng,
    config.epsilon ?? 1.0
  );

  const rewardCurve: number[] = [];
  let recentRewards: number[] = [];

  for (let episode = 0; episode < episodes; episode++) {
    const gameSeed = rngNextInt(trainingRng, 0x7FFFFFFF);

    // Clear any leftover history
    policy.clearHistory();

    const result = runGame({
      player1Deck: deck,
      player2Deck: opponentDeck,
      player1Strategy: policy,
      player2Strategy: opponent,
      definitions,
      maxTurns,
      seed: gameSeed,
    });

    // If opponent is an RLPolicy used as a fixed target, clear its accumulated history
    // to prevent unbounded memory growth over thousands of episodes.
    if (typeof (opponent as any).clearHistory === "function") {
      (opponent as any).clearHistory();
    }

    const G = reward(result);
    rewardCurve.push(G);
    recentRewards.push(G);

    // Update policy from this episode (A2C + GAE)
    const perStepRewards = computePerStepRewards(result);
    policy.updateFromEpisode(G, learningRate, gamma, perStepRewards);

    // Practice games — replay fundamentals against a simpler opponent to prevent
    // catastrophic forgetting when fine-tuning against harder opponents.
    if (practiceOpponent) {
      for (let p = 0; p < practiceGamesPerEpisode; p++) {
        const practiceSeed = rngNextInt(trainingRng, 0x7FFFFFFF);
        policy.clearHistory();
        const practiceResult = runGame({
          player1Deck: deck,
          player2Deck: opponentDeck,
          player1Strategy: policy,
          player2Strategy: practiceOpponent,
          definitions,
          maxTurns,
          seed: practiceSeed,
        });
        if (typeof (practiceOpponent as any).clearHistory === "function") {
          (practiceOpponent as any).clearHistory();
        }
        const practiceG = reward(practiceResult);
        const practicePerStep = computePerStepRewards(practiceResult);
        policy.updateFromEpisode(practiceG, learningRate * practiceWeight, gamma, practicePerStep);
      }
    }

    policy.decayEpsilon(minEpsilon, decayRate);

    // Log progress
    if (onLog && (episode + 1) % logInterval === 0) {
      const avgReward = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
      onLog(episode + 1, G, policy.epsilon, avgReward);
      recentRewards = [];
    }
  }

  policy.clearHistory();

  return {
    policy,
    rewardCurve,
    totalEpisodes: episodes,
    finalEpsilon: policy.epsilon,
  };
}

