// =============================================================================
// ENGINE TESTS
// Test the rule engine in isolation — no UI, no networking.
// Run with: pnpm test (from repo root) or pnpm --filter engine test
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "../engine/reducer.js";
import { createGame } from "../engine/initializer.js";
import { SAMPLE_CARD_DEFINITIONS } from "../cards/sampleCards.js";
import { generateId, getZone, getInstance, hasKeyword } from "../utils/index.js";
import type { CardInstance, GameState, DeckEntry } from "../index.js";

// ---------------------------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------------------------

/** Build a minimal 60-card deck entry list */
function buildTestDeck(cardIds: string[], fillerId = "stitch-rock-star"): DeckEntry[] {
  const entries: DeckEntry[] = cardIds.map((id) => ({ definitionId: id, count: 4 }));
  const fillerCount = 60 - cardIds.length * 4;
  if (fillerCount > 0) entries.push({ definitionId: fillerId, count: fillerCount });
  return entries;
}

/** Create a game with standard decks */
function startGame(
  p1Cards: string[] = ["simba-protective-cub", "stitch-rock-star"],
  p2Cards: string[] = ["simba-protective-cub", "stitch-rock-star"]
): GameState {
  return createGame(
    { player1Deck: buildTestDeck(p1Cards), player2Deck: buildTestDeck(p2Cards) },
    SAMPLE_CARD_DEFINITIONS
  );
}

/**
 * Inject a card instance directly into a player's zone.
 * This bypasses the random shuffle so tests are fully deterministic.
 */
function injectCard(
  state: GameState,
  playerId: "player1" | "player2",
  definitionId: string,
  zone: "hand" | "play" | "deck" | "discard" | "inkwell",
  overrides: Partial<CardInstance> = {}
): { state: GameState; instanceId: string } {
  const instanceId = generateId();
  const instance: CardInstance = {
    instanceId,
    definitionId,
    ownerId: playerId,
    zone,
    isExerted: false,
    damage: 0,
    hasActedThisTurn: false,
    tempStrengthModifier: 0,
    tempWillpowerModifier: 0,
    tempLoreModifier: 0,
    grantedKeywords: [],
    ...overrides,
  };

  const newState: GameState = {
    ...state,
    cards: { ...state.cards, [instanceId]: instance },
    zones: {
      ...state.zones,
      [playerId]: {
        ...state.zones[playerId],
        [zone]: [...state.zones[playerId][zone], instanceId],
      },
    },
  };

  return { state: newState, instanceId };
}

/** Give a player a specific amount of available ink */
function giveInk(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], availableInk: amount },
    },
  };
}

/** Set a player's lore directly */
function setLore(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], lore: amount },
    },
  };
}

/** Pass turns N times */
function passTurns(state: GameState, count: number): GameState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const result = applyAction(s, { type: "PASS_TURN", playerId: s.currentPlayer }, SAMPLE_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    s = result.newState;
  }
  return s;
}

// ---------------------------------------------------------------------------
// GAME INITIALIZATION
// ---------------------------------------------------------------------------

