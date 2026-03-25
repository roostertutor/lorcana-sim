// =============================================================================
// OPTIMIZE COMMAND
// pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
//
// Finds the best BotWeights for the given deck vs the given opponent style.
// Prints the winning weights and their win rate.
// =============================================================================

import { SAMPLE_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { findOptimalWeights, runGame } from "@lorcana-sim/simulator";
import { ProbabilityBot, MidrangeWeights } from "@lorcana-sim/simulator";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";

export interface OptimizeArgs {
  deck: string;
  opponent: string;
  iterations: number;
}

export function runOptimize(args: OptimizeArgs): void {
  const definitions = SAMPLE_CARD_DEFINITIONS;
  const deck = loadDeck(args.deck, definitions);
  const opponentBot = resolveBot(args.opponent);

  console.log(`\nOptimizing weights (${args.iterations} iterations) vs ${opponentBot.name}...`);

  const bestWeights = findOptimalWeights({
    deck,
    opponentDeck: deck,
    opponent: opponentBot,
    definitions,
    gamesPerEval: 20,
    iterations: args.iterations,
    searchStrategy: "random",
  });

  // Evaluate final win rate
  const evalBot = ProbabilityBot(bestWeights);
  let wins = 0;
  const evalGames = 50;
  for (let i = 0; i < evalGames; i++) {
    const result = runGame({
      player1Deck: deck,
      player2Deck: deck,
      player1Strategy: evalBot,
      player2Strategy: opponentBot,
      definitions,
    });
    if (result.winner === "player1") wins++;
  }

  const winRate = wins / evalGames;

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  OPTIMAL WEIGHTS FOUND");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Win rate vs ${opponentBot.name}: ${(winRate * 100).toFixed(1)}%`);
  console.log();
  console.log("  Static weights (copy into PersonalBotConfig):");
  console.log(`    loreAdvantage:  ${bestWeights.loreAdvantage.toFixed(3)}`);
  console.log(`    boardAdvantage: ${bestWeights.boardAdvantage.toFixed(3)}`);
  console.log(`    handAdvantage:  ${bestWeights.handAdvantage.toFixed(3)}`);
  console.log(`    inkAdvantage:   ${bestWeights.inkAdvantage.toFixed(3)}`);
  console.log(`    deckQuality:    ${bestWeights.deckQuality.toFixed(3)}`);
  console.log("════════════════════════════════════════════════════════════");

  // Emit machine-readable JSON to stdout for piping
  const json = JSON.stringify({
    loreAdvantage: bestWeights.loreAdvantage,
    boardAdvantage: bestWeights.boardAdvantage,
    handAdvantage: bestWeights.handAdvantage,
    inkAdvantage: bestWeights.inkAdvantage,
    deckQuality: bestWeights.deckQuality,
    winRate,
  }, null, 2);
  console.log("\n  JSON:");
  console.log(json);
}
