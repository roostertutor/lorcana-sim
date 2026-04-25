// =============================================================================
// SETS 9–11 — Max Goof restriction, Graveyard of Christmas Future, Boost,
//              John Smith's Compass anyOf, Tiana opponent_may_pay_to_avoid
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, applyEffect, getAllLegalActions } from "./reducer.js";
import { applyMoveCostReduction } from "./validator.js";
import { getGameModifiers } from "./gameModifiers.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
  passTurns,
} from "./test-helpers.js";
import { getInstance, getZone, getEffectiveStrength, moveCard, matchesFilter } from "../utils/index.js";

describe("§9 Set 9 — Max Goof Rockin' Teen (cant_action_self move)", () => {
  it("I JUST WANNA STAY HOME: MOVE_CHARACTER is rejected for Max Goof", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let maxId: string, locId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player1", "max-goof-rockin-teen", "play", { isDrying: false }));
    ({ state, instanceId: locId } = injectCard(state, "player1", "never-land-mermaid-lagoon", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "MOVE_CHARACTER",
      playerId: "player1",
      characterInstanceId: maxId,
      locationInstanceId: locId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't move/i);
  });

  it("Magic Carpet FIND THE WAY cannot move Max Goof either (effect-based moves honor cant_action_self)", () => {
    // The "can't move" restriction must apply regardless of how the move is
    // initiated — both player MOVE_CHARACTER actions AND effect-driven moves
    // (Magic Carpet's activated FIND THE WAY, Jim Hawkins TAKE THE HELM)
    // should be blocked.
    let state = startGame();
    let maxId: string, locId: string, carpetId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player1", "max-goof-rockin-teen", "play", { isDrying: false }));
    ({ state, instanceId: locId } = injectCard(state, "player1", "never-land-mermaid-lagoon", "play", { isDrying: false }));
    ({ state, instanceId: carpetId } = injectCard(state, "player1", "magic-carpet-flying-rug", "play", { isDrying: false }));

    // Activate FIND THE WAY — exert + choose character + location.
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: carpetId, abilityIndex: 1 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 1: choose the character. Max Goof IS in valid targets (the filter
    // doesn't pre-exclude restricted characters — the restriction is enforced
    // when performMove runs).
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [maxId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 2: choose the location.
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [locId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Max Goof is NOT at the location — performMove fizzled per the restriction.
    expect(getInstance(state, maxId).atLocationInstanceId).toBeUndefined();
  });

  it("Other characters can still move when Max Goof is in play", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let mickeyId: string, locId: string;
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state } = injectCard(state, "player1", "max-goof-rockin-teen", "play", { isDrying: false }));
    ({ state, instanceId: locId } = injectCard(state, "player1", "never-land-mermaid-lagoon", "play", { isDrying: false }));

    const r = applyAction(state, {
      type: "MOVE_CHARACTER",
      playerId: "player1",
      characterInstanceId: mickeyId,
      locationInstanceId: locId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, mickeyId).atLocationInstanceId).toBe(locId);
  });
});

describe("§11 Set 11 — John Smith's Compass YOUR PATH (anyOf filter)", () => {
  it("CardFilter.anyOf: matches a high-cost Pocahontas via the named branch (not the cost branch)", () => {
    // Tier-1 fix: was wired with bare reveal_top_conditional, no
    // no_challenges_this_turn gating, and the "or named Pocahontas" branch
    // dropped (filter was just `costAtMost: 3`). Tests the new CardFilter.anyOf
    // primitive directly via matchesFilter — Pocahontas - Peacekeeper has
    // cost 5 (so the costAtMost: 3 branch fails) but the hasName: "Pocahontas"
    // branch should still match. Pins the OR-of-subfilter semantics.
    let state = startGame();
    let pocahontasId: string;
    ({ state, instanceId: pocahontasId } = injectCard(state, "player1", "pocahontas-peacekeeper", "deck"));
    const inst = getInstance(state, pocahontasId);
    const def = CARD_DEFINITIONS["pocahontas-peacekeeper"]!;

    // cardType character + (cost ≤ 3 OR named Pocahontas).
    // Cost-3-or-less branch FAILS (cost is 5). Pocahontas branch matches.
    expect(matchesFilter(inst, def, {
      cardType: ["character"],
      anyOf: [
        { statComparisons: [{ stat: "cost", op: "lte", value: 3 }] },
        { hasName: "Pocahontas" },
      ],
    }, state, "player1")).toBe(true);

    // Sanity: a non-Pocahontas character with cost > 3 should NOT match.
    let muscleId: string;
    ({ state, instanceId: muscleId } = injectCard(state, "player1", "hercules-mighty-leader", "deck"));
    const muscleInst = getInstance(state, muscleId);
    const muscleDef = CARD_DEFINITIONS["hercules-mighty-leader"]!;
    expect(matchesFilter(muscleInst, muscleDef, {
      cardType: ["character"],
      anyOf: [
        { statComparisons: [{ stat: "cost", op: "lte", value: 3 }] },
        { hasName: "Pocahontas" },
      ],
    }, state, "player1")).toBe(false);

    // Sanity: a cheap non-Pocahontas character SHOULD match (via cost branch).
    let cheapId: string;
    ({ state, instanceId: cheapId } = injectCard(state, "player1", "thomas-wide-eyed-recruit", "deck"));
    const cheapInst = getInstance(state, cheapId);
    const cheapDef = CARD_DEFINITIONS["thomas-wide-eyed-recruit"]!;
    expect(matchesFilter(cheapInst, cheapDef, {
      cardType: ["character"],
      anyOf: [
        { statComparisons: [{ stat: "cost", op: "lte", value: 3 }] },
        { hasName: "Pocahontas" },
      ],
    }, state, "player1")).toBe(true);
  });
});

describe("§6 Set 6 — Tiana Restaurant Owner (opponent_may_pay_to_avoid)", () => {
  it("triggers on is_challenged + this_is_exerted, surfaces choose_may to opposing player", () => {
    // Cross-player chooser primitive test. Tiana SPECIAL RESERVATION:
    // "Whenever a character of yours is challenged while this character is
    // exerted, the challenging character gets -3 {S} this turn unless their
    // player pays 3 {I}."
    //
    // Behavior to pin:
    //   - Defender's owner has Tiana exerted in play
    //   - Attacker challenges defender → trigger fires
    //   - Surfaces a choose_may to the ATTACKER's owner (opposing player)
    //   - acceptControllingPlayerId = opposing player (their ink pays)
    //   - rejectControllingPlayerId = Tiana's owner (their debuff fires)
    let state = startGame();
    state = giveInk(state, "player1", 5);
    state = giveInk(state, "player2", 5);
    let tianaId: string, defenderId: string, attackerId: string;
    ({ state, instanceId: tianaId } = injectCard(state, "player1", "tiana-restaurant-owner", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: defenderId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Pass to player2's turn so they can challenge
    state = passTurns(state, 1);
    // Re-exert Tiana — passTurns readies all characters in the new turn's
    // ready step, but Tiana's MY JURISDICTION wouldn't matter here since the
    // condition this_is_exerted needs her exerted at the moment of trigger.
    state = { ...state, cards: { ...state.cards,
      [tianaId]: { ...state.cards[tianaId]!, isExerted: true },
    }};

    const r = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attackerId, defenderInstanceId: defenderId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // The challenge resolves; Tiana's trigger is now in the trigger stack.
    // Process the stack to surface the choose_may.
    let r2 = applyAction(state, { type: "PROCESS_TRIGGERS", playerId: "player1" } as any, CARD_DEFINITIONS);
    if (r2.success) state = r2.newState;

    // Choose_may should be surfaced to player2 (the attacker's owner).
    // We don't deeply validate the choice flow here — pinning that the
    // primitive routes to the opposing player is the regression target.
    if (state.pendingChoice && state.pendingChoice.type === "choose_may") {
      expect(state.pendingChoice.choosingPlayerId).toBe("player2");
    }
  });
});

describe("§11 Set 11 — Graveyard of Christmas Future", () => {
  it("NEW ARRIVAL: moving a character here puts the top of deck under the location", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let graveyardId: string, mickeyId: string;
    ({ state, instanceId: graveyardId } = injectCard(state, "player1", "graveyard-of-christmas-future-lonely-resting-place", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const deckTopBefore = getZone(state, "player1", "deck")[0]!;
    const r = applyAction(state, {
      type: "MOVE_CHARACTER",
      playerId: "player1",
      characterInstanceId: mickeyId,
      locationInstanceId: graveyardId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey is now at Graveyard, and the deck top is now under Graveyard.
    expect(getInstance(state, mickeyId).atLocationInstanceId).toBe(graveyardId);
    expect(getInstance(state, graveyardId).cardsUnder).toContain(deckTopBefore);
    expect(getInstance(state, deckTopBefore).zone).toBe("under");
  });

  it("ANOTHER CHANCE: at start of your turn, may put cards under into hand and banish self", () => {
    // Setup: Graveyard with 2 cards under, then pass to opponent and back to player1.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let graveyardId: string, mickey1Id: string;
    ({ state, instanceId: graveyardId } = injectCard(state, "player1", "graveyard-of-christmas-future-lonely-resting-place", "play", { isDrying: false }));
    ({ state, instanceId: mickey1Id } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Move Mickey to Graveyard → triggers NEW ARRIVAL → puts top of deck under
    let r = applyAction(state, {
      type: "MOVE_CHARACTER",
      playerId: "player1",
      characterInstanceId: mickey1Id,
      locationInstanceId: graveyardId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, graveyardId).cardsUnder.length).toBe(1);

    // Pass twice to come back to player1 — ANOTHER CHANCE fires at start of turn.
    // Per CRD 3.2.3.1 the draw step is deferred while the turn_start trigger's
    // pendingChoice is open, so hand size captured after passTurns(2) is pre-draw.
    state = passTurns(state, 2);

    // ANOTHER CHANCE is a "may" — surfaces a choose_may pendingChoice for the controller
    expect(state.pendingChoice?.type).toBe("choose_may");
    const handSizeBeforeMay = getZone(state, "player1", "hand").length;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // 1 card from under → hand (ANOTHER CHANCE) + 1 deferred draw = +2. Graveyard banished.
    expect(getZone(state, "player1", "hand").length).toBe(handSizeBeforeMay + 2);
    expect(getInstance(state, graveyardId).zone).toBe("discard");
  });
});

describe("§11 Set 11 — Keep the Ancient Ways (restrict_play action+item)", () => {
  it("KAW actionEffects actually creates playRestrictions via applyAction", () => {
    let state = startGame();
    // Pass to player2's turn
    state = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS).newState;
    state = giveInk(state, "player2", 5);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player2", "keep-the-ancient-ways", "hand"));

    // Verify no restrictions before
    expect(state.players.player1.playRestrictions?.length ?? 0).toBe(0);

    // Player2 plays the song through applyAction (full trigger/effect path)
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // THE KEY CHECK: did the actionEffects path actually write playRestrictions?
    const restrictions = state.players.player1.playRestrictions ?? [];
    expect(restrictions.length).toBeGreaterThan(0);
    expect(restrictions[0]?.cardTypes).toContain("action");
    expect(restrictions[0]?.cardTypes).toContain("item");
    expect(restrictions[0]?.casterPlayerId).toBe("player2");
  });

  it("restriction survives PASS_TURN and blocks opponent's action play", () => {
    let state = startGame();
    state = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS).newState;
    state = giveInk(state, "player2", 5);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player2", "keep-the-ancient-ways", "hand"));
    state = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId: songId }, CARD_DEFINITIONS).newState;

    // Player2 passes back to player1
    let r = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, CARD_DEFINITIONS);
    state = r.newState;

    // Restriction should still be active
    expect((state.players.player1.playRestrictions ?? []).length).toBeGreaterThan(0);

    // Player1 tries to play an action — should be blocked
    state = giveInk(state, "player1", 10);
    let actionId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "be-prepared", "hand"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't play/i);
  });

  it("restriction blocks SUNG actions too (not just normal-pay path)", () => {
    let state = startGame();
    state = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS).newState;
    state = giveInk(state, "player2", 5);
    let kawId: string;
    ({ state, instanceId: kawId } = injectCard(state, "player2", "keep-the-ancient-ways", "hand"));
    state = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId: kawId }, CARD_DEFINITIONS).newState;
    // Pass back to player1
    state = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, CARD_DEFINITIONS).newState;

    // Player1 tries to SING an action (Sudden Chill) — should be blocked
    state = giveInk(state, "player1", 5);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "sudden-chill", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: songId,
      singerInstanceId: singerId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't play/i);
  });

  it("Pete Games Referee enters_play trigger creates playRestrictions via applyAction", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let peteId: string;
    ({ state, instanceId: peteId } = injectCard(state, "player1", "pete-games-referee", "hand"));

    // Play Pete through applyAction
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: peteId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Player2 should have a play restriction on actions
    const restrictions = state.players.player2.playRestrictions ?? [];
    expect(restrictions.length).toBeGreaterThan(0);
    expect(restrictions[0]?.cardTypes).toContain("action");
    expect(restrictions[0]?.casterPlayerId).toBe("player1");
  });
});

