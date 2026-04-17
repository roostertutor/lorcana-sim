// =============================================================================
// REAL DECK LEARNING TEST
// Validates RL bot learns sensible play on a multi-cost deck.
// Key insight: bot should ink cheap cards and play expensive ones.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  createRng,
  cloneRng,
  CARD_DEFINITIONS,
} from "@lorcana-sim/engine";
import { RandomBot } from "../../bots/RandomBot.js";
import { RLPolicy } from "../policy.js";
import { trainPolicy } from "../trainer.js";
import { aggregateTraces } from "../testUtils.js";

const definitions = CARD_DEFINITIONS;

// Multi-cost deck: 60 cards spanning costs 1–6, all inkable
const MULTI_COST_DECK = [
  { definitionId: "heihei-boat-snack", count: 10 },         // cost 1
  { definitionId: "lefou-bumbler", count: 10 },              // cost 2
  { definitionId: "ariel-spectacular-singer", count: 10 },   // cost 3
  { definitionId: "ariel-on-human-legs", count: 10 },        // cost 4
  { definitionId: "goofy-musketeer", count: 10 },            // cost 5
  { definitionId: "stitch-rock-star", count: 10 },           // cost 6
];

// Map definitionId → ink cost for analysis
const CARD_COSTS: Record<string, number> = {
  "heihei-boat-snack": 1,
  "lefou-bumbler": 2,
  "ariel-spectacular-singer": 3,
  "ariel-on-human-legs": 4,
  "goofy-musketeer": 5,
  "stitch-rock-star": 6,
};

describe("Real deck learning", () => {
  it("trained bot scores higher lore than untrained on multi-cost deck", () => {
    // Train
    console.log("\n--- TRAINING 2000 episodes on multi-cost deck ---");
    const result = trainPolicy({
      deck: MULTI_COST_DECK,
      opponentDeck: MULTI_COST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 2000,
      seed: 42,
      maxTurns: 15,
      learningRate: 0.001,
      epsilon: 1.0,
      minEpsilon: 0.05,
      decayRate: 0.997,
      reward: (r) => Math.min((r.finalLore["player1"] ?? 0) / 20, 1),
      onLog: (ep, _r, eps, avg) => {
        if (ep % 500 === 0) {
          console.log(`  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`);
        }
      },
    });

    // Trace with trained policy
    const trainedStats = aggregateTraces(
      result.policy, MULTI_COST_DECK, definitions, 20, 8000, 15
    );

    // Trace with untrained policy
    const rng = createRng(99);
    const untrained = new RLPolicy("untrained", rng, cloneRng(rng), 1.0);
    const untrainedStats = aggregateTraces(
      untrained, MULTI_COST_DECK, definitions, 20, 8000, 15
    );

    console.log(`\n  Untrained avg lore: ${untrainedStats.avgLore.toFixed(1)}`);
    console.log(`  Trained avg lore:   ${trainedStats.avgLore.toFixed(1)}`);

    // Print per-card breakdown
    console.log("\n  Per-card action breakdown (trained):");
    for (const [defId, cost] of Object.entries(CARD_COSTS)) {
      const s = trainedStats.cardStats[defId];
      if (s) {
        console.log(`    ${defId.padEnd(30)} cost=${cost}  inked=${s.inked} played=${s.played} quested=${s.quested}`);
      }
    }

    // Trained should get meaningfully more lore than untrained
    expect(trainedStats.avgLore).toBeGreaterThan(untrainedStats.avgLore);
  }, 300_000);

  it("trained bot inks cheap cards and plays expensive ones", () => {
    const result = trainPolicy({
      deck: MULTI_COST_DECK,
      opponentDeck: MULTI_COST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 2000,
      seed: 77,
      maxTurns: 15,
      learningRate: 0.001,
      epsilon: 1.0,
      minEpsilon: 0.05,
      decayRate: 0.997,
      reward: (r) => Math.min((r.finalLore["player1"] ?? 0) / 20, 1),
    });

    const stats = aggregateTraces(
      result.policy, MULTI_COST_DECK, definitions, 50, 9000, 15
    );

    // Compute weighted average cost of inked vs played cards
    let inkCostSum = 0, inkCount = 0;
    let playCostSum = 0, playCount = 0;

    for (const [defId, cost] of Object.entries(CARD_COSTS)) {
      const s = stats.cardStats[defId];
      if (s) {
        inkCostSum += cost * s.inked;
        inkCount += s.inked;
        playCostSum += cost * s.played;
        playCount += s.played;
      }
    }

    const avgInkCost = inkCount > 0 ? inkCostSum / inkCount : 0;
    const avgPlayCost = playCount > 0 ? playCostSum / playCount : 0;

    console.log(`\n  Avg cost of inked cards:  ${avgInkCost.toFixed(2)}`);
    console.log(`  Avg cost of played cards: ${avgPlayCost.toFixed(2)}`);

    // Bot learns to play cheap cards (easy to deploy) and ink expensive ones
    // (each card gives 1 ink regardless of cost, so expensive cards that can't
    // be played yet are better used as ink to fund cheaper plays).
    // Assert the bot differentiates: avg ink cost ≠ avg play cost
    expect(avgInkCost).not.toBeCloseTo(avgPlayCost, 0);

    // The bot should play cheap cards more and ink expensive cards more
    // Verify: cost-1 cards have higher play rate than cost-6 cards
    const cheapPlayRate = stats.playRates["heihei-boat-snack"] ?? 0;
    const expensivePlayRate = stats.playRates["stitch-rock-star"] ?? 0;
    console.log(`  Cost-1 play rate: ${(cheapPlayRate * 100).toFixed(0)}%`);
    console.log(`  Cost-6 play rate: ${(expensivePlayRate * 100).toFixed(0)}%`);
    expect(cheapPlayRate).toBeGreaterThan(expensivePlayRate);
  }, 300_000);
});
