// =============================================================================
// SET 9 / SET 11 — Unknowns cleanup batch (Max Goof restriction, Graveyard
// of Christmas Future cards-under triggered location)
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "./reducer.js";
import {
  LORCAST_CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
  passTurns,
} from "./test-helpers.js";
import { getInstance, getZone } from "../utils/index.js";

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
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/can't move/i);
  });

  it("Magic Carpet GLIDING RIDE cannot move Max Goof either (effect-based moves honor cant_action_self)", () => {
    // The "can't move" restriction must apply regardless of how the move is
    // initiated — both player MOVE_CHARACTER actions AND effect-driven moves
    // (Magic Carpet, Jim Hawkins TAKE THE HELM) should be blocked.
    let state = startGame();
    state = giveInk(state, "player1", 5);
    let maxId: string, locId: string, carpetId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player1", "max-goof-rockin-teen", "play", { isDrying: false }));
    ({ state, instanceId: locId } = injectCard(state, "player1", "never-land-mermaid-lagoon", "play", { isDrying: false }));
    ({ state, instanceId: carpetId } = injectCard(state, "player1", "magic-carpet-flying-rug", "hand"));

    // Play Magic Carpet — fires GLIDING RIDE, which lets the controller pick a
    // character + location to move via the move_character effect.
    let r = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: carpetId }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 1: choose the character. Max Goof IS in valid targets (the filter
    // doesn't pre-exclude restricted characters — the restriction is enforced
    // when performMove runs).
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [maxId] }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // Stage 2: choose the location.
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [locId] }, LORCAST_CARD_DEFINITIONS);
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
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, mickeyId).atLocationInstanceId).toBe(locId);
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
    }, LORCAST_CARD_DEFINITIONS);
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
    }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;
    expect(getInstance(state, graveyardId).cardsUnder.length).toBe(1);

    // Pass twice to come back to player1 — ANOTHER CHANCE fires at start of turn.
    // Capture hand AFTER the pass (which includes the draw-step card) so we
    // isolate the hand delta from ANOTHER CHANCE alone.
    state = passTurns(state, 2);

    // ANOTHER CHANCE is a "may" — surfaces a choose_may pendingChoice for the controller
    expect(state.pendingChoice?.type).toBe("choose_may");
    const handSizeBeforeMay = getZone(state, "player1", "hand").length;
    r = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(r.success).toBe(true);
    state = r.newState;

    // 1 card moved into hand, Graveyard banished
    expect(getZone(state, "player1", "hand").length).toBe(handSizeBeforeMay + 1);
    expect(getInstance(state, graveyardId).zone).toBe("discard");
  });
});