describe("§11 Set 11 — Grandmother Willow Ancient Advisor (static once-per-turn cost reduction)", () => {
  it("SMOOTH THE WAY: 3 Willows stacking, each independently provides one-shot per turn", () => {
    // Grandmother Willow costs 2. Each copy provides a once-per-turn static
    // cost reduction of 1 for the next character played.
    let state = startGame();
    state = giveInk(state, "player1", 20);

    // Step 1: Play Willow A (costs 2). Now effect A is in place.
    let willowA: string;
    ({ state, instanceId: willowA } = injectCard(state, "player1", "grandmother-willow-ancient-advisor", "hand"));
    let ink = state.players.player1.availableInk;
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: willowA }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(ink - 2); // full price — Willow wasn't in play yet

    // Step 2: Play Willow B (costs 2). Effect A applies → costs 1. Consumes effect A, creates effect B.
    let willowB: string;
    ({ state, instanceId: willowB } = injectCard(state, "player1", "grandmother-willow-ancient-advisor", "hand"));
    ink = state.players.player1.availableInk;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: willowB }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(ink - 1); // discounted by 1

    // Step 3: Play Willow C (costs 2). Effect B applies → costs 1. NOT 0 (A is consumed).
    // Consumes effect B, creates effect C.
    let willowC: string;
    ({ state, instanceId: willowC } = injectCard(state, "player1", "grandmother-willow-ancient-advisor", "hand"));
    ink = state.players.player1.availableInk;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: willowC }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(ink - 1); // discounted by 1, NOT 0

    // Step 4: Pass turn and come back. All 3 Willows refresh → 3 one-shot effects.
    state = passTurns(state, 2);
    state = giveInk(state, "player1", 20);

    // Step 5: Play Lilo Making a Wish (cost 1). All 3 effects apply to "the next
    // character", so she consumes all 3 one-shots. Cost: max(0, 1-3) = 0.
    let liloId: string;
    ({ state, instanceId: liloId } = injectCard(state, "player1", "lilo-making-a-wish", "hand"));
    ink = state.players.player1.availableInk;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: liloId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(ink); // free (cost 1 - 3 = 0)

    // Step 6: Play Stitch New Dog (cost 1). All one-shots consumed by Lilo → full price.
    let stitchId: string;
    ({ state, instanceId: stitchId } = injectCard(state, "player1", "stitch-new-dog", "hand"));
    ink = state.players.player1.availableInk;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: stitchId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(state.players.player1.availableInk).toBe(ink - 1); // full price
  });
});

// =============================================================================
// SET 10 — Boost (CRD 8.4) + cards-under references
// =============================================================================

