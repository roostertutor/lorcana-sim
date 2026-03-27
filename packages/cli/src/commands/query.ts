// =============================================================================
// QUERY COMMAND
// pnpm query --file ./questions.json [--save ./results.json] [--results ./results.json]
//
// Reads a JSON query file, runs a simulation (or loads saved results),
// and evaluates conditions.
// =============================================================================

import { readFileSync } from "fs";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { StoredGameResult, StoredResultSet } from "@lorcana-sim/simulator";
import { runSimulation, saveResults, loadResults } from "@lorcana-sim/simulator";
import { queryResults } from "@lorcana-sim/analytics";
import type { GameCondition, QueryResult } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";

interface QueryFile {
  deck: string;
  opponent?: string;
  bot?: string;
  iterations?: number;
  queries: Array<{
    name: string;
    condition: GameCondition;
  }>;
}

export interface QueryArgs {
  file: string;
  save?: string;
  results?: string;
}

export function runQuery(args: QueryArgs): void {
  let raw: string;
  try {
    raw = readFileSync(args.file, "utf-8");
  } catch {
    console.error(`Error: could not read query file "${args.file}"`);
    process.exit(1);
  }

  const config = JSON.parse(raw) as QueryFile;
  let gameResults: StoredGameResult[];
  let metadata: StoredResultSet["metadata"] | undefined;

  if (args.results) {
    // Load saved results instead of running a new simulation
    const stored = loadResults(args.results);
    gameResults = stored.results;
    metadata = stored.metadata;
    const date = metadata.timestamp !== "unknown" ? metadata.timestamp.split("T")[0] : "unknown";
    console.log(`\nLoaded ${gameResults.length} saved game results from ${args.results}`);
    console.log(`  bot: ${metadata.bot}  |  date: ${date}  |  iterations: ${metadata.iterations}\n`);
  } else {
    // Run a fresh simulation
    const definitions = LORCAST_CARD_DEFINITIONS;
    const deck = loadDeck(config.deck, definitions);
    const opponentDeck = config.opponent
      ? loadDeck(config.opponent, definitions)
      : deck; // mirror match if no opponent specified
    const bot = resolveBot(config.bot ?? "greedy");
    const iterations = config.iterations ?? 1000;

    console.log(`\nRunning ${iterations} games to answer ${config.queries.length} question(s)...\n`);

    const fullResults = runSimulation({
      player1Deck: deck,
      player2Deck: opponentDeck,
      player1Strategy: bot,
      player2Strategy: bot,
      definitions,
      iterations,
    });

    // Save results if --save was specified
    if (args.save) {
      saveResults(fullResults, args.save, {
        deck: config.deck,
        opponent: config.opponent ?? "mirror",
        bot: bot.name,
        iterations,
        timestamp: new Date().toISOString(),
        engineVersion: "0.0.1",
      });
      console.log();
    }

    // Use full results for querying (they have actionLog but that's fine in-memory)
    gameResults = fullResults;
  }

  const n = gameResults.length;
  const botLabel = metadata?.bot ?? gameResults[0]?.botLabels?.["player1"] ?? "unknown";

  console.log("=".repeat(60));
  console.log("  QUERY RESULTS");
  console.log(`  ${n} games  |  bot: ${botLabel}`);
  console.log("=".repeat(60));

  for (const q of config.queries) {
    // StoredGameResult is compatible with GameResult for query purposes
    // (queryResults only reads cardStats, inkByTurn, loreByTurn, winner, winReason, turns)
    const result = queryResults(gameResults as any, q.condition);
    printQueryResult(q.name, result);
  }
}

function printQueryResult(name: string, result: QueryResult): void {
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const delta = result.delta;
  const deltaStr = (delta >= 0 ? "+" : "") + pct(delta);
  const deltaIcon = delta >= 0.1 ? "+" : delta <= -0.1 ? "-" : "~";

  console.log();
  console.log(`  ${name}`);
  console.log("  " + "-".repeat(56));
  console.log(`  Happens in:        ${pct(result.probability)} of games  (+/-${pct(result.probabilityMargin)})`);
  console.log(`  Win rate when met: ${pct(result.winRateWhenMet)}  (n=${result.nMet})`);
  console.log(`  Win rate when not: ${pct(result.winRateWhenNotMet)}  (n=${result.nNotMet})`);
  console.log(`  Impact:            ${deltaIcon} ${deltaStr}`);
  console.log();
  console.log(`  ${result.interpretation}`);
  console.log();
}
