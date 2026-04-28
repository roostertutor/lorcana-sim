// =============================================================================
// LAYER 5 — BOT INTELLIGENCE TESTS
// 5a: Correctness floor (smart choices produce better outcomes than random)
// 5b: Personality & mulligan (weight presets, mulligan logic, mirror balance)
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  createRng,
  cloneRng,
  getZone,
  generateId,
  CARD_DEFINITIONS,
} from "@lorcana-sim/engine";
import type { CardInstance, GameState, PlayerID } from "@lorcana-sim/engine";
import { GreedyBot } from "./bots/GreedyBot.js";
import { RandomBot } from "./bots/RandomBot.js";
import { resolveChoiceIntelligently } from "./bots/choiceResolver.js";
import { shouldMulligan, performMulligan, DEFAULT_MULLIGAN } from "./mulligan.js";
import { runGame, deriveMulliganed } from "./runGame.js";
import { RLPolicy } from "./rl/policy.js";
import type { SimGameConfig } from "./types.js";
import type { GameAction } from "@lorcana-sim/engine";

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const defs = CARD_DEFINITIONS;

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
    cardsUnder: [],
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
    state = { ...state, currentPlayer: "player1", phase: "main", pendingChoice: null };

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

    state = { ...state, currentPlayer: "player1", phase: "main", pendingChoice: null };

    const action = GreedyBot.decideAction(state, "player1", defs);

    // GreedyBot shouldn't challenge — simba (str 2) can't kill stitch (wp 5)
    // It should quest or do something else instead
    expect(action.type).not.toBe("CHALLENGE");
  });

  it("satisfies Reckless obligation with a non-lethal challenge (CRD 8.7.3)", () => {
    // Repro for the solo-sandbox bug: John Silver - Alien Pirate grants Reckless
    // to an opponent character. On the bot's turn, that character is ready and
    // has a valid (non-lethal) challenge target. PASS_TURN is illegal (validator
    // blocks it), and the old bot would fall through to PASS_TURN anyway — now
    // it must pick the least-bad challenge.
    let state = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      defs
    );

    // Drain player1's hand + ink so no play/ink action distracts the bot.
    state = {
      ...state,
      zones: { ...state.zones, player1: { ...state.zones.player1, hand: [] } },
      players: {
        ...state.players,
        player1: { ...state.players.player1, availableInk: 0 },
      },
    };

    // Bot's Reckless character: simba (str 2, wp 3) — can't lethal anything wp > 2.
    const { state: s2, instanceId: recklessId } = injectCard(
      state, "player1", "simba-protective-cub", "play",
      { isDrying: false, isExerted: false, grantedKeywords: ["reckless"] }
    );
    state = s2;

    // Opponent's defender: stitch-rock-star (str 3, wp 5), exerted — survives
    // the 2 strength hit but will kill simba. findBestChallenge correctly skips
    // this (non-lethal), the fallback must still take it.
    const { state: s3, instanceId: defenderId } = injectCard(
      state, "player2", "stitch-rock-star", "play",
      { isDrying: false, isExerted: true }
    );
    state = s3;

    state = { ...state, currentPlayer: "player1", phase: "main", pendingChoice: null };

    const action = GreedyBot.decideAction(state, "player1", defs);

    expect(action.type).toBe("CHALLENGE");
    if (action.type === "CHALLENGE") {
      expect(action.attackerInstanceId).toBe(recklessId);
      expect(action.defenderInstanceId).toBe(defenderId);
    }
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

  it("multi-pick choose_from_revealed: all bots return correct array length", () => {
    // Regression for HANDOFF "Simulator multi-pick enumerator bug" — all three
    // bots used to emit single-pick candidates for choose_from_revealed,
    // underfilling Dig a Little Deeper / Look at This Family (maxToHand=2).
    // Builds a PendingChoice that mirrors what look_at_top creates: 7 valid
    // targets, maxToHand=2, mandatory (isOptional=false). The engine reads the
    // bot's `choice` array verbatim and routes that many cards to hand — a
    // length-1 response silently leaves 1 card on the deck instead of 2.
    let state = createGame({ player1Deck: TEST_DECK, player2Deck: TEST_DECK }, defs);

    // 7 cards in player1's deck to act as the "revealed" set.
    const revealedIds: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = injectCard(state, "player1", "simba-protective-cub", "deck");
      state = r.state;
      revealedIds.push(r.instanceId);
    }

    state = {
      ...state,
      currentPlayer: "player1",
      phase: "main",
      pendingChoice: {
        type: "choose_from_revealed",
        choosingPlayerId: "player1",
        prompt: "Choose 2 cards to put into your hand.",
        validTargets: revealedIds,
        revealedCards: revealedIds,
        pendingEffect: {
          type: "look_at_top",
          count: 7,
          action: "choose_from_top",
          maxToHand: 2,
          target: { type: "self" },
        } as any,
        optional: false,
      },
    };

    // GreedyBot: greedy top-K of size 2.
    const greedyAction = GreedyBot.decideAction(state, "player1", defs);
    expect(greedyAction.type).toBe("RESOLVE_CHOICE");
    if (greedyAction.type === "RESOLVE_CHOICE" && Array.isArray(greedyAction.choice)) {
      expect(greedyAction.choice.length).toBe(2);
      // All picks must be from the valid targets (no synthetic IDs).
      for (const id of greedyAction.choice) expect(revealedIds).toContain(id);
    }

    // RandomBot: random subset of size 2.
    const randomAction = RandomBot.decideAction(state, "player1", defs);
    expect(randomAction.type).toBe("RESOLVE_CHOICE");
    if (randomAction.type === "RESOLVE_CHOICE" && Array.isArray(randomAction.choice)) {
      expect(randomAction.choice.length).toBe(2);
      for (const id of randomAction.choice) expect(revealedIds).toContain(id);
      // No duplicates.
      expect(new Set(randomAction.choice).size).toBe(2);
    }

    // RLPolicy: enumerated combinations + scored. We don't care WHICH it picks
    // (untrained net), just that it picks the right COUNT.
    const rng = createRng(42);
    const policy = new RLPolicy("test-multi-pick", rng, cloneRng(rng), 0.0);
    const rlAction = policy.decideAction(state, "player1", defs);
    expect(rlAction.type).toBe("RESOLVE_CHOICE");
    if (rlAction.type === "RESOLVE_CHOICE" && Array.isArray(rlAction.choice)) {
      expect(rlAction.choice.length).toBe(2);
      for (const id of rlAction.choice) expect(revealedIds).toContain(id);
    }
  });

  it("multi-pick choose_from_revealed clamps to validTargets when short", () => {
    // CRD 1.7.x "as much as possible" — if only 1 card is revealed but
    // maxToHand=2, the bot must return [the_one_card], not 2 IDs.
    let state = createGame({ player1Deck: TEST_DECK, player2Deck: TEST_DECK }, defs);
    const r = injectCard(state, "player1", "simba-protective-cub", "deck");
    state = r.state;
    const onlyCard = r.instanceId;

    state = {
      ...state,
      currentPlayer: "player1",
      phase: "main",
      pendingChoice: {
        type: "choose_from_revealed",
        choosingPlayerId: "player1",
        prompt: "Choose up to 2.",
        validTargets: [onlyCard],
        revealedCards: [onlyCard],
        pendingEffect: {
          type: "look_at_top",
          count: 7,
          action: "choose_from_top",
          maxToHand: 2,
          target: { type: "self" },
        } as any,
        optional: false,
      },
    };

    const greedy = GreedyBot.decideAction(state, "player1", defs);
    if (greedy.type === "RESOLVE_CHOICE" && Array.isArray(greedy.choice)) {
      expect(greedy.choice.length).toBe(1);
      expect(greedy.choice[0]).toBe(onlyCard);
    }

    const random = RandomBot.decideAction(state, "player1", defs);
    if (random.type === "RESOLVE_CHOICE" && Array.isArray(random.choice)) {
      expect(random.choice.length).toBe(1);
      expect(random.choice[0]).toBe(onlyCard);
    }

    const rng = createRng(7);
    const policy = new RLPolicy("test-clamp", rng, cloneRng(rng), 0.0);
    const rl = policy.decideAction(state, "player1", defs);
    if (rl.type === "RESOLVE_CHOICE" && Array.isArray(rl.choice)) {
      expect(rl.choice.length).toBe(1);
      expect(rl.choice[0]).toBe(onlyCard);
    }
  });

  it("optional multi-pick (isMay) lets RandomBot return 0..maxToHand", () => {
    // The Family Madrigal-style isMay=true: legal pick range is [0, maxSize].
    // Run RandomBot many times on the same input and confirm it produces sizes
    // across the full legal range, never out of bounds.
    let state = createGame({ player1Deck: TEST_DECK, player2Deck: TEST_DECK }, defs);
    const targets: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = injectCard(state, "player1", "simba-protective-cub", "deck");
      state = r.state;
      targets.push(r.instanceId);
    }
    state = {
      ...state,
      pendingChoice: {
        type: "choose_from_revealed",
        choosingPlayerId: "player1",
        prompt: "May choose up to 2.",
        validTargets: targets,
        revealedCards: targets,
        pendingEffect: {
          type: "look_at_top",
          count: 5,
          action: "choose_from_top",
          maxToHand: 2,
          isMay: true,
          target: { type: "self" },
        } as any,
        optional: true,
      },
    };

    const observedSizes = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const action = RandomBot.decideAction(state, "player1", defs);
      if (action.type === "RESOLVE_CHOICE" && Array.isArray(action.choice)) {
        observedSizes.add(action.choice.length);
        // Always within legal bounds.
        expect(action.choice.length).toBeGreaterThanOrEqual(0);
        expect(action.choice.length).toBeLessThanOrEqual(2);
      }
    }
    // Over 60 rolls we should hit at least 2 of the 3 legal sizes (0, 1, 2).
    // Probability of a specific size NOT appearing in 60 trials ≈ (2/3)^60
    // which is negligible — flake risk is ~0.
    expect(observedSizes.size).toBeGreaterThanOrEqual(2);
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

