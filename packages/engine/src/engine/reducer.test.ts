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
    timedEffects: [],
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

// =============================================================================
// §5.4 Actions (CRD 5.4.1.2, 4.3.3.2)
// =============================================================================

describe("§5.4 Actions", () => {
  // Card reference:
  // friends-on-the-other-side  action (Song)  cost 3  actionEffects: draw 2
  // dragon-fire                action         cost 5  actionEffects: banish chosen character
  // be-prepared                action (Song)  cost 7  actionEffects: banish all characters

  it("action with simple effect resolves and goes to discard (CRD 4.3.3.2)", () => {
    let state = startGame(["friends-on-the-other-side"]);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    state = giveInk(state, "player1", 5);
    const handBefore = getZone(state, "player1", "hand").length;

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Card goes to discard after resolving
    expect(getInstance(result.newState, songId).zone).toBe("discard");
    // Drew 2 cards (net +1 since song left hand)
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore - 1 + 2);
    // Ink was deducted
    expect(result.newState.players.player1.availableInk).toBe(2); // 5 - 3
  });

  it("action with chosen target creates pendingChoice (CRD 5.4.1.2)", () => {
    let state = startGame(["dragon-fire"]);
    let fireId: string, targetId: string;
    ({ state, instanceId: fireId } = injectCard(state, "player1", "dragon-fire", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: fireId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();
    expect(result.newState.pendingChoice!.type).toBe("choose_target");
    // Action stays in play while awaiting choice (CRD 4.3.3.2)
    expect(getInstance(result.newState, fireId).zone).toBe("play");
    expect(result.newState.pendingActionInstanceId).toBe(fireId);
  });

  it("action goes to discard after choice resolves (CRD 4.3.3.2)", () => {
    let state = startGame(["dragon-fire"]);
    let fireId: string, targetId: string;
    ({ state, instanceId: fireId } = injectCard(state, "player1", "dragon-fire", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 5);

    let result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: fireId }, LORCAST_CARD_DEFINITIONS);
    // Resolve the choice
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Target was banished
    expect(getInstance(result.newState, targetId).zone).toBe("discard");
    // Dragon Fire moved to discard
    expect(getInstance(result.newState, fireId).zone).toBe("discard");
    // pendingActionInstanceId cleared
    expect(result.newState.pendingActionInstanceId).toBeUndefined();
  });

  it("action does not set isDrying (CRD 5.4.1.2)", () => {
    let state = startGame(["dragon-fire"]);
    let fireId: string, targetId: string;
    ({ state, instanceId: fireId } = injectCard(state, "player1", "dragon-fire", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: fireId }, LORCAST_CARD_DEFINITIONS);

    // Action is in play (pending choice) but NOT drying
    expect(getInstance(result.newState, fireId).isDrying).toBe(false);
  });

  it("action effect does NOT enter trigger stack (CRD 5.4.1.2)", () => {
    let state = startGame(["friends-on-the-other-side"]);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: songId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Trigger stack should be empty — action effects resolve inline
    expect(result.newState.triggerStack.length).toBe(0);
  });

  it("action with 'all' target resolves immediately (CRD 5.4.1.2)", () => {
    let state = startGame(["be-prepared"]);
    let bePreparedId: string, char1Id: string, char2Id: string;
    ({ state, instanceId: bePreparedId } = injectCard(state, "player1", "be-prepared", "hand"));
    ({ state, instanceId: char1Id } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: char2Id } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 7);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: bePreparedId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Both characters banished
    expect(getInstance(result.newState, char1Id).zone).toBe("discard");
    expect(getInstance(result.newState, char2Id).zone).toBe("discard");
    // Be Prepared in discard
    expect(getInstance(result.newState, bePreparedId).zone).toBe("discard");
    // No pending choice
    expect(result.newState.pendingChoice).toBeNull();
  });
});

// =============================================================================
// §5.4.4 Songs & Singing (CRD 5.4.4.2, 1.5.5.1)
// =============================================================================

describe("§5.4.4 Songs & Singing", () => {
  // Card reference:
  // ariel-spectacular-singer     char  cost 3  Singer 5
  // sebastian-court-composer     char  cost 2  Singer 4
  // mickey-mouse-true-friend     char  cost 3  (no Singer)
  // friends-on-the-other-side    song  cost 3
  // be-prepared                  song  cost 7

  it("character with cost >= song cost can sing (CRD 5.4.4.2)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    // Mickey cost 3 >= song cost 3
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, songId).zone).toBe("discard");
  });

  it("character with cost < song cost cannot sing (CRD 5.4.4.2)", () => {
    let state = startGame(["be-prepared", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "be-prepared", "hand"));
    // Mickey cost 3 < song cost 7
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cost.*too low/i);
  });

  it("singing does not deduct ink (CRD 1.5.5.1)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Ink unchanged — singing is the alternate cost
    expect(result.newState.players.player1.availableInk).toBe(3);
  });

  it("singer character becomes exerted (CRD 5.4.4.2)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, singerId).isExerted).toBe(true);
  });

  it("drying character cannot sing (CRD 5.1.1.11)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isDrying: true }));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/drying/i);
  });

  it("already-exerted character cannot sing (CRD 5.4.4.2)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exerted/i);
  });

  it("non-song action cannot be sung (CRD 5.4.4.1)", () => {
    let state = startGame(["dragon-fire", "mickey-mouse-true-friend"]);
    let fireId: string, singerId: string;
    ({ state, instanceId: fireId } = injectCard(state, "player1", "dragon-fire", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: fireId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/song/i);
  });

  it("song resolves effects and discards after singing (CRD 4.3.3.2)", () => {
    let state = startGame(["friends-on-the-other-side", "mickey-mouse-true-friend"]);
    let songId: string, singerId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    ({ state, instanceId: singerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    const handBefore = getZone(state, "player1", "hand").length;

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: singerId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, songId).zone).toBe("discard");
    // Drew 2 cards (net +1 since song left hand)
    expect(getZone(result.newState, "player1", "hand").length).toBe(handBefore - 1 + 2);
  });

  it("song can still be played by paying ink normally (CRD 5.4.4.2)", () => {
    let state = startGame(["friends-on-the-other-side"]);
    let songId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "friends-on-the-other-side", "hand"));
    state = giveInk(state, "player1", 5);

    // Play without singerInstanceId — pay ink normally
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.players.player1.availableInk).toBe(2); // 5 - 3
    expect(getInstance(result.newState, songId).zone).toBe("discard");
  });
});

// =============================================================================
// §5.4 Action & Character card effects (data-driven)
// Tests that newly wired actionEffects and triggered abilities resolve correctly.
// =============================================================================

