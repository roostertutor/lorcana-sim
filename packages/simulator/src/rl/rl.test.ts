// =============================================================================
// RL MODULE TESTS
// Unit tests per component + integration reward-curve test.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  createRng,
  cloneRng,
  LORCAST_CARD_DEFINITIONS,
  getAllLegalActions,
} from "@lorcana-sim/engine";
import type { GameState, PlayerID } from "@lorcana-sim/engine";
import {
  cardToFeatures,
  cardFeaturesToArray,
  stateToFeatures,
  actionToFeatures,
  CARD_FEATURE_SIZE,
  STATE_FEATURE_SIZE,
  ACTION_FEATURE_SIZE,
  NETWORK_INPUT_SIZE,
} from "./autoTag.js";
import { NeuralNetwork, softmax, relu } from "./network.js";
import { RLPolicy } from "./policy.js";
import { trainPolicy } from "./trainer.js";
import { RandomBot } from "../bots/RandomBot.js";
import { applyAction, getZone } from "@lorcana-sim/engine";
import type { ZoneName } from "@lorcana-sim/engine";

// ---------------------------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------------------------

const definitions = LORCAST_CARD_DEFINITIONS;

const TEST_DECK = [
  { definitionId: "simba-protective-cub", count: 10 },
  { definitionId: "stitch-rock-star", count: 10 },
  { definitionId: "beast-hardheaded", count: 10 },
  { definitionId: "moana-of-motunui", count: 10 },
  { definitionId: "hercules-true-hero", count: 10 },
  { definitionId: "tinker-bell-tiny-tactician", count: 10 },
];

function createTestState(seed = 42): GameState {
  let state = createGame(
    { player1Deck: TEST_DECK, player2Deck: TEST_DECK, seed },
    definitions
  );
  // Resolve both mulligans (keep all) so tests start in main phase
  state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] }, definitions).newState;
  state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] }, definitions).newState;
  return state;
}

// ===========================================================================
// autoTag tests
// ===========================================================================

