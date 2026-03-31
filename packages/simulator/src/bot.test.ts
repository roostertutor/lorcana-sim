// =============================================================================
// LAYER 5 — BOT INTELLIGENCE TESTS
// 5a: Correctness floor (smart choices produce better outcomes than random)
// 5b: Personality & mulligan (weight presets, mulligan logic, mirror balance)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  getZone,
  generateId,
  LORCAST_CARD_DEFINITIONS,
} from "@lorcana-sim/engine";
import type { CardInstance, GameState, PlayerID } from "@lorcana-sim/engine";
import { GreedyBot } from "./bots/GreedyBot.js";
import { resolveChoiceIntelligently } from "./bots/choiceResolver.js";
import { shouldMulligan, performMulligan, DEFAULT_MULLIGAN } from "./mulligan.js";
import { runGame } from "./runGame.js";
import type { SimGameConfig } from "./types.js";

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const defs = LORCAST_CARD_DEFINITIONS;

const TEST_DECK = [
  { definitionId: "simba-protective-cub", count: 10 },
  { definitionId: "stitch-rock-star", count: 10 },
  { definitionId: "beast-hardheaded", count: 10 },
  { definitionId: "moana-of-motunui", count: 10 },
  { definitionId: "hercules-true-hero", count: 10 },
  { definitionId: "tinker-bell-tiny-tactician", count: 10 },
];

function injectCard(
  state: GameState,
  playerId: PlayerID,
  definitionId: string,
  zone: "hand" | "play" | "deck" | "discard" | "inkwell",
  overrides: Partial<CardInstance> = {}
): { state: GameState; instanceId: string } {
  const instanceId = generateId();
  const instance: CardInstance = {
    instanceId,
    definitionId,
    ownerId: playerId,
    zone,
    isExerted: false,
    damage: 0,
    isDrying: false,
    tempStrengthModifier: 0,
    tempWillpowerModifier: 0,
    tempLoreModifier: 0,
    grantedKeywords: [],
    timedEffects: [],
    ...overrides,
  };

  const newState: GameState = {
    ...state,
    cards: { ...state.cards, [instanceId]: instance },
    zones: {
      ...state.zones,
      [playerId]: {
        ...state.zones[playerId],
        [zone]: [...state.zones[playerId][zone], instanceId],
      },
    },
  };

  return { state: newState, instanceId };
}

function giveInk(state: GameState, playerId: PlayerID, amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...state.players[playerId],
        availableInk: state.players[playerId].availableInk + amount,
      },
    },
  };
}

const TEST_WEIGHTS = {
  loreAdvantage: 0.6,
  boardAdvantage: 0.6,
  handAdvantage: 0.5,
  inkAdvantage: 0.5,
  deckQuality: 0.4,
  urgency: (state: GameState) => Math.pow(Math.max(state.players.player1.lore, state.players.player2.lore) / 20, 2),
  threatLevel: (_state: GameState) => 0.5,
};

// ---------------------------------------------------------------------------
// LAYER 5a — CORRECTNESS FLOOR
// ---------------------------------------------------------------------------

