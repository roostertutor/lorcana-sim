// =============================================================================
// SET 7 — Donald Duck - Flustered Sorcerer (modify_win_threshold) + Set 8 Arthur
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  setLore,
  passTurns,
} from "./test-helpers.js";
import { applyAction, getLoreThreshold, checkWinConditions } from "./reducer.js";
import { getZone, getInstance } from "../utils/index.js";

describe("§7 Set 7 — Donald Duck Flustered Sorcerer (modify_win_threshold)", () => {
  it("Donald Duck Flustered Sorcerer: opponent's threshold becomes 25, controller's stays at 20", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "donald-duck-flustered-sorcerer", "play", { isDrying: false }));

    expect(getLoreThreshold(state, LORCAST_CARD_DEFINITIONS, "player1")).toBe(20);
    expect(getLoreThreshold(state, LORCAST_CARD_DEFINITIONS, "player2")).toBe(25);

    // player2 with 24 lore is NOT a winner; player1 with 20 IS.
    state = setLore(state, "player1", 20);
    state = setLore(state, "player2", 24);
    const r = checkWinConditions(state, LORCAST_CARD_DEFINITIONS);
    expect(r.isOver).toBe(true);
    expect(r.winner).toBe("player1");
  });

  it("Donald Duck: when only opponent has high lore but threshold is raised, no win yet", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "donald-duck-flustered-sorcerer", "play", { isDrying: false }));
    state = setLore(state, "player2", 24);

    const r = checkWinConditions(state, LORCAST_CARD_DEFINITIONS);
    expect(r.isOver).toBe(false);
  });
});

describe("§8 Set 8 — Arthur Determined Squire (skip_draw_step_self)", () => {
  it("Arthur skips player1's draw step at turn start", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "arthur-determined-squire", "play", { isDrying: false }));

    const handBefore = getZone(state, "player1", "hand").length;
    // Pass to opponent → pass back to player1. On player1's turn start, the draw step is skipped.
    state = passTurns(state, 2);
    const handAfter = getZone(state, "player1", "hand").length;
    // No card drawn at the start of player1's second turn → hand size unchanged.
    expect(handAfter).toBe(handBefore);
  });

  it("Without Arthur, player1 draws normally on turn start", () => {
    let state = startGame();
    const handBefore = getZone(state, "player1", "hand").length;
    state = passTurns(state, 2);
    const handAfter = getZone(state, "player1", "hand").length;
    expect(handAfter).toBe(handBefore + 1);
  });
});

describe("§7 Set 7 — Mill (MillEffect)", () => {
  it("Mad Hatter's Teapot — activate to mill 1 from each opponent", () => {
    let state = startGame();
    let teapot: string;
    ({ state, instanceId: teapot } = injectCard(state, "player1", "mad-hatters-teapot", "play", { isDrying: false }));
    // Give player1 ink for the activation cost.
    state = { ...state, players: { ...state.players, player1: { ...state.players.player1, availableInk: 5 } } };
    const deckBefore = getZone(state, "player2", "deck").length;
    const discardBefore = getZone(state, "player2", "discard").length;
    const r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: teapot,
      abilityIndex: 0,
    } as any, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player2", "deck").length).toBe(deckBefore - 1);
    expect(getZone(r.newState, "player2", "discard").length).toBe(discardBefore + 1);
  });
});

describe("§7 Set 7 — Baloo Ol' Iron Paws (damage_immunity_static source=all)", () => {
  it("a strong defender (≥7 STR) takes no challenge damage from an attacker", () => {
    // Baloo Ol' Iron Paws: "Your characters with 7 {S} or more can't be
    // dealt damage." Use Baloo himself as the 7+ STR character (verify his
    // printed STR ≥ 7). Opponent challenges with a ready attacker.
    let state = startGame();
    let baloo: string, attackerId: string;
    // Baloo's printed STR is 5; bump via tempStrengthModifier to trip the
    // ≥7 filter on his own static, mimicking a temporary buff.
    ({ state, instanceId: baloo } = injectCard(state, "player1", "baloo-ol-iron-paws", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    // Pass to player2's turn so they can challenge. Then bump Baloo to STR 7
    // directly via TimedEffect — after turn boundary clears timed effects, re-apply.
    state = passTurns(state, 1);
    const balooInst = getInstance(state, baloo);
    state = { ...state, cards: { ...state.cards, [baloo]: { ...balooInst, timedEffects: [...balooInst.timedEffects, { type: "modify_strength" as any, amount: 2, expiresAt: "end_of_turn" as any, appliedOnTurn: state.turnNumber }] } } };

    const r = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player2",
      attackerInstanceId: attackerId,
      defenderInstanceId: baloo,
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Baloo took 0 damage (attacker STR 3 would have dealt 3).
    expect(getInstance(r.newState, baloo).damage).toBe(0);
  });

});
