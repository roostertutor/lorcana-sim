// =============================================================================
// QUERY COMMAND
//
// Workflows:
//   pnpm query --sim sim.json --questions questions.json                    # one-shot
//   pnpm query --sim sim.json --questions questions.json --save results.json # save for later
//   pnpm query --questions questions.json --results results.json            # re-query saved
// =============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { StoredGameResult, StoredResultSet } from "@lorcana-sim/simulator";
import { runSimulation, saveResults, loadResults } from "@lorcana-sim/simulator";
import { queryResults, resolveRefs } from "@lorcana-sim/analytics";
import type { GameCondition, QueryResult } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";

/** Simulation config file — me, opponent, bot, iterations */
interface SimFile {
  me: string;
  opponent?: string;
  bot?: string;
  opponentBot?: string;
  policy?: string;          // path to RL policy JSON, relative to sim file
  opponentPolicy?: string;  // path to opponent RL policy JSON, relative to sim file
  iterations?: number;
  maxTurns?: number;
}

/** Questions file — named conditions with optional definitions for refs */
interface QuestionsFile {
  definitions?: Record<string, GameCondition>;
  queries: Array<{
    name: string;
    condition: GameCondition;
  }>;
}

export interface QueryArgs {
  sim?: string;
  questions: string;
  save?: string;
  results?: string;
  policy?: string;          // absolute path to RL policy JSON (resolved by main.ts)
  opponentPolicy?: string;  // absolute path to opponent RL policy JSON
}

export async function runQuery(args: QueryArgs): Promise<void> {
  // Load questions
  let questionsRaw: string;
  try {
    questionsRaw = readFileSync(args.questions, "utf-8");
  } catch {
    console.error(`Error: could not read questions file "${args.questions}"`);
    process.exit(1);
  }
  let questions: QuestionsFile;
  try {
    questions = JSON.parse(questionsRaw) as QuestionsFile;
  } catch {
    console.error(`Error: "${args.questions}" is not valid JSON`);
    process.exit(1);
  }

  let gameResults: StoredGameResult[];
  let metadata: StoredResultSet["metadata"] | undefined;

  if (args.results) {
    // Load saved results — no simulation needed
    const stored = await loadResults(args.results);
    gameResults = stored.results;
    metadata = stored.metadata;
    const date = metadata.timestamp !== "unknown" ? metadata.timestamp.split("T")[0] : "unknown";
    console.log(`\nLoaded ${gameResults.length} saved game results from ${args.results}`);
    console.log(`  bot: ${metadata.bot}  |  date: ${date}  |  iterations: ${metadata.iterations}\n`);
  } else {
    // Run a fresh simulation — requires --sim
    if (!args.sim) {
      console.error("Error: --sim is required when --results is not provided.");
      console.error("Usage: pnpm query --sim sim.json --questions questions.json [--save results.json]");
      console.error("   or: pnpm query --questions questions.json --results saved.json");
      process.exit(1);
    }

    let simRaw: string;
    try {
      simRaw = readFileSync(args.sim, "utf-8");
    } catch {
      console.error(`Error: could not read sim file "${args.sim}"`);
      process.exit(1);
    }
    let simConfig: SimFile;
    try {
      simConfig = JSON.parse(simRaw) as SimFile;
    } catch {
      console.error(`Error: "${args.sim}" is not valid JSON`);
      process.exit(1);
    }

    // Resolve deck paths relative to the sim file's directory
    const simDir = dirname(resolve(args.sim));
    const resolvePath = (p: string) => resolve(simDir, p);

    const definitions = CARD_DEFINITIONS;
    const deck = loadDeck(resolvePath(simConfig.me), definitions);
    const opponentDeck = simConfig.opponent
      ? loadDeck(resolvePath(simConfig.opponent), definitions)
      : deck;
    // CLI --policy overrides sim file's policy field. Sim file paths resolved relative to sim dir.
    const policyPath = args.policy
      ?? (simConfig.policy ? resolvePath(simConfig.policy) : undefined);
    const oppPolicyPath = args.opponentPolicy
      ?? (simConfig.opponentPolicy ? resolvePath(simConfig.opponentPolicy) : undefined);
    const bot = resolveBot(simConfig.bot ?? "greedy", policyPath);
    const oppBot = resolveBot(simConfig.opponentBot ?? simConfig.bot ?? "greedy", oppPolicyPath);
    const iterations = simConfig.iterations ?? 1000;

    const botLabel = bot.name === oppBot.name
      ? `bot: ${bot.name}`
      : `p1: ${bot.name} vs p2: ${oppBot.name}`;
    console.log(`\nRunning ${iterations} games (${botLabel}) to answer ${questions.queries.length} question(s)...\n`);

    const fullResults = runSimulation({
      player1Deck: deck,
      player2Deck: opponentDeck,
      player1Strategy: bot,
      player2Strategy: oppBot,
      definitions,
      iterations,
      ...(simConfig.maxTurns != null && { maxTurns: simConfig.maxTurns }),
    });

    if (args.save) {
      await saveResults(fullResults, args.save, {
        deck: simConfig.me,
        opponent: simConfig.opponent ?? "mirror",
        bot: bot.name,
        iterations,
        timestamp: new Date().toISOString(),
        engineVersion: "0.0.1",
      });
      console.log();
    }

    gameResults = fullResults;
  }

  const n = gameResults.length;
  const botLabel = metadata?.bot ?? gameResults[0]?.botLabels?.["player1"] ?? "unknown";

  console.log("=".repeat(60));
  console.log("  QUERY RESULTS");
  console.log(`  ${n} games  |  bot: ${botLabel}`);
  console.log("=".repeat(60));

  const defs = questions.definitions ?? {};
  for (const q of questions.queries) {
    // StoredGameResult is compatible with GameResult for query purposes
    // (queryResults only reads cardStats, inkByTurn, loreByTurn, winner, winReason, turns)
    const resolved = resolveRefs(q.condition, defs);
    const result = queryResults(gameResults as any, resolved);
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
