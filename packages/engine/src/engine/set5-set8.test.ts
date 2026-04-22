// =============================================================================
// SETS 5–8 — Shimmering Skies / Azurite Sea / Archazia's Island / Rise of the Floodborn
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getLoreThreshold, checkWinConditions, getAllLegalActions } from "./reducer.js";
import { evaluateCondition } from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";
import { applyMoveCostReduction } from "./validator.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
  setLore,
  passTurns,
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
    const topDef = CARD_DEFINITIONS[topInst.definitionId]!;
    const isPrincessOrQueen = topDef.traits.includes("Princess") || topDef.traits.includes("Queen");

    const handBefore = getZone(state, "player1", "hand").length;
    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: coreId,
      abilityIndex: 1,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    if (isPrincessOrQueen) {
      // ROYAL SEARCH oracle: "you may put that card into your hand" — matchIsMay
      // surfaces a choose_may. Accept to move it to hand.
      expect(state.pendingChoice?.type).toBe("choose_may");
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
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
    expect(evaluateCondition(cond, state, CARD_DEFINITIONS, "player1", mickeyId, undefined)).toBe(true);
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
    }, "synthetic-source", "player1", CARD_DEFINITIONS, []);

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
    const r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: mickeyId, defenderInstanceId: oppMickey }, CARD_DEFINITIONS);
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
    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const entries = mods.costReductions.filter((r) =>
      r.kind === "move" && r.locationInstanceId === sherwoodId
    );
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.kind === "move" && entry.cardFilter?.hasName).toBe("Robin Hood");
    // Mickey isn't named Robin Hood — base cost stays
    const inst = getInstance(state, mickeyId);
    const def = CARD_DEFINITIONS[inst.definitionId]!;
    expect(applyMoveCostReduction(2, inst, def, sherwoodId, mods, state, "player1")).toBe(2);
  });

  it("Sherwood Forest FAMILIAR TERRAIN: characters here gain Ward + the granted activated ability", () => {
    let state = startGame();
    let sherwoodId: string, mickeyId: string;
    ({ state, instanceId: sherwoodId } = injectCard(state, "player1", "sherwood-forest-outlaw-hideaway", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, atLocationInstanceId: sherwoodId }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
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
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: sugarId, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 1: choose the character (must be at sugar rush, must be ready)
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(charId);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId] }, CARD_DEFINITIONS);
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

    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [otherLocId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey now at other location
    expect(getInstance(state, charId).atLocationInstanceId).toBe(otherLocId);
  });

  it("Merlin's Cottage KNOWLEDGE IS POWER: both players' top-of-deck visibility flag set", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "merlins-cottage-the-wizards-home", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
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
      CARD_DEFINITIONS,
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
      CARD_DEFINITIONS,
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
      CARD_DEFINITIONS,
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
      abilityIndex: 1,
    }, CARD_DEFINITIONS);
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
      { type: "put_card_on_bottom_of_deck", from: "hand" },
      "src",
      "player1",
      CARD_DEFINITIONS,
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
        type: "put_card_on_bottom_of_deck",
        from: "discard",
        filter: { cardType: ["item"] },
        amount: 3,
      },
      "src",
      "player1",
      CARD_DEFINITIONS,
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

  it("Stopped Chaos in Its Tracks: 'up to 2' lets the player return just 1 character (engine allows < count)", () => {
    // Regression: GUI may force exactly 2 selections, but the engine allows
    // 1..count. The validator caps choice.length <= count and only requires
    // >= 1 when the prompt is non-optional and there are valid targets.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId: string, t1: string, t2: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "stopped-chaos-in-its-tracks", "hand"));
    ({ state, instanceId: t1 } = injectCard(state, "player2", "lilo-making-a-wish", "play"));
    ({ state, instanceId: t2 } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    void t2;

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.count).toBe(2);

    // Pick just 1 — engine MUST accept.
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [t1] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getInstance(r.newState, t1).zone).toBe("hand");
  });

  it("Hypnotic Deduction: surfaces a multi-pick chooser for the 2 cards (not auto-pick)", () => {
    // "Draw 3 cards, then put 2 cards from your hand on the top of your deck
    // in any order." Bug regression: previously the put effect auto-picked
    // the first 2 hand cards with no prompt.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let songId: string, h1: string, h2: string, h3: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "hypnotic-deduction", "hand"));
    // Pre-stack hand with 3 known cards so we can verify the chooser sees them.
    ({ state, instanceId: h1 } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    ({ state, instanceId: h2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    ({ state, instanceId: h3 } = injectCard(state, "player1", "lilo-making-a-wish", "hand"));

    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Draw 3 ran. Now should be a multi-pick choose_target for 2 hand cards.
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.count).toBe(2);
    // All hand cards should be valid targets (the player's full hand).
    expect(state.pendingChoice?.validTargets).toContain(h1);
    expect(state.pendingChoice?.validTargets).toContain(h2);
    expect(state.pendingChoice?.validTargets).toContain(h3);
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
    }, CARD_DEFINITIONS);
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
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Location is banished (cost)
    expect(getZone(state, "player1", "discard")).toContain(locId);

    // May prompt: choose the discarded char
    if (state.pendingChoice?.type === "choose_target") {
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardCharId] }, CARD_DEFINITIONS);
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

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    if (state.pendingChoice?.type === "choose_target") {
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardCharId] }, CARD_DEFINITIONS);
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
describe("§5 Set 5 — three-mechanic batch (reveal_hand, draw-to-n, per-count cost reduction)", () => {
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
      CARD_DEFINITIONS,
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
      CARD_DEFINITIONS,
      events,
    );
    expect(getZone(r1, "player1", "hand").length).toBe(startHand + 3);
    // Already at target — no more draws.
    const r2 = applyEffect(
      r1,
      { type: "draw", amount: 0, target: { type: "self" }, untilHandSize: startHand + 3 } as any,
      "src",
      "player1",
      CARD_DEFINITIONS,
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
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: kristoffId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    // Inject 2 songs into discard — cost becomes 9-2 = 7, should now succeed at 7 ink.
    ({ state } = injectCard(state, "player1", "be-prepared", "discard"));
    ({ state } = injectCard(state, "player1", "friends-on-the-other-side", "discard"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: kristoffId }, CARD_DEFINITIONS);
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
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // Inject 4 characters — still below the threshold.
    for (let i = 0; i < 4; i++) {
      ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    }
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // 5th character — restriction satisfied.
    ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: mirabelId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });

  it("Wreck-It Ralph - Admiral Underpants: Princess branch returns AND gains 2 lore via mixed-branch self_replacement", () => {
    // Wired with self_replacement mixed branches: effect=[return_to_hand],
    // instead=[return_to_hand, gain_lore +2]. Pattern coverage: confirms
    // gain_lore is callable as a branch effect even though dispatch passes
    // the chosen card's instanceId (gain_lore ignores it and routes via
    // effect.target.type=self).
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let ralphId: string, princessId: string;
    ({ state, instanceId: ralphId } = injectCard(state, "player1", "wreck-it-ralph-admiral-underpants", "hand"));
    ({ state, instanceId: princessId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));

    const loreBefore = state.players.player1.lore;
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: ralphId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Pick the Princess from discard.
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(princessId);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [princessId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Princess returned to hand AND +2 lore from the matched branch.
    expect(getInstance(state, princessId).zone).toBe("hand");
    expect(state.players.player1.lore).toBe(loreBefore + 2);
  });

  it("Koda Talkative Cub: preventLoreLoss blocks gain_lore with negative amount (Aladdin/Tangle bypass fix)", () => {
    // Regression: 3 cards use gain_lore with literal amount: -1 (Aladdin
    // Street Rat, Rapunzel Letting Down Her Hair, Tangle) instead of
    // lose_lore. The preventLoreLoss check previously lived ONLY in the
    // lose_lore reducer case, so these bypassed Koda's protection. The fix
    // moved the check into the gainLore() helper where all paths converge.
    let state = startGame();
    let kodaId: string;
    ({ state, instanceId: kodaId } = injectCard(state, "player1", "koda-talkative-cub", "play", { isDrying: false }));
    // Set it to opponent's turn so Koda's condition (not is_your_turn) holds
    state = { ...state, currentPlayer: "player2" as any };
    // Give player1 some lore to lose
    state = { ...state, players: { ...state.players, player1: { ...state.players.player1, lore: 5 } } };

    // Apply gain_lore with negative amount (the bypass path)
    state = applyEffect(state, { type: "gain_lore", amount: -1, target: { type: "self" } } as any, kodaId, "player1", CARD_DEFINITIONS, []);

    // Koda's protection should block the loss — lore stays at 5
    expect(state.players.player1.lore).toBe(5);
  });

  it("§8 Nathaniel Flint PREDATORY INSTINCT: playRestriction blocks play unless an opposing character was damaged this turn", () => {
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
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: flintId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);

    // Challenge the opposing character to deal damage to it (must be exerted to be challenged).
    state = { ...state, cards: { ...state.cards, [oppCharId]: { ...state.cards[oppCharId]!, isExerted: true } } };
    r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: oppCharId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Now an opposing character was damaged this turn — restriction satisfied.
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: flintId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
  });
});

