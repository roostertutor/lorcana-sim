// =============================================================================
// LEARN COMMAND
// pnpm learn --deck ./deck.txt --episodes 50000 [--save policies/out.json]
//
// Trains an RL policy using Actor-Critic with GAE.
// =============================================================================

import { writeFileSync, readFileSync } from "fs";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { trainPolicy, RLPolicy, RandomBot } from "@lorcana-sim/simulator";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";

export interface LearnArgs {
  deck: string;
  opponent?: string;
  episodes: number;
  save?: string;
  load?: string;
  seed?: number;
  maxTurns: number;
}

export function runLearn(args: LearnArgs): void {
  const definitions = CARD_DEFINITIONS;
  const deck = loadDeck(args.deck, definitions);
  const opponentDeck = args.opponent ? loadDeck(args.opponent, definitions) : deck;
  const opponent = RandomBot; // Default training opponent

  // Warm start from saved policy if provided
  let warmStart: RLPolicy | undefined;
  if (args.load) {
    try {
      const json = JSON.parse(readFileSync(args.load, "utf-8"));
      warmStart = RLPolicy.fromJSON(json);
      console.log(`Loaded policy from ${args.load} (epsilon=${warmStart.epsilon.toFixed(4)})`);
    } catch (e) {
      console.error(`Error loading policy from ${args.load}:`, e);
      process.exit(1);
    }
  }

  const onLog = (episode: number, reward: number, epsilon: number, avgReward: number) => {
    console.log(
      `Episode ${episode.toString().padStart(7)} | ` +
      `reward=${reward.toFixed(3)} | ` +
      `avg=${avgReward.toFixed(3)} | ` +
      `ε=${epsilon.toFixed(4)}`
    );
  };

  console.log(`\nTraining RL policy...`);
  console.log(`  Deck: ${args.deck}`);
  console.log(`  Episodes: ${args.episodes}`);
  console.log(`  Max turns: ${args.maxTurns}`);
  if (args.seed !== undefined) console.log(`  Seed: ${args.seed}`);
  console.log();

  const startTime = Date.now();

  const result = trainPolicy({
    deck,
    opponentDeck,
    definitions,
    opponent,
    episodes: args.episodes,
    maxTurns: args.maxTurns,
    seed: args.seed,
    warmStart,
    onLog,
    logInterval: Math.max(1, Math.floor(args.episodes / 20)),
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTraining complete in ${elapsed}s`);
  console.log(`  Total episodes: ${result.totalEpisodes}`);
  console.log(`  Final epsilon: ${result.finalEpsilon.toFixed(4)}`);

  // Summarize reward curve
  const curve = result.rewardCurve;
  if (curve.length >= 2000) {
    const first1k = curve.slice(0, 1000).reduce((a, b) => a + b, 0) / 1000;
    const last1k = curve.slice(-1000).reduce((a, b) => a + b, 0) / 1000;
    console.log(`  First 1000 avg reward: ${first1k.toFixed(3)}`);
    console.log(`  Last 1000 avg reward:  ${last1k.toFixed(3)}`);
    console.log(`  Improvement: ${(last1k - first1k > 0 ? "+" : "")}${(last1k - first1k).toFixed(3)}`);
  }

  // Save policy
  if (args.save) {
    result.policy.epsilon = 0; // Exploitation mode for saved policy
    const json = JSON.stringify(result.policy.toJSON());
    writeFileSync(args.save, json);
    console.log(`\nPolicy saved to ${args.save}`);
  }
}
