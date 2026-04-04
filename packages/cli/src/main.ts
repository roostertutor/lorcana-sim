#!/usr/bin/env node
// =============================================================================
// CLI ENTRY POINT
// Routes subcommands to their handlers and parses --flag arguments.
//
// Usage:
//   pnpm analyze  --deck ./deck.txt --bot greedy --iterations 1000
//   pnpm compare  --deck1 ./a.txt --deck2 ./b.txt --bot greedy --iterations 5000
//   pnpm query    --sim sims/set-001-ruby-amethyst/sim.json --questions sims/set-001-ruby-amethyst/turn3-questions.json
//   pnpm learn    --deck ./deck.txt --episodes 50000 --save ./policies/my-policy.json
// =============================================================================

import { resolve } from "path";
import { runAnalyze } from "./commands/analyze.js";
import { runCompare } from "./commands/compare.js";
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
  if (!v) throw new Error(`Missing required argument: --${key}\n${usage}`);
  return v;
}

function optionalInt(args: Record<string, string>, key: string, defaultVal: number): number {
  const v = args[key];
  if (!v) return defaultVal;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) throw new Error(`--${key} must be a positive integer, got: "${v}"`);
  return n;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest ?? []);

try {
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
    const usage = "Usage: pnpm compare --deck1 ./a.txt --deck2 ./b.txt --bot greedy --iterations 5000 [--verbose] [--save ./results.json]";
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

  case "query": {
    const usage =
      "Usage: pnpm query --sim sim.json --questions questions.json [--save results.json] [--policy policy.json]\n" +
      "   or: pnpm query --questions questions.json --results saved.json";
    runQuery({
      sim: args["sim"] ? userPath(args["sim"]) : undefined,
      questions: userPath(requireArg(args, "questions", usage)),
      save: args["save"] ? userPath(args["save"]) : undefined,
      results: args["results"] ? userPath(args["results"]) : undefined,
      policy: args["policy"] ? userPath(args["policy"]) : undefined,
      opponentPolicy: args["opponent-policy"] ? userPath(args["opponent-policy"]) : undefined,
    });
    break;
  }

  case "learn": {
    const usage = "Usage: pnpm learn --deck ./deck.txt --episodes 50000 [--save ./policy.json] [--load ./policy.json] [--seed 42]";
    runLearn({
      deck: userPath(requireArg(args, "deck", usage)),
      opponent: args["opponent"] ? userPath(args["opponent"]) : undefined,
      episodes: optionalInt(args, "episodes", 50000),
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
  query     Run condition-based queries against simulation results
  learn     Train an RL policy (A2C+GAE)

Examples:
  pnpm analyze  --deck ./deck.txt --bot greedy --iterations 1000
  pnpm analyze  --deck ./deck.txt --bot rl --policy ./policies/control.json --iterations 1000
  pnpm compare  --deck1 ./a.txt --deck2 ./b.txt --bot greedy --iterations 5000
  pnpm query    --sim sim.json --questions questions.json [--save results.json]
  pnpm query    --sim sim.json --questions questions.json --policy ./policies/control.json
  pnpm query    --questions questions.json --results saved.json
  pnpm learn    --deck ./deck.txt --episodes 50000 --save ./policy.json

Bot options: random, greedy, rl (use --policy with rl)
`);
    process.exit(subcommand ? 1 : 0);
  }
}
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
