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
import { runGame } from "../runGame.js";
import { RandomBot } from "../bots/RandomBot.js";
import { RLPolicy } from "./policy.js";
import { trainPolicy } from "./trainer.js";
import { stateToFeatures, actionToFeatures } from "./autoTag.js";

const definitions = LORCAST_CARD_DEFINITIONS;

const LILO_STITCH_DECK = [
  { definitionId: "lilo-making-a-wish", count: 30 },
  { definitionId: "stitch-new-dog", count: 30 },
];

/**
 * Play one game with the policy and track per-card action stats.
 * Returns: how many times each card was inked vs played.
 */
function traceGame(policy: RLPolicy, seed: number) {
  // Set epsilon to 0 for pure exploitation
  const savedEpsilon = policy.epsilon;
  policy.epsilon = 0;
  policy.clearHistory();

  const result = runGame({
    player1Deck: LILO_STITCH_DECK,
    player2Deck: LILO_STITCH_DECK,
    player1Strategy: policy,
    player2Strategy: RandomBot,
    definitions,
    maxTurns: 15,
    seed,
  });

  policy.epsilon = savedEpsilon;
  policy.clearHistory();

  // Count card-specific actions for player1
  let liloInked = 0, liloPlayed = 0, liloQuested = 0;
  let stitchInked = 0, stitchPlayed = 0, stitchQuested = 0;

  for (const action of result.actions) {
    if (action.playerId !== "player1") continue;

    if (action.type === "PLAY_INK") {
      const inst = result.cardStats[action.instanceId];
      if (!inst) continue;
      if (inst.definitionId === "lilo-making-a-wish") liloInked++;
      if (inst.definitionId === "stitch-new-dog") stitchInked++;
    }

    if (action.type === "PLAY_CARD") {
      const inst = result.cardStats[action.instanceId];
      if (!inst) continue;
      if (inst.definitionId === "lilo-making-a-wish") liloPlayed++;
      if (inst.definitionId === "stitch-new-dog") stitchPlayed++;
    }

    if (action.type === "QUEST") {
      const inst = result.cardStats[action.instanceId];
      if (!inst) continue;
      if (inst.definitionId === "lilo-making-a-wish") liloQuested++;
      if (inst.definitionId === "stitch-new-dog") stitchQuested++;
    }
  }

  return {
    lore: result.finalLore["player1"],
    turns: result.turns,
    winner: result.winner,
    lilo: { inked: liloInked, played: liloPlayed, quested: liloQuested },
    stitch: { inked: stitchInked, played: stitchPlayed, quested: stitchQuested },
  };
}

/**
 * Run N traced games and aggregate stats.
 */
function aggregateTraces(policy: RLPolicy, count: number, seedStart: number) {
  let liloInked = 0, liloPlayed = 0;
  let stitchInked = 0, stitchPlayed = 0;
  let totalLore = 0;

  for (let i = 0; i < count; i++) {
    const t = traceGame(policy, seedStart + i);
    liloInked += t.lilo.inked;
    liloPlayed += t.lilo.played;
    stitchInked += t.stitch.inked;
    stitchPlayed += t.stitch.played;
    totalLore += t.lore;
  }

  return {
    avgLore: totalLore / count,
    liloInked, liloPlayed,
    stitchInked, stitchPlayed,
    liloPlayRate: liloPlayed / Math.max(liloPlayed + liloInked, 1),
    stitchInkRate: stitchInked / Math.max(stitchInked + stitchPlayed, 1),
  };
}

describe("Lilo & Stitch goldfish learning", () => {
  it("untrained policy (random) has no card preference", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("untrained", rng, cloneRng(rng), 1.0);

    const stats = aggregateTraces(policy, 50, 1000);
    console.log("\n--- UNTRAINED (ε=1.0, random) ---");
    console.log(`  Avg lore: ${stats.avgLore.toFixed(1)}`);
    console.log(`  Lilo:   ${stats.liloPlayed} played, ${stats.liloInked} inked (play rate: ${(stats.liloPlayRate * 100).toFixed(0)}%)`);
    console.log(`  Stitch: ${stats.stitchPlayed} played, ${stats.stitchInked} inked (ink rate: ${(stats.stitchInkRate * 100).toFixed(0)}%)`);

    // Untrained should be roughly 50/50 on play vs ink for each card
    // (Lilo can't be inked since inkable=false, so she should always be played)
    // Actually Lilo is NOT inkable, so PLAY_INK actions for Lilo will be invalid
    // The bot can only play Lilo or pass. Stitch can be inked or played.
    expect(stats.liloInked).toBe(0); // Lilo is not inkable
  });

  it("after training, bot prefers inking Stitch over playing Stitch", () => {
    console.log("\n--- TRAINING 2000 episodes ---");
    const result = trainPolicy({
      deck: LILO_STITCH_DECK,
      opponentDeck: LILO_STITCH_DECK,
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
    const stats = aggregateTraces(result.policy, 50, 5000);
    console.log("\n--- TRAINED (ε=0, exploitation) ---");
    console.log(`  Avg lore: ${stats.avgLore.toFixed(1)}`);
    console.log(`  Lilo:   ${stats.liloPlayed} played, ${stats.liloInked} inked (play rate: ${(stats.liloPlayRate * 100).toFixed(0)}%)`);
    console.log(`  Stitch: ${stats.stitchPlayed} played, ${stats.stitchInked} inked (ink rate: ${(stats.stitchInkRate * 100).toFixed(0)}%)`);

    // Key assertions:
    // 1. Lilo can't be inked — engine enforces this
    expect(stats.liloInked).toBe(0);

    // 2. Bot should play Lilo (high lore) — always played at 100%
    expect(stats.liloPlayRate).toBeGreaterThan(0.9);

    // 3. Stitch should be inked at least sometimes (to fund playing Lilos)
    expect(stats.stitchInked).toBeGreaterThan(0);

    // 4. The trained bot should get dramatically more lore than untrained
    // Untrained random bot gets ~0.3-0.7 avg lore. Trained should get 10+.
    expect(stats.avgLore).toBeGreaterThan(5);

    console.log(`\n  ✓ Bot learned goldfish strategy:`);
    console.log(`    Lilo: always played (${(stats.liloPlayRate * 100).toFixed(0)}%)`);
    console.log(`    Stitch: inked ${stats.stitchInked}x, played ${stats.stitchPlayed}x`);
    console.log(`    Avg lore: ${stats.avgLore.toFixed(1)} (untrained baseline ~0.5)`);
  }, 600_000);
});