// ---------------------------------------------------------------------------
// MULLIGAN DERIVATION (P1.7 regression)
// Pins the contract that `mulliganed` is derived from `actions[]` (canonical
// structured data), not from log prose substring matches. See docs/STREAMS.md.
// ---------------------------------------------------------------------------

describe("deriveMulliganed (from actions[])", () => {
  it("player1 mulligans (non-empty array), player2 keeps (empty array)", () => {
    const actions: GameAction[] = [
      // First RESOLVE_CHOICE is choose_play_order (string), not a mulligan.
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      // Then mulligans (arrays), in starting-player-first order.
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: ["card-1", "card-2"] },
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
      // In-game noise after.
      { type: "PLAY_INK", playerId: "player1", instanceId: "x" },
      { type: "PASS_TURN", playerId: "player1" },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: true, player2: false });
  });

  it("both players keep (empty arrays)", () => {
    const actions: GameAction[] = [
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] },
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: false, player2: false });
  });

  it("both players mulligan", () => {
    const actions: GameAction[] = [
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: ["a"] },
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: ["b", "c", "d"] },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: true, player2: true });
  });

  it("no mulligan actions at all (e.g. startingState bypass) → both false", () => {
    const actions: GameAction[] = [
      { type: "PLAY_INK", playerId: "player1", instanceId: "x" },
      { type: "PASS_TURN", playerId: "player1" },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: false, player2: false });
  });

  it("ignores non-RESOLVE_CHOICE actions and string-shaped RESOLVE_CHOICE", () => {
    // Only the first ARRAY-shaped RESOLVE_CHOICE per player counts; play-order
    // (string "first") and trigger choices (string indices) must not interfere.
    const actions: GameAction[] = [
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: "second" },
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: ["x"] },
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: true, player2: false });
  });

  it("ignores subsequent in-game array choices (only FIRST array per player)", () => {
    // After the mulligan, in-game choose_target / choose_cards prompts also
    // resolve as array-shaped RESOLVE_CHOICE. They must NOT clobber the
    // mulligan result — only the first array per player is the mulligan.
    const actions: GameAction[] = [
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] }, // kept hand
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: ["mull"] }, // mulled
      { type: "PASS_TURN", playerId: "player1" },
      // Later in the game player1 resolves an array-shaped target choice.
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: ["target-id"] },
      // And another for player2.
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
    ];
    expect(deriveMulliganed(actions)).toEqual({ player1: false, player2: true });
  });

  it("end-to-end: result.mulliganed is consistent with result.actions[]", () => {
    // Run a real game and assert the derived field matches what we'd compute
    // from the canonical action stream. Catches future drift if the derivation
    // diverges from the action stream.
    const result = runGame({
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: GreedyBot,
      player2Strategy: GreedyBot,
      definitions: defs,
      maxTurns: 50,
      seed: 42,
    });
    expect(result.mulliganed).toEqual(deriveMulliganed(result.actions));
  });
});