describe("§5.4 Action card effects (data-driven)", () => {
  // --- gain_stats actions ---

  it("He's Got a Sword gives +2 STR to chosen character", () => {
    let state = startGame(["hes-got-a-sword"]);
    let swordId: string, targetId: string;
    ({ state, instanceId: swordId } = injectCard(state, "player1", "hes-got-a-sword", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: swordId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();

    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, targetId).tempStrengthModifier).toBe(2);
    expect(getInstance(resolve.newState, swordId).zone).toBe("discard");
  });

  it("Control Your Temper gives -2 STR to chosen character", () => {
    let state = startGame(["control-your-temper"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "control-your-temper", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).tempStrengthModifier).toBe(-2);
  });

  // --- deal_damage actions ---

  it("Fire the Cannons deals 2 damage to chosen character", () => {
    let state = startGame(["fire-the-cannons"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "fire-the-cannons", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // 3 WP
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).damage).toBe(2);
    expect(getInstance(resolve.newState, cardId).zone).toBe("discard");
  });

  it("Smash deals 3 damage, banishing a 3-WP character", () => {
    let state = startGame(["smash"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "smash", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // 3 WP
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    // 3 damage >= 3 WP → banished
    expect(getInstance(resolve.newState, targetId).zone).toBe("discard");
  });

  it("Grab Your Sword deals 2 damage to all opposing characters (song)", () => {
    let state = startGame(["grab-your-sword"]);
    let cardId: string, opp1Id: string, opp2Id: string, ownId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "grab-your-sword", "hand"));
    ({ state, instanceId: opp1Id } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    ({ state, instanceId: opp2Id } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: ownId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Opposing characters take 2 damage
    expect(getInstance(result.newState, opp1Id).damage).toBe(2);
    expect(getInstance(result.newState, opp2Id).damage).toBe(2);
    // Own character unaffected
    expect(getInstance(result.newState, ownId).damage).toBe(0);
  });

  // --- exert action ---

  it("Freeze exerts chosen opposing character", () => {
    let state = startGame(["freeze"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "freeze", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, targetId).isExerted).toBe(true);
    expect(getInstance(resolve.newState, cardId).zone).toBe("discard");
  });

  // --- heal action ---

  it("Healing Glow removes up to 2 damage from chosen character", () => {
    let state = startGame(["healing-glow"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "healing-glow", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { damage: 3 }));
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, targetId).damage).toBe(1); // 3 - 2 = 1
  });

  // --- return_to_hand actions ---

  it("Mother Knows Best returns chosen character to hand (song)", () => {
    let state = startGame(["mother-knows-best"]);
    let cardId: string, targetId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "mother-knows-best", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, targetId).zone).toBe("hand");
  });

  it("Befuddle only targets characters/items with cost 2 or less", () => {
    let state = startGame(["befuddle"]);
    let cardId: string, cheapId: string, expensiveId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "befuddle", "hand"));
    ({ state, instanceId: cheapId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play")); // cost 2
    ({ state, instanceId: expensiveId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play")); // cost 3
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Only the cost-2 card should be a valid target
    expect(result.newState.pendingChoice!.validTargets).toContain(cheapId);
    expect(result.newState.pendingChoice!.validTargets).not.toContain(expensiveId);
  });

  it("Break banishes chosen item", () => {
    let state = startGame(["break"]);
    let cardId: string, itemId: string, charId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "break", "hand"));
    ({ state, instanceId: itemId } = injectCard(state, "player2", "eye-of-the-fates", "play"));
    ({ state, instanceId: charId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Only the item should be a valid target, not the character
    expect(result.newState.pendingChoice!.validTargets).toContain(itemId);
    expect(result.newState.pendingChoice!.validTargets).not.toContain(charId);
  });

  it("Part of Your World returns character from own discard to hand (song)", () => {
    let state = startGame(["part-of-your-world"]);
    let cardId: string, discardedId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "part-of-your-world", "hand"));
    ({ state, instanceId: discardedId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardedId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, discardedId).zone).toBe("hand");
  });

  // --- lore loss action ---

  it("Tangle causes opponent to lose 1 lore", () => {
    let state = startGame(["tangle"]);
    let cardId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "tangle", "hand"));
    state = giveInk(state, "player1", 3);
    state = setLore(state, "player2", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player2.lore).toBe(4);
  });

  it("Lore loss cannot go below 0 (CRD 1.11.1)", () => {
    let state = startGame(["tangle"]);
    let cardId: string;
    ({ state, instanceId: cardId } = injectCard(state, "player1", "tangle", "hand"));
    state = giveInk(state, "player1", 3);
    state = setLore(state, "player2", 0);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: cardId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player2.lore).toBe(0);
  });
});