// =============================================================================
// SET 7 — Donald Duck Flustered Sorcerer, Mill, Baloo Ol' Iron Paws
// =============================================================================

describe("§7 Set 7 — Donald Duck Flustered Sorcerer (modify_win_threshold)", () => {
  it("Donald Duck Flustered Sorcerer: opponent's threshold becomes 25, controller's stays at 20", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "donald-duck-flustered-sorcerer", "play", { isDrying: false }));

    expect(getLoreThreshold(state, CARD_DEFINITIONS, "player1")).toBe(20);
    expect(getLoreThreshold(state, CARD_DEFINITIONS, "player2")).toBe(25);

    // player2 with 24 lore is NOT a winner; player1 with 20 IS.
    state = setLore(state, "player1", 20);
    state = setLore(state, "player2", 24);
    const r = checkWinConditions(state, CARD_DEFINITIONS);
    expect(r.isOver).toBe(true);
    expect(r.winner).toBe("player1");
  });

  it("Donald Duck: when only opponent has high lore but threshold is raised, no win yet", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player1", "donald-duck-flustered-sorcerer", "play", { isDrying: false }));
    state = setLore(state, "player2", 24);

    const r = checkWinConditions(state, CARD_DEFINITIONS);
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
    } as any, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player2", "deck").length).toBe(deckBefore - 1);
    expect(getZone(r.newState, "player2", "discard").length).toBe(discardBefore + 1);
  });
});

