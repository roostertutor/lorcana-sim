// =============================================================================
// COMPARE COMMAND
// pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
//
// Runs deck1 vs deck2 and prints MatchupStats.
// =============================================================================

import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { runSimulation } from "@lorcana-sim/simulator";
import { compareDecks } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";
import { printMatchupStats, printActionLog } from "../format.js";

export interface CompareArgs {
  deck1: string;
  deck2: string;
  bot: string;
  iterations: number;
  verbose: boolean;
}

export function runCompare(args: CompareArgs): void {
  const definitions = LORCAST_CARD_DEFINITIONS;
  const deck1 = loadDeck(args.deck1, definitions);
  const deck2 = loadDeck(args.deck2, definitions);
  const bot = resolveBot(args.bot);
  const iterations = args.verbose ? 1 : args.iterations;

  console.log(`\nRunning ${iterations} game${iterations > 1 ? "s" : ""} (deck1 vs deck2) with ${bot.name}...`);
  const results = runSimulation({
    player1Deck: deck1,
    player2Deck: deck2,
    player1Strategy: bot,
    player2Strategy: bot,
    definitions,
    iterations,
  });

  if (args.verbose) {
    printActionLog(results[0]!.actionLog);
  }

  const matchup = compareDecks(results);
  printMatchupStats(matchup);
}
