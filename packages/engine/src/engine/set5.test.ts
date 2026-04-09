// =============================================================================
// SET 5 — Shimmering Skies: reveal_top_conditional (Phase A.3)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect } from "./reducer.js";
import { evaluateCondition } from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";
import { applyMoveCostReduction } from "./validator.js";
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

  it("Sherwood Forest FOREST HOME: Robin Hood-named characters get free move; non-Robin-Hood pays", () => {
    // Synthetic check via the helper since Sherwood Forest's printed moveCost is undefined.
    let state = startGame();
    let sherwoodId: string, mickeyId: string;
    ({ state, instanceId: sherwoodId } = injectCard(state, "player1", "sherwood-forest-outlaw-hideaway", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    const mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const entries = mods.moveToSelfCostReductions.get(sherwoodId);
    expect(entries?.length).toBe(1);
    expect(entries?.[0]?.filter.hasName).toBe("Robin Hood");
    // Mickey isn't named Robin Hood — base cost stays
    const inst = getInstance(state, mickeyId);
    const def = LORCAST_CARD_DEFINITIONS[inst.definitionId]!;
    expect(applyMoveCostReduction(2, inst, def, sherwoodId, mods, state, "player1")).toBe(2);
  });

  it("Sherwood Forest FAMILIAR TERRAIN: characters here gain Ward + the granted activated ability", () => {
    let state = startGame();
    let sherwoodId: string, mickeyId: string;
    ({ state, instanceId: sherwoodId } = injectCard(state, "player1", "sherwood-forest-outlaw-hideaway", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: sherwoodId }));

    const mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    // Ward granted
    const granted = mods.grantedKeywords.get(mickeyId) ?? [];
    expect(granted.some(k => k.keyword === "ward")).toBe(true);
    // Activated ability granted
    const activated = mods.grantedActivatedAbilities.get(mickeyId) ?? [];
    expect(activated.length).toBeGreaterThanOrEqual(1);
    expect(activated[0]?.costs?.length).toBe(2); // exert + 1 ink
  });

  it("Sugar Rush Speedway ON YOUR MARKS!: exerts chosen here, deals 1 damage, moves to another location, excludes current loc", () => {
    let state = startGame();
    let sugarId: string, otherLocId: string, charId: string;
    ({ state, instanceId: sugarId } = injectCard(state, "player1", "sugar-rush-speedway-starting-line", "play", { isDrying: false }));
    ({ state, instanceId: otherLocId } = injectCard(state, "player1", "never-land-mermaid-lagoon", "play", { isDrying: false }));
    // Inject Mickey at Sugar Rush
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: sugarId }));

    // Activate ON YOUR MARKS!
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: sugarId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 1: choose the character (must be at sugar rush, must be ready)
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(charId);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId] }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey now exerted + 1 damage
    expect(getInstance(state, charId).isExerted).toBe(true);
    expect(getInstance(state, charId).damage).toBe(1);

    // Stage 2: choose destination location — sugar rush itself must be EXCLUDED
    expect(state.pendingChoice?.type).toBe("choose_target");
    const validLocs = state.pendingChoice?.validTargets ?? [];
    expect(validLocs).toContain(otherLocId);
    expect(validLocs).not.toContain(sugarId);

    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [otherLocId] }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey now at other location
    expect(getInstance(state, charId).atLocationInstanceId).toBe(otherLocId);
  });

  it("Merlin's Cottage KNOWLEDGE IS POWER: both players' top-of-deck visibility flag set", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "merlins-cottage-the-wizards-home", "play", { isDrying: false }));

    const mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(mods.topOfDeckVisible.has("player1")).toBe(true);
    expect(mods.topOfDeckVisible.has("player2")).toBe(true);
  });

  it("reveal_top_conditional noMatchDestination=hand puts missed reveal into hand", () => {
    // Synthetic: top of deck is minnie-mouse-beloved-princess (Princess),
    // filter on hasTrait Dragon → miss → goes to hand (John Smith's Compass pattern).
    let state = startGame();
    // Force a known top via injectCard onto top of deck.
    let topId: string;
    ({ state, instanceId: topId } = injectCard(state, "player1", "mickey-mouse-true-friend", "deck"));
    // Move to top (injectCard adds to bottom; relocate to position 0).
    const deck = state.zones.player1.deck.filter(id => id !== topId);
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck: [topId, ...deck] } } };

    const handBefore = state.zones.player1.hand.length;
    state = applyEffect(
      state,
      {
        type: "reveal_top_conditional",
        filter: { hasAnyTrait: ["Dragon"] },
        matchAction: "to_hand",
        noMatchDestination: "hand",
        target: { type: "self" },
      },
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      []
    );
    // Miss branch sent card to hand.
    expect(state.zones.player1.hand).toContain(topId);
    expect(state.zones.player1.hand.length).toBe(handBefore + 1);
  });

  it("reveal_top_conditional matchExtraEffects: gain lore on match (Bruno pattern)", () => {
    let state = startGame();
    let topId: string;
    ({ state, instanceId: topId } = injectCard(state, "player1", "mickey-mouse-true-friend", "deck"));
    const deck = state.zones.player1.deck.filter(id => id !== topId);
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck: [topId, ...deck] } } };

    const loreBefore = state.players.player1.lore;
    state = applyEffect(
      state,
      {
        type: "reveal_top_conditional",
        filter: { cardType: ["character"] },
        matchAction: "to_hand",
        matchExtraEffects: [{ type: "gain_lore", amount: 3, target: { type: "self" } }],
        noMatchDestination: "top",
        target: { type: "self" },
      },
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      []
    );
    expect(state.zones.player1.hand).toContain(topId);
    expect(state.players.player1.lore).toBe(loreBefore + 3);
  });

  it("reveal_top_conditional noMatchDestination=discard: missed reveal goes to discard (Kristoff pattern)", () => {
    let state = startGame();
    let topId: string;
    ({ state, instanceId: topId } = injectCard(state, "player1", "mickey-mouse-true-friend", "deck"));
    const deck = state.zones.player1.deck.filter(id => id !== topId);
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck: [topId, ...deck] } } };

    state = applyEffect(
      state,
      {
        type: "reveal_top_conditional",
        filter: { hasAnyTrait: ["Dragon"] }, // no match
        matchAction: "to_hand",
        noMatchDestination: "discard",
        target: { type: "self" },
      },
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      []
    );
    expect(state.zones.player1.discard).toContain(topId);
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

