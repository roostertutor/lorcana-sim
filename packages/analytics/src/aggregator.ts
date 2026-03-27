// =============================================================================
// AGGREGATOR
// Turns an array of GameResults into DeckStats + CardPerformance.
// Caller provides results for one deck (player1 is always the deck under test).
// aggregateResults() throws if called with mixed BotTypes.
// =============================================================================

import type { GameResult } from "@lorcana-sim/simulator";
import type { DeckStats, CardPerformance } from "./types.js";

export function aggregateResults(results: GameResult[]): DeckStats {
  if (results.length === 0) {
    throw new Error("aggregateResults: results array is empty");
  }

  // Enforce uniform bot type
  const botType = results[0]!.botType;
  for (const r of results) {
    if (r.botType !== botType) {
      throw new Error(
        `aggregateResults: mixed BotTypes — found "${r.botType}" and "${botType}". ` +
          "Never aggregate results across bot types."
      );
    }
  }

  const botLabel = results[0]!.botLabels["player1"];

  let wins = 0;
  let draws = 0;
  let firstPlayerWins = 0;
  let firstPlayerGames = 0; // All games — player1 always goes first in our sims
  let totalTurns = 0;
  let winTurnSum = 0;
  let winTurnCount = 0;

  // Per-definition accumulators
  const defAccum: Record<
    string,
    {
      gamesDrawn: number;
      gamesNotDrawn: number;
      winsDrawn: number;
      winsNotDrawn: number;
      totalLore: number;
      totalQuests: number;
      totalBanished: number;
      totalTurnsToPlay: number;
      countPlayedInstances: number;
      totalCopiesDrawn: number;
    }
  > = {};

  function ensureDef(id: string) {
    if (!defAccum[id]) {
      defAccum[id] = {
        gamesDrawn: 0,
        gamesNotDrawn: 0,
        winsDrawn: 0,
        winsNotDrawn: 0,
        totalLore: 0,
        totalQuests: 0,
        totalBanished: 0,
        totalTurnsToPlay: 0,
        countPlayedInstances: 0,
        totalCopiesDrawn: 0,
      };
    }
    return defAccum[id]!;
  }

  for (const result of results) {
    const p1Won = result.winner === "player1";
    const isDraw = result.winner === "draw";

    if (p1Won) wins++;
    if (isDraw) draws++;
    totalTurns += result.turns;

    // First-player win rate (player1 always goes first)
    firstPlayerGames++;
    if (p1Won) firstPlayerWins++;

    if (p1Won || isDraw === false) {
      winTurnSum += result.turns;
      winTurnCount++;
    }

    // Collect which definitionIds player1 drew this game
    const drawnDefs = new Set<string>();

    for (const stats of Object.values(result.cardStats)) {
      // Only track player1's cards for per-card performance
      if (stats.ownerId !== "player1") continue;

      const a = ensureDef(stats.definitionId);
      a.totalLore += stats.loreContributed;
      a.totalQuests += stats.timesQuested;
      if (stats.wasBanished) a.totalBanished++;

      // Use enriched fields for accurate detection
      if (stats.wasPlayed) {
        a.countPlayedInstances++;
        a.totalTurnsToPlay += stats.inPlayOnTurns.length;
      }

      if (stats.drawnOnTurn !== null) {
        drawnDefs.add(stats.definitionId);
        a.totalCopiesDrawn++;
      }
    }

    // Record win/loss per drawn/not-drawn
    for (const [defId, a] of Object.entries(defAccum)) {
      if (drawnDefs.has(defId)) {
        a.gamesDrawn++;
        if (p1Won) a.winsDrawn++;
      } else {
        a.gamesNotDrawn++;
        if (p1Won) a.winsNotDrawn++;
      }
    }
  }

  const n = results.length;

  const cardPerformance: Record<string, CardPerformance> = {};
  for (const [defId, a] of Object.entries(defAccum)) {
    cardPerformance[defId] = {
      definitionId: defId,
      avgCopiesDrawnPerGame: a.totalCopiesDrawn / n,
      avgTurnsToPlay: a.countPlayedInstances > 0 ? a.totalTurnsToPlay / a.countPlayedInstances : 0,
      avgLoreContributed: a.totalLore / n,
      banishRate: a.countPlayedInstances > 0 ? a.totalBanished / a.countPlayedInstances : 0,
      questRate: a.countPlayedInstances > 0 ? a.totalQuests / a.countPlayedInstances : 0,
      winRateWhenDrawn: a.gamesDrawn > 0 ? a.winsDrawn / a.gamesDrawn : 0,
      winRateWhenNotDrawn: a.gamesNotDrawn > 0 ? a.winsNotDrawn / a.gamesNotDrawn : 0,
    };
  }

  return {
    gamesPlayed: n,
    winRate: wins / n,
    avgGameLength: totalTurns / n,
    avgWinTurn: winTurnCount > 0 ? winTurnSum / winTurnCount : 0,
    firstPlayerWinRate: firstPlayerGames > 0 ? firstPlayerWins / firstPlayerGames : 0,
    drawRate: draws / n,
    botLabel,
    botType,
    cardPerformance,
  };
}
