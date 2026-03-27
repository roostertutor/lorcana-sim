// =============================================================================
// BOT RESOLVER
// Maps a --bot string to a BotStrategy.
// Supported: random, greedy, probability, aggro, control, midrange, rush
// =============================================================================

import {
  RandomBot,
  GreedyBot,
  ProbabilityBot,
  RampCindyCowBot,
  AggroWeights,
  ControlWeights,
  MidrangeWeights,
  RushWeights,
} from "@lorcana-sim/simulator";
import type { BotStrategy } from "@lorcana-sim/simulator";

const BOT_NAMES = ["random", "greedy", "probability", "aggro", "control", "midrange", "rush", "ramp-cindy-cow"] as const;
export type BotName = (typeof BOT_NAMES)[number];

export function resolveBot(name: string): BotStrategy {
  switch (name.toLowerCase()) {
    case "random":      return RandomBot;
    case "greedy":      return GreedyBot;
    case "probability": return ProbabilityBot(MidrangeWeights);
    case "aggro":       return ProbabilityBot(AggroWeights);
    case "control":     return ProbabilityBot(ControlWeights);
    case "midrange":    return ProbabilityBot(MidrangeWeights);
    case "rush":        return ProbabilityBot(RushWeights);
    case "ramp-cindy-cow": return RampCindyCowBot;
    default:
      console.error(`Unknown bot "${name}". Valid options: ${BOT_NAMES.join(", ")}`);
      process.exit(1);
  }
}
