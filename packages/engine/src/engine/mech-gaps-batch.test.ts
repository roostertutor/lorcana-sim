// =============================================================================
// Tests for the mechanic-gaps batch:
//   - event-tracking-condition (Devil's Eye Diamond, Brutus, Nathaniel Flint, Chief, Thunderquack)
//   - conditional-cant-be-challenged (Iago Out of Reach, Nick Wilde, Kenai)
//   - restrict-sing (Ulf - Mime, Gantu)
//   - opponent-chosen-banish (Be King Undisputed already has a set4 test)
//   - shift-variant (Turbo, Thunderbolt classification shift)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";
import { getInstance, getZone } from "../utils/index.js";

describe("Mechanic gaps batch — event-tracking-condition", () => {
  it("Devil's Eye Diamond: activated ability gains 1 lore only if a friendly char was damaged this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let diamondId: string, charId: string;
    ({ state, instanceId: diamondId } = injectCard(state, "player1", "devils-eye-diamond", "play", { isDrying: false }));
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // No damage yet — activation should fail or not gain lore.
    expect(state.players.player1.lore).toBe(0);
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: diamondId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    // Whether or not the activate succeeds, the lore must not have moved (no damaged char yet).
    expect(r.newState.players.player1.lore).toBe(0);

    // Now damage the friendly char and re-activate (need to ready the diamond).
    state = { ...state, cards: { ...state.cards, [charId]: { ...state.cards[charId], damage: 1 } }, players: { ...state.players, player1: { ...state.players.player1, aCharacterWasDamagedThisTurn: true } } };
    r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: diamondId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.lore).toBe(1);
  });

  it("Nathaniel Flint - Notorious Pirate: playRestrictions blocks play unless an opposing char was damaged this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let nathanielId: string;
    ({ state, instanceId: nathanielId } = injectCard(state, "player1", "nathaniel-flint-notorious-pirate", "hand"));
    // Without flag — should fail
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: nathanielId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    // Set the flag (opposing char damaged this turn)
    state = { ...state, players: { ...state.players, player2: { ...state.players.player2, aCharacterWasDamagedThisTurn: true } } };
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: nathanielId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });
});

describe("Mechanic gaps batch — conditional-cant-be-challenged", () => {
  it("Iago - Out of Reach: can't be challenged while another exerted character is in play", async () => {
    let state = startGame();
    let iagoId: string, otherId: string, attackerId: string;
    ({ state, instanceId: iagoId } = injectCard(state, "player1", "iago-out-of-reach", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    state = { ...state, currentPlayer: "player2" };

    // Challenge while another exerted char in play — should fail
    let r = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attackerId, defenderInstanceId: iagoId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // Ready the other character (no longer exerted) → static no longer applies → Iago is now challengeable
    state = { ...state, cards: { ...state.cards, [otherId]: { ...state.cards[otherId], isExerted: false } } };
    // Sanity-check the static is gone via the modifier map
    const { getGameModifiers } = await import("./gameModifiers.js");
    const mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(mods.cantBeChallenged.has(iagoId)).toBe(false);
  });
});

describe("Mechanic gaps batch — restrict-sing", () => {
  it("Ulf - Mime: cannot exert to sing songs (cant_action_self with action='sing')", () => {
    let state = startGame();
    let ulfId: string, songId: string;
    ({ state, instanceId: ulfId } = injectCard(state, "player1", "ulf-mime", "play", { isDrying: false }));
    // Inject any song with cost <= ulf's cost
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: ulfId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't sing/i);
  });
});

describe("Mechanic gaps batch — shift-variant", () => {
  it("Turbo - Royal Hack has King Candy as an additionalName so Shift can target King Candy", () => {
    const def = LORCAST_CARD_DEFINITIONS["turbo-royal-hack"]!;
    expect(def).toBeDefined();
    expect(def.additionalNames).toContain("King Candy");
  });

  it("Thunderbolt - Wonder Dog: Puppy Shift surfaces as a classification_shift_self static in hand", () => {
    const def = LORCAST_CARD_DEFINITIONS["thunderbolt-wonder-dog"]!;
    expect(def).toBeDefined();
    const cs = def.abilities?.find((a: any) => a.type === "static" && a.effect?.type === "classification_shift_self") as any;
    expect(cs).toBeDefined();
    expect(cs.effect.trait).toBe("Puppy");
  });
});