describe("§7 Set 7 — Baloo Ol' Iron Paws (damage_prevention_static source=all)", () => {
  it("a strong defender (≥7 STR) takes no challenge damage from an attacker", () => {
    // Baloo Ol' Iron Paws: "Your characters with 7 {S} or more can't be
    // dealt damage." Use Baloo himself as the 7+ STR character (verify his
    // printed STR ≥ 7). Opponent challenges with a ready attacker.
    let state = startGame();
    let baloo: string, attackerId: string;
    // Baloo's printed STR is 5; bump via TimedEffect to trip the
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
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Baloo took 0 damage (attacker STR 3 would have dealt 3).
    expect(getInstance(r.newState, baloo).damage).toBe(0);
  });
});

describe("§7 Set 7 — Queen of Hearts Unpredictable Bully (cross-player card_played trigger)", () => {
  it("puts a damage counter on opponent's character when they play one", () => {
    let state = startGame();
    let qohId: string;
    ({ state, instanceId: qohId } = injectCard(state, "player1", "queen-of-hearts-unpredictable-bully", "play", { isDrying: false }));
    // Pass to player2's turn
    state = passTurns(state, 1);
    state = giveInk(state, "player2", 5);
    let oppCharId: string;
    ({ state, instanceId: oppCharId } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));
    // Player2 plays Mickey — QoH should trigger and put 1 damage counter
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId: oppCharId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, oppCharId).damage).toBe(1);
  });

  it("puts a damage counter on own character when controller plays one", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let qohId: string;
    ({ state, instanceId: qohId } = injectCard(state, "player1", "queen-of-hearts-unpredictable-bully", "play", { isDrying: false }));
    let ownCharId: string;
    ({ state, instanceId: ownCharId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: ownCharId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, ownCharId).damage).toBe(1);
  });
});

describe("§6 Set 6 — Basil Disguised Detective TWISTS AND TURNS (opponent picks discard)", () => {
  it("chosen opponent picks which card to discard — chooser: target_player", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let basilId: string, quillId: string, handCardId: string;
    ({ state, instanceId: basilId } = injectCard(state, "player1", "basil-disguised-detective", "play", { isDrying: false }));
    ({ state, instanceId: quillId } = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false }));
    ({ state, instanceId: handCardId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));

    // Activate Fishbone Quill → ink a hand card → fires Basil's trigger
    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: quillId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    r = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [handCardId],
    }, CARD_DEFINITIONS);

    // Basil's TWISTS AND TURNS is a may — accept to pay 1 {I} and force discard.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    // Now a choose_discard should surface — choosingPlayerId must be player2
    // (the opponent picks which card to discard, not player1).
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_discard");
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player2");
  });
});