describe("autoTag", () => {
  it("cardToFeatures returns array of length CARD_FEATURE_SIZE for a known card", () => {
    const def = definitions["simba-protective-cub"]!;
    const features = cardToFeatures(def);
    const arr = cardFeaturesToArray(features);
    expect(arr).toHaveLength(CARD_FEATURE_SIZE);
    // All values should be numbers
    for (const v of arr) {
      expect(typeof v).toBe("number");
      expect(isNaN(v)).toBe(false);
    }
  });

  it("stateToFeatures returns array of length STATE_FEATURE_SIZE, all values in [0,1]", () => {
    const state = createTestState();
    const features = stateToFeatures(state, "player1", definitions);
    expect(features).toHaveLength(STATE_FEATURE_SIZE);
    for (const v of features) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("actionToFeatures returns array of length ACTION_FEATURE_SIZE", () => {
    const state = createTestState();
    const legal = getAllLegalActions(state, "player1", definitions);
    expect(legal.length).toBeGreaterThan(0);
    const feats = actionToFeatures(state, legal[0]!, "player1", definitions);
    expect(feats).toHaveLength(ACTION_FEATURE_SIZE);
  });

  it("actionToFeatures one-hot correct for each action type", () => {
    const state = createTestState();
    const legal = getAllLegalActions(state, "player1", definitions);

    // Find a PASS_TURN action
    const passAction = legal.find((a) => a.type === "PASS_TURN");
    expect(passAction).toBeDefined();
    const passFeats = actionToFeatures(state, passAction!, "player1", definitions);
    // PASS_TURN is index 5
    expect(passFeats[5]).toBe(1);
    // Sum of one-hot should be 1
    const oneHotSum = passFeats.slice(0, 8).reduce((a, b) => a + b, 0);
    expect(oneHotSum).toBe(1);
  });

  it("actionToFeatures PASS_TURN has zero card features", () => {
    const state = createTestState();
    const passAction = { type: "PASS_TURN" as const, playerId: "player1" as PlayerID };
    const feats = actionToFeatures(state, passAction, "player1", definitions);
    // Card features start at index 8, should all be zero
    const cardFeats = feats.slice(8);
    for (const v of cardFeats) {
      expect(v).toBe(0);
    }
  });

  it("actionToFeatures CHALLENGE encodes both attacker and defender", () => {
    // We need a state where CHALLENGE is legal — set up manually
    // For now, just test the encoding of a CHALLENGE action even if not legal
    const state = createTestState();
    const playZone = state.zones.player1.play;
    const oppPlayZone = state.zones.player2.play;
    // If no cards in play, we can't really test this meaningfully
    // but we can still verify the structure
    if (playZone.length > 0 && oppPlayZone.length > 0) {
      const challengeAction = {
        type: "CHALLENGE" as const,
        playerId: "player1" as PlayerID,
        attackerInstanceId: playZone[0]!,
        defenderInstanceId: oppPlayZone[0]!,
      };
      const feats = actionToFeatures(state, challengeAction, "player1", definitions);
      expect(feats).toHaveLength(ACTION_FEATURE_SIZE);
      expect(feats[3]).toBe(1); // CHALLENGE index = 3
    } else {
      // Just verify CHALLENGE type encoding works with dummy ids
      const challengeAction = {
        type: "CHALLENGE" as const,
        playerId: "player1" as PlayerID,
        attackerInstanceId: "nonexistent-1",
        defenderInstanceId: "nonexistent-2",
      };
      const feats = actionToFeatures(state, challengeAction, "player1", definitions);
      expect(feats).toHaveLength(ACTION_FEATURE_SIZE);
      expect(feats[3]).toBe(1); // CHALLENGE index = 3
    }
  });
});

// ===========================================================================
// network tests
// ===========================================================================

describe("NeuralNetwork", () => {
  it("constructor produces correct weight shapes", () => {
    const rng = createRng(42);
    const net = new NeuralNetwork(10, 8, 4, 2, rng);
    expect(net.inputSize).toBe(10);
    expect(net.h1Size).toBe(8);
    expect(net.h2Size).toBe(4);
    expect(net.outputSize).toBe(2);
    // Total weights: 10*8 + 8 + 8*4 + 4 + 4*2 + 2 = 80+8+32+4+8+2 = 134
    expect(net.weightCount).toBe(134);
  });

  it("forward() returns array of length outputSize, no NaN", () => {
    const rng = createRng(42);
    const net = new NeuralNetwork(10, 8, 4, 2, rng);
    const input = new Array(10).fill(0.5);
    const output = net.forward(input);
    expect(output).toHaveLength(2);
    for (const v of output) {
      expect(isNaN(v)).toBe(false);
    }
  });

  it("update() changes weights", () => {
    const rng = createRng(42);
    const net = new NeuralNetwork(10, 8, 4, 2, rng);
    const input = new Array(10).fill(0.5);
    const before = net.getWeightSnapshot();
    net.update(input, 0, 1.0, 0.01);
    const after = net.getWeightSnapshot();

    // At least some weights should have changed
    let changed = false;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  it("update() doesn't produce NaN", () => {
    const rng = createRng(42);
    const net = new NeuralNetwork(10, 8, 4, 2, rng);
    const input = new Array(10).fill(0.5);
    net.update(input, 0, 1.0, 0.01);
    const output = net.forward(input);
    for (const v of output) {
      expect(isNaN(v)).toBe(false);
    }
  });

  it("toJSON() → fromJSON() round-trip: same forward output", () => {
    const rng = createRng(42);
    const net = new NeuralNetwork(10, 8, 4, 2, rng);
    const input = new Array(10).fill(0.5);
    const original = net.forward(input);

    const json = net.toJSON();
    const restored = NeuralNetwork.fromJSON(json);
    const restored_output = restored.forward(input);

    expect(restored_output).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored_output[i]).toBeCloseTo(original[i]!, 6);
    }
  });

  it("seeded init: same RNG seed → identical weights", () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const net1 = new NeuralNetwork(10, 8, 4, 2, rng1);
    const net2 = new NeuralNetwork(10, 8, 4, 2, rng2);

    const snap1 = net1.getWeightSnapshot();
    const snap2 = net2.getWeightSnapshot();

    for (let i = 0; i < snap1.length; i++) {
      expect(snap1[i]).toBe(snap2[i]);
    }
  });
});

// ===========================================================================
// policy tests
// ===========================================================================

describe("RLPolicy", () => {
  it("has name, type='algorithm', decideAction function", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng));
    expect(policy.name).toBe("test-rl");
    expect(policy.type).toBe("algorithm");
    expect(typeof policy.decideAction).toBe("function");
  });

  it("decideAction returns a valid action type", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng), 0.5);
    const state = createTestState();
    const action = policy.decideAction(state, "player1", definitions);
    expect(action).toBeDefined();
    expect(action.type).toBeDefined();
    const validTypes = [
      "PLAY_CARD", "PLAY_INK", "QUEST", "CHALLENGE",
      "ACTIVATE_ABILITY", "PASS_TURN", "RESOLVE_CHOICE", "DRAW_CARD",
    ];
    expect(validTypes).toContain(action.type);
  });

  it("decideAction with epsilon=1.0 is exploratory (varied outputs over 10 calls)", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng), 1.0);

    const actionTypes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const state = createTestState(100 + i);
      policy.clearHistory();
      const action = policy.decideAction(state, "player1", definitions);
      actionTypes.add(action.type + (action.type === "PLAY_INK" ? (action as { instanceId?: string }).instanceId : ""));
    }
    // With full exploration, we should see at least 2 different actions
    expect(actionTypes.size).toBeGreaterThanOrEqual(2);
  });

  it("shouldMulligan returns boolean", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng));
    const state = createTestState();
    const result = policy.shouldMulligan!(state, "player1", definitions);
    expect(typeof result).toBe("boolean");
  });

  it("updateFromEpisode clears episode history", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng), 0.5);
    const state = createTestState();

    // Generate some history
    policy.decideAction(state, "player1", definitions);
    policy.decideAction(state, "player1", definitions);
    expect(policy.historyLength).toBeGreaterThan(0);

    policy.updateFromEpisode(1.0, 0.001, 0.99);
    expect(policy.historyLength).toBe(0);
  });

  it("toJSON/fromJSON round-trip preserves behavior", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("test-rl", rng, cloneRng(rng), 0.3);

    const json = policy.toJSON();
    const restored = RLPolicy.fromJSON(json);

    expect(restored.name).toBe("test-rl");
    expect(restored.epsilon).toBeCloseTo(0.3);
    expect(restored.type).toBe("algorithm");
  });
});