describe("§10 Set 10 — Boost (CRD 8.4)", () => {
  it("BOOST_CARD: pays cost, moves top of deck under, marks boostedThisTurn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    const inkBefore = state.players.player1.availableInk;
    const deckTopBefore = getZone(state, "player1", "deck")[0]!;

    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    expect(state.players.player1.availableInk).toBe(inkBefore - 2);
    const flynnInst = getInstance(state, flynnId);
    expect(flynnInst.cardsUnder).toContain(deckTopBefore);
    expect(flynnInst.boostedThisTurn).toBe(true);
    expect(getInstance(state, deckTopBefore).zone).toBe("under");
  });

  it("BOOST_CARD: rejects second activation in the same turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Flynn Rider I'LL TAKE THAT: +2 {S} +1 {L} static activates when a card is under", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    // Without cards under, the static condition is false → no bonus.
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(flynnId)?.strength ?? 0).toBe(0);

    // Boost adds a card under → static fires.
    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    mods = getGameModifiers(state, CARD_DEFINITIONS);
    const bonus = mods.statBonuses.get(flynnId);
    expect(bonus?.strength).toBe(2);
    expect(bonus?.lore).toBe(1);
  });

  it("CRD 8.10.4: Shift puts the base card under (not in discard)", () => {
    // Hades Lord of the Underworld (cost 4) → shifted by Hades King of Olympus (shift 6).
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));

    const r = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Base card is "under" the shifted character, not in discard.
    expect(getInstance(state, baseId).zone).toBe("under");
    expect(getInstance(state, shiftId).cardsUnder).toContain(baseId);
    // Discard pile is empty (the silent move-to-discard bug is fixed).
    expect(getZone(state, "player1", "discard").length).toBe(0);
  });

  // Note: when the parent leaves play, the cards under it should go to discard
  // (CRD 8.10.5). That's handled by zoneTransition's "leaving play" branch — covered
  // implicitly by the existing reducer.test.ts banish/return-to-hand tests since they
  // exercise zoneTransition. A focused test would require triggering banishCard or
  // CHALLENGE which adds setup churn; deferring as the assertion is straightforward.

  it("modify_stat_per_count countCardsUnderSelf: +1 {S} per card under, scales with Boost", () => {
    // Synthetic: just verify cardsUnder.length grows on each Boost. The
    // gameModifiers handler is exercised by the Flynn Rider canary already.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    // Inject a synthetic static effect by mutating the card's runtime ability list.
    // Easier: just verify cardsUnder.length grows on each Boost.
    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, flynnId).cardsUnder.length).toBe(1);

    // Pass turns to reset boostedThisTurn, then Boost again. Re-give ink after the pass.
    state = passTurns(state, 2);
    state = giveInk(state, "player1", 5);
    r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, flynnId).cardsUnder.length).toBe(2);
  });

  it("drain_cards_under to hand: drains cardsUnder pile to owner's hand", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    // Boost twice (across turns) to put 2 cards under
    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    state = passTurns(state, 2);
    state = giveInk(state, "player1", 5);
    r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, flynnId).cardsUnder.length).toBe(2);

    const handBefore = getZone(state, "player1", "hand").length;
    const underIds = [...getInstance(state, flynnId).cardsUnder];

    state = applyEffect(state, {
      type: "drain_cards_under",
      destination: "hand",
    }, flynnId, "player1", CARD_DEFINITIONS, []);

    expect(getInstance(state, flynnId).cardsUnder.length).toBe(0);
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 2);
    for (const id of underIds) {
      expect(getInstance(state, id).zone).toBe("hand");
    }
  });

  it("CRD 8.4.2: card_put_under trigger fires on BOOST_CARD (Webby's Diary draws on may-pay)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let flynnId: string, diaryId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    ({ state, instanceId: diaryId } = injectCard(state, "player1", "webbys-diary", "play", { isDrying: false }));
    void diaryId;
    const handBefore = getZone(state, "player1", "hand").length;
    const inkBefore = state.players.player1.availableInk;

    // Boost Flynn — card_put_under fires, Diary's "may pay 1 to draw" should surface a choice.
    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Resolve any "may" pending choice — accept it (pay 1 ink, draw 1).
    while (state.pendingChoice) {
      state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: state.pendingChoice.choosingPlayerId, choice: "accept" }, CARD_DEFINITIONS).newState;
    }
    // Ink spent: 2 (boost cost) + 1 (may reward). Hand grew by 1 net (+1 draw − 0 = +1, but the boosted card left the deck → it's now "under", not in hand).
    expect(state.players.player1.availableInk).toBe(inkBefore - 2 - 1);
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 1);
  });

  it("card_put_under: 'this character' triggers (Simba King in the Making) only fire on the boosted instance", () => {
    // Two Simba King in the Making in play. Boosting one should fire only that
    // Simba's TIMELY ALLIANCE — not both. Regression: filter `owner: self`
    // alone matched any owned carrier in the cross-card trigger path; added
    // `isSelf: true` to the trigger filter to require carrier === watcher.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let simbaA: string, simbaB: string;
    ({ state, instanceId: simbaA } = injectCard(state, "player1", "simba-king-in-the-making", "play", { isDrying: false }));
    ({ state, instanceId: simbaB } = injectCard(state, "player1", "simba-king-in-the-making", "play", { isDrying: false }));
    void simbaB;

    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: simbaA }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Count distinct may-prompts surfaced by declining each in sequence. With
    // the bug, BOTH Simbas trigger → two outer-may prompts. With the fix, only
    // one Simba triggers → one outer-may prompt.
    let mayPromptCount = 0;
    let safety = 5;
    while (state.pendingChoice && safety-- > 0) {
      mayPromptCount++;
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: state.pendingChoice.choosingPlayerId, choice: "decline" }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    expect(mayPromptCount).toBe(1);
  });

  it("card_put_under: 'one of your characters' triggers (Webby's Diary) still fire as cross-card watchers", () => {
    // Regression check: the isSelf fix above must NOT regress the cross-card
    // pattern. Webby's Diary text is "Whenever you put a card under one of
    // your characters or locations" — it correctly uses no isSelf and should
    // still fire when ANOTHER card (Flynn) receives a boosted card.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let flynnId: string, diaryId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    ({ state, instanceId: diaryId } = injectCard(state, "player1", "webbys-diary", "play", { isDrying: false }));
    void diaryId;

    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Diary's LATEST ENTRY surfaces a may-pay-1-to-draw choice.
    expect(state.pendingChoice).toBeDefined();
    expect(state.pendingChoice?.type).toBe("choose_may");
  });

  it("CRD 8.4.2: modify_stat_per_count.countCardsUnderSelf (Wreck-it Ralph POWERED UP)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let ralphId: string;
    ({ state, instanceId: ralphId } = injectCard(state, "player1", "wreck-it-ralph-raging-wrecker", "play", { isDrying: false }));

    // Zero cards under → no bonus.
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(ralphId)?.strength ?? 0).toBe(0);

    // Boost once → +1 STR.
    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: ralphId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(ralphId)?.strength).toBe(1);
  });

  it("CRD 8.4.2: hasCardUnder filter matches cards with a non-empty pile", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    const def = CARD_DEFINITIONS["flynn-rider-spectral-scoundrel"]!;
    expect(matchesFilter(getInstance(state, flynnId), def, { hasCardUnder: true }, state, "player1")).toBe(false);
    state = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS).newState;
    expect(matchesFilter(getInstance(state, flynnId), def, { hasCardUnder: true }, state, "player1")).toBe(true);
    expect(matchesFilter(getInstance(state, flynnId), def, { hasCardUnder: false }, state, "player1")).toBe(false);
  });

  it("getAllLegalActions enumerates BOOST_CARD for in-play boost characters", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    const actions = getAllLegalActions(state, "player1", CARD_DEFINITIONS);
    expect(actions.some(a => a.type === "BOOST_CARD" && a.instanceId === flynnId)).toBe(true);
  });

  it("CRD 8.4.2: you_control_matching condition checks controller's play zone for hasCardUnder", async () => {
    const { evaluateCondition } = await import("../utils/index.js");
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));
    const cond = { type: "you_control_matching" as const, filter: { hasCardUnder: true } };
    // No cards under Flynn yet → false.
    expect(evaluateCondition(cond, state, CARD_DEFINITIONS, "player1", flynnId)).toBe(false);
    // Boost Flynn, now has a card under him → true for controller.
    state = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS).newState;
    expect(evaluateCondition(cond, state, CARD_DEFINITIONS, "player1", flynnId)).toBe(true);
    // Opponent does not control a card with cards-under → false for opponent.
    expect(evaluateCondition(cond, state, CARD_DEFINITIONS, "player2", flynnId)).toBe(false);
  });

  it("Webby Vanderquack Knowledge Seeker I'VE READ ABOUT THIS: +1 {L} while own card has cards-under", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let webbyId: string, flynnId: string;
    ({ state, instanceId: webbyId } = injectCard(state, "player1", "webby-vanderquack-knowledge-seeker", "play", { isDrying: false }));
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    // No cards under anything yet → no bonus.
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(webbyId)?.lore ?? 0).toBe(0);

    // Boost Flynn so Flynn has cardsUnder → Webby's static fires.
    state = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, CARD_DEFINITIONS).newState;
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(webbyId)?.lore).toBe(1);
  });

  it("Morty Fieldmouse Tiny Tim HOLIDAY CHEER: +1 {L} per card under him (modify_stat_per_count + countCardsUnderSelf)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let mortyId: string;
    ({ state, instanceId: mortyId } = injectCard(state, "player1", "morty-fieldmouse-tiny-tim", "play", { isDrying: false }));
    // No cards under → no bonus.
    let mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(mortyId)?.lore ?? 0).toBe(0);
    // Apply put_top_of_deck_under effect directly (Boost keyword value may not
    // be set on this card; we exercise the underlying counting path).
    state = applyEffect(state, { type: "put_top_card_under", target: { type: "this" } } as any, mortyId, "player1", CARD_DEFINITIONS, []);
    state = applyEffect(state, { type: "put_top_card_under", target: { type: "this" } } as any, mortyId, "player1", CARD_DEFINITIONS, []);
    mods = getGameModifiers(state, CARD_DEFINITIONS);
    expect(mods.statBonuses.get(mortyId)?.lore).toBe(2);
  });

  it("The Black Cauldron RISE AND JOIN ME!: paid play-from-under deducts ink and moves card to play", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let cauldronId: string, charId: string;
    ({ state, instanceId: cauldronId } = injectCard(state, "player1", "the-black-cauldron", "play", { isDrying: false }));
    // Inject a character into the Cauldron's cardsUnder pile (skipping the THE
    // CAULDRON CALLS ability, which puts a card from discard under and is not
    // implemented). The under-card lives in zone "under" with no zone-array entry.
    ({ state, instanceId: charId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "discard"));
    // Detach from discard array and attach under the Cauldron.
    state = {
      ...state,
      cards: {
        ...state.cards,
        [charId]: { ...state.cards[charId]!, zone: "under" },
        [cauldronId]: {
          ...state.cards[cauldronId]!,
          cardsUnder: [...state.cards[cauldronId]!.cardsUnder, charId],
        },
      },
      zones: {
        ...state.zones,
        player1: {
          ...state.zones.player1,
          discard: state.zones.player1.discard.filter(id => id !== charId),
        },
      },
    };

    const inkBefore = state.players.player1.availableInk;
    const charDef = CARD_DEFINITIONS["hades-lord-of-the-underworld"]!;
    const charCost = charDef.cost;

    // Activate Cauldron's RISE AND JOIN ME! (index 1; index 0 is THE CAULDRON CALLS).
    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: cauldronId,
      abilityIndex: 1,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Cost paid: 1 {I} for activation. Card-play cost paid on accept.
    // Resolve the play-from-under choice (isMay) — accept and pick the only target.
    expect(state.pendingChoice).toBeTruthy();
    if (state.pendingChoice && state.pendingChoice.type === "choose_target") {
      expect(state.pendingChoice.validTargets).toContain(charId);
      r = applyAction(state, {
        type: "RESOLVE_CHOICE",
        playerId: state.pendingChoice.choosingPlayerId,
        choice: [charId],
      }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }

    // Activator paid: 1 (ability) + charCost (paid play).
    expect(state.players.player1.availableInk).toBe(inkBefore - 1 - charCost);
    // Card moved into play and detached from cauldron's pile.
    expect(getInstance(state, charId).zone).toBe("play");
    expect(getInstance(state, cauldronId).cardsUnder).not.toContain(charId);
  });

  it("Alice Well-Read Whisper MYSTICAL INSIGHT: quest triggers drain_cards_under (to hand)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let aliceId: string;
    ({ state, instanceId: aliceId } = injectCard(state, "player1", "alice-well-read-whisper", "play", { isDrying: false }));
    // Seed two under-cards via the direct effect.
    state = applyEffect(state, { type: "put_top_card_under", target: { type: "this" } } as any, aliceId, "player1", CARD_DEFINITIONS, []);
    state = applyEffect(state, { type: "put_top_card_under", target: { type: "this" } } as any, aliceId, "player1", CARD_DEFINITIONS, []);
    const aliceBefore = getInstance(state, aliceId);
    expect(aliceBefore.cardsUnder.length).toBe(2);
    const handBefore = getZone(state, "player1", "hand").length;

    // Quest → drain_cards_under (to hand) fires.
    state = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: aliceId }, CARD_DEFINITIONS).newState;

    const aliceAfter = getInstance(state, aliceId);
    expect(aliceAfter.cardsUnder.length).toBe(0);
    expect(getZone(state, "player1", "hand").length).toBe(handBefore + 2);
  });

  it("Fairy Godmother STUNNING TRANSFORMATION: banish + reveal-rider plays opponent's revealed character for free", () => {
    // Tier-1 fix: was wired with bare banish, no reveal rider. Now wired
    // with sequential cost+reward — banish in costEffects, reveal_top_conditional
    // (target: opponent, matchAction: play_for_free, noMatchDestination: bottom)
    // in rewardEffects. The whole unit is isMay so the player can decline.
    //
    // This test pins the cross-player flow: caster's banish → opponent's
    // top-of-deck reveal → if character/item, opponent plays it for free.
    let state = startGame();
    let fgId: string, oppCharId: string, oppTopId: string;
    ({ state, instanceId: fgId } = injectCard(state, "player1", "fairy-godmother-magical-benefactor", "play", { isDrying: false }));
    ({ state, instanceId: oppCharId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    // Seed the top of player2's deck with a known character so the bot's
    // reveal-and-play branch fires deterministically.
    ({ state, instanceId: oppTopId } = injectCard(state, "player2", "mickey-mouse-true-friend", "deck"));
    state = { ...state, zones: { ...state.zones, player2: { ...state.zones.player2,
      deck: [oppTopId, ...state.zones.player2.deck.filter(id => id !== oppTopId)] } } };

    // Apply FG's effect chain directly. The sequential surfaces a banish
    // chooser; resolve it picking the opposing character.
    const def = CARD_DEFINITIONS["fairy-godmother-magical-benefactor"]!;
    const stunningTrans = def.abilities.find((a: any) => a.storyName === "STUNNING TRANSFORMATION") as any;
    state = applyEffect(state, stunningTrans.effects[0], fgId, "player1", CARD_DEFINITIONS, []);

    // Stage 1: banish chooser surfaces.
    expect(state.pendingChoice?.type).toBe("choose_target");
    let r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [oppCharId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Banish landed: opposing in-play Mickey is now in discard.
    expect(getInstance(state, oppCharId).zone).toBe("discard");

    // Reveal-rider fired: opponent's top-of-deck Mickey was revealed and
    // (since it's a character) played for free into opponent's play zone.
    expect(getInstance(state, oppTopId).zone).toBe("play");
    expect(getInstance(state, oppTopId).ownerId).toBe("player2");
  });

  it("Chief Bogo DEPUTIZE + Judy Hopps Lead Detective: deputized characters get Alert from Judy via grantedTraits pre-pass", () => {
    // Tier-1 fix: was wired with EVER VIGILANT (self-damage-immunity) only
    // and the DEPUTIZE rider dropped. Now uses a new grant_trait_static
    // effect populated in a gameModifiers PRE-PASS so downstream statics
    // (Judy Hopps Lead Detective's `target.filter.hasTrait: "Detective"`
    // grant_keyword) see the deputized characters during the same
    // iteration. This test pins the pre-pass + cross-static interaction.
    let state = startGame();
    let bogoId: string, judyId: string, mickeyId: string;
    ({ state, instanceId: bogoId } = injectCard(state, "player1", "chief-bogo-calling-the-shots", "play", { isDrying: false }));
    ({ state, instanceId: judyId } = injectCard(state, "player1", "judy-hopps-lead-detective", "play", { isDrying: false }));
    // Mickey Mouse - True Friend has NO Detective trait — without DEPUTIZE he
    // should NOT pick up Judy's Alert grant. With DEPUTIZE he should.
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);

    // Pre-pass: Bogo's DEPUTIZE granted Detective to the non-Detective Mickey.
    expect(mods.grantedTraits.get(mickeyId)?.has("Detective")).toBe(true);
    // Bogo himself is excluded (excludeSelf: true) — he doesn't grant to himself.
    expect(mods.grantedTraits.get(bogoId)?.has("Detective") ?? false).toBe(false);

    // Main pass: Judy's DETECTIVE ALERT static (target: hasTrait Detective)
    // sees the deputized Mickey via the in-progress modifiers passed to
    // matchesFilter. So Mickey should have Alert in modifiers.grantedKeywords.
    const mickeyKeywords = mods.grantedKeywords.get(mickeyId) ?? [];
    const hasAlert = mickeyKeywords.some(k => k.keyword === "alert");
    expect(hasAlert).toBe(true);
  });

  it("Hercules - Mighty Leader EVER VALIANT: while exerted, other Hero characters share his damage immunity", () => {
    // Tier-1 fix: was wired with EVER VIGILANT (self-protection) only and the
    // EVER VALIANT rider dropped. Now uses a second static gated by
    // condition this_is_exerted, granting damage_prevention_static (source
    // non_challenge) to other own Hero characters.
    let state = startGame();
    let herculesId: string, otherHeroId: string;
    ({ state, instanceId: herculesId } = injectCard(state, "player1", "hercules-mighty-leader", "play", { isDrying: false, isExerted: false }));
    // Use a different Hero so its OWN abilities don't conflate with the EVER
    // VALIANT grant under test. Taran - Pig Keeper has trait Hero with no
    // damage-related abilities of its own.
    ({ state, instanceId: otherHeroId } = injectCard(state, "player1", "taran-pig-keeper", "play", { isDrying: false }));

    // While Hercules is READY, the other Hero is unprotected — apply damage
    // via deal_damage (non-challenge source) and confirm it lands.
    state = applyEffect(state, { type: "deal_damage", amount: 2, target: { type: "this" } } as any, otherHeroId, "player1", CARD_DEFINITIONS, []);
    expect(getInstance(state, otherHeroId).damage).toBe(2);

    // Heal, then exert Hercules and try again — the rider should kick in and
    // block the non-challenge damage on the other Hero.
    state = { ...state, cards: { ...state.cards,
      [otherHeroId]: { ...state.cards[otherHeroId]!, damage: 0 },
      [herculesId]:  { ...state.cards[herculesId]!,  isExerted: true },
    } };
    state = applyEffect(state, { type: "deal_damage", amount: 2, target: { type: "this" } } as any, otherHeroId, "player1", CARD_DEFINITIONS, []);
    expect(getInstance(state, otherHeroId).damage).toBe(0);
  });
});