describe("§6 Set 6 — Oswald FAVORABLE CHANCE fires on effect-driven inkwell placement", () => {
  it("Fishbone Quill putting a hand card into inkwell triggers Oswald's card_put_into_inkwell watcher", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let oswaldId: string, quillId: string, handCardId: string;
    ({ state, instanceId: oswaldId } = injectCard(state, "player1", "oswald-the-lucky-rabbit", "play", { isDrying: false }));
    ({ state, instanceId: quillId } = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false }));
    ({ state, instanceId: handCardId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));

    // Activate Fishbone Quill → chooser → pick the mickey → put into inkwell
    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: quillId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    r = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [handCardId],
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Oswald's FAVORABLE CHANCE is a "you may reveal" — should produce a may choice.
    expect(r.newState.pendingChoice).toBeDefined();
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player1");
  });

  it("Oswald second 'may' — with matchIsMay, declining routes top-of-deck to noMatchDestination (bottom)", () => {
    // Force-stack the top of player1's deck with an item so we can deterministically
    // exercise the match + second-may branch.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let oswaldId: string;
    ({ state, instanceId: oswaldId } = injectCard(state, "player1", "oswald-the-lucky-rabbit", "play", { isDrying: false }));

    // Inject an item at top of the deck (append a new fishbone-quill then reorder).
    const { state: s2, instanceId: itemId } = injectCard(state, "player1", "fishbone-quill", "deck");
    state = s2;
    // Move the injected item to position 0 of the deck.
    const deck = [...getZone(state, "player1", "deck")];
    const idx = deck.indexOf(itemId);
    if (idx > 0) { deck.splice(idx, 1); deck.unshift(itemId); }
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, deck } } };

    // Trigger an inkwell-put to fire Oswald.
    let quillId: string, handCardId: string;
    ({ state, instanceId: quillId } = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false }));
    ({ state, instanceId: handCardId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: quillId, abilityIndex: 0 }, CARD_DEFINITIONS);
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [handCardId] }, CARD_DEFINITIONS);

    // First may: "may reveal top?". Accept to reveal.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Second may: "may play that item for free?". Decline → item routes to bottom (noMatchDestination).
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Item stayed in deck; landed at bottom (not played into play).
    expect(getInstance(r.newState, itemId).zone).toBe("deck");
    const finalDeck = getZone(r.newState, "player1", "deck");
    expect(finalDeck[finalDeck.length - 1]).toBe(itemId);
  });

  it("does not fire Oswald for the opponent's effect-driven inkwell placement", () => {
    let state = startGame();
    let oswaldId: string;
    ({ state, instanceId: oswaldId } = injectCard(state, "player1", "oswald-the-lucky-rabbit", "play", { isDrying: false }));
    // Move to opponent's turn so they can act
    state = passTurns(state, 1);
    state = giveInk(state, "player2", 5);
    let quillId: string, handCardId: string;
    ({ state, instanceId: quillId } = injectCard(state, "player2", "fishbone-quill", "play", { isDrying: false }));
    ({ state, instanceId: handCardId } = injectCard(state, "player2", "mickey-mouse-true-friend", "hand"));

    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player2", instanceId: quillId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    r = applyAction(r.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: [handCardId],
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Oswald's trigger.player is self — player1 (Oswald's owner) is not the inking player,
    // so the trigger is filtered out; also "During your turn" condition bars it.
    expect(r.newState.pendingChoice).toBeFalsy();
  });
});

// =============================================================================
// CRD 6.2.7.2 — Delayed Triggered Abilities
// =============================================================================

describe("§CRD 6.2.7.2 — Delayed Triggered Abilities", () => {
  it("Candy Drift: chosen character gets +5 {S} this turn, banished at end of turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    // Put a character in play to target
    let charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    // Put Candy Drift in hand
    let candyId: string;
    ({ state, instanceId: candyId } = injectCard(state, "player1", "candy-drift", "hand"));

    // Play Candy Drift — it asks to choose a character
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: candyId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Should have pending choice to pick target character
    expect(state.pendingChoice?.type).toBe("choose_target");

    // Choose the character
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Character should still be in play with a delayed trigger queued
    expect(getInstance(state, charId).zone).toBe("play");
    expect(state.delayedTriggers).toBeDefined();
    expect(state.delayedTriggers!.length).toBe(1);
    expect(state.delayedTriggers![0].firesAt).toBe("end_of_turn");

    // Pass turn — delayed trigger should banish the character
    r = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Character should be banished (in discard)
    expect(getInstance(state, charId).zone).toBe("discard");
    // Delayed triggers should be cleaned up
    expect(state.delayedTriggers?.length ?? 0).toBe(0);
  });

  it("Candy Drift: if character leaves play before end of turn, delayed trigger fizzles", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    let candyId: string;
    ({ state, instanceId: candyId } = injectCard(state, "player1", "candy-drift", "hand"));

    // Play Candy Drift and choose target
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: candyId }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId] }, CARD_DEFINITIONS);
    state = r.newState;
    expect(state.delayedTriggers!.length).toBe(1);

    // Simulate character leaving play (e.g., banished by opponent's challenge)
    // Move to discard zone directly
    const zones = state.zones;
    const p1Play = zones.player1.play.filter((id: string) => id !== charId);
    const p1Discard = [...zones.player1.discard, charId];
    state = {
      ...state,
      cards: { ...state.cards, [charId]: { ...state.cards[charId], zone: "discard" } },
      zones: { ...zones, player1: { ...zones.player1, play: p1Play, discard: p1Discard } },
    };

    // Pass turn — delayed trigger should fizzle (character already left play)
    r = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Character should still be in discard (not double-banished)
    expect(getInstance(state, charId).zone).toBe("discard");
    expect(state.delayedTriggers?.length ?? 0).toBe(0);
  });
});

// =============================================================================
// CRD 6.4.2.1 — Continuous Static Abilities from Resolved Effects
// =============================================================================