describe("Layer 5a — Bot correctness floor", () => {
  it("quests to win at 19 lore instead of challenging", () => {
    // Setup: player1 at 19 lore with a ready character that can quest for 1+
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Set lore to 19
    state = {
      ...state,
      players: {
        ...state.players,
        player1: { ...state.players.player1, lore: 19 },
      },
    };

    // Inject a ready character in play for player1 (simba: 1 lore)
    const { state: s2, instanceId: questerId } = injectCard(
      state, "player1", "simba-protective-cub", "play",
      { isDrying: false, isExerted: false }
    );
    state = s2;

    // Inject an exerted opponent character to make challenge available
    const { state: s3 } = injectCard(
      state, "player2", "hercules-true-hero", "play",
      { isDrying: false, isExerted: true }
    );
    state = s3;

    // Ensure it's player1's main phase
    state = { ...state, currentPlayer: "player1", phase: "main" };

    const action = GreedyBot.decideAction(state, "player1", defs);

    // GreedyBot should quest (reaches 20 lore = win) rather than challenge
    expect(action.type).toBe("QUEST");
  });

  it("does not make losing challenges (attacker dies, defender survives)", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Small attacker: simba (str 2, wp 3)
    const { state: s2 } = injectCard(
      state, "player1", "simba-protective-cub", "play",
      { isDrying: false, isExerted: false }
    );
    state = s2;

    // Big defender: stitch-rock-star (str 3, wp 5), exerted so it's challengeable
    const { state: s3 } = injectCard(
      state, "player2", "stitch-rock-star", "play",
      { isDrying: false, isExerted: true }
    );
    state = s3;

    state = { ...state, currentPlayer: "player1", phase: "main" };

    const action = GreedyBot.decideAction(state, "player1", defs);

    // GreedyBot shouldn't challenge — simba (str 2) can't kill stitch (wp 5)
    // It should quest or do something else instead
    expect(action.type).not.toBe("CHALLENGE");
  });

  it("choose_discard picks lowest-cost card from hand", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Inject cards with varying costs into hand
    const { state: s2, instanceId: cheapId } = injectCard(
      state, "player1", "simba-protective-cub", "hand" // cost 2
    );
    state = s2;
    const { state: s3, instanceId: midId } = injectCard(
      state, "player1", "hercules-true-hero", "hand" // cost 3
    );
    state = s3;
    const { state: s4, instanceId: expensiveId } = injectCard(
      state, "player1", "moana-of-motunui", "hand" // cost 5
    );
    state = s4;

    // Create a pending discard choice
    state = {
      ...state,
      pendingChoice: {
        type: "choose_discard",
        choosingPlayerId: "player1",
        prompt: "Choose a card to discard",
        validTargets: [cheapId, midId, expensiveId],
        count: 1,
        pendingEffect: { type: "discard_from_hand", amount: 1, target: { type: "self" }, chooser: "target_player" as const },
      },
    };

    const action = resolveChoiceIntelligently(state, "player1", defs, TEST_WEIGHTS);

    expect(action.type).toBe("RESOLVE_CHOICE");
    if (action.type === "RESOLVE_CHOICE") {
      // Should discard the cheapest card (simba, cost 2)
      expect(action.choice).toEqual([cheapId]);
    }
  });

  it("choose_target for damage targets opponent character near death", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Player1's own healthy character
    const { state: s2, instanceId: ownCharId } = injectCard(
      state, "player1", "simba-protective-cub", "play"
    );
    state = s2;

    // Opponent's character at 2 damage (wp 3) — 1 more damage banishes it
    const { state: s3, instanceId: oppCharId } = injectCard(
      state, "player2", "hercules-true-hero", "play",
      { damage: 2 }
    );
    state = s3;

    // Pending choice: deal 1 damage to chosen character (non-optional — must pick a target)
    state = {
      ...state,
      pendingChoice: {
        type: "choose_target",
        choosingPlayerId: "player1",
        prompt: "Choose a character to deal 1 damage to",
        validTargets: [ownCharId, oppCharId],
        pendingEffect: { type: "deal_damage", amount: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } },
      },
    };

    const action = resolveChoiceIntelligently(state, "player1", defs, TEST_WEIGHTS);

    expect(action.type).toBe("RESOLVE_CHOICE");
    if (action.type === "RESOLVE_CHOICE") {
      // Should target opponent's near-death character (banishes it, improves board)
      expect(action.choice).toEqual([oppCharId]);
    }
  });

  it("choose_target picks character closest to banish threshold", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Opponent char 1: hercules (wp 3, damage 2) — 1 from banish
    const { state: s2, instanceId: nearDeathId } = injectCard(
      state, "player2", "hercules-true-hero", "play",
      { damage: 2 }
    );
    state = s2;

    // Opponent char 2: simba (wp 3, damage 0) — 3 from banish
    const { state: s3, instanceId: healthyId } = injectCard(
      state, "player2", "simba-protective-cub", "play",
      { damage: 0 }
    );
    state = s3;

    // Pending choice: deal 1 damage
    state = {
      ...state,
      pendingChoice: {
        type: "choose_target",
        choosingPlayerId: "player1",
        prompt: "Deal 1 damage to chosen character",
        validTargets: [nearDeathId, healthyId],
        pendingEffect: { type: "deal_damage", amount: 1, target: { type: "chosen", filter: { zone: "play", cardType: ["character"] } } },
      },
    };

    const action = resolveChoiceIntelligently(state, "player1", defs, TEST_WEIGHTS);

    expect(action.type).toBe("RESOLVE_CHOICE");
    if (action.type === "RESOLVE_CHOICE") {
      // Should target the near-death character (1 damage banishes it)
      expect(action.choice).toEqual([nearDeathId]);
    }
  });
});

