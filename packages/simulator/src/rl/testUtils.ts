// =============================================================================
// RL TEST UTILITIES — Shared helpers for RL learning tests
// =============================================================================

import type { DeckEntry } from "@lorcana-sim/engine";
import type { CardDefinition } from "@lorcana-sim/engine";
import { runGame } from "../runGame.js";
import { RandomBot } from "../bots/RandomBot.js";
import { RLPolicy } from "./policy.js";

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

export interface CardActionStats {
  inked: number;
  played: number;
  quested: number;
}

export interface TraceResult {
  lore: number;
  turns: number;
  winner: string | null;
  cardStats: Record<string, CardActionStats>;
}

export interface AggregateResult {
  avgLore: number;
  /** Per-definitionId aggregated stats */
  cardStats: Record<string, CardActionStats>;
  /** Per-definitionId: play / (play + ink) */
  playRates: Record<string, number>;
  /** Per-definitionId: ink / (play + ink) */
  inkRates: Record<string, number>;
}

// -----------------------------------------------------------------------------
// TRACE GAME
// -----------------------------------------------------------------------------

/**
 * Play one game with the policy (ε=0) and track per-card action stats.
 */
export function traceGame(
  policy: RLPolicy,
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  seed: number,
  maxTurns = 15
): TraceResult {
  const savedEpsilon = policy.epsilon;
  policy.epsilon = 0;
  policy.clearHistory();

  const result = runGame({
    player1Deck: deck,
    player2Deck: deck,
    player1Strategy: policy,
    player2Strategy: RandomBot,
    definitions,
    maxTurns,
    seed,
  });

  policy.epsilon = savedEpsilon;
  policy.clearHistory();

  // Count card-specific actions for player1
  const cardStats: Record<string, CardActionStats> = {};

  function ensure(defId: string): CardActionStats {
    if (!cardStats[defId]) cardStats[defId] = { inked: 0, played: 0, quested: 0 };
    return cardStats[defId]!;
  }

  for (const action of result.actions) {
    if (action.playerId !== "player1") continue;

    if (action.type === "PLAY_INK") {
      const inst = result.cardStats[action.instanceId];
      if (inst) ensure(inst.definitionId).inked++;
    }
    if (action.type === "PLAY_CARD") {
      const inst = result.cardStats[action.instanceId];
      if (inst) ensure(inst.definitionId).played++;
    }
    if (action.type === "QUEST") {
      const inst = result.cardStats[action.instanceId];
      if (inst) ensure(inst.definitionId).quested++;
    }
  }

  return {
    lore: result.finalLore["player1"] ?? 0,
    turns: result.turns,
    winner: result.winner,
    cardStats,
  };
}

// -----------------------------------------------------------------------------
// AGGREGATE TRACES
// -----------------------------------------------------------------------------

/**
 * Run N traced games and aggregate per-card stats.
 */
export function aggregateTraces(
  policy: RLPolicy,
  deck: DeckEntry[],
  definitions: Record<string, CardDefinition>,
  count: number,
  seedStart: number,
  maxTurns = 15
): AggregateResult {
  const totals: Record<string, CardActionStats> = {};
  let totalLore = 0;

  function ensure(defId: string): CardActionStats {
    if (!totals[defId]) totals[defId] = { inked: 0, played: 0, quested: 0 };
    return totals[defId]!;
  }

  for (let i = 0; i < count; i++) {
    const t = traceGame(policy, deck, definitions, seedStart + i, maxTurns);
    totalLore += t.lore;

    for (const [defId, stats] of Object.entries(t.cardStats)) {
      const agg = ensure(defId);
      agg.inked += stats.inked;
      agg.played += stats.played;
      agg.quested += stats.quested;
    }
  }

  const playRates: Record<string, number> = {};
  const inkRates: Record<string, number> = {};
  for (const [defId, stats] of Object.entries(totals)) {
    const total = stats.played + stats.inked;
    playRates[defId] = total > 0 ? stats.played / total : 0;
    inkRates[defId] = total > 0 ? stats.inked / total : 0;
  }

  return {
    avgLore: totalLore / count,
    cardStats: totals,
    playRates,
    inkRates,
  };
}