describe("§CRD 6.4.2.1 — Continuous Statics (global timed effects)", () => {
  it("Restoring Atlantis: characters played AFTER resolution also can't be challenged", () => {
    let state = startGame();
    state = giveInk(state, "player1", 15);

    // Play Restoring Atlantis
    let raId: string;
    ({ state, instanceId: raId } = injectCard(state, "player1", "restoring-atlantis", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: raId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // GlobalTimedEffect should exist
    expect(state.globalTimedEffects).toBeDefined();
    expect(state.globalTimedEffects!.length).toBe(1);
    expect(state.globalTimedEffects![0].type).toBe("cant_be_challenged");

    // Now play a character AFTER Restoring Atlantis resolved
    let charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: charId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // The new character should also be protected — check via gameModifiers
    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.cantBeChallenged.has(charId)).toBe(true);
  });

  it("Restoring Atlantis: global effect expires at start of caster's next turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 15);

    let raId: string;
    ({ state, instanceId: raId } = injectCard(state, "player1", "restoring-atlantis", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: raId }, CARD_DEFINITIONS);
    state = r.newState;

    expect(state.globalTimedEffects!.length).toBe(1);

    // Pass turn to player2, then back to player1 — effect should expire
    r = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, CARD_DEFINITIONS);
    state = r.newState;

    // Global effect should be expired
    expect(state.globalTimedEffects?.length ?? 0).toBe(0);
  });
});

describe("§5 Set 5 — reveal_top_conditional fires card_revealed events", () => {
  it("Daisy Duck Donald's Date BIG PRIZE: opponent top card is publicly revealed", () => {
    let state = startGame();
    state.currentPlayer = "player1";
    let daisyId: string;
    ({ state, instanceId: daisyId } = injectCard(state, "player1", "daisy-duck-donalds-date", "play", { isDrying: false }));

    const opponentTopId = getZone(state, "player2", "deck")[0]!;

    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: daisyId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // The top card of opponent's deck should have been publicly revealed
    // (regardless of whether it matched the character filter).
    const revealEvents = r.events.filter(e => e.type === "card_revealed");
    expect(revealEvents.some(e => e.instanceId === opponentTopId)).toBe(true);
  });

  // Oracle: "each opponent reveals the top card of their deck. If it's a
  // character card, THEY may put it into their hand." The "may" belongs to
  // the opponent, not the Daisy controller. Pre-fix the handler hardcoded
  // the may-prompt's choosingPlayerId to controllingPlayerId (the Daisy
  // side), so the wrong player would be asked.
  it("Daisy Duck Donald's Date BIG PRIZE: the opponent is the chooser of the 'may put into hand' prompt", () => {
    let state = startGame();
    state.currentPlayer = "player1";
    let daisyId: string;
    ({ state, instanceId: daisyId } = injectCard(state, "player1", "daisy-duck-donalds-date", "play", { isDrying: false }));

    // Force a character on top of player2's deck so the filter matches.
    let oppTop: string;
    ({ state, instanceId: oppTop } = injectCard(state, "player2", "pumbaa-friendly-warthog", "deck"));
    state = {
      ...state,
      zones: {
        ...state.zones,
        player2: {
          ...state.zones.player2,
          deck: [oppTop, ...state.zones.player2.deck.filter(id => id !== oppTop)],
        },
      },
    };

    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: daisyId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // A choose_may must surface, and the chooser must be the opponent.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player2");

    // Opponent accepts → card goes to THEIR hand (not the controller's).
    const r2 = applyAction(
      r.newState,
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept" },
      CARD_DEFINITIONS
    );
    expect(r2.success).toBe(true);
    expect(r2.newState.cards[oppTop].zone).toBe("hand");
    expect(r2.newState.cards[oppTop].ownerId).toBe("player2");
    expect(getZone(r2.newState, "player2", "hand")).toContain(oppTop);
  });
});

describe("§5 Set 5 — Robin Hood Sharpshooter MY GREATEST PERFORMANCE (peek_and_set_target chain)", () => {
  it("peeks top 4, plays picked action, rest to discard", () => {
    let state = startGame();
    state.currentPlayer = "player1";

    // Put Robin Hood in play (dry)
    let robinId: string;
    ({ state, instanceId: robinId } = injectCard(state, "player1", "robin-hood-sharpshooter", "play", { isDrying: false }));

    // Inject Be Our Guest (action cost 2) on top of deck.
    let bogId: string;
    ({ state, instanceId: bogId } = injectCard(state, "player1", "be-our-guest", "deck"));
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: {
          ...state.zones.player1,
          deck: [bogId, ...state.zones.player1.deck.filter(id => id !== bogId)],
        },
      },
    };
    const discardBefore = state.zones.player1.discard.length;

    // Quest — triggers MY GREATEST PERFORMANCE (isMay)
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: robinId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Accept the may prompt
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Chain result: BoG was played (its actionEffects resolved, action card
    // moved to discard). The 3 non-matching top cards also went to discard
    // via restPlacement: "discard". There may be subsequent pendingChoices
    // from BoG's own look_at_top — that's fine.
    expect(getInstance(state, bogId).zone).not.toBe("deck");
    expect(state.zones.player1.discard.length).toBeGreaterThanOrEqual(discardBefore + 3);
  });
});

