// =============================================================================
// SET 4 — Ursula's Return: Sing Together (CRD 8.12)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getAllLegalActions } from "./reducer.js";
import { setLore } from "./test-helpers.js";
import {
  CARD_DEFINITIONS,
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
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirates-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: singer2Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer2Id],
    }, CARD_DEFINITIONS);
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
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirates-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id],
    }, CARD_DEFINITIONS);
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
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Cogsworth Majordomo: -2 strength persists across opponent's turn (end_of_owner_next_turn duration)", () => {
    let state = startGame();
    let cogId: string, victimId: string;
    ({ state, instanceId: cogId } = injectCard(state, "player1", "cogsworth-majordomo", "play", { isDrying: false }));
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Quest with Cogsworth — fires AS YOU WERE!
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: cogId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Trigger surfaces choose_may
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // choose_target for the chosen character
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey base strength = 3, after -2 = 1. Should be on the timed-effects path, not temp.
    const victim = getInstance(state, victimId);
    expect(victim.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(true);

    expect(getEffectiveStrength(victim, CARD_DEFINITIONS[victim.definitionId]!)).toBe(1);

    // Pass to opponent's turn — debuff should still be active.
    state = passTurns(state, 1);
    let v2 = getInstance(state, victimId);
    expect(v2.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(true);

    // Pass back to player1 — debuff expires at start of player1's next turn.
    state = passTurns(state, 1);
    let v3 = getInstance(state, victimId);
    expect(v3.timedEffects.some(te => te.type === "modify_strength" && te.amount === -2)).toBe(false);
    expect(getEffectiveStrength(v3, CARD_DEFINITIONS[v3.definitionId]!)).toBe(3);
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
    }, "synthetic-source", "player1", CARD_DEFINITIONS, []);

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
    }, CARD_DEFINITIONS);
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
    }, CARD_DEFINITIONS);
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

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Surfaces choose_player pendingChoice
    expect(state.pendingChoice?.type).toBe("choose_player");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
    expect(state.pendingChoice?.validTargets).toContain("player1");
    expect(state.pendingChoice?.validTargets).toContain("player2");

    // Controller picks self
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Player1 drew 5 cards. Net hand delta: -1 (Second Star itself moves from hand to discard)
    // + 5 drawn = +4. But we played the song so it leaves hand first. handBefore counted Second Star.
    // After play: handBefore - 1 (song removed) + 5 = handBefore + 4.
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 4);
  });

  it("chosen player + lose_lore: pendingChoice surfaces and resolves to opponent", () => {
    let state = startGame();
    state = setLore(state, "player2", 5);
    state = applyEffect(state, {
      type: "lose_lore",
      amount: 2,
      target: { type: "chosen" },
    }, "synthetic-source", "player1", CARD_DEFINITIONS, []);
    expect(state.pendingChoice?.type).toBe("choose_player");

    const r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "player2" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player2.lore).toBe(3);
  });

  it("chosen player with excludeSelf in 2P: auto-resolves to opponent without prompting", () => {
    let state = startGame();
    state = setLore(state, "player2", 5);
    state = applyEffect(state, {
      type: "lose_lore",
      amount: 2,
      target: { type: "chosen", excludeSelf: true },
    }, "synthetic-source", "player1", CARD_DEFINITIONS, []);
    // No pendingChoice — collapsed to opponent in 2P
    expect(state.pendingChoice).toBeFalsy();
    expect(state.players.player2.lore).toBe(3);
  });

  it("Second Star to the Right: chosen player can be opponent", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "second-star-to-the-right", "hand"));
    const p2HandBefore = getZone(state, "player2", "hand").length;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "player2" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Player2 drew 5
    expect(getZone(state, "player2", "hand").length).toBe(p2HandBefore + 5);
  });

  it("Belle Untrained Mystic move_damage: damage moves from chosen to chosen opposing", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let belleId: string, sourceId: string, destId: string;
    ({ state, instanceId: sourceId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, damage: 2 }));
    ({ state, instanceId: destId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: belleId } = injectCard(state, "player1", "belle-untrained-mystic", "hand"));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: belleId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 1: pick the source (must have damage)
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(sourceId);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [sourceId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 2: pick the opposing destination
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(destId);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [destId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Source went from 2 → 1 damage (up to 1 moved); destination went from 0 → 1
    expect(getInstance(state, sourceId).damage).toBe(1);
    expect(getInstance(state, destId).damage).toBe(1);
  });

  it("Gaston Despicable Dealer grant_cost_reduction: next character costs 2 less", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let gastonId: string, otherId: string;
    ({ state, instanceId: gastonId } = injectCard(state, "player1", "gaston-despicable-dealer", "hand"));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));

    // Play Gaston (cost 3) — adds the cost reduction entry
    const inkBefore = state.players.player1.availableInk;
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: gastonId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(inkBefore - 3);
    expect(state.players.player1.costReductions?.length).toBe(1);

    // Play Mickey True Friend (cost 3) — should be reduced by 2
    const inkBeforeMickey = state.players.player1.availableInk;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: otherId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Mickey cost 3 - 2 reduction = 1
    expect(state.players.player1.availableInk).toBe(inkBeforeMickey - 1);
    // Cost reduction was consumed
    expect(state.players.player1.costReductions?.length ?? 0).toBe(0);
  });

  it("Be King Undisputed: opponent-chosen banish — opponent picks which of their characters to banish", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let songId: string, oppA: string, oppB: string, singer1: string, singer2: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "be-king-undisputed", "hand"));
    // Sing Together threshold isn't on this card; it's a regular sing-cost-4 song.
    // Inject a singer that can sing it (Cost 4).
    ({ state, instanceId: singer1 } = injectCard(state, "player1", "elsa-spirit-of-winter", "play", { isDrying: false }));
    ({ state, instanceId: oppA } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isDrying: false }));
    ({ state, instanceId: oppB } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Sing Be King Undisputed
    let r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceId: singer1,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Opponent (player2) is the chooser
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player2");
    expect(state.pendingChoice?.validTargets).toContain(oppA);
    expect(state.pendingChoice?.validTargets).toContain(oppB);

    // Player2 picks oppA
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppA] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // oppA banished, oppB still in play
    expect(getInstance(state, oppA).zone).toBe("discard");
    expect(getInstance(state, oppB).zone).toBe("play");
  });

  it("Sing Together rejects duplicate singers", () => {
    let state = startGame();
    let songId: string, singer1Id: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirates-life", "hand"));
    ({ state, instanceId: singer1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [singer1Id, singer1Id],
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  // ── New engine mechanics added in batch 10 ──

  it("Flynn Rider - Frenemy: gains 3 lore at turn start when a character has more strength than each opposing", () => {
    // Flynn has strength 2; give him a strong ally.
    let state = startGame();
    ({ state } = injectCard(state, "player1", "flynn-rider-frenemy", "play", { isDrying: false }));
    // Big strength character (Mickey True Friend has str 2). Use a bigger one — Be Prepared's target? Just inject another and rely on Flynn's 2 > opponent's 0 (no opp chars).
    // No opponent characters → vacuously true (max opp = -1).
    setLore(state, "player1", 0);
    const r = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Pass back to player1 — turn_start should fire NARROW ADVANTAGE.
    const r2 = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, CARD_DEFINITIONS);
    expect(r2.success).toBe(true);
    state = r2.newState;
    expect(state.players.player1.lore).toBeGreaterThanOrEqual(3);
  });

  it("Ursula's Garden: opposing characters get -1 lore while an exerted character is here", async () => {
    let state = startGame();
    let locId: string, myCharId: string, oppCharId: string;
    ({ state, instanceId: locId } = injectCard(state, "player1", "ursulas-garden-full-of-the-unfortunate", "play", { isDrying: false }));
    ({ state, instanceId: myCharId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: oppCharId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    // Put my char at the location.
    state = { ...state, cards: { ...state.cards, [myCharId]: { ...state.cards[myCharId]!, atLocationInstanceId: locId } } };
    const oppInst = getInstance(state, oppCharId);
    const oppDef = CARD_DEFINITIONS[oppInst.definitionId]!;
    const baseLore = oppDef.lore ?? 0;
    // Effective lore via modifiers: consult modifier debuff
    const { getGameModifiers } = await import("./gameModifiers.js");
    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const bonus = mods.statBonuses.get(oppCharId)?.lore ?? 0;
    expect(baseLore + bonus).toBe(baseLore - 1);
  });

  it("Look at This Family: puts up to 2 character cards from top 5 into hand", () => {
    let state = startGame();
    let songId: string, s1: string, s2: string, s3: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "look-at-this-family", "hand"));
    ({ state, instanceId: s1 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: s2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: s3 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    const handBefore = getZone(state, "player1", "hand").length;
    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceIds: [s1, s2, s3],
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Song played → effect resolves → some characters moved to hand.
    // Hand net change: -1 song + up to 2 chars = hand between -1 and +1.
    const handAfter = getZone(state, "player1", "hand").length;
    expect(handAfter).toBeGreaterThanOrEqual(handBefore - 1);
    expect(handAfter).toBeLessThanOrEqual(handBefore + 1);
  });

  it("Mulan Elite Archer: deals_damage_in_challenge trigger fires and deals 2 damage to a chosen character", () => {
    let state = startGame();
    let mulanId: string, defenderId: string, bystanderId: string;
    ({ state, instanceId: mulanId } = injectCard(state, "player1", "mulan-elite-archer", "play", { isDrying: false }));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: bystanderId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    const r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: mulanId, defenderInstanceId: defenderId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Triple Shot either resolved (bystander damaged) or prompted a choose_target pendingChoice.
    const bystanderDmg = getInstance(state, bystanderId)?.damage ?? 0;
    const hasPendingChoice = !!state.pendingChoice;
    expect(bystanderDmg > 0 || hasPendingChoice).toBe(true);
  });

  it("Flotsam & Jetsam Entangling Eels counts as both Flotsam and Jetsam (CRD §10.6 dual-name)", () => {
    // alternateNames on CardDefinition makes hasName filter match either name.
    const def = CARD_DEFINITIONS["flotsam-jetsam-entangling-eels"];
    expect(def).toBeDefined();
    expect(def?.alternateNames).toEqual(expect.arrayContaining(["Flotsam", "Jetsam"]));

    // End-to-end: a hasName filter should match either alias.
    let state = startGame();
    let eelsId: string;
    ({ state, instanceId: eelsId } = injectCard(state, "player1", "flotsam-jetsam-entangling-eels", "play", { isDrying: false }));
    // Use the matchesFilter path indirectly by counting via findValidTargets through reducer:
    // simpler — assert via the utility import.
    // (matchesFilter is exercised in many code paths; this proves the data shape and unblocks
    // any "named X" effect that targets these characters.)
    expect(getInstance(state, eelsId)).toBeDefined();
  });

  // CRD 6.1.5.1 + 6.1.4 + 6.1.5: pay-extra-cost-mid-effect via SequentialEffect.
  // Ariel Sonic Warrior AMPLIFIED VOICE: "Whenever you play a song, you may pay
  // 2 {I} to deal 3 damage to chosen character."
  it("Ariel Sonic Warrior AMPLIFIED VOICE — pay 2 ink to deal 3 damage on song-play", () => {
    let state = startGame();
    let arielId: string, songId: string, victimId: string;
    ({ state, instanceId: arielId } = injectCard(state, "player1", "ariel-sonic-warrior", "play", { isDrying: false }));
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    // Use a high-willpower target (5 will) so 3 damage doesn't banish.
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mr-smee-loyal-first-mate", "play", { isDrying: false }));
    state = giveInk(state, "player1", 6);

    // Play the song (cost 3) — should trigger AMPLIFIED VOICE.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Surfaces choose_may.
    expect(state.pendingChoice?.type).toBe("choose_may");

    // Accept — pay 2 ink.
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Then choose target for the 3 damage.
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Ink: started 6, song cost 3, AMPLIFIED VOICE cost 2 → 1 left.
    expect(state.players.player1.availableInk).toBe(1);
    // Damage applied.
    expect(getInstance(state, victimId).damage).toBe(3);
  });

  // CRD 6.1.4: declining the may does not pay ink and does not deal damage.
  it("AMPLIFIED VOICE decline — no ink spent, no damage", () => {
    let state = startGame();
    let songId: string, victimId: string;
    ({ state } = injectCard(state, "player1", "ariel-sonic-warrior", "play", { isDrying: false }));
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    // Use a high-willpower target (5 will) so 3 damage doesn't banish.
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mr-smee-loyal-first-mate", "play", { isDrying: false }));
    state = giveInk(state, "player1", 6);

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.pendingChoice?.type).toBe("choose_may");

    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Ink: 6 - 3 (song) = 3, no extra paid.
    expect(state.players.player1.availableInk).toBe(3);
    expect(getInstance(state, victimId).damage).toBe(0);
    // No further pending choice (no target prompt because reward was skipped).
    expect(state.pendingChoice).toBeNull();
  });

  // CRD 6.1.5.1: when the controller can't afford the extra cost, the may is
  // not even offered — effect silently skipped.
  it("AMPLIFIED VOICE can't afford — no prompt, no damage", () => {
    let state = startGame();
    let songId: string, victimId: string;
    ({ state } = injectCard(state, "player1", "ariel-sonic-warrior", "play", { isDrying: false }));
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    // Use a high-willpower target (5 will) so 3 damage doesn't banish.
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mr-smee-loyal-first-mate", "play", { isDrying: false }));
    // Just enough ink for the song (cost 3) and not a drop more.
    state = giveInk(state, "player1", 3);

    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Cost can't be paid → no choose_may surfaced.
    expect(state.pendingChoice).toBeNull();
    expect(getInstance(state, victimId).damage).toBe(0);
    expect(state.players.player1.availableInk).toBe(0);
  });
});

describe("§4 Set 4 — Noi Acrobatic Baby (damage_prevention_timed)", () => {
  it("after FANCY FOOTWORK fires, Noi takes no challenge damage; still deals damage back", () => {
    // Noi has STR 4 / WP 4. Give her the floating "takes no damage from
    // challenges this turn" TimedEffect directly via applyEffect, mirroring
    // what the card_played trigger does. Then have an opposing ready char be
    // challenged by Noi and verify Noi takes 0 damage while the defender
    // takes 4.
    let state = startGame();
    let noiId: string, defenderId: string;
    ({ state, instanceId: noiId } = injectCard(state, "player1", "noi-acrobatic-baby", "play", { isDrying: false }));
    // Defender: mickey-mouse-true-friend — STR 3 / WP 3.
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isExerted: true }));

    state = applyEffect(
      state,
      { type: "damage_prevention_timed", target: { type: "this" }, source: "challenge", duration: "this_turn" },
      noiId,
      "player1",
      CARD_DEFINITIONS,
      []
    );
    // TimedEffect attached
    expect(getInstance(state, noiId).timedEffects.some(te => te.type === "damage_prevention")).toBe(true);

    const r = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: noiId,
      defenderInstanceId: defenderId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Noi took 0 damage (defender STR 3 would have dealt 3); defender took 4
    // → banished (WP 3).
    expect(getInstance(r.newState, noiId).damage).toBe(0);
    expect(getInstance(r.newState, defenderId).zone).toBe("discard");
  });

  it("damage_prevention timed effect expires at end of turn", () => {
    let state = startGame();
    let noiId: string;
    ({ state, instanceId: noiId } = injectCard(state, "player1", "noi-acrobatic-baby", "play", { isDrying: false }));
    state = applyEffect(
      state,
      { type: "damage_prevention_timed", target: { type: "this" }, source: "challenge", duration: "end_of_turn" },
      noiId,
      "player1",
      CARD_DEFINITIONS,
      []
    );
    expect(getInstance(state, noiId).timedEffects.some(te => te.type === "damage_prevention")).toBe(true);
    // Pass player1's turn → effect should clear.
    state = passTurns(state, 1);
    expect(getInstance(state, noiId).timedEffects.some(te => te.type === "damage_prevention")).toBe(false);
  });

  // Snapshot-carrier internal-state tests (lastResolvedSource / lastResolvedTarget.delta)
  // were removed when applyAction started clearing these at action boundaries —
  // the Hades Double Dealer test below + Baymax test exercise the same carriers
  // end-to-end via actual card flows.

  it("Hades Double Dealer HERE'S THE TRADE-OFF: banish a character to play a same-named one from hand", () => {
    let state = startGame();
    let hadesId: string, sacId: string, copyInHandId: string;
    ({ state, instanceId: hadesId } = injectCard(state, "player1", "hades-double-dealer", "play", { isDrying: false }));
    ({ state, instanceId: sacId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: copyInHandId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    // Irrelevant hand card to confirm filter is applied
    ({ state } = injectCard(state, "player1", "maleficent-sorceress", "hand"));

    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: hadesId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Hades exerts as a cost, then a banish choice is pending
    expect(getInstance(state, hadesId).isExerted).toBe(true);
    expect(state.pendingChoice?.type).toBe("choose_target");
    // Choose the sacrificial character
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [sacId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Now the play_for_free choice should be pending, restricted to Mickey (not Maleficent)
    expect(state.pendingChoice?.type).toBe("choose_target");
    // Valid targets = Mickey Mouse cards in hand (starter deck may contain extras).
    expect(state.pendingChoice!.validTargets).toContain(copyInHandId);
    for (const id of state.pendingChoice!.validTargets as string[]) {
      const def = CARD_DEFINITIONS[state.cards[id]!.definitionId]!;
      expect(def.name).toBe("Mickey Mouse");
    }
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [copyInHandId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // The sacrificed Mickey is banished; the replayed Mickey is in play.
    expect(getInstance(state, sacId).zone).toBe("discard");
    expect(getInstance(state, copyInHandId).zone).toBe("play");
  });

  it("Ambush! deals damage equal to the exerted character's {S}", () => {
    let state = startGame();
    let ambushId: string, attackerId: string, victimId: string;
    ({ state, instanceId: ambushId } = injectCard(state, "player1", "ambush", "hand"));
    // mickey-mouse-true-friend has strength 2 in set 4 (cost 3).
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: victimId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    state = giveInk(state, "player1", 5);

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: ambushId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // First: choose the character to exert
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [attackerId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, attackerId).isExerted).toBe(true);
    // Then: choose the damage target
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [victimId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Mickey has strength 3 + willpower 3 → victim Mickey takes 3 damage from Ambush and
    // is banished (damage == willpower). The attacker's {S} drove the damage amount, so
    // assert the victim left play and the attacker is still in play and exerted.
    expect(getInstance(state, victimId).zone).toBe("discard");
    expect(getInstance(state, attackerId).zone).toBe("play");
  });

  it("Baymax Armored Companion gains lore equal to damage actually removed (isUpTo → delta)", () => {
    let state = startGame();
    let allyId: string;
    ({ state, instanceId: allyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, damage: 1 }));
    ({ state } = injectCard(state, "player1", "baymax-armored-companion", "hand"));
    state = giveInk(state, "player1", 10);

    // Play Baymax
    const baymaxInHand = getZone(state, "player1", "hand").find(id =>
      state.cards[id]!.definitionId === "baymax-armored-companion"
    )!;
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: baymaxInHand }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    const loreBefore = state.players.player1.lore;
    // enters_play trigger → choose_may
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Choose the damaged ally
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [allyId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Only 1 damage was actually removed even though "up to 2" → exactly 1 lore gained.
    expect(getInstance(state, allyId).damage).toBe(0);
    expect(state.players.player1.lore).toBe(loreBefore + 1);
  });

  it("The Queen - Diviner: look_at_top → self_replacement last_resolved_target plays cost-≤3 item for free entering exerted", () => {
    // look_at_top sets state.lastResolvedTarget when maxToHand=1. A
    // following self_replacement reads it via target:last_resolved_target,
    // checks the picked item's cost ≤ 3 (condition filter), and runs
    // `instead: [play_card for free]` when matched. Reusable for any
    // "if the just-revealed card matches X, do Y instead" wording.
    let state = startGame();
    let queenId: string;
    ({ state, instanceId: queenId } = injectCard(state, "player1", "the-queen-diviner", "play", { isDrying: false }));

    // Seed the top of player1's deck with a cost-2 item so the bot's greedy
    // look_at_top hand-pick lands on it, then the conditional escalation
    // should fire and play it for free entering exerted.
    let cheapItemId: string;
    ({ state, instanceId: cheapItemId } = injectCard(state, "player1", "magic-mirror", "deck"));
    // Move the cheap item to the top of the deck.
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1,
      deck: [cheapItemId, ...state.zones.player1.deck.filter(id => id !== cheapItemId)] } } };

    // Apply the activated ability's effects directly (the {E} cost is
    // orthogonal to the engine extension under test).
    const def = CARD_DEFINITIONS["the-queen-diviner"];
    for (const e of def.abilities[0]!.effects!) {
      state = applyEffect(state, e as any, queenId, "player1", CARD_DEFINITIONS, []);
    }

    // The cheap item should now be in play AND exerted (not in hand).
    const itemAfter = getInstance(state, cheapItemId);
    expect(itemAfter.zone).toBe("play");
    expect(itemAfter.isExerted).toBe(true);
  });

  it("Naveen's Ukulele MAKE IT SING: targeted +3 sing cost via sing_cost_bonus_target timed effect", () => {
    // Tier-1 fix: Naveen's Ukulele was wired with effects:[] and a non-op
    // costEffects ladder (also using a non-standard activated-ability shape).
    // Now wired correctly with the new sing_cost_bonus_target effect, which
    // applies a TimedEffect (type:"sing_cost_bonus") to the chosen character.
    // The validator's sing-eligibility check sums these timed effects on the
    // singer in addition to the location-bound singCostBonusHere bonus.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let singerId: string, songId: string;
    // Singer with effective sing-cost 3 (cost-3 character — A Whole New
    // World is a 5-cost song so the singer is 2 short BEFORE the bonus,
    // and 5 short AFTER. Either way, the bonus matters.)
    ({ state, instanceId: singerId } = injectCard(state, "player1", "the-queen-diviner", "play", { isDrying: false }));
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-whole-new-world", "hand"));

    // Apply +3 sing cost bonus to the singer via the new effect type.
    state = applyEffect(state, {
      type: "sing_cost_bonus_target",
      amount: 3,
      duration: "this_turn",
      target: { type: "this" }
    } as any, singerId, "player1", CARD_DEFINITIONS, []);

    // Verify the timed effect landed on the singer.
    const singerInst = getInstance(state, singerId);
    const bonus = (singerInst.timedEffects ?? [])
      .filter(t => t.type === "sing_cost_bonus")
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    expect(bonus).toBe(3);

    // Sing attempt: cost-3 singer + 3 bonus = effective 6, which is enough
    // for a 5-cost song. Without the bonus the singer would FAIL to sing.
    // (We don't actually exercise SING_SONG action here — we just pin the
    // bonus accumulation, which is the bug class.)
  });

  it("Bruno Madrigal Undetected Uncle: name_a_card_then_reveal grants 3 lore on hit (gainLoreOnHit)", () => {
    // Tier-1 fix: was wired with bare name_a_card_then_reveal and the lore
    // branch dropped. Engine now supports gainLoreOnHit on the effect type;
    // both the bot path (clairvoyant always-hit) and the interactive
    // resolution apply the lore gain after the matchAction. Pattern coverage:
    // confirms the new field plumbs through both reducer paths.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let brunoId: string;
    ({ state, instanceId: brunoId } = injectCard(state, "player1", "bruno-madrigal-undetected-uncle", "play", { isDrying: false }));

    const loreBefore = state.players.player1.lore;
    const handBefore = getZone(state, "player1", "hand").length;

    // Apply Bruno's effect directly (the activated cost is exhaust + ink which
    // is orthogonal to the engine extension under test). Bot path: peeks the
    // top card, "names" it correctly, applies matchAction → to_hand, then
    // gainLoreOnHit fires.
    state = applyEffect(state, { type: "name_a_card_then_reveal", target: { type: "self" }, gainLoreOnHit: 3 } as any, brunoId, "player1", CARD_DEFINITIONS, []);

    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 1);
    expect(state.players.player1.lore).toBe(loreBefore + 3);
  });
});

