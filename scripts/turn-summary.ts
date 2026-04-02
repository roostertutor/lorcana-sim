// =============================================================================
// TURN SUMMARY
// Aggregates per-turn game statistics from saved results to describe what
// turns 1-7 typically look like.
//
// Usage:
//   npx tsx scripts/turn-summary.ts --results results/ruby-amethyst-turn3-results.json
//   npx tsx scripts/turn-summary.ts --results results/ruby-amethyst-turn3-results.json --turns 10
//   npx tsx scripts/turn-summary.ts --results results/ruby-amethyst-turn3-results.json --player 2
// =============================================================================

import { readFileSync } from "fs";
import { LORCAST_CARD_DEFINITIONS } from "@lorcana-sim/engine";
import type { StoredGameResult, StoredResultSet } from "@lorcana-sim/simulator";

// --- CLI args ---
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const resultsFile = getArg("--results");
const maxTurns    = parseInt(getArg("--turns") ?? "7", 10);
const playerArg   = getArg("--player") ?? "both"; // "1", "2", or "both"

if (!resultsFile) {
  console.error("Usage: npx tsx scripts/turn-summary.ts --results <file.json> [--turns N] [--player 1|2|both]");
  process.exit(1);
}

// --- Load results ---
const raw     = readFileSync(resultsFile, "utf-8");
const stored  = JSON.parse(raw) as StoredResultSet | StoredGameResult[];
const dataset: StoredGameResult[] = Array.isArray(stored) ? stored : stored.results;
const meta    = Array.isArray(stored) ? null : stored.metadata;

if (meta) {
  console.log(`\nLoaded ${dataset.length} games  |  bot: ${meta.bot}  |  ${meta.timestamp.split("T")[0]}`);
} else {
  console.log(`\nLoaded ${dataset.length} games`);
}

// --- Helpers ---
const defs = LORCAST_CARD_DEFINITIONS;

function cardName(defId: string): string {
  const d = defs[defId];
  if (!d) return defId;
  return d.name + (d.version ? ` - ${d.version}` : "");
}

// Global turn from per-player turn number
function globalTurn(playerTurn: number, player: 1 | 2): number {
  return player === 1 ? 2 * playerTurn - 1 : 2 * playerTurn;
}

// Lore delta on a player's turn T (lore gained that turn)
function loreDeltaOnTurn(
  result: StoredGameResult,
  pid: "player1" | "player2",
  globalT: number
): number | null {
  const arr = result.loreByTurn[pid];
  if (!arr || arr.length < globalT) return null;
  const cur  = arr[globalT - 1] ?? 0;
  const prev = globalT >= 2 ? (arr[globalT - 2] ?? 0) : 0;
  return cur - prev;
}

interface TurnStats {
  playerTurn: number;
  globalT: number;
  gamesActive: number;
  avgInkAvailable: number;
  avgLoreTotal: number;
  avgLoreDelta: number;
  topCards: Array<{ name: string; count: number; pct: number }>;
  avgCardsPlayedThisTurn: number;
}

function summarizePlayer(
  results: StoredGameResult[],
  player: 1 | 2,
  turns: number
): TurnStats[] {
  const pid: "player1" | "player2" = `player${player}`;
  const out: TurnStats[] = [];

  for (let t = 1; t <= turns; t++) {
    const gt = globalTurn(t, player);

    // Games still active on this player's turn (game lasted at least this far)
    const active = results.filter(r => r.turns >= gt);
    const n = active.length;
    if (n === 0) {
      out.push({
        playerTurn: t, globalT: gt,
        gamesActive: 0, avgInkAvailable: 0, avgLoreTotal: 0,
        avgLoreDelta: 0, topCards: [], avgCardsPlayedThisTurn: 0,
      });
      continue;
    }

    // Ink available at start of this turn (before inking)
    const inkVals = active.map(r => r.inkByTurn[pid]?.[gt - 1] ?? 0);
    const avgInk  = inkVals.reduce((a, b) => a + b, 0) / n;

    // Lore at end of this turn
    const loreVals = active.map(r => r.loreByTurn[pid]?.[gt - 1] ?? 0);
    const avgLore  = loreVals.reduce((a, b) => a + b, 0) / n;

    // Lore delta this turn
    const deltas = active.map(r => loreDeltaOnTurn(r, pid, gt) ?? 0);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / n;

    // Cards played on exactly this global turn
    const cardCounts: Record<string, number> = {};
    let totalCardsPlayed = 0;
    for (const r of active) {
      for (const cs of Object.values(r.cardStats)) {
        if (cs.ownerId === pid && cs.playedOnTurn === gt) {
          cardCounts[cs.definitionId] = (cardCounts[cs.definitionId] ?? 0) + 1;
          totalCardsPlayed++;
        }
      }
    }
    const avgCardsPlayedThisTurn = totalCardsPlayed / n;

    const topCards = Object.entries(cardCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([defId, count]) => ({
        name: cardName(defId),
        count,
        pct: count / n,
      }));

    out.push({
      playerTurn: t, globalT: gt,
      gamesActive: n,
      avgInkAvailable: avgInk,
      avgLoreTotal: avgLore,
      avgLoreDelta: avgDelta,
      topCards,
      avgCardsPlayedThisTurn,
    });
  }

  return out;
}