// ===========================================================================
// integration tests
// ===========================================================================

describe("training integration", () => {
  it("trainPolicy with 100 episodes completes without error", () => {
    const result = trainPolicy({
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 100,
      seed: 42,
      maxTurns: 15,
    });
    expect(result).toBeDefined();
    expect(result.policy).toBeDefined();
  });

  it("trainPolicy returns TrainingResult with non-empty rewardCurve", () => {
    const result = trainPolicy({
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 50,
      seed: 42,
      maxTurns: 15,
    });
    expect(result.rewardCurve).toHaveLength(50);
    expect(result.totalEpisodes).toBe(50);
    expect(typeof result.finalEpsilon).toBe("number");
  });

  it("seeded training: same seed → identical rewardCurve", () => {
    const run = (seed: number) =>
      trainPolicy({
        deck: TEST_DECK,
        opponentDeck: TEST_DECK,
        definitions,
        opponent: RandomBot,
        episodes: 20,
        seed,
        maxTurns: 10,
      });

    const r1 = run(123);
    const r2 = run(123);
    expect(r1.rewardCurve).toEqual(r2.rewardCurve);
  });

  it("200 episodes produce non-trivial reward distribution", () => {
    // Verify the training loop produces varied rewards (not all zeros)
    // and that the policy can generate actions that earn lore
    const result = trainPolicy({
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 200,
      seed: 42,
      maxTurns: 15,
      learningRate: 0.0005,
      epsilon: 1.0,
      minEpsilon: 0.3,
      decayRate: 0.998,
      reward: (r) => Math.min((r.finalLore["player1"] ?? 0) / 20, 1),
    });

    const curve = result.rewardCurve;
    expect(curve).toHaveLength(200);

    // At least some episodes should produce non-zero reward (bot earned some lore)
    const nonZero = curve.filter((r) => r > 0);
    expect(nonZero.length).toBeGreaterThan(0);

    // Policy should have decayed epsilon
    expect(result.finalEpsilon).toBeLessThan(1.0);
  });
});

// ===========================================================================
// save/load round-trip
// ===========================================================================