describe("§5 Set 5 — Elsa The Fifth Spirit CRYSTALLIZE (chosen_by_opponent + Vanish hook)", () => {
  // Regression for 2026-04-21 crash: reducer.ts:2478 passed
  // `vanishMods.grantedKeywords.get(targetId)` (a { keyword; value? }[] array)
  // as the `modifiers` argument to hasKeyword(), but hasKeyword expects
  // `{ suppressedKeywords: Map<...> }`. When the chosen target had ANY
  // statically-granted keyword, modifiers.suppressedKeywords was undefined
  // and `undefined.get(...)` threw "Cannot read properties of undefined
  // (reading 'get')". Repro: play Flotsam + Jetsam on opponent side — Flotsam's
  // DEXTEROUS LUNGE static grants Jetsam Rush, populating
  // modifiers.grantedKeywords.get(jetsamId). Then play Elsa Fifth Spirit and
  // pick Jetsam for CRYSTALLIZE's chosen-opposing-character choice.
  it("resolves choose_target on opposing character with granted keyword without throwing", () => {
    let state = startGame();
    state.currentPlayer = "player1";
    state = giveInk(state, "player1", 10);

    // Opponent (player2) has Flotsam + Jetsam in play. Flotsam's static
    // grants Rush to Jetsam, populating modifiers.grantedKeywords for Jetsam.
    ({ state } = injectCard(state, "player2", "flotsam-ursulas-spy", "play", { isDrying: false }));
    let jetsamId: string;
    ({ state, instanceId: jetsamId } = injectCard(state, "player2", "jetsam-ursulas-spy", "play", { isDrying: false }));

    // Verify the grant wired up — this is what triggered the crash.
    const preMods = getGameModifiers(state, CARD_DEFINITIONS);
    const granted = preMods.grantedKeywords.get(jetsamId) ?? [];
    expect(granted.some(g => g.keyword === "rush")).toBe(true);

    // Player1 plays Elsa — CRYSTALLIZE triggers enters_play → choose_target
    // "exert chosen opposing character".
    let elsaId: string;
    ({ state, instanceId: elsaId } = injectCard(state, "player1", "elsa-the-fifth-spirit", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: elsaId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(jetsamId);

    // Resolving the choice with Jetsam used to throw. Now it should succeed.
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [jetsamId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Jetsam is now exerted.
    expect(getInstance(state, jetsamId).isExerted).toBe(true);
    // Jetsam does NOT have Vanish, so it stayed in play.
    expect(getInstance(state, jetsamId).zone).toBe("play");
  });
});

describe("§8 Set 8 — Lady Decisive Dog", () => {
  it("TAKE THE LEAD: +2 lore when strength >= 3 via Snowfort static + timed buffs", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    state.currentPlayer = "player1";

    // Lady in play (0 str base, 1 lore base)
    let ladyId: string;
    ({ state, instanceId: ladyId } = injectCard(state, "player1", "lady-decisive-dog", "play", { isDrying: false }));

    // Snowfort in play — static +1 str to all your characters
    ({ state } = injectCard(state, "player1", "snow-fort", "play"));

    // Play 2 characters to trigger PACK OF HER OWN twice → +2 str timed
    let c1: string, c2: string;
    ({ state, instanceId: c1 } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    ({ state, instanceId: c2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: c1 }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: c2 }, CARD_DEFINITIONS);
    state = r.newState;

    // Lady: 0 base + 2 timed + 1 static (Snowfort) = 3 str → TAKE THE LEAD active
    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const loreBonus = mods.statBonuses.get(ladyId)?.lore ?? 0;
    expect(loreBonus).toBe(2); // +2 lore from TAKE THE LEAD

    // Quest: 1 base + 2 static = 3 lore
    r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ladyId }, CARD_DEFINITIONS);
    state = r.newState;
    expect(state.players.player1.lore).toBe(3);
  });
});

