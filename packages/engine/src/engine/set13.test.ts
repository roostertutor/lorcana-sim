// =============================================================================
// SET 13 — card-specific behavior tests
// Only unique patterns; shared mechanics are covered in reducer.test.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getAllLegalActions } from "./reducer.js";
import { getGameModifiers } from "./gameModifiers.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
  setLore,
} from "./test-helpers.js";
import { getInstance, getZone } from "../utils/index.js";

// Put a specific instance on the top of a player's deck (deck[0] == top).
function putOnTop(state: any, playerId: string, instanceId: string): any {
  const deck = getZone(state, playerId, "deck").filter((x: string) => x !== instanceId);
  return {
    ...state,
    zones: {
      ...state.zones,
      [playerId]: { ...state.zones[playerId], deck: [instanceId, ...deck] },
    },
  };
}

describe("Set 13 — Absorbing Bloom METAMORPHOSIS", () => {
  it("draws when a character was banished in a challenge this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let bloom: string;
    ({ state, instanceId: bloom } = injectCard(state, "player1", "absorbing-bloom", "play"));
    state = {
      ...state,
      players: {
        ...state.players,
        player1: { ...state.players.player1, aCharacterWasBanishedInChallengeThisTurn: true },
      },
    };
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: bloom, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand").length).toBe(before + 1);
  });

  it("does not draw when no character was banished in a challenge (but still activates)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let bloom: string;
    ({ state, instanceId: bloom } = injectCard(state, "player1", "absorbing-bloom", "play"));
    const before = getZone(state, "player1", "hand").length;
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: bloom, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand").length).toBe(before);
    expect(getInstance(r.newState, bloom).isExerted).toBe(true);
  });
});

describe("Set 13 — My Adventure Book NEW MEMORIES", () => {
  it("puts a revealed non-character card into hand", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let book: string, top: string;
    ({ state, instanceId: book } = injectCard(state, "player1", "my-adventure-book", "play"));
    ({ state, instanceId: top } = injectCard(state, "player1", "absorbing-bloom", "deck")); // item = non-character
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: book, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand")).toContain(top);
  });

  it("puts a revealed non-Kevin character on the bottom of the deck", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    let book: string, top: string;
    ({ state, instanceId: book } = injectCard(state, "player1", "my-adventure-book", "play"));
    ({ state, instanceId: top } = injectCard(state, "player1", "mushu-stealthy-dragon", "deck")); // character, not Kevin
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: book, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "hand")).not.toContain(top);
    const deck = getZone(r.newState, "player1", "deck");
    expect(deck[deck.length - 1]).toBe(top);
  });
});

describe("Set 13 — Randall Boggs AFTER-HOURS PROJECT", () => {
  it("gets +2 lore while all cards in your inkwell are exerted", () => {
    let state = startGame();
    let randall: string, ink: string;
    ({ state, instanceId: randall } = injectCard(state, "player1", "randall-boggs-envious-coworker", "play"));
    ({ state, instanceId: ink } = injectCard(state, "player1", "mickey-mouse-true-friend", "inkwell", { isExerted: true }));
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(randall)?.lore ?? 0).toBe(2);

    // Ready the inkwell card → condition false → no bonus.
    state = { ...state, cards: { ...state.cards, [ink]: { ...getInstance(state, ink), isExerted: false } } };
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(randall)?.lore ?? 0).toBe(0);
  });
});

describe("Set 13 — Mushu Stealthy Dragon TIP THE SCALES", () => {
  it("may draw on quest when an opponent has more cards in hand", () => {
    let state = startGame();
    let mushu: string;
    ({ state, instanceId: mushu } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    // Give player2 more cards than player1.
    for (let i = 0; i < 6; i++) ({ state } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: mushu }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    const before = getZone(r.newState, "player1", "hand").length;
    const accept = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(getZone(accept.newState, "player1", "hand").length).toBe(before + 1);
  });

  it("does not offer a draw when the opponent does not have more cards", () => {
    let state = startGame();
    let mushu: string;
    ({ state, instanceId: mushu } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false }));
    // player1 already has an opening hand ≥ player2; no extra cards for p2.
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: mushu }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice).toBeNull();
  });
});

describe("Set 13 — Mirabel Madrigal MIRACULOUS PROTECTION", () => {
  it("may ready the healed character, then it can't quest or challenge", () => {
    let state = startGame();
    let mirabel: string, ally: string;
    ({ state, instanceId: mirabel } = injectCard(state, "player1", "mirabel-madrigal-family-guardian", "play"));
    ({ state, instanceId: ally } = injectCard(state, "player1", "mushu-stealthy-dragon", "play", { isDrying: false, isExerted: true, damage: 3 }));

    state = applyEffect(
      state,
      { type: "remove_damage", amount: 3, target: { type: "chosen", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"], hasDamage: true } } } as any,
      "synthetic", "player1", CARD_DEFINITIONS, [],
    );
    // resolve the remove_damage target choice if surfaced
    if (state.pendingChoice?.type === "choose_target") {
      state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [ally] }, CARD_DEFINITIONS).newState;
    }
    // Mirabel's may-ready prompt
    expect(state.pendingChoice?.type).toBe("choose_may");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS).newState;
    expect(getInstance(state, ally).isExerted).toBe(false); // readied

    // can't quest for the rest of the turn
    const q = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ally }, CARD_DEFINITIONS);
    expect(q.success).toBe(false);
    const legalHasQuest = getAllLegalActions(state, "player1", CARD_DEFINITIONS).some((a: any) => a.type === "QUEST" && a.instanceId === ally);
    expect(legalHasQuest).toBe(false);
  });
});

describe("Set 13 — Dash Parr Super Fast FOLLOW ME!", () => {
  it("offers to reveal the top card on quest", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let dash: string, top: string;
    ({ state, instanceId: dash } = injectCard(state, "player1", "dash-parr-super-fast", "play", { isDrying: false }));
    ({ state, instanceId: top } = injectCard(state, "player1", "mushu-stealthy-dragon", "deck"));
    state = putOnTop(state, "player1", top);
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: dash }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    // Decline reveal → top card stays on deck.
    const decline = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    expect(getZone(decline.newState, "player1", "deck")[0]).toBe(top);
  });
});
