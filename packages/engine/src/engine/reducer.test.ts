// =============================================================================
// ENGINE TESTS — organized by CRD (Comprehensive Rules Document) sections
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
    isDrying: false,
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

/** Empty the deck of a player by moving all cards to discard */
function emptyDeck(state: GameState, playerId: "player1" | "player2"): GameState {
  const deckIds = [...getZone(state, playerId, "deck")];
  for (const id of deckIds) {
    const instance = state.cards[id]!;
    state = {
      ...state,
      cards: { ...state.cards, [id]: { ...instance, zone: "discard" } },
      zones: {
        ...state.zones,
        [playerId]: {
          ...state.zones[playerId],
          deck: state.zones[playerId].deck.filter((x) => x !== id),
          discard: [...state.zones[playerId].discard, id],
        },
      },
    };
  }
  return state;
}

// =============================================================================
// §1 CONCEPTS
// =============================================================================

// ---------------------------------------------------------------------------
// §1.8 Game State Check
// ---------------------------------------------------------------------------

describe("§1.8 Game State Check", () => {
  // CRD 1.8.1.1: Player with 20+ lore wins
  it("detects a win when player reaches 20 lore via questing (CRD 1.8.1.1)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1
    state = setLore(state, "player1", 19);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(20);
    expect(result.newState.isGameOver).toBe(true);
    expect(result.newState.winner).toBe("player1");
  });

  it("game is not over below 20 lore (CRD 1.8.1.1)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1
    state = setLore(state, "player1", 18);

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.newState.players.player1.lore).toBe(19);
    expect(result.newState.isGameOver).toBe(false);
    expect(result.newState.winner).toBeNull();
  });

  // CRD 1.8.1.2 / 2.3.3.2: Player who ends turn with empty deck loses
  it("player with empty deck at end of turn loses (CRD 2.3.3.2)", () => {
    let state = startGame();
    state = emptyDeck(state, "player1");
    expect(getZone(state, "player1", "deck")).toHaveLength(0);

    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.isGameOver).toBe(true);
    expect(result.newState.winner).toBe("player2");
  });

  it("player with cards in deck does not lose at end of turn (CRD 2.3.3.2)", () => {
    const state = startGame();
    expect(getZone(state, "player1", "deck").length).toBeGreaterThan(0);

    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.isGameOver).toBe(false);
  });
});

// =============================================================================
// §2 GAMEPLAY
// =============================================================================

// ---------------------------------------------------------------------------
// §2.2 Setup Stage
// ---------------------------------------------------------------------------

describe("§2.2 Setup Stage", () => {
  it("deals 7 cards to each player (CRD 2.2.1.4)", () => {
    const state = startGame();
    expect(getZone(state, "player1", "hand")).toHaveLength(7);
    expect(getZone(state, "player2", "hand")).toHaveLength(7);
  });

  it("places remaining 53 cards in deck", () => {
    const state = startGame();
    expect(getZone(state, "player1", "deck")).toHaveLength(53);
    expect(getZone(state, "player2", "deck")).toHaveLength(53);
  });

  it("starts on player1's main phase (CRD 2.2.1.3)", () => {
    const state = startGame();
    expect(state.currentPlayer).toBe("player1");
    expect(state.phase).toBe("main");
  });
});

// =============================================================================
// §3 TURN STRUCTURE
// =============================================================================

// ---------------------------------------------------------------------------
// §3.2 Start-of-Turn Phase
// ---------------------------------------------------------------------------

describe("§3.2 Start-of-Turn Phase", () => {
  // CRD 3.2.3.1: Starting player skips draw on first turn
  it("starting player (player1) does not draw on turn 1 (CRD 3.2.3.1)", () => {
    const state = startGame();
    // player1 starts with 7 cards (opening hand), no draw on turn 1
    expect(getZone(state, "player1", "hand")).toHaveLength(7);
    expect(getZone(state, "player1", "deck")).toHaveLength(53);
  });

  // CRD 3.2.3.1: Draw step — active player draws a card
  it("draws a card for the new active player at turn start (CRD 3.2.3.1)", () => {
    const state = startGame();
    const p2HandBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(getZone(result.newState, "player2", "hand").length).toBe(p2HandBefore + 1);
  });

  // CRD 3.2.1.1: Ready step — ready all cards in play and inkwell
  it("readies exerted characters and clears drying at start of their owner's next turn (CRD 3.2.1.1)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true, isDrying: true }));

    state = passTurns(state, 2); // p1 → p2 → p1

    expect(getInstance(state, instanceId).isExerted).toBe(false);
    expect(getInstance(state, instanceId).isDrying).toBe(false);
  });

  it("restores ink equal to inkwell size at turn start (CRD 3.2.1.1)", () => {
    let state = startGame();
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));
    ({ state } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "inkwell"));

    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.newState.players.player2.availableInk).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §3.3 Main Phase
// ---------------------------------------------------------------------------

