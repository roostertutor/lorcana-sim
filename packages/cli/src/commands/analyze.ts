// =============================================================================
// ANALYZE COMMAND
// pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000 [--save ./results.json]
//
// Runs a simulation and prints DeckStats + DeckComposition.
// =============================================================================

import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { runSimulation, saveResults } from "@lorcana-sim/simulator";
import { aggregateResults, analyzeDeckComposition } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";
import { printDeckStats, printDeckComposition, printActionLog } from "../format.js";

export interface AnalyzeArgs {
  deck: string;
  bot: string;
  opponentBot?: string;
  iterations: number;
  verbose: boolean;
  save?: string;
}

export async function runAnalyze(args: AnalyzeArgs): Promise<void> {
  const definitions = CARD_DEFINITIONS;
  const deck = loadDeck(args.deck, definitions);
  const bot = resolveBot(args.bot);
  const oppBot = resolveBot(args.opponentBot ?? args.bot);
  const iterations = args.verbose ? 1 : args.iterations;

  const botLabel = bot.name === oppBot.name
    ? bot.name
    : `${bot.name} vs ${oppBot.name}`;
  console.log(`\nRunning ${iterations} game${iterations > 1 ? "s" : ""} with ${botLabel}...`);
  const results = runSimulation({
    player1Deck: deck,
    player2Deck: deck,
    player1Strategy: bot,
    player2Strategy: oppBot,
    definitions,
    iterations,
  });

  if (args.save) {
    await saveResults(results, args.save, {
      deck: args.deck,
      opponent: "mirror",
      bot: bot.name,
      iterations,
      timestamp: new Date().toISOString(),
      engineVersion: "0.0.1",
    });
  }

  if (args.verbose) {
    printActionLog(results[0]!.actionLog);
  }

  const stats = aggregateResults(results);
  const comp = analyzeDeckComposition(deck, definitions);

  printDeckComposition(comp);
  printDeckStats(stats);
}