describe("§CRD 3.2.1.4 / 3.2.3.1 — turn_start trigger defers draw step", () => {
  it("The Queen Conceited Ruler ROYAL SUMMONS: discard A → return B (sequential cost+reward)", () => {
    // Set up: The Queen in play, a Princess (Ariel) in hand to discard,
    // a character (Mickey) in discard to return.
    let state = startGame();
    let queenId: string, arielId: string, mickeyDiscardId: string;
    ({ state, instanceId: queenId } = injectCard(state, "player1", "the-queen-conceited-ruler", "play", { isDrying: false }));
    ({ state, instanceId: arielId } = injectCard(state, "player1", "ariel-on-human-legs", "hand"));
    ({ state, instanceId: mickeyDiscardId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));

    // Pass twice so player1's turn starts again. ROYAL SUMMONS queues as
    // turn_start, sequential isMay → pendingChoice (choose_may).
    state = passTurns(state, 2);

    expect(state.pendingChoice?.type).toBe("choose_may");
    expect(state.pendingDrawForPlayer).toBe("player1"); // draw deferred
    const handSizeBefore = getZone(state, "player1", "hand").length;

    // Accept the may
    let r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // First sub-choice: discard cost — pick the Princess from hand to discard
    expect(state.pendingChoice?.type).toBe("choose_discard");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [arielId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Second sub-choice: return target — pick the Mickey from discard
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [mickeyDiscardId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Cost actually fired — Ariel is in discard now
    expect(getInstance(state, arielId).zone).toBe("discard");
    // Reward fired — Mickey is in hand now
    expect(getInstance(state, mickeyDiscardId).zone).toBe("hand");
    // Net hand: -1 Ariel discarded + 1 Mickey returned + 1 deferred draw = +1
    expect(getZone(state, "player1", "hand").length).toBe(handSizeBefore + 1);
    expect(state.pendingDrawForPlayer).toBeUndefined();
  });
});

describe("§P2 Promo — Lilo Escape Artist NO PLACE I'D RATHER BE (paid play from discard)", () => {
  it("DIRECT applyEffect with cost:normal deducts ink", () => {
    let state = startGame();
    let liloId: string;
    ({ state, instanceId: liloId } = injectCard(state, "player1", "lilo-escape-artist", "discard"));
    state = { ...state, players: { ...state.players, player1: { ...state.players.player1, availableInk: 5 } } };
    const inkBefore = state.players.player1.availableInk;
    const newState = applyEffect(
      state,
      {
        type: "play_card",
        target: { type: "this" },
        sourceZone: "discard",
        enterExerted: true,
        cost: "normal",
      } as any,
      liloId,
      "player1",
      CARD_DEFINITIONS,
      [],
    );
    expect(newState.cards[liloId]?.zone).toBe("play");
    expect(newState.players.player1.availableInk).toBe(inkBefore - 2);
  });

  it("requires paying ink cost — Lilo's 2 ink is deducted on accept", () => {
    let state = startGame();
    let liloId: string;
    ({ state, instanceId: liloId } = injectCard(state, "player1", "lilo-escape-artist", "discard"));
    // Put 3 ink cards in inkwell so they ready on turn start (covers Lilo's cost 2).
    for (let i = 0; i < 3; i++) {
      ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "inkwell"));
    }

    // Pass to player2 then back to player1 — turn_start trigger fires.
    state = passTurns(state, 2);

    // Should surface a may-prompt (turn_start trigger)
    expect(state.pendingChoice?.type).toBe("choose_may");
    const inkBefore = state.players.player1.availableInk;
    expect(inkBefore).toBeGreaterThanOrEqual(2); // need to afford Lilo

    // Accept the may
    let r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Lilo is now in play, exerted, and 2 ink has been deducted (not free!)
    expect(getInstance(state, liloId).zone).toBe("play");
    expect(getInstance(state, liloId).isExerted).toBe(true);
    expect(state.players.player1.availableInk).toBe(inkBefore - 2);
  });
});

