// =============================================================================
// RUN GAME
// Runs a single complete game between two bots. Tracks per-card stats.
// =============================================================================

import type { GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { applyAction, createGame, getEffectiveLore, getZone } from "@lorcana-sim/engine";
import type { CardGameStats, GameResult, SimGameConfig } from "./types.js";

const DEFAULT_MAX_TURNS = 120;

// -----------------------------------------------------------------------------
// STATS TRACKING
// -----------------------------------------------------------------------------

function ensureStats(
  statsMap: Map<string, CardGameStats>,
  instanceId: string,
  definitionId: string,
  ownerId: PlayerID
): CardGameStats {
  if (!statsMap.has(instanceId)) {
    statsMap.set(instanceId, {
      instanceId,
      definitionId,
      ownerId,
      drawnOnTurn: null,
      playedOnTurn: null,
      inkedOnTurn: null,
      inPlayOnTurns: [],
      inkAvailableWhenPlayed: null,
      wasShifted: false,
      wasPlayed: false,
      wasBanished: false,
      loreContributed: 0,
      timesQuested: 0,
      timesChallenged: 0,
    });
  }
  return statsMap.get(instanceId)!;
}

function updateStatsPreAction(
  state: GameState,
  action: GameAction,
  statsMap: Map<string, CardGameStats>,
  definitions: SimGameConfig["definitions"]
): void {
  if (action.type === "QUEST") {
    const instance = state.cards[action.instanceId];
    if (!instance) return;
    const def = definitions[instance.definitionId];
    if (!def) return;
    const stats = ensureStats(statsMap, action.instanceId, instance.definitionId, instance.ownerId);
    stats.timesQuested++;
    stats.loreContributed += getEffectiveLore(instance, def);
  }

  if (action.type === "CHALLENGE") {
    const defender = state.cards[action.defenderInstanceId];
    if (defender) {
      ensureStats(statsMap, action.defenderInstanceId, defender.definitionId, defender.ownerId).timesChallenged++;
    }
  }

  // Track when a card is played
  if (action.type === "PLAY_CARD") {
    const instance = state.cards[action.instanceId];
    if (instance) {
      const stats = ensureStats(statsMap, action.instanceId, instance.definitionId, instance.ownerId);
      stats.playedOnTurn = state.turnNumber;
      stats.wasPlayed = true;
      stats.inkAvailableWhenPlayed = state.players[instance.ownerId].availableInk;
      stats.wasShifted = !!action.shiftTargetInstanceId;
    }
  }

  // Track when a card is inked
  if (action.type === "PLAY_INK") {
    const instance = state.cards[action.instanceId];
    if (instance) {
      const stats = ensureStats(statsMap, action.instanceId, instance.definitionId, instance.ownerId);
      stats.inkedOnTurn = state.turnNumber;
    }
  }

  // Track inPlayOnTurns for all cards in play at each turn boundary
  if (action.type === "PASS_TURN") {
    for (const pid of ["player1", "player2"] as const) {
      for (const instanceId of getZone(state, pid, "play")) {
        const inst = state.cards[instanceId];
        if (inst) {
          ensureStats(statsMap, instanceId, inst.definitionId, inst.ownerId).inPlayOnTurns.push(state.turnNumber);
        }
      }
    }
  }
}

function updateStatsPostAction(
  preState: GameState,
  action: GameAction,
  events: ReturnType<typeof applyAction>["events"],
  statsMap: Map<string, CardGameStats>,
  postState: GameState
): void {
  // Mark banished cards
  for (const event of events) {
    if (event.type === "card_banished") {
      const instance = postState.cards[event.instanceId] ?? preState.cards[event.instanceId];
      if (instance) {
        ensureStats(statsMap, event.instanceId, instance.definitionId, instance.ownerId).wasBanished = true;
      }
    }

    // Track drawnOnTurn via card_drawn events
    if (event.type === "card_drawn") {
      const instance = postState.cards[event.instanceId] ?? preState.cards[event.instanceId];
      if (instance) {
        const stats = ensureStats(statsMap, event.instanceId, instance.definitionId, instance.ownerId);
        if (stats.drawnOnTurn === null) {
          stats.drawnOnTurn = preState.turnNumber;
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------
// MAIN FUNCTION
// -----------------------------------------------------------------------------

export function runGame(config: SimGameConfig): GameResult {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const seed = config.seed ?? Date.now();

  let state: GameState = config.startingState ?? createGame(
    {
      player1Deck: config.player1Deck,
      player2Deck: config.player2Deck,
      seed,
    },
    config.definitions
  );

  const actions: GameAction[] = [];

  // CRD 2.2.2: Mulligan is now handled by the engine via choose_mulligan pendingChoice.
  // Bots handle it through decideAction like any other pending choice.

  const statsMap = new Map<string, CardGameStats>();
  const inkByTurn: Record<PlayerID, number[]> = { player1: [], player2: [] };
  const loreByTurn: Record<PlayerID, number[]> = { player1: [], player2: [] };

  // Mark cards in starting hand as drawn on turn 1
  for (const pid of ["player1", "player2"] as const) {
    for (const instanceId of getZone(state, pid, "hand")) {
      const inst = state.cards[instanceId];
      if (inst) {
        ensureStats(statsMap, instanceId, inst.definitionId, inst.ownerId).drawnOnTurn = 1;
      }
    }
  }

  while (!state.isGameOver && state.turnNumber <= maxTurns) {
    // When a choice is pending, the choosing player's bot resolves it
    const activePlayerId: PlayerID = state.pendingChoice
      ? state.pendingChoice.choosingPlayerId
      : state.currentPlayer;

    const bot =
      activePlayerId === "player1" ? config.player1Strategy : config.player2Strategy;

    let action: GameAction;
    try {
      action = bot.decideAction(state, activePlayerId, config.definitions);
    } catch (err) {
      // Bot threw — force a pass to keep the game moving
      console.warn("[simulator] bot.decideAction threw:", err);
      action = { type: "PASS_TURN", playerId: state.currentPlayer };
    }

    updateStatsPreAction(state, action, statsMap, config.definitions);

    actions.push(action);
    const result = applyAction(state, action, config.definitions);

    if (!result.success) {
      // Bot returned an illegal action — replace with pass in action log
      const passAction: GameAction = { type: "PASS_TURN", playerId: state.currentPlayer };
      actions[actions.length - 1] = passAction;
      const passResult = applyAction(
        state,
        passAction,
        config.definitions
      );
      if (passResult.success) {
        updateStatsPostAction(state, action, passResult.events, statsMap, passResult.newState);
        state = passResult.newState;
      } else {
        break; // Should never happen
      }
    } else {
      updateStatsPostAction(state, action, result.events, statsMap, result.newState);
      state = result.newState;

      // Track ink/lore snapshots at turn boundaries
      if (action.type === "PASS_TURN") {
        for (const pid of ["player1", "player2"] as const) {
          inkByTurn[pid].push(state.players[pid].availableInk);
          loreByTurn[pid].push(state.players[pid].lore);
        }
      }
    }
  }

  // Determine final outcome
  let winner: PlayerID | "draw";
  let winReason: GameResult["winReason"];

  if (state.isGameOver && state.winner) {
    winner = state.winner;
    // Determine reason: if the loser's deck is empty, it's deck exhaustion
    const loser = winner === "player1" ? "player2" : "player1";
    const loserDeck = getZone(state, loser as PlayerID, "deck");
    winReason = loserDeck.length === 0 ? "deck_exhausted" : "lore_threshold";
  } else if (state.turnNumber > maxTurns) {
    // CRD 1.8.1.1: Game is won by reaching lore threshold, not by having more lore.
    // If max turns exceeded without a winner, it's a draw.
    winner = "draw";
    winReason = "max_turns_exceeded";
  } else {
    winner = "draw";
    winReason = "deck_exhausted";
  }

  return {
    winner,
    winReason,
    turns: state.turnNumber,
    finalLore: {
      player1: state.players.player1.lore,
      player2: state.players.player2.lore,
    },
    actionLog: state.actionLog,
    actions,
    seed,
    cardStats: Object.fromEntries(statsMap),
    inkByTurn,
    loreByTurn,
    botLabels: {
      player1: config.player1Strategy.name,
      player2: config.player2Strategy.name,
    },
    botType: config.player1Strategy.type,
    mulliganed: deriveMulliganed(actions),
  };
}

// -----------------------------------------------------------------------------
// MULLIGAN DERIVATION
// -----------------------------------------------------------------------------

/**
 * Derive `mulliganed: Record<PlayerID, boolean>` from the canonical action
 * stream rather than parsing log prose. See docs/STREAMS.md — the actionLog
 * is paraphrased English and treating it as structured data was a known
 * coupling bug (P1.7 in the 2026-04-28 audit).
 *
 * The mulligan response is the FIRST `RESOLVE_CHOICE` per player whose `choice`
 * is an array (`choose_mulligan` is the only pendingChoice that surfaces before
 * any in-game choice and uses the array-of-instanceIds shape; `choose_play_order`
 * comes earlier but uses a plain string `"first"`/`"second"`). An empty array
 * means the player kept their hand → `false`. A non-empty array means they put
 * cards back → `true`.
 *
 * Edge cases:
 *  - `startingState` injection bypasses createGame and the mulligan flow
 *    entirely; no `RESOLVE_CHOICE` with array shape will appear → both `false`.
 *  - Games that end before the second mulligan (shouldn't happen, but defensive)
 *    leave the unresolved player at `false`.
 */
export function deriveMulliganed(actions: GameAction[]): Record<PlayerID, boolean> {
  const result: Record<PlayerID, boolean> = { player1: false, player2: false };
  const seen: Record<PlayerID, boolean> = { player1: false, player2: false };
  for (const action of actions) {
    if (action.type !== "RESOLVE_CHOICE") continue;
    if (!Array.isArray(action.choice)) continue;
    const pid = action.playerId;
    if (seen[pid]) continue;
    seen[pid] = true;
    result[pid] = action.choice.length > 0;
    if (seen.player1 && seen.player2) break;
  }
  return result;
}
