// =============================================================================
// SHARED TEST HELPERS
// Used by reducer.test.ts (CRD rules), set1.test.ts, set2.test.ts, etc.
// =============================================================================

import { expect } from "vitest";
import { applyAction } from "../engine/reducer.js";
import { createGame } from "../engine/initializer.js";
import { LORCAST_CARD_DEFINITIONS } from "../cards/lorcastCards.js";
import { generateId, getZone } from "../utils/index.js";
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

export { LORCAST_CARD_DEFINITIONS };

export function buildTestDeck(cardIds: string[], fillerId = "minnie-mouse-beloved-princess"): DeckEntry[] {
  const entries: DeckEntry[] = cardIds.map((id) => ({ definitionId: id, count: 4 }));
  const fillerCount = 60 - cardIds.length * 4;
  if (fillerCount > 0) entries.push({ definitionId: fillerId, count: fillerCount });
  return entries;
}

export function startGame(
  p1Cards: string[] = ["mickey-mouse-true-friend"],
  p2Cards: string[] = ["mickey-mouse-true-friend"]
): GameState {
  let state = createGame(
    { player1Deck: buildTestDeck(p1Cards), player2Deck: buildTestDeck(p2Cards) },
    LORCAST_CARD_DEFINITIONS
  );
  state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] }, LORCAST_CARD_DEFINITIONS).newState;
  state = applyAction(state, { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] }, LORCAST_CARD_DEFINITIONS).newState;
  return state;
}

export function injectCard(
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

export function giveInk(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], availableInk: amount },
    },
  };
}

export function setLore(state: GameState, playerId: "player1" | "player2", amount: number): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...state.players[playerId], lore: amount },
    },
  };
}

export function passTurns(state: GameState, count: number): GameState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const result = applyAction(s, { type: "PASS_TURN", playerId: s.currentPlayer }, LORCAST_CARD_DEFINITIONS);
    expect(result.success).toBe(true);
    s = result.newState;
  }
  return s;
}

export function emptyDeck(state: GameState, playerId: "player1" | "player2"): GameState {
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
