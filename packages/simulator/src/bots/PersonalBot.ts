// =============================================================================
// PERSONAL BOT
// Weight vector + optional override rules. Always type "personal".
// Calibrate by replaying real decisions and measuring agreement rate.
// Gap between PersonalBot and OptimalBot is a quantified coaching map.
// =============================================================================

import type { BotStrategy, PersonalBotConfig } from "../types.js";
import { ProbabilityBot } from "./ProbabilityBot.js";

export function createPersonalBot(config: PersonalBotConfig): BotStrategy {
  const baseBot = ProbabilityBot(config.weights);
  const overrides = config.overrides ?? [];

  return {
    name: config.name,
    type: "personal",
    decideAction(state, playerId, definitions) {
      // Override rules fire first, in order
      for (const rule of overrides) {
        if (rule.condition(state, playerId)) {
          return rule.action(state, playerId, definitions);
        }
      }
      return baseBot.decideAction(state, playerId, definitions);
    },
  };
}