// --- Game length distribution ---
function printGameLengthSummary(results: StoredGameResult[]): void {
  const totalGames = results.length;
  const playerTurns = results.map(r => Math.ceil(r.turns / 2)); // rough p1 turns
  const gameLengths = results.map(r => r.turns);

  const avgGlobalTurns = gameLengths.reduce((a, b) => a + b, 0) / totalGames;
  const avgPlayerTurns = playerTurns.reduce((a, b) => a + b, 0) / totalGames;

  const byTurn: Record<number, number> = {};
  for (const t of playerTurns) {
    byTurn[t] = (byTurn[t] ?? 0) + 1;
  }

  const p1wins = results.filter(r => r.winner === "player1").length;
  const p2wins = results.filter(r => r.winner === "player2").length;
  const draws  = results.filter(r => r.winner === "draw").length;

  console.log("\n" + "=".repeat(64));
  console.log("  GAME LENGTH OVERVIEW");
  console.log("=".repeat(64));
  console.log(`  Total games:      ${totalGames}`);
  console.log(`  Avg length:       ${avgGlobalTurns.toFixed(1)} global turns  (~${avgPlayerTurns.toFixed(1)} turns/player)`);
  console.log(`  P1 win rate:      ${(p1wins / totalGames * 100).toFixed(1)}%`);
  console.log(`  P2 win rate:      ${(p2wins / totalGames * 100).toFixed(1)}%`);
  if (draws > 0) console.log(`  Draws:            ${(draws / totalGames * 100).toFixed(1)}%`);

  // % of games ending by turn T
  console.log(`\n  Games still active (% not yet finished):`);
  for (let t = 1; t <= maxTurns + 1; t++) {
    const gt = 2 * t - 1; // p1's turn T
    const active = results.filter(r => r.turns >= gt).length;
    const pct = (active / totalGames * 100).toFixed(0);
    const bar = "#".repeat(Math.round(active / totalGames * 30));
    console.log(`    T${t.toString().padStart(2)}:  ${pct.padStart(3)}%  ${bar}`);
  }
}

// --- Print turn stats table ---
function printTurnStats(stats: TurnStats[], label: string): void {
  const pct = (n: number) => (n * 100).toFixed(0) + "%";
  const fmt = (n: number) => n.toFixed(1);

  console.log("\n" + "=".repeat(64));
  console.log(`  TURN BREAKDOWN — ${label}`);
  console.log("=".repeat(64));
  console.log(`  ${"T".padEnd(3)} ${"Active".padEnd(8)} ${"Ink".padEnd(6)} ${"Lore".padEnd(7)} ${"+Lore".padEnd(7)} ${"Cards/T"}`);
  console.log("  " + "-".repeat(44));
  for (const s of stats) {
    if (s.gamesActive === 0) continue;
    console.log(
      `  T${s.playerTurn.toString().padEnd(2)} ` +
      `${pct(s.gamesActive / dataset.length).padEnd(8)} ` +
      `${fmt(s.avgInkAvailable).padEnd(6)} ` +
      `${fmt(s.avgLoreTotal).padEnd(7)} ` +
      `+${fmt(s.avgLoreDelta).padEnd(6)} ` +
      `${fmt(s.avgCardsPlayedThisTurn)}`
    );
  }

  console.log("\n  Top cards played each turn:");
  for (const s of stats) {
    if (s.gamesActive === 0 || s.topCards.length === 0) continue;
    console.log(`\n  Turn ${s.playerTurn}:`);
    for (const c of s.topCards) {
      const bar = "#".repeat(Math.round(c.pct * 20));
      console.log(`    ${pct(c.pct).padStart(4)}  ${bar.padEnd(20)}  ${c.name}`);
    }
  }
}

// --- Main ---
printGameLengthSummary(dataset);

const players: Array<1 | 2> = playerArg === "1" ? [1] : playerArg === "2" ? [2] : [1, 2];

for (const p of players) {
  const label = p === 1
    ? `Player 1 (goes first — ${dataset[0]?.botLabels?.player1 ?? "unknown"})`
    : `Player 2 (goes second — ${dataset[0]?.botLabels?.player2 ?? "unknown"})`;
  const stats = summarizePlayer(dataset, p, maxTurns);
  printTurnStats(stats, label);
}

console.log();
