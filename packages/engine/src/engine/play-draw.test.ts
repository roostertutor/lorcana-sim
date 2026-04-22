// =============================================================================
// CRD 2.1.3.2 — PLAY-DRAW RULE
// Chooser (coin-flip winner / Bo3 loser) elects go-first-or-second before
// the mulligan phase begins. Mulligan (CRD 2.2.2) then runs starting-player-
// first regardless of player1/player2 slot.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, getAllLegalActions } from "./reducer.js";
import { createGame } from "./initializer.js";
import { CARD_DEFINITIONS, buildTestDeck } from "./test-helpers.js";
import type { GameAction } from "../types/index.js";

const TEST_DECK = buildTestDeck(["mickey-mouse-true-friend"]);
const TEST_SEED = 0xc0ffee;

function freshGame(chooserPlayerId?: "player1" | "player2") {
  return createGame(
    {
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      seed: TEST_SEED,
      ...(chooserPlayerId !== undefined ? { chooserPlayerId } : {}),
    },
    CARD_DEFINITIONS,
  );
}

describe("CRD 2.1.3.2 — play-draw rule", () => {
  it("initial state is in play_order_select phase with a choose_play_order pendingChoice (player1 default chooser)", () => {
    const state = freshGame();
    expect(state.phase).toBe("play_order_select");
    expect(state.pendingChoice?.type).toBe("choose_play_order");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
    // firstPlayerId MUST NOT be set yet — no one has chosen
    expect(state.firstPlayerId).toBeUndefined();
  });

  it("config.chooserPlayerId routes the choice to player2 (Bo3 game 2/3 path)", () => {
    const state = freshGame("player2");
    expect(state.phase).toBe("play_order_select");
    expect(state.pendingChoice?.type).toBe("choose_play_order");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player2");
  });

  it('chooser picks "first" → firstPlayerId and currentPlayer match the chooser; mulligan starts with chooser', () => {
    let state = freshGame();
    const result = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      CARD_DEFINITIONS,
    );
    expect(result.success).toBe(true);
    state = result.newState;

    expect(state.firstPlayerId).toBe("player1");
    expect(state.currentPlayer).toBe("player1");
    expect(state.phase).toBe("mulligan_p1");
    expect(state.pendingChoice?.type).toBe("choose_mulligan");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
  });

  it('chooser picks "second" → firstPlayerId is the OPPONENT; mulligan starts with the opponent', () => {
    let state = freshGame();
    const result = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "second" },
      CARD_DEFINITIONS,
    );
    expect(result.success).toBe(true);
    state = result.newState;

    expect(state.firstPlayerId).toBe("player2");
    expect(state.currentPlayer).toBe("player2");
    expect(state.phase).toBe("mulligan_p1");
    expect(state.pendingChoice?.type).toBe("choose_mulligan");
    // CRD 2.2.2: mulligan starts with the starting player — now player2
    expect(state.pendingChoice?.choosingPlayerId).toBe("player2");
  });

  it('chooserPlayerId="player2" + choose "second" → player1 becomes starting player and mulligans first', () => {
    let state = freshGame("player2");
    const result = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: "second" },
      CARD_DEFINITIONS,
    );
    expect(result.success).toBe(true);
    state = result.newState;

    expect(state.firstPlayerId).toBe("player1");
    expect(state.currentPlayer).toBe("player1");
    expect(state.phase).toBe("mulligan_p1");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
  });

  it("mulligans proceed starting-player-first even when player2 is starting; then transition to main", () => {
    // player1 chooses "second" → player2 is starting player
    let state = freshGame();
    state = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "second" },
      CARD_DEFINITIONS,
    ).newState;

    // player2 (starting) mulligans first
    expect(state.phase).toBe("mulligan_p1");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player2");
    state = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: [] },
      CARD_DEFINITIONS,
    ).newState;

    // Now player1 (non-starting) mulligans
    expect(state.phase).toBe("mulligan_p2");
    expect(state.pendingChoice?.choosingPlayerId).toBe("player1");
    state = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] },
      CARD_DEFINITIONS,
    ).newState;

    // Both done — main phase
    expect(state.phase).toBe("main");
    expect(state.pendingChoice).toBeNull();
    expect(state.currentPlayer).toBe("player2");
    expect(state.firstPlayerId).toBe("player2");
  });

  it("getAllLegalActions during play_order_select returns [] (only RESOLVE_CHOICE is legal; enumerator routes via pendingChoice)", () => {
    // The getAllLegalActions contract (reducer.ts:253) is to return [] when a
    // pendingChoice is set, so bots route through their choice resolver
    // instead. Verify both players see exactly this during play_order_select.
    const state = freshGame();
    expect(getAllLegalActions(state, "player1", CARD_DEFINITIONS)).toEqual([]);
    expect(getAllLegalActions(state, "player2", CARD_DEFINITIONS)).toEqual([]);
  });

  it("no non-RESOLVE_CHOICE action is legal during play_order_select (validator parity with getAllLegalActions)", () => {
    // Pair with the getAllLegalActions test per CLAUDE.md rule: validateX
    // rejection must be paired with a getAllLegalActions test showing the
    // action is enumerated neither for player1 nor for player2.
    const state = freshGame();
    const candidates: GameAction[] = [
      { type: "PASS_TURN", playerId: "player1" },
      { type: "PLAY_INK", playerId: "player1", instanceId: state.zones.player1.hand[0]! },
      { type: "PLAY_CARD", playerId: "player1", instanceId: state.zones.player1.hand[0]! },
      { type: "QUEST", playerId: "player1", instanceId: state.zones.player1.hand[0]! },
    ];
    for (const action of candidates) {
      const res = applyAction(state, action, CARD_DEFINITIONS);
      expect(res.success, `${action.type} must be rejected during play_order_select`).toBe(false);
    }
  });

  it("only the chooser can resolve the play-order choice", () => {
    const state = freshGame();
    const wrongPlayer = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player2", choice: "first" },
      CARD_DEFINITIONS,
    );
    expect(wrongPlayer.success).toBe(false);
  });

  it("invalid play-order values are rejected", () => {
    const state = freshGame();
    const badString = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "neither" },
      CARD_DEFINITIONS,
    );
    expect(badString.success).toBe(false);
    const badArray = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: [] },
      CARD_DEFINITIONS,
    );
    expect(badArray.success).toBe(false);
  });

  it("choose_mulligan pendingChoice only appears AFTER play_order resolves (not simultaneously)", () => {
    // Fresh game: pendingChoice is choose_play_order, NOT choose_mulligan.
    const state = freshGame();
    expect(state.pendingChoice?.type).toBe("choose_play_order");
    expect(state.pendingChoice?.type).not.toBe("choose_mulligan");

    // After resolving play-order, THEN we see choose_mulligan.
    const next = applyAction(
      state,
      { type: "RESOLVE_CHOICE", playerId: "player1", choice: "first" },
      CARD_DEFINITIONS,
    ).newState;
    expect(next.pendingChoice?.type).toBe("choose_mulligan");
  });
});