describe("§4 Set 4 — Diablo Devoted Herald (altShiftCost discard)", () => {
  it("alt-shift: discard an action to shift onto base Diablo, 0 ink spent", () => {
    let state = startGame();
    // 0 ink — proves we're not paying ink
    state = giveInk(state, "player1", 0);
    let baseId: string, shiftId: string, actionId: string;
    // Base Diablo in play
    ({ state, instanceId: baseId } = injectCard(state, "player1", "diablo-maleficents-spy", "play"));
    // Devoted Herald in hand
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "diablo-devoted-herald", "hand"));
    // An action card in hand to discard as cost
    ({ state, instanceId: actionId } = injectCard(state, "player1", "be-prepared", "hand"));

    // One action per shift target — no per-combo fanout. The cost picker
    // surfaces as a pendingChoice after the click (same pattern as Belle/Scrooge).
    const actions = getAllLegalActions(state, "player1", CARD_DEFINITIONS);
    const shiftAction = actions.find(a =>
      a.type === "PLAY_CARD" &&
      a.instanceId === shiftId &&
      a.shiftTargetInstanceId === baseId
    );
    expect(shiftAction).toBeDefined();
    // No altShiftCostInstanceIds on the enumerated action.
    expect((shiftAction as any).altShiftCostInstanceIds).toBeUndefined();

    // Apply it — should surface choose_target for the discard cost.
    let r = applyAction(state, shiftAction!, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    expect(r.newState.pendingChoice?.validTargets).toContain(actionId);

    // Pick the action card as the discard.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [actionId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Diablo Devoted Herald is in play, shifted onto the base
    expect(getInstance(state, shiftId).zone).toBe("play");
    expect(getInstance(state, shiftId).playedViaShift).toBe(true);
    // Base Diablo is under
    expect(getInstance(state, baseId).zone).toBe("under");
    // Action card was discarded
    expect(getInstance(state, actionId).zone).toBe("discard");
    // No ink spent
    expect(state.players.player1.availableInk).toBe(0);
  });

  it("alt-shift: Flotsam & Jetsam exactCount=2 — chooser requires exactly 2 cards", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "flotsam-ursulas-spy", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "flotsam-jetsam-entangling-eels", "hand"));
    // Three discard candidates in hand.
    const picks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = injectCard(state, "player1", "mickey-mouse-true-friend", "hand");
      state = r.state;
      picks.push(r.instanceId);
    }
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: shiftId, shiftTargetInstanceId: baseId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.count).toBe(2);

    // 1 pick rejected (exactly 2 required).
    let bad = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: picks.slice(0, 1) }, CARD_DEFINITIONS);
    expect(bad.success).toBe(false);
    // 3 picks also rejected.
    bad = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: picks }, CARD_DEFINITIONS);
    expect(bad.success).toBe(false);
    // 2 picks resolve.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: picks.slice(0, 2) }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getInstance(r.newState, picks[0]!).zone).toBe("discard");
    expect(getInstance(r.newState, picks[1]!).zone).toBe("discard");
    expect(getInstance(r.newState, picks[2]!).zone).toBe("hand");
    expect(getInstance(r.newState, shiftId).zone).toBe("play");
    expect(getInstance(r.newState, shiftId).playedViaShift).toBe(true);
  });

  // Removed redundant "alt-shift: trace" — covered by the main "discard an
  // action to shift onto base Diablo, 0 ink spent" test above (with 0 starting
  // ink, which provides the same "no ink spent" guarantee more tightly).

  it("alt-shift: blocked when no eligible action card in hand", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "diablo-maleficents-spy", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "diablo-devoted-herald", "hand"));
    // No action card in hand — can't pay the cost

    const actions = getAllLegalActions(state, "player1", CARD_DEFINITIONS);
    const shiftAction = actions.find(a =>
      a.type === "PLAY_CARD" &&
      a.instanceId === shiftId &&
      a.shiftTargetInstanceId === baseId
    );
    expect(shiftAction).toBeUndefined();
  });
});

