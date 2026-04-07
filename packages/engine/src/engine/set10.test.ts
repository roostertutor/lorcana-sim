// =============================================================================
// SET 10 — Boost (CRD 8.4) + cards-under references
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";
import { getInstance, getZone, getEffectiveStrength, moveCard } from "../utils/index.js";
import { getGameModifiers } from "./gameModifiers.js";

describe("§10 Set 10 — Boost (CRD 8.4)", () => {
  it("BOOST_CARD: pays cost, moves top of deck under, marks boostedThisTurn", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    const inkBefore = state.players.player1.availableInk;
    const deckTopBefore = getZone(state, "player1", "deck")[0]!;

    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, LORCAST_CARD_DEFINITIONS);
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

    let r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
  });

  it("Flynn Rider I'LL TAKE THAT: +2 {S} +1 {L} static activates when a card is under", () => {
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let flynnId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player1", "flynn-rider-spectral-scoundrel", "play", { isDrying: false }));

    // Without cards under, the static condition is false → no bonus.
    let mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(mods.statBonuses.get(flynnId)?.strength ?? 0).toBe(0);

    // Boost adds a card under → static fires.
    const r = applyAction(state, { type: "BOOST_CARD", playerId: "player1", instanceId: flynnId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    mods = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
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
    }, LORCAST_CARD_DEFINITIONS);
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
});
