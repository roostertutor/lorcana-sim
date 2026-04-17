// =============================================================================
// SET 12 — Dash Parr RECORD TIME, Merida STEADY AIM, Bouncing Ducky REPURPOSED
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, getAllLegalActions } from "./reducer.js";
import {
  CARD_DEFINITIONS,
  startGame,
  injectCard,
  giveInk,
} from "./test-helpers.js";

describe("Set 12 — Dash Parr Lava Runner RECORD TIME", () => {
  it("can quest the turn he's played (bypasses CRD 5.1.1.11 drying)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 4);
    // Inject while drying — RECORD TIME should bypass the restriction.
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "dash-parr-lava-runner",
      "play",
      { isDrying: true }
    );

    const r = applyAction(
      s1,
      { type: "QUEST", playerId: "player1", instanceId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    // Lore:2 is gained on quest.
    expect(r.newState.players.player1.lore).toBe(2);
  });

  it("drying non-RECORD-TIME characters still can't quest (regression guard)", () => {
    let state = startGame();
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "mickey-mouse-brave-little-tailor",
      "play",
      { isDrying: true }
    );
    const r = applyAction(
      s1,
      { type: "QUEST", playerId: "player1", instanceId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/drying/i);
  });

  it("legal actions include QUEST for drying Dash Parr (validator/enumerator parity)", () => {
    let state = startGame();
    const { state: s1, instanceId } = injectCard(
      state,
      "player1",
      "dash-parr-lava-runner",
      "play",
      { isDrying: true }
    );
    const legal = getAllLegalActions(s1, "player1", CARD_DEFINITIONS);
    const quest = legal.find(
      (a) => a.type === "QUEST" && a.instanceId === instanceId
    );
    expect(quest).toBeDefined();
  });
});

describe("Set 12 — Merida Formidable Archer STEADY AIM", () => {
  it("action damage to opposing character triggers +2 damage", () => {
    let state = startGame();
    state = giveInk(state, "player1", 1);
    // Merida (Formidable Archer) in play, drying off so no interference.
    ({ state } = injectCard(state, "player1", "merida-formidable-archer", "play", {
      isDrying: false,
    }));
    // Target: 5-willpower opposing character (Maximus) so it absorbs 2+2 = 4 damage without banishing.
    let maxId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player2", "maximus-palace-horse", "play", {
      isDrying: false,
    }));
    // Inject Fire the Cannons! (deals 2 to chosen) into player1's hand.
    let cannonsId: string;
    ({ state, instanceId: cannonsId } = injectCard(state, "player1", "fire-the-cannons", "hand"));

    // Play the action.
    let r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: cannonsId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // Resolve the target choice (deal 2 damage to Maximus).
    expect(state.pendingChoice?.type).toBe("choose_target");
    r = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [maxId] },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // STEADY AIM is queued as a may-trigger targeting the same card (triggering_card).
    // Resolve the STEADY AIM trigger (accept to deal 2 more damage).
    // The trigger effect has no isMay, so it auto-resolves.
    expect(state.cards[maxId].damage).toBe(4);
  });

  it("challenge damage does NOT trigger STEADY AIM (source is character, not action)", () => {
    let state = startGame();
    // Both Merida + a challenger on player1, with a defender on player2.
    ({ state } = injectCard(state, "player1", "merida-formidable-archer", "play", {
      isDrying: false,
    }));
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(
      state,
      "player1",
      "pumbaa-friendly-warthog",
      "play",
      { isDrying: false }
    ));
    ({ state, instanceId: defenderId } = injectCard(
      state,
      "player2",
      "maximus-palace-horse",
      "play",
      { isDrying: false, isExerted: true }
    ));

    const r = applyAction(
      state,
      {
        type: "CHALLENGE",
        playerId: "player1",
        attackerInstanceId: attackerId,
        defenderInstanceId: defenderId,
      },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // Pumbaa deals his strength in damage to Maximus. STEADY AIM must NOT
    // fire — the source is a character, not an action.
    const dmg = state.cards[defenderId].damage;
    const pumbaaStrength = 3; // Pumbaa Friendly Warthog {S}
    expect(dmg).toBe(pumbaaStrength);
  });
});

describe("Set 12 — Bouncing Ducky REJECTED TOYS + REPURPOSED", () => {
  it("REJECTED TOYS: cost reduced by 1 per Toy character in discard", () => {
    let state = startGame();
    // Print cost is 6. With 3 Toy cards in discard, effective cost should be 3.
    let duckyId: string;
    ({ state, instanceId: duckyId } = injectCard(
      state,
      "player1",
      "bouncing-ducky-sids-toy",
      "hand"
    ));
    // Inject 3 Toy character cards into player1's discard. Ducky herself
    // has the "Toy" trait — any named toy character from set 12 works.
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    state = giveInk(state, "player1", 3);

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: duckyId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
  });

  it("REPURPOSED: on play, all Toy cards in discard go to bottom of deck (choose_order for 2+)", () => {
    let state = startGame();
    state = giveInk(state, "player1", 6);
    let duckyId: string, toy1: string, toy2: string;
    ({ state, instanceId: duckyId } = injectCard(
      state,
      "player1",
      "bouncing-ducky-sids-toy",
      "hand"
    ));
    ({ state, instanceId: toy1 } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));
    ({ state, instanceId: toy2 } = injectCard(state, "player1", "bouncing-ducky-sids-toy", "discard"));

    const r = applyAction(
      state,
      { type: "PLAY_CARD", playerId: "player1", instanceId: duckyId },
      CARD_DEFINITIONS
    );
    expect(r.success).toBe(true);
    state = r.newState;

    // 2 matching discard cards → choose_order pending
    expect(state.pendingChoice?.type).toBe("choose_order");

    // Resolve with toy1 first (bottommost), then toy2
    const r2 = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [toy1, toy2] },
      CARD_DEFINITIONS
    );
    expect(r2.success).toBe(true);
    state = r2.newState;

    // Both toys should now be in player1's deck (at the bottom)
    expect(state.cards[toy1].zone).toBe("deck");
    expect(state.cards[toy2].zone).toBe("deck");
    // The discard should no longer contain them
    expect(state.zones.player1.discard).not.toContain(toy1);
    expect(state.zones.player1.discard).not.toContain(toy2);
  });
});
