// =============================================================================
// SET 4 — Ursula's Return: Sing Together (CRD 8.12)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect } from "./reducer.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  passTurns,
  giveInk,
} from "./test-helpers.js";
import { getInstance, getEffectiveStrength, getZone } from "../utils/index.js";

describe("§4 Set 4 — Sing Together", () => {
  it("a-pirate-s-life Sing Together 6: two characters with combined cost ≥ 6 may sing", () => {
    // a-pirate-s-life is Sing Together 6. Use two cost-3 characters (Mickey True Friend + Mickey True Friend).
    let state = startGame();
    let songId: string, singer1Id: string, singer2Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: singer2Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer2Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Both singers exerted, no ink paid.
    expect(getInstance(state, singer1Id).isExerted).toBe(true);
    expect(getInstance(state, singer2Id).isExerted).toBe(true);
  });

  it("Sing Together rejects when combined cost is below the requirement", () => {
    // a-pirate-s-life Sing Together 6, single Mickey (cost 3) is not enough.
    let state = startGame();
    let songId: string, singer1Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Sing Together rejects on a non-Sing-Together song", () => {
    // Reflection (cost 1) has no singTogetherCost — should reject.
    let state = startGame();
    let songId: string, singer1Id: string, singer2Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "reflection", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: singer2Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer2Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Cogsworth Majordomo: -2 strength persists across opponent's turn (end_of_owner_next_turn duration)", () => {
    let state = startGame();
    let cogId: string, victimId: string;
    ({ state, instanceId: cogId } = injectCard(state, "player1", "cogsworth-majordomo", "play", { isDrying: false }));
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Quest with Cogsworth — fires AS YOU WERE!
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: cogId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Trigger surfaces choose_may
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // choose_target for the chosen character
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey base strength = 3, after -2 = 1. Should be on the timed-effects path, not temp.
    const victim = getInstance(state, victimId);
    expect(victim.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(true);

    expect(getEffectiveStrength(victim, LORCAST_CARD_DEFINITIONS[victim.definitionId]!)).toBe(1);

    // Pass to opponent's turn — debuff should still be active.
    state = passTurns(state, 1);
    let v2 = getInstance(state, victimId);
    expect(v2.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(true);

    // Pass back to player1 — debuff expires at start of player1's next turn.
    state = passTurns(state, 1);
    let v3 = getInstance(state, victimId);
    expect(v3.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(false);
    expect(getEffectiveStrength(v3, LORCAST_CARD_DEFINITIONS[v3.definitionId]!)).toBe(3);
  });

  it("until_caster_next_turn: self-cast 'until your next turn' buffs persist through opponent's turn", () => {
    // Pre-fix bug: end_of_owner_next_turn expired self-cast effects at end of caster's
    // own turn (immediately, like this_turn), giving zero turns of effective uptime past
    // the cast turn. Verifies until_caster_next_turn correctly persists through opponent's
    // turn and expires at the start of the caster's next turn.
    let state = startGame();
    let p1Char: string;
    ({ state, instanceId: p1Char } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));

    state = applyEffect(state, {
      type: "gain_stats",
      strength: 2,
      target: { type: "all", filter: { owner: { type: "self" }, zone: "play", cardType: ["character"] } },
      duration: "until_caster_next_turn",
    }, "synthetic-source", "player1", LORCAST_CARD_DEFINITIONS, []);

    expect(getInstance(state, p1Char).timedEffects.some(te => te.type === "modify_strength" && te.amount === 2)).toBe(true);

    // Pass to opponent — buff persists (this is what the old end_of_owner_next_turn missed for self-cast).
    state = passTurns(state, 1);
    expect(getInstance(state, p1Char).timedEffects.some(te => te.type === "modify_strength" && te.amount === 2)).toBe(true);

    // Pass back to player1 — buff expires at start of player1's next turn.
    state = passTurns(state, 1);
    expect(getInstance(state, p1Char).timedEffects.some(te => te.type === "modify_strength" && te.amount === 2)).toBe(false);
  });

  it("Under the Sea: opposing characters with str ≤ 2 go to the bottom of opponent's deck, controller picks order", () => {
    let state = startGame();
    let songId: string, weakOpp1: string, weakOpp2: string, strongOpp: string, ownChar: string, singer1: string, singer2: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "under-the-sea", "hand"));
    // Singers with combined cost ≥ 8 (Under the Sea is Sing Together 8)
    ({ state, instanceId: singer1 } = injectCard(state, "player1", "elsa-spirit-of-winter", "play", { isDrying: false }));
    ({ state, instanceId: singer2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    // Two opposing weak chars (should be returned), one strong (stays), one own char (stays)
    ({ state, instanceId: weakOpp1 } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isDrying: false })); // str 2
    ({ state, instanceId: weakOpp2 } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isDrying: false })); // str 1
    ({ state, instanceId: strongOpp } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false })); // str 3
    ({ state, instanceId: ownChar } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));

    const p2DeckSizeBefore = getZone(state, "player2", "deck").length;

    let r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1, singer2],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Two matches → choose_order surfaces for player1
    expect(state.pendingChoice?.type).toBe("choose_order");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
    const validTargets = state.pendingChoice?.validTargets ?? [];
    expect(validTargets).toContain(weakOpp1);
    expect(validTargets).toContain(weakOpp2);
    expect(validTargets).not.toContain(strongOpp);
    expect(validTargets).not.toContain(ownChar);

    // Player1 picks order: weakOpp1 first (= bottommost), weakOpp2 second
    r = applyAction(state, {
      type: "RESOLVE_CHOICE",
      playerId: "player1",
      choice: [weakOpp1, weakOpp2],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Both weak opp characters now in player2's deck at the bottom
    expect(getInstance(state, weakOpp1).zone).toBe("deck");
    expect(getInstance(state, weakOpp2).zone).toBe("deck");
    expect(getInstance(state, strongOpp).zone).toBe("play");
    expect(getInstance(state, ownChar).zone).toBe("play");

    const p2Deck = getZone(state, "player2", "deck");
    expect(p2Deck.length).toBe(p2DeckSizeBefore + 2);
    // Bottom two slots reflect the chosen order: bottommost first, next-to-bottom second
    expect(p2Deck[p2Deck.length - 2]).toBe(weakOpp1);
    expect(p2Deck[p2Deck.length - 1]).toBe(weakOpp2);
  });

  it("Second Star to the Right: chosen player draws 5 cards (controller picks self)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "second-star-to-the-right", "hand"));
    const handBefore = getZone(state, "player1", "hand").length;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Surfaces choose_player pendingChoice
    expect(state.pendingChoice?.type).toBe("choose_player");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
    expect(state.pendingChoice?.validTargets).toContain("player1");
    expect(state.pendingChoice?.validTargets).toContain("player2");

    // Controller picks self
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Player1 drew 5 cards. Net hand delta: -1 (Second Star itself moves from hand to discard)
    // + 5 drawn = +4. But we played the song so it leaves hand first. handBefore counted Second Star.
    // After play: handBefore - 1 (song removed) + 5 = handBefore + 4.
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 4);
  });

  it("Second Star to the Right: chosen player can be opponent", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "second-star-to-the-right", "hand"));
    const p2HandBefore = getZone(state, "player2", "hand").length;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "player2" }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Player2 drew 5
    expect(getZone(state, "player2", "hand").length).toBe(p2HandBefore + 5);
  });

  it("Sing Together rejects duplicate singers", () => {
    let state = startGame();
    let songId: string, singer1Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirate-s-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer1Id],
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });
});
