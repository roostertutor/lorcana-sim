// =============================================================================
// RUN GAME
// Runs a single complete game between two bots. Tracks per-card stats.
// =============================================================================

import type { GameAction, GameState, PlayerID } from "@lorcana-sim/engine";
import { applyAction, createGame, getEffectiveLore, getZone } from "@lorcana-sim/engine";
import type { CardGameStats, GameResult, SimGameConfig } from "./types.js";
import { shouldMulligan, performMulligan } from "./mulligan.js";

const DEFAULT_MAX_TURNS = 120;

// -----------------------------------------------------------------------------
// STATS TRACKING
// -----------------------------------------------------------------------------

function ensureStats(
  statsMap: Map<string, CardGameStats>,
  instanceId: string,
  definitionId: string
): CardGameStats {
  if (!statsMap.has(instanceId)) {
    statsMap.set(instanceId, {
      instanceId,
      definitionId,
      turnsInPlay: 0,
      timesQuested: 0,
      timesChallenged: 0,
      damageDealt: 0,
      loreContributed: 0,
      wasBanished: false,
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
    const stats = ensureStats(statsMap, action.instanceId, instance.definitionId);
    stats.timesQuested++;
    stats.loreContributed += getEffectiveLore(instance, def);
  }

  if (action.type === "CHALLENGE") {
    const defender = state.cards[action.defenderInstanceId];
    if (defender) {
      ensureStats(statsMap, action.defenderInstanceId, defender.definitionId).timesChallenged++;
    }
  }

  // Increment turnsInPlay for all characters in play at the start of each player's turn
  if (action.type === "PASS_TURN") {
    for (const pid of ["player1", "player2"] as const) {
      for (const instanceId of getZone(state, pid, "play")) {
        const inst = state.cards[instanceId];
        if (inst) ensureStats(statsMap, instanceId, inst.definitionId).turnsInPlay++;
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
        ensureStats(statsMap, event.instanceId, instance.definitionId).wasBanished = true;
      }
    }
  }

  // Attribute damage dealt in a challenge
  if (action.type === "CHALLENGE") {
    const attackerId = action.attackerInstanceId;
    const defenderId = action.defenderInstanceId;
    for (const event of events) {
      if (event.type !== "damage_dealt") continue;
      // If defender received damage, attacker dealt it
      if (event.instanceId === defenderId) {
        const attInst = preState.cards[attackerId];
        if (attInst) ensureStats(statsMap, attackerId, attInst.definitionId).damageDealt += event.amount;
      }
      // If attacker received damage, defender dealt it
      if (event.instanceId === attackerId) {
        const defInst = preState.cards[defenderId];
        if (defInst) ensureStats(statsMap, defenderId, defInst.definitionId).damageDealt += event.amount;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// MAIN FUNCTION
// -----------------------------------------------------------------------------

export function runGame(config: SimGameConfig): GameResult {
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;

  let state: GameState = config.startingState ?? createGame(
    {
      player1Deck: config.player1Deck,
      player2Deck: config.player2Deck,
    },
    config.definitions
  );

  // CRD 2.2.2: Mulligan (pre-game, skipped for injected startingState)
  if (!config.startingState) {
    for (const playerId of ["player1", "player2"] as const) {
      const bot = playerId === "player1" ? config.player1Strategy : config.player2Strategy;
      if (bot.name === "random") continue; // RandomBot skips mulligan
      if (shouldMulligan(state, playerId, config.definitions, config.mulliganThresholds)) {
        state = performMulligan(state, playerId);
      }
    }
  }

  const statsMap = new Map<string, CardGameStats>();

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
    } catch {
      // Bot threw — force a pass to keep the game moving
      action = { type: "PASS_TURN", playerId: state.currentPlayer };
    }

    updateStatsPreAction(state, action, statsMap, config.definitions);

    const result = applyAction(state, action, config.definitions);

    if (!result.success) {
      // Bot returned an illegal action — force pass as safety
      const passResult = applyAction(
        state,
        { type: "PASS_TURN", playerId: state.currentPlayer },
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
    const p1Lore = state.players.player1.lore;
    const p2Lore = state.players.player2.lore;
    if (p1Lore > p2Lore) winner = "player1";
    else if (p2Lore > p1Lore) winner = "player2";
    else winner = "draw";
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
    cardStats: Object.fromEntries(statsMap),
    botLabels: {
      player1: config.player1Strategy.name,
      player2: config.player2Strategy.name,
    },
    botType: config.player1Strategy.type,
  };
}