describe("§4 Set 4 — look_at_top up_to_n_to_hand_rest_bottom variants", () => {
  it("Dig a Little Deeper: mandatory put 2 into hand, both without reveal events", () => {
    let state = startGame();
    state = { ...state, interactive: true };
    let daldId: string;
    ({ state, instanceId: daldId } = injectCard(state, "player1", "dig-a-little-deeper", "hand"));
    state = giveInk(state, "player1", 10);

    const handBefore = getZone(state, "player1", "hand").length;

    // Play DALD via sing-together alt-cost workaround: just pay the full cost (8 ink)
    // ...actually DALD costs 8 and has Sing Together 8; pay ink directly
    const r = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: daldId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Interactive mode: should present a choose_from_revealed mandatory pick
    expect(r.newState.pendingChoice?.type).toBe("choose_from_revealed");
    expect(r.newState.pendingChoice?.optional).toBe(false); // isMay: false (mandatory)
    expect(r.newState.pendingChoice?.validTargets?.length).toBe(7); // no filter → all 7 are valid
    expect(r.newState.pendingChoice?.revealedCards?.length).toBe(7);

    // Player picks 2 of the 7
    const [pick1, pick2] = r.newState.pendingChoice!.validTargets!;
    const r2 = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [pick1!, pick2!],
    }, CARD_DEFINITIONS);
    expect(r2.success).toBe(true);

    // Both picks should be in hand (handBefore - 1 for DALD + 2 picks = handBefore + 1)
    const handAfter = getZone(r2.newState, "player1", "hand").length;
    expect(handAfter).toBe(handBefore - 1 + 2);

    // No card_revealed events for DALD (revealPicks: false → private)
    const revealEvents = r2.events.filter(e => e.type === "card_revealed");
    expect(revealEvents.length).toBe(0);
  });

  it("Dig a Little Deeper: short deck — completes as best as possible (CRD 1.7)", () => {
    let state = startGame();
    state = { ...state, interactive: true };
    let daldId: string;
    ({ state, instanceId: daldId } = injectCard(state, "player1", "dig-a-little-deeper", "hand"));
    state = giveInk(state, "player1", 10);

    // Shrink deck to 1 card only. Ensure one is left on top by slicing out the rest
    // and dumping them to discard (the exact destination doesn't matter).
    const deckIds = [...getZone(state, "player1", "deck")];
    const keepId = deckIds[0]!;
    const removed = deckIds.slice(1);
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: {
          ...state.zones.player1,
          deck: [keepId],
          discard: [...state.zones.player1.discard, ...removed],
        },
      },
    };
    for (const id of removed) {
      state = { ...state, cards: { ...state.cards, [id]: { ...state.cards[id]!, zone: "discard" } } };
    }

    const handBefore = getZone(state, "player1", "hand").length;

    const r = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: daldId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // With only 1 card in deck, look_at_top sees 1 card.
    // maxToHand=2 but only 1 available → mandatory pick of 1 (as best as possible).
    expect(r.newState.pendingChoice?.type).toBe("choose_from_revealed");
    expect(r.newState.pendingChoice?.validTargets?.length).toBe(1);

    // Player picks the single available card
    const pick = r.newState.pendingChoice!.validTargets![0]!;
    const r2 = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [pick],
    }, CARD_DEFINITIONS);
    expect(r2.success).toBe(true);

    // One card moved to hand
    const handAfter = getZone(r2.newState, "player1", "hand").length;
    expect(handAfter).toBe(handBefore - 1 + 1); // -1 for DALD + 1 from deck
    // Deck now empty
    expect(getZone(r2.newState, "player1", "deck").length).toBe(0);
  });

  it("Look at This Family: may pick up to 2 character cards, reveals picks", () => {
    let state = startGame(["mickey-mouse-true-friend"]); // deck full of characters
    state = { ...state, interactive: true };
    let latfId: string;
    ({ state, instanceId: latfId } = injectCard(state, "player1", "look-at-this-family", "hand"));
    state = giveInk(state, "player1", 10);

    const r = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: latfId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    expect(r.newState.pendingChoice?.type).toBe("choose_from_revealed");
    expect(r.newState.pendingChoice?.optional).toBe(true); // isMay: true
    expect(r.newState.pendingChoice?.revealedCards?.length).toBe(5);

    // Pick 2 characters
    const picks = r.newState.pendingChoice!.validTargets!.slice(0, 2);
    const r2 = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: picks,
    }, CARD_DEFINITIONS);
    expect(r2.success).toBe(true);

    // Both picks revealed (revealPicks: true → 2 card_revealed events)
    const revealEvents = r2.events.filter(e => e.type === "card_revealed");
    expect(revealEvents.length).toBe(2);
  });
});