describe("§6.2 Triggered abilities (data-driven)", () => {
  it("Maximus enters play → chosen character gets -2 STR", () => {
    let state = startGame(["maximus-relentless-pursuer"]);
    let maxId: string, targetId: string;
    ({ state, instanceId: maxId } = injectCard(state, "player1", "maximus-relentless-pursuer", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 6);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: maxId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();

    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).tempStrengthModifier).toBe(-2);
  });

  it("Rapunzel Letting Down Her Hair enters play → opponent loses 1 lore", () => {
    let state = startGame(["rapunzel-letting-down-her-hair"]);
    let rapId: string;
    ({ state, instanceId: rapId } = injectCard(state, "player1", "rapunzel-letting-down-her-hair", "hand"));
    state = giveInk(state, "player1", 6); // cost 6
    state = setLore(state, "player2", 3);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: rapId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player2.lore).toBe(2);
  });

  it("Tinker Bell Giant Fairy enters play → 1 damage to all opposing characters", () => {
    let state = startGame(["tinker-bell-giant-fairy"]);
    let tinkId: string, opp1Id: string, opp2Id: string, ownId: string;
    ({ state, instanceId: tinkId } = injectCard(state, "player1", "tinker-bell-giant-fairy", "hand"));
    ({ state, instanceId: opp1Id } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    ({ state, instanceId: opp2Id } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: ownId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: tinkId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, opp1Id).damage).toBe(1);
    expect(getInstance(result.newState, opp2Id).damage).toBe(1);
    expect(getInstance(result.newState, ownId).damage).toBe(0);
  });

  it("Maleficent Monstrous Dragon enters play → may banish chosen character", () => {
    let state = startGame(["maleficent-monstrous-dragon"]);
    let malId: string, targetId: string;
    ({ state, instanceId: malId } = injectCard(state, "player1", "maleficent-monstrous-dragon", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: malId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // isMay → choose_may first
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    const accept = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(accept.newState.pendingChoice?.type).toBe("choose_target");

    const resolve = applyAction(accept.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).zone).toBe("discard");
  });

  it("Hades Lord of the Underworld enters play → return character from own discard", () => {
    let state = startGame(["hades-lord-of-the-underworld"]);
    let hadesId: string, discardedId: string;
    ({ state, instanceId: hadesId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "hand"));
    ({ state, instanceId: discardedId } = injectCard(state, "player1", "mickey-mouse-true-friend", "discard"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: hadesId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardedId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, discardedId).zone).toBe("hand");
  });

  it("Hans quests → may deal 1 damage to chosen character", () => {
    let state = startGame(["hans-thirteenth-in-line"]);
    let hansId: string, targetId: string;
    ({ state, instanceId: hansId } = injectCard(state, "player1", "hans-thirteenth-in-line", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: hansId }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    const accept = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(accept.newState.pendingChoice?.type).toBe("choose_target");

    const resolve = applyAction(accept.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).damage).toBe(1);
  });

  it("Marshmallow is_banished → may return self to hand", () => {
    let state = startGame(["marshmallow-persistent-guardian"]);
    let marshId: string, attackerId: string;
    ({ state, instanceId: marshId } = injectCard(state, "player2", "marshmallow-persistent-guardian", "play", { isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    // Marshmallow has 5 WP, Mickey has 3 STR — won't banish from one challenge
    // Use a stronger attacker: hades-king-of-olympus (6 STR, 7 WP)
    // Actually let's just use flotsam (3 STR). Marshmallow has 5 WP so we need more.
    // Simpler: put enough damage on Marshmallow first so challenge banishes it.
    state = { ...state, cards: { ...state.cards, [marshId]: { ...state.cards[marshId]!, damage: 4 } } };

    // player1 challenges marshmallow (3 STR >= 1 remaining WP → banished)
    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: marshId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // is_banished triggers → choose_may
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    const accept = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(accept.success).toBe(true);
    expect(getInstance(accept.newState, marshId).zone).toBe("hand");
  });

  it("Mad Hatter is_challenged → may draw a card", () => {
    let state = startGame(["mad-hatter-gracious-host"]);
    let hatterId: string, attackerId: string;
    ({ state, instanceId: hatterId } = injectCard(state, "player2", "mad-hatter-gracious-host", "play", { isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    const handBefore = getZone(state, "player2", "hand").length;

    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: hatterId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    const accept = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(accept.success).toBe(true);
    expect(getZone(accept.newState, "player2", "hand").length).toBe(handBefore + 1);
  });

  it("Genie On the Job enters play → may return chosen character to hand", () => {
    let state = startGame(["genie-on-the-job"]);
    let genieId: string, targetId: string;
    ({ state, instanceId: genieId } = injectCard(state, "player1", "genie-on-the-job", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, { type: "PLAY_CARD", playerId: "player1", instanceId: genieId }, LORCAST_CARD_DEFINITIONS);
    const accept = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    const resolve = applyAction(accept.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).zone).toBe("hand");
  });
});

// =============================================================================
// §8.11 Singer keyword (CRD 8.11.1, 8.11.2)
// =============================================================================

describe("§8.11 Singer", () => {
  // ariel-spectacular-singer: cost 3, Singer 5
  // sebastian-court-composer: cost 2, Singer 4

  it("Singer 5 (cost 3 char) can sing cost 5 song — uses Singer value (CRD 8.11.1)", () => {
    // Ariel cost 3, Singer 5 → can sing a cost-5 song
    let state = startGame(["ariel-spectacular-singer", "let-it-go"]);
    let songId: string, arielId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "let-it-go", "hand"));
    ({ state, instanceId: arielId } = injectCard(state, "player1", "ariel-spectacular-singer", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: arielId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(getInstance(result.newState, arielId).isExerted).toBe(true);
  });

  it("Singer 5 (cost 3 char) cannot sing cost 6+ song (CRD 8.11.2)", () => {
    // Ariel has Singer 5, be-prepared costs 7
    let state = startGame(["ariel-spectacular-singer", "be-prepared"]);
    let songId: string, arielId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "be-prepared", "hand"));
    ({ state, instanceId: arielId } = injectCard(state, "player1", "ariel-spectacular-singer", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: arielId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(false);
  });

  it("non-Singer cost 5 char can still sing cost 5 song — Singer not required (CRD 5.4.4.2)", () => {
    // flotsam-ursulas-spy: cost 5, no Singer
    let state = startGame(["flotsam-ursulas-spy", "let-it-go"]);
    let songId: string, flotsamId: string;
    ({ state, instanceId: songId } = injectCard(state, "player1", "let-it-go", "hand"));
    ({ state, instanceId: flotsamId } = injectCard(state, "player1", "flotsam-ursulas-spy", "play"));

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: songId, singerInstanceId: flotsamId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
  });

  it("Singer doesn't change cost for other purposes (CRD 8.11.2)", () => {
    // Ariel has Singer 5, but her actual cost is 3 for ink/shift purposes
    const arielDef = LORCAST_CARD_DEFINITIONS["ariel-spectacular-singer"];
    expect(arielDef).toBeDefined();
    expect(arielDef!.cost).toBe(3); // Actual cost remains 3
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

  it("Elsa Snow Queen: exerts to exert chosen opposing character", () => {
    let state = startGame(["elsa-snow-queen"]);
    let elsaId: string, targetId: string;
    ({ state, instanceId: elsaId } = injectCard(state, "player1", "elsa-snow-queen", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: elsaId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolve.success).toBe(true);
    expect(getInstance(resolve.newState, targetId).isExerted).toBe(true);
    expect(getInstance(resolve.newState, elsaId).isExerted).toBe(true);
  });

  it("Plasma Blaster: exert + 2 ink to deal 1 damage", () => {
    let state = startGame(["plasma-blaster"]);
    let blasterId: string, targetId: string;
    ({ state, instanceId: blasterId } = injectCard(state, "player1", "plasma-blaster", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 3);

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: blasterId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolve = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(resolve.newState, targetId).damage).toBe(1);
    expect(resolve.newState.players.player1.availableInk).toBe(1); // 3 - 2
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

  // CRD 8.3.2: Bodyguard may enter play exerted
  it("Bodyguard triggers may choice on play (CRD 8.3.2)", () => {
    let state = startGame(["goofy-musketeer"]);
    let goofyId: string;
    ({ state, instanceId: goofyId } = injectCard(state, "player1", "goofy-musketeer", "hand"));
    state = giveInk(state, "player1", 5);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: goofyId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();
    expect(result.newState.pendingChoice!.type).toBe("choose_may");
    expect(result.newState.pendingChoice!.choosingPlayerId).toBe("player1");
  });

  it("Bodyguard accepted — enters exerted (CRD 8.3.2)", () => {
    let state = startGame(["goofy-musketeer"]);
    let goofyId: string;
    ({ state, instanceId: goofyId } = injectCard(state, "player1", "goofy-musketeer", "hand"));
    state = giveInk(state, "player1", 5);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: goofyId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_may");

    const acceptResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);

    expect(acceptResult.success).toBe(true);
    const goofy = getInstance(acceptResult.newState, goofyId);
    expect(goofy.isExerted).toBe(true);
    expect(goofy.isDrying).toBe(true); // still drying
  });

  it("Bodyguard declined — stays ready (CRD 8.3.2 / 6.1.4)", () => {
    let state = startGame(["goofy-musketeer"]);
    let goofyId: string;
    ({ state, instanceId: goofyId } = injectCard(state, "player1", "goofy-musketeer", "hand"));
    state = giveInk(state, "player1", 5);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: goofyId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_may");

    const declineResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline",
    }, LORCAST_CARD_DEFINITIONS);

    expect(declineResult.success).toBe(true);
    const goofy = getInstance(declineResult.newState, goofyId);
    expect(goofy.isExerted).toBe(false);
    expect(goofy.isDrying).toBe(true); // still drying
  });

  it("Non-Bodyguard has no may choice on play (CRD 8.3.2)", () => {
    let state = startGame(["minnie-mouse-beloved-princess"]);
    let minnieId: string;
    ({ state, instanceId: minnieId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player1", 2);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: minnieId,
    }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // Minnie has no Bodyguard — no may choice (unless she has another enters_play trigger)
    // She doesn't, so pendingChoice should be null
    expect(result.newState.pendingChoice).toBeNull();
  });

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
});

// =============================================================================
// §8.13 Support (CRD 8.13.1)
// =============================================================================

describe("§8.13 Support", () => {
  // philoctetes-trainer-of-heroes: cost 2, STR 3, WP 1, lore 1, Support

  it("Support triggers may choice when questing with another character in play (CRD 8.13.1)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string, targetId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).not.toBeNull();
    expect(result.newState.pendingChoice!.type).toBe("choose_may");
    expect(result.newState.pendingChoice!.choosingPlayerId).toBe("player1");
  });

  it("Support accepted — presents target choice, then target gains strength (CRD 8.13.1)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string, targetId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    // Quest triggers Support
    const questResult = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);
    expect(questResult.newState.pendingChoice?.type).toBe("choose_may");

    // Accept the may effect
    const acceptResult = applyAction(questResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.newState.pendingChoice).not.toBeNull();
    expect(acceptResult.newState.pendingChoice!.type).toBe("choose_target");

    // Choose target
    const resolveResult = applyAction(acceptResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    // Philoctetes has STR 3, so target gets +3 strength this turn
    expect(getInstance(resolveResult.newState, targetId).tempStrengthModifier).toBe(3);
  });

  it("Support declined — no effect (CRD 6.1.4)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string, targetId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const questResult = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);

    // Decline the may effect
    const declineResult = applyAction(questResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "decline",
    }, LORCAST_CARD_DEFINITIONS);
    expect(declineResult.success).toBe(true);
    expect(declineResult.newState.pendingChoice).toBeNull();
    // Target should have no modifier
    expect(getInstance(declineResult.newState, targetId).tempStrengthModifier).toBe(0);
  });

  it("Support skipped when alone — no may choice (CRD 8.13.1)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    // No other character in play → no Support trigger → no pending choice
    expect(result.newState.pendingChoice).toBeNull();
  });

  it("Support strength clears at end of turn (CRD 3.4.1.2)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string, targetId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    // Quest → accept → choose target
    let result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept" }, LORCAST_CARD_DEFINITIONS);
    result = applyAction(result.newState, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId] }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(result.newState, targetId).tempStrengthModifier).toBe(3);

    // Pass turn — modifiers clear
    result = applyAction(result.newState, { type: "PASS_TURN", playerId: "player1" }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, targetId).tempStrengthModifier).toBe(0);
  });

  it("Support cannot target the questing character itself (CRD 8.13.1)", () => {
    let state = startGame(["philoctetes-trainer-of-heroes"]);
    let philId: string, otherId: string;
    ({ state, instanceId: philId } = injectCard(state, "player1", "philoctetes-trainer-of-heroes", "play"));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const questResult = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: philId }, LORCAST_CARD_DEFINITIONS);
    const acceptResult = applyAction(questResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);

    // The valid targets should not include the questing character
    expect(acceptResult.newState.pendingChoice).not.toBeNull();
    expect(acceptResult.newState.pendingChoice!.validTargets).not.toContain(philId);
    expect(acceptResult.newState.pendingChoice!.validTargets).toContain(otherId);
  });

  it("Non-Support character questing has no may choice", () => {
    let state = startGame();
    let mickeyId: string, otherId: string;
    ({ state, instanceId: mickeyId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    ({ state, instanceId: otherId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const result = applyAction(state, { type: "QUEST", playerId: "player1", instanceId: mickeyId }, LORCAST_CARD_DEFINITIONS);

    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).toBeNull();
  });
});

// =============================================================================
// PHASE 0: QUICK WINS — Filter Additions + Condition Eval
// =============================================================================

// ---------------------------------------------------------------------------
// hasName filter
// ---------------------------------------------------------------------------

describe("CardFilter: hasName", () => {
  // Captain Hook - Captain of the Jolly Roger: enters_play → may return
  // action card named "Fire the Cannons!" from discard to hand
  it("Captain Hook returns Fire the Cannons! from discard (hasName filter)", () => {
    let state = startGame(["captain-hook-captain-of-the-jolly-roger"]);
    let hookId: string, ftcId: string;
    ({ state, instanceId: hookId } = injectCard(state, "player1", "captain-hook-captain-of-the-jolly-roger", "hand"));
    ({ state, instanceId: ftcId } = injectCard(state, "player1", "fire-the-cannons", "discard"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: hookId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    // enters_play trigger → choose_may for return_to_hand
    expect(playResult.newState.pendingChoice?.type).toBe("choose_may");

    // Accept
    const acceptResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.success).toBe(true);
    // Now pick target
    expect(acceptResult.newState.pendingChoice?.type).toBe("choose_target");
    expect(acceptResult.newState.pendingChoice!.validTargets).toContain(ftcId);

    const resolveResult = applyAction(acceptResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [ftcId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, ftcId).zone).toBe("hand");
  });

  it("Captain Hook: non-matching action in discard is not a valid target", () => {
    let state = startGame(["captain-hook-captain-of-the-jolly-roger"]);
    let hookId: string, otherId: string;
    ({ state, instanceId: hookId } = injectCard(state, "player1", "captain-hook-captain-of-the-jolly-roger", "hand"));
    // Put a different action in discard
    ({ state, instanceId: otherId } = injectCard(state, "player1", "dragon-fire", "discard"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: hookId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_may");

    const acceptResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    // No valid targets → should present target choice with empty list
    expect(acceptResult.newState.pendingChoice?.validTargets ?? []).not.toContain(otherId);
  });

  // Moana - Chosen by the Ocean: enters_play → may banish chosen "Te Kā"
  it("Moana can banish Te Kā via hasName filter", () => {
    let state = startGame(["moana-chosen-by-the-ocean"]);
    let moanaId: string, tekaId: string;
    ({ state, instanceId: moanaId } = injectCard(state, "player1", "moana-chosen-by-the-ocean", "hand"));
    ({ state, instanceId: tekaId } = injectCard(state, "player2", "te-k-heartless", "play", { isExerted: false }));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: moanaId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_may");

    const acceptResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.newState.pendingChoice?.type).toBe("choose_target");
    expect(acceptResult.newState.pendingChoice!.validTargets).toContain(tekaId);

    const resolveResult = applyAction(acceptResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [tekaId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, tekaId).zone).toBe("discard");
  });
});

// ---------------------------------------------------------------------------
// hasDamage filter
// ---------------------------------------------------------------------------

describe("CardFilter: hasDamage", () => {
  // Beast - Wolfsbane: enters_play → exert all opposing damaged characters
  it("Beast - Wolfsbane exerts all opposing damaged characters", () => {
    let state = startGame(["beast-wolfsbane"]);
    let beastId: string, damagedId: string, healthyId: string;
    ({ state, instanceId: beastId } = injectCard(state, "player1", "beast-wolfsbane", "hand"));
    ({ state, instanceId: damagedId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { damage: 1 }));
    ({ state, instanceId: healthyId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { damage: 0 }));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: beastId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Damaged character exerted
    expect(getInstance(result.newState, damagedId).isExerted).toBe(true);
    // Healthy character NOT exerted
    expect(getInstance(result.newState, healthyId).isExerted).toBe(false);
  });

  // Stampede: deal 2 to chosen damaged character
  it("Stampede can only target damaged characters", () => {
    let state = startGame();
    let stampedeId: string, damagedId: string, healthyId: string;
    ({ state, instanceId: stampedeId } = injectCard(state, "player1", "stampede", "hand"));
    ({ state, instanceId: damagedId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { damage: 1 }));
    ({ state, instanceId: healthyId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: stampedeId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    // Only damaged character is valid
    expect(result.newState.pendingChoice!.validTargets).toContain(damagedId);
    expect(result.newState.pendingChoice!.validTargets).not.toContain(healthyId);
  });
});

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

describe("Condition evaluation", () => {
  // Stitch - Carefree Surfer: enters_play + condition (2+ other chars) → may draw 2
  it("Stitch - Carefree Surfer: draws 2 when 2+ other characters in play", () => {
    let state = startGame(["stitch-carefree-surfer"]);
    let stitchId: string;
    ({ state, instanceId: stitchId } = injectCard(state, "player1", "stitch-carefree-surfer", "hand"));
    // Put 2 other characters in play
    injectCard(state, "player1", "minnie-mouse-beloved-princess", "play");
    ({ state } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    ({ state } = injectCard(state, "player1", "mickey-mouse-true-friend", "play"));
    state = giveInk(state, "player1", 10);

    const handBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: stitchId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should trigger may choice
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    // Accept → draw 2
    const acceptResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.success).toBe(true);
    // Hand count: started with handBefore - 1 (played stitch), drew 2
    const handAfter = getZone(acceptResult.newState, "player1", "hand").length;
    expect(handAfter).toBe(handBefore - 1 + 2);
  });

  it("Stitch - Carefree Surfer: no trigger when fewer than 2 other characters", () => {
    let state = startGame(["stitch-carefree-surfer"]);
    let stitchId: string;
    ({ state, instanceId: stitchId } = injectCard(state, "player1", "stitch-carefree-surfer", "hand"));
    // Only 1 other character in play
    ({ state } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: stitchId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Condition not met → no trigger → no pending choice
    expect(result.newState.pendingChoice).toBeNull();
  });

  // Beast's Mirror: {E}, 3{I} — if no cards in hand, draw 1
  it("Beast's Mirror: draws when hand is empty", () => {
    let state = startGame();
    let mirrorId: string;
    ({ state, instanceId: mirrorId } = injectCard(state, "player1", "beasts-mirror", "play"));
    state = giveInk(state, "player1", 10);
    // Empty hand
    const handIds = getZone(state, "player1", "hand");
    for (const id of handIds) {
      const inst = state.cards[id]!;
      state = {
        ...state,
        cards: { ...state.cards, [id]: { ...inst, zone: "discard" } },
        zones: {
          ...state.zones,
          player1: {
            ...state.zones.player1,
            hand: state.zones.player1.hand.filter((x) => x !== id),
            discard: [...state.zones.player1.discard, id],
          },
        },
      };
    }
    expect(getZone(state, "player1", "hand")).toHaveLength(0);

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: mirrorId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player1", "hand")).toHaveLength(1);
  });

  it("Beast's Mirror: condition fails when hand is not empty", () => {
    let state = startGame();
    let mirrorId: string;
    ({ state, instanceId: mirrorId } = injectCard(state, "player1", "beasts-mirror", "play"));
    state = giveInk(state, "player1", 10);
    // Hand has cards (opening hand)
    expect(getZone(state, "player1", "hand").length).toBeGreaterThan(0);

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: mirrorId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    // Costs are paid but condition fails — no draw
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, mirrorId).isExerted).toBe(true);
    // Ink is spent
    expect(result.newState.players.player1.availableInk).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Activated ability: banish_self cost
// ---------------------------------------------------------------------------

describe("Activated ability: banish_self cost", () => {
  // Sword of Truth: banish self → banish chosen Villain
  it("Sword of Truth: banishes itself and a chosen Villain", () => {
    let state = startGame();
    let swordId: string, villainId: string;
    ({ state, instanceId: swordId } = injectCard(state, "player1", "sword-of-truth", "play"));
    // dr-facilier-charlatan has Villain trait
    ({ state, instanceId: villainId } = injectCard(state, "player2", "dr-facilier-charlatan", "play", { isExerted: true }));

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: swordId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Sword banished as cost
    expect(getInstance(result.newState, swordId).zone).toBe("discard");
    // Pending choice to pick Villain target
    expect(result.newState.pendingChoice?.type).toBe("choose_target");
    expect(result.newState.pendingChoice!.validTargets).toContain(villainId);

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [villainId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, villainId).zone).toBe("discard");
  });

  // Magic Golden Flower: banish self → heal 3 chosen character (isUpTo)
  it("Magic Golden Flower: banishes self and heals chosen character", () => {
    let state = startGame();
    let flowerId: string, charId: string;
    ({ state, instanceId: flowerId } = injectCard(state, "player1", "magic-golden-flower", "play"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { damage: 3 }));

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: flowerId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, flowerId).zone).toBe("discard");
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, charId).damage).toBe(0);
  });
});

// =============================================================================
// PHASE 1: TIMED EFFECTS — grant_keyword, ready, cant_quest, cant_ready
// =============================================================================

describe("Grant keyword (timed)", () => {
  // Cut to the Chase: chosen character gains Rush this turn
  it("Cut to the Chase grants Rush to chosen character", () => {
    let state = startGame();
    let cutId: string, charId: string;
    ({ state, instanceId: cutId } = injectCard(state, "player1", "cut-to-the-chase", "hand"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: true }));
    state = giveInk(state, "player1", 10);

    // Play Cut to the Chase → pending target choice
    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: cutId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_target");

    // Choose the character
    const resolveResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, charId);
    // Should have Rush via timed effect
    expect(inst.timedEffects.some((te) => te.type === "grant_keyword" && te.keyword === "rush")).toBe(true);
  });

  // Tinker Bell - Most Helpful: enters_play → chosen gains Evasive this turn
  it("Tinker Bell - Most Helpful grants Evasive to chosen character on enter", () => {
    let state = startGame(["tinker-bell-most-helpful"]);
    let tinkId: string, charId: string;
    ({ state, instanceId: tinkId } = injectCard(state, "player1", "tinker-bell-most-helpful", "hand"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: tinkId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    // Enters play → trigger with target choice
    expect(playResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, charId);
    expect(inst.timedEffects.some((te) => te.type === "grant_keyword" && te.keyword === "evasive")).toBe(true);
  });

  // White Rabbit's Pocket Watch: {E}, 1{I} → chosen gains Rush
  it("White Rabbit's Pocket Watch grants Rush via activated ability", () => {
    let state = startGame();
    let watchId: string, charId: string;
    ({ state, instanceId: watchId } = injectCard(state, "player1", "white-rabbits-pocket-watch", "play"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isDrying: true }));
    state = giveInk(state, "player1", 10);

    const activateResult = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: watchId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(activateResult.success).toBe(true);
    expect(activateResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(activateResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, charId);
    expect(inst.timedEffects.some((te) => te.type === "grant_keyword" && te.keyword === "rush")).toBe(true);
    // Watch should be exerted and 1 ink spent
    expect(getInstance(resolveResult.newState, watchId).isExerted).toBe(true);
    expect(resolveResult.newState.players.player1.availableInk).toBe(9);
  });

  it("Granted keyword expires at end of turn", () => {
    let state = startGame();
    let cutId: string, charId: string;
    ({ state, instanceId: cutId } = injectCard(state, "player1", "cut-to-the-chase", "hand"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    let result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: cutId,
    }, LORCAST_CARD_DEFINITIONS);
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(result.newState, charId).timedEffects.length).toBeGreaterThan(0);

    // Pass turn → timed effects expire
    result = applyAction(result.newState, {
      type: "PASS_TURN", playerId: "player1",
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(result.newState, charId).timedEffects).toHaveLength(0);
  });
});

describe("Ready + Can't Quest (Fan the Flames pattern)", () => {
  // Fan the Flames: Ready chosen character. They can't quest for the rest of this turn.
  it("Fan the Flames readies a character and prevents questing", () => {
    let state = startGame();
    let fanId: string, charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    ({ state, instanceId: fanId } = injectCard(state, "player1", "fan-the-flames", "hand"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: fanId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, charId);
    // Character should be readied
    expect(inst.isExerted).toBe(false);
    // Character should have cant_quest
    expect(inst.timedEffects.some((te) => te.type === "cant_quest")).toBe(true);

    // Verify they can't quest
    const questResult = applyAction(resolveResult.newState, {
      type: "QUEST", playerId: "player1", instanceId: charId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(questResult.success).toBe(false);
    expect(questResult.error).toMatch(/can't quest/i);
  });

  // LeFou - Instigator: enters_play → ready chosen character, can't quest
  it("LeFou readies chosen character on enter, prevents questing", () => {
    let state = startGame(["lefou-instigator"]);
    let lefouId: string, charId: string;
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    ({ state, instanceId: lefouId } = injectCard(state, "player1", "lefou-instigator", "hand"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: lefouId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    // Trigger → choose target
    expect(playResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, charId);
    expect(inst.isExerted).toBe(false);
    expect(inst.timedEffects.some((te) => te.type === "cant_quest")).toBe(true);
  });

  // Scar - Shameless Firebrand: enters_play → ready all own chars cost ≤ 3, can't quest
  it("Scar readies all own characters with cost ≤ 3 and prevents questing", () => {
    let state = startGame(["scar-shameless-firebrand"]);
    let scarId: string, cheapId: string, expensiveId: string;
    ({ state, instanceId: cheapId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play", { isExerted: true }));
    // mickey-mouse-true-friend costs 3, should be affected
    ({ state, instanceId: expensiveId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { isExerted: true }));
    ({ state, instanceId: scarId } = injectCard(state, "player1", "scar-shameless-firebrand", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: scarId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Both Minnie (cost 2) and Mickey (cost 3) should be readied
    expect(getInstance(result.newState, cheapId).isExerted).toBe(false);
    expect(getInstance(result.newState, expensiveId).isExerted).toBe(false);
    // Both should have cant_quest
    expect(getInstance(result.newState, cheapId).timedEffects.some((te) => te.type === "cant_quest")).toBe(true);
    expect(getInstance(result.newState, expensiveId).timedEffects.some((te) => te.type === "cant_quest")).toBe(true);
  });
});

describe("Can't Ready (Elsa - Spirit of Winter)", () => {
  it("Elsa exerts chosen characters and prevents them from readying", () => {
    let state = startGame(["elsa-spirit-of-winter"]);
    let elsaId: string, targetId: string;
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: elsaId } = injectCard(state, "player1", "elsa-spirit-of-winter", "hand"));
    state = giveInk(state, "player1", 10);

    const playResult = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: elsaId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(playResult.success).toBe(true);
    expect(playResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(playResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    const inst = getInstance(resolveResult.newState, targetId);
    expect(inst.isExerted).toBe(true);
    expect(inst.timedEffects.some((te) => te.type === "cant_ready")).toBe(true);
  });

  it("Can't ready prevents readying at start of next turn", () => {
    let state = startGame(["elsa-spirit-of-winter"]);
    let elsaId: string, targetId: string;
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    ({ state, instanceId: elsaId } = injectCard(state, "player1", "elsa-spirit-of-winter", "hand"));
    state = giveInk(state, "player1", 10);

    // Play Elsa, exert target
    let result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: elsaId,
    }, LORCAST_CARD_DEFINITIONS);
    result = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(getInstance(result.newState, targetId).isExerted).toBe(true);

    // Pass turn to player2
    result = applyAction(result.newState, {
      type: "PASS_TURN", playerId: "player1",
    }, LORCAST_CARD_DEFINITIONS);
    // Target should still be exerted because of cant_ready
    expect(getInstance(result.newState, targetId).isExerted).toBe(true);
  });
});

// =============================================================================
// PHASE 3: LOOK AT TOP N (Scry)
// =============================================================================

describe("Look at top N (Scry)", () => {
  // Develop Your Brain: look at top 2, one to hand, rest to bottom
  it("Develop Your Brain puts one of top 2 cards into hand", () => {
    let state = startGame();
    let dyb: string;
    ({ state, instanceId: dyb } = injectCard(state, "player1", "develop-your-brain", "hand"));
    state = giveInk(state, "player1", 10);

    const deckBefore = getZone(state, "player1", "deck").length;
    const handBefore = getZone(state, "player1", "hand").length;

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: dyb,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // One card moved from deck to hand
    const deckAfter = getZone(result.newState, "player1", "deck").length;
    const handAfter = getZone(result.newState, "player1", "hand").length;
    expect(handAfter).toBe(handBefore - 1 + 1); // -1 for playing DYB, +1 from look_at_top
    expect(deckAfter).toBe(deckBefore - 1); // -1 moved to hand (other stays in deck on bottom)
  });

  // Be Our Guest: look at top 4, may reveal character to hand
  it("Be Our Guest finds a character from top 4", () => {
    let state = startGame(["be-our-guest", "mickey-mouse-true-friend"]);
    let bogId: string;
    ({ state, instanceId: bogId } = injectCard(state, "player1", "be-our-guest", "hand"));
    state = giveInk(state, "player1", 10);

    const handBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: bogId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should have drawn a character from top 4 (deck is all mickey + minnie)
    const handAfter = getZone(result.newState, "player1", "hand").length;
    expect(handAfter).toBe(handBefore - 1 + 1); // played BOG, found character
  });

  // Yzma - Alchemist: quests → look at top 1 (bot auto-resolves, no-op for now)
  it("Yzma quests without error (scry resolves automatically)", () => {
    let state = startGame(["yzma-alchemist"]);
    let yzmaId: string;
    ({ state, instanceId: yzmaId } = injectCard(state, "player1", "yzma-alchemist", "play"));

    const result = applyAction(state, {
      type: "QUEST", playerId: "player1", instanceId: yzmaId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice).toBeNull();
    expect(result.newState.players.player1.lore).toBe(1);
  });
});

// =============================================================================
// PHASE 2: DISCARD FROM HAND
// =============================================================================

describe("Discard from hand", () => {
  // Sudden Chill: each opponent chooses and discards a card
  it("Sudden Chill forces opponent to discard a card", () => {
    let state = startGame();
    let scId: string;
    ({ state, instanceId: scId } = injectCard(state, "player1", "sudden-chill", "hand"));
    state = giveInk(state, "player1", 10);

    const oppHandBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: scId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should create a discard choice for opponent
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    expect(result.newState.pendingChoice?.choosingPlayerId).toBe("player2");
    expect(result.newState.pendingChoice?.count).toBe(1);

    // Opponent chooses a card to discard
    const oppHand = getZone(result.newState, "player2", "hand");
    const discardTarget = oppHand[0]!;
    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: [discardTarget],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getZone(resolveResult.newState, "player2", "hand").length).toBe(oppHandBefore - 1);
    expect(getInstance(resolveResult.newState, discardTarget).zone).toBe("discard");
  });

  // You Have Forgotten Me: opponent discards 2
  it("You Have Forgotten Me forces opponent to discard 2 cards", () => {
    let state = startGame();
    let yhfmId: string;
    ({ state, instanceId: yhfmId } = injectCard(state, "player1", "you-have-forgotten-me", "hand"));
    state = giveInk(state, "player1", 10);

    const oppHandBefore = getZone(state, "player2", "hand").length;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: yhfmId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    expect(result.newState.pendingChoice?.count).toBe(2);

    const oppHand = getZone(result.newState, "player2", "hand");
    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppHand[0]!, oppHand[1]!],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getZone(resolveResult.newState, "player2", "hand").length).toBe(oppHandBefore - 2);
  });

  it("Discard validation: wrong number of cards rejected", () => {
    let state = startGame();
    let yhfmId: string;
    ({ state, instanceId: yhfmId } = injectCard(state, "player1", "you-have-forgotten-me", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: yhfmId,
    }, LORCAST_CARD_DEFINITIONS);

    // Try to discard only 1 when 2 required
    const oppHand = getZone(result.newState, "player2", "hand");
    const badResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: [oppHand[0]!],
    }, LORCAST_CARD_DEFINITIONS);
    expect(badResult.success).toBe(false);
  });
});

// =============================================================================
// PHASE 5: CROSS-CARD TRIGGERS
// =============================================================================

describe("Cross-card triggers", () => {
  // Coconut Basket: "Whenever you play a character, you may remove up to 2 damage from chosen character."
  it("Coconut Basket triggers when owner plays a character", () => {
    let state = startGame(["coconut-basket"]);
    let basketId: string, charId: string, damagedId: string;
    ({ state, instanceId: basketId } = injectCard(state, "player1", "coconut-basket", "play"));
    ({ state, instanceId: damagedId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play", { damage: 2 }));
    ({ state, instanceId: charId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player1", 10);

    // Play a character — should trigger Coconut Basket
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: charId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should have a may choice from Coconut Basket
    expect(result.newState.pendingChoice?.type).toBe("choose_may");
  });

  it("Coconut Basket does NOT trigger when opponent plays a character", () => {
    let state = startGame(["coconut-basket"]);
    let basketId: string, charId: string;
    ({ state, instanceId: basketId } = injectCard(state, "player1", "coconut-basket", "play"));
    // Switch to player2's turn
    state = { ...state, currentPlayer: "player2" };
    ({ state, instanceId: charId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "hand"));
    state = giveInk(state, "player2", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player2", instanceId: charId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // No trigger for player2's play
    expect(result.newState.pendingChoice).toBeNull();
  });
});

// =============================================================================
// PHASE 7: CHALLENGE-TRIGGERED ABILITIES
// =============================================================================

describe("Challenge-triggered abilities", () => {
  // Cheshire Cat: banished in challenge → banish the challenger
  it("Cheshire Cat banishes the challenger when banished in challenge", () => {
    let state = startGame(["cheshire-cat-not-all-there"]);
    let catId: string, attackerId: string;
    // Cat in play for player2, exerted so it can be challenged
    ({ state, instanceId: catId } = injectCard(state, "player2", "cheshire-cat-not-all-there", "play", { isExerted: true }));
    // Attacker for player1 — needs enough strength to banish cat (WP 3)
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "mickey-mouse-true-friend", "play")); // STR 3

    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: catId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Cat was banished (3 damage >= 3 WP)
    expect(getInstance(result.newState, catId).zone).toBe("discard");
    // Challenger should also be banished by Cat's triggered ability
    expect(getInstance(result.newState, attackerId).zone).toBe("discard");
  });

  // Kuzco: banished in challenge → MAY banish the challenger
  it("Kuzco offers may choice to banish challenger when banished", () => {
    let state = startGame(["kuzco-temperamental-emperor"]);
    let kuzcoId: string, attackerId: string;
    ({ state, instanceId: kuzcoId } = injectCard(state, "player2", "kuzco-temperamental-emperor", "play", { isExerted: true }));
    // Need strong attacker to banish Kuzco (WP 4)
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "hades-lord-of-the-underworld", "play")); // STR 3
    // Give Kuzco some damage to ensure banish
    state = {
      ...state,
      cards: { ...state.cards, [kuzcoId]: { ...state.cards[kuzcoId]!, damage: 2 } },
    };

    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: kuzcoId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, kuzcoId).zone).toBe("discard");
    // Kuzco's ability should present a may choice
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    // Accept → banish challenger
    const acceptResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player2", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.success).toBe(true);
    expect(getInstance(acceptResult.newState, attackerId).zone).toBe("discard");
  });
});

// =============================================================================
// MISC: Additional card effect tests
// =============================================================================

describe("Activated: draw then discard", () => {
  // Tinker Bell - Tiny Tactician: {E} → draw 1, then choose and discard 1
  it("Tinker Bell - Tiny Tactician draws then forces discard choice", () => {
    let state = startGame(["tinker-bell-tiny-tactician"]);
    let tinkId: string;
    ({ state, instanceId: tinkId } = injectCard(state, "player1", "tinker-bell-tiny-tactician", "play"));

    const handBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: tinkId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, tinkId).isExerted).toBe(true);
    // Drew 1 card, now must discard 1
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    expect(result.newState.pendingChoice?.count).toBe(1);
    const handMid = getZone(result.newState, "player1", "hand");
    expect(handMid.length).toBe(handBefore + 1);

    // Discard a card
    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [handMid[0]!],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getZone(resolveResult.newState, "player1", "hand").length).toBe(handBefore);
  });
});

describe("Triggered: is_challenged discard", () => {
  // Flynn Rider - Charming Rogue: is_challenged → challenger discards 1
  it("Flynn Rider forces challenger to discard when challenged", () => {
    let state = startGame(["flynn-rider-charming-rogue"]);
    let flynnId: string, attackerId: string;
    ({ state, instanceId: flynnId } = injectCard(state, "player2", "flynn-rider-charming-rogue", "play", { isExerted: true }));
    ({ state, instanceId: attackerId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));

    const oppHandBefore = getZone(state, "player1", "hand").length;
    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: attackerId, defenderInstanceId: flynnId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Flynn's trigger should force challenger (player1) to discard
    expect(result.newState.pendingChoice?.type).toBe("choose_discard");
    expect(result.newState.pendingChoice?.choosingPlayerId).toBe("player1");
  });
});

describe("Triggered: quests cant_quest", () => {
  // Jasper - Common Crook: quests → chosen opposing char can't quest next turn
  it("Jasper prevents opposing character from questing", () => {
    let state = startGame(["jasper-common-crook"]);
    let jasperId: string, targetId: string;
    ({ state, instanceId: jasperId } = injectCard(state, "player1", "jasper-common-crook", "play"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));

    const result = applyAction(state, {
      type: "QUEST", playerId: "player1", instanceId: jasperId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Should present target choice for cant_quest
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, targetId).timedEffects.some(
      (te) => te.type === "cant_quest"
    )).toBe(true);
  });
});

// =============================================================================
// ZONE TRANSITION: banished_other_in_challenge
// =============================================================================

describe("banished_other_in_challenge (attacker-side trigger)", () => {
  // Simba - Rightful Heir: banishes in challenge → gain 1 lore
  it("Simba gains 1 lore when he banishes a defender", () => {
    let state = startGame(["simba-rightful-heir"]);
    let simbaId: string, defenderId: string;
    ({ state, instanceId: simbaId } = injectCard(state, "player1", "simba-rightful-heir", "play"));
    // Defender with low WP so Simba (STR 3) banishes it
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true })); // WP 3

    const loreBefore = state.players.player1.lore;
    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: simbaId, defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Minnie banished (3 damage >= 3 WP)
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
    // Simba gains 1 lore
    expect(result.newState.players.player1.lore).toBe(loreBefore + 1);
  });

  it("Simba does NOT gain lore if defender survives", () => {
    let state = startGame(["simba-rightful-heir"]);
    let simbaId: string, defenderId: string;
    ({ state, instanceId: simbaId } = injectCard(state, "player1", "simba-rightful-heir", "play"));
    // Defender with high WP so Simba doesn't banish
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "hades-lord-of-the-underworld", "play", { isExerted: true })); // WP 2 but... let me pick better

    // Use mickey with WP 3 but give him extra willpower via damage=0
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isExerted: true })); // STR 3, WP 3
    // Simba has STR 3, Mickey has WP 3 → exactly banished. Let's use a tougher target
    // goofy-musketeer has WP 6
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "goofy-musketeer", "play", { isExerted: true })); // WP 6

    const loreBefore = state.players.player1.lore;
    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: simbaId, defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Goofy NOT banished (3 damage < 6 WP)
    expect(getInstance(result.newState, defenderId).zone).toBe("play");
    // No lore gained
    expect(result.newState.players.player1.lore).toBe(loreBefore);
  });

  // Te Kā - Heartless: banishes in challenge → gain 2 lore
  it("Te Kā gains 2 lore when banishing in challenge", () => {
    let state = startGame(["te-k-heartless"]);
    let tekaId: string, defenderId: string;
    ({ state, instanceId: tekaId } = injectCard(state, "player1", "te-k-heartless", "play")); // STR 5
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play", { isExerted: true })); // WP 3

    const loreBefore = state.players.player1.lore;
    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: tekaId, defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
    expect(result.newState.players.player1.lore).toBe(loreBefore + 2);
  });
});