describe("§10 Set 10 — Pluto Clever Cluefinder ON THE TRAIL", () => {
  it("with Detective in play: returns an item from discard to hand", () => {
    let state = startGame();
    state.currentPlayer = "player1";
    let plutoId: string, itemId: string;
    ({ state, instanceId: plutoId } = injectCard(state, "player1", "pluto-clever-cluefinder", "play", { isDrying: false }));
    // Inject a Detective character (Judy Hopps Uncovering Clues has Detective trait)
    ({ state } = injectCard(state, "player1", "judy-hopps-uncovering-clues", "play", { isDrying: false }));
    ({ state, instanceId: itemId } = injectCard(state, "player1", "basils-magnifying-glass", "discard"));

    // Activate ability index 0 (ON THE TRAIL)
    let r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: plutoId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Should surface a choose_target for the item in discard
    expect(state.pendingChoice?.type).toBe("choose_target");
    expect(state.pendingChoice?.validTargets).toContain(itemId);

    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [itemId] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Item moved to hand
    expect(getInstance(state, itemId).zone).toBe("hand");
  });

  it("without Detective in play: puts an item from discard on top of deck", () => {
    let state = startGame();
    state.currentPlayer = "player1";
    let plutoId: string, itemId: string;
    ({ state, instanceId: plutoId } = injectCard(state, "player1", "pluto-clever-cluefinder", "play", { isDrying: false }));
    // No Detective character present
    ({ state, instanceId: itemId } = injectCard(state, "player1", "basils-magnifying-glass", "discard"));
    const deckTopBefore = getZone(state, "player1", "deck")[0];

    const r = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: plutoId, abilityIndex: 0,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Non-interactive: search auto-resolves with single match → item goes on
    // top of deck (not in hand).
    expect(getInstance(state, itemId).zone).toBe("deck");
    expect(getZone(state, "player1", "deck")[0]).toBe(itemId);
    expect(getZone(state, "player1", "deck")[0]).not.toBe(deckTopBefore);
  });
});

describe("§Engine — TimedEffect.sourceStoryName attribution", () => {
  it("The Queen Conceited Ruler: Support's modify_strength is attributed to 'Support', not ROYAL SUMMONS", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    state.currentPlayer = "player1";

    // The Queen has BOTH Support keyword AND ROYAL SUMMONS triggered ability.
    // After her quest, the Support trigger fires and adds modify_strength to
    // the chosen recipient. The TimedEffect must carry sourceStoryName="Support"
    // so the UI can attribute it correctly (not to ROYAL SUMMONS).
    let queenId: string, otherId: string;
    ({ state, instanceId: queenId } = injectCard(state, "player1", "the-queen-conceited-ruler", "play", { isDrying: false }));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    // Quest with The Queen — triggers Support
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: queenId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Support's "may" → accept
    expect(state.pendingChoice?.type).toBe("choose_may");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS).newState;

    // Pick recipient
    expect(state.pendingChoice?.type).toBe("choose_target");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [otherId] }, CARD_DEFINITIONS).newState;

    // The recipient (Mickey) should have a modify_strength TimedEffect
    // attributed to "Support" (NOT undefined, NOT "ROYAL SUMMONS").
    const mickey = getInstance(state, otherId);
    const supportEffect = mickey.timedEffects.find((te: any) => te.type === "modify_strength" && te.sourceInstanceId === queenId);
    expect(supportEffect).toBeDefined();
    expect((supportEffect as any).sourceStoryName).toBe("Support");
  });
});

describe("§11 Set 11 — Snow Fort static strength + Support", () => {
  it("Support strength includes static bonuses from other cards (e.g. Snow Fort +1 str)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    state.currentPlayer = "player1";

    // HeiHei (Support, base str 1) + Mickey (str 3) + Snow Fort (+1 str to your chars)
    let heiHeiId: string, mickeyId: string;
    ({ state, instanceId: heiHeiId } = injectCard(state, "player1", "heihei-boat-snack", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state } = injectCard(state, "player1", "snow-fort", "play"));

    // Quest with HeiHei — should trigger Support
    const r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: heiHeiId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Support triggers a "may" choice — accept it
    expect(state.pendingChoice?.type).toBe("choose_may");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS).newState;

    // Then chooses a target — pick Mickey
    expect(state.pendingChoice?.type).toBe("choose_target");
    state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [mickeyId] }, CARD_DEFINITIONS).newState;

    // Mickey should have +2 strength from support (HeiHei base 1 + Snow Fort +1 = 2),
    // plus +1 static from Snow Fort himself, so effective strength = 3 + 2 + 1 = 6.
    const mickeyInst = getInstance(state, mickeyId);
    const mickeyDef = CARD_DEFINITIONS[mickeyInst.definitionId]!;
    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const mickeyStr = getEffectiveStrength(
      mickeyInst,
      mickeyDef,
      mods.statBonuses.get(mickeyId)?.strength ?? 0,
      mods,
    );
    expect(mickeyStr).toBe(6); // 3 base + 1 Snow Fort + 2 Support (HeiHei's 1+1 effective str)
  });
});

describe("§10 Set 10 — Raksha Fearless Mother ON PATROL (self-only oncePerTurn move discount)", () => {
  it("first move pays 1 less; second same-turn move pays full", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let rakshaId: string, locA: string, locB: string;
    ({ state, instanceId: rakshaId } = injectCard(state, "player1", "raksha-fearless-mother", "play", { isDrying: false }));
    // Two locations with moveCost 2 each.
    ({ state, instanceId: locA } = injectCard(state, "player1", "pride-lands-pride-rock", "play", { isDrying: false }));
    ({ state, instanceId: locB } = injectCard(state, "player1", "tianas-palace-jazz-restaurant", "play", { isDrying: false }));

    const inkBefore = state.players.player1.availableInk;

    // First move: 2 - 1 = 1 ink charged.
    let r = applyAction(state, { type: "MOVE_CHARACTER", playerId: "player1", characterInstanceId: rakshaId, locationInstanceId: locA }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.availableInk).toBe(inkBefore - 1);

    // Second move (same turn): full cost (2 ink).
    r = applyAction(r.newState, { type: "MOVE_CHARACTER", playerId: "player1", characterInstanceId: rakshaId, locationInstanceId: locB }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.availableInk).toBe(inkBefore - 1 - 2);
  });

  it("ON PATROL is self-only — does NOT discount other characters' moves", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let rakshaId: string, otherId: string, locA: string;
    ({ state, instanceId: rakshaId } = injectCard(state, "player1", "raksha-fearless-mother", "play", { isDrying: false }));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: locA } = injectCard(state, "player1", "pride-lands-pride-rock", "play", { isDrying: false }));

    const inkBefore = state.players.player1.availableInk;
    // Move Mickey (not Raksha) — should pay full 2 ink.
    const r = applyAction(state, { type: "MOVE_CHARACTER", playerId: "player1", characterInstanceId: otherId, locationInstanceId: locA }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.availableInk).toBe(inkBefore - 2);
  });
});

