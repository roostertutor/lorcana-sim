// =============================================================================
// CLONE TRAINER TESTS
// Behavioral cloning correctness + determinism.
//
// Correctness: a clone trained on GreedyBot's logs reproduces GreedyBot's
// choices on HELD-OUT positions with top-1 accuracy well above the
// random-legal-action baseline.
//
// Determinism: same seed + same samples → byte-identical trained weights and
// identical held-out accuracy (required for reproducibility).
// =============================================================================

import { describe, it, expect } from "vitest";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import {
  trainClone,
  evaluateClone,
  generateCloneSamples,
  actionKey,
} from "./cloneTrainer.js";
import type { CloneSample } from "./cloneTrainer.js";
import { GreedyBot } from "../bots/GreedyBot.js";
import { RandomBot } from "../bots/RandomBot.js";

const definitions = CARD_DEFINITIONS;

// A simple, valid 60-card deck (same shape as rl.test.ts TEST_DECK).
const TEST_DECK = [
  { definitionId: "simba-protective-cub", count: 10 },
  { definitionId: "stitch-rock-star", count: 10 },
  { definitionId: "beast-hardheaded", count: 10 },
  { definitionId: "moana-of-motunui", count: 10 },
  { definitionId: "hercules-true-hero", count: 10 },
  { definitionId: "tinker-bell-tiny-tactician", count: 10 },
];

/** Generate a train/test split of GreedyBot samples from disjoint game seeds. */
function makeSplit(): { train: CloneSample[]; test: CloneSample[] } {
  const train = generateCloneSamples({
    bot: GreedyBot,
    opponent: RandomBot,
    deck: TEST_DECK,
    opponentDeck: TEST_DECK,
    definitions,
    games: 18,
    maxTurns: 25,
    seed: 100,
  });
  // Disjoint seed → held-out positions GreedyBot never produced during training.
  const test = generateCloneSamples({
    bot: GreedyBot,
    opponent: RandomBot,
    deck: TEST_DECK,
    opponentDeck: TEST_DECK,
    definitions,
    games: 8,
    maxTurns: 25,
    seed: 777,
  });
  return { train, test };
}

describe("cloneTrainer — sample generation", () => {
  it("produces game_actions-shaped samples with legalActionCount", () => {
    const samples = generateCloneSamples({
      bot: GreedyBot,
      opponent: RandomBot,
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      games: 3,
      maxTurns: 20,
      seed: 5,
    });
    expect(samples.length).toBeGreaterThan(20);
    for (const s of samples) {
      expect(s.action.playerId).toBe("player1");
      expect(s.stateBefore).toBeTruthy();
      expect(s.legalActionCount).not.toBeNull();
      expect(s.legalActionCount!).toBeGreaterThanOrEqual(1);
    }
  });

  it("is deterministic for a fixed seed", () => {
    // GreedyBot opponent (deterministic) → full reproducibility. RandomBot uses
    // unseeded Math.random and would make game trajectories diverge.
    const cfg = {
      bot: GreedyBot,
      opponent: GreedyBot,
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      games: 4,
      maxTurns: 20,
      seed: 42,
    };
    const a = generateCloneSamples(cfg);
    const b = generateCloneSamples(cfg);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(actionKey(a[i]!.action)).toBe(actionKey(b[i]!.action));
      expect(a[i]!.legalActionCount).toBe(b[i]!.legalActionCount);
    }
  });
});

describe("cloneTrainer — behavioral cloning correctness", () => {
  it("reproduces GreedyBot choices on held-out positions above the random baseline", () => {
    const { train, test } = makeSplit();

    const result = trainClone({
      samples: train,
      definitions,
      epochs: 10,
      learningRate: 0.05,
      seed: 1,
    });

    const evalResult = evaluateClone(result.policy, test, definitions);

    // Sanity: enough held-out multi-option decisions to be meaningful.
    expect(evalResult.samplesEvaluated).toBeGreaterThan(30);

    // The clone must clearly beat random-legal guessing on held-out positions.
    expect(evalResult.top1Accuracy).toBeGreaterThan(
      evalResult.randomBaseline + 0.15
    );
    // Absolute floor — GreedyBot is a deterministic, learnable target.
    expect(evalResult.top1Accuracy).toBeGreaterThan(0.5);
  });

  it("improves training accuracy across epochs", () => {
    const { train } = makeSplit();
    const result = trainClone({
      samples: train,
      definitions,
      epochs: 10,
      learningRate: 0.05,
      seed: 1,
    });
    const firstAcc = result.trainAccCurve[0]!;
    const lastAcc = result.trainAccCurve[result.trainAccCurve.length - 1]!;
    expect(lastAcc).toBeGreaterThan(firstAcc);
  });
});

describe("cloneTrainer — determinism", () => {
  it("same seed + same samples → identical training curve and weights", () => {
    const { train } = makeSplit();

    const r1 = trainClone({ samples: train, definitions, epochs: 6, seed: 7 });
    const r2 = trainClone({ samples: train, definitions, epochs: 6, seed: 7 });

    // Identical learning curves.
    expect(r1.logLikCurve).toEqual(r2.logLikCurve);
    expect(r1.trainAccCurve).toEqual(r2.trainAccCurve);

    // Identical serialized weights.
    const w1 = JSON.stringify(r1.policy.actionNet.toJSON());
    const w2 = JSON.stringify(r2.policy.actionNet.toJSON());
    expect(w1).toBe(w2);
  });

  it("different seed → different weights (initialization + shuffle differ)", () => {
    const { train } = makeSplit();
    const r1 = trainClone({ samples: train, definitions, epochs: 4, seed: 1 });
    const r2 = trainClone({ samples: train, definitions, epochs: 4, seed: 2 });
    const w1 = JSON.stringify(r1.policy.actionNet.toJSON());
    const w2 = JSON.stringify(r2.policy.actionNet.toJSON());
    expect(w1).not.toBe(w2);
  });
});

describe("cloneTrainer — output loads as an RLPolicy", () => {
  it("trained clone serializes to RLPolicyJSON and round-trips", async () => {
    const { train } = makeSplit();
    const result = trainClone({ samples: train, definitions, epochs: 2, seed: 1 });
    const json = result.policy.toJSON();
    expect(json.actionNet).toBeTruthy();
    expect(json.mulliganNet).toBeTruthy();
    expect(json.epsilon).toBe(0);

    const { RLPolicy } = await import("./policy.js");
    const reloaded = RLPolicy.fromJSON(json);
    expect(reloaded.actionNet.weightCount).toBe(result.policy.actionNet.weightCount);
  });
});