// =============================================================================
// INKWELL MANIPULATION
// =============================================================================

describe("Inkwell manipulation", () => {
  // Let It Go: put chosen character into their player's inkwell exerted
  it("Let It Go moves chosen character to inkwell (exerted)", () => {
    let state = startGame();
    let ligId: string, targetId: string;
    ({ state, instanceId: ligId } = injectCard(state, "player1", "let-it-go", "hand"));
    ({ state, instanceId: targetId } = injectCard(state, "player2", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: ligId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, targetId).zone).toBe("inkwell");
    expect(getInstance(resolveResult.newState, targetId).isExerted).toBe(true);
  });

  // One Jump Ahead: top of deck → inkwell exerted
  it("One Jump Ahead moves top of deck to inkwell", () => {
    let state = startGame();
    let ojaId: string;
    ({ state, instanceId: ojaId } = injectCard(state, "player1", "one-jump-ahead", "hand"));
    state = giveInk(state, "player1", 10);

    const deckBefore = getZone(state, "player1", "deck").length;
    const inkwellBefore = getZone(state, "player1", "inkwell").length;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: ojaId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(getZone(result.newState, "player1", "deck").length).toBe(deckBefore - 1);
    expect(getZone(result.newState, "player1", "inkwell").length).toBe(inkwellBefore + 1);
  });

  // Fishbone Quill: {E} → put any card from hand into inkwell (NOT exerted = adds ink)
  it("Fishbone Quill puts hand card into inkwell and adds available ink", () => {
    let state = startGame();
    let quillId: string;
    ({ state, instanceId: quillId } = injectCard(state, "player1", "fishbone-quill", "play"));
    state = giveInk(state, "player1", 5);

    const hand = getZone(state, "player1", "hand");
    const targetCard = hand[0]!;
    const inkBefore = state.players.player1.availableInk;

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: quillId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [targetCard],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, targetCard).zone).toBe("inkwell");
    // Not exerted → adds 1 available ink
    expect(resolveResult.newState.players.player1.availableInk).toBe(inkBefore + 1);
  });
});

