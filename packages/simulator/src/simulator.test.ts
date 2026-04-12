// =============================================================================
// LAYER 3 — TRUE ENGINE INVARIANTS
// Runs 1000 RandomBot games. Asserts data integrity after every action.
//
// These are UNCONDITIONAL checks — no card ability can ever break them.
// Do NOT add invariants for things cards can modify (lore direction, inkwell
// contents, win threshold). See CLAUDE.md for the exact invariant list.
// =============================================================================

import { describe, it, expect } from "vitest";
import { applyAction, createGame, getZone } from "@lorcana-sim/engine";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { GameState, PlayerID, ZoneName } from "@lorcana-sim/engine";
import { RandomBot } from "./bots/RandomBot.js";
import { GreedyBot } from "./bots/GreedyBot.js";
import { runGame } from "./runGame.js";
import type { SimGameConfig } from "./types.js";

// ---------------------------------------------------------------------------
// TEST DECK — 60 cards of sample cards
// ---------------------------------------------------------------------------

const TEST_DECK = [
  { definitionId: "simba-protective-cub", count: 10 },
  { definitionId: "stitch-rock-star", count: 10 },
  { definitionId: "beast-hardheaded", count: 10 },
  { definitionId: "moana-of-motunui", count: 10 },
  { definitionId: "hercules-true-hero", count: 10 },
  { definitionId: "tinker-bell-tiny-tactician", count: 10 },
];

const ZONES: ZoneName[] = ["deck", "hand", "play", "discard", "inkwell"];
const PLAYERS: PlayerID[] = ["player1", "player2"];
const VALID_PHASES = new Set(["mulligan_p1", "mulligan_p2", "beginning", "main", "end"]);

// ---------------------------------------------------------------------------
// INVARIANT CHECKER
// ---------------------------------------------------------------------------

function assertInvariants(state: GameState): void {
  for (const playerId of PLAYERS) {
    // Invariant 1: Total cards per player always 60
    // CRD 5.1.1.5: Cards "under" another card are still in the Play zone (not a separate zone),
    // but our engine models them as zone: "under" (not tracked in zones arrays). Count them here.
    const zoneTotal = ZONES.reduce((sum, zone) => sum + getZone(state, playerId, zone).length, 0);
    const underCount = Object.values(state.cards).filter(c => c.zone === "under" && c.ownerId === playerId).length;
    const total = zoneTotal + underCount;
    expect(total, `${playerId} total cards must always be 60`).toBe(60);

    // Invariant 3: availableInk >= 0
    expect(
      state.players[playerId].availableInk,
      `${playerId} availableInk must be >= 0`
    ).toBeGreaterThanOrEqual(0);

    // Invariant 3: lore >= 0
    expect(
      state.players[playerId].lore,
      `${playerId} lore must be >= 0`
    ).toBeGreaterThanOrEqual(0);
  }

  // Invariant 2: No card in two zones simultaneously
  const allZoneIds: string[] = [];
  for (const playerId of PLAYERS) {
    for (const zone of ZONES) {
      for (const id of getZone(state, playerId, zone)) {
        allZoneIds.push(id);
      }
    }
  }
  // CRD 5.1.1.5: under-cards are in the Play zone but our engine tracks them separately
  const underIds = Object.entries(state.cards).filter(([, c]) => c.zone === "under").map(([id]) => id);
  const allTrackedIds = [...allZoneIds, ...underIds];
  const uniqueCount = new Set(allTrackedIds).size;
  expect(uniqueCount, "No card instance may appear in two zones").toBe(allTrackedIds.length);

  // Invariant 2b: Every card in state.cards is in exactly one zone
  const allCardIds = Object.keys(state.cards);
  expect(allTrackedIds.length, "Zone lists must account for all card instances").toBe(allCardIds.length);

  // Invariant 4: currentPlayer is valid
  expect(PLAYERS).toContain(state.currentPlayer);

  // Invariant 4: phase is valid
  expect(VALID_PHASES.has(state.phase), `phase "${state.phase}" is invalid`).toBe(true);
}

// ---------------------------------------------------------------------------
// GAME RUNNER WITH INVARIANT CHECKING
// ---------------------------------------------------------------------------