describe("Game Initialization", () => {
  it("deals 7 cards to each player", () => {
    const state = startGame();
    expect(getZone(state, "player1", "hand")).toHaveLength(7);
    expect(getZone(state, "player2", "hand")).toHaveLength(7);
  });

  it("places remaining 53 cards in deck", () => {
    const state = startGame();
    expect(getZone(state, "player1", "deck")).toHaveLength(53);
    expect(getZone(state, "player2", "deck")).toHaveLength(53);
  });

  it("starts on player1's main phase", () => {
    const state = startGame();
    expect(state.currentPlayer).toBe("player1");
    expect(state.phase).toBe("main");
  });

  it("starts with 0 lore for both players", () => {
    const state = startGame();
    expect(state.players.player1.lore).toBe(0);
    expect(state.players.player2.lore).toBe(0);
  });

  it("starts with 0 available ink", () => {
    const state = startGame();
    expect(state.players.player1.availableInk).toBe(0);
    expect(state.players.player2.availableInk).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PLAYING CARDS
// ---------------------------------------------------------------------------

describe("Playing Cards", () => {
  it("moves a card from hand to play", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, instanceId).zone).toBe("play");
    expect(getZone(result.newState, "player1", "hand")).not.toContain(instanceId);
    expect(getZone(result.newState, "player1", "play")).toContain(instanceId);
  });

  it("deducts the card's ink cost", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand")); // cost 1
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.newState.players.player1.availableInk).toBe(4);
  });

  it("fails when player cannot afford the card", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "moana-of-motunui", "hand")); // cost 5

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ink/i);
  });

  it("fails when playing a card you don't own", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player2", "simba-protective-cub", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("fails when playing a card not in hand", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "discard"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
  });

  it("newly played character cannot act immediately (no Rush)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).hasActedThisTurn).toBe(true);
  });

  it("fails when playing on opponent's turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player2", "simba-protective-cub", "hand"));
    state = giveInk(state, "player2", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PLAYING INK
// ---------------------------------------------------------------------------

describe("Playing Ink", () => {
  it("moves an inkable card to the inkwell", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand"));

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, instanceId).zone).toBe("inkwell");
  });

  it("increases available ink by 1", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand"));

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.newState.players.player1.availableInk).toBe(1);
  });

  it("cannot play ink twice in one turn", () => {
    let state = startGame();
    let id1: string, id2: string;
    ({ state, instanceId: id1 } = injectCard(state, "player1", "simba-protective-cub", "hand"));
    ({ state, instanceId: id2 } = injectCard(state, "player1", "simba-protective-cub", "hand"));

    const after1 = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId: id1 }, SAMPLE_CARD_DEFINITIONS);
    const after2 = applyAction(after1.newState, { type: "PLAY_INK", playerId: "player1", instanceId: id2 }, SAMPLE_CARD_DEFINITIONS);

    expect(after2.success).toBe(false);
    expect(after2.error).toMatch(/already played ink/i);
  });

  it("cannot ink a non-inkable card", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "elsa-snow-queen", "hand")); // inkable: false

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be used as ink/i);
  });
});

// ---------------------------------------------------------------------------
// QUESTING
// ---------------------------------------------------------------------------

describe("Questing", () => {
  it("gains lore equal to the character's lore value", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play")); // lore: 1

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(1);
  });

  it("exerts the character after questing", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).isExerted).toBe(true);
  });

  it("cannot quest with an already-exerted character", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });

  it("cannot quest with a character that has already acted this turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play", { hasActedThisTurn: true }));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("cannot quest with a character in hand", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "hand"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("Moana quests for 2 lore", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "moana-of-motunui", "play")); // lore: 2

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CHALLENGING
// ---------------------------------------------------------------------------

describe("Challenging", () => {
  it("deals damage to both characters", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "simba-protective-cub", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, attackerId).damage).toBe(1);
    expect(getInstance(result.newState, defenderId).damage).toBe(1);
  });

  it("banishes a character when damage >= willpower", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "beast-hardheaded", "play")); // STR 4
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true })); // WP 2

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
  });

  it("exerts the attacker after challenging", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "simba-protective-cub", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(getInstance(result.newState, attackerId).isExerted).toBe(true);
  });

  it("cannot challenge with an exerted character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "simba-protective-cub", "play", { isExerted: true }));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });

  it("cannot challenge your own character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "beast-hardheaded", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player1", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("Challenger +2 adds strength when challenging", () => {
    // Hercules STR 3 + Challenger +2 = 5 vs Moana WP 4 — Moana dies
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "hercules-hero-in-training", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "moana-of-motunui", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
  });
});

// ---------------------------------------------------------------------------
// KEYWORDS
// ---------------------------------------------------------------------------

