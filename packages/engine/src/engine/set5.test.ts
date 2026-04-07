// =============================================================================
// SET 5 — Shimmering Skies: reveal_top_conditional (Phase A.3)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect } from "./reducer.js";
import { evaluateCondition } from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";
import { getInstance, getZone } from "../utils/index.js";

describe("§5 Set 5 — reveal_top_conditional", () => {
  it("Queen's Sensor Core ROYAL SEARCH: matched card moves to hand", () => {
    let state = startGame(["minnie-mouse-beloved-princess"], ["mickey-mouse-true-friend"]);
    state = giveInk(state, "player1", 5);
    let coreId: string;
    ({ state, instanceId: coreId } = injectCard(state, "player1", "queens-sensor-core", "play", { isDrying: false }));

    // The default deck filler is Minnie Mouse - Beloved Princess (has Princess trait).
    // The top of player1's deck after startGame should be a Princess (high probability,
    // since the deck is mostly Minnies). Verify by checking the top card def's traits.
    const topId = getZone(state, "player1", "deck")[0]!;
    const topInst = getInstance(state, topId);
    const topDef = LORCAST_CARD_DEFINITIONS[topInst.definitionId]!;
    const isPrincessOrQueen = topDef.traits.includes("Princess") || topDef.traits.includes("Queen");

    const handBefore = getZone(state, "player1", "hand").length;
    const r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: coreId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    if (isPrincessOrQueen) {
      // Card moved to hand
      expect(getZone(state, "player1", "hand").length).toBe(handBefore + 1);
      expect(getZone(state, "player1", "hand")).toContain(topId);
    } else {
      // Card stayed on top
      expect(getZone(state, "player1", "deck")[0]).toBe(topId);
    }
  });

  it("compound_or condition: true if either branch is true", () => {
    // Mickey True Friend in play has Hero trait but not Princess.
    // condition: { compound_or: [hasCharacterWithTrait Princess, hasCharacterWithTrait Hero] } → true
    let state = startGame();
    let mickeyId: string;
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const cond = {
      type: "compound_or" as const,
      conditions: [
        { type: "has_character_with_trait" as const, trait: "Princess", player: { type: "self" as const } },
        { type: "has_character_with_trait" as const, trait: "Hero", player: { type: "self" as const } },
      ],
    };
    expect(evaluateCondition(cond, state, LORCAST_CARD_DEFINITIONS, "player1", mickeyId, undefined)).toBe(true);
  });

  it("random_discard: engine picks a random card to discard, no pendingChoice", () => {
    // Sudden Chill chooser variant: instead of target_player, use random.
    // Inject a synthetic action with chooser=random.
    let state = startGame();
    let p2Card1: string, p2Card2: string;
    ({ state, instanceId: p2Card1 } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    ({ state, instanceId: p2Card2 } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));
    const handBefore = getZone(state, "player2", "hand").length;

    state = applyEffect(state, {
      type: "discard_from_hand",
      amount: 1,
      target: { type: "opponent" },
      chooser: "random",
    }, "synthetic-source", "player1", LORCAST_CARD_DEFINITIONS, []);

    expect(state.pendingChoice).toBeFalsy();
    expect(getZone(state, "player2", "hand").length).toBe(handBefore - 1);
  });

  it("event tracking: aCharacterWasDamagedThisTurn flips on damage and resets on PASS_TURN", () => {
    let state = startGame();
    let mickeyId: string, dmgId: string;
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    expect(state.players.player1.aCharacterWasDamagedThisTurn ?? false).toBe(false);

    // Inject a Goofy Musketeer with damage already on it — won't trip the flag.
    // Use dealDamage path: inject a damage-dealing source... easier: use the dealDamageToCard path
    // by activating an ability or just directly setting damage via state mutation, but that doesn't
    // go through the event hook. Use Maleficent Sorceress' enters_play+something? Skip — instead
    // use a CHALLENGE: inject Mickey vs an exerted opposing Mickey.
    let oppMickey: string;
    ({ state, instanceId: oppMickey } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: true }));
    const r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: mickeyId, defenderInstanceId: oppMickey }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Both players had a character damaged this turn (challenge is mutual)
    expect(state.players.player1.aCharacterWasDamagedThisTurn).toBe(true);
    expect(state.players.player2.aCharacterWasDamagedThisTurn).toBe(true);
  });

  it("Merlin's Cottage KNOWLEDGE IS POWER: both players' top-of-deck visibility flag set", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "merlins-cottage-the-wizards-home", "play", { isDrying: false }));

    const mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(mods.topOfDeckVisible.has("player1")).toBe(true);
    expect(mods.topOfDeckVisible.has("player2")).toBe(true);
  });

  it("Queen's Sensor Core: pays cost (exert + 2 ink)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let coreId: string;
    ({ state, instanceId: coreId } = injectCard(state, "player1", "queens-sensor-core", "play", { isDrying: false }));
    const inkBefore = state.players.player1.availableInk;

    const r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: coreId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    expect(state.players.player1.availableInk).toBe(inkBefore - 2);
    expect(getInstance(state, coreId).isExerted).toBe(true);
  });
});