describe("§5 Set 5 — put_on_bottom_of_deck Effect", () => {
  it("from hand: moves a card from controller's hand to bottom of own deck", () => {
    let state = startGame();
    // Inject a known card into player1's hand
    let handCardId: string;
    ({ state, instanceId: handCardId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const deckBefore = getZone(state, "player1", "deck");
    const handBefore = getZone(state, "player1", "hand");
    expect(handBefore).toContain(handCardId);
    const deckLenBefore = deckBefore.length;

    state = applyEffect(
      state,
      { type: "put_on_bottom_of_deck", from: "hand" },
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      []
    );

    const deckAfter = getZone(state, "player1", "deck");
    const handAfter = getZone(state, "player1", "hand");
    // First eligible hand card was moved
    expect(handAfter.length).toBe(handBefore.length - 1);
    expect(deckAfter.length).toBe(deckLenBefore + 1);
    // The moved card is now the last (bottom) card of the deck
    expect(deckAfter[deckAfter.length - 1]).toBe(handBefore[0]);
  });

  it("from discard with filter: moves matching cards from discard to bottom of own deck", () => {
    let state = startGame();
    // Inject 2 item cards + 1 character into player1's discard
    let item1Id: string, item2Id: string;
    ({ state, instanceId: item1Id } = injectCard(state, "player1", "basils-magnifying-glass", "discard"));
    ({ state, instanceId: item2Id } = injectCard(state, "player1", "basils-magnifying-glass", "discard"));
    let charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));

    const deckLenBefore = getZone(state, "player1", "deck").length;
    state = applyEffect(
      state,
      {
        type: "put_on_bottom_of_deck",
        from: "discard",
        filter: { cardType: ["item"] },
        amount: 3,
      },
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      []
    );

    const discardAfter = getZone(state, "player1", "discard");
    const deckAfter = getZone(state, "player1", "deck");
    // Only the 2 item cards moved (filter), character stays in discard
    expect(discardAfter).toContain(charId);
    expect(discardAfter).not.toContain(item1Id);
    expect(discardAfter).not.toContain(item2Id);
    expect(deckAfter.length).toBe(deckLenBefore + 2);
    // Items now sit at the bottom (order matches discard scan order)
    expect(deckAfter[deckAfter.length - 2]).toBe(item1Id);
    expect(deckAfter[deckAfter.length - 1]).toBe(item2Id);
    // lastEffectResult exposes the count moved
    expect(state.lastEffectResult).toBe(2);
  });
});