describe("Keywords", () => {
  it("Rush: character can act the turn it enters play", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "beast-hardheaded", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).hasActedThisTurn).toBe(false);
  });

  it("Ward: character has the Ward keyword", () => {
    const def = SAMPLE_CARD_DEFINITIONS["elsa-snow-queen"]!;
    const instance: CardInstance = {
      instanceId: "test-elsa", definitionId: "elsa-snow-queen", ownerId: "player1",
      zone: "play", isExerted: false, damage: 0, hasActedThisTurn: false,
      tempStrengthModifier: 0, tempWillpowerModifier: 0, tempLoreModifier: 0, grantedKeywords: [],
    };
    expect(hasKeyword(instance, def, "ward")).toBe(true);
  });

  it("Evasive: character has the Evasive keyword", () => {
    const def = SAMPLE_CARD_DEFINITIONS["tinker-bell-tiny-tactician"]!;
    const instance: CardInstance = {
      instanceId: "test-tb", definitionId: "tinker-bell-tiny-tactician", ownerId: "player1",
      zone: "play", isExerted: false, damage: 0, hasActedThisTurn: false,
      tempStrengthModifier: 0, tempWillpowerModifier: 0, tempLoreModifier: 0, grantedKeywords: [],
    };
    expect(hasKeyword(instance, def, "evasive")).toBe(true);
  });

  it("Evasive: cannot be challenged by a non-evasive character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "simba-protective-cub", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "tinker-bell-tiny-tactician", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/evasive/i);
  });

  it("Bodyguard: must be challenged before other characters", () => {
    let state = startGame();
    let attackerId: string, bodyguardId: string, otherId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "simba-protective-cub", "play"));
    ({ state, instanceId: bodyguardId } = injectCard(state, "player2", "gaston-boastful-hunter", "play", { isExerted: true }));
    ({ state, instanceId: otherId } = injectCard(state, "player2", "simba-protective-cub", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: otherId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bodyguard/i);
  });
});

// ---------------------------------------------------------------------------
// TRIGGERED ABILITIES
// ---------------------------------------------------------------------------

describe("Triggered Abilities", () => {
  it("Rapunzel draws a card when she enters play", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "rapunzel-letting-down-hair", "hand"));
    state = giveInk(state, "player1", 10);

    const handSizeBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    // -1 for playing Rapunzel, +1 for draw trigger = net 0 change
    expect(getZone(result.newState, "player1", "hand").length).toBe(handSizeBefore);
  });

  it("Mickey Mouse draws a card when he quests", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "mickey-mouse-wayward-sorcerer", "play"));

    const handSizeBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player1", "hand").length).toBe(handSizeBefore + 1);
  });

  it("Genie draws 2 cards for his owner when banished", () => {
    let state = startGame();
    let attackerId: string, genieId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "beast-hardheaded", "play")); // STR 4
    ({ state, instanceId: genieId } = injectCard(state, "player2", "genie-on-the-job", "play", { isExerted: true })); // WP 3

    const handSizeBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: genieId,
    }, SAMPLE_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, genieId).zone).toBe("discard");
    expect(getZone(result.newState, "player2", "hand").length).toBe(handSizeBefore + 2);
  });
});

// ---------------------------------------------------------------------------
// TURN MANAGEMENT
// ---------------------------------------------------------------------------

describe("Turn Management", () => {
  it("switches to player2 after passing turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, SAMPLE_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.currentPlayer).toBe("player2");
  });

  it("draws a card for the new active player at turn start", () => {
    const state = startGame();
    const p2HandBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, SAMPLE_CARD_DEFINITIONS);
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 1);
  });

  it("readies exerted characters at start of their owner's next turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play", { isExerted: true, hasActedThisTurn: true }));

    state = passTurns(state, 2); // p1 → p2 → p1

    expect(getInstance(state, instanceId).isExerted).toBe(false);
    expect(getInstance(state, instanceId).hasActedThisTurn).toBe(false);
  });

  it("cannot pass on opponent's turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, SAMPLE_CARD_DEFINITIONS);
    expect(result.success).toBe(false);
  });

  it("restores ink equal to inkwell size at turn start", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player2", "simba-protective-cub", "inkwell"));
    ({ state } = injectCard(state, "player2", "simba-protective-cub", "inkwell"));
    ({ state } = injectCard(state, "player2", "simba-protective-cub", "inkwell"));

    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, SAMPLE_CARD_DEFINITIONS);
    expect(result.newState.players.player2.availableInk).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// WIN CONDITION
// ---------------------------------------------------------------------------

describe("Win Condition", () => {
  it("detects a win when player reaches 20 lore via questing", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play")); // lore: 1
    state = setLore(state, "player1", 19);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(20);
    expect(result.newState.isGameOver).toBe(true);
    expect(result.newState.winner).toBe("player1");
  });

  it("game is not over below 20 lore", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "simba-protective-cub", "play"));
    state = setLore(state, "player1", 18);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, SAMPLE_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(19);
    expect(result.newState.isGameOver).toBe(false);
    expect(result.newState.winner).toBeNull();
  });
});
