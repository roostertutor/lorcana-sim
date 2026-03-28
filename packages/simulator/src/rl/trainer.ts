// =============================================================================
// RL TRAINER — Training loop with curriculum support
// Runs episodes, computes rewards, updates policy.
// =============================================================================

import type { CardDefinition, PlayerID } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { createRng, cloneRng, rngNextInt } from "@lorcana-sim/engine";
import { runGame } from "../runGame.js";
import { RandomBot } from "../bots/RandomBot.js";
import type { BotStrategy, GameResult } from "../types.js";
import { RLPolicy } from "./policy.js";

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
  /** Callback for progress logging */
  onLog?: (episode: number, reward: number, epsilon: number, avgReward: number) => void;
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

/** Default reward: win=1, loss=0, draw=0.5 */
function defaultReward(result: GameResult): number {
  if (result.winner === "player1") return 1;
  if (result.winner === "draw") return 0.5;
  return 0;
}

/** Goldfish reward: normalized lore (how much lore player1 earned) */
function goldfishReward(result: GameResult): number {
  return Math.min((result.finalLore["player1"] ?? 0) / 20, 1);
}

/**
 * Train an RL policy using REINFORCE.
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
  } = config;
  const reward = config.reward ?? defaultReward;

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

    const G = reward(result);
    rewardCurve.push(G);
    recentRewards.push(G);

    // Update policy from this episode
    policy.updateFromEpisode(G, learningRate, gamma);
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

/**
 * Train with curriculum: goldfish first, then real opponent.
 */
export function trainWithCurriculum(
  deck: DeckEntry[],
  opponentDeck: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  options: {
    goldfishEpisodes?: number;
    realEpisodes?: number;
    seed?: number;
    maxTurns?: number;
    learningRate?: number;
    onLog?: TrainingConfig["onLog"];
  } = {}
): TrainingResult {
  const {
    goldfishEpisodes = 25000,
    realEpisodes = 25000,
    seed,
    maxTurns = 30,
    learningRate = 0.001,
    onLog,
  } = options;

  // Phase 1: goldfish training (vs RandomBot, lore reward)
  if (onLog) onLog(0, 0, 1, 0);
  const phase1 = trainPolicy({
    deck,
    opponentDeck: deck, // mirror for goldfish
    definitions,
    opponent: RandomBot,
    episodes: goldfishEpisodes,
    reward: goldfishReward,
    maxTurns: Math.min(maxTurns, 20),
    seed,
    learningRate,
    onLog: onLog
      ? (ep, r, eps, avg) => onLog(ep, r, eps, avg)
      : undefined,
  });

  // Phase 2: real opponent (win/loss reward, warm start from phase 1)
  const phase2 = trainPolicy({
    deck,
    opponentDeck,
    definitions,
    opponent: RandomBot, // or a provided opponent
    episodes: realEpisodes,
    warmStart: phase1.policy,
    maxTurns,
    seed: seed !== undefined ? seed + 1 : undefined,
    learningRate: learningRate * 0.5, // lower LR for fine-tuning
    onLog: onLog
      ? (ep, r, eps, avg) => onLog(goldfishEpisodes + ep, r, eps, avg)
      : undefined,
  });

  return {
    policy: phase2.policy,
    rewardCurve: [...phase1.rewardCurve, ...phase2.rewardCurve],
    totalEpisodes: goldfishEpisodes + realEpisodes,
    finalEpsilon: phase2.finalEpsilon,
  };
}
