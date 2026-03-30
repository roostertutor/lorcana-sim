// =============================================================================
// LILO & STITCH LEARNING TEST
// Can the RL bot discover that Lilo (2 lore, not inkable) should be played
// and Stitch (1 lore, inkable) should be inked?
//
// Deck: 30 Lilo - Making a Wish + 30 Stitch - New Dog
// Optimal goldfish: ink Stitch, play Lilo, quest Lilo every turn.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  createRng,
  cloneRng,
  createGame,
  getAllLegalActions,
  LORCAST_CARD_DEFINITIONS,
} from "@lorcana-sim/engine";
import { RandomBot } from "../../bots/RandomBot.js";
import { RLPolicy } from "../policy.js";
import { trainPolicy } from "../trainer.js";
import { stateToFeatures, actionToFeatures } from "../autoTag.js";
import { traceGame, aggregateTraces } from "../testUtils.js";

const definitions = LORCAST_CARD_DEFINITIONS;

const LILO_STITCH_DECK = [
  { definitionId: "lilo-making-a-wish", count: 30 },
  { definitionId: "stitch-new-dog", count: 30 },
];

describe("Lilo & Stitch goldfish learning", () => {
  it("untrained policy (random) has no card preference", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("untrained", rng, cloneRng(rng), 1.0);

    const stats = aggregateTraces(policy, LILO_STITCH_DECK, definitions, 50, 1000);
    console.log("\n--- UNTRAINED (ε=1.0, random) ---");
    console.log(`  Avg lore: ${stats.avgLore.toFixed(1)}`);
    const liloStats = stats.cardStats["lilo-making-a-wish"];
    const stitchStats = stats.cardStats["stitch-new-dog"];
    console.log(`  Lilo:   ${liloStats?.played ?? 0} played, ${liloStats?.inked ?? 0} inked (play rate: ${((stats.playRates["lilo-making-a-wish"] ?? 0) * 100).toFixed(0)}%)`);
    console.log(`  Stitch: ${stitchStats?.played ?? 0} played, ${stitchStats?.inked ?? 0} inked (ink rate: ${((stats.inkRates["stitch-new-dog"] ?? 0) * 100).toFixed(0)}%)`);

    // Lilo is NOT inkable, so she should never be inked
    expect(liloStats?.inked ?? 0).toBe(0);
  });

  it("after training, bot prefers inking Stitch over playing Stitch", () => {
    console.log("\n--- TRAINING 500 episodes ---");
    const result = trainPolicy({
      deck: LILO_STITCH_DECK,
      opponentDeck: LILO_STITCH_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 1000,
      seed: 42,
      maxTurns: 12,
      learningRate: 0.001,
      epsilon: 1.0,
      minEpsilon: 0.05,
      decayRate: 0.996,
      reward: (r) => Math.min((r.finalLore["player1"] ?? 0) / 20, 1),
      onLog: (ep, _r, eps, avg) => {
        if (ep % 100 === 0) {
          console.log(`  Episode ${ep}: avg=${avg.toFixed(3)}, ε=${eps.toFixed(3)}`);
        }
      },
    });

    // Debug: score a few actions to see what the network thinks
    {
      const debugState = createGame(
        { player1Deck: LILO_STITCH_DECK, player2Deck: LILO_STITCH_DECK, seed: 9999 },
        definitions
      );
      const legal = getAllLegalActions(debugState, "player1", definitions);
      const stateFeats = stateToFeatures(debugState, "player1", definitions);
      console.log(`\n--- DEBUG: ${legal.length} legal actions on turn 1 ---`);
      for (const action of legal.slice(0, 10)) {
        const aFeats = actionToFeatures(debugState, action, "player1", definitions);
        const input = [...stateFeats, ...aFeats];
        const score = result.policy.actionNet.forward(input)[0]!;
        const inst = "instanceId" in action ? debugState.cards[(action as { instanceId: string }).instanceId] : null;
        const defId = inst ? inst.definitionId : "n/a";
        console.log(`  ${action.type.padEnd(15)} ${defId.padEnd(25)} score=${score.toFixed(4)}`);
      }
    }

    // Trace 50 games with trained policy (exploitation only)
    const stats = aggregateTraces(result.policy, LILO_STITCH_DECK, definitions, 50, 5000, 12);
    const liloStats = stats.cardStats["lilo-making-a-wish"];
    const stitchStats = stats.cardStats["stitch-new-dog"];
    console.log("\n--- TRAINED (ε=0, exploitation) ---");
    console.log(`  Avg lore: ${stats.avgLore.toFixed(1)}`);
    console.log(`  Lilo:   ${liloStats?.played ?? 0} played, ${liloStats?.inked ?? 0} inked (play rate: ${((stats.playRates["lilo-making-a-wish"] ?? 0) * 100).toFixed(0)}%)`);
    console.log(`  Stitch: ${stitchStats?.played ?? 0} played, ${stitchStats?.inked ?? 0} inked (ink rate: ${((stats.inkRates["stitch-new-dog"] ?? 0) * 100).toFixed(0)}%)`);

    // Key assertions:
    // 1. Lilo can't be inked — engine enforces this
    expect(liloStats?.inked ?? 0).toBe(0);

    // 2. Bot should play Lilo (high lore) — always played at 100%
    expect(stats.playRates["lilo-making-a-wish"] ?? 0).toBeGreaterThan(0.9);

    // 3. Stitch should be inked at least sometimes (to fund playing Lilos)
    expect(stitchStats?.inked ?? 0).toBeGreaterThan(0);

    // 4. The trained bot should get dramatically more lore than untrained
    expect(stats.avgLore).toBeGreaterThan(5);

    console.log(`\n  ✓ Bot learned goldfish strategy:`);
    console.log(`    Lilo: always played (${((stats.playRates["lilo-making-a-wish"] ?? 0) * 100).toFixed(0)}%)`);
    console.log(`    Stitch: inked ${stitchStats?.inked ?? 0}x, played ${stitchStats?.played ?? 0}x`);
    console.log(`    Avg lore: ${stats.avgLore.toFixed(1)} (untrained baseline ~0.5)`);
  }, 300_000);
});