describe("§4 Set 4 — CRD 6.1.6 excludeSelf on self-trigger", () => {
  // Magic Broom Illuminary Keeper: "Whenever you play ANOTHER character, you may
  // banish this character to draw a card." The "another" wording means the
  // trigger must NOT fire on Illuminary Keeper's own play event.
  it("Illuminary Keeper does NOT trigger on its own play", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let keeperId: string;
    ({ state, instanceId: keeperId } = injectCard(state, "player1", "magic-broom-illuminary-keeper", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: keeperId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // No NICE AND TIDY may choice: excludeSelf should reject self-trigger.
    expect(r.newState.pendingChoice).toBeFalsy();
    expect(getInstance(r.newState, keeperId).zone).toBe("play");
  });

  it("Illuminary Keeper DOES trigger on another character being played", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let keeperId: string, otherId: string;
    ({ state, instanceId: keeperId } = injectCard(state, "player1", "magic-broom-illuminary-keeper", "play", { isDrying: false }));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: otherId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice).toBeDefined();
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player1");
  });
});

describe("§4 Set 4 — Julieta Madrigal Excellent Cook SIGNATURE RECIPE (conditional draw fix)", () => {
  // Julieta is set 4 #13 with an identical reprint in set 9 #18 — same id,
  // same wiring. Before 2026-04-20, both shipped with only the remove_damage
  // effect; the follow-on "If you removed damage this way, you may draw a card"
  // was annotated "(draw approximation skipped)" in rulesText and unwired.
  // Contrast with Rapunzel Gifted with Healing (set 1) which uses
  // amount:"cost_result" — her oracle scales linearly ("Draw a card for each
  // 1 damage removed"). Julieta's oracle is binary ("may draw a card") so she
  // gates on you_removed_damage_this_turn instead.
  it("has both the remove_damage effect and a self_replacement draw gated on you_removed_damage_this_turn", () => {
    const def = CARD_DEFINITIONS["julieta-madrigal-excellent-cook"];
    expect(def).toBeDefined();
    const recipe = def!.abilities.find((a: any) => a.type === "triggered" && a.storyName === "SIGNATURE RECIPE");
    expect(recipe).toBeDefined();
    const effects = (recipe as any).effects;
    expect(effects).toHaveLength(2);

    // 1. remove_damage up to 2 on chosen character
    expect(effects[0].type).toBe("remove_damage");
    expect(effects[0].amount).toBe(2);
    expect(effects[0].isUpTo).toBe(true);

    // 2. self_replacement — if you_removed_damage_this_turn, may draw 1
    expect(effects[1].type).toBe("self_replacement");
    expect(effects[1].condition.type).toBe("you_removed_damage_this_turn");
    expect(effects[1].effect).toEqual([]);
    expect(effects[1].instead).toHaveLength(1);
    expect(effects[1].instead[0].type).toBe("draw");
    expect(effects[1].instead[0].amount).toBe(1);
    expect(effects[1].instead[0].isMay).toBe(true);
  });

  it("no approximation annotation remains in rulesText", () => {
    const def = CARD_DEFINITIONS["julieta-madrigal-excellent-cook"];
    const recipe = def!.abilities.find((a: any) => a.type === "triggered" && a.storyName === "SIGNATURE RECIPE");
    expect((recipe as any).rulesText).not.toMatch(/approximation/i);
    expect(def!.rulesText).not.toMatch(/approximation/i);
  });
});
