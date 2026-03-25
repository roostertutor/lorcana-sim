// =============================================================================
// RUN SIMULATION
// Runs many games and returns all results.
// Caller (analytics package) is responsible for aggregation.
// =============================================================================

import { runGame } from "./runGame.js";
import type { GameResult, SimConfig } from "./types.js";

export function runSimulation(config: SimConfig): GameResult[] {
  const results: GameResult[] = [];
  for (let i = 0; i < config.iterations; i++) {
    results.push(runGame(config));
  }
  return results;
}