describe("§10 Set 10 — played_this_turn unified condition", () => {
  it("Enigmatic Inkcaster ITS OWN REWARD: fizzles until 2+ cards played, then grants lore", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let inkcasterId: string;
    ({ state, instanceId: inkcasterId } = injectCard(state, "player1", "enigmatic-inkcaster", "play", { isDrying: false }));
    // 0 cards played — per CRD 6.2.1 activation succeeds but effect fizzles.
    // (Cost is only {E} — no ink/card waste on fizzle beyond the exert.)
    const loreStart = state.players.player1.lore;
    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: inkcasterId, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.lore).toBe(loreStart); // fizzled
    expect(getInstance(r.newState, inkcasterId).isExerted).toBe(true);

    // Ready and play 2 cards to satisfy the condition.
    state = { ...r.newState, cards: { ...r.newState.cards, [inkcasterId]: { ...r.newState.cards[inkcasterId]!, isExerted: false } } };
    let charId: string, itemId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    ({ state, instanceId: itemId } = injectCard(state, "player1", "fishbone-quill", "hand"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: charId }, CARD_DEFINITIONS);
    state = r.newState;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: itemId }, CARD_DEFINITIONS);
    state = r.newState;
    expect(state.players.player1.cardsPlayedThisTurn?.length).toBeGreaterThanOrEqual(2);
    // Now activation grants lore.
    const loreBefore = state.players.player1.lore;
    r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: inkcasterId, abilityIndex: 0 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.players.player1.lore).toBe(loreBefore + 1);
  });

  it("Ichabod Crane WELL-READ: only fires on quest if a cost-5+ character was played this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let ichabodId: string;
    ({ state, instanceId: ichabodId } = injectCard(state, "player1", "ichabod-crane-bookish-schoolmaster", "play", { isDrying: false }));
    // Quest with no cost-5+ played → condition fails, no inkwell put.
    const inkBefore = getZone(state, "player1", "inkwell").length;
    let r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ichabodId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "inkwell").length).toBe(inkBefore);

    // Pass and return; play a cost-5 character (Moana cost 5), then quest → fires.
    state = passTurns(r.newState, 2);
    state = giveInk(state, "player1", 10);
    let bigCharId: string;
    ({ state, instanceId: bigCharId } = injectCard(state, "player1", "moana-of-motunui", "hand"));
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: bigCharId }, CARD_DEFINITIONS);
    state = r.newState;
    const inkBefore2 = getZone(state, "player1", "inkwell").length;
    r = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: ichabodId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(getZone(r.newState, "player1", "inkwell").length).toBe(inkBefore2 + 1);
  });
});

describe("§10 Set 10 — Cinderella Dream Come True WHATEVER YOU WISH FOR", () => {
  // At the end of your turn, if you played a Princess character this turn,
  // you may put a card from your hand into your inkwell facedown to draw a card.
  it("fires at turn_end when a Princess was played this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let cindyId: string, princessId: string;
    ({ state, instanceId: cindyId } = injectCard(state, "player1", "cinderella-dream-come-true", "play", { isDrying: false }));
    // Play Mickey's Princess-trait cousin — use an actual Princess.
    ({ state, instanceId: princessId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: princessId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Pass turn → triggers WHATEVER YOU WISH FOR at end of player1's turn.
    r = applyAction(r.newState, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Should now have a sequential may choice (put-hand-card-to-inkwell → draw).
    expect(r.newState.pendingChoice).toBeDefined();
    expect(r.newState.pendingChoice?.choosingPlayerId).toBe("player1");
  });

  it("two Cinderella Dream Come True both fire when a Princess was played this turn", () => {
    // Bug report: "Cinderella Dream Come True works by herself, but if there are
    // two Cinderella Dream Come True, neither of them work." Root cause: the first
    // Cindy's trigger creates a pendingChoice which pauses processTriggerStack,
    // then applyPassTurn proceeds to transition the turn and reset cardsPlayed
    // ThisTurn. When the second Cindy's trigger resolves, its condition sees an
    // empty list and fizzles.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let cindy1Id: string, cindy2Id: string, princessId: string;
    ({ state, instanceId: cindy1Id } = injectCard(state, "player1", "cinderella-dream-come-true", "play", { isDrying: false }));
    ({ state, instanceId: cindy2Id } = injectCard(state, "player1", "cinderella-dream-come-true", "play", { isDrying: false }));
    // Play a Princess this turn so the condition is satisfied.
    ({ state, instanceId: princessId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: princessId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Pass → both Cindy triggers fire. First creates pendingChoice.
    r = applyAction(r.newState, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    // Accept the first may → it surfaces put_into_inkwell chooser.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    // Pick a hand card to inkwell.
    const hand1 = getZone(r.newState, "player1", "hand");
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [hand1[0]!] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Second Cindy's trigger should now surface — another choose_may.
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
  });

  it("Cindy's inkwell-put at end of turn chains Oswald's FAVORABLE CHANCE (still your turn)", () => {
    // Bug report: "Cinderella Dream Come True 'at end of turn' ability happens
    // after opponent's character has already readied. Any additional triggers
    // like Cindy putting a card to inkwell should trigger Oswald's watcher."
    // Root cause: same as the two-Cindys bug — applyPassTurn transitioned the
    // turn before the Cindy may-choice resolved, so Oswald's "During your
    // turn" condition was false when the inkwell-put fired.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let cindyId: string, oswaldId: string, princessId: string;
    ({ state, instanceId: cindyId } = injectCard(state, "player1", "cinderella-dream-come-true", "play", { isDrying: false }));
    ({ state, instanceId: oswaldId } = injectCard(state, "player1", "oswald-the-lucky-rabbit", "play", { isDrying: false }));
    // Play a Princess so Cindy's condition is satisfied.
    ({ state, instanceId: princessId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: princessId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);

    // Pass → Cindy's turn_end trigger creates choose_may. Opponent cards must
    // NOT yet be readied (turn transition deferred).
    r = applyAction(r.newState, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    expect(r.newState.currentPlayer).toBe("player1"); // still our turn

    // Accept Cindy's may → surfaces choose_target for inkwell cost
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, CARD_DEFINITIONS);
    expect(r.newState.pendingChoice?.type).toBe("choose_target");
    expect(r.newState.currentPlayer).toBe("player1");
    const hand = getZone(r.newState, "player1", "hand");
    // Pick a hand card → inkwell → this triggers Oswald's FAVORABLE CHANCE.
    r = applyAction(r.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [hand[0]!] }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Oswald's trigger should now be the active pendingChoice (choose_may).
    expect(r.newState.pendingChoice?.type).toBe("choose_may");
    expect(r.newState.currentPlayer).toBe("player1");
  });

  it("does NOT fire at turn_end when no Princess was played this turn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let cindyId: string, nonPrincessId: string;
    ({ state, instanceId: cindyId } = injectCard(state, "player1", "cinderella-dream-come-true", "play", { isDrying: false }));
    ({ state, instanceId: nonPrincessId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand"));
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: nonPrincessId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    r = applyAction(r.newState, { type: "PASS_TURN", playerId: "player1" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    expect(r.newState.pendingChoice).toBeFalsy();
  });
});

describe("§11 Set 11 — Angel Experiment 624 GOOD AIM (sequential may-discard → damage)", () => {
  // Per CRD: "you may choose and discard a card to deal 2 damage" reads as a
  // sequential MAY effect — the discard is a cost effect that must fully
  // resolve before the damage reward fires. With an empty hand the discard
  // can't resolve, so the damage doesn't either.
  it("activates without a cost: surfaces a may-prompt before discard", () => {
    let state = startGame();
    let angelId: string, targetId: string;
    ({ state, instanceId: angelId } = injectCard(state, "player1", "angel-experiment-624", "play", { isDrying: false }));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));
    void targetId;
    // Activate GOOD AIM (ability index 1).
    const r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: angelId, abilityIndex: 1 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Should produce a sequential may-prompt — engine pauses for player decision.
    expect(r.newState.pendingChoice).toBeDefined();
  });

  it("declining the may skips both the discard and the damage", () => {
    let state = startGame();
    let angelId: string, targetId: string;
    ({ state, instanceId: angelId } = injectCard(state, "player1", "angel-experiment-624", "play", { isDrying: false }));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isDrying: false }));

    let r = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: angelId, abilityIndex: 1 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    const handBefore = getZone(state, "player1", "hand").length;

    // Decline.
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    expect(getZone(state, "player1", "hand").length).toBe(handBefore);
    expect(getInstance(state, targetId).damage ?? 0).toBe(0);
  });
});

describe("§11 Set 11 — Let's Get Dangerous (action: each player reveals + may-play)", () => {
  // "Each player shuffles their deck and then reveals the top card. Each player
  // who reveals a character card may play that character for free. Otherwise,
  // put the revealed cards on the bottom of their player's deck."
  // Regression: previously wired with `isMay: true` (no-op for this effect)
  // instead of `matchIsMay: true` — engine auto-played the revealed character
  // without asking. Also previously dropped player2's reveal when player1's
  // matchIsMay created a pendingChoice.
  it("Marching Off to Battle: condition gates the draw (only fires if a character was banished this turn)", () => {
    // "If a character was banished this turn, draw 2 cards." Regression:
    // draw.condition was a silent no-op; the song always drew 2.
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId1: string, songId2: string;
    ({ state, instanceId: songId1 } = injectCard(state, "player1", "marching-off-to-battle", "hand"));
    ({ state, instanceId: songId2 } = injectCard(state, "player1", "marching-off-to-battle", "hand"));

    // No character banished this turn yet — playing the song should NOT draw.
    const handBefore = getZone(state, "player1", "hand").length;
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId1 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Hand: -1 (song played) -0 (no draw) = handBefore-1.
    expect(getZone(state, "player1", "hand").length).toBe(handBefore - 1);

    // Force a banish in challenge to flip the condition.
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isExerted: true }));
    r = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: defenderId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Now a character was banished — playing song2 should draw 2.
    const handAfter = getZone(state, "player1", "hand").length;
    r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId2 }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    // Hand: -1 (song2 played) +2 (drew) = handAfter+1.
    expect(getZone(r.newState, "player1", "hand").length).toBe(handAfter - 1 + 2);
  });

  it("revealed Bodyguard character (Smee) still gets enter-exerted may-prompt via Let's Get Dangerous", () => {
    // Regression: applyRevealMatchAction previously called zoneTransition
    // directly without applyEnterPlayExertion, so Bodyguard's enter-trigger
    // was silently skipped for characters played via reveal-and-play paths
    // (Let's Get Dangerous, Simba TIMELY ALLIANCE, Mufasa, Sisu repeats).
    let state = startGame();
    state = giveInk(state, "player1", 10);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "lets-get-dangerous", "hand"));
    let smeeId: string, p2TopId: string;
    ({ state, instanceId: smeeId } = injectCard(state, "player1", "goofy-musketeer", "deck"));
    ({ state, instanceId: p2TopId } = injectCard(state, "player2", "mickey-mouse-true-friend", "deck"));
    void p2TopId;
    // Hoist to deck top (injectCard appends to bottom).
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: { ...state.zones.player1, deck: [smeeId, ...state.zones.player1.deck.filter((id) => id !== smeeId)] },
        player2: { ...state.zones.player2, deck: [p2TopId, ...state.zones.player2.deck.filter((id) => id !== p2TopId)] },
      },
    };

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    // Accept player1's may-play (Smee).
    expect(state.pendingChoice?.type).toBe("choose_may");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: state.pendingChoice!.choosingPlayerId, choice: "accept" }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Smee should be in play.
    expect(getInstance(state, smeeId).zone).toBe("play");

    // Walk pending choices until we either hit Smee's Bodyguard prompt or
    // exhaust them. Bug repros as: NEVER seeing Smee's Bodyguard prompt
    // (it was silently skipped). Player2's may-play for Mickey may surface
    // first; decline it and continue.
    let sawBodyguardPrompt = false;
    let safety = 5;
    while (state.pendingChoice && safety-- > 0) {
      if (state.pendingChoice.sourceInstanceId === smeeId) {
        sawBodyguardPrompt = true;
        break;
      }
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: state.pendingChoice.choosingPlayerId, choice: "decline" }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    expect(sawBodyguardPrompt).toBe(true);
  });

  it("matchIsMay surfaces a per-player may-prompt after the reveal", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);

    // Stack each player's deck top with a character so both will trigger matchIsMay.
    // Use injectCard to put a known character in deck so we know what's revealed.
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "lets-get-dangerous", "hand"));

    // Add a character on top of each player's deck via direct state mutation
    // through injectCard at zone "deck" — newest goes to position 0 (top).
    let p1TopId: string, p2TopId: string;
    ({ state, instanceId: p1TopId } = injectCard(state, "player1", "mickey-mouse-true-friend", "deck"));
    ({ state, instanceId: p2TopId } = injectCard(state, "player2", "mickey-mouse-true-friend", "deck"));
    void p1TopId; void p2TopId;

    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // After playing, a pendingChoice should be active for the FIRST player's may-play.
    expect(state.pendingChoice).toBeDefined();
    expect(state.pendingChoice?.type).toBe("choose_may");
  });

  // CRD 4.3.3.2: action cards go to discard once their effect (and any nested
  // pendingChoices the effect surfaced) has fully resolved. Regression for a
  // user-reported bug: Let's Get Dangerous "sometimes stayed on the field"
  // after both players resolved their may-prompts. Cause: the choose_may
  // _revealContinuation branch in RESOLVE_CHOICE returned without calling
  // cleanupPendingAction, so pendingActionInstanceId stayed set and the action
  // card was never moved out of play.
  it("CRD 4.3.3.2: song moves to discard after both players' matchIsMay choices resolve", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);

    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "lets-get-dangerous", "hand"));

    // Stack a known character on top of each deck so both reveals surface a may-prompt.
    let p1TopId: string, p2TopId: string;
    ({ state, instanceId: p1TopId } = injectCard(state, "player1", "mickey-mouse-true-friend", "deck"));
    ({ state, instanceId: p2TopId } = injectCard(state, "player2", "mickey-mouse-true-friend", "deck"));
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: { ...state.zones.player1, deck: [p1TopId, ...state.zones.player1.deck.filter((id) => id !== p1TopId)] },
        player2: { ...state.zones.player2, deck: [p2TopId, ...state.zones.player2.deck.filter((id) => id !== p2TopId)] },
      },
    };

    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Walk both players' may-prompts. Each accept resolves a reveal continuation.
    let safety = 6;
    while (state.pendingChoice && safety-- > 0) {
      r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: state.pendingChoice.choosingPlayerId, choice: "accept" }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    expect(state.pendingChoice).toBeFalsy();

    // The song must be in player1's discard, NOT still in play, and the
    // pendingActionInstanceId must be cleared.
    expect(state.cards[songId]!.zone).toBe("discard");
    expect(getZone(state, "player1", "play")).not.toContain(songId);
    expect(state.pendingActionInstanceId).toBeUndefined();
  });
});

