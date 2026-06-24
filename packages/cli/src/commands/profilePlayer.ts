// =============================================================================
// PROFILE-PLAYER COMMAND (ROADMAP Stream 5c)
// Train a supervised "clone bot" of a specific player from their game logs.
//
//   pnpm profile-player --logs ./games/*.json --save ./ryan-bot.json
//   pnpm profile-player --from-db --player ryanfan --games 50 --save ./ryan-bot.json
//
// The output is a policy JSON loadable through the SAME path as RL policies
// (resolveBot "rl" → RLPolicy.fromJSON), so play-vs-clone (5e) and the coaching
// map (5d) consume it unchanged.
// =============================================================================

import { writeFileSync } from "fs";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { trainClone, evaluateClone } from "@lorcana-sim/simulator";
import type { CloneSample } from "@lorcana-sim/simulator";
import { loadCloneSamples } from "../loadCloneSamples.js";
import { loadDbCloneSamples } from "../cloneDbSource.js";

export interface ProfilePlayerArgs {
  /** Local JSON log files (already glob-expanded into a list). */
  logs?: string[];
  /** Pull rows from an exported DB dump (see cloneDbSource.ts). */
  fromDb?: boolean;
  /** Player username/id — required with --from-db. */
  player?: string;
  /** Path to the exported DB dump JSON (required with --from-db until a live
   *  server export endpoint exists — see HANDOFF). */
  dbExport?: string;
  /** Cap on number of most-recent games to use from the DB source. */
  games?: number;
  /** Where to write the trained clone policy JSON. */
  save?: string;
  /** Supervised training epochs. */
  epochs: number;
  /** Learning rate. */
  learningRate?: number;
  /** Seed — same seed + same samples → identical clone. */
  seed: number;
  /** Fraction of samples held out for accuracy reporting (0 disables). */
  evalSplit: number;
}

export function runProfilePlayer(args: ProfilePlayerArgs): void {
  const definitions = CARD_DEFINITIONS;

  // --- Gather samples ---
  let samples: CloneSample[];

  if (args.fromDb) {
    if (!args.player) {
      console.error("--from-db requires --player <username|id>");
      process.exit(1);
    }
    console.log(`\nLoading clone samples from DB export for player "${args.player}"...`);
    samples = loadDbCloneSamples(
      { player: args.player, games: args.games, dbExport: args.dbExport },
      definitions
    );
  } else {
    if (!args.logs || args.logs.length === 0) {
      console.error("Provide --logs <files...> or --from-db --player <id>");
      process.exit(1);
    }
    console.log(`\nLoading clone samples from ${args.logs.length} log file(s)...`);
    samples = loadCloneSamples(args.logs, definitions);
  }

  if (samples.length === 0) {
    console.error("No usable samples found.");
    process.exit(1);
  }
  console.log(`Total samples: ${samples.length}`);

  // --- Train/eval split (deterministic, seeded by stride for reproducibility) ---
  let trainSamples = samples;
  let evalSamples: CloneSample[] = [];
  if (args.evalSplit > 0 && args.evalSplit < 1 && samples.length >= 20) {
    const stride = Math.round(1 / args.evalSplit);
    trainSamples = [];
    for (let i = 0; i < samples.length; i++) {
      if (i % stride === 0) evalSamples.push(samples[i]!);
      else trainSamples.push(samples[i]!);
    }
  }

  // --- Train ---
  console.log(`\nTraining clone (epochs=${args.epochs}, lr=${args.learningRate ?? 0.05}, seed=${args.seed})...`);
  const startTime = Date.now();
  const result = trainClone({
    samples: trainSamples,
    definitions,
    name: args.player ? `clone-${args.player}` : "clone",
    epochs: args.epochs,
    learningRate: args.learningRate,
    seed: args.seed,
    onEpoch: (epoch, logLik, top1) => {
      console.log(
        `  Epoch ${epoch.toString().padStart(3)} | ` +
        `logLik=${logLik.toFixed(3)} | train top-1=${(top1 * 100).toFixed(1)}%`
      );
    },
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nTraining complete in ${elapsed}s`);
  console.log(`  Samples used (after filtering forced turns): ${result.samplesUsed}`);

  // --- Held-out evaluation ---
  if (evalSamples.length > 0) {
    const ev = evaluateClone(result.policy, evalSamples, definitions);
    console.log(`\nHeld-out evaluation (${ev.samplesEvaluated} multi-option positions):`);
    console.log(`  Clone top-1 action match: ${(ev.top1Accuracy * 100).toFixed(1)}%`);
    console.log(`  Random-legal baseline:    ${(ev.randomBaseline * 100).toFixed(1)}%`);
    const lift = ev.top1Accuracy - ev.randomBaseline;
    console.log(`  Lift over baseline:       ${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`);
  }

  // --- Save ---
  if (args.save) {
    // epsilon is already 0 (clones never explore); save as RLPolicyJSON so the
    // existing resolveBot("rl", path) load path consumes it unchanged.
    const json = JSON.stringify(result.policy.toJSON());
    writeFileSync(args.save, json);
    console.log(`\nClone policy saved to ${args.save}`);
    console.log(`Load it with: --bot rl --policy ${args.save}`);
  }
}