// ---------------------------------------------------------------------------
// LAYER 5b — PERSONALITY & MULLIGAN
// ---------------------------------------------------------------------------

describe("Layer 5b — Mulligan", () => {
  it("shouldMulligan returns true when 0 inkable cards in hand", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Clear player1's hand
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: { ...state.zones.player1, hand: [] },
      },
    };

    // Add non-inkable cards (need to find one... all test deck cards are inkable)
    // Use the default hand — but override by manipulating card instances
    // Instead, create a hand of cards and mark their definitions as non-inkable
    // Simpler: use a hand where no cards match the inkable criteria
    // Actually, all test deck cards ARE inkable. Let's test with an empty hand
    // which has 0 inkable (< 2), cheapest = Infinity (> 3), and no early play

    const result = shouldMulligan(state, "player1", defs);
    expect(result).toBe(true);
  });

  it("shouldMulligan returns false for a keepable hand", () => {
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Clear hand and inject a good opening hand
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: { ...state.zones.player1, hand: [] },
      },
    };

    // Inject 3 inkable, cheap cards
    let s = state;
    for (let i = 0; i < 3; i++) {
      const r = injectCard(s, "player1", "simba-protective-cub", "hand"); // cost 2, inkable
      s = r.state;
    }
    // Add some mid-cost cards
    for (let i = 0; i < 2; i++) {
      const r = injectCard(s, "player1", "hercules-true-hero", "hand"); // cost 3, inkable
      s = r.state;
    }

    const result = shouldMulligan(s, "player1", defs);
    expect(result).toBe(false);
  });

  it("performMulligan preserves hand size and deck size", () => {
    const state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    const handBefore = getZone(state, "player1", "hand").length;
    const deckBefore = getZone(state, "player1", "deck").length;
    const totalBefore = handBefore + deckBefore;

    const newState = performMulligan(state, "player1");

    const handAfter = getZone(newState, "player1", "hand").length;
    const deckAfter = getZone(newState, "player1", "deck").length;
    const totalAfter = handAfter + deckAfter;

    expect(handAfter).toBe(handBefore);
    expect(deckAfter).toBe(deckBefore);
    expect(totalAfter).toBe(totalBefore);
  });

  it("performMulligan maintains total = 60 card invariant", () => {
    const state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    const newState = performMulligan(state, "player1");

    const zones: Array<"deck" | "hand" | "play" | "discard" | "inkwell"> =
      ["deck", "hand", "play", "discard", "inkwell"];
    let total = 0;
    for (const zone of zones) {
      total += getZone(newState, "player1", zone).length;
    }
    expect(total).toBe(60);
  });
});

describe("Layer 5b — Personality & simulation", () => {
  it("mirror match win rates are roughly 50/50 (200 games)", () => {
    let p1Wins = 0;
    let p2Wins = 0;

    for (let i = 0; i < 200; i++) {
      const result = runGame({
        player1Deck: TEST_DECK,
        player2Deck: TEST_DECK,
        player1Strategy: GreedyBot,
        player2Strategy: GreedyBot,
        definitions: defs,
        maxTurns: 50,
      });
      if (result.winner === "player1") p1Wins++;
      else if (result.winner === "player2") p2Wins++;
    }

    const total = p1Wins + p2Wins;
    // At least 50% of games should produce a winner
    expect(total).toBeGreaterThan(100);
    // Each side should win between 25-75% (first-player advantage + mulligan variance)
    const p1Rate = p1Wins / total;
    expect(p1Rate).toBeGreaterThan(0.25);
    expect(p1Rate).toBeLessThan(0.75);
  });

  it("startingState injection bypasses createGame and mulligan", () => {
    // Create a custom starting state
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Set player1 lore to 19 — should win on first quest
    state = {
      ...state,
      players: {
        ...state.players,
        player1: { ...state.players.player1, lore: 19 },
      },
    };

    const result = runGame({
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: GreedyBot,
      player2Strategy: GreedyBot,
      definitions: defs,
      startingState: state,
      maxTurns: 50,
    });

    // Player1 starts at 19 lore and should win quickly
    expect(result.winner).toBe("player1");
    expect(result.winReason).toBe("lore_threshold");
  });
});
