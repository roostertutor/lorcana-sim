// =============================================================================
// ANALYZE COMMAND
// pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000
//
// Runs a simulation and prints DeckStats + DeckComposition.
// =============================================================================

import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { runSimulation } from "@lorcana-sim/simulator";
import { aggregateResults, analyzeDeckComposition } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";
import { printDeckStats, printDeckComposition, printActionLog } from "../format.js";

export interface AnalyzeArgs {
  deck: string;
  bot: string;
  iterations: number;
  verbose: boolean;
}

export function runAnalyze(args: AnalyzeArgs): void {
  const definitions = LORCAST_CARD_DEFINITIONS;
  const deck = loadDeck(args.deck, definitions);
  const bot = resolveBot(args.bot);
  const iterations = args.verbose ? 1 : args.iterations;

  console.log(`\nRunning ${iterations} game${iterations > 1 ? "s" : ""} with ${bot.name}...`);
  const results = runSimulation({
    player1Deck: deck,
    player2Deck: deck,
    player1Strategy: bot,
    player2Strategy: bot,
    definitions,
    iterations,
  });

  if (args.verbose) {
    printActionLog(results[0]!.actionLog);
  }

  const stats = aggregateResults(results);
  const comp = analyzeDeckComposition(deck, definitions);

  printDeckComposition(comp);
  printDeckStats(stats);
}
