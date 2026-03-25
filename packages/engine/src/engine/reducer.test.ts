// =============================================================================
// ENGINE TESTS
// Test the rule engine in isolation — no UI, no networking.
// Run with: pnpm test (from repo root) or pnpm --filter engine test
//
// All tests use LORCAST_CARD_DEFINITIONS (set 1, 216 real cards).
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction } from "../engine/reducer.js";
import { createGame } from "../engine/initializer.js";
import { LORCAST_CARD_DEFINITIONS } from "../cards/lorcastCards.js";
import { generateId, getZone, getInstance } from "../utils/index.js";
import type { CardInstance, GameState, DeckEntry } from "../index.js";

// ---------------------------------------------------------------------------
// CARD REFERENCE (Set 1 — The First Chapter)
//
// minnie-mouse-beloved-princess  char   STR 2  WP 3  lore 1  cost 2  inkable
// mickey-mouse-true-friend       char   STR 3  WP 3  lore 2  cost 3  inkable
// lilo-making-a-wish             char   STR 1  WP 1  lore 2  cost 1  inkable: false
// flotsam-ursulas-spy            char   STR 3  WP 4  lore 2  cost 5  inkable: false  Rush
// jetsam-ursulas-spy             char   STR 3  WP 3  lore 1  cost 4  inkable         Evasive
// goofy-musketeer                char   STR 3  WP 6  lore 1  cost 5  inkable         Bodyguard
// aladdin-prince-ali             char   STR 2  WP 2  lore 1  cost 2  inkable         Ward
// dr-facilier-charlatan          char   STR 0  WP 4  lore 1  cost 2  inkable         Challenger +2
// hades-lord-of-the-underworld   char   STR 3  WP 2  lore 1  cost 4  inkable: false
// hades-king-of-olympus          char   STR 6  WP 7  lore 1  cost 8  inkable: false  Shift 6  shiftCost 6
// maleficent-sorceress           char   STR 2  WP 2  lore 1  cost 3  inkable         enters_play: draw 1
// the-queen-wicked-and-vain      char   STR 4  WP 5  lore 1  cost 5  inkable         ↷: draw a card (I SUMMON THEE)
// eye-of-the-fates               item                        cost 4  inkable         ↷: chosen char +1 lore this turn (SEE THE FUTURE)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------------------------

function buildTestDeck(cardIds: string[], fillerId = "minnie-mouse-beloved-princess"): DeckEntry[] {
  const entries: DeckEntry[] = cardIds.map((id) => ({ definitionId: id, count: 4 }));
  const fillerCount = 60 - cardIds.length * 4;
  if (fillerCount > 0) entries.push({ definitionId: fillerId, count: fillerCount });
  return entries;
}

function startGame(
  p1Cards: string[] = ["mickey-mouse-true-friend"],
  p2Cards: string[] = ["mickey-mouse-true-friend"]
): GameState {
  return createGame(
    { player1Deck: buildTestDeck(p1Cards), player2Deck: buildTestDeck(p2Cards) },
    LORCAST_CARD_DEFINITIONS
  );
}

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

function giveInk(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], availableInk: amount },
    },
  };
}

function setLore(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], lore: amount },
    },
  };
}

function passTurns(state: GameState, count: number): GameState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const result = applyAction(s, { type: "PASS_TURN", playerId: s.currentPlayer }, LORCAST_CARD_DEFINITIONS);
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
});

// ---------------------------------------------------------------------------
// PLAYING CARDS
// ---------------------------------------------------------------------------

