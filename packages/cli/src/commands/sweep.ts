// =============================================================================
// SWEEP COMMAND
// pnpm sweep --deck ./deck.txt --opponent control --iterations 200
//
// Sweeps the loreAdvantage × boardAdvantage weight space (3×3 grid),
// prints a win-rate table, and runs analyzeWeightSensitivity.
// =============================================================================

import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import { sweepWeightSpace, MidrangeWeights } from "@lorcana-sim/simulator";
import type { BotWeights } from "@lorcana-sim/simulator";
import { analyzeWeightSensitivity } from "@lorcana-sim/analytics";
import { loadDeck } from "../loadDeck.js";
import { resolveBot } from "../resolveBot.js";

export interface SweepArgs {
  deck: string;
  opponent: string;
  iterations: number;
}

/** Generate a grid of weight samples varying loreAdvantage and boardAdvantage. */
function buildWeightGrid(): BotWeights[] {
  const samples: BotWeights[] = [];
  const values = [0.2, 0.5, 0.8];
  for (const lore of values) {
    for (const board of values) {
      samples.push({
        ...MidrangeWeights,
        loreAdvantage: lore,
        boardAdvantage: board,
      });
    }
  }
  return samples;
}

export function runSweep(args: SweepArgs): void {
  const definitions = LORCAST_CARD_DEFINITIONS;
  const deck = loadDeck(args.deck, definitions);
  const opponentBot = resolveBot(args.opponent);

  const samples = buildWeightGrid();
  console.log(`\nSweeping ${samples.length} weight combinations (${args.iterations} games each) vs ${opponentBot.name}...`);

  const sweepResults = sweepWeightSpace({
    deck,
    opponentDeck: deck,
    opponent: opponentBot,
    definitions,
    weightSamples: samples,
    gamesPerSample: args.iterations,
  });

  // Print grid
  const loreCols = [0.2, 0.5, 0.8];
  const boardRows = [0.2, 0.5, 0.8];

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  WIN RATE GRID  (rows = boardAdvantage, cols = loreAdvantage)");
  console.log("════════════════════════════════════════════════════════════");
  console.log("              lore=0.2   lore=0.5   lore=0.8");
  for (const board of boardRows) {
    const cells = loreCols.map((lore) => {
      const r = sweepResults.find(
        (s) => Math.abs(s.weights.loreAdvantage - lore) < 0.01 &&
               Math.abs(s.weights.boardAdvantage - board) < 0.01
      );
      return r ? (r.winRate * 100).toFixed(1).padStart(6) + "%" : "   n/a ";
    });
    console.log(`  board=${board.toFixed(1)}   ${cells.join("   ")}`);
  }

  // Sensitivity report
  const report = analyzeWeightSensitivity(sweepResults);
  console.log("\n  WEIGHT IMPORTANCE (win rate variance per dimension)");
  for (const [key, val] of Object.entries(report.weightImportance)) {
    if (typeof val === "number" && val > 0) {
      const range = report.stableRanges[key];
      const rangeStr = range ? `  stable: [${range[0].toFixed(2)}, ${range[1].toFixed(2)}]` : "";
      console.log(`    ${key.padEnd(18)} ${(val * 100).toFixed(1)}%${rangeStr}`);
    }
  }
  console.log("════════════════════════════════════════════════════════════");
}
