// =============================================================================
// COMPARE COMMAND
// pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000 [--save ./results.json]
//
// Runs deck1 vs deck2 and prints MatchupStats.
// =============================================================================

import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { runSimulation, saveResults } from "@lorcana-sim/simulator";
import { compareDecks } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";
import { printMatchupStats, printActionLog } from "../format.js";

export interface CompareArgs {
  deck1: string;
  deck2: string;
  bot: string;
  opponentBot?: string;
  iterations: number;
  verbose: boolean;
  save?: string;
}

export async function runCompare(args: CompareArgs): Promise<void> {
  const definitions = LORCAST_CARD_DEFINITIONS;
  const deck1 = loadDeck(args.deck1, definitions);
  const deck2 = loadDeck(args.deck2, definitions);
  const bot = resolveBot(args.bot);
  const oppBot = resolveBot(args.opponentBot ?? args.bot);
  const iterations = args.verbose ? 1 : args.iterations;

  const botLabel = bot.name === oppBot.name
    ? bot.name
    : `${bot.name} vs ${oppBot.name}`;
  console.log(`\nRunning ${iterations} game${iterations > 1 ? "s" : ""} (deck1 vs deck2) with ${botLabel}...`);
  const results = runSimulation({
    player1Deck: deck1,
    player2Deck: deck2,
    player1Strategy: bot,
    player2Strategy: oppBot,
    definitions,
    iterations,
  });

  if (args.save) {
    await saveResults(results, args.save, {
      deck: args.deck1,
      opponent: args.deck2,
      bot: bot.name,
      iterations,
      timestamp: new Date().toISOString(),
      engineVersion: "0.0.1",
    });
  }

  if (args.verbose) {
    printActionLog(results[0]!.actionLog);
  }

  const matchup = compareDecks(results);
  printMatchupStats(matchup);
}