describe("Playing Cards", () => {
  it("plays a character card to the play zone", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, instanceId).zone).toBe("play");
  });

  it("deducts ink equal to the card's cost", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand")); // cost 2
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.availableInk).toBe(3);
  });

  it("fails when not enough ink", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand")); // cost 2
    state = giveInk(state, "player1", 1);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ink/i);
  });

  it("fails when playing a card not in hand", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
  });

  it("newly played character cannot act immediately (no Rush)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).hasActedThisTurn).toBe(true);
  });

  it("fails when playing on opponent's turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player2", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player2", instanceId }, LORCAST_CARD_DEFINITIONS);

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
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, instanceId).zone).toBe("inkwell");
  });

  it("increases available ink by 1", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.availableInk).toBe(1);
  });

  it("cannot play ink twice in one turn", () => {
    let state = startGame();
    let id1: string, id2: string;
    ({ state, instanceId: id1 } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    ({ state, instanceId: id2 } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const after1 = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId: id1 }, LORCAST_CARD_DEFINITIONS);
    const after2 = applyAction(after1.newState, { type: "PLAY_INK", playerId: "player1", instanceId: id2 }, LORCAST_CARD_DEFINITIONS);

    expect(after2.success).toBe(false);
    expect(after2.error).toMatch(/already played ink/i);
  });

  it("cannot ink a non-inkable card", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "lilo-making-a-wish", "hand")); // inkable: false

    const result = applyAction(state, { type: "PLAY_INK", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

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
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(1);
  });

  it("exerts the character after questing", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).isExerted).toBe(true);
  });

  it("cannot quest with an already-exerted character", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });

  it("cannot quest with a character that has already acted this turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { hasActedThisTurn: true }));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("cannot quest with a character in hand", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in play/i);
  });

  it("Mickey Mouse - True Friend quests for 2 lore", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play")); // lore: 2

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CHALLENGING
// ---------------------------------------------------------------------------

describe("Challenging", () => {
  it("deals damage to both characters", () => {
    // Minnie (STR 2) vs Minnie (STR 2, WP 3): both take 2 damage, neither dies
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, attackerId).damage).toBe(2);
    expect(getInstance(result.newState, defenderId).damage).toBe(2);
  });

  it("banishes a character when damage >= willpower", () => {
    // Mickey (STR 3) vs Lilo (WP 1): Lilo takes 3 damage, WP 1 → banished
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play")); // STR 3
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isExerted: true })); // WP 1

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
  });

  it("exerts the attacker after challenging", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(getInstance(result.newState, attackerId).isExerted).toBe(true);
  });

  it("cannot challenge with an exerted character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });

  it("cannot challenge your own character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("Challenger +2 adds strength when challenging", () => {
    // Dr. Facilier STR 0 + Challenger +2 = 2 vs Lilo WP 1 → Lilo banished
    // Without Challenger, STR 0 would deal 0 damage and Lilo (WP 1) would survive
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "dr-facilier-charlatan", "play")); // STR 0, Challenger +2
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "lilo-making-a-wish", "play", { isExerted: true })); // WP 1

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
  });
});

// ---------------------------------------------------------------------------
// KEYWORDS
// ---------------------------------------------------------------------------

describe("Keywords", () => {

  // ---------------------------------------------------------------------------
  // RUSH — can act the turn it enters play
  // ---------------------------------------------------------------------------

  it("Rush: character can act the turn it enters play", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "flotsam-ursulas-spy", "hand")); // Rush, cost 5
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(getInstance(result.newState, instanceId).hasActedThisTurn).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // WARD — "Opponents can't choose this character except to challenge."
  // ---------------------------------------------------------------------------

  it("Ward: character CAN be challenged (Ward does not block challenges)", () => {
    let state = startGame();
    let attackerId: string, wardId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: wardId } = injectCard(state, "player2", "aladdin-prince-ali", "play", { isExerted: true })); // Ward

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: wardId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
  });

  it("Ward: character cannot be chosen as the target of an opponent's effect", () => {
    // Eye of the Fates: ↷ → chosen character gets +1 lore this turn
    let state = startGame();
    let eyeId: string, aladdinId: string;
    ({ state, instanceId: eyeId } = injectCard(state, "player1", "eye-of-the-fates", "play"));
    ({ state, instanceId: aladdinId } = injectCard(state, "player2", "aladdin-prince-ali", "play")); // Ward

    const activateResult = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: eyeId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(activateResult.success).toBe(true);

    const resolveResult = applyAction(activateResult.newState, {
      type: "RESOLVE_CHOICE",
      playerId: "player1",
      choice: [aladdinId],
    }, LORCAST_CARD_DEFINITIONS);

    expect(resolveResult.success).toBe(false);
    expect(resolveResult.error).toMatch(/ward/i);
  });

  it("Ward: your own character with Ward CAN be targeted by your own effects", () => {
    let state = startGame();
    let eyeId: string, aladdinId: string;
    ({ state, instanceId: eyeId } = injectCard(state, "player1", "eye-of-the-fates", "play"));
    ({ state, instanceId: aladdinId } = injectCard(state, "player1", "aladdin-prince-ali", "play")); // own Ward character

    const activateResult = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: eyeId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(activateResult.success).toBe(true);

    const resolveResult = applyAction(activateResult.newState, {
      type: "RESOLVE_CHOICE",
      playerId: "player1",
      choice: [aladdinId],
    }, LORCAST_CARD_DEFINITIONS);

    expect(resolveResult.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // EVASIVE — can only be challenged by Evasive characters
  // ---------------------------------------------------------------------------

  it("Evasive: cannot be challenged by a non-evasive character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "jetsam-ursulas-spy", "play", { isExerted: true })); // Evasive

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/evasive/i);
  });

  it("Evasive: can be challenged by another Evasive character", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "jetsam-ursulas-spy", "play")); // Evasive
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "jetsam-ursulas-spy", "play", { isExerted: true })); // Evasive

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // BODYGUARD — exerted Bodyguard must be challenged before other characters
  // ---------------------------------------------------------------------------

  it("Bodyguard: must be challenged before other characters", () => {
    let state = startGame();
    let attackerId: string, bodyguardId: string, otherId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: bodyguardId } = injectCard(state, "player2", "goofy-musketeer", "play", { isExerted: true })); // Bodyguard
    ({ state, instanceId: otherId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: otherId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bodyguard/i);
  });

  // ---------------------------------------------------------------------------
  // SHIFT — play at reduced shiftCost onto a same-named character
  // ---------------------------------------------------------------------------

  it("Shift: can be played at shiftCost onto a same-named character in play", () => {
    // hades-king-of-olympus (Shift 6, cost 8) onto hades-lord-of-the-underworld
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6); // shiftCost 6

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).zone).toBe("play");
    expect(getInstance(result.newState, baseId).zone).toBe("discard");
  });

  it("Shift: cannot shift without enough ink for shiftCost", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 5); // need 6

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ink/i);
  });

  it("Shift: cannot shift onto a character with a different name", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // name: Minnie Mouse
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand")); // name: Hades
    state = giveInk(state, "player1", 8);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it("Shift: shifted card inherits the exerted status of the original", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play", { isExerted: true }));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).isExerted).toBe(true);
  });

  it("Shift: shifted card starts with 0 damage (does not inherit the original's damage)", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play", { damage: 1 }));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).damage).toBe(0);
  });

  it("Shift: shifted character cannot act the same turn (no Rush)", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).hasActedThisTurn).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // UNIMPLEMENTED — stubs for keywords not yet in set 1 or not yet built
  // ---------------------------------------------------------------------------

  // Resist is Set 2+; rules changed between sets — skipping for now.
  it.todo("Resist: reduces incoming challenge damage by N");

  it.todo("Reckless: character cannot quest");
  it.todo("Reckless: character CAN challenge when not exerted");
  it.todo("Support: when questing, may add this character's strength to another chosen ready character's strength");
  it.todo("Singer N: character can exert to sing a song of cost ≤ N without paying its ink cost");
});

