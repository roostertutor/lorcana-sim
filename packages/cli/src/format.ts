// =============================================================================
// OUTPUT FORMATTER
// Pretty-prints analytics results to stdout.
// =============================================================================

import type { DeckStats, DeckComposition, MatchupStats } from "@lorcana-sim/analytics";

const BAR_WIDTH = 30;

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function bar(n: number): string {
  const filled = Math.round(n * BAR_WIDTH);
  return "[" + "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled) + "]";
}

function sep(char = "─", width = 60): string {
  return char.repeat(width);
}

export function printDeckStats(stats: DeckStats): void {
  console.log(sep("═"));
  console.log("  DECK ANALYSIS");
  console.log(`  Bot: ${stats.botLabel}  |  Games: ${stats.gamesPlayed}`);
  console.log(sep("═"));
  console.log(`  Win rate          ${bar(stats.winRate)} ${pct(stats.winRate)}`);
  console.log(`  Draw rate         ${bar(stats.drawRate)} ${pct(stats.drawRate)}${stats.drawRate > 0.02 ? " ⚠ (>2%)" : ""}`);
  console.log(`  First-player WR   ${bar(stats.firstPlayerWinRate)} ${pct(stats.firstPlayerWinRate)}`);
  console.log(`  Avg game length   ${stats.avgGameLength.toFixed(1)} turns`);
  console.log(`  Avg win turn      ${stats.avgWinTurn.toFixed(1)}`);
  console.log(sep());

  // Top 5 cards by lore contributed
  const perf = Object.values(stats.cardPerformance)
    .sort((a, b) => b.avgLoreContributed - a.avgLoreContributed)
    .slice(0, 5);

  if (perf.length > 0) {
    console.log("  TOP CARDS BY AVG LORE/GAME");
    for (const c of perf) {
      const delta = c.winRateWhenDrawn - c.winRateWhenNotDrawn;
      const deltaStr = (delta >= 0 ? "+" : "") + pct(delta);
      console.log(
        `  ${c.definitionId.padEnd(35)}  lore: ${c.avgLoreContributed.toFixed(2).padStart(5)}  WR delta: ${deltaStr}`
      );
    }
  }
  console.log(sep("═"));
}

export function printDeckComposition(comp: DeckComposition): void {
  console.log(sep("═"));
  console.log("  DECK COMPOSITION");
  console.log(sep("═"));
  console.log(`  Total cards: ${comp.totalCards}   Inkable: ${comp.inkableCount} (${pct(comp.inkablePercent)})   Avg cost: ${comp.avgCost.toFixed(2)}`);
  console.log();

  // Cost curve
  console.log("  COST CURVE");
  const maxCount = Math.max(...Object.values(comp.costCurve));
  for (const cost of Object.keys(comp.costCurve).map(Number).sort((a, b) => a - b)) {
    const count = comp.costCurve[cost] ?? 0;
    const scaled = maxCount > 0 ? count / maxCount : 0;
    console.log(`  ${cost}: ${"▪".repeat(Math.round(scaled * 20)).padEnd(20)} ${count}`);
  }
  console.log();

  // Colors
  const colorEntries = Object.entries(comp.colorBreakdown).sort((a, b) => b[1] - a[1]);
  if (colorEntries.length > 0) {
    console.log("  INK COLORS: " + colorEntries.map(([c, n]) => `${c} ×${n}`).join("  "));
  }

  // Ink curve
  console.log();
  console.log("  P(≥1 INKABLE DRAWN BY TURN)");
  const turnLabels: Record<string, string> = { turn1: "1", turn2: "2", turn3: "3", turn4: "4" };
  for (const [turnKey, prob] of Object.entries(comp.inkCurveProb)) {
    const label = turnLabels[turnKey] ?? turnKey;
    console.log(`  Turn ${label}: ${bar(prob)} ${pct(prob)}`);
  }
  console.log(sep("═"));
}

export function printMatchupStats(matchup: MatchupStats): void {
  console.log(sep("═"));
  console.log("  MATCHUP COMPARISON");
  console.log(`  ${matchup.botLabel}  |  Games: ${matchup.gamesPlayed}`);
  console.log(sep("═"));
  console.log(`  Deck 1 win rate   ${bar(matchup.deck1WinRate)} ${pct(matchup.deck1WinRate)}`);
  console.log(`  Deck 2 win rate   ${bar(matchup.deck2WinRate)} ${pct(matchup.deck2WinRate)}`);
  console.log(`  Draw rate         ${bar(matchup.drawRate)} ${pct(matchup.drawRate)}`);
  console.log(`  Avg game length   ${matchup.avgGameLength.toFixed(1)} turns`);
  console.log(sep("═"));
}