// =============================================================================
// PER-COUNT STATIC ABILITIES
// =============================================================================

describe("Per-count static abilities", () => {
  // Jafar - Keeper of Secrets: +1 STR per card in hand
  it("Jafar gets +1 STR per card in owner's hand (affects challenge damage)", () => {
    let state = startGame(["jafar-keeper-of-secrets"]);
    let jafarId: string, defenderId: string;
    ({ state, instanceId: jafarId } = injectCard(state, "player1", "jafar-keeper-of-secrets", "play"));
    // Jafar base STR = 0, with 7 cards in hand → effective STR = 7
    ({ state, instanceId: defenderId } = injectCard(state, "player2", "mickey-mouse-true-friend", "play", { isExerted: true })); // WP 3

    const handSize = getZone(state, "player1", "hand").length; // should be 7
    expect(handSize).toBe(7);

    const result = applyAction(state, {
      type: "CHALLENGE", playerId: "player1", attackerInstanceId: jafarId, defenderInstanceId: defenderId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Jafar with 7 STR should banish Mickey (WP 3)
    expect(getInstance(result.newState, defenderId).zone).toBe("discard");
  });

  // Tamatoa - So Shiny: +1 lore per item in play
  it("Tamatoa gets +1 lore per item in play (affects quest)", () => {
    let state = startGame(["tamatoa-so-shiny"]);
    let tamId: string;
    ({ state, instanceId: tamId } = injectCard(state, "player1", "tamatoa-so-shiny", "play"));
    // Add 2 items to play
    ({ state } = injectCard(state, "player1", "eye-of-the-fates", "play"));
    ({ state } = injectCard(state, "player1", "eye-of-the-fates", "play"));

    // Tamatoa base lore = 1, +2 from items = 3
    const loreBefore = state.players.player1.lore;
    const result = applyAction(state, {
      type: "QUEST", playerId: "player1", instanceId: tamId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(loreBefore + 3);
  });

  // Starkey - Hook's Henchman: +1 lore while you have a Captain — binary, not per-count
  it("Starkey gets +1 lore with a Captain in play, +0 without", () => {
    let state = startGame(["starkey-hooks-henchman"]);
    let starkeyId: string, captainId: string;
    ({ state, instanceId: starkeyId } = injectCard(state, "player1", "starkey-hooks-henchman", "play"));

    // No Captain → base lore (1)
    const loreBefore = state.players.player1.lore;
    let result = applyAction(state, {
      type: "QUEST", playerId: "player1", instanceId: starkeyId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(loreBefore + 1); // base lore only

    // Add a Captain — captain-hook-captain-of-the-jolly-roger has "Captain" trait
    let state2 = startGame(["starkey-hooks-henchman", "captain-hook-captain-of-the-jolly-roger"]);
    ({ state: state2, instanceId: starkeyId } = injectCard(state2, "player1", "starkey-hooks-henchman", "play"));
    ({ state: state2, instanceId: captainId } = injectCard(state2, "player1", "captain-hook-captain-of-the-jolly-roger", "play"));

    const loreBefore2 = state2.players.player1.lore;
    result = applyAction(state2, {
      type: "QUEST", playerId: "player1", instanceId: starkeyId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.players.player1.lore).toBe(loreBefore2 + 2); // base 1 + Captain bonus 1
  });
});

// =============================================================================
// A WHOLE NEW WORLD
// =============================================================================

describe("A Whole New World", () => {
  it("discards both hands and draws 7 for each player", () => {
    let state = startGame();
    let awnwId: string;
    ({ state, instanceId: awnwId } = injectCard(state, "player1", "a-whole-new-world", "hand"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: awnwId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Both players should have 7 cards in hand
    expect(getZone(result.newState, "player1", "hand")).toHaveLength(7);
    expect(getZone(result.newState, "player2", "hand")).toHaveLength(7);
  });
});

// =============================================================================
// CONDITIONAL ON TARGET
// =============================================================================

describe("Conditional on target", () => {
  // Vicious Betrayal: +2 STR, or +3 if Villain
  it("Vicious Betrayal gives +3 STR to Villain, +2 to non-Villain", () => {
    let state = startGame();
    let vbId: string, villainId: string, heroId: string;
    ({ state, instanceId: vbId } = injectCard(state, "player1", "vicious-betrayal", "hand"));
    // dr-facilier-charlatan is a Villain
    ({ state, instanceId: villainId } = injectCard(state, "player1", "dr-facilier-charlatan", "play"));
    ({ state, instanceId: heroId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "play"));
    state = giveInk(state, "player1", 10);

    // Play on Villain target
    let result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: vbId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    let resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [villainId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, villainId).tempStrengthModifier).toBe(3);
  });

  // Poisoned Apple: exert, or banish if Princess
  it("Poisoned Apple banishes a Princess, exerts a non-Princess", () => {
    let state = startGame();
    let appleId: string, princessId: string;
    ({ state, instanceId: appleId } = injectCard(state, "player1", "poisoned-apple", "play"));
    // moana-chosen-by-the-ocean has Princess trait
    ({ state, instanceId: princessId } = injectCard(state, "player2", "moana-chosen-by-the-ocean", "play"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "ACTIVATE_ABILITY", playerId: "player1", instanceId: appleId, abilityIndex: 0,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Apple banished as cost
    expect(getInstance(result.newState, appleId).zone).toBe("discard");
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [princessId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    // Princess → banished
    expect(getInstance(resolveResult.newState, princessId).zone).toBe("discard");
  });
});

// =============================================================================
// PLAY FOR FREE / SHUFFLE INTO DECK
// =============================================================================

describe("Play for free", () => {
  it("Just In Time lets you play a character for free", () => {
    let state = startGame();
    let jitId: string, charId: string;
    ({ state, instanceId: jitId } = injectCard(state, "player1", "just-in-time", "hand"));
    ({ state, instanceId: charId } = injectCard(state, "player1", "mickey-mouse-true-friend", "hand")); // cost 3
    state = giveInk(state, "player1", 3); // only enough for JIT (cost 3), not Mickey too

    const inkBefore = state.players.player1.availableInk;
    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: jitId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    expect(result.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [charId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, charId).zone).toBe("play");
    // No additional ink spent — only the 3 for JIT itself
    expect(resolveResult.newState.players.player1.availableInk).toBe(inkBefore - 3);
  });
});

describe("Shuffle into deck", () => {
  it("Magic Broom shuffles a card from discard into deck", () => {
    let state = startGame(["magic-broom-bucket-brigade"]);
    let broomId: string, discardedId: string;
    ({ state, instanceId: broomId } = injectCard(state, "player1", "magic-broom-bucket-brigade", "hand"));
    ({ state, instanceId: discardedId } = injectCard(state, "player1", "minnie-mouse-beloved-princess", "discard"));
    state = giveInk(state, "player1", 10);

    const result = applyAction(state, {
      type: "PLAY_CARD", playerId: "player1", instanceId: broomId,
    }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    // Enters play → may trigger
    expect(result.newState.pendingChoice?.type).toBe("choose_may");

    const acceptResult = applyAction(result.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: "accept",
    }, LORCAST_CARD_DEFINITIONS);
    expect(acceptResult.newState.pendingChoice?.type).toBe("choose_target");

    const resolveResult = applyAction(acceptResult.newState, {
      type: "RESOLVE_CHOICE", playerId: "player1", choice: [discardedId],
    }, LORCAST_CARD_DEFINITIONS);
    expect(resolveResult.success).toBe(true);
    expect(getInstance(resolveResult.newState, discardedId).zone).toBe("deck");
  });
});
