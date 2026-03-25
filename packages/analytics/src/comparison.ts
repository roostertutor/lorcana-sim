// =============================================================================
// DECK COMPARISON
// Aggregates a set of GameResults from a matchup into MatchupStats.
// player1 = deck under test, player2 = opponent.
// =============================================================================

import type { GameResult } from "@lorcana-sim/simulator";
import type { MatchupStats } from "./types.js";

export function compareDecks(results: GameResult[]): MatchupStats {
  if (results.length === 0) {
    throw new Error("compareDecks: results array is empty");
  }

  const botType = results[0]!.botType;
  for (const r of results) {
    if (r.botType !== botType) {
      throw new Error(
        `compareDecks: mixed BotTypes — found "${r.botType}" and "${botType}". ` +
          "Never aggregate results across bot types."
      );
    }
  }

  let deck1Wins = 0;
  let deck2Wins = 0;
  let draws = 0;
  let totalTurns = 0;

  for (const r of results) {
    if (r.winner === "player1") deck1Wins++;
    else if (r.winner === "player2") deck2Wins++;
    else draws++;
    totalTurns += r.turns;
  }

  const n = results.length;
  const botLabel = `${results[0]!.botLabels["player1"]} vs ${results[0]!.botLabels["player2"]}`;

  return {
    deck1WinRate: deck1Wins / n,
    deck2WinRate: deck2Wins / n,
    drawRate: draws / n,
    gamesPlayed: n,
    avgGameLength: totalTurns / n,
    botLabel,
    botType,
  };
}
