// =============================================================================
// ANALYTICS TESTS
// Sanity checks for all analytics functions.
// Uses CARD_DEFINITIONS + a small test deck of real set 1 cards.
// =============================================================================

import { describe, it, expect } from "vitest";
import { CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { DeckEntry } from "@lorcana-sim/engine";
import { runSimulation, GreedyBot } from "@lorcana-sim/simulator";
import type { GameResult } from "@lorcana-sim/simulator";
import {
  aggregateResults,
  analyzeDeckComposition,
  compareDecks,
  analyzeOpeningHands,
  analyzeWeightSensitivity,
} from "./index.js";
import type { WeightSweepResult } from "@lorcana-sim/simulator";

// ---------------------------------------------------------------------------
// SHARED TEST DECK
// ---------------------------------------------------------------------------

const TEST_DECK: DeckEntry[] = [
  { definitionId: "simba-protective-cub", count: 10 },
  { definitionId: "stitch-rock-star", count: 10 },
  { definitionId: "beast-hardheaded", count: 10 },
  { definitionId: "moana-of-motunui", count: 10 },
  { definitionId: "hercules-true-hero", count: 10 },
  { definitionId: "tinker-bell-tiny-tactician", count: 10 },
];

// ---------------------------------------------------------------------------
// HELPER: Generate a small batch of GreedyBot results
// ---------------------------------------------------------------------------

function makeResults(n: number): GameResult[] {
  return runSimulation({
    player1Deck: TEST_DECK,
    player2Deck: TEST_DECK,
    player1Strategy: GreedyBot,
    player2Strategy: GreedyBot,
    definitions: CARD_DEFINITIONS,
    iterations: n,
  });
}

// ---------------------------------------------------------------------------
// aggregateResults
// ---------------------------------------------------------------------------

describe("aggregateResults", () => {
  it("returns correct shape for 50 games", () => {
    const results = makeResults(50);
    const stats = aggregateResults(results);

    expect(stats.gamesPlayed).toBe(50);
    expect(stats.winRate).toBeGreaterThanOrEqual(0);
    expect(stats.winRate).toBeLessThanOrEqual(1);
    expect(stats.drawRate).toBeGreaterThanOrEqual(0);
    expect(stats.drawRate).toBeLessThanOrEqual(1);
    expect(stats.avgGameLength).toBeGreaterThan(0);
    expect(stats.botLabel).toBeTruthy();
    expect(stats.botType).toBe("algorithm");
  });

  it("cardPerformance has an entry for every definition seen in play", () => {
    const results = makeResults(50);
    const stats = aggregateResults(results);
    // Should have at least some card performance entries
    expect(Object.keys(stats.cardPerformance).length).toBeGreaterThan(0);
  });

  it("throws on empty results", () => {
    expect(() => aggregateResults([])).toThrow();
  });

  it("throws on mixed bot types", () => {
    const results = makeResults(2);
    // Manually corrupt one result's botType
    const mixed = [
      { ...results[0]!, botType: "algorithm" as const },
      { ...results[1]!, botType: "personal" as const },
    ];
    expect(() => aggregateResults(mixed)).toThrow(/mixed BotTypes/i);
  });
});

// ---------------------------------------------------------------------------
// analyzeDeckComposition
// ---------------------------------------------------------------------------

describe("analyzeDeckComposition", () => {
  it("returns correct totals for a 60-card deck", () => {
    const comp = analyzeDeckComposition(TEST_DECK, CARD_DEFINITIONS);
    expect(comp.totalCards).toBe(60);
    expect(comp.inkableCount).toBeGreaterThan(0);
    expect(comp.inkableCount).toBeLessThanOrEqual(60);
    expect(comp.inkablePercent).toBeCloseTo(comp.inkableCount / 60, 5);
    expect(comp.avgCost).toBeGreaterThan(0);
  });

  it("cost curve sums to total cards", () => {
    const comp = analyzeDeckComposition(TEST_DECK, CARD_DEFINITIONS);
    const curveSum = Object.values(comp.costCurve).reduce((a, b) => a + b, 0);
    expect(curveSum).toBe(60);
  });

  it("ink curve probabilities are monotonically non-decreasing", () => {
    const comp = analyzeDeckComposition(TEST_DECK, CARD_DEFINITIONS);
    expect(comp.inkCurveProb.turn2).toBeGreaterThanOrEqual(comp.inkCurveProb.turn1);
    expect(comp.inkCurveProb.turn3).toBeGreaterThanOrEqual(comp.inkCurveProb.turn2);
    expect(comp.inkCurveProb.turn4).toBeGreaterThanOrEqual(comp.inkCurveProb.turn3);
  });

  it("ink curve probabilities are between 0 and 1", () => {
    const comp = analyzeDeckComposition(TEST_DECK, CARD_DEFINITIONS);
    for (const v of Object.values(comp.inkCurveProb)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// compareDecks
// ---------------------------------------------------------------------------

describe("compareDecks", () => {
  it("win rates + draw rate sum to 1", () => {
    const results = makeResults(50);
    const matchup = compareDecks(results);
    expect(matchup.deck1WinRate + matchup.deck2WinRate + matchup.drawRate).toBeCloseTo(1, 5);
  });

  it("throws on empty results", () => {
    expect(() => compareDecks([])).toThrow();
  });

  it("throws on mixed bot types", () => {
    const results = makeResults(2);
    const mixed = [
      { ...results[0]!, botType: "algorithm" as const },
      { ...results[1]!, botType: "crowd" as const },
    ];
    expect(() => compareDecks(mixed)).toThrow(/mixed BotTypes/i);
  });
});

// ---------------------------------------------------------------------------
// analyzeOpeningHands
// ---------------------------------------------------------------------------

describe("analyzeOpeningHands", () => {
  it("returns correct shape for 100 iterations", () => {
    const stats = analyzeOpeningHands(TEST_DECK, CARD_DEFINITIONS, 100);
    expect(stats.iterations).toBe(100);
    expect(stats.avgCost).toBeGreaterThan(0);
    expect(stats.avgInkableCount).toBeGreaterThanOrEqual(0);
    expect(stats.probabilityOfInkableInOpener).toBeGreaterThanOrEqual(0);
    expect(stats.probabilityOfInkableInOpener).toBeLessThanOrEqual(1);
    expect(stats.mostCommonCards.length).toBeGreaterThan(0);
  });

  it("playable-on-turn probabilities are non-decreasing", () => {
    const stats = analyzeOpeningHands(TEST_DECK, CARD_DEFINITIONS, 100);
    const p = stats.probabilityOfPlayableOnTurn;
    expect(p[2]!).toBeGreaterThanOrEqual(p[1]!);
    expect(p[3]!).toBeGreaterThanOrEqual(p[2]!);
    expect(p[4]!).toBeGreaterThanOrEqual(p[3]!);
  });
});

// ---------------------------------------------------------------------------
// analyzeWeightSensitivity
// ---------------------------------------------------------------------------

describe("analyzeWeightSensitivity", () => {
  it("returns correct shape for a set of sweep results", () => {
    // Build a few dummy sweep results
    const makeWeights = (v: number) => ({
      loreAdvantage: v,
      boardAdvantage: 1 - v,
      handAdvantage: 0.5,
      inkAdvantage: 0.5,
      deckQuality: 0.5,
      urgency: () => 0.5,
      threatLevel: () => 0.5,
    });

    const sweep: WeightSweepResult[] = [
      { weights: makeWeights(0.1), winRate: 0.45, gamesPlayed: 10 },
      { weights: makeWeights(0.5), winRate: 0.55, gamesPlayed: 10 },
      { weights: makeWeights(0.9), winRate: 0.50, gamesPlayed: 10 },
    ];

    const report = analyzeWeightSensitivity(sweep);
    expect(report.weightImportance["loreAdvantage"]).toBeGreaterThanOrEqual(0);
    expect(report.stableRanges["loreAdvantage"]).toHaveLength(2);
    // Dynamic weights always 0
    expect(report.weightImportance["urgency"]).toBe(0);
    expect(report.weightImportance["threatLevel"]).toBe(0);
  });

  it("returns zeroed report for empty sweep", () => {
    const report = analyzeWeightSensitivity([]);
    expect(report.weightImportance["loreAdvantage"]).toBe(0);
  });
});