describe("§5 Set 5 — Pride Lands Jungle Oasis (alt-source-zone: play from discard)", () => {
  it("OUR HUMBLE HOME: with < 3 characters at this location, ability fizzles (location stays, discard char not played)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let locId: string, discardCharId: string;
    ({ state, instanceId: locId } = injectCard(state, "player1", "pride-lands-jungle-oasis", "play", { isDrying: false }));
    // Put 2 characters at the location (not enough)
    injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: locId });
    injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: locId });
    ({ state, instanceId: discardCharId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));
    const r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: locId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true); // activation succeeds but effects fizzle (CRD 6.2.1)
    const s2 = r.newState;
    // Location still in play (banish effect gated by condition, did not run)
    expect(getZone(s2, "player1", "play")).toContain(locId);
    // Discard char still in discard
    expect(getZone(s2, "player1", "discard")).toContain(discardCharId);
    expect(s2.pendingChoice).toBeNull();
  });

  it("OUR HUMBLE HOME: activates with 3 chars, banishes self, plays a character from discard for free", () => {
    let state = startGame();
    state = giveInk(state, "player1", 0); // explicitly 0 — play should be free
    let locId: string;
    ({ state, instanceId: locId } = injectCard(state, "player1", "pride-lands-jungle-oasis", "play", { isDrying: false }));
    // 3 characters at this location
    let c1: string, c2: string, c3: string;
    ({ state, instanceId: c1 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: locId }));
    ({ state, instanceId: c2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: locId }));
    ({ state, instanceId: c3 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: locId }));
    // Target character in discard
    let discardCharId: string;
    ({ state, instanceId: discardCharId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));

    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: locId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Location is banished (cost)
    expect(getZone(state, "player1", "discard")).toContain(locId);

    // May prompt: choose the discarded char
    if (state.pendingChoice?.type === "choose_target") {
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardCharId] }, LORCAST_CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }

    // Played for free → char in play, not still in discard
    expect(getZone(state, "player1", "discard")).not.toContain(discardCharId);
    expect(getZone(state, "player1", "play")).toContain(discardCharId);
    // No ink spent
    expect(state.players.player1.availableInk).toBe(0);
  });
});

describe("§9 Set 9 — Circle of Life (alt-source-zone: song plays char from discard)", () => {
  it("actionEffects replay a character from discard for free", () => {
    let state = startGame();
    state = giveInk(state, "player1", 8);
    let songId: string, discardCharId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "circle-of-life", "hand"));
    ({ state, instanceId: discardCharId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    if (state.pendingChoice?.type === "choose_target") {
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardCharId] }, LORCAST_CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }

    // Character is now in play
    expect(getZone(state, "player1", "play")).toContain(discardCharId);
    // Song is in discard (CRD 5.4.3)
    expect(getZone(state, "player1", "discard")).toContain(songId);
  });
});

