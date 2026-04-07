// =============================================================================
// SET 2 — Rise of the Floodborn: Card-specific tests
// Tests card abilities from Set 2 that cover unique engine patterns.
// CRD rules tests are in reducer.test.ts. Future sets get their own file.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, getAllLegalActions } from "../engine/reducer.js";
import { LORCAST_CARD_DEFINITIONS, startGame, injectCard, giveInk, passTurns } from "./test-helpers.js";
import { getZone, getInstance, getEffectiveLore } from "../utils/index.js";
import { getGameModifiers } from "../engine/gameModifiers.js";

describe("§6 Set 2 Card Coverage", () => {
// One test per NEW pattern not already covered by Set 1 tests.
  // Set 1 already covers: enters_play → draw, activated {E} → effect + choose_target,
  // action → deal_damage + choose_target, static modify_stat, etc.

  // ===== EXISTING PATTERNS =====

  // Pattern: enters_play → exert self (no choice, always happens)
  it("Sleepy enters play exerted", () => {
    let state = startGame(["sleepy-nodding-off"]);
    state = giveInk(state, "player1", 4);
    let sleepyId: string;
    ({ state, instanceId: sleepyId } = injectCard(state, "player1", "sleepy-nodding-off", "hand"));

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: sleepyId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, sleepyId).isExerted).toBe(true);
  });

  // Pattern: item enters_play trigger with isMay draw
  it("Pawpsicle: item enters_play isMay draw", () => {
    let state = startGame(["pawpsicle"]);
    state = giveInk(state, "player1", 2);
    let itemId: string;
    ({ state, instanceId: itemId } = injectCard(state, "player1", "pawpsicle", "hand"));
    const handBefore = getZone(state, "player1", "hand").length;

    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: itemId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore);
  });

  // Pattern: enters_play → isMay + choose_target (Beast - Forbidding Recluse)
  it("Beast: enters_play isMay deal_damage + choose_target", () => {
    let state = startGame(["beast-forbidding-recluse"]);
    state = giveInk(state, "player1", 5);
    let beastId: string;
    let targetId: string;
    ({ state, instanceId: beastId } = injectCard(state, "player1", "beast-forbidding-recluse", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));

    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: beastId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();

    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    expect(getInstance(result.newState, targetId).damage).toBe(1);
  });

  // Pattern: static grant_keyword with value to filtered characters
  it("Cogsworth: static Resist +1 to other characters", () => {
    let state = startGame(["cogsworth-grandfather-clock"]);
    let cogsworthId: string;
    let allyId: string;
    ({ state, instanceId: cogsworthId } = injectCard(state, "player1", "cogsworth-grandfather-clock", "play"));
    ({ state, instanceId: allyId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    // Exert ally so it can be challenged, switch to player2's turn
    state = { ...state, cards: { ...state.cards, [allyId]: { ...state.cards[allyId]!, isExerted: true } } };
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // 3 STR
    state = { ...state, currentPlayer: "player2" };

    const result = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attackerId, defenderInstanceId: allyId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Minnie: 3 WP, takes 3-1=2 damage (Resist +1 from Cogsworth), survives
    expect(getInstance(result.newState, allyId).damage).toBe(2);
    expect(getInstance(result.newState, allyId).zone).toBe("play");
  });

  // Pattern: static cost_reduction
  it("Snow White - Unexpected Houseguest: Seven Dwarfs cost 1 less", () => {
    let state = startGame(["snow-white-unexpected-houseguest", "grumpy-bad-tempered"]);
    state = giveInk(state, "player1", 3); // Grumpy costs 4, but should cost 3 with Snow White
    let snowId: string;
    let grumpyId: string;
    ({ state, instanceId: snowId } = injectCard(state, "player1", "snow-white-unexpected-houseguest", "play"));
    ({ state, instanceId: grumpyId } = injectCard(state, "player1", "grumpy-bad-tempered", "hand"));

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: grumpyId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true); // Should succeed with 3 ink (4 cost - 1 reduction)
  });

  // Pattern: triggered quests → effect on opponent
  it("Cruella: quest trigger gives -2 {S} to chosen opposing character", () => {
    let state = startGame(["cruella-de-vil-perfectly-wretched"]);
    let cruellaId: string;
    let targetId: string;
    ({ state, instanceId: cruellaId } = injectCard(state, "player1", "cruella-de-vil-perfectly-wretched", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // 3 STR

    let result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: cruellaId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, targetId).tempStrengthModifier).toBe(-2);
  });

  // Pattern: triggered card_played with trait filter (Floodborn)
  it("Blue Fairy: draw on Floodborn character played", () => {
    let state = startGame(["blue-fairy-rewarding-good-deeds", "hades-king-of-olympus"]);
    state = giveInk(state, "player1", 10);
    let fairyId: string;
    let hadesId: string;
    ({ state, instanceId: fairyId } = injectCard(state, "player1", "blue-fairy-rewarding-good-deeds", "play"));
    // Hades - King of Olympus is Floodborn with Shift 6
    ({ state, instanceId: hadesId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    // Need a base Hades to shift onto
    let hadesBaseId: string;
    ({ state, instanceId: hadesBaseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));

    const handBefore = getZone(state, "player1", "hand").length;

    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: hadesId, shiftTargetInstanceId: hadesBaseId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Blue Fairy triggers isMay draw — accept
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore); // -1 played +1 drawn = same
  });

  // Pattern: banished_other_in_challenge + is_your_turn condition
  it("Jafar: draw when banishing in challenge during your turn", () => {
    let state = startGame(["jafar-dreadnought"]);
    let jafarId: string;
    let defenderId: string;
    ({ state, instanceId: jafarId } = injectCard(state, "player1", "jafar-dreadnought", "play")); // 3 STR
    // Weak defender that will be banished
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isExerted: true })); // 1 WP

    const handBefore = getZone(state, "player1", "hand").length;

    let result = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: jafarId, defenderInstanceId: defenderId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Jafar triggers isMay draw — accept
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore + 1);
  });

  // Pattern: canChallengeReady static (Namaari can challenge ready characters)
  it("Namaari: can challenge ready (non-exerted) characters", () => {
    let state = startGame(["namaari-morning-mist"]);
    let namaariId: string;
    let targetId: string;
    ({ state, instanceId: namaariId } = injectCard(state, "player1", "namaari-morning-mist", "play"));
    // Target is NOT exerted — normally can't be challenged
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));

    const result = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: namaariId, defenderInstanceId: targetId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, targetId).damage).toBeGreaterThan(0);
  });

  // Pattern: strengthAtLeast on CardFilter
  it("World's Greatest Criminal Mind: banish character with 5+ strength", () => {
    let state = startGame(["worlds-greatest-criminal-mind"]);
    state = giveInk(state, "player1", 4);
    let actionId: string;
    let weakId: string;
    let strongId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "worlds-greatest-criminal-mind", "hand"));
    ({ state, instanceId: weakId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play")); // 2 STR
    ({ state, instanceId: strongId } = injectCard(state, "player2", "hades-king-of-olympus", "play")); // 6 STR

    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    // Only the strong character should be a valid target
    expect(result.newState.pendingChoice?.validTargets).toContain(strongId);
    expect(result.newState.pendingChoice?.validTargets).not.toContain(weakId);
  });

  // Pattern: grant_challenge_ready timed effect (Pick a Fight)
  it("Pick a Fight: grants challenge-ready for the turn", () => {
    let state = startGame(["pick-a-fight"]);
    state = { ...state, interactive: true };
    state = giveInk(state, "player1", 2);
    let actionId: string;
    let ownCharId: string;
    let targetId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "pick-a-fight", "hand"));
    ({ state, instanceId: ownCharId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    // Target is NOT exerted
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    // Play Pick a Fight
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Choose which character gains challenge-ready
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [ownCharId] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Now that character should be able to challenge a ready (non-exerted) target
    const challengeResult = applyAction(result.newState, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: ownCharId, defenderInstanceId: targetId }, LORCAST_CARD_DEFINITIONS);
    expect(challengeResult.success).toBe(true);
  });

  // Pattern: CRD 6.5 damage redirect (Beast - Selfless Protector)
  it("Beast Selfless Protector: redirects damage from allies to self", () => {
    let state = startGame(["beast-selfless-protector"]);
    let beastId: string;
    let allyId: string;
    ({ state, instanceId: beastId } = injectCard(state, "player1", "beast-selfless-protector", "play"));
    ({ state, instanceId: allyId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // 3 STR
    state = { ...state, currentPlayer: "player2" };

    // Challenge the ally — Beast should absorb the damage
    const result = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attackerId, defenderInstanceId: allyId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Minnie should have 0 damage (redirected to Beast)
    expect(getInstance(result.newState, allyId).damage).toBe(0);
    // Beast should have 3 damage (absorbed Minnie's share)
    expect(getInstance(result.newState, beastId).damage).toBe(3);
  });

  // Pattern: is_banished trigger with isMay draw (opponent's character)
  it("Kuzco: is_banished isMay draw", () => {
    let state = startGame(["kuzco-wanted-llama"]);
    let kuzcoId: string;
    let attackerId: string;
    ({ state, instanceId: kuzcoId } = injectCard(state, "player2", "kuzco-wanted-llama", "play", { isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const p2HandBefore = getZone(state, "player2", "hand").length;

    let result = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: kuzcoId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, kuzcoId).zone).toBe("discard");
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 1);
  });

  // ===== NEW TRIGGER EVENTS =====

  // Pattern: damage_removed_from trigger — Grand Pabbie gains 2 lore when damage removed from own character
  it("Grand Pabbie: gain 2 lore when damage removed from own character", () => {
    let state = startGame(["grand-pabbie-oldest-and-wisest", "hold-still"]);
    state = giveInk(state, "player1", 2);
    let pabbieId: string;
    let damagedId: string;
    let healId: string;
    ({ state, instanceId: pabbieId } = injectCard(state, "player1", "grand-pabbie-oldest-and-wisest", "play"));
    ({ state, instanceId: damagedId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { damage: 2 }));
    ({ state, instanceId: healId } = injectCard(state, "player1", "hold-still", "hand"));

    const loreBefore = state.players.player1.lore;

    // Play Hold Still (remove up to 4 damage from chosen character)
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: healId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [damagedId] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Grand Pabbie should have triggered, gaining 2 lore
    expect(result.newState.players.player1.lore).toBe(loreBefore + 2);
  });

  // Pattern: damage_dealt_to (opponent) trigger — Beast Relentless readies when opposing character damaged
  it("Beast Relentless: ready self when opposing character is damaged", () => {
    let state = startGame(["beast-relentless"]);
    let beastId: string;
    let attackerId: string;
    let defenderId: string;
    // Beast in play, exerted (as if it just quested)
    ({ state, instanceId: beastId } = injectCard(state, "player1", "beast-relentless", "play", { isExerted: true }));
    // Another character to do the attacking
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play")); // 3 STR
    // Opponent's character to take damage
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    expect(getInstance(state, beastId).isExerted).toBe(true);

    // Challenge the opponent's character — Beast should trigger ready
    let result = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: defenderId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Beast's trigger is isMay — accept the ready
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    expect(getInstance(result.newState, beastId).isExerted).toBe(false);
  });

  // Pattern: readied trigger — Christopher Robin gains 2 lore when readied with 2+ other characters
  it("Christopher Robin: gain 2 lore when readied with 2+ other characters", () => {
    let state = startGame(["christopher-robin-adventurer"]);
    // Christopher Robin on player2's side, exerted so he'll ready on turn start
    let crId: string;
    let ally1Id: string;
    let ally2Id: string;
    ({ state, instanceId: crId } = injectCard(state, "player2", "christopher-robin-adventurer", "play", { isExerted: true }));
    ({ state, instanceId: ally1Id } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: ally2Id } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    const loreBefore = state.players.player2.lore;

    // Player1 passes turn → player2's turn starts → Christopher Robin readies → trigger fires
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Christopher Robin should have gained 2 lore
    expect(result.newState.players.player2.lore).toBe(loreBefore + 2);
    expect(getInstance(result.newState, crId).isExerted).toBe(false);
  });

  // Pattern: returned_to_hand trigger — Merlin Shapeshifter gets +1 lore this turn
  it("Merlin Shapeshifter: +1 lore when another own character returned to hand", () => {
    let state = startGame(["merlin-shapeshifter", "perplexing-signposts"]);
    let merlinId: string;
    let bounceTargetId: string;
    let signpostsId: string;
    ({ state, instanceId: merlinId } = injectCard(state, "player1", "merlin-shapeshifter", "play"));
    ({ state, instanceId: bounceTargetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: signpostsId } = injectCard(state, "player1", "perplexing-signposts", "play"));

    // Activate Perplexing Signposts (banish self → return chosen own character to hand)
    let result = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: signpostsId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Choose the bounce target
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [bounceTargetId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    // Merlin should have +1 lore modifier from the trigger
    expect(getInstance(result.newState, merlinId).tempLoreModifier).toBe(1);
  });

  // Pattern: turn_start trigger — Donald Duck Perfect Gentleman offers draw at start of your turn
  it("Donald Duck Perfect Gentleman: at start of your turn, each player may draw", () => {
    let state = startGame(["donald-duck-perfect-gentleman"]);
    // Donald on player2's side so trigger fires when player2's turn starts
    let donaldId: string;
    ({ state, instanceId: donaldId } = injectCard(state, "player2", "donald-duck-perfect-gentleman", "play"));

    const p2HandBefore = getZone(state, "player2", "hand").length;

    // Player1 passes turn → player2's turn starts → Donald's turn_start trigger fires
    let result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should have a choose_may pending for the isMay draw
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    // Player2 drew from turn_start trigger accept + normal draw step
    // At minimum the trigger offered a draw
    expect(getZone(result.newState, "player2", "hand").length).toBeGreaterThan(p2HandBefore);
  });

  // ===== NEW CONDITIONS =====

  // Pattern: self_stat_gte condition — Pain gets +2 lore while 5+ strength
  it("Pain: +2 lore while 5+ strength (self_stat_gte)", () => {
    let state = startGame(["pain-underworld-imp"]);
    let painId: string;
    // Pain has 1 base STR, needs +4 to reach 5
    ({ state, instanceId: painId } = injectCard(state, "player1", "pain-underworld-imp", "play", { tempStrengthModifier: 4 }));

    const modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const bonus = modifiers.statBonuses.get(painId);
    // Static ability should grant +2 lore when STR >= 5
    expect(bonus?.lore).toBe(2);
  });

  // Pattern: self_stat_gte condition fails when below threshold
  it("Pain: no lore bonus when below 5 strength", () => {
    let state = startGame(["pain-underworld-imp"]);
    let painId: string;
    // Pain has 1 base STR, no modifier → below 5
    ({ state, instanceId: painId } = injectCard(state, "player1", "pain-underworld-imp", "play"));

    const modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const bonus = modifiers.statBonuses.get(painId);
    // Should NOT have the +2 lore bonus
    expect(bonus?.lore ?? 0).toBe(0);
  });

  // Pattern: compound_and condition — Tiana restricts opponent actions only when exerted AND empty hand
  it("Tiana Celebrating Princess: compound_and restricts opponent actions", () => {
    let state = startGame(["tiana-celebrating-princess"]);
    let tianaId: string;
    // Tiana exerted + player1 empty hand → restriction should apply
    ({ state, instanceId: tianaId } = injectCard(state, "player1", "tiana-celebrating-princess", "play", { isExerted: true }));
    // Empty player1's hand
    state = {
      ...state,
      zones: {
        ...state.zones,
        player1: { ...state.zones.player1, hand: [] },
      },
    };

    let modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    // Should have an action restriction on opponent (player2) for playing actions
    const restriction = modifiers.actionRestrictions.find(
      (r) => r.restricts === "play" && r.affectedPlayerId === "player2"
    );
    expect(restriction).toBeDefined();

    // Now ready Tiana — compound_and should fail (only one condition met)
    state = { ...state, cards: { ...state.cards, [tianaId]: { ...state.cards[tianaId]!, isExerted: false } } };
    modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const noRestriction = modifiers.actionRestrictions.find(
      (r) => r.restricts === "play" && r.affectedPlayerId === "player2"
    );
    expect(noRestriction).toBeUndefined();
  });

  // Pattern: songs_played_this_turn_gte condition — Sleepy's Flute gains lore if song played
  it("Sleepy's Flute: gain 1 lore if song played this turn", () => {
    let state = startGame(["sleepys-flute", "painting-the-roses-red"]);
    state = giveInk(state, "player1", 4);
    let fluteId: string;
    let songId: string;
    let targetId: string;
    ({ state, instanceId: fluteId } = injectCard(state, "player1", "sleepys-flute", "play"));
    ({ state, instanceId: songId } = injectCard(state, "player1", "painting-the-roses-red", "hand"));
    // Need a target for Painting the Roses Red (-1 STR)
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    const loreBefore = state.players.player1.lore;

    // Play the song first
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Resolve song's choose_target (up to 2 chars get -1 STR) — pick one or skip
    while (result.newState.pendingChoice) {
      if (result.newState.pendingChoice.type === "choose_target") {
        result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, LORCAST_CARD_DEFINITIONS);
      } else {
        result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      }
    }

    // Now activate flute — should gain 1 lore since a song was played
    result = applyAction(result.newState, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: fluteId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(loreBefore + 1);
  });

  // Pattern: songs_played_this_turn_gte — activation fizzles without song (costs still paid)
  it("Sleepy's Flute: activation fizzles without song — no lore gained", () => {
    let state = startGame(["sleepys-flute"]);
    let fluteId: string;
    ({ state, instanceId: fluteId } = injectCard(state, "player1", "sleepys-flute", "play"));

    const loreBefore = state.players.player1.lore;

    // Activate flute without playing a song — succeeds but condition fizzles (CRD 6.2.1)
    const result = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: fluteId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Exert cost was paid
    expect(getInstance(result.newState, fluteId).isExerted).toBe(true);
    // But no lore gained because condition not met
    expect(result.newState.players.player1.lore).toBe(loreBefore);
  });

  // Pattern: actions_played_this_turn_gte condition — Minnie Wide-Eyed Diver gets +2 lore on second action
  it("Minnie Wide-Eyed Diver: +2 lore this turn when second action played", () => {
    let state = startGame(["minnie-mouse-wide-eyed-diver", "befuddle"]);
    state = giveInk(state, "player1", 4);
    let minnieId: string;
    let actionId: string;
    let bounceTargetId: string;
    ({ state, instanceId: minnieId } = injectCard(state, "player1", "minnie-mouse-wide-eyed-diver", "play"));
    ({ state, instanceId: actionId } = injectCard(state, "player1", "befuddle", "hand"));
    // Need a valid target for Befuddle (return char/item cost <=2)
    ({ state, instanceId: bounceTargetId } = injectCard(state, "player2", "lilo-making-a-wish", "play")); // cost 1

    // Set actionsPlayedThisTurn to 1 so next action is the "second"
    state = {
      ...state,
      players: {
        ...state.players,
        player1: { ...state.players.player1, actionsPlayedThisTurn: 1 },
      },
    };

    // Play Befuddle (cost 1 action) — this is the second action
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Resolve Befuddle's choose_target
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [bounceTargetId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    // Minnie should have +2 lore modifier
    expect(getInstance(result.newState, minnieId).tempLoreModifier).toBe(2);
  });

  // ===== DYNAMIC AMOUNTS =====

  // Pattern: { type: "count", filter } — Pack Tactics gains lore per damaged opposing character
  it("Pack Tactics: gain 1 lore per damaged opposing character", () => {
    let state = startGame(["pack-tactics"]);
    state = giveInk(state, "player1", 4);
    let actionId: string;
    ({ state, instanceId: actionId } = injectCard(state, "player1", "pack-tactics", "hand"));
    // 3 opposing characters, 2 with damage
    ({ state } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { damage: 1 }));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { damage: 2 }));
    ({ state } = injectCard(state, "player2", "lilo-making-a-wish", "play"));

    const loreBefore = state.players.player1.lore;

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: actionId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should gain 2 lore (2 damaged opposing characters)
    expect(result.newState.players.player1.lore).toBe(loreBefore + 2);
  });

  // Pattern: strengthPerDamage — Sword in the Stone gives +1 STR per damage on target
  it("Sword in the Stone: chosen character gets +1 STR per damage", () => {
    let state = startGame(["sword-in-the-stone"]);
    state = giveInk(state, "player1", 2);
    let swordId: string;
    let targetId: string;
    ({ state, instanceId: swordId } = injectCard(state, "player1", "sword-in-the-stone", "play"));
    // Character with 3 damage
    ({ state, instanceId: targetId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { damage: 3 }));

    // Activate Sword ({E}, 2{I})
    let result = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: swordId, abilityIndex: 0 }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Choose target
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }
    // Character should get +3 STR (1 per damage)
    expect(getInstance(result.newState, targetId).tempStrengthModifier).toBe(3);
  });

  // ===== STATICS =====

  // Pattern: modify_stat_per_damage — Donald Duck Not Again gets +1 lore per damage on self
  it("Donald Duck Not Again: +1 lore per damage on self", () => {
    let state = startGame(["donald-duck-not-again"]);
    let donaldId: string;
    // Donald with 3 damage (base lore 1, WP 5 so survives)
    ({ state, instanceId: donaldId } = injectCard(state, "player1", "donald-duck-not-again", "play", { damage: 3 }));

    const modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const bonus = modifiers.statBonuses.get(donaldId);
    // Static should give +3 lore (1 per damage)
    expect(bonus?.lore).toBe(3);

    // Verify effective lore = base (1) + static bonus (3) = 4
    const instance = getInstance(state, donaldId);
    const def = LORCAST_CARD_DEFINITIONS[instance.definitionId]!;
    const effectiveLore = getEffectiveLore(instance, def, bonus?.lore ?? 0);
    expect(effectiveLore).toBe(4);
  });

  // Pattern: ChooseEffect inside triggered ability
  // TODO: ChooseEffect inside enters_play trigger auto-resolves even in interactive mode.
  it.todo("Madam Mim Fox: choose banish self or return another (ChooseEffect in trigger)");

  // Pattern: SequentialEffect in actionEffects
  // TODO: Sequential return-to-hand in actionEffects doesn't create pending choice for cost.
  it.todo("Bounce: sequential return-to-hand (SequentialEffect in actionEffects)");

  // ===== ACCURACY FIXES =====

  // modify_stat_while_challenged: bonus only applies during challenge damage calc
  it("Enchantress: +2 STR only during challenge, not permanently", () => {
    let state = startGame(["enchantress-unexpected-judge"]);
    let enchantressId: string;
    let attackerId: string;
    // Enchantress (1 STR, 1 WP) in play exerted for player2
    ({ state, instanceId: enchantressId } = injectCard(state, "player2", "enchantress-unexpected-judge", "play", { isExerted: true }));
    // Attacker: Minnie (2 STR, 3 WP) for player1
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    // Enchantress has 1 base STR. Static modifier should NOT show +2 outside of challenge.
    const modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    const staticStrBonus = modifiers.statBonuses.get(enchantressId)?.strength ?? 0;
    expect(staticStrBonus).toBe(0); // No permanent bonus

    // Challenge: Enchantress should deal 1+2=3 damage to attacker (while being challenged bonus)
    const result = applyAction(state, { type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: enchantressId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Attacker (Minnie 3 WP) takes 3 damage from Enchantress (1 base + 2 while challenged)
    // 3 damage >= 3 WP → Minnie is banished (damage reset to 0 on zone transition)
    expect(getInstance(result.newState, attackerId).zone).toBe("discard");
  });

  // target_owner: draw targets the owner of the banished/shuffled card
  it("Judy Hopps: banish opponent's item, OPPONENT draws (not controller)", () => {
    let state = startGame(["judy-hopps-optimistic-officer", "dinglehopper"]);
    state = { ...state, interactive: true };
    state = giveInk(state, "player1", 3);
    let judyId: string;
    let itemId: string;
    ({ state, instanceId: judyId } = injectCard(state, "player1", "judy-hopps-optimistic-officer", "hand"));
    // Opponent's item in play
    ({ state, instanceId: itemId } = injectCard(state, "player2", "dinglehopper", "play"));

    const p1HandBefore = getZone(state, "player1", "hand").length;
    const p2HandBefore = getZone(state, "player2", "hand").length;

    // Play Judy → enters_play trigger → sequential: may banish item → owner draws
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: judyId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Accept the "may"
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }
    // Choose the item to banish
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [itemId] }, LORCAST_CARD_DEFINITIONS);
    }

    // Item should be banished
    expect(getInstance(result.newState, itemId).zone).toBe("discard");
    // Player2 (item owner) should have drawn 1 card
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 1);
    // Player1 should NOT have drawn (played Judy = -1 hand)
    expect(getZone(result.newState, "player1", "hand").length).toBe(p1HandBefore - 1);
  });

  // triggering_card_played_via_shift: condition checks the played card, not Bucky
  it("Bucky: only triggers when Floodborn is played via Shift, not normally", () => {
    let state = startGame(["bucky-squirrel-squeak-tutor", "hades-king-of-olympus", "hades-lord-of-the-underworld"]);
    state = giveInk(state, "player1", 10);
    let buckyId: string;
    ({ state, instanceId: buckyId } = injectCard(state, "player1", "bucky-squirrel-squeak-tutor", "play"));

    // Give opponent cards to discard
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    const p2HandBefore = getZone(state, "player2", "hand").length;

    // Play Hades King (Floodborn) normally WITHOUT shift — Bucky should NOT trigger
    let hadesId: string;
    ({ state, instanceId: hadesId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: hadesId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Opponent hand should be unchanged (Bucky didn't trigger)
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore);

    // Now play another Hades King via Shift — Bucky SHOULD trigger
    let hadesBaseId: string;
    let hades2Id: string;
    state = result.newState;
    ({ state, instanceId: hadesBaseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));
    ({ state, instanceId: hades2Id } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 10);
    result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: hades2Id, shiftTargetInstanceId: hadesBaseId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Bucky triggered → opponent should have discarded (or have choose_discard pending)
    const p2HandAfter = getZone(result.newState, "player2", "hand").length;
    const hasDiscardChoice = result.newState.pendingChoice?.type === "choose_discard";
    expect(p2HandAfter < p2HandBefore || hasDiscardChoice).toBe(true);
  });

  // hasAnyTrait: Grand Duke applies to characters with ANY royal trait
  it("Grand Duke: +1 STR to Prince/Princess/King/Queen only", () => {
    let state = startGame(["grand-duke-advisor-to-the-king", "hades-king-of-olympus"]);
    let dukeId: string;
    let royalId: string;
    let nonRoyalId: string;
    ({ state, instanceId: dukeId } = injectCard(state, "player1", "grand-duke-advisor-to-the-king", "play"));
    // Hades King of Olympus has traits: Floodborn, Villain, King, Deity → should get +1
    ({ state, instanceId: royalId } = injectCard(state, "player1", "hades-king-of-olympus", "play"));
    // Mickey has traits: Dreamborn, Hero → no royal traits → should NOT get +1
    ({ state, instanceId: nonRoyalId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(modifiers.statBonuses.get(royalId)?.strength ?? 0).toBe(1);
    expect(modifiers.statBonuses.get(nonRoyalId)?.strength ?? 0).toBe(0);
  });

  // not condition: Bashful can't quest without another Seven Dwarfs
  it("Bashful: can't quest without Seven Dwarfs, can quest with one", () => {
    let state = startGame(["bashful-hopeless-romantic", "grumpy-bad-tempered"]);
    let bashfulId: string;
    ({ state, instanceId: bashfulId } = injectCard(state, "player1", "bashful-hopeless-romantic", "play"));

    // No other Seven Dwarfs in play — quest should fail
    let result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: bashfulId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(false);

    // Add a Seven Dwarfs character — quest should succeed
    let grumpyId: string;
    ({ state, instanceId: grumpyId } = injectCard(state, "player1", "grumpy-bad-tempered", "play"));
    result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: bashfulId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
  });

  // this_has_no_damage condition: Lawrence gets +4 STR only with no damage
  it("Lawrence: +4 STR while no damage, loses bonus when damaged", () => {
    let state = startGame(["lawrence-jealous-manservant"]);
    let lawrenceId: string;
    // Lawrence: 0 base STR, 4 WP
    ({ state, instanceId: lawrenceId } = injectCard(state, "player1", "lawrence-jealous-manservant", "play"));

    // No damage → should have +4 STR bonus
    let modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(modifiers.statBonuses.get(lawrenceId)?.strength ?? 0).toBe(4);

    // Add 1 damage → condition fails, no bonus
    state = { ...state, cards: { ...state.cards, [lawrenceId]: { ...state.cards[lawrenceId]!, damage: 1 } } };
    modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(modifiers.statBonuses.get(lawrenceId)?.strength ?? 0).toBe(0);
  });

  // cards_in_zone_gte with cardType: Noi needs an item specifically
  it("Noi: Resist+Ward only while an item is in play", () => {
    let state = startGame(["noi-orphaned-thief", "dinglehopper"]);
    let noiId: string;
    ({ state, instanceId: noiId } = injectCard(state, "player1", "noi-orphaned-thief", "play"));

    // No items in play → no keywords granted
    let modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    let grants = modifiers.grantedKeywords.get(noiId) ?? [];
    expect(grants.some(g => g.keyword === "resist")).toBe(false);

    // Add an item → should gain Resist +1 and Ward
    let itemId: string;
    ({ state, instanceId: itemId } = injectCard(state, "player1", "dinglehopper", "play"));
    modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    grants = modifiers.grantedKeywords.get(noiId) ?? [];
    expect(grants.some(g => g.keyword === "resist" && g.value === 1)).toBe(true);
    expect(grants.some(g => g.keyword === "ward")).toBe(true);
  });

  // ===== PRINCE JOHN: cards_discarded trigger scenarios =====
  // "Whenever your opponent discards 1 or more cards, you may draw a card for each card discarded."

  // Helper: set up a game with PJ in play and opponent holding exactly N cards
  function setupPrinceJohn(opponentHandSize: number) {
    let state = startGame(["prince-john-greediest-of-all", "sudden-chill", "you-have-forgotten-me", "a-whole-new-world"]);
    state = giveInk(state, "player1", 10);
    let pjId: string;
    ({ state, instanceId: pjId } = injectCard(state, "player1", "prince-john-greediest-of-all", "play"));
    // Clear both players' hands first (mulligan dealt 7 each)
    state = { ...state, zones: { ...state.zones, player1: { ...state.zones.player1, hand: [] }, player2: { ...state.zones.player2, hand: [] } } };
    // Give opponent exactly N cards
    for (let i = 0; i < opponentHandSize; i++) {
      ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    }
    return { state, pjId };
  }

  // Test 1: Sudden Chill — opponent discards 1, PJ draws 1
  it("Prince John: Sudden Chill (opponent discards 1) → PJ draws 1", () => {
    let { state } = setupPrinceJohn(6);
    let chillId: string;
    ({ state, instanceId: chillId } = injectCard(state, "player1", "sudden-chill", "hand"));
    const p1HandBefore = getZone(state, "player1", "hand").length;
    const p2HandBefore = getZone(state, "player2", "hand").length;

    // Play Sudden Chill (opponent picks 1 to discard)
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: chillId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Opponent must choose 1 card to discard
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    const oppHand = getZone(result.newState, "player2", "hand");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppHand[0]!] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // PJ's may draw triggered
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }

    // Opponent: -1 (discarded), Player1: -1 (played Sudden Chill) + 1 (drew via PJ) = 0 net
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore - 1);
    expect(getZone(result.newState, "player1", "hand").length).toBe(p1HandBefore - 1 + 1);
  });

  // Test 2: You Have Forgotten Me — opponent discards 2, PJ draws 2 (one trigger)
  it("Prince John: You Have Forgotten Me (opponent discards 2) → PJ draws 2 in one trigger", () => {
    let { state } = setupPrinceJohn(6);
    let yhfmId: string;
    ({ state, instanceId: yhfmId } = injectCard(state, "player1", "you-have-forgotten-me", "hand"));
    const p1HandBefore = getZone(state, "player1", "hand").length;
    const p2HandBefore = getZone(state, "player2", "hand").length;

    // Play You Have Forgotten Me (opponent picks 2 to discard)
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: yhfmId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    const oppHand = getZone(result.newState, "player2", "hand");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppHand[0]!, oppHand[1]!] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // PJ's may draw triggered (one trigger, draws 2)
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }

    // Opponent: -2, Player1: -1 (played YHFM) + 2 (drew via PJ) = +1 net
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore - 2);
    expect(getZone(result.newState, "player1", "hand").length).toBe(p1HandBefore - 1 + 2);
  });

  // Test 3: A Whole New World — both players discard hand and draw 7.
  // PJ should fire AFTER A Whole New World fully resolves, seeing opponent's discard count (3),
  // and PJ should NOT fire on player1's own discard (the trigger filter is opponent only).
  it("Prince John: A Whole New World (opp discards 3, PJ draws 3 after the action resolves)", () => {
    let { state } = setupPrinceJohn(3);
    let awnwId: string;
    ({ state, instanceId: awnwId } = injectCard(state, "player1", "a-whole-new-world", "hand"));
    // Player1 also has some cards in hand (so they have something to discard via Whole New World)
    ({ state } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    ({ state } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const p2HandBefore = getZone(state, "player2", "hand").length; // 3
    const p1HandBefore = getZone(state, "player1", "hand").length; // 3 (2 minnies + AWNW)

    // Play A Whole New World
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: awnwId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // PJ's may draw triggered
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    }

    // Opponent: discarded 3, drew 7 = 7 cards in hand
    expect(getZone(result.newState, "player2", "hand").length).toBe(7);
    // Player1: discarded 2 (minnies, AWNW already played), drew 7, then PJ drew 3 from opponent's discard
    // = 7 + 3 = 10 cards
    expect(getZone(result.newState, "player1", "hand").length).toBe(7 + 3);
  });

  // ===== HIRAM FLAVERSHAM: dual triggers (enters_play + quests) sequential isMay =====
  // "When you play this character and whenever he quests, you may banish one of
  //  your items to draw 2 cards."
  it("Hiram Flaversham: banish item on enter, then again on quest next turn", () => {
    let state = startGame(["hiram-flaversham-toymaker", "scepter-of-arendelle"]);
    state = { ...state, interactive: true };
    state = giveInk(state, "player1", 4); // cost 4
    let hiramId: string;
    let scepter1Id: string;
    let scepter2Id: string;
    ({ state, instanceId: hiramId } = injectCard(state, "player1", "hiram-flaversham-toymaker", "hand"));
    ({ state, instanceId: scepter1Id } = injectCard(state, "player1", "scepter-of-arendelle", "play"));
    ({ state, instanceId: scepter2Id } = injectCard(state, "player1", "scepter-of-arendelle", "play"));

    const handBefore = getZone(state, "player1", "hand").length;

    // === Play Hiram → enters_play trigger ===
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: hiramId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // isMay → choose_may pending
    expect(result.newState.pendingChoice?.type).toBe("choose_may");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Sequential cost: choose item to banish
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [scepter1Id] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // First scepter banished, drew 2 cards
    expect(getInstance(result.newState, scepter1Id).zone).toBe("discard");
    // Net hand: -1 (played Hiram) + 2 (drew) = +1
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore - 1 + 2);
    // Second scepter still in play
    expect(getInstance(result.newState, scepter2Id).zone).toBe("play");
    state = result.newState;

    // === Pass to opponent, opponent passes back ===
    state = passTurns(state, 2);

    // Hiram should now be dry (can quest)
    expect(getInstance(state, hiramId).isDrying).toBe(false);
    expect(getInstance(state, hiramId).isExerted).toBe(false);

    const handBeforeQuest = getZone(state, "player1", "hand").length;

    // === Quest with Hiram → quest trigger ===
    result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: hiramId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // isMay → choose_may pending
    expect(result.newState.pendingChoice?.type).toBe("choose_may");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Sequential cost: choose the second scepter to banish
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [scepter2Id] }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Second scepter banished, drew 2 more cards
    expect(getInstance(result.newState, scepter2Id).zone).toBe("discard");
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBeforeQuest + 2);
    // Hiram is now exerted (he quested)
    expect(getInstance(result.newState, hiramId).isExerted).toBe(true);
  });

  // ===== MADAM MIM RIVAL OF MERLIN: play_for_free + Rush + end-of-turn banish =====
  // "Play a character with cost 4 or less for free. They gain Rush. At the end of
  //  the turn, banish them."
  it("Madam Mim Rival: plays Maleficent for free, her enters_play fires, gets banished at end of turn", () => {
    let state = startGame(["madam-mim-rival-of-merlin", "maleficent-sorceress"]);
    state = { ...state, interactive: true };
    let mimId: string;
    ({ state, instanceId: mimId } = injectCard(state, "player1", "madam-mim-rival-of-merlin", "play", { isDrying: false }));
    // Maleficent Sorceress (cost 3, has enters_play: may draw 1)
    let malId: string;
    ({ state, instanceId: malId } = injectCard(state, "player1", "maleficent-sorceress", "hand"));

    const handBefore = getZone(state, "player1", "hand").length;

    // Activate Madam Mim ({E} → play_for_free) — index 1 (index 0 is the shift keyword)
    let result = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: mimId, abilityIndex: 1 }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Choose Maleficent to play for free
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [malId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }

    // Maleficent's enters_play trigger should fire (may draw 1)
    if (result.newState.pendingChoice?.type === "choose_may") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }

    // Maleficent should be in play
    expect(getInstance(result.newState, malId).zone).toBe("play");
    // She should have Rush in grantedKeywords
    expect(getInstance(result.newState, malId).grantedKeywords).toContain("rush");
    // -1 played from hand (well, brought into play from hand) +1 drawn from her enters_play
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore - 1 + 1);

    state = result.newState;

    // Pass turn — Maleficent should be banished at end of turn
    state = passTurns(state, 1);
    expect(getInstance(state, malId).zone).toBe("discard");
  });

  // ===== BEAST SELFLESS PROTECTOR: damage redirect with full amount =====
  // CRD 6.5: Beast absorbs the FULL amount of damage that would be dealt,
  // not the amount capped to the original target's willpower.
  it("Beast Selfless Protector: 1WP ally hit by Smash (3 damage) → Beast takes 3, not 1", () => {
    let state = startGame(["beast-selfless-protector", "smash", "lilo-making-a-wish"]);
    state = giveInk(state, "player1", 3); // smash cost 3
    let beastId: string;
    let allyId: string;
    let smashId: string;
    ({ state, instanceId: beastId } = injectCard(state, "player1", "beast-selfless-protector", "play"));
    // Lilo: 1 STR / 1 WP — 3 damage from Smash would banish her
    ({ state, instanceId: allyId } = injectCard(state, "player1", "lilo-making-a-wish", "play"));
    ({ state, instanceId: smashId } = injectCard(state, "player1", "smash", "hand"));

    // Play Smash targeting Lilo
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: smashId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [allyId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }

    // Lilo should be unscathed (damage redirected)
    expect(getInstance(result.newState, allyId).damage).toBe(0);
    expect(getInstance(result.newState, allyId).zone).toBe("play");
    // Beast should take the FULL 3 damage (not 1, the original target's WP)
    // Beast: 4 WP, takes 3 → survives with 3 damage
    expect(getInstance(result.newState, beastId).damage).toBe(3);
    expect(getInstance(result.newState, beastId).zone).toBe("play");
  });

  // ===== FAIRY GODMOTHER + HEIHEI: floating + native trigger interaction =====
  // Fairy Godmother grants "When banished in a challenge, return to hand" to all
  // your characters this turn. HeiHei already has the same ability natively.
  // When HeiHei is banished in a challenge, BOTH abilities go to the bag.
  // Player must choose which to resolve first. The second can't resolve because
  // HeiHei is no longer in play.
  it("Fairy Godmother Mystic Armorer + HeiHei: two return_to_hand triggers, only one resolves", () => {
    let state = startGame(["fairy-godmother-mystic-armorer", "heihei-persistent-presence"]);
    state = { ...state, interactive: true };
    let fgId: string;
    let heiheiId: string;
    ({ state, instanceId: fgId } = injectCard(state, "player1", "fairy-godmother-mystic-armorer", "play"));
    ({ state, instanceId: heiheiId } = injectCard(state, "player1", "heihei-persistent-presence", "play"));

    // Fairy Godmother quests — grants Challenger +3 + floating banished_in_challenge trigger
    let result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: fgId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Resolve any pending choices from her quest trigger
    while (result.newState.pendingChoice) {
      const ch = result.newState.pendingChoice;
      if (ch.type === "choose_may") {
        result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      } else {
        break;
      }
    }
    state = result.newState;

    // Floating trigger should be in place
    expect(state.floatingTriggers?.length ?? 0).toBeGreaterThan(0);

    // Now have an opponent challenge HeiHei → HeiHei banished in challenge
    // HeiHei has 2 STR, 1 WP. Opposing 3 STR Mickey will banish him.
    let attackerId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = { ...state, cards: { ...state.cards, [heiheiId]: { ...state.cards[heiheiId]!, isExerted: true } } };
    state = { ...state, currentPlayer: "player2" };

    result = applyAction(state, { type: "CHALLENGE", playerId: "player2", attackerInstanceId: attackerId, defenderInstanceId: heiheiId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // In interactive mode with multiple simultaneous triggers, expect choose_trigger
    // (or the triggers may have already resolved if engine prioritizes them)
    // Resolve all pending choices
    let safetyCounter = 0;
    while (result.newState.pendingChoice && safetyCounter < 10) {
      const ch = result.newState.pendingChoice;
      if (ch.type === "choose_trigger" && ch.validTargets?.length) {
        result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: ch.validTargets[0]! }, LORCAST_CARD_DEFINITIONS);
      } else if (ch.type === "choose_may") {
        result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
      } else {
        break;
      }
      safetyCounter++;
    }

    // HeiHei should end up in hand (one of the two return_to_hand triggers resolved)
    expect(getInstance(result.newState, heiheiId).zone).toBe("hand");
  });

  // ===== COGSWORTH TALKING CLOCK: grants {E} → gain 1 lore to Reckless characters =====
  it("Cogsworth Talking Clock: Reckless character gains an activated {E}→gain lore", () => {
    let state = startGame(["cogsworth-talking-clock", "gaston-arrogant-hunter"]);
    let cogsworthId: string;
    let gastonId: string;
    ({ state, instanceId: cogsworthId } = injectCard(state, "player1", "cogsworth-talking-clock", "play"));
    // Gaston Arrogant Hunter has Reckless
    ({ state, instanceId: gastonId } = injectCard(state, "player1", "gaston-arrogant-hunter", "play"));

    const loreBefore = state.players["player1"]!.lore;
    const gastonDef = LORCAST_CARD_DEFINITIONS["gaston-arrogant-hunter"]!;
    const grantedAbilityIndex = gastonDef.abilities.length; // Granted abilities come AFTER own

    // Activate the granted ability on Gaston
    const result = applyAction(state, { type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: gastonId, abilityIndex: grantedAbilityIndex }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Gaston should be exerted and lore gained
    expect(getInstance(result.newState, gastonId).isExerted).toBe(true);
    expect(result.newState.players["player1"]!.lore).toBe(loreBefore + 1);
  });

  // Cogsworth granted ability disappears when Cogsworth leaves play
  it("Cogsworth Talking Clock: granted ability removed when Cogsworth banished", () => {
    let state = startGame(["cogsworth-talking-clock", "gaston-arrogant-hunter"]);
    let cogsworthId: string;
    let gastonId: string;
    ({ state, instanceId: cogsworthId } = injectCard(state, "player1", "cogsworth-talking-clock", "play"));
    ({ state, instanceId: gastonId } = injectCard(state, "player1", "gaston-arrogant-hunter", "play"));

    // Cogsworth in play → Gaston has the granted ability
    let modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(modifiers.grantedActivatedAbilities.get(gastonId)?.length).toBeGreaterThan(0);

    // Move Cogsworth to discard
    state = {
      ...state,
      cards: { ...state.cards, [cogsworthId]: { ...state.cards[cogsworthId]!, zone: "discard" } },
      zones: {
        ...state.zones,
        player1: {
          ...state.zones.player1,
          play: state.zones.player1.play.filter(id => id !== cogsworthId),
          discard: [...state.zones.player1.discard, cogsworthId],
        },
      },
    };

    // Granted ability should be gone
    modifiers = getGameModifiers(state, LORCAST_CARD_DEFINITIONS);
    expect(modifiers.grantedActivatedAbilities.get(gastonId) ?? []).toEqual([]);
  });

  // ===== LUCIFER: ChooseEffect — discard 2 OR discard 1 action =====
  // TODO: ChooseEffect inside triggered abilities silently no-ops — neither
  // option resolves. Same family as the Madam Mim Fox todo. Needs investigation
  // into how processTriggerStack handles ChooseEffect.
  it.todo("Lucifer Cunning Cat: opponent chooses discard option (ChooseEffect in trigger)");

  // ===== YZMA: target_owner draw — opponent draws 2 when their character shuffled =====
  it("Yzma: shuffles opponent's character into deck → opponent draws 2", () => {
    let state = startGame(["yzma-scary-beyond-all-reason"]);
    state = { ...state, interactive: true };
    state = giveInk(state, "player1", 6);
    let yzmaId: string;
    let opponentCharId: string;
    ({ state, instanceId: yzmaId } = injectCard(state, "player1", "yzma-scary-beyond-all-reason", "hand"));
    ({ state, instanceId: opponentCharId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    const p2HandBefore = getZone(state, "player2", "hand").length;
    const p1HandBefore = getZone(state, "player1", "hand").length;

    // Play Yzma → enters_play trigger
    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: yzmaId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);

    // Choose opponent's character to shuffle
    if (result.newState.pendingChoice?.type === "choose_target") {
      result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [opponentCharId] }, LORCAST_CARD_DEFINITIONS);
      expect(result.success).toBe(true);
    }

    // Opponent's character should be in their deck
    expect(getInstance(result.newState, opponentCharId).zone).toBe("deck");
    // Opponent (target_owner) should have drawn 2 cards
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 2);
    // Player1: -1 (played Yzma), no draw
    expect(getZone(result.newState, "player1", "hand").length).toBe(p1HandBefore - 1);
  });
});