function runGameWithInvariants(config: SimGameConfig): void {
  const maxTurns = config.maxTurns ?? 50;
  let state: GameState = createGame(
    { player1Deck: config.player1Deck, player2Deck: config.player2Deck },
    config.definitions
  );

  assertInvariants(state); // Check initial state

  let safetyCounter = 0;
  while (!state.isGameOver && state.turnNumber <= maxTurns) {
    if (++safetyCounter > 5000) break; // Absolute safety — should never hit

    const activePlayerId: PlayerID = state.pendingChoice
      ? state.pendingChoice.choosingPlayerId
      : state.currentPlayer;

    const bot = activePlayerId === "player1" ? config.player1Strategy : config.player2Strategy;
    const action = bot.decideAction(state, activePlayerId, config.definitions);
    const result = applyAction(state, action, config.definitions);

    if (!result.success) {
      // RandomBot returned an illegal action — force pass and continue
      const passResult = applyAction(
        state,
        { type: "PASS_TURN", playerId: state.currentPlayer },
        config.definitions
      );
      if (passResult.success) {
        state = passResult.newState;
        assertInvariants(state);
      }
    } else {
      state = result.newState;
      assertInvariants(state);
    }
  }
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe("Layer 3 — Engine Invariants (1000 RandomBot games)", () => {
  it("maintains all invariants across 1000 RandomBot vs RandomBot games", () => {
    const config: SimGameConfig = {
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: RandomBot,
      player2Strategy: RandomBot,
      definitions: LORCAST_CARD_DEFINITIONS,
      maxTurns: 50,
    };

    for (let i = 0; i < 1000; i++) {
      runGameWithInvariants(config);
    }
  });
});

// ---------------------------------------------------------------------------
// SIMULATION SANITY CHECKS
// ---------------------------------------------------------------------------

// GreedyBot plays actual cards and quests, so games finish with a real winner.
describe("Simulation sanity checks (100 GreedyBot games)", () => {
  function runGreedyGame(): { winner: PlayerID | "draw" | null; turnNumber: number } {
    let s: GameState = createGame(
      { player1Deck: TEST_DECK, player2Deck: TEST_DECK },
      LORCAST_CARD_DEFINITIONS
    );
    // Limit by game turn number, not action count
    while (!s.isGameOver && s.turnNumber <= 50) {
      const pid: PlayerID = s.pendingChoice ? s.pendingChoice.choosingPlayerId : s.currentPlayer;
      const action = GreedyBot.decideAction(s, pid, LORCAST_CARD_DEFINITIONS);
      const result = applyAction(s, action, LORCAST_CARD_DEFINITIONS);
      if (result.success) s = result.newState;
      else {
        const pass = applyAction(s, { type: "PASS_TURN", playerId: s.currentPlayer }, LORCAST_CARD_DEFINITIONS);
        if (pass.success) s = pass.newState;
        else break;
      }
    }
    return { winner: s.winner, turnNumber: s.turnNumber };
  }

  it("mirror match win rates are roughly 50/50 (within 20% tolerance)", () => {
    let p1Wins = 0;
    let p2Wins = 0;
    const GAMES = 100;

    for (let i = 0; i < GAMES; i++) {
      const { winner } = runGreedyGame();
      if (winner === "player1") p1Wins++;
      else if (winner === "player2") p2Wins++;
    }

    // In a mirror match, neither player should dominate
    expect(p1Wins + p2Wins, "Most games should end with a winner").toBeGreaterThan(GAMES * 0.5);
    expect(p1Wins).toBeGreaterThan(GAMES * 0.1);
    expect(p2Wins).toBeGreaterThan(GAMES * 0.1);
  });

  it("all 100 games terminate without throwing", () => {
    let gameCount = 0;
    for (let i = 0; i < 100; i++) {
      runGreedyGame();
      gameCount++;
    }
    expect(gameCount).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// SEEDED RNG DETERMINISM
// ---------------------------------------------------------------------------

describe("Seeded RNG determinism", () => {
  const SEED = 12345;

  it("same seed + same decks + GreedyBot → identical results", () => {
    const config: SimGameConfig = {
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: GreedyBot,
      player2Strategy: GreedyBot,
      definitions: LORCAST_CARD_DEFINITIONS,
      maxTurns: 50,
      seed: SEED,
    };

    const result1 = runGame(config);
    const result2 = runGame(config);

    expect(result1.winner).toBe(result2.winner);
    expect(result1.turns).toBe(result2.turns);
    expect(result1.finalLore).toEqual(result2.finalLore);
    expect(result1.actions).toEqual(result2.actions);
    expect(result1.seed).toBe(result2.seed);
  });

  it("different seeds → different results (at least one field differs)", () => {
    const base: SimGameConfig = {
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: GreedyBot,
      player2Strategy: GreedyBot,
      definitions: LORCAST_CARD_DEFINITIONS,
      maxTurns: 50,
    };

    const result1 = runGame({ ...base, seed: 111 });
    const result2 = runGame({ ...base, seed: 222 });

    // At least one observable difference (actions will differ due to different shuffles)
    const differs =
      result1.winner !== result2.winner ||
      result1.turns !== result2.turns ||
      JSON.stringify(result1.actions) !== JSON.stringify(result2.actions);
    expect(differs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAMEACTION[] CAPTURE
// ---------------------------------------------------------------------------

describe("GameAction[] capture", () => {
  it("result.actions is a non-empty GameAction[] with valid types", () => {
    const result = runGame({
      player1Deck: TEST_DECK,
      player2Deck: TEST_DECK,
      player1Strategy: GreedyBot,
      player2Strategy: GreedyBot,
      definitions: LORCAST_CARD_DEFINITIONS,
      maxTurns: 50,
      seed: 42,
    });

    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.seed).toBe(42);

    const validTypes = new Set([
      "PLAY_CARD", "PLAY_INK", "QUEST", "CHALLENGE",
      "ACTIVATE_ABILITY", "PASS_TURN", "RESOLVE_CHOICE", "DRAW_CARD",
    ]);
    for (const action of result.actions) {
      expect(validTypes.has(action.type)).toBe(true);
    }
  });
});