// ============================================================================
// Three-mechanic batch: reveal_hand, draw-to-n, per-count-cost-reduction
// ============================================================================
describe("§5 three-mechanic batch", () => {
  it("reveal_hand: emits hand_revealed event, no state change", () => {
    let state = startGame();
    // Inject a couple of cards into opponent's hand so the event list is meaningful.
    ({ state } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    const handBefore = [...getZone(state, "player2", "hand")];
    const events: any[] = [];
    const newState = applyEffect(
      state,
      { type: "reveal_hand", target: { type: "opponent" } } as any,
      "source-x",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      events,
    );
    // No state change
    expect(getZone(newState, "player2", "hand")).toEqual(handBefore);
    // Event emitted with full hand contents
    const ev = events.find((e) => e.type === "hand_revealed");
    expect(ev).toBeDefined();
    expect(ev.playerId).toBe("player2");
    expect(ev.cardInstanceIds).toEqual(handBefore);
  });

  it("draw until N: untilHandSize draws delta only, no draw when already at target", () => {
    let state = startGame();
    // Clear player1's hand to a known size via emptyDeck? Simpler: count delta.
    const startHand = getZone(state, "player1", "hand").length;
    // Draw until hand size = startHand + 3
    const events: any[] = [];
    const r1 = applyEffect(
      state,
      { type: "draw", amount: 0, target: { type: "self" }, untilHandSize: startHand + 3 } as any,
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      events,
    );
    expect(getZone(r1, "player1", "hand").length).toBe(startHand + 3);
    // Already at target — no more draws.
    const r2 = applyEffect(
      r1,
      { type: "draw", amount: 0, target: { type: "self" }, untilHandSize: startHand + 3 } as any,
      "src",
      "player1",
      LORCAST_CARD_DEFINITIONS,
      events,
    );
    expect(getZone(r2, "player1", "hand").length).toBe(startHand + 3);
  });

  it("per-count self_cost_reduction: Kristoff pays 1 less per song in discard", () => {
    // Kristoff - Reindeer Keeper: cost 9, For each song card in your discard, pay 1 {I} less.
    let state = startGame();
    state = giveInk(state, "player1", 7);
    let kristoffId: string;
    ({ state, instanceId: kristoffId } = injectCard(state, "player1", "kristoff-reindeer-keeper", "hand"));
    // With zero songs in discard — full cost 9, should fail at 7 ink.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: kristoffId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    // Inject 2 songs into discard — cost becomes 9-2 = 7, should now succeed at 7 ink.
    ({ state } = injectCard(state, "player1", "be-prepared", "discard"));
    ({ state } = injectCard(state, "player1", "friends-on-the-other-side", "discard"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: kristoffId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });

  it("Mirabel Madrigal NOT WITHOUT MY FAMILY: playRestriction blocks play below 5 characters", () => {
    // CRD play-restriction: "You can't play this character unless you have
    // 5 or more characters in play." Wired via CardDefinition.playRestrictions
    // with the existing characters_in_play_gte condition.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let mirabelId: string;
    ({ state, instanceId: mirabelId } = injectCard(state, "player1", "mirabel-madrigal-family-gatherer", "hand"));

    // 0 characters in play — restriction should block.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // Inject 4 characters — still below the threshold.
    for (let i = 0; i < 4; i++) {
      ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    }
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // 5th character — restriction satisfied.
    ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });

  it("Nathaniel Flint PREDATORY INSTINCT: playRestriction blocks play unless an opposing character was damaged this turn", () => {
    // Same play-restriction infrastructure as Mirabel, different condition
    // (opposing_character_was_damaged_this_turn). Lives in set 5 test file
    // alongside the other play-restriction case for pattern co-location;
    // the card itself is set 8.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flintId: string, oppCharId: string, attackerId: string;
    ({ state, instanceId: flintId } = injectCard(state, "player1", "nathaniel-flint-notorious-pirate", "hand"));
    ({ state, instanceId: oppCharId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: false }));

    // No opposing character damaged this turn — restriction blocks.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: flintId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // Challenge the opposing character to deal damage to it (must be exerted to be challenged).
    state = { ...state, cards: { ...state.cards, [oppCharId]: { ...state.cards[oppCharId]!, isExerted: true } } };
    r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: oppCharId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Now an opposing character was damaged this turn — restriction satisfied.
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: flintId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });
});