// ---------------------------------------------------------------------------
// ACTIVATED ABILITIES
// ---------------------------------------------------------------------------

describe("Activated Abilities", () => {
  it("The Queen I SUMMON THEE: exerts her and draws a card", () => {
    // The Queen - Wicked and Vain: ↷ → draw a card
    let state = startGame();
    let queenId: string;
    ({ state, instanceId: queenId } = injectCard(state, "player1", "the-queen-wicked-and-vain", "play"));
    const handBefore = getZone(state, "player1", "hand").length;

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: queenId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, queenId).isExerted).toBe(true);
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore + 1);
  });

  it("Eye of the Fates SEE THE FUTURE: exerts and gives chosen character +1 lore this turn", () => {
    let state = startGame();
    let eyeId: string, targetId: string;
    ({ state, instanceId: eyeId } = injectCard(state, "player1", "eye-of-the-fates", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));

    const activateResult = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: eyeId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);

    const resolveResult = applyAction(activateResult.newState, {
      type: "RESOLVE_CHOICE",
      playerId: "player1",
      choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);

    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, targetId).tempLoreModifier).toBe(1);
  });

  it("cannot activate when the card is already exerted", () => {
    let state = startGame();
    let queenId: string;
    ({ state, instanceId: queenId } = injectCard(state, "player1", "the-queen-wicked-and-vain", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      instanceId: queenId,
      abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });
});

// ---------------------------------------------------------------------------
// TRIGGERED ABILITIES
// ---------------------------------------------------------------------------

describe("Triggered Abilities", () => {
  it("Maleficent draws a card for her controller when she enters play", () => {
    // CAST MY SPELL! When you play this character, you may draw a card.
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "maleficent-sorceress", "hand"));
    state = giveInk(state, "player1", 10);

    const handSizeBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    // -1 for playing Maleficent, +1 for her draw trigger = net 0 change
    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player1", "hand").length).toBe(handSizeBefore);
  });
});

// ---------------------------------------------------------------------------
// TURN MANAGEMENT
// ---------------------------------------------------------------------------

describe("Turn Management", () => {
  it("switches to player2 after passing turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.currentPlayer).toBe("player2");
  });

  it("draws a card for the new active player at turn start", () => {
    const state = startGame();
    const p2HandBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 1);
  });

  it("readies exerted characters at start of their owner's next turn", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true, hasActedThisTurn: true }));

    state = passTurns(state, 2); // p1 → p2 → p1

    expect(getInstance(state, instanceId).isExerted).toBe(false);
    expect(getInstance(state, instanceId).hasActedThisTurn).toBe(false);
  });

  it("cannot pass on opponent's turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(false);
  });

  it("restores ink equal to inkwell size at turn start", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));

    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
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
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1
    state = setLore(state, "player1", 19);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(20);
    expect(result.newState.isGameOver).toBe(true);
    expect(result.newState.winner).toBe("player1");
  });

  it("game is not over below 20 lore", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1
    state = setLore(state, "player1", 18);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(19);
    expect(result.newState.isGameOver).toBe(false);
    expect(result.newState.winner).toBeNull();
  });
});