describe("§7 Set 7 — granted-free-play alt-cost chooser (Belle, Scrooge)", () => {
  it("Belle Apprentice Inventor WHAT A MESS: chooser lets player pick which item to banish", () => {
    let state = startGame();
    let belleId: string, itemA: string, itemB: string;
    ({ state, instanceId: belleId } = injectCard(state, "player1", "belle-apprentice-inventor", "hand"));
    ({ state, instanceId: itemA } = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false }));
    ({ state, instanceId: itemB } = injectCard(state, "player1", "eye-of-the-fates", "play", { isDrying: false }));

    // One action surfaces (no per-item fanout).
    const legal = getAllLegalActions(state, "player1", CARD_DEFINITIONS);
    const bellePlays = legal.filter(a => a.type === "PLAY_CARD" && a.instanceId === belleId && (a as any).viaGrantedFreePlay);
    expect(bellePlays.length).toBe(1);

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: belleId, viaGrantedFreePlay: true }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    expect(r.newState.pendingChoice?.validTargets).toEqual(expect.arrayContaining([itemA, itemB]));

    // Pick itemB to banish.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [itemB] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getInstance(r.newState, itemB).zone).toBe("discard");
    expect(getInstance(r.newState, itemA).zone).toBe("play");
    expect(getInstance(r.newState, belleId).zone).toBe("play");
    expect(getInstance(r.newState, belleId).isDrying).toBe(true);
  });

  it("Belle chooser validates: must pick exactly one item", () => {
    let state = startGame();
    let belleId: string, itemA: string;
    ({ state, instanceId: belleId } = injectCard(state, "player1", "belle-apprentice-inventor", "hand"));
    ({ state, instanceId: itemA } = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false }));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: belleId, viaGrantedFreePlay: true }, CARD_DEFINITIONS);
    // Zero picks → validator rejects.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Scrooge McDuck Resourceful Miser PUT IT TO GOOD USE: chooser picks exactly 4 items to exert", () => {
    let state = startGame();
    let scroogeId: string;
    ({ state, instanceId: scroogeId } = injectCard(state, "player1", "scrooge-mcduck-resourceful-miser", "hand"));
    const items: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = injectCard(state, "player1", "fishbone-quill", "play", { isDrying: false });
      state = r.state;
      items.push(r.instanceId);
    }
    // Free-play action surfaces.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: scroogeId, viaGrantedFreePlay: true }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    expect(r.newState.pendingChoice?.count).toBe(4);

    // Picking 3 items → validator rejects (exactly 4 required).
    let bad = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: items.slice(0, 3) }, CARD_DEFINITIONS);
    expect(bad.success).toBe(false);

    // Pick 4 items → resolve.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: items.slice(0, 4) }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    for (let i = 0; i < 4; i++) expect(getInstance(r.newState, items[i]!).isExerted).toBe(true);
    expect(getInstance(r.newState, items[4]!).isExerted).toBe(false);
    expect(getInstance(r.newState, scroogeId).zone).toBe("play");
    expect(getInstance(r.newState, scroogeId).isDrying).toBe(true);
  });
});

describe("§8 Set 8 — Alma Madrigal Accepting Grandmother THE MIRACLE IS YOU (last_song_singers)", () => {
  it("Sing Together: readies ALL singers from the one song event", () => {
    // "Once during your turn, whenever one or more of your characters sings
    // a song, you may ready those characters." For Sing Together, the
    // multiple singers all get readied; for solo sings, just the one.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    state.currentPlayer = "player1";
    let almaId: string, songId: string, s1: string, s2: string;
    ({ state, instanceId: almaId } = injectCard(state, "player1", "alma-madrigal-accepting-grandmother", "play", { isDrying: false }));
    void almaId;
    // a-pirates-life is Sing Together 6. Two cost-3 characters can sing it.
    ({ state, instanceId: songId } = injectCard(state, "player1", "a-pirates-life", "hand"));
    ({ state, instanceId: s1 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: s2 } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    let r = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId,
      singerInstanceIds: [s1, s2],
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Both singers exerted from singing.
    expect(getInstance(state, s1).isExerted).toBe(true);
    expect(getInstance(state, s2).isExerted).toBe(true);

    // Alma's may-prompt for THE MIRACLE IS YOU.
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Both singers should be readied.
    expect(getInstance(state, s1).isExerted).toBe(false);
    expect(getInstance(state, s2).isExerted).toBe(false);
  });
});

// =============================================================================
// Captain Amelia - Commander of the Legacy — EVERYTHING SHIPSHAPE grants
// <Resist> +1 to your OTHER characters while they're being challenged.
// Regression: `grantKeywordWhileBeingChallenged` Map was populated but the
// challenge damage resolver never consulted it, so the granted resist
// silently no-oped. Fix: defender's keyword grants merged with the
// "while being challenged" entries at CRD 8.8.1 resist calculation.
// Scope is narrow — the resist is active ONLY during the specific challenge
// resolution, not bled into modifiers.grantedKeywords.
// =============================================================================

describe("§6 Set 6 — Captain Amelia EVERYTHING SHIPSHAPE (grant_keyword_while_being_challenged)", () => {
  it("friendly defender takes 1 less damage while being challenged when Amelia is in play", () => {
    let state = startGame();
    // Captain Amelia anchors the "while being challenged" grant.
    ({ state } = injectCard(state, "player1", "captain-amelia-commander-of-the-legacy", "play", { isDrying: false }));
    // Friendly defender — Minnie Mouse Beloved Princess (2/3) — exerted so
    // she can be challenged.
    let defenderId: string;
    ({ state, instanceId: defenderId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false, isExerted: true }));

    // Swap to player2 and challenge with a 2-str attacker.
    state = passTurns(state, 1);
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "sebastian-court-composer", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player2",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Attacker str 2 minus Resist +1 = 1 damage to defender.
    expect(getInstance(r.newState, defenderId).damage).toBe(1);
  });

  it("negative control: without Amelia, same challenge deals full damage", () => {
    let state = startGame();
    let defenderId: string;
    ({ state, instanceId: defenderId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false, isExerted: true }));
    state = passTurns(state, 1);
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "sebastian-court-composer", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player2",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Full 2 damage with no resist grant.
    expect(getInstance(r.newState, defenderId).damage).toBe(2);
  });

  it("grant scope is narrow — the resist is NOT present outside a challenge context", () => {
    // Probe `getEffectiveKeywords`-style lookup: the while-being-challenged
    // grant should NOT appear in modifiers.grantedKeywords. Using a direct
    // call to getGameModifiers and spot-checking the two Maps.
    let state = startGame();
    ({ state } = injectCard(state, "player1", "captain-amelia-commander-of-the-legacy", "play", { isDrying: false }));
    let friendId: string;
    ({ state, instanceId: friendId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: false }));

    // getGameModifiers is imported at the top of this file.
    const mods = getGameModifiers(state, CARD_DEFINITIONS);

    // The friendly defender should NOT have resist baked into
    // `grantedKeywords` — that's the whole point of the separate Map.
    const permanent = mods.grantedKeywords.get(friendId) ?? [];
    expect(permanent.some((g: any) => g.keyword === "resist")).toBe(false);

    // But the while-being-challenged Map SHOULD carry the grant.
    const whileBeingChallenged = mods.grantKeywordWhileBeingChallenged.get(friendId) ?? [];
    expect(whileBeingChallenged).toContainEqual({ keyword: "resist", value: 1 });
  });
});