describe("§3.3 Main Phase", () => {
  it("cannot pass on opponent's turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player2" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3.4 End-of-Turn Phase
// ---------------------------------------------------------------------------

describe("§3.4 End-of-Turn Phase", () => {
  it("switches to opponent after passing turn", () => {
    const state = startGame();
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.currentPlayer).toBe("player2");
  });

  // CRD 3.4.1.2: Effects that end "this turn" — clear temp modifiers
  it("clears temp stat modifiers at end of turn (CRD 3.4.1.2)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", {
      tempStrengthModifier: 2,
      tempWillpowerModifier: 1,
      tempLoreModifier: 1,
    }));

    // Pass P1's turn → modifiers should be cleared
    const result = applyAction(state, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    const card = getInstance(result.newState, instanceId);
    expect(card.tempStrengthModifier).toBe(0);
    expect(card.tempWillpowerModifier).toBe(0);
    expect(card.tempLoreModifier).toBe(0);
  });
});

// =============================================================================
// §4 TURN ACTIONS
// =============================================================================

// ---------------------------------------------------------------------------
// §4.2 Ink a Card
// ---------------------------------------------------------------------------

describe("§4.2 Ink a Card", () => {
  it("moves an inkable card to the inkwell (CRD 4.2.1)", () => {
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

  // CRD 4.2.3: Limited to once per turn
  it("cannot play ink twice in one turn (CRD 4.2.3)", () => {
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
// §4.3 Play a Card
// ---------------------------------------------------------------------------

describe("§4.3 Play a Card", () => {
  it("plays a character card normally: moves to play zone and deducts ink (CRD 4.3.1)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand")); // cost 2
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, instanceId).zone).toBe("play");
    expect(result.newState.players.player1.availableInk).toBe(3); // 5 - cost 2 = 3
  });

  // CRD 1.5.3: Cost must be paid in full
  it("fails when not enough ink (CRD 1.5.3)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand")); // cost 2
    state = giveInk(state, "player1", 1);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ink/i);
  });

  // CRD 4.3.2: Can normally be played only from hand
  it("fails when playing a card not in hand (CRD 4.3.2)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
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
// §4.4 Use an Activated Ability
// ---------------------------------------------------------------------------

describe("§4.4 Activated Abilities", () => {
  it("The Queen I SUMMON THEE: exerts her and draws a card (CRD 4.4.1)", () => {
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

  // CRD 4.4.2: {E} ability requires character to not be exerted
  it("cannot activate when the card is already exerted (CRD 4.4.2)", () => {
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
// §4.5 Quest
// ---------------------------------------------------------------------------

describe("§4.5 Quest", () => {
  // CRD 4.5.1.3–4: Exert questing character, gain lore equal to {L}
  it("questing gains lore and exerts the character (CRD 4.5.1.3–4)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play")); // lore: 1

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(1);
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

  // CRD 5.1.1.11: Drying characters can't quest
  it("cannot quest with a drying character (CRD 5.1.1.11)", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: true }));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/drying/i);
  });

  it("cannot quest with a character not in play", () => {
    let state = startGame();
    let instanceId: string;
    ({ state, instanceId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in play/i);
  });
});

// ---------------------------------------------------------------------------
// §4.6 Challenge
// ---------------------------------------------------------------------------

describe("§4.6 Challenge", () => {
  // CRD 4.6.6.2: Damage dealt simultaneously
  it("deals damage to both characters simultaneously (CRD 4.6.6.2)", () => {
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

  // CRD 1.8.1.4: Character with damage >= willpower is banished
  it("banishes a character when damage >= willpower (CRD 1.8.1.4)", () => {
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

  // CRD 4.6.4.4: Exert the challenging character
  it("exerts the attacker after challenging (CRD 4.6.4.4)", () => {
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

  // CRD 4.6.4.1: Challenging character must be ready
  it("cannot challenge with an exerted character (CRD 4.6.4.1)", () => {
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

  // CRD 4.6.4.2: Choose an exerted opposing character to challenge
  it("cannot challenge a ready (non-exerted) character (CRD 4.6.4.2)", () => {
    let state = startGame();
    let attackerId: string, defenderId: string;
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play")); // NOT exerted

    const result = applyAction(state, {
      type: "CHALLENGE",
      playerId: "player1",
      attackerInstanceId: attackerId,
      defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });
});

// =============================================================================
// §6 ABILITIES, EFFECTS, AND RESOLVING
// =============================================================================

// ---------------------------------------------------------------------------
// §6.2 Triggered Abilities
// ---------------------------------------------------------------------------

describe("§6.2 Triggered Abilities", () => {
  // CRD 4.3.4.1: "When you play this character" triggers on enters_play
  it("Maleficent draws a card for her controller when she enters play (CRD 4.3.4.1)", () => {
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

// =============================================================================
// §8 KEYWORDS
// =============================================================================

describe("§8 Keywords", () => {

  // ---------------------------------------------------------------------------
  // §8.3 Bodyguard
  // ---------------------------------------------------------------------------

  // CRD 8.3.3: Opponent must challenge Bodyguard before other characters
  it("Bodyguard: must be challenged before other characters (CRD 8.3.3)", () => {
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
  // §8.5 Challenger
  // ---------------------------------------------------------------------------

  // CRD 8.5.1: Challenger +N adds strength when attacking
  it("Challenger +2: adds strength when challenging (CRD 8.5.1)", () => {
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

  // ---------------------------------------------------------------------------
  // §8.6 Evasive
  // ---------------------------------------------------------------------------

  // CRD 8.6.1: Can't be challenged except by Evasive character
  it("Evasive: cannot be challenged by a non-evasive character (CRD 8.6.1)", () => {
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

  it("Evasive: can be challenged by another Evasive character (CRD 8.6.1)", () => {
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
  // §8.9 Rush
  // ---------------------------------------------------------------------------

  // CRD 8.9.1: Rush allows challenging while drying, but NOT questing
  it("Rush: can challenge immediately but cannot quest (CRD 8.9.1)", () => {
    let state = startGame();
    let rushId: string, defenderId: string;
    ({ state, instanceId: rushId } = injectCard(state, "player1", "flotsam-ursulas-spy", "hand")); // Rush, cost 5
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: rushId }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(getInstance(playResult.newState, rushId).isDrying).toBe(true); // still drying

    // Rush: CAN challenge while drying
    const challengeResult = applyAction(playResult.newState, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: rushId, defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(challengeResult.success).toBe(true);
  });

  it("Rush: cannot quest while drying (CRD 8.9.1)", () => {
    let state = startGame();
    let rushId: string;
    ({ state, instanceId: rushId } = injectCard(state, "player1", "flotsam-ursulas-spy", "hand")); // Rush, cost 5
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: rushId }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);

    const questResult = applyAction(playResult.newState, {
      type: "QUEST", playerId: "player1", instanceId: rushId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(questResult.success).toBe(false);
    expect(questResult.error).toMatch(/drying/i);
  });

  // ---------------------------------------------------------------------------
  // §8.10 Shift
  // ---------------------------------------------------------------------------

  it("Shift: can be played at shiftCost onto a same-named character (CRD 8.10.1)", () => {
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
    ({ state, instanceId: baseId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
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

  // CRD 8.10.2: If shifted onto exerted character, enters exerted
  it("Shift: inherits exerted status from base (CRD 8.10.2)", () => {
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

  // CRD 8.10.6: Shifted character retains damage from base
  it("Shift: inherits damage from base card (CRD 8.10.6)", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play", { damage: 2 }));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).damage).toBe(2);
  });

  // CRD 8.10.4: Inherits dry/drying from base
  it("Shift: dry base → shifted card is dry (CRD 8.10.4)", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play", { isDrying: false }));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).isDrying).toBe(false);
  });

  it("Shift: drying base → shifted card is drying (CRD 8.10.4)", () => {
    let state = startGame();
    let baseId: string, shiftId: string;
    ({ state, instanceId: baseId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play", { isDrying: true }));
    ({ state, instanceId: shiftId } = injectCard(state, "player1", "hades-king-of-olympus", "hand"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, {
      type: "PLAY_CARD",
      playerId: "player1",
      instanceId: shiftId,
      shiftTargetInstanceId: baseId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, shiftId).isDrying).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // §8.15 Ward
  // ---------------------------------------------------------------------------

  // CRD 8.15.2: Effects that don't require choosing still affect Ward characters
  it("Ward: character CAN be challenged (CRD 8.15.2)", () => {
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

  // CRD 8.15.1: Ward blocks opponent's targeting
  it("Ward: character cannot be chosen as the target of an opponent's effect (CRD 8.15.1)", () => {
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

  it("Ward: your own Ward character CAN be targeted by your own effects (CRD 8.15.1)", () => {
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
  // §5.1.2.1 Characters enter play drying
  // ---------------------------------------------------------------------------

  it("non-Rush characters enter play drying and cannot act (CRD 5.1.2.1)", () => {
    let state = startGame();
    let vanillaId: string;
    ({ state, instanceId: vanillaId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: vanillaId }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(result.newState, vanillaId).isDrying).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // UNIMPLEMENTED — stubs for keywords not yet built
  // ---------------------------------------------------------------------------

  it.todo("Resist: reduces incoming challenge damage by N (CRD 8.8.1)");
  it.todo("Reckless: character cannot quest (CRD 8.7.2)");
  it.todo("Reckless: character CAN challenge when not exerted (CRD 8.7.3)");
  it.todo("Support: when questing, may add this character's strength to another chosen ready character's strength (CRD 8.13.1)");
  it.todo("Singer N: character can exert to sing a song of cost ≤ N without paying its ink cost (CRD 8.11)");
});