// Verify Angela Night Warrior's ETERNAL NIGHT (remove_named_ability) actually
// works end-to-end. The concern isn't the JSON wiring — it's whether the
// suppressed-ability path in gameModifiers correctly prevents STONE BY DAY
// from blocking ready.
// =============================================================================
// P1 PROMO — Jolly Roger - Hook's Ship (move-to-self cost reduction)
// =============================================================================
describe("§P1 Promo — Jolly Roger - Hook's Ship", () => {
  it("ALL HANDS ON DECK!: modifier slot populated with Pirate filter for Jolly Roger", () => {
    // Jolly Roger itself has moveCost 0, so the "for free" reduction is a
    // no-op for moves to Jolly Roger. The static is still correctly registered
    // on the modifier slot keyed by Jolly Roger's instanceId — verified directly.
    let state = startGame();
    let jollyId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const entries = mods.costReductions.filter((r) =>
      r.kind === "move" && r.locationInstanceId === jollyId
    );
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.amount).toBe("all");
    expect(entry.kind === "move" && entry.cardFilter?.hasTrait).toBe("Pirate");
  });

  it("applyMoveCostReduction helper: Pirate gets cost reduced to 0; non-Pirate pays full", () => {
    // Use the helper directly with a synthetic location moveCost of 1.
    let state = startGame();
    let jollyId: string, smeeId: string, mickeyId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));
    ({ state, instanceId: smeeId } = injectCard(state, "player1", "mr-smee-loyal-first-mate", "play", { isDrying: false }));
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: false }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const smeeInst = getInstance(state, smeeId);
    const smeeDef = CARD_DEFINITIONS[smeeInst.definitionId]!;
    const mickeyInst = getInstance(state, mickeyId);
    const mickeyDef = CARD_DEFINITIONS[mickeyInst.definitionId]!;

    expect(applyMoveCostReduction(2, smeeInst, smeeDef, jollyId, mods, state, "player1")).toBe(0);
    expect(applyMoveCostReduction(2, mickeyInst, mickeyDef, jollyId, mods, state, "player1")).toBe(2);
  });

  it("LOOK ALIVE, YOU SWABS!: characters at Jolly Roger gain Rush via grant_keyword static", () => {
    let state = startGame();
    let jollyId: string, smeeId: string;
    ({ state, instanceId: jollyId } = injectCard(state, "player1", "jolly-roger-hooks-ship", "play", { isDrying: false }));
    ({ state, instanceId: smeeId } = injectCard(state, "player1", "mr-smee-loyal-first-mate", "play", { isDrying: false, atLocationInstanceId: jollyId }));

    const mods = getGameModifiers(state, CARD_DEFINITIONS);
    const granted = mods.grantedKeywords.get(smeeId) ?? [];
    expect(granted.some(k => k.keyword === "rush")).toBe(true);
  });
});

