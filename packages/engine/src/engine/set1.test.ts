// =============================================================================
// SET 1 — The First Chapter: Card-specific tests
// Tests card abilities from Set 1 that cover unique engine patterns.
// CRD rules tests are in reducer.test.ts. Future sets get their own file.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, getAllLegalActions } from "../engine/reducer.js";
import { LORCAST_CARD_DEFINITIONS, startGame, injectCard, giveInk, setLore } from "./test-helpers.js";
import { getZone, getInstance } from "../utils/index.js";
import { getGameModifiers } from "../engine/gameModifiers.js";

describe("§6 Set 1 Pattern Coverage", () => {
// 1. self_cost_reduction static (LeFou - Bumbler)
  // LeFou costs 2. With a Gaston in play, self_cost_reduction lowers cost by 1.
  it("LeFou costs 1 less when Gaston is in play (self_cost_reduction)", () => {
    let state = startGame(["lefou-bumbler", "gaston-arrogant-hunter"]);
    // Place Gaston in play for player1
    ({ state } = injectCard(state, "player1", "gaston-arrogant-hunter", "play"));
    // Place LeFou in hand (cost 2, but should be 1 with Gaston in play)
    let lefouId: string;
    ({ state, instanceId: lefouId } = injectCard(state, "player1", "lefou-bumbler", "hand"));
    // Give only 1 ink — not enough for base cost 2, but enough for reduced cost 1
    state = giveInk(state, "player1", 1);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: lefouId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, lefouId).zone).toBe("play");
  });

  // 2. extra_ink_play static (Belle - Strange but Special)
  // Belle allows one extra ink play per turn.
  it("Belle allows a second ink play per turn (extra_ink_play)", () => {
    let state = startGame(["belle-strange-but-special"]);
    // Place Belle in play
    ({ state } = injectCard(state, "player1", "belle-strange-but-special", "play"));
    // Place two inkable cards in hand
    let ink1Id: string, ink2Id: string;
    ({ state, instanceId: ink1Id } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    ({ state, instanceId: ink2Id } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    // First ink — should succeed
    let result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId: ink1Id }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Second ink — should also succeed because Belle grants +1 extra ink play
    result = applyAction(result.newState, { type: "PLAY_INK", playerId: "player1", instanceId: ink2Id }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
  });

  // 3. cant_be_challenged static (Captain Hook - Thinking a Happy Thought)
  it("Captain Hook can't be challenged (cant_be_challenged)", () => {
    let state = startGame(["captain-hook-thinking-a-happy-thought"]);
    // Place Hook in play exerted for player2
    let hookId: string;
    ({ state, instanceId: hookId } = injectCard(state, "player2", "captain-hook-thinking-a-happy-thought", "play", { isExerted: true }));
    // Place attacker for player1
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: hookId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(false);
  });

  // 4. create_floating_trigger action (Steal from the Rich)
  // Playing the action creates a floating trigger: quests → opponent loses 1 lore.
  it("Steal from the Rich: questing after play causes opponent to lose 1 lore (create_floating_trigger)", () => {
    let state = startGame(["steal-from-the-rich"]);
    state = giveInk(state, "player1", 10);
    // Give opponent some lore to lose
    state = setLore(state, "player2", 3);

    // Place action in hand
    let actionId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "steal-from-the-rich", "hand"));
    // Place a character that can quest (not drying)
    let questerId: string;
    ({ state, instanceId: questerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    // Play the action
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    state = result.newState;

    // Now quest with the character
    result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: questerId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Opponent should have lost 1 lore (3 → 2)
    expect(result.newState.players.player2.lore).toBe(2);
  });

  // 5. item_played trigger (Maurice - World Famous Inventor)
  // Maurice: "Whenever you play an item, you may draw a card."
  it("Maurice triggers draw when an item is played (item_played trigger)", () => {
    let state = startGame(["maurice-world-famous-inventor", "dinglehopper"]);
    state = giveInk(state, "player1", 10);

    // Place Maurice in play
    ({ state } = injectCard(state, "player1", "maurice-world-famous-inventor", "play"));
    // Place an item in hand
    let itemId: string;
    ({ state, instanceId: itemId } = injectCard(state, "player1", "dinglehopper", "hand"));

    const handBefore = getZone(state, "player1", "hand").length;

    // Play the item — triggers Maurice's isMay draw
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: itemId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // isMay → choose_may prompt
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    // Accept the draw
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Hand: -1 for playing item, +1 for draw = net 0
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore);
  });

  // 6. quests → play_for_free (Genie - Powers Unleashed)
  // Genie: "Whenever this character quests, you may play an action with cost 5 or less for free."
  it("Genie plays an action for free when questing (play_for_free trigger)", () => {
    let state = startGame(["genie-powers-unleashed", "hakuna-matata"]);
    state = giveInk(state, "player1", 0); // No ink — action must be free

    // Place Genie in play (not drying)
    let genieId: string;
    ({ state, instanceId: genieId } = injectCard(state, "player1", "genie-powers-unleashed", "play"));
    // Place action in hand (cost 4, ≤ 5)
    let actionId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "hakuna-matata", "hand"));

    // Quest with Genie — triggers play_for_free
    let result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: genieId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // isMay → choose_may for play_for_free
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    // Accept the may
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // After accepting, should see choose_target to pick which card to play
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    expect(result.newState.pendingChoice?.validTargets).toContain(actionId);

    // Choose the action
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [actionId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // The action should have been played from hand (moved out of hand)
    expect(getInstance(result.newState, actionId).zone).not.toBe("hand");
  });

  // 7. enters_play → cant_action (Anna - Heir to Arendelle)
  // Anna: "When you play this character, if you have a character named Elsa in play,
  //        chosen opposing character doesn't ready at the start of their next turn."
  it("Anna applies cant_action (ready) when Elsa is in play (enters_play + condition)", () => {
    let state = startGame(["anna-heir-to-arendelle", "elsa-snow-queen"]);
    state = giveInk(state, "player1", 10);

    // Place Elsa in play for player1 (satisfies condition)
    ({ state } = injectCard(state, "player1", "elsa-snow-queen", "play"));
    // Place an opposing character as target
    let targetId: string;
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    // Place Anna in hand
    let annaId: string;
    ({ state, instanceId: annaId } = injectCard(state, "player1", "anna-heir-to-arendelle", "hand"));

    // Play Anna — triggers enters_play with Elsa condition met
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: annaId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Should prompt to choose a target
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    expect(result.newState.pendingChoice?.validTargets).toContain(targetId);

    // Choose the target
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Target should have a cant_action timed effect for "ready"
    const target = getInstance(result.newState, targetId);
    expect(target.timedEffects.some((e: any) => e.type === "cant_action" && e.action === "ready")).toBe(true);
  });

  // 8. card_played → cant_action (Mickey Mouse - Artful Rogue)
  // Mickey: "Whenever you play an action, chosen opposing character can't quest during their next turn."
  it("Mickey Mouse Artful Rogue applies cant_action (quest) on action played", () => {
    let state = startGame(["mickey-mouse-artful-rogue", "control-your-temper"]);
    state = giveInk(state, "player1", 10);

    // Place Mickey in play
    ({ state } = injectCard(state, "player1", "mickey-mouse-artful-rogue", "play"));
    // Place an opposing character as target
    let targetId: string;
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    // Place an action in hand
    let actionId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "control-your-temper", "hand"));

    // Play the action — Mickey's trigger fires
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Resolve all pending choices (control-your-temper has a target, then Mickey's trigger has a target)
    while (result.newState.pendingChoice) {
      if (result.newState.pendingChoice.type === "choose_target") {
        result = applyAction(result.newState, {
          type: "RESOLVE_CHOICE", playerId: result.newState.pendingChoice.choosingPlayerId,
          choice: [targetId],
        }, LORCAST_CARD_DEFINITIONS);
      } else if (result.newState.pendingChoice.type === "choose_may") {
        result = applyAction(result.newState, {
          type: "RESOLVE_CHOICE", playerId: result.newState.pendingChoice.choosingPlayerId,
          choice: "accept",
        }, LORCAST_CARD_DEFINITIONS);
      } else {
        break;
      }
      expect(result.success).toBe(true);
    }

    // Target should have cant_action for "quest"
    const target = getInstance(result.newState, targetId);
    expect(target.timedEffects.some((e: any) => e.type === "cant_action" && e.action === "quest")).toBe(true);
  });
});
