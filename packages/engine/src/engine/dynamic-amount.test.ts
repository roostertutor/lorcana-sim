// =============================================================================
// DynamicAmount variants — target_lore / target_damage / target_strength /
// source_lore / source_strength + max cap.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect } from "./reducer.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
} from "./test-helpers.js";
import { getInstance } from "../utils/index.js";

describe("DynamicAmount variants", () => {
  it("target_damage: deal_damage amount equals damage on chosen target", () => {
    let state = startGame();
    // Opponent character with 3 damage already on it
    let victimId: string;
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false, damage: 3 }));
    let srcId: string;
    ({ state, instanceId: srcId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));

    // deal_damage to chosen opposing char, amount = damage on that target → 3
    state = applyEffect(state, {
      type: "deal_damage",
      amount: { type: "target_damage" },
      target: { type: "chosen", filter: { zone: "play", cardType: ["character"], owner: { type: "opponent" } } },
    } as any, srcId, "player1", CARD_DEFINITIONS, []);

    expect(state.pendingChoice?.type).toBe("choose_target");
    const r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Should now have 3 + 3 = 6 damage (Mickey True Friend has willpower 3 so would be banished)
    // Check that victim was banished because 3+3 >= 3 (willpower)
    const inst = r.newState.cards[victimId]!;
    expect(inst.zone).toBe("discard");
  });

  it("target_lore: gain_lore amount equals lore of chosen target (via conditional_on_target wrapper)", () => {
    let state = startGame();
    let targetId: string;
    // Minnie Beloved Princess has lore 2
    ({ state, instanceId: targetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));
    let srcId: string;
    ({ state, instanceId: srcId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const loreBefore = state.players.player1.lore;
    state = applyEffect(state, {
      type: "conditional_on_target",
      target: { type: "chosen", filter: { zone: "play", cardType: ["character"], owner: { type: "self" } } },
      conditionFilter: {}, // match-all
      ifMatchEffects: [
        { type: "gain_lore", amount: { type: "target_lore" }, target: { type: "self" } },
      ],
      defaultEffects: [],
    } as any, srcId, "player1", CARD_DEFINITIONS, []);

    expect(state.pendingChoice?.type).toBe("choose_target");
    const r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.lore).toBe(loreBefore + 1);
  });

  it("source_strength: deal_damage amount equals strength of source card", () => {
    let state = startGame();
    // Mickey True Friend has strength 3
    let srcId: string;
    ({ state, instanceId: srcId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    let victimId: string;
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    state = applyEffect(state, {
      type: "deal_damage",
      amount: { type: "source_strength" },
      target: { type: "chosen", filter: { zone: "play", cardType: ["character"], owner: { type: "opponent" } } },
    } as any, srcId, "player1", CARD_DEFINITIONS, []);

    const r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Victim had willpower 3, took 3 damage → banished
    expect(r.newState.cards[victimId]?.zone).toBe("discard");
  });

  it("source_lore with max cap: gain_lore amount = source lore, capped by max", () => {
    let state = startGame();
    // Minnie Beloved Princess has lore 1 — use max:0 to exercise the cap
    let srcId: string;
    ({ state, instanceId: srcId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));

    const loreBefore = state.players.player1.lore;
    state = applyEffect(state, {
      type: "gain_lore",
      amount: { type: "source_lore", max: 0 },
      target: { type: "self" },
    } as any, srcId, "player1", CARD_DEFINITIONS, []);
    // Capped to 0 — no lore gained
    expect(state.players.player1.lore).toBe(loreBefore);

    // Without cap — source lore 1 gained
    state = applyEffect(state, {
      type: "gain_lore",
      amount: { type: "source_lore" },
      target: { type: "self" },
    } as any, srcId, "player1", CARD_DEFINITIONS, []);
    expect(state.players.player1.lore).toBe(loreBefore + 1);
  });
});
