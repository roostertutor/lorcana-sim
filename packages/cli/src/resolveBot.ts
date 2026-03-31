// =============================================================================
// BOT RESOLVER
// Maps a --bot string to a BotStrategy.
// Supported: random, greedy, rl
// =============================================================================

import { readFileSync } from "fs";
import { RandomBot, GreedyBot, RLPolicy } from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";

const BOT_NAMES = ["random", "greedy", "rl"] as const;
export type BotName = (typeof BOT_NAMES)[number];

export function resolveBot(name: string, policyPath?: string): BotStrategy {
  switch (name.toLowerCase()) {
    case "random":  return RandomBot;
    case "greedy":  return GreedyBot;
    case "rl": {
      if (!policyPath) {
        console.error("rl bot requires --policy <path> to a saved policy JSON file");
        process.exit(1);
      }
      const json = JSON.parse(readFileSync(policyPath, "utf-8"));
      const policy = RLPolicy.fromJSON(json);
      policy.epsilon = 0; // Pure exploitation for evaluation
      return policy;
    }
    default:
      console.error(`Unknown bot "${name}". Valid options: ${BOT_NAMES.join(", ")}`);
      process.exit(1);
  }
}