// =============================================================================
// Pull the Lever! — "Choose one: • Draw 2 cards. • Each opponent chooses and
// discards a card." Regression: the choose_option RESOLVE_CHOICE branch
// returned without calling cleanupPendingAction, leaving the action card
// stuck in play after its effect resolved. CRD 4.3.3.2: actions go to
// discard after their effect + all sub-choices resolve.
// =============================================================================

describe("§8 Set 8 — Pull the Lever! (choose_option action cleanup)", () => {
  // interactive=true forces the choose handler to surface a pendingChoice
  // instead of auto-resolving. The bug (action stuck in play) only
  // manifests in this mode — which is what the sandbox/UI hits.
  const interactiveStartGame = () => ({ ...startGame(), interactive: true } as const);

  it("draws 2 cards and moves to discard after choose_option resolves", () => {
    let state = interactiveStartGame();
    state = giveInk(state, "player1", 3);
    const handBefore = getZone(state, "player1", "hand").length;

    let pullId: string;
    ({ state, instanceId: pullId } = injectCard(state, "player1", "pull-the-lever", "hand"));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: pullId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.pendingChoice?.type).toBe("choose_option");
    // Action still in play while the choice is pending.
    expect(getInstance(state, pullId).zone).toBe("play");

    // Pick option 0 — "Draw 2 cards."
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Action moves to discard after resolve (regression: previously stuck in play).
    expect(getInstance(state, pullId).zone).toBe("discard");
    // Draw applied: hand net +2 from where it was at inject-time (one leaves on
    // play, two draw in).
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 2);
    // No residual pending state.
    expect(state.pendingChoice).toBeFalsy();
    expect(state.pendingActionInstanceId).toBeUndefined();
  });

  it("opponent-discard branch also cleans up the action after the nested sub-choice resolves", () => {
    // Option 1 opens a nested choose_discard for the opponent. Both choices
    // must resolve before the action moves to discard.
    let state = interactiveStartGame();
    state = giveInk(state, "player1", 3);

    let pullId: string;
    ({ state, instanceId: pullId } = injectCard(state, "player1", "pull-the-lever", "hand"));

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: pullId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.pendingChoice?.type).toBe("choose_option");

    // Pick option 1 — "Each opponent chooses and discards a card."
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: 1 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Nested pendingChoice for opponent to pick which card to discard.
    expect(state.pendingChoice?.type).toBe("choose_discard");
    // Pull should still be in play while the nested choice is pending.
    expect(getInstance(state, pullId).zone).toBe("play");

    // Opponent discards a hand card.
    const oppHand = getZone(state, "player2", "hand");
    expect(oppHand.length).toBeGreaterThan(0);
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppHand[0]!] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Now Pull should be in discard.
    expect(getInstance(state, pullId).zone).toBe("discard");
    expect(state.pendingChoice).toBeFalsy();
  });
});
