// =============================================================================
// WEIGHT SENSITIVITY ANALYZER
// Takes WeightSweepResults and produces a SensitivityReport:
//   - weightImportance: variance in win rate as each weight changes
//   - stableRanges: [lo, hi] where win rate stays within 5% of peak
//
// Only analyzes static numeric weights (loreAdvantage, boardAdvantage, etc.).
// Dynamic function weights (urgency, threatLevel) are reported as 0.
// =============================================================================

import type { WeightSweepResult } from "@lorcana-sim/simulator";
import type { SensitivityReport } from "./types.js";

const STATIC_WEIGHT_KEYS = [
  "loreAdvantage",
  "boardAdvantage",
  "handAdvantage",
  "inkAdvantage",
  "deckQuality",
] as const;

type StaticWeightKey = (typeof STATIC_WEIGHT_KEYS)[number];

export function analyzeWeightSensitivity(sweepResults: WeightSweepResult[]): SensitivityReport {
  if (sweepResults.length === 0) {
    const zero = Object.fromEntries(STATIC_WEIGHT_KEYS.map((k) => [k, 0])) as Record<string, number>;
    const zeroRange = Object.fromEntries(STATIC_WEIGHT_KEYS.map((k) => [k, [0, 1] as [number, number]])) as Record<
      string,
      [number, number]
    >;
    return { weightImportance: zero, stableRanges: zeroRange };
  }

  const peakWinRate = Math.max(...sweepResults.map((r) => r.winRate));
  const threshold = peakWinRate - 0.05; // Within 5% of peak

  const weightImportance: Record<string, number> = {};
  const stableRanges: Record<string, [number, number]> = {};

  for (const key of STATIC_WEIGHT_KEYS) {
    // Collect (value, winRate) pairs for this weight dimension
    const pairs = sweepResults.map((r) => ({
      value: r.weights[key] as number,
      winRate: r.winRate,
    }));

    // Sort by value to analyze range
    pairs.sort((a, b) => a.value - b.value);

    // Importance = max win rate - min win rate across the sweep
    const rates = pairs.map((p) => p.winRate);
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);
    weightImportance[key] = maxRate - minRate;

    // Stable range: find contiguous region (by sorted value) where winRate >= threshold
    const stablePairs = pairs.filter((p) => p.winRate >= threshold);
    if (stablePairs.length === 0) {
      stableRanges[key] = [0, 0];
    } else {
      stableRanges[key] = [stablePairs[0]!.value, stablePairs[stablePairs.length - 1]!.value];
    }
  }

  // Dynamic weights: report 0 importance (can't vary them in a simple sweep)
  weightImportance["urgency"] = 0;
  weightImportance["threatLevel"] = 0;
  stableRanges["urgency"] = [0, 1];
  stableRanges["threatLevel"] = [0, 1];

  return { weightImportance, stableRanges };
}
