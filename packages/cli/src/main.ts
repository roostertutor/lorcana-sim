#!/usr/bin/env node
// =============================================================================
// CLI ENTRY POINT
// Routes subcommands to their handlers and parses --flag arguments.
//
// Usage:
//   pnpm analyze  --deck ./deck.txt --bot greedy     --iterations 1000
//   pnpm compare  --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
//   pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
//   pnpm sweep    --deck ./deck.txt --opponent control --iterations 200
// =============================================================================

import { resolve } from "path";
import { runAnalyze } from "./commands/analyze.js";
import { runCompare } from "./commands/compare.js";
import { runOptimize } from "./commands/optimize.js";
import { runSweep } from "./commands/sweep.js";
import { runQuery } from "./commands/query.js";
import { runLearn } from "./commands/learn.js";

// pnpm runs scripts from the package dir, but users pass paths relative to
// where they ran the command. INIT_CWD is set by pnpm to the original cwd.
const userCwd = process.env["INIT_CWD"] ?? process.cwd();

/** Resolve a user-provided file path relative to where they ran the command */
function userPath(p: string): string {
  return resolve(userCwd, p);
}

// ---------------------------------------------------------------------------
// Argument parser — no external deps, just process.argv
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function requireArg(args: Record<string, string>, key: string, usage: string): string {
  const v = args[key];
  if (!v) {
    console.error(`Missing required argument: --${key}\n${usage}`);
    process.exit(1);
  }
  return v;
}

function optionalInt(args: Record<string, string>, key: string, defaultVal: number): number {
  const v = args[key];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) {
    console.error(`--${key} must be a positive integer, got: "${v}"`);
    process.exit(1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest ?? []);

switch (subcommand) {
  case "analyze": {
    const usage = "Usage: pnpm analyze --deck ./deck.txt --bot greedy --iterations 1000 [--verbose] [--save ./results.json]";
    runAnalyze({
      deck: userPath(requireArg(args, "deck", usage)),
      bot: args["bot"] ?? "greedy",
      opponentBot: args["opponent-bot"],
      iterations: optionalInt(args, "iterations", 1000),
      verbose: args["verbose"] === "true",
      save: args["save"] ? userPath(args["save"]) : undefined,
    });
    break;
  }

  case "compare": {
    const usage = "Usage: pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000 [--verbose] [--save ./results.json]";
    runCompare({
      deck1: userPath(requireArg(args, "deck1", usage)),
      deck2: userPath(requireArg(args, "deck2", usage)),
      bot: args["bot"] ?? "greedy",
      opponentBot: args["opponent-bot"],
      iterations: optionalInt(args, "iterations", 1000),
      verbose: args["verbose"] === "true",
      save: args["save"] ? userPath(args["save"]) : undefined,
    });
    break;
  }

  case "optimize": {
    const usage = "Usage: pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500";
    runOptimize({
      deck: userPath(requireArg(args, "deck", usage)),
      opponent: args["opponent"] ?? "greedy",
      iterations: optionalInt(args, "iterations", 500),
    });
    break;
  }

  case "sweep": {
    const usage = "Usage: pnpm sweep --deck ./deck.txt --opponent control --iterations 200";
    runSweep({
      deck: userPath(requireArg(args, "deck", usage)),
      opponent: args["opponent"] ?? "greedy",
      iterations: optionalInt(args, "iterations", 200),
    });
    break;
  }

  case "query": {
    const usage =
      "Usage: pnpm query --sim sim.json --questions questions.json [--save results.json]\n" +
      "   or: pnpm query --questions questions.json --results saved.json";
    runQuery({
      sim: args["sim"] ? userPath(args["sim"]) : undefined,
      questions: userPath(requireArg(args, "questions", usage)),
      save: args["save"] ? userPath(args["save"]) : undefined,
      results: args["results"] ? userPath(args["results"]) : undefined,
    });
    break;
  }

  case "learn": {
    const usage = "Usage: pnpm learn --deck ./deck.txt --episodes 50000 [--save ./policy.json] [--load ./policy.json] [--seed 42] [--curriculum]";
    runLearn({
      deck: userPath(requireArg(args, "deck", usage)),
      opponent: args["opponent"] ? userPath(args["opponent"]) : undefined,
      episodes: optionalInt(args, "episodes", 50000),
      curriculum: args["curriculum"] === "true",
      save: args["save"] ? userPath(args["save"]) : undefined,
      load: args["load"] ? userPath(args["load"]) : undefined,
      seed: args["seed"] ? parseInt(args["seed"], 10) : undefined,
      maxTurns: optionalInt(args, "max-turns", 30),
    });
    break;
  }

  default: {
    console.log(`
Lorcana Sim CLI

Commands:
  analyze   Run simulation and analyze a single deck
  compare   Compare two decks head-to-head
  optimize  Find optimal weights for a deck vs an opponent style
  sweep     Sweep the weight space and show a win-rate grid
  query     Run condition-based queries against simulation results
  learn     Train an RL policy via REINFORCE

Examples:
  pnpm analyze  --deck ./deck.txt --bot greedy --iterations 1000
  pnpm analyze  --deck ./deck.txt --bot aggro  --iterations 1000
  pnpm compare  --deck1 ./a.txt --deck2 ./b.txt --bot probability --iterations 5000
  pnpm optimize --deck ./deck.txt --opponent aggro --iterations 500
  pnpm sweep    --deck ./deck.txt --opponent control --iterations 200
  pnpm query    --sim sim.json --questions questions.json [--save results.json]
  pnpm query    --questions questions.json --results saved.json
  pnpm learn    --deck ./deck.txt --episodes 50000 --save ./policy.json

Bot options: random, greedy, probability, aggro, control, midrange, rush, rl
`);
    process.exit(subcommand ? 1 : 0);
  }
}
