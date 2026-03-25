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
import { printMatchupStats } from "../format.js";

export interface CompareArgs {
  deck1: string;
  deck2: string;
  bot: string;
  iterations: number;
}

export function runCompare(args: CompareArgs): void {
  const definitions = LORCAST_CARD_DEFINITIONS;
  const deck1 = loadDeck(args.deck1, definitions);
  const deck2 = loadDeck(args.deck2, definitions);
  const bot = resolveBot(args.bot);

  console.log(`\nRunning ${args.iterations} games (deck1 vs deck2) with ${bot.name}...`);
  const results = runSimulation({
    player1Deck: deck1,
    player2Deck: deck2,
    player1Strategy: bot,
    player2Strategy: bot,
    definitions,
    iterations: args.iterations,
  });

  const matchup = compareDecks(results);
  printMatchupStats(matchup);
}