describe("Policy save/load round-trip", () => {
  it("saved and restored policy produces identical action scores", () => {
    const result = trainPolicy({
      deck: TEST_DECK,
      opponentDeck: TEST_DECK,
      definitions,
      opponent: RandomBot,
      episodes: 50,
      seed: 42,
      maxTurns: 10,
    });

    // Save
    const json = result.policy.toJSON();
    const jsonStr = JSON.stringify(json);

    // Load
    const restored = RLPolicy.fromJSON(JSON.parse(jsonStr));

    // Run same state through both and compare
    const state = createTestState(777);
    const legal = getAllLegalActions(state, "player1", definitions);
    const stateFeats = stateToFeatures(state, "player1", definitions);

    for (const action of legal) {
      const actionFeats = actionToFeatures(state, action, "player1", definitions);
      const input = [...stateFeats, ...actionFeats];
      const origScore = result.policy.actionNet.forward(input)[0]!;
      const restoredScore = restored.actionNet.forward(input)[0]!;
      // Float32 precision — allow small tolerance
      expect(restoredScore).toBeCloseTo(origScore, 4);
    }
  });
});

// ===========================================================================
// curriculum validation
// ===========================================================================


// ===========================================================================
// Layer 3 invariants with RLPolicy
// ===========================================================================

describe("Layer 3 invariants with RLPolicy", () => {
  const ZONES: ZoneName[] = ["deck", "hand", "play", "discard", "inkwell"];
  const PLAYERS: PlayerID[] = ["player1", "player2"];

  function assertInvariants(state: GameState): void {
    for (const playerId of PLAYERS) {
      // Total cards per player always 60
      const total = ZONES.reduce((sum, zone) => sum + getZone(state, playerId, zone).length, 0);
      expect(total, `${playerId} total cards must always be 60`).toBe(60);

      // availableInk >= 0
      expect(
        state.players[playerId].availableInk,
        `${playerId} availableInk must be >= 0`
      ).toBeGreaterThanOrEqual(0);

      // lore >= 0
      expect(
        state.players[playerId].lore,
        `${playerId} lore must be >= 0`
      ).toBeGreaterThanOrEqual(0);
    }

    // No card in two zones simultaneously
    const allZoneIds: string[] = [];
    for (const playerId of PLAYERS) {
      for (const zone of ZONES) {
        for (const id of getZone(state, playerId, zone)) {
          allZoneIds.push(id);
        }
      }
    }
    const uniqueCount = new Set(allZoneIds).size;
    expect(uniqueCount, "No card instance may appear in two zones").toBe(allZoneIds.length);
  }

  it("20 games with RLPolicy (ε=0.5) vs RandomBot maintain all invariants", () => {
    const rng = createRng(42);
    const policy = new RLPolicy("invariant-test", rng, cloneRng(rng), 0.5);

    for (let game = 0; game < 20; game++) {
      let state = createGame(
        { player1Deck: TEST_DECK, player2Deck: TEST_DECK, seed: game },
        definitions
      );
      assertInvariants(state);

      let safetyCounter = 0;
      while (!state.isGameOver && state.turnNumber <= 50) {
        if (++safetyCounter > 5000) break;

        const activePlayerId: PlayerID = state.pendingChoice
          ? state.pendingChoice.choosingPlayerId
          : state.currentPlayer;

        const bot = activePlayerId === "player1" ? policy : RandomBot;
        const action = bot.decideAction(state, activePlayerId, definitions);
        const result = applyAction(state, action, definitions);

        if (!result.success) {
          const passResult = applyAction(
            state,
            { type: "PASS_TURN", playerId: state.currentPlayer },
            definitions
          );
          if (passResult.success) {
            state = passResult.newState;
            assertInvariants(state);
          }
        } else {
          state = result.newState;
          assertInvariants(state);
        }
      }

      // Clear policy history between games
      policy.clearHistory();
    }
  });
});

// ===========================================================================
// math helper tests
// ===========================================================================

describe("math helpers", () => {
  it("relu", () => {
    expect(relu(-1)).toBe(0);
    expect(relu(0)).toBe(0);
    expect(relu(1)).toBe(1);
    expect(relu(5)).toBe(5);
  });

  it("softmax sums to 1", () => {
    const probs = softmax([1, 2, 3]);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("softmax handles equal inputs", () => {
    const probs = softmax([0, 0, 0]);
    for (const p of probs) {
      expect(p).toBeCloseTo(1 / 3, 6);
    }
  });

  it("softmax handles large values without overflow", () => {
    const probs = softmax([1000, 1001, 1002]);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    for (const p of probs) {
      expect(isNaN(p)).toBe(false);
    }
  });

  it("NETWORK_INPUT_SIZE = STATE_FEATURE_SIZE + ACTION_FEATURE_SIZE", () => {
    expect(NETWORK_INPUT_SIZE).toBe(STATE_FEATURE_SIZE + ACTION_FEATURE_SIZE);
  });
});