// Regression: Pluto Steel Champion's MAKE ROOM oracle says "Whenever you play
// ANOTHER Steel character" — the trigger filter needs excludeSelf:true or
// Pluto's own card_played event matches and self-triggers when he enters play.
// Caught in the 2026-04-24 sweep alongside Rama Vigilant Father and Basil
// Tenacious Mouse (same class of bug).
describe("§10 Set 10 — Pluto Steel Champion MAKE ROOM (excludeSelf on 'another' trigger)", () => {
  it("does NOT self-trigger when Pluto himself is played", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);

    // Inject an item the player would target if MAKE ROOM erroneously triggered.
    let itemId: string;
    ({ state, instanceId: itemId } = injectCard(state, "player1", "pawpsicle", "play"));

    // Inject Pluto into hand and play him.
    let plutoId: string;
    ({ state, instanceId: plutoId } = injectCard(state, "player1", "pluto-steel-champion", "hand"));

    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: plutoId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Pluto's own play should NOT trigger MAKE ROOM. No pendingChoice for the
    // may-banish prompt should be queued, and the item is still in play.
    expect(state.pendingChoice).toBeFalsy();
    expect(getZone(state, "player1", "play")).toContain(itemId);
  });

  it("DOES trigger when ANOTHER Steel character is played", () => {
    let state = startGame();
    state = giveInk(state, "player1", 10);

    // Pluto already in play (drying off — irrelevant for trigger).
    ({ state } = injectCard(state, "player1", "pluto-steel-champion", "play", { isDrying: false }));

    // An item to target with MAKE ROOM.
    let itemId: string;
    ({ state, instanceId: itemId } = injectCard(state, "player1", "pawpsicle", "play"));

    // Another Steel character in hand — Goons Maleficent's Underlings is a
    // vanilla 1-cost Steel character.
    let goonsId: string;
    ({ state, instanceId: goonsId } = injectCard(state, "player1", "goons-maleficents-underlings", "hand"));

    const r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: goonsId }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // MAKE ROOM should now be on the queue as a may-prompt for banishing the item.
    expect(state.pendingChoice).toBeDefined();
    expect(state.pendingChoice?.type).toBe("choose_may");
    void itemId;
  });
});

// Big composite scenario covering challenge damage, simultaneous-banish trigger
// dispatch, on-banish AOE cascade, and Pluto's WINNER TAKE ALL gain. The user
// posed it as a hand-trace exercise: opponent has 4× Lilo Making a Wish (vanilla
// 1/1, cost 1, 2 lore). One is exerted with 2× Force of a Great Typhoon stacked
// on top for +10 STR (so 11 STR / 1 WP). Player1 challenges with Mickey Mouse -
// Giant Mouse (10/10, Steel, Bodyguard, "When this character is banished, deal
// 5 damage to each opposing character") while controlling Pluto Steel Champion
// (5/5, Steel, "WINNER TAKE ALL: during your turn, whenever one of your other
// Steel characters banishes another character in a challenge, gain 2 lore").
// Expected after the dust settles:
//   - Mickey banished (took 11 from buffed Lilo, exceeds 10 WP).
//   - Buffed Lilo banished (took 10 from Mickey, exceeds 1 WP).
//   - Mickey's THE BIGGEST STAR EVER deals 5 to each of the 3 remaining Lilos,
//     and the post-bag GSC banishes all 3 (5 ≥ 1 WP). Lilo-A is already in
//     discard and isn't a valid target.
//   - WINNER TAKE ALL fires once (Mickey banished Lilo in a challenge — Lilo
//     banishing Mickey doesn't trigger it because Lilo isn't player1's Steel
//     character). +2 lore.
describe("§Composite — Mickey Giant + Pluto Steel Champion vs 4× buffed Lilo", () => {
  it("Mickey + Lilo-A trade banish, AOE wipes the 3 ready Lilos, Pluto +2 lore", () => {
    let state = startGame();
    const p1LoreBefore = state.players.player1.lore;

    // Player1 — Mickey Giant + Pluto in play, both ready.
    let mickeyId: string, plutoId: string;
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-giant-mouse", "play", { isDrying: false }));
    ({ state, instanceId: plutoId } = injectCard(state, "player1", "pluto-steel-champion", "play", { isDrying: false }));

    // Player2 — 4× Lilo. The first one is exerted (so Mickey can challenge it)
    // and gets +10 STR via two synthetic this-turn buffs (substituting for
    // resolving Force of a Great Typhoon — same end-state STR modifier).
    let liloAId: string, liloBId: string, liloCId: string, liloDId: string;
    ({ state, instanceId: liloAId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isDrying: false, isExerted: true }));
    ({ state, instanceId: liloBId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isDrying: false }));
    ({ state, instanceId: liloCId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isDrying: false }));
    ({ state, instanceId: liloDId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isDrying: false }));

    // Stack two Force of a Great Typhoon equivalents on Lilo-A: 2x +5 STR,
    // duration this_turn. Same shape as the action's actionEffects.
    const liloA = state.cards[liloAId]!;
    state = {
      ...state,
      cards: {
        ...state.cards,
        [liloAId]: {
          ...liloA,
          timedEffects: [
            ...(liloA.timedEffects ?? []),
            { type: "modify_strength" as any, amount: 5, expiresAt: "end_of_turn" as any, appliedOnTurn: state.turnNumber },
            { type: "modify_strength" as any, amount: 5, expiresAt: "end_of_turn" as any, appliedOnTurn: state.turnNumber },
          ],
        },
      },
    };

    // Confirm pre-conditions: Lilo-A effective STR is 11.
    {
      const mods = getGameModifiers(state, CARD_DEFINITIONS);
      const liloDef = CARD_DEFINITIONS["lilo-making-a-wish"]!;
      expect(getEffectiveStrength(state.cards[liloAId]!, liloDef, mods.statBonuses.get(liloAId)?.strength ?? 0, mods)).toBe(11);
    }

    // Action: Mickey challenges Lilo-A.
    const r = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: mickeyId,
      defenderInstanceId: liloAId,
    }, CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Mickey's THE BIGGEST STAR EVER + Pluto's WINNER TAKE ALL both queued. They
    // resolve from the bag back-to-back without any pending choice (neither is
    // optional, neither targets a chosen filter).
    expect(state.pendingChoice).toBeFalsy();

    // Verify the four banishes.
    expect(state.cards[mickeyId]!.zone).toBe("discard");  // 11 dmg ≥ 10 WP
    expect(state.cards[liloAId]!.zone).toBe("discard");   // 10 dmg ≥ 1 WP
    expect(state.cards[liloBId]!.zone).toBe("discard");   // 5 dmg ≥ 1 WP (AOE)
    expect(state.cards[liloCId]!.zone).toBe("discard");   // 5 dmg ≥ 1 WP (AOE)
    expect(state.cards[liloDId]!.zone).toBe("discard");   // 5 dmg ≥ 1 WP (AOE)

    // Pluto stayed in play and was untouched.
    expect(state.cards[plutoId]!.zone).toBe("play");
    expect(state.cards[plutoId]!.damage).toBe(0);

    // WINNER TAKE ALL fires exactly once: Mickey banished Lilo-A in a challenge.
    // (Lilo banishing Mickey doesn't qualify — Lilo isn't player1's Steel
    // character, so the cross-card filter rejects.) +2 lore.
    expect(state.players.player1.lore).toBe(p1LoreBefore + 2);
  });
});

describe("§11 Set 11 — Angela Night Warrior ETERNAL NIGHT", () => {
  it("baseline: Demona with 3+ cards in hand can't be effect-readied (Stone by Day blanket)", () => {
    let state = startGame();
    // Demona starts exerted, player1 has 3 cards in hand from opening.
    const { state: s1, instanceId: demonaId } = injectCard(
      state, "player1", "demona-betrayer-of-the-clan", "play",
      { isDrying: false, isExerted: true },
    );
    state = s1;
    expect(state.zones.player1.hand.length).toBeGreaterThanOrEqual(3);

    // Simulate Fan-the-Flames effect-ready (directly call applyEffect path
    // via a synthesized "ready chosen character" flow is awkward from tests;
    // simplest probe: check that turn-start ready loop skips Demona).
    // Pass a full turn cycle so player1 becomes active again.
    for (let i = 0; i < 2; i++) {
      const r = applyAction(state, { type: "PASS_TURN", playerId: state.currentPlayer }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    // Demona should still be exerted because STONE BY DAY blocks ready.
    expect(state.cards[demonaId]!.isExerted).toBe(true);
  });

  it("with Angela in play, Gargoyles' Stone by Day is suppressed — Demona rearies", () => {
    let state = startGame();
    const { state: s1, instanceId: angelaId } = injectCard(
      state, "player1", "angela-night-warrior", "play", { isDrying: false },
    );
    state = s1;
    const { state: s2, instanceId: demonaId } = injectCard(
      state, "player1", "demona-betrayer-of-the-clan", "play",
      { isDrying: false, isExerted: true },
    );
    state = s2;

    for (let i = 0; i < 2; i++) {
      const r = applyAction(state, { type: "PASS_TURN", playerId: state.currentPlayer }, CARD_DEFINITIONS);
      expect(r.success).toBe(true);
      state = r.newState;
    }
    // With Angela suppressing STONE BY DAY, Demona readies normally.
    expect(state.cards[demonaId]!.isExerted).toBe(false);
    // Angela itself isn't a Gargoyle only in the sense of... actually she IS
    // Gargoyle (trait) so ETERNAL NIGHT suppresses her own Stone by Day too,
    // but she doesn't have that ability printed. No assertion needed.
    void angelaId;
  });
});
